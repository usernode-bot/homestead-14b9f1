// HOMESTEAD Genesis -> Seed -> Awaken, on the app's own Postgres.
//
// Nothing here is on-chain: a Seed and a Creature are rows in this app's
// database, created for the wallet linked to the signed-in Homeroom account.
//
// The rules the tables and transactions enforce:
// - Genesis can be used again and again, for GENESIS_COST STEAD each
//   (public/js/config.js). Each one is checked in this order, under a lock on
//   the wallet: it has room under MAX_OWNED_CREATURES (lib/ownership.js,
//   which counts the Seed it is about to make), it has no Genesis Seed still
//   waiting to be awakened (one at a time, a partial unique index), and it
//   has the STEAD. Then the Seed and its debit (debitStead, type GENESIS) are
//   written in the same transaction: never a Seed without the debit, never a
//   debit without the Seed. A per-tap requestId answers a retried request
//   with the Seed it already made.
// - One Creature per Seed. seeds.creature_id is set once, under a row lock,
//   and creatures.seed_id is UNIQUE.
// - There is no global Creature cap. A Creature's id comes from
//   creatures_id_seq, so ids are never reused.
// - genesis_wallets records that a wallet has used Genesis at least once
//   (genesis_used never goes back to false, a trigger) and links the
//   Homeroom user to it (Contests look players up by it). genesis_seed_id /
//   genesis_creature_id are that wallet's first Genesis only.
// - Ownership can change later (a future Marketplace moves `owner` through
//   lib/ownership.js) without touching the id, the Seed, the genesis flag or
//   the creation history (`genesis_wallet` / `created_by` record who started
//   it), and never changes anyone's Genesis records.
//
// Everything a Creature is (name, Species, rarity, stats, Gene, ...) is rolled
// once, inside the Awaken transaction, and stored: see lib/creatures.js.
const { GENESIS_COST } = require('../public/js/config');
const creatures = require('./creatures');
const generator = require('./creature-generator');
const stead = require('./stead');
const ownership = require('./ownership');

// How many of a wallet's Geneses its history shows.
const HISTORY_LIMIT = 30;

