// HOMESTEAD Work: a Creature works at its Trade's building and brings
// resources home to its Homestead's storage.
//
// Creature -> Trade -> Work -> Building -> Resources -> Storage.
//
// The rules the table, its trigger and these transactions enforce:
// - A Work record keeps who worked (creature_id, owner, trade), where
//   (building_id, homestead_id), when (started_at) and for how long
//   (duration_seconds). Nothing counts down: whether it is finished is always
//   worked out from started_at + duration and the current time, so Work goes
//   on while nobody has the app open.
// - A Creature works only at the building of its own Trade
//   (public/js/work-config.js), and only once that building is unlocked.
// - One unfinished Work per Creature, ever: a partial unique index refuses a
//   second, so rapid clicks, refreshes and other tabs get the same Work back.
// - status only moves forward: working -> completed -> claimed. Rewards are
//   rolled ONCE, when the finished Work is first settled, and a trigger never
//   lets them change afterwards.
// - collected records what has gone into storage. The trigger refuses any
//   amount above the rolled reward or below what was already collected, so no
//   Work can ever pay out twice. Storage is unlimited, so collecting always
//   moves the whole reward home in one go; pending (rewards - collected) is
//   kept on the record and in the API for Work finished under the old limit,
//   and the boot sweep moves any of that rest home.
// - Work changes no Creature (identity, stats or level) and produces no STEAD
//   Points (lib/stead.js): Work pays in Resources only.
// - How hungry the Creature was when it started decides the Work's
//   efficiency (public/js/care-config.js), stored on the record and never
//   changed: each rolled Resource is multiplied by it and rounded down.
const crypto = require('crypto');
const care = require('../public/js/care-config');
const hcfg = require('../public/js/homestead-config');
const wcfg = require('../public/js/work-config');
const { inTransaction } = require('./homestead');
const contestLocks = require('./contest-locks');

class WorkError extends Error {
  constructor(code, message, status) {
    super(message);
    this.code = code;
    this.status = status || 400;
  }
}

