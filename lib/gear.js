// HOMESTEAD Gear: equipment a Creature wears in its Tool and Accessory
// slots for extra stat bonuses.
//
// The catalog, slots and stats are in public/js/gear-config.js; the stat
// calculation is care-config.js effectiveStat. The rules these transactions
// and the tables enforce:
// - Every Gear item is one gear_items row with a permanent id (shown as
//   GEAR-001). Its catalog entry, name, rarity, type, stats, trait and
//   creation time can never change, and a row can never be deleted: Gear is
//   never destroyed, a replaced item just goes back to its owner's inventory.
// - An item belongs to a wallet (owner) and is equipped on at most one
//   Creature: equipped_creature_id is a single column, so it can never sit on
//   two. A unique index allows one item per (Creature, slot), and a trigger
//   refuses to put an item on a Creature its owner does not own.
// - Equip, replace and unequip are each ONE transaction under a lock on the
//   Creature row, then the Gear rows, so double taps and other tabs wait their
//   turn and see what the one before them did. Equipping what is already on
//   that Creature, or unequipping an empty slot, changes nothing.
// - Equip and unequip are free: no STEAD, and no ledger entry.
// - Gear never changes a Creature's base stats or training bonuses, and
//   stays on while the Creature works. It cannot be changed while the
//   Creature is locked to a Contest (lib/contest-locks.js).
// - Starter Gear: each wallet can claim the STARTER_KIT once, ever
//   (gear_starter_claims), the only way Gear is made for now.
const cfg = require('../public/js/gear-config');
const creatureCfg = require('../public/js/creature-config');
const contestLocks = require('./contest-locks');

class GearError extends Error {
  constructor(code, message, status) {
    super(message);
    this.code = code;
    this.status = status || 400;
  }
}

function sqlList(values) {
  return values.map((v) => `'${String(v).replace(/'/g, "''")}'`).join(', ');
}