async function ensureSchema(pool) {
  // Genesis spends STEAD, so the ledger comes first.
  await stead.ensureSchema(pool);
  await pool.query(`
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
      genesis_wallet TEXT REFERENCES genesis_wallets (wallet_id),
      status TEXT NOT NULL DEFAULT 'DORMANT' CHECK (status IN ('DORMANT', 'AWAKENED')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      awakened_at TIMESTAMPTZ,
      creature_id INT UNIQUE
    );
    -- Genesis is repeatable: a wallet may have used it for many Seeds.
    ALTER TABLE seeds DROP CONSTRAINT IF EXISTS seeds_genesis_wallet_key;
    -- What the Genesis cost (0 for the free one-time Genesis from before),
    -- its ledger entry, and the tap that asked for it.
    ALTER TABLE seeds ADD COLUMN IF NOT EXISTS cost BIGINT NOT NULL DEFAULT 0;
    ALTER TABLE seeds ADD COLUMN IF NOT EXISTS ledger_entry_id BIGINT;
    ALTER TABLE seeds ADD COLUMN IF NOT EXISTS request_key TEXT;
    CREATE UNIQUE INDEX IF NOT EXISTS seeds_once_per_request ON seeds (owner, request_key) WHERE request_key IS NOT NULL;
    -- One Genesis Seed waiting to be awakened per wallet, at a time.
    CREATE UNIQUE INDEX IF NOT EXISTS seeds_one_dormant_genesis ON seeds (owner) WHERE genesis AND creature_id IS NULL;
    CREATE INDEX IF NOT EXISTS seeds_by_genesis_wallet ON seeds (genesis_wallet, id DESC);

    CREATE TABLE IF NOT EXISTS creatures (
      id INT PRIMARY KEY CHECK (id >= 1),
      owner TEXT NOT NULL,
      created_by TEXT NOT NULL,
      genesis BOOLEAN NOT NULL DEFAULT false,
      seed_id INT NOT NULL UNIQUE REFERENCES seeds (id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS creatures_owner_idx ON creatures (owner);

    -- Creature ids come from a sequence; there is no supply counter any more.
    -- The first boot after the counter existed carries it over (it also
    -- covers ids a rolled-back Awaken skipped), so no id is ever handed out
    -- twice, then drops it.
    CREATE SEQUENCE IF NOT EXISTS creatures_id_seq OWNED BY creatures.id;
    DO $$
    DECLARE top BIGINT;
    BEGIN
      IF to_regclass('creature_supply') IS NOT NULL THEN
        SELECT GREATEST(COALESCE((SELECT MAX(id) FROM creatures), 0), COALESCE((SELECT created FROM creature_supply WHERE id = 1), 0)) INTO top;
        IF top > 0 THEN PERFORM setval('creatures_id_seq', top); END IF;
        DROP TABLE creature_supply;
      END IF;
    END $$;
    ALTER TABLE creatures ALTER COLUMN id SET DEFAULT nextval('creatures_id_seq');

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

function toHistoryEntry(row) {
  return {
    seedId: row.id,
    createdAt: row.created_at,
    cost: Number(row.cost),
    status: row.status,
    creatureId: row.creature_id,
    creatureName: row.creature_name || null,
  };
}

// This wallet's Genesis: how many Creatures it holds (slots), its Genesis
// Seed still waiting to be awakened, its first-owned Creature (the one My
// Creature and the Homestead show) and the Geneses it has used, newest first.
async function getState(db, walletId) {
  if (!walletId) return { genesis: null, slots: null, seed: null, creature: null, history: null };
  const g = await db.query('SELECT genesis_used FROM genesis_wallets WHERE wallet_id = $1', [walletId]);
  const genesis = {
    walletId,
    genesisUsed: g.rows[0] ? g.rows[0].genesis_used : false,
    cost: GENESIS_COST,
  };
  const slots = await ownership.ownedCount(db, walletId);
  const s = await db.query(
    'SELECT * FROM seeds WHERE owner = $1 AND genesis AND creature_id IS NULL ORDER BY id LIMIT 1',
    [walletId]
  );
  const c = await db.query('SELECT * FROM creatures WHERE owner = $1 ORDER BY id LIMIT 1', [walletId]);
  const h = await db.query(
    `SELECT s.*, c.name AS creature_name FROM seeds s LEFT JOIN creatures c ON c.id = s.creature_id
     WHERE s.genesis_wallet = $1 AND s.genesis ORDER BY s.id DESC LIMIT ${HISTORY_LIMIT}`,
    [walletId]
  );
  return {
    genesis,
    slots,
    seed: toSeed(s.rows[0]),
    creature: creatures.toCreature(c.rows[0]),
    history: h.rows.map(toHistoryEntry),
  };
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

// A requestId is optional; when given it is 8 to 64 letters, digits or dashes.
function requestKey(raw) {
  if (raw == null || raw === '') return null;
  const key = String(raw);
  if (!/^[A-Za-z0-9-]{8,64}$/.test(key)) throw new GenesisError('bad_request_id', 400, 'That request could not be read. Try again.');
  return key;
}

const NOT_ENOUGH = 'Need ' + GENESIS_COST.toLocaleString('en-US') + ' STEAD for Genesis.';

// Genesis: spend GENESIS_COST STEAD on a new dormant Seed for this wallet,
// all in one transaction (see the rules at the top). A repeat of the same tap
// (opts.requestId) returns the existing state with created: false.
async function mint(pool, walletId, userId, opts) {
  if (!walletId) throw new GenesisError('no_wallet', 400, 'Link a wallet to your Homeroom account first.');
  const key = requestKey(opts && opts.requestId);
  const created = await inTransaction(pool, async (db) => {
    // Everything that changes what this wallet holds waits here in turn.
    await ownership.lockWallet(db, walletId);
    if (key) {
      const done = await db.query('SELECT 1 FROM seeds WHERE owner = $1 AND request_key = $2', [walletId, key]);
      if (done.rows.length) return false;
    }
    await ownership.assertRoom(db, walletId);
    const waiting = await db.query('SELECT 1 FROM seeds WHERE owner = $1 AND genesis AND creature_id IS NULL', [walletId]);
    if (waiting.rows.length) throw new GenesisError('seed_waiting', 409, 'Awaken your Seed first.');
    if (await stead.getSteadBalance(db, walletId) < GENESIS_COST) throw new GenesisError('not_enough_stead', 409, NOT_ENOUGH);

    // The wallet's Genesis record first (the Seed refers to it).
    await db.query(
      `INSERT INTO genesis_wallets (wallet_id, user_id, genesis_used, used_at)
       VALUES ($1, $2, true, NOW())
       ON CONFLICT (wallet_id) DO UPDATE
         SET genesis_used = true, user_id = COALESCE(EXCLUDED.user_id, genesis_wallets.user_id),
             used_at = COALESCE(genesis_wallets.used_at, NOW())`,
      [walletId, userId == null ? null : String(userId)]
    );
    const seed = (await db.query(
      `INSERT INTO seeds (owner, genesis, genesis_wallet, status, cost, request_key)
       VALUES ($1, true, $1, 'DORMANT', $2, $3) RETURNING id`,
      [walletId, GENESIS_COST, key]
    )).rows[0];
    let entry;
    try {
      entry = await stead.debitStead(db, walletId, GENESIS_COST, 'GENESIS', { seedId: seed.id }, { key: 'GENESIS-SEED-' + seed.id });
    } catch (err) {
      if (err.code === 'insufficient_stead') throw new GenesisError('not_enough_stead', 409, NOT_ENOUGH);
      throw err;
    }
    await db.query('UPDATE seeds SET ledger_entry_id = $2 WHERE id = $1', [seed.id, entry.id]);
    await db.query(
      'UPDATE genesis_wallets SET genesis_seed_id = COALESCE(genesis_seed_id, $2) WHERE wallet_id = $1',
      [walletId, seed.id]
    );
    return true;
  });
  return Object.assign({ created }, await getState(pool, walletId));
}

// Awaken: turn this wallet's Seed into exactly one Creature. A Seed that
// already holds a Creature returns that state with created: false. The cap
// isn't checked again: the Seed already holds its Creature's place.
async function awaken(pool, walletId, seedId, rng = generator.cryptoRng) {
  const created = await inTransaction(pool, async (db) => {
    // Lock the Seed: a duplicate request waits here, then sees creature_id set.
    const s = await db.query('SELECT * FROM seeds WHERE id = $1 AND owner = $2 FOR UPDATE', [seedId, walletId]);
    const seed = s.rows[0];
    if (!seed) throw new GenesisError('seed_not_found', 404, 'That Seed is not yours.');
    if (seed.creature_id != null) return false;
    // Roll the whole Creature now, once, holding the Gene lock (so its Gene
    // is free), and store it with the row. A failure anywhere rolls all of it
    // back: no half-made Creature.
    await creatures.lockGenes(db);
    const traits = await creatures.roll(db, rng);
    const creatureId = Number((await db.query("SELECT nextval('creatures_id_seq') AS id")).rows[0].id);
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

module.exports = { ensureSchema, getState, mint, awaken, GenesisError, HISTORY_LIMIT };
