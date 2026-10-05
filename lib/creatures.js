// HOMESTEAD Creatures: what a Creature is, stored once and read back.
//
// A Creature's identity is its id, Seed, Genesis flag and Gene, together
// with everything rolled at Awaken (Species, rarity, base stats, personality,
// mutation, Trade, appearance). A trigger refuses to change any of it once
// set. Only three things can change: `owner` (a future transfer), `level`
// (future progression) and `name`, which the current owner can rename.
// Feeding + Training (lib/care.js) add their own state beside it: hunger,
// condition, last_fed_at and the training bonuses. Base stats never change.
// Gear (lib/gear.js) lives in its own table; a Creature read here carries the
// Gear it has on, and its effective stats include that Gear.
const generator = require('./creature-generator');
const names = require('../public/js/creature-name');
const care = require('../public/js/care-config');
const gear = require('./gear');

class CreatureError extends Error {
  constructor(code, status, message) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

// Runs after genesis.ensureSchema has created the creatures table. Columns
// are nullable only so Creatures awakened before this existed can be filled
// in by backfill() on boot.
async function ensureSchema(db) {
  await db.query(`
    ALTER TABLE creatures ADD COLUMN IF NOT EXISTS name TEXT;
    ALTER TABLE creatures ADD COLUMN IF NOT EXISTS name_updated_at TIMESTAMPTZ;
    ALTER TABLE creatures ADD COLUMN IF NOT EXISTS species TEXT;
    ALTER TABLE creatures ADD COLUMN IF NOT EXISTS rarity TEXT;
    ALTER TABLE creatures ADD COLUMN IF NOT EXISTS level INT NOT NULL DEFAULT 1;
    ALTER TABLE creatures ADD COLUMN IF NOT EXISTS base_hp INT;
    ALTER TABLE creatures ADD COLUMN IF NOT EXISTS base_attack INT;
    ALTER TABLE creatures ADD COLUMN IF NOT EXISTS base_defense INT;
    ALTER TABLE creatures ADD COLUMN IF NOT EXISTS base_speed INT;
    ALTER TABLE creatures ADD COLUMN IF NOT EXISTS base_luck INT;
    ALTER TABLE creatures ADD COLUMN IF NOT EXISTS personality TEXT;
    ALTER TABLE creatures ADD COLUMN IF NOT EXISTS gene TEXT;
    ALTER TABLE creatures ADD COLUMN IF NOT EXISTS mutation TEXT;
    ALTER TABLE creatures ADD COLUMN IF NOT EXISTS trade TEXT;
    ALTER TABLE creatures ADD COLUMN IF NOT EXISTS appearance JSONB;
    CREATE UNIQUE INDEX IF NOT EXISTS creatures_gene_key ON creatures (gene);

    -- Feeding: hunger as of hunger_updated_at (the current value is worked out
    -- from the time since, see public/js/care-config.js), the condition it
    -- gave then, and when the Creature was last fed. A new Creature starts
    -- full, fed at its Awaken (these defaults are the Awaken transaction's
    -- time); Creatures from before Feeding start full as of this migration.
    ALTER TABLE creatures ADD COLUMN IF NOT EXISTS hunger INT NOT NULL DEFAULT ${Number(care.HUNGER_MAX)};
    ALTER TABLE creatures ADD COLUMN IF NOT EXISTS hunger_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
    ALTER TABLE creatures ADD COLUMN IF NOT EXISTS condition TEXT NOT NULL DEFAULT 'GOOD';
    ALTER TABLE creatures ADD COLUMN IF NOT EXISTS last_fed_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
    -- Training: what training has added to each base stat.
    ALTER TABLE creatures ADD COLUMN IF NOT EXISTS training_hp INT NOT NULL DEFAULT 0;
    ALTER TABLE creatures ADD COLUMN IF NOT EXISTS training_attack INT NOT NULL DEFAULT 0;
    ALTER TABLE creatures ADD COLUMN IF NOT EXISTS training_defense INT NOT NULL DEFAULT 0;
    ALTER TABLE creatures ADD COLUMN IF NOT EXISTS training_speed INT NOT NULL DEFAULT 0;
    ALTER TABLE creatures ADD COLUMN IF NOT EXISTS training_luck INT NOT NULL DEFAULT 0;
    ALTER TABLE creatures DROP CONSTRAINT IF EXISTS creatures_care_ranges;
    ALTER TABLE creatures ADD CONSTRAINT creatures_care_ranges CHECK (
      hunger BETWEEN 0 AND ${Number(care.HUNGER_MAX)}
      AND condition IN (${care.CONDITIONS.map((c) => `'${c.id}'`).join(', ')})
      AND training_hp BETWEEN 0 AND ${Number(care.MAX_TRAINING_BONUS)}
      AND training_attack BETWEEN 0 AND ${Number(care.MAX_TRAINING_BONUS)}
      AND training_defense BETWEEN 0 AND ${Number(care.MAX_TRAINING_BONUS)}
      AND training_speed BETWEEN 0 AND ${Number(care.MAX_TRAINING_BONUS)}
      AND training_luck BETWEEN 0 AND ${Number(care.MAX_TRAINING_BONUS)}
    );

    CREATE OR REPLACE FUNCTION homestead_creature_identity_is_permanent() RETURNS trigger AS $$
    BEGIN
      IF NEW.id IS DISTINCT FROM OLD.id OR NEW.seed_id IS DISTINCT FROM OLD.seed_id
         OR NEW.genesis IS DISTINCT FROM OLD.genesis OR NEW.created_by IS DISTINCT FROM OLD.created_by
         OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'A Creature''s identity can never change';
      END IF;
      IF OLD.gene IS NOT NULL AND (
           NEW.gene IS DISTINCT FROM OLD.gene OR NEW.species IS DISTINCT FROM OLD.species
           OR NEW.rarity IS DISTINCT FROM OLD.rarity OR NEW.personality IS DISTINCT FROM OLD.personality
           OR NEW.mutation IS DISTINCT FROM OLD.mutation OR NEW.trade IS DISTINCT FROM OLD.trade
           OR NEW.appearance IS DISTINCT FROM OLD.appearance
           OR NEW.base_hp IS DISTINCT FROM OLD.base_hp OR NEW.base_attack IS DISTINCT FROM OLD.base_attack
           OR NEW.base_defense IS DISTINCT FROM OLD.base_defense OR NEW.base_speed IS DISTINCT FROM OLD.base_speed
           OR NEW.base_luck IS DISTINCT FROM OLD.base_luck) THEN
        RAISE EXCEPTION 'A Creature''s generated traits can never change';
      END IF;
      RETURN NEW;
    END $$ LANGUAGE plpgsql;
    DROP TRIGGER IF EXISTS creatures_identity_permanent ON creatures;
    CREATE TRIGGER creatures_identity_permanent BEFORE UPDATE ON creatures
      FOR EACH ROW EXECUTE FUNCTION homestead_creature_identity_is_permanent();
  `);
  // Gear references creatures, so its tables come right after.
  await gear.ensureSchema(db);
}

// Feeding state at `now`: the stored hunger with the time since worked in.
function careAt(row, now) {
  const hunger = care.currentHunger(row.hunger, row.hunger_updated_at, now || new Date());
  const state = care.hungerState(hunger);
  return {
    hunger,
    hungerMax: care.HUNGER_MAX,
    hungerState: state.id,
    hungerLabel: state.label,
    condition: care.condition(hunger).id,
    workEfficiency: care.efficiency(hunger),
    lastFedAt: row.last_fed_at ? new Date(row.last_fed_at).toISOString() : null,
  };
}

// `now` (the request's time) decides the current hunger; it defaults to now.
// `equipped` is the Creature's Gear by slot (gear.equippedOn); without it the
// Creature shows with empty slots.
function toCreature(row, now, equipped) {
  if (!row) return null;
  const trainingBonus = {
    hp: Number(row.training_hp) || 0,
    attack: Number(row.training_attack) || 0,
    defense: Number(row.training_defense) || 0,
    speed: Number(row.training_speed) || 0,
    luck: Number(row.training_luck) || 0,
  };
  const c = {
    creatureId: row.id,
    owner: row.owner,
    seedId: row.seed_id,
    genesis: row.genesis,
    createdAt: row.created_at,
    name: row.name,
    species: row.species,
    rarity: row.rarity,
    level: row.level,
    stats: {
      hp: row.base_hp,
      attack: row.base_attack,
      defense: row.base_defense,
      speed: row.base_speed,
      luck: row.base_luck,
    },
    personality: row.personality,
    gene: row.gene,
    mutation: row.mutation,
    trade: row.trade,
    appearance: row.appearance,
    trainingBonus,
    gear: equipped || gear.emptySlots(),
  };
  c.gearBonus = care.gearBonuses(c);
  c.effectiveStats = care.effectiveStats(c);
  // Hunger, condition and efficiency right now. The stored hunger/condition
  // are only the starting point this is worked out from.
  if (row.hunger != null) c.care = careAt(row, now);
  return c;
}

// A Gene no other Creature has. Call it while holding the creature_supply
// row lock (every Awaken does), so no other transaction can take the same
// Gene between the check and the write; the unique index backs this up.
async function uniqueGene(db, speciesId, rng) {
  for (let i = 0; i < 64; i++) {
    const gene = generator.geneCandidate(rng, speciesId);
    const { rows } = await db.query('SELECT 1 FROM creatures WHERE gene = $1', [gene]);
    if (!rows.length) return gene;
  }
  throw new CreatureError('gene_exhausted', 500, 'Could not find a free Gene. Try again.');
}

// Roll a Creature's traits and a free Gene. Returns the column values.
async function roll(db, rng) {
  const traits = generator.generate(rng);
  const gene = await uniqueGene(db, traits.species, rng);
  return Object.assign({ gene }, traits);
}

const TRAIT_COLUMNS = `name, species, rarity, level, base_hp, base_attack, base_defense,
  base_speed, base_luck, personality, gene, mutation, trade, appearance`;

function traitValues(t) {
  return [t.name, t.species, t.rarity, t.level, t.stats.hp, t.stats.attack, t.stats.defense,
    t.stats.speed, t.stats.luck, t.personality, t.gene, t.mutation, t.trade, JSON.stringify(t.appearance)];
}

// Fill in Creatures awakened before the generator existed, once each. The
// rolls are seeded by the Creature's id, so a staging copy and production
// give that Creature the same traits.
async function backfill(pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // The supply row lock serializes this with every Awaken (uniqueGene).
    await client.query('SELECT created FROM creature_supply WHERE id = 1 FOR UPDATE');
    const { rows } = await client.query('SELECT id FROM creatures WHERE gene IS NULL ORDER BY id');
    for (const { id } of rows) {
      const t = await roll(client, generator.seededRng('homestead-creature:' + id));
      await client.query(
        `UPDATE creatures SET (${TRAIT_COLUMNS}) = ($2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
         WHERE id = $1 AND gene IS NULL`,
        [id].concat(traitValues(t))
      );
    }
    await client.query('COMMIT');
    return rows.length;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

async function getById(db, creatureId, now) {
  const { rows } = await db.query('SELECT * FROM creatures WHERE id = $1', [creatureId]);
  if (!rows[0]) return null;
  const equipped = await gear.equippedOn(db, [rows[0].id]);
  return toCreature(rows[0], now, equipped[rows[0].id]);
}

async function listOwned(db, walletId, now) {
  if (!walletId) return [];
  const { rows } = await db.query('SELECT * FROM creatures WHERE owner = $1 ORDER BY id', [walletId]);
  const equipped = await gear.equippedOn(db, rows.map((row) => row.id));
  return rows.map((row) => toCreature(row, now, equipped[row.id]));
}

// Rename: the current owner only, and only the name changes.
async function rename(db, walletId, creatureId, rawName) {
  const check = names.validate(rawName);
  if (!check.ok) throw new CreatureError('bad_name', 400, check.error);
  const { rows } = await db.query(
    `UPDATE creatures SET name = $3, name_updated_at = NOW()
     WHERE id = $1 AND owner = $2 RETURNING *`,
    [creatureId, walletId, check.name]
  );
  if (!rows.length) throw new CreatureError('not_yours', 404, 'Only the owner of this Creature can rename it.');
  return getById(db, creatureId);
}

module.exports = {
  ensureSchema, toCreature, roll, TRAIT_COLUMNS, traitValues, backfill,
  getById, listOwned, rename, CreatureError,
};
