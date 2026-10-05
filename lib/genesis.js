// HOMESTEAD Genesis -> Seed -> Awaken, on the app's own Postgres.
//
// Nothing here is on-chain: a Seed and a Creature are rows in this app's
// database, created for the wallet linked to the signed-in Homeroom account.
//
// The rules the tables and transactions enforce:
// - One Genesis per wallet, ever. genesis_wallets.genesis_used turns true in
//   the same transaction that creates the Seed, and a trigger refuses to set
//   it back to false or delete the row.
// - One Creature per Seed. seeds.creature_id is set once, under a row lock,
//   and creatures.seed_id is UNIQUE.
// - Never more than MAX_CREATURE_SUPPLY Creatures. creature_supply is a single
//   counter row incremented only while it is below the cap (and a CHECK holds
//   the cap); the new value IS the Creature's id, so ids are never reused.
// - Ownership can change later (a future Marketplace updates `owner`) without
//   touching the id, the Seed, the genesis flag or the creation history
//   (`genesis_wallet` / `created_by` record who started it).
//
// Everything a Creature is (name, Species, rarity, stats, Gene, ...) is rolled
// once, inside the Awaken transaction, and stored: see lib/creatures.js.
const { MAX_CREATURE_SUPPLY } = require('../public/js/config');
const creatures = require('./creatures');
const generator = require('./creature-generator');