// Runs after the creatures table exists (creatures.ensureSchema calls it).
async function ensureSchema(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS gear_items (
      id SERIAL PRIMARY KEY,
      catalog_id TEXT NOT NULL,
      name TEXT NOT NULL,
      rarity TEXT NOT NULL,
      type TEXT NOT NULL,
      stats JSONB NOT NULL DEFAULT '{}'::jsonb,
      trait TEXT,
      owner TEXT NOT NULL,
      equipped_creature_id INT REFERENCES creatures (id),
      equipped_at TIMESTAMPTZ,
      source TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    ALTER TABLE gear_items DROP CONSTRAINT IF EXISTS gear_items_values;
    ALTER TABLE gear_items ADD CONSTRAINT gear_items_values CHECK (
      rarity IN (${sqlList(creatureCfg.RARITIES.map((r) => r.id))})
      AND type IN (${sqlList(cfg.SLOTS.map((s) => s.id))})
      AND jsonb_typeof(stats) = 'object'
    );
    CREATE UNIQUE INDEX IF NOT EXISTS gear_items_one_per_slot
      ON gear_items (equipped_creature_id, type) WHERE equipped_creature_id IS NOT NULL;
    CREATE INDEX IF NOT EXISTS gear_items_by_owner ON gear_items (owner, id);

    CREATE TABLE IF NOT EXISTS gear_starter_claims (
      owner TEXT PRIMARY KEY,
      claimed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE OR REPLACE FUNCTION homestead_gear_rules() RETURNS trigger AS $$
    DECLARE wearer TEXT;
    BEGIN
      IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Gear can never be destroyed'; END IF;
      IF TG_OP = 'UPDATE' AND (
           NEW.id IS DISTINCT FROM OLD.id OR NEW.catalog_id IS DISTINCT FROM OLD.catalog_id
           OR NEW.name IS DISTINCT FROM OLD.name OR NEW.rarity IS DISTINCT FROM OLD.rarity
           OR NEW.type IS DISTINCT FROM OLD.type OR NEW.stats IS DISTINCT FROM OLD.stats
           OR NEW.trait IS DISTINCT FROM OLD.trait OR NEW.source IS DISTINCT FROM OLD.source
           OR NEW.created_at IS DISTINCT FROM OLD.created_at) THEN
        RAISE EXCEPTION 'What a Gear item is can never change';
      END IF;
      IF NEW.equipped_creature_id IS NOT NULL THEN
        SELECT owner INTO wearer FROM creatures WHERE id = NEW.equipped_creature_id;
        IF wearer IS DISTINCT FROM NEW.owner THEN
          RAISE EXCEPTION 'Gear can only be equipped on a Creature its owner owns';
        END IF;
      END IF;
      RETURN NEW;
    END $$ LANGUAGE plpgsql;
    DROP TRIGGER IF EXISTS gear_items_rules ON gear_items;
    CREATE TRIGGER gear_items_rules BEFORE INSERT OR UPDATE OR DELETE ON gear_items
      FOR EACH ROW EXECUTE FUNCTION homestead_gear_rules();
  `);
}

function toGear(row) {
  if (!row) return null;
  return {
    gearId: row.id,
    code: cfg.formatId(row.id),
    catalogId: row.catalog_id,
    name: row.name,
    rarity: row.rarity,
    type: row.type,
    stats: row.stats || {},
    trait: row.trait,
    owner: row.owner,
    equippedCreatureId: row.equipped_creature_id,
    createdAt: row.created_at,
  };
}

// The Gear on each of these Creatures, as { [creatureId]: { tool, accessory } }
// with every slot present (null when empty).
async function equippedOn(db, creatureIds) {
  const out = {};
  for (const id of creatureIds) out[id] = emptySlots();
  if (!creatureIds.length) return out;
  const { rows } = await db.query(
    'SELECT * FROM gear_items WHERE equipped_creature_id = ANY($1::int[]) ORDER BY id',
    [creatureIds]
  );
  for (const row of rows) out[row.equipped_creature_id][row.type] = toGear(row);
  return out;
}

function emptySlots() {
  const slots = {};
  for (const s of cfg.SLOTS) slots[s.id] = null;
  return slots;
}

// This wallet's Gear inventory (every item it owns, equipped or not) and
// whether it has claimed its starter Gear. db may be the pool or a client.
async function inventory(db, walletId) {
  if (!walletId) return { walletId: null, items: [], starterClaimed: false };
  const { rows } = await db.query('SELECT * FROM gear_items WHERE owner = $1 ORDER BY id', [walletId]);
  const claimed = await db.query('SELECT 1 FROM gear_starter_claims WHERE owner = $1', [walletId]);
  return { walletId, items: rows.map(toGear), starterClaimed: claimed.rows.length > 0 };
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

// Give this wallet the starter kit, once ever. A second claim (double tap,
// another tab) makes nothing and answers alreadyClaimed.
async function claimStarter(pool, walletId) {
  if (!walletId) throw new GearError('no_wallet', 'Link a wallet to your Homeroom account first.');
  return inTransaction(pool, async (db) => {
    const claim = await db.query(
      'INSERT INTO gear_starter_claims (owner) VALUES ($1) ON CONFLICT DO NOTHING RETURNING owner',
      [walletId]
    );
    if (!claim.rows.length) return { granted: [], alreadyClaimed: true, gear: await inventory(db, walletId) };
    const granted = [];
    for (const catalogId of cfg.STARTER_KIT) {
      const item = cfg.byId(cfg.CATALOG, catalogId);
      const { rows } = await db.query(
        `INSERT INTO gear_items (catalog_id, name, rarity, type, stats, trait, owner, source)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'STARTER') RETURNING *`,
        [item.id, item.name, item.rarity, item.type, JSON.stringify(item.stats), item.trait, walletId]
      );
      granted.push(toGear(rows[0]));
    }
    return { granted, alreadyClaimed: false, gear: await inventory(db, walletId) };
  });
}

async function lockCreature(db, walletId, creatureId, now) {
  const { rows } = await db.query('SELECT id, owner, gene FROM creatures WHERE id = $1 FOR UPDATE', [creatureId]);
  const row = rows[0];
  if (!row) throw new GearError('not_found', 'No Creature has that ID.', 404);
  if (row.owner !== walletId) throw new GearError('not_yours', 'Only the owner of this Creature can change its Gear.', 403);
  if (!row.gene) throw new GearError('not_ready', 'This Creature is still awakening. Try again in a moment.', 409);
  if (await contestLocks.lockedContest(db, row.id, now || new Date())) {
    throw new GearError('in_contest', 'Creature is in a contest. Gear can\'t change until it ends.', 409);
  }
  return row;
}

function slotOrThrow(slot) {
  if (!cfg.isSlot(slot)) throw new GearError('bad_slot', 'Choose a Gear slot.');
  return slot;
}

// Equip one of this wallet's Gear items on one of its Creatures, in `slot`.
// An item already in that slot goes back to the inventory (replaced).
// Equipping what is already there changes nothing (alreadyEquipped).
async function equip(pool, walletId, creatureId, gearId, slot, now) {
  if (!walletId) throw new GearError('no_wallet', 'Link a wallet to your Homeroom account first.');
  slotOrThrow(slot);
  if (!Number.isInteger(gearId) || gearId < 1) throw new GearError('not_found', 'No Gear has that ID.', 404);
  return inTransaction(pool, async (db) => {
    await lockCreature(db, walletId, creatureId, now);
    const { rows } = await db.query('SELECT * FROM gear_items WHERE id = $1 FOR UPDATE', [gearId]);
    const item = rows[0];
    if (!item) throw new GearError('not_found', 'No Gear has that ID.', 404);
    if (item.owner !== walletId) throw new GearError('not_your_gear', 'That Gear isn\'t yours.', 403);
    if (item.type !== slot) {
      const fits = cfg.byId(cfg.SLOTS, item.type);
      throw new GearError('wrong_slot', item.name + ' goes in the ' + (fits ? fits.label : item.type) + ' slot.');
    }
    if (item.equipped_creature_id === creatureId) {
      return { equipped: toGear(item), replaced: null, alreadyEquipped: true };
    }
    if (item.equipped_creature_id != null) {
      throw new GearError('equipped_elsewhere', item.name + ' is equipped on another Creature. Unequip it there first.', 409);
    }
    const current = await db.query(
      'SELECT * FROM gear_items WHERE equipped_creature_id = $1 AND type = $2 FOR UPDATE',
      [creatureId, slot]
    );
    let replaced = null;
    if (current.rows.length) {
      const old = await db.query(
        'UPDATE gear_items SET equipped_creature_id = NULL, equipped_at = NULL WHERE id = $1 RETURNING *',
        [current.rows[0].id]
      );
      replaced = toGear(old.rows[0]);
    }
    const updated = await db.query(
      'UPDATE gear_items SET equipped_creature_id = $2, equipped_at = NOW() WHERE id = $1 RETURNING *',
      [item.id, creatureId]
    );
    return { equipped: toGear(updated.rows[0]), replaced, alreadyEquipped: false };
  });
}

// Take the Gear in `slot` off one of this wallet's Creatures, back to the
// inventory. An empty slot changes nothing (alreadyEmpty).
async function unequip(pool, walletId, creatureId, slot, now) {
  if (!walletId) throw new GearError('no_wallet', 'Link a wallet to your Homeroom account first.');
  slotOrThrow(slot);
  return inTransaction(pool, async (db) => {
    await lockCreature(db, walletId, creatureId, now);
    const { rows } = await db.query(
      `UPDATE gear_items SET equipped_creature_id = NULL, equipped_at = NULL
       WHERE equipped_creature_id = $1 AND type = $2 AND owner = $3 RETURNING *`,
      [creatureId, slot, walletId]
    );
    return { unequipped: toGear(rows[0]), alreadyEmpty: !rows.length };
  });
}

module.exports = { GearError, ensureSchema, toGear, equippedOn, emptySlots, inventory, claimStarter, equip, unequip };
