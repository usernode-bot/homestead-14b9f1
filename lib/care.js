// HOMESTEAD Feeding + Training: the first things an owner does FOR their
// Creature.
//
// Balance and the shared calculations are in public/js/care-config.js. The
// rules these transactions and the tables enforce:
// - Hunger is stored as of a moment (creatures.hunger, hunger_updated_at) and
//   worked out from the time since, so it goes on while the app is closed.
//   It never goes below 0 or above HUNGER_MAX (a CHECK), and it never harms
//   a Creature: nothing here deletes, retires or changes its owner.
// - Feeding takes FEED_FODDER_COST Fodder from the owner's Homestead storage
//   and gives FEED_HUNGER_RESTORE hunger, never above the max. A full
//   Creature, or too little Fodder, is refused and nothing is taken.
// - Training takes TRAINING_COST STEAD through debitStead (a TRAINING ledger
//   entry) and adds TRAINING_AMOUNT to one training bonus, never past
//   MAX_TRAINING_BONUS (a CHECK). Base stats are never touched (the identity
//   trigger refuses it). No training while the Creature is out working.
// - Each action is ONE transaction under a lock on the Creature row, then
//   the Homestead, then the STEAD account (the same order homestead.open
//   uses), so rapid clicks and other tabs wait their turn and see what the
//   one before them did. Any failure rolls the whole action back.
// - Every action may carry a requestId the page makes once per tap. It is
//   recorded in creature_care_log, unique per (owner, action, requestId), and
//   for Training is also the STEAD ledger entry's key, so a retried or
//   duplicated request is answered with the state as it is and changes
//   nothing a second time.
const cfg = require('../public/js/care-config');
const creatures = require('./creatures');
const stead = require('./stead');
const { inTransaction } = require('./homestead');

class CareError extends Error {
  constructor(code, message, status) {
    super(message);
    this.code = code;
    this.status = status || 400;
  }
}

const ACTIONS = { FEED: 'FEED', TRAIN: 'TRAIN' };

