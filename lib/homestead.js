// HOMESTEAD Homesteads: one home per wallet, where its Creature lives.
//
// Wallet -> Homestead -> Creature -> Buildings -> Storage.
//
// The rules the tables and transactions enforce:
// - One Homestead per wallet, ever: homesteads.owner is UNIQUE, and a trigger
//   refuses to change a Homestead's id, owner or creation time. open() creates
//   it the first time its wallet owns a Creature and only returns it after.
// - The Homestead never copies its Creature. creature_id references the
//   existing creatures row, and is re-checked against creatures.owner every
//   time the owner opens it, so a future transfer moves the Creature to its
//   new owner's Homestead. A Creature lives in at most one Homestead.
// - Storage holds every resource at zero to start, and Postgres refuses any
//   row whose storage holds a negative or non-numeric amount, or more in
//   total than storage_capacity.
// - Buildings start at level 0, locked. The building of the resident
//   Creature's Trade (public/js/work-config.js) is unlocked at level 1 when
//   the owner opens the Homestead, so the Creature can work there
//   (lib/work.js). Every other building stays locked.
//
// Starting values and the building and resource lists are in
// public/js/homestead-config.js.
const cfg = require('../public/js/homestead-config');
const wcfg = require('../public/js/work-config');
const creatures = require('./creatures');

// Runs after genesis.ensureSchema (homesteads reference creatures).
async function ensureSchema(db) {
  await db.query(`
    CREATE OR REPLACE FUNCTION homestead_storage_ok(s JSONB, cap INT) RETURNS BOOLEAN AS $$
      SELECT jsonb_typeof(s) = 'object'
        AND NOT EXISTS (
          SELECT 1 FROM jsonb_each(s) e
          WHERE jsonb_typeof(e.value) <> 'number' OR (e.value #>> '{}')::numeric < 0)
        AND COALESCE((SELECT SUM((e.value #>> '{}')::numeric) FROM jsonb_each(s) e), 0) <= cap
    $$ LANGUAGE sql IMMUTABLE;

    CREATE TABLE IF NOT EXISTS homesteads (
      id SERIAL PRIMARY KEY,
      owner TEXT NOT NULL UNIQUE,
      level INT NOT NULL DEFAULT ${Number(cfg.START.level)} CHECK (level >= 1),
      capacity INT NOT NULL DEFAULT ${Number(cfg.START.capacity)} CHECK (capacity >= 1),
      creature_id INT UNIQUE REFERENCES creatures (id),
      storage JSONB NOT NULL DEFAULT '{}'::jsonb,
      storage_capacity INT NOT NULL DEFAULT ${Number(cfg.START.storageCapacity)} CHECK (storage_capacity >= 0),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT homesteads_storage_within_capacity CHECK (homestead_storage_ok(storage, storage_capacity))
    );

    CREATE TABLE IF NOT EXISTS homestead_buildings (
      homestead_id INT NOT NULL REFERENCES homesteads (id),
      building_id TEXT NOT NULL,
      level INT NOT NULL DEFAULT ${Number(cfg.BUILDING_START.level)} CHECK (level >= 0),
      unlocked BOOLEAN NOT NULL DEFAULT ${cfg.BUILDING_START.unlocked ? 'true' : 'false'},
      PRIMARY KEY (homestead_id, building_id)
    );

    CREATE OR REPLACE FUNCTION homestead_identity_is_permanent() RETURNS trigger AS $$
    BEGIN
      IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'A Homestead can never be removed'; END IF;
      IF NEW.id IS DISTINCT FROM OLD.id OR NEW.owner IS DISTINCT FROM OLD.owner
         OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'A Homestead''s id, owner and creation time can never change';
      END IF;
      RETURN NEW;
    END $$ LANGUAGE plpgsql;
    DROP TRIGGER IF EXISTS homesteads_identity_permanent ON homesteads;
    CREATE TRIGGER homesteads_identity_permanent BEFORE UPDATE OR DELETE ON homesteads
      FOR EACH ROW EXECUTE FUNCTION homestead_identity_is_permanent();
  `);
}

// Every configured building, with this Homestead's stored level and lock.
function toBuildings(rows) {
  const byId = new Map(rows.map((r) => [r.building_id, r]));
  return cfg.BUILDINGS.map((b) => {
    const row = byId.get(b.id);
    return {
      buildingId: b.id,
      name: b.name,
      description: b.description,
      level: row ? row.level : cfg.BUILDING_START.level,
      unlocked: row ? row.unlocked : cfg.BUILDING_START.unlocked,
    };
  });
}

// Every configured resource, at its stored amount (zero when absent).
function toStorage(stored) {
  const storage = cfg.emptyStorage();
  for (const r of cfg.RESOURCES) storage[r.key] = Number(stored && stored[r.key]) || 0;
  return storage;
}