// Runs after homestead.ensureSchema (Work references homesteads and creatures).
async function ensureSchema(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS creature_work (
      id SERIAL PRIMARY KEY,
      homestead_id INT NOT NULL REFERENCES homesteads (id),
      creature_id INT NOT NULL REFERENCES creatures (id),
      owner TEXT NOT NULL,
      trade TEXT NOT NULL,
      building_id TEXT NOT NULL,
      duration_id TEXT NOT NULL,
      duration_seconds INT NOT NULL CHECK (duration_seconds > 0),
      started_at TIMESTAMPTZ NOT NULL,
      status TEXT NOT NULL DEFAULT 'working' CHECK (status IN ('working', 'completed', 'claimed')),
      rewards JSONB,
      collected JSONB NOT NULL DEFAULT '{}'::jsonb,
      completed_at TIMESTAMPTZ,
      claimed_at TIMESTAMPTZ,
      CONSTRAINT creature_work_rewards_once_finished CHECK ((status = 'working') = (rewards IS NULL)),
      CONSTRAINT creature_work_claimed_at CHECK ((status = 'claimed') = (claimed_at IS NOT NULL))
    );
    ALTER TABLE creature_work ADD COLUMN IF NOT EXISTS efficiency NUMERIC(4, 2) NOT NULL DEFAULT 1
      CHECK (efficiency > 0 AND efficiency <= 1);
    ALTER TABLE creature_work ADD COLUMN IF NOT EXISTS hunger_state TEXT;
    CREATE UNIQUE INDEX IF NOT EXISTS creature_work_one_unfinished
      ON creature_work (creature_id) WHERE status <> 'claimed';
    CREATE INDEX IF NOT EXISTS creature_work_by_homestead ON creature_work (homestead_id, id DESC);

    CREATE OR REPLACE FUNCTION creature_work_rules() RETURNS trigger AS $$
    DECLARE
      ranks CONSTANT JSONB := '{"working": 0, "completed": 1, "claimed": 2}';
    BEGIN
      IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'A Work record can never be removed'; END IF;
      IF NEW.id IS DISTINCT FROM OLD.id OR NEW.homestead_id IS DISTINCT FROM OLD.homestead_id
         OR NEW.creature_id IS DISTINCT FROM OLD.creature_id OR NEW.owner IS DISTINCT FROM OLD.owner
         OR NEW.trade IS DISTINCT FROM OLD.trade OR NEW.building_id IS DISTINCT FROM OLD.building_id
         OR NEW.duration_id IS DISTINCT FROM OLD.duration_id
         OR NEW.duration_seconds IS DISTINCT FROM OLD.duration_seconds
         OR NEW.started_at IS DISTINCT FROM OLD.started_at
         OR NEW.efficiency IS DISTINCT FROM OLD.efficiency OR NEW.hunger_state IS DISTINCT FROM OLD.hunger_state THEN
        RAISE EXCEPTION 'Who worked, where, when, for how long and how well can never change';
      END IF;
      IF (ranks ->> NEW.status)::int < (ranks ->> OLD.status)::int THEN
        RAISE EXCEPTION 'Work status only moves forward';
      END IF;
      IF OLD.rewards IS NOT NULL AND NEW.rewards IS DISTINCT FROM OLD.rewards THEN
        RAISE EXCEPTION 'Work rewards are rolled once and never change';
      END IF;
      IF EXISTS (
        SELECT 1 FROM jsonb_each(NEW.collected) e
        WHERE jsonb_typeof(e.value) <> 'number'
          OR (e.value #>> '{}')::numeric > COALESCE((NEW.rewards ->> e.key)::numeric, 0)
          OR (e.value #>> '{}')::numeric < COALESCE((OLD.collected ->> e.key)::numeric, 0)
      ) OR EXISTS (
        SELECT 1 FROM jsonb_each(OLD.collected) e WHERE NOT (NEW.collected ? e.key)
      ) THEN
        RAISE EXCEPTION 'Work can never pay out more than its reward, or take back what it paid';
      END IF;
      RETURN NEW;
    END $$ LANGUAGE plpgsql;
    DROP TRIGGER IF EXISTS creature_work_rules ON creature_work;
    CREATE TRIGGER creature_work_rules BEFORE UPDATE OR DELETE ON creature_work
      FOR EACH ROW EXECUTE FUNCTION creature_work_rules();
  `);

  // Storage is unlimited and homestead.ensureSchema has already raised every
  // Homestead's capacity: anything a Work finished under the old small limit
  // that did not fit goes home now, so no reward is ever stranded. A
  // read-then-update pass, idempotent: the first boot empties the legacy
  // pending, every later boot finds nothing.
  const legacy = (await db.query(
    `SELECT * FROM creature_work WHERE status = 'claimed'
       AND EXISTS (SELECT 1 FROM jsonb_each(rewards) e
                   WHERE (e.value #>> '{}')::numeric > COALESCE((collected ->> e.key)::numeric, 0))`
  )).rows;
  for (const row of legacy) {
    await inTransaction(db, async (client) => {
      const home = (await client.query('SELECT * FROM homesteads WHERE owner = $1 FOR UPDATE', [row.owner])).rows[0];
      const found = (await client.query('SELECT * FROM creature_work WHERE id = $1 FOR UPDATE', [row.id])).rows[0];
      if (!home || !found || !sum(pendingOf(found))) return;
      await moveIntoStorage(client, home, found);
    });
  }
  if (legacy.length) console.log(`[work] moved the rest of ${legacy.length} Work reward(s) home`);
}

function cryptoInt(min, max) {
  return crypto.randomInt(min, max + 1);
}

// The reward for `hours` of this Trade's Work: for each resource the Trade
// produces, one roll in its per-hour range for every hour worked, then the
// hunger efficiency (1 when omitted) with care-config's rounding rule.
// Base production + future modifiers (Training, Gear, Personality, Homestead
// and building level): hunger is the only one yet, and rarity is not one.
function rollRewards(tradeId, hours, randInt, efficiency) {
  const t = wcfg.trade(tradeId);
  if (!t) throw new WorkError('unknown_trade', 'This Creature has no Trade to work at.');
  const roll = randInt || cryptoInt;
  const rewards = {};
  for (const key of Object.keys(t.perHour)) {
    const [min, max] = t.perHour[key];
    let total = 0;
    for (let h = 0; h < hours; h++) total += roll(min, max);
    rewards[key] = care.applyEfficiency(total, efficiency == null ? 1 : Number(efficiency));
  }
  return rewards;
}

function endsAt(row) {
  return new Date(new Date(row.started_at).getTime() + row.duration_seconds * 1000);
}

// What is still owed to storage: rewards - collected, per resource.
function pendingOf(row) {
  const pending = {};
  if (!row.rewards) return pending;
  for (const r of hcfg.RESOURCES) {
    const left = (Number(row.rewards[r.key]) || 0) - (Number(row.collected && row.collected[r.key]) || 0);
    if (left > 0) pending[r.key] = left;
  }
  return pending;
}

function sum(amounts) {
  return Object.values(amounts).reduce((a, n) => a + (Number(n) || 0), 0);
}

// The Work as the page sees it at `now`. A working record whose time is up
// reads as completed even before it is settled (its rewards are then null
// until the owner next opens their Homestead).
function toWork(row, now) {
  const ends = endsAt(row);
  let status = row.status;
  if (status === 'working' && now.getTime() >= ends.getTime()) status = 'completed';
  const pending = pendingOf(row);
  return {
    workId: row.id,
    homesteadId: row.homestead_id,
    creatureId: row.creature_id,
    trade: row.trade,
    buildingId: row.building_id,
    durationId: row.duration_id,
    durationSeconds: row.duration_seconds,
    startedAt: new Date(row.started_at).toISOString(),
    endsAt: ends.toISOString(),
    status,
    efficiency: row.efficiency == null ? 1 : Number(row.efficiency),
    hungerState: row.hunger_state || null,
    rewards: row.rewards || null,
    collected: row.collected || {},
    pending,
    pendingTotal: sum(pending),
    claimedAt: row.claimed_at ? new Date(row.claimed_at).toISOString() : null,
  };
}

// Settle a locked Work record: once its time is up, roll its rewards (once)
// and mark it completed. Returns the record as stored afterwards.
async function settle(db, row, now, randInt) {
  if (row.status !== 'working' || now.getTime() < endsAt(row).getTime()) return row;
  const hours = row.duration_seconds / 3600;
  const rewards = rollRewards(row.trade, hours, randInt, row.efficiency);
  const { rows } = await db.query(
    `UPDATE creature_work SET status = 'completed', rewards = $2, completed_at = $3
     WHERE id = $1 AND status = 'working' RETURNING *`,
    [row.id, JSON.stringify(rewards), endsAt(row)]
  );
  return rows[0] || row;
}

// Move this Work's whole pending reward into storage: storage is unlimited,
// so everything fits. `home` is the locked homesteads row; returns
// { home, row, moved }.
async function moveIntoStorage(db, home, row) {
  const storage = hcfg.emptyStorage();
  for (const r of hcfg.RESOURCES) storage[r.key] = Number(home.storage && home.storage[r.key]) || 0;
  const pending = pendingOf(row);
  const collected = Object.assign({}, row.collected);
  const moved = {};
  for (const r of hcfg.RESOURCES) {
    const take = pending[r.key] || 0;
    if (take > 0) {
      storage[r.key] += take;
      collected[r.key] = (Number(collected[r.key]) || 0) + take;
      moved[r.key] = take;
    }
  }
  if (!Object.keys(moved).length) return { home, row, moved };
  const h = await db.query('UPDATE homesteads SET storage = $2 WHERE id = $1 RETURNING *', [home.id, JSON.stringify(storage)]);
  const w = await db.query('UPDATE creature_work SET collected = $2 WHERE id = $1 RETURNING *', [row.id, JSON.stringify(collected)]);
  return { home: h.rows[0], row: w.rows[0], moved };
}

function addInto(total, amounts) {
  for (const k of Object.keys(amounts)) total[k] = (total[k] || 0) + amounts[k];
  return total;
}

async function lockHome(db, walletId) {
  const { rows } = await db.query('SELECT * FROM homesteads WHERE owner = $1 FOR UPDATE', [walletId]);
  if (!rows[0]) throw new WorkError('no_homestead', 'Open your Homestead first.', 404);
  return rows[0];
}

// Send a Creature living in this wallet's Homestead to work at its Trade's
// building for one of the configured durations. buildingId is optional; when
// given it must be the Creature's own Trade building. Safe to repeat: while
// the Creature has unfinished Work, the same Work comes back with
// started: false and nothing new is made.
async function start(pool, walletId, { creatureId, durationId, buildingId }, now) {
  const d = wcfg.duration(durationId);
  if (!d) throw new WorkError('bad_duration', 'Choose how long to work.');
  return inTransaction(pool, async (db) => {
    // The Creature row first, then the Homestead (the order homestead.open,
    // Training and accepting a Contest use), so a Contest accepted at the same
    // moment waits for this start or this start waits for it.
    await db.query('SELECT id FROM creatures WHERE id = $1 FOR UPDATE', [creatureId]);
    // Locking the Homestead makes concurrent starts and collects wait in turn.
    const home = await lockHome(db, walletId);
    const c = await db.query('SELECT id, owner, trade, hunger, hunger_updated_at FROM creatures WHERE id = $1', [creatureId]);
    const creature = c.rows[0];
    if (!creature || creature.owner !== walletId || home.creature_id !== creature.id) {
      throw new WorkError('not_resident', 'Only a Creature living in your Homestead can work there.', 403);
    }
    const existing = await db.query("SELECT * FROM creature_work WHERE creature_id = $1 AND status <> 'claimed'", [creature.id]);
    if (existing.rows[0]) return { started: false, work: toWork(existing.rows[0], now) };
    if (await contestLocks.lockedContest(db, creature.id, now)) {
      throw new WorkError('in_contest', 'Creature is in a contest. Work unavailable.', 409);
    }

    const building = wcfg.buildingFor(creature.trade);
    if (!building) throw new WorkError('unknown_trade', 'This Creature has no Trade to work at.');
    if (buildingId != null && buildingId !== building) {
      throw new WorkError('wrong_building', 'A Creature can only work at the building of its own Trade.', 403);
    }
    const b = await db.query('SELECT unlocked FROM homestead_buildings WHERE homestead_id = $1 AND building_id = $2', [home.id, building]);
    if (!b.rows[0] || !b.rows[0].unlocked) throw new WorkError('building_locked', 'That building is locked.', 403);

    // How well it works: from its hunger as it sets off.
    const hunger = care.currentHunger(creature.hunger, creature.hunger_updated_at, now);
    const { rows } = await db.query(
      `INSERT INTO creature_work (homestead_id, creature_id, owner, trade, building_id, duration_id, duration_seconds, started_at,
         efficiency, hunger_state)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [home.id, creature.id, walletId, creature.trade, building, d.id, d.hours * 3600, now,
        care.efficiency(hunger), care.hungerState(hunger).id]
    );
    return { started: true, work: toWork(rows[0], now) };
  });
}

// Collect a finished Work into storage: it becomes claimed (its Creature is
// idle again) and its whole reward goes into storage. Collecting a claimed
// Work again only moves what is still pending, so it can never pay twice;
// since storage is unlimited there is normally nothing left to move.
async function collect(pool, walletId, workId, now, randInt) {
  return inTransaction(pool, async (db) => {
    const home = await lockHome(db, walletId);
    const found = await db.query('SELECT * FROM creature_work WHERE id = $1 AND homestead_id = $2 FOR UPDATE', [workId, home.id]);
    if (!found.rows[0]) throw new WorkError('not_found', 'No Work with that number in your Homestead.', 404);
    let row = await settle(db, found.rows[0], now, randInt);
    if (row.status === 'working') throw new WorkError('not_finished', 'This Work is not finished yet.', 409);
    const alreadyClaimed = row.status === 'claimed';
    if (!alreadyClaimed) {
      row = (await db.query(
        "UPDATE creature_work SET status = 'claimed', claimed_at = $2 WHERE id = $1 RETURNING *",
        [row.id, now]
      )).rows[0];
    }
    const result = await moveIntoStorage(db, home, row);
    return { alreadyClaimed, moved: result.moved, work: toWork(result.row, now) };
  });
}

// Move pending rewards of every claimed Work in this wallet's Homestead into
// storage, oldest first. Storage is unlimited, so collecting moves each
// reward whole and there is normally nothing left for this to move; it stays
// for the page's call and for anything still pending from before.
async function collectPending(pool, walletId, now) {
  return inTransaction(pool, async (db) => {
    let home = await lockHome(db, walletId);
    const { rows } = await db.query(
      "SELECT * FROM creature_work WHERE homestead_id = $1 AND status = 'claimed' ORDER BY id FOR UPDATE",
      [home.id]
    );
    const moved = {};
    for (const row of rows) {
      if (!sum(pendingOf(row))) continue;
      const result = await moveIntoStorage(db, home, row);
      home = result.home;
      addInto(moved, result.moved);
    }
    return { moved };
  });
}

// Work in one Homestead at `now`: its unfinished Work (one per Creature), the
// latest finished Work, and anything still pending on claimed Work (none
// since storage became unlimited, kept for the API).
// settle: true (the owner opening it) first rolls the rewards of Work whose
// time is up; false reads without changing anything.
async function overview(pool, homesteadId, now, opts) {
  const read = async (db) => {
    let active = (await db.query(
      `SELECT * FROM creature_work WHERE homestead_id = $1 AND status <> 'claimed' ORDER BY id${opts && opts.settle ? ' FOR UPDATE' : ''}`,
      [homesteadId]
    )).rows;
    if (opts && opts.settle) {
      const settled = [];
      for (const row of active) settled.push(await settle(db, row, now, opts.randInt));
      active = settled;
    }
    const history = (await db.query(
      "SELECT * FROM creature_work WHERE homestead_id = $1 AND status = 'claimed' ORDER BY claimed_at DESC, id DESC LIMIT $2",
      [homesteadId, wcfg.HISTORY_LIMIT]
    )).rows;
    // Pending can sit on claimed Work older than the history shows.
    const waiting = (await db.query(
      `SELECT * FROM creature_work WHERE homestead_id = $1 AND status = 'claimed'
         AND EXISTS (SELECT 1 FROM jsonb_each(rewards) e
                     WHERE (e.value #>> '{}')::numeric > COALESCE((collected ->> e.key)::numeric, 0))`,
      [homesteadId]
    )).rows;
    const pending = waiting.reduce((total, row) => addInto(total, pendingOf(row)), {});
    return {
      serverNow: now.toISOString(),
      active: active.map((row) => toWork(row, now)),
      history: history.map((row) => toWork(row, now)),
      pending,
      pendingTotal: sum(pending),
    };
  };
  return opts && opts.settle ? inTransaction(pool, read) : read(pool);
}

module.exports = { WorkError, ensureSchema, rollRewards, start, collect, collectPending, overview, toWork };