async function ensureSchema(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS creature_supply (
      id INT PRIMARY KEY CHECK (id = 1),
      created INT NOT NULL DEFAULT 0 CHECK (created >= 0 AND created <= ${Number(MAX_CREATURE_SUPPLY)})
    );
    INSERT INTO creature_supply (id, created) VALUES (1, 0) ON CONFLICT (id) DO NOTHING;

    CREATE TABLE IF NOT EXISTS genesis_wallets (
      wallet_id TEXT PRIMARY KEY,
      user_id TEXT,
      genesis_used BOOLEAN NOT NULL DEFAULT false,
      genesis_seed_id INT,
      genesis_creature_id INT,
      used_at TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS seeds (
      id SERIAL PRIMARY KEY,
      owner TEXT NOT NULL,
      genesis BOOLEAN NOT NULL DEFAULT false,
      genesis_wallet TEXT UNIQUE REFERENCES genesis_wallets (wallet_id),
      status TEXT NOT NULL DEFAULT 'DORMANT' CHECK (status IN ('DORMANT', 'AWAKENED')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      awakened_at TIMESTAMPTZ,
      creature_id INT UNIQUE
    );

    CREATE TABLE IF NOT EXISTS creatures (
      id INT PRIMARY KEY CHECK (id >= 1),
      owner TEXT NOT NULL,
      created_by TEXT NOT NULL,
      genesis BOOLEAN NOT NULL DEFAULT false,
      seed_id INT NOT NULL UNIQUE REFERENCES seeds (id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS creatures_owner_idx ON creatures (owner);

    CREATE OR REPLACE FUNCTION homestead_genesis_is_permanent() RETURNS trigger AS $$
    BEGIN
      IF TG_OP = 'DELETE' THEN
        IF OLD.genesis_used THEN RAISE EXCEPTION 'A used Genesis can never be removed'; END IF;
        RETURN OLD;
      END IF;
      IF OLD.genesis_used AND NOT NEW.genesis_used THEN
        RAISE EXCEPTION 'genesis_used can never become false again';
      END IF;
      RETURN NEW;
    END $$ LANGUAGE plpgsql;
    DROP TRIGGER IF EXISTS genesis_wallets_permanent ON genesis_wallets;
    CREATE TRIGGER genesis_wallets_permanent BEFORE UPDATE OR DELETE ON genesis_wallets
      FOR EACH ROW EXECUTE FUNCTION homestead_genesis_is_permanent();
  `);
  await creatures.ensureSchema(pool);
}

function toSeed(row) {
  if (!row) return null;
  return {
    seedId: row.id,
    owner: row.owner,
    createdAt: row.created_at,
    status: row.status,
    genesis: row.genesis,
    awakenedAt: row.awakened_at,
    creatureId: row.creature_id,
  };
}

async function readSupply(db) {
  const { rows } = await db.query('SELECT created FROM creature_supply WHERE id = 1');
  return { created: rows[0] ? rows[0].created : 0, max: MAX_CREATURE_SUPPLY };
}

// The global supply, plus this wallet's Genesis, Seed and Creature when a
// wallet is given.
async function getState(db, walletId) {
  const supply = await readSupply(db);
  if (!walletId) return { supply, genesis: null, seed: null, creature: null };
  const g = await db.query('SELECT * FROM genesis_wallets WHERE wallet_id = $1', [walletId]);
  const row = g.rows[0];
  const genesis = {
    walletId,
    genesisUsed: row ? row.genesis_used : false,
    genesisSeedId: row ? row.genesis_seed_id : null,
    genesisCreatureId: row ? row.genesis_creature_id : null,
  };
  let seed = null;
  let creature = null;
  if (genesis.genesisSeedId) {
    const s = await db.query('SELECT * FROM seeds WHERE id = $1', [genesis.genesisSeedId]);
    seed = toSeed(s.rows[0]);
  }
  if (genesis.genesisCreatureId) {
    const c = await db.query('SELECT * FROM creatures WHERE id = $1', [genesis.genesisCreatureId]);
    creature = creatures.toCreature(c.rows[0]);
  }
  return { supply, genesis, seed, creature };
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

class GenesisError extends Error {
  constructor(code, status, message) {
    super(message);
    this.code = code;
    this.status = status;
  }
}

// Genesis: create this wallet's one Seed and use up its Genesis, together.
// A repeat (double click, retried request) finds the Genesis already used
// and returns the existing state with created: false.
async function mint(pool, walletId, userId) {
  const created = await inTransaction(pool, async (db) => {
    const supply = await readSupply(db);
    // Claim the Genesis first. A concurrent request for the same wallet
    // waits on this row and then sees it already used.
    const claim = await db.query(
      `INSERT INTO genesis_wallets (wallet_id, user_id, genesis_used, used_at)
       VALUES ($1, $2, true, NOW())
       ON CONFLICT (wallet_id) DO UPDATE
         SET genesis_used = true, user_id = EXCLUDED.user_id, used_at = NOW()
         WHERE genesis_wallets.genesis_used = false
       RETURNING wallet_id`,
      [walletId, userId == null ? null : String(userId)]
    );
    if (!claim.rows.length) return false;
    if (supply.created >= supply.max) {
      throw new GenesisError('sold_out', 409, 'All ' + supply.max.toLocaleString('en-US') + ' Creatures have been awakened.');
    }
    const seed = await db.query(
      `INSERT INTO seeds (owner, genesis, genesis_wallet, status)
       VALUES ($1, true, $1, 'DORMANT') RETURNING id`,
      [walletId]
    );
    await db.query('UPDATE genesis_wallets SET genesis_seed_id = $2 WHERE wallet_id = $1', [walletId, seed.rows[0].id]);
    return true;
  });
  return Object.assign({ created }, await getState(pool, walletId));
}

// Awaken: turn this wallet's Seed into exactly one Creature. A Seed that
// already holds a Creature returns that Creature with created: false.
async function awaken(pool, walletId, seedId, rng = generator.cryptoRng) {
  const created = await inTransaction(pool, async (db) => {
    // Lock the Seed (always before the supply row, so two awakens never
    // deadlock): a duplicate request waits here, then sees creature_id set.
    const s = await db.query('SELECT * FROM seeds WHERE id = $1 AND owner = $2 FOR UPDATE', [seedId, walletId]);
    const seed = s.rows[0];
    if (!seed) throw new GenesisError('seed_not_found', 404, 'That Seed is not yours.');
    if (seed.creature_id != null) return false;
    const bump = await db.query(
      'UPDATE creature_supply SET created = created + 1 WHERE id = 1 AND created < $1 RETURNING created',
      [MAX_CREATURE_SUPPLY]
    );
    if (!bump.rows.length) {
      throw new GenesisError('sold_out', 409, 'All ' + MAX_CREATURE_SUPPLY.toLocaleString('en-US') + ' Creatures have been awakened.');
    }
    const creatureId = bump.rows[0].created;
    // Roll the whole Creature now, once, while holding the supply lock (so
    // its Gene is free), and store it with the row. A failure anywhere rolls
    // back the supply bump too: no half-made Creature.
    const traits = await creatures.roll(db, rng);
    await db.query(
      `INSERT INTO creatures (id, owner, created_by, genesis, seed_id, ${creatures.TRAIT_COLUMNS})
       VALUES ($1, $2, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
      [creatureId, walletId, seed.genesis, seed.id].concat(creatures.traitValues(traits))
    );
    await db.query(
      `UPDATE seeds SET status = 'AWAKENED', awakened_at = NOW(), creature_id = $2 WHERE id = $1`,
      [seed.id, creatureId]
    );
    await db.query(
      'UPDATE genesis_wallets SET genesis_creature_id = $2 WHERE genesis_seed_id = $1',
      [seed.id, creatureId]
    );
    return true;
  });
  return Object.assign({ created }, await getState(pool, walletId));
}

module.exports = { ensureSchema, getState, mint, awaken, GenesisError };