function toHomestead(row, buildingRows) {
  if (!row) return null;
  const storage = toStorage(row.storage);
  return {
    homesteadId: row.id,
    owner: row.owner,
    level: row.level,
    createdAt: row.created_at,
    creatureId: row.creature_id,
    capacity: row.capacity,
    buildings: toBuildings(buildingRows),
    storage,
    storageUsed: cfg.storageUsed(storage),
    storageCapacity: row.storage_capacity,
  };
}

async function readBuildings(db, homesteadId) {
  const { rows } = await db.query('SELECT * FROM homestead_buildings WHERE homestead_id = $1', [homesteadId]);
  return rows;
}

// The Creature living in this Homestead, only while the Homestead's owner
// still owns it.
async function residentOf(db, row, now) {
  if (!row || row.creature_id == null) return null;
  const creature = await creatures.getById(db, row.creature_id, now);
  return creature && creature.owner === row.owner ? creature : null;
}

async function inTransaction(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

// Open this wallet's Homestead (its Creature's hunger as of `now`): create it if the wallet owns a Creature and
// has none yet, and move in the Creature the wallet owns now. A wallet that
// owns no Creature and never had a Homestead gets { homestead: null } and
// nothing is created. Safe to repeat: a second call returns the same
// Homestead with created: false.
async function open(pool, walletId, now) {
  return inTransaction(pool, async (db) => {
    // Lock the wallet's Creatures (and later its Homestead) so a concurrent
    // open or transfer waits instead of racing.
    const owned = await db.query('SELECT id FROM creatures WHERE owner = $1 ORDER BY id FOR UPDATE', [walletId]);
    const ownedIds = owned.rows.map((r) => r.id);
    let created = false;
    if (ownedIds.length) {
      // Only take a number from the sequence when there is no Homestead yet,
      // so numbers stay consecutive.
      const ins = await db.query(
        `INSERT INTO homesteads (owner, storage)
         SELECT $1, $2 WHERE NOT EXISTS (SELECT 1 FROM homesteads WHERE owner = $1)
         ON CONFLICT (owner) DO NOTHING RETURNING id`,
        [walletId, JSON.stringify(cfg.emptyStorage())]
      );
      created = ins.rows.length > 0;
    }
    const h = await db.query('SELECT * FROM homesteads WHERE owner = $1 FOR UPDATE', [walletId]);
    let row = h.rows[0];
    if (!row) return { created: false, homestead: null, creature: null };

    // Every configured building has its slot (new ones arrive locked).
    await db.query(
      `INSERT INTO homestead_buildings (homestead_id, building_id)
       SELECT $1, b FROM unnest($2::text[]) AS b
       ON CONFLICT DO NOTHING`,
      [row.id, cfg.BUILDINGS.map((b) => b.id)]
    );

    // Keep the resident only while this wallet owns it; otherwise move in the
    // wallet's first Creature, taking it from any Homestead it was left in.
    const resident = ownedIds.includes(row.creature_id) ? row.creature_id : (ownedIds[0] || null);
    if (resident !== row.creature_id) {
      if (resident != null) {
        await db.query('UPDATE homesteads SET creature_id = NULL WHERE creature_id = $1 AND owner <> $2', [resident, walletId]);
      }
      row = (await db.query('UPDATE homesteads SET creature_id = $2 WHERE id = $1 RETURNING *', [row.id, resident])).rows[0];
    }

    // The resident's Trade building becomes usable. No upgrade requirements.
    if (resident != null) {
      const t = await db.query('SELECT trade FROM creatures WHERE id = $1', [resident]);
      const building = t.rows[0] && wcfg.buildingFor(t.rows[0].trade);
      if (building) {
        await db.query(
          `UPDATE homestead_buildings SET unlocked = true, level = GREATEST(level, 1)
           WHERE homestead_id = $1 AND building_id = $2 AND NOT unlocked`,
          [row.id, building]
        );
      }
    }

    return {
      created,
      homestead: toHomestead(row, await readBuildings(db, row.id)),
      creature: await residentOf(db, row, now),
    };
  });
}

// Read any Homestead by its id, without changing anything. Its Creature is
// shown only while the Homestead's owner owns it.
async function getById(db, homesteadId, now) {
  const { rows } = await db.query('SELECT * FROM homesteads WHERE id = $1', [homesteadId]);
  const row = rows[0];
  if (!row) return null;
  const creature = await residentOf(db, row, now);
  const homestead = toHomestead(row, await readBuildings(db, row.id));
  if (!creature) homestead.creatureId = null;
  return { homestead, creature };
}

module.exports = { ensureSchema, open, getById, toHomestead, inTransaction };