// Runs after creatures.ensureSchema and work.ensureSchema.
async function ensureSchema(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS creature_care_log (
      id BIGSERIAL PRIMARY KEY,
      owner TEXT NOT NULL,
      creature_id INT NOT NULL REFERENCES creatures (id),
      action TEXT NOT NULL CHECK (action IN ('FEED', 'TRAIN')),
      request_key TEXT,
      detail JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS creature_care_log_once_per_request
      ON creature_care_log (owner, action, request_key) WHERE request_key IS NOT NULL;
    CREATE INDEX IF NOT EXISTS creature_care_log_by_creature ON creature_care_log (creature_id, id DESC);
  `);
}

// A requestId is optional; when given it is 8 to 64 letters, digits or dashes.
function requestKey(raw) {
  if (raw == null || raw === '') return null;
  const key = String(raw);
  if (!/^[A-Za-z0-9-]{8,64}$/.test(key)) throw new CareError('bad_request_id', 'That request could not be read. Try again.');
  return key;
}

async function lockCreature(db, walletId, creatureId) {
  const { rows } = await db.query('SELECT * FROM creatures WHERE id = $1 FOR UPDATE', [creatureId]);
  const row = rows[0];
  if (!row) throw new CareError('not_found', 'No Creature has that ID.', 404);
  if (row.owner !== walletId) throw new CareError('not_yours', 'Only the owner of this Creature can do that.', 403);
  if (!row.gene) throw new CareError('not_ready', 'This Creature is still awakening. Try again in a moment.', 409);
  return row;
}

async function lockHome(db, walletId) {
  const { rows } = await db.query('SELECT * FROM homesteads WHERE owner = $1 FOR UPDATE', [walletId]);
  return rows[0] || null;
}

function fodderIn(home) {
  return home ? Number(home.storage && home.storage[cfg.FEED_RESOURCE]) || 0 : 0;
}

// The Creature's unfinished Work at `now`, or null. Work whose time is up
// counts as finished even before it is collected.
async function workingNow(db, creatureId, now) {
  const { rows } = await db.query(
    "SELECT id, started_at, duration_seconds FROM creature_work WHERE creature_id = $1 AND status = 'working'",
    [creatureId]
  );
  const w = rows[0];
  if (!w) return null;
  const ends = new Date(new Date(w.started_at).getTime() + w.duration_seconds * 1000);
  return now.getTime() < ends.getTime() ? { workId: w.id, endsAt: ends.toISOString() } : null;
}

async function replayOf(db, walletId, action, key) {
  if (!key) return null;
  const { rows } = await db.query(
    'SELECT * FROM creature_care_log WHERE owner = $1 AND action = $2 AND request_key = $3',
    [walletId, action, key]
  );
  return rows[0] || null;
}

async function log(db, walletId, creatureId, action, key, detail) {
  await db.query(
    'INSERT INTO creature_care_log (owner, creature_id, action, request_key, detail) VALUES ($1, $2, $3, $4, $5)',
    [walletId, creatureId, action, key, detail]
  );
}

// What the owner's controls need: Fodder on hand, STEAD, and whether the
// Creature is out working. db may be the pool or a client in a transaction.
async function controls(db, walletId, creatureId, now) {
  const home = (await db.query('SELECT storage FROM homesteads WHERE owner = $1', [walletId])).rows[0] || null;
  const working = await workingNow(db, creatureId, now);
  return {
    fodder: fodderIn(home),
    hasHomestead: !!home,
    steadBalance: await stead.getSteadBalance(db, walletId),
    working: !!working,
    workEndsAt: working ? working.endsAt : null,
  };
}

async function answer(db, walletId, creatureId, now, extra) {
  return Object.assign({
    creature: await creatures.getById(db, creatureId, now),
    controls: await controls(db, walletId, creatureId, now),
  }, extra);
}

// Feed one of this wallet's Creatures once, at `now`.
async function feed(pool, walletId, creatureId, rawRequestId, now) {
  if (!walletId) throw new CareError('no_wallet', 'Link a wallet to your Homeroom account first.');
  const key = requestKey(rawRequestId);
  return inTransaction(pool, async (db) => {
    const row = await lockCreature(db, walletId, creatureId);
    const done = await replayOf(db, walletId, ACTIONS.FEED, key);
    if (done) return answer(db, walletId, creatureId, now, { fed: done.detail, replayed: true });

    const home = await lockHome(db, walletId);
    const before = cfg.currentHunger(row.hunger, row.hunger_updated_at, now);
    if (before >= cfg.HUNGER_MAX) throw new CareError('already_full', 'Already Full.', 409);
    const fodder = fodderIn(home);
    if (fodder < cfg.FEED_FODDER_COST) {
      throw new CareError('not_enough_fodder', 'Need ' + cfg.FEED_FODDER_COST + ' Fodder.', 409);
    }

    const storage = Object.assign({}, home.storage, { [cfg.FEED_RESOURCE]: fodder - cfg.FEED_FODDER_COST });
    await db.query('UPDATE homesteads SET storage = $2 WHERE id = $1', [home.id, JSON.stringify(storage)]);
    const after = cfg.clampHunger(before + cfg.FEED_HUNGER_RESTORE);
    await db.query(
      `UPDATE creatures SET hunger = $2, hunger_updated_at = $3, last_fed_at = $3, condition = $4 WHERE id = $1`,
      [row.id, after, now, cfg.condition(after).id]
    );
    const detail = {
      hungerBefore: before,
      hungerAfter: after,
      restored: after - before,
      fodderSpent: cfg.FEED_FODDER_COST,
    };
    await log(db, walletId, row.id, ACTIONS.FEED, key, detail);
    return answer(db, walletId, creatureId, now, { fed: detail, replayed: false });
  });
}

// Train one stat of one of this wallet's Creatures once, at `now`.
async function train(pool, walletId, creatureId, stat, rawRequestId, now) {
  if (!walletId) throw new CareError('no_wallet', 'Link a wallet to your Homeroom account first.');
  if (!cfg.isTrainable(stat)) throw new CareError('bad_stat', 'Choose a stat to train.');
  const key = requestKey(rawRequestId);
  return inTransaction(pool, async (db) => {
    const row = await lockCreature(db, walletId, creatureId);
    const done = await replayOf(db, walletId, ACTIONS.TRAIN, key);
    if (done) return answer(db, walletId, creatureId, now, { trained: done.detail, replayed: true });

    // The Homestead lock makes a Work start wait for this training, and the
    // other way round.
    await lockHome(db, walletId);
    if (await workingNow(db, row.id, now)) {
      throw new CareError('working', 'Creature is working. Training unavailable.', 409);
    }
    const column = 'training_' + stat; // stat is one of TRAINABLE_STATS
    const bonus = Number(row[column]) || 0;
    if (bonus + cfg.TRAINING_AMOUNT > cfg.MAX_TRAINING_BONUS) throw new CareError('max_training', 'MAX TRAINING.', 409);
    const balance = await stead.getSteadBalance(db, walletId);
    if (balance < cfg.TRAINING_COST) {
      throw new CareError('not_enough_stead', 'Need ' + cfg.TRAINING_COST + ' STEAD to train.', 409);
    }

    const detail = {
      stat,
      bonusBefore: bonus,
      bonusAfter: bonus + cfg.TRAINING_AMOUNT,
      amount: cfg.TRAINING_AMOUNT,
      cost: cfg.TRAINING_COST,
    };
    let entry;
    try {
      entry = await stead.debitStead(db, walletId, cfg.TRAINING_COST, 'TRAINING',
        { creatureId: row.id, stat, bonusAfter: detail.bonusAfter }, { key });
    } catch (err) {
      if (err.code === 'insufficient_stead') throw new CareError('not_enough_stead', 'Need ' + cfg.TRAINING_COST + ' STEAD to train.', 409);
      throw err;
    }
    detail.ledgerEntryId = entry.id;
    await db.query(`UPDATE creatures SET ${column} = ${column} + $2 WHERE id = $1`, [row.id, cfg.TRAINING_AMOUNT]);
    await log(db, walletId, row.id, ACTIONS.TRAIN, key, detail);
    return answer(db, walletId, creatureId, now, { trained: detail, replayed: false });
  });
}

// Save the current hunger of this wallet's Creatures (when the owner opens
// their Homestead), so the stored value follows the clock. Only moves
// forward in time, and never changes what the hunger works out to.
async function syncHunger(pool, walletId, now) {
  if (!walletId) return 0;
  return inTransaction(pool, async (db) => {
    const { rows } = await db.query(
      'SELECT id, hunger, hunger_updated_at FROM creatures WHERE owner = $1 AND hunger_updated_at < $2 ORDER BY id FOR UPDATE',
      [walletId, now]
    );
    let saved = 0;
    for (const row of rows) {
      const s = cfg.settleHunger(row.hunger, row.hunger_updated_at, now);
      if (s.hunger === row.hunger) continue;
      await db.query(
        'UPDATE creatures SET hunger = $2, hunger_updated_at = $3, condition = $4 WHERE id = $1',
        [row.id, s.hunger, s.since, cfg.condition(s.hunger).id]
      );
      saved++;
    }
    return saved;
  });
}

module.exports = { CareError, ensureSchema, feed, train, controls, syncHunger };
