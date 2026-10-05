// HOMESTEAD Contests: one player challenges another, each with one of their
// own Creatures, and the server resolves a trick-off between them once.
//
// Balance and the formulas are in public/js/contest-config.js. The rules the
// tables, triggers and these transactions enforce:
// - A challenge (contest_challenges) is from one wallet to a DIFFERENT wallet
//   (a CHECK), with one of the challenger's Creatures. Its status moves once,
//   PENDING -> ACCEPTED | DECLINED | EXPIRED | CANCELLED, and then the row is
//   frozen (a trigger). Accept, decline and cancel each lock the challenge
//   row first, so two tabs, or a cancel and an accept at the same moment,
//   end in exactly one of those states: the later request is refused.
// - Accepting creates the one Contest for that challenge (contests.challenge_id
//   is UNIQUE), between two different wallets and two different Creatures
//   (CHECKs), each owned by its player, neither Working nor in another
//   Contest. Both Creature rows are locked (lowest id first) while that is
//   checked. Each Creature gets a contest_creature_locks row; its primary key
//   keeps a Creature out of two Contests at once.
// - The Contest saves a snapshot of both Creatures as they are at accept
//   (base stats, training, Gear, effective stats, condition, Gear ids). It is
//   resolved from those snapshots only, never from the live Creatures.
// - It runs CONTEST_DURATION_SECONDS. The first request after that (either
//   player opening it, or a list, or a new challenge for one of its Creatures)
//   resolves it under a lock on the Contest row: the tricks, show-stoppers,
//   winner and log are rolled once and stored, the rewards are credited and
//   the locks released, all in one transaction. A completed Contest is frozen
//   (a trigger) and can never be resolved again; both players read the same
//   stored result.
// - Rewards go through creditStead (type CONTEST_REWARD) with the key
//   CONTEST-<id>, unique per (wallet, type, key), so each wallet is paid once
//   per Contest however many tabs, refreshes or retries arrive.
// - A Contest never changes who owns a Creature, and never creates, copies,
//   deletes or changes one: it only reads them.
const crypto = require('crypto');
const cfg = require('../public/js/contest-config');
const creaturesLib = require('./creatures');
const care = require('./care');
const stead = require('./stead');
const contestLocks = require('./contest-locks');
const { inTransaction } = require('./homestead');

class ContestError extends Error {
  constructor(code, message, status) {
    super(message);
    this.code = code;
    this.status = status || 400;
  }
}

function sqlList(values) {
  return values.map((v) => `'${String(v).replace(/'/g, "''")}'`).join(', ');
}

// Runs after creatures, care and stead have their tables.
async function ensureSchema(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS contest_challenges (
      id SERIAL PRIMARY KEY,
      challenger_wallet TEXT NOT NULL,
      challenger_username TEXT,
      challenger_creature_id INT NOT NULL REFERENCES creatures (id),
      opponent_wallet TEXT NOT NULL,
      opponent_username TEXT,
      status TEXT NOT NULL DEFAULT 'PENDING',
      created_at TIMESTAMPTZ NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      accepted_at TIMESTAMPTZ,
      responded_at TIMESTAMPTZ,
      contest_id INT,
      CHECK (challenger_wallet <> opponent_wallet)
    );
    ALTER TABLE contest_challenges DROP CONSTRAINT IF EXISTS contest_challenges_status;
    ALTER TABLE contest_challenges ADD CONSTRAINT contest_challenges_status
      CHECK (status IN (${sqlList(cfg.CHALLENGE_STATUSES)}));
    CREATE UNIQUE INDEX IF NOT EXISTS contest_challenges_one_pending
      ON contest_challenges (challenger_creature_id, opponent_wallet) WHERE status = 'PENDING';
    CREATE INDEX IF NOT EXISTS contest_challenges_by_opponent ON contest_challenges (opponent_wallet, id DESC);
    CREATE INDEX IF NOT EXISTS contest_challenges_by_challenger ON contest_challenges (challenger_wallet, id DESC);

    CREATE TABLE IF NOT EXISTS contests (
      id SERIAL PRIMARY KEY,
      challenge_id INT NOT NULL UNIQUE REFERENCES contest_challenges (id),
      player_a TEXT NOT NULL,
      player_b TEXT NOT NULL,
      player_a_username TEXT,
      player_b_username TEXT,
      creature_a_id INT NOT NULL REFERENCES creatures (id),
      creature_b_id INT NOT NULL REFERENCES creatures (id),
      status TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL,
      started_at TIMESTAMPTZ NOT NULL,
      ends_at TIMESTAMPTZ NOT NULL,
      completed_at TIMESTAMPTZ,
      current_turn TEXT,
      turn_number INT NOT NULL DEFAULT 0,
      winner_creature_id INT,
      loser_creature_id INT,
      winner_player TEXT,
      loser_player TEXT,
      snapshot_a JSONB NOT NULL,
      snapshot_b JSONB NOT NULL,
      log JSONB NOT NULL DEFAULT '[]'::jsonb,
      result JSONB,
      reward_status TEXT NOT NULL DEFAULT 'PENDING' CHECK (reward_status IN ('PENDING', 'PAID')),
      CHECK (player_a <> player_b),
      CHECK (creature_a_id <> creature_b_id)
    );
    ALTER TABLE contests DROP CONSTRAINT IF EXISTS contests_status;
    ALTER TABLE contests ADD CONSTRAINT contests_status CHECK (status IN (${sqlList(cfg.CONTEST_STATUSES)}));
    CREATE INDEX IF NOT EXISTS contests_by_player_a ON contests (player_a, id DESC);
    CREATE INDEX IF NOT EXISTS contests_by_player_b ON contests (player_b, id DESC);
    CREATE INDEX IF NOT EXISTS contests_active ON contests (ends_at) WHERE status = 'ACTIVE';

    CREATE TABLE IF NOT EXISTS contest_creature_locks (
      creature_id INT PRIMARY KEY REFERENCES creatures (id),
      contest_id INT NOT NULL REFERENCES contests (id),
      locked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE OR REPLACE FUNCTION homestead_challenge_rules() RETURNS trigger AS $$
    BEGIN
      IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'A challenge can never be removed'; END IF;
      IF OLD.status <> 'PENDING' THEN RAISE EXCEPTION 'An answered challenge can never change'; END IF;
      IF NEW.id IS DISTINCT FROM OLD.id OR NEW.challenger_wallet IS DISTINCT FROM OLD.challenger_wallet
         OR NEW.challenger_creature_id IS DISTINCT FROM OLD.challenger_creature_id
         OR NEW.opponent_wallet IS DISTINCT FROM OLD.opponent_wallet
         OR NEW.created_at IS DISTINCT FROM OLD.created_at OR NEW.expires_at IS DISTINCT FROM OLD.expires_at THEN
        RAISE EXCEPTION 'Who a challenge is between can never change';
      END IF;
      RETURN NEW;
    END $$ LANGUAGE plpgsql;
    DROP TRIGGER IF EXISTS contest_challenges_rules ON contest_challenges;
    CREATE TRIGGER contest_challenges_rules BEFORE UPDATE OR DELETE ON contest_challenges
      FOR EACH ROW EXECUTE FUNCTION homestead_challenge_rules();

    CREATE OR REPLACE FUNCTION homestead_contest_rules() RETURNS trigger AS $$
    BEGIN
      IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'A contest can never be removed'; END IF;
      IF OLD.status IN ('COMPLETED', 'CANCELLED') THEN RAISE EXCEPTION 'A finished contest can never change'; END IF;
      IF NEW.id IS DISTINCT FROM OLD.id OR NEW.challenge_id IS DISTINCT FROM OLD.challenge_id
         OR NEW.player_a IS DISTINCT FROM OLD.player_a OR NEW.player_b IS DISTINCT FROM OLD.player_b
         OR NEW.creature_a_id IS DISTINCT FROM OLD.creature_a_id OR NEW.creature_b_id IS DISTINCT FROM OLD.creature_b_id
         OR NEW.snapshot_a IS DISTINCT FROM OLD.snapshot_a OR NEW.snapshot_b IS DISTINCT FROM OLD.snapshot_b
         OR NEW.started_at IS DISTINCT FROM OLD.started_at OR NEW.ends_at IS DISTINCT FROM OLD.ends_at THEN
        RAISE EXCEPTION 'Who and what a contest is between can never change';
      END IF;
      RETURN NEW;
    END $$ LANGUAGE plpgsql;
    DROP TRIGGER IF EXISTS contests_rules ON contests;
    CREATE TRIGGER contests_rules BEFORE UPDATE OR DELETE ON contests
      FOR EACH ROW EXECUTE FUNCTION homestead_contest_rules();
  `);
}

// ── Reading ───────────────────────────────────────────────────────────────

const WALLET = /^ut1[A-Za-z0-9]{4,120}$/;
const USERNAME = /^@?([A-Za-z0-9_.-]{1,40})$/;

function iso(t) { return t ? new Date(t).toISOString() : null; }

// What a list shows of a Creature: never its live stats.
function summary(c) {
  if (!c) return null;
  return {
    creatureId: c.creatureId, name: c.name, species: c.species, rarity: c.rarity,
    level: c.level, appearance: c.appearance,
  };
}

async function creatureSummaries(db, ids) {
  const out = {};
  if (!ids.length) return out;
  const { rows } = await db.query('SELECT * FROM creatures WHERE id = ANY($1::int[])', [ids]);
  for (const row of rows) out[row.id] = summary(creaturesLib.toCreature(row));
  return out;
}

function toChallenge(row, creatures, now) {
  const expired = row.status === 'PENDING' && new Date(row.expires_at).getTime() <= now.getTime();
  return {
    challengeId: row.id,
    challengerWallet: row.challenger_wallet,
    challengerUsername: row.challenger_username,
    challengerCreatureId: row.challenger_creature_id,
    challengerCreature: creatures[row.challenger_creature_id] || null,
    opponentWallet: row.opponent_wallet,
    opponentUsername: row.opponent_username,
    status: expired ? 'EXPIRED' : row.status,
    createdAt: iso(row.created_at),
    expiresAt: iso(row.expires_at),
    acceptedAt: iso(row.accepted_at),
    respondedAt: iso(row.responded_at),
    contestId: row.contest_id,
  };
}

// A Contest as everyone sees it: the stored snapshots, log and result.
// `full` adds the log and the snapshots' stats (the detail screen).
function toContest(row, full) {
  const snap = (s) => (full ? s : {
    creatureId: s.creatureId, name: s.name, species: s.species, rarity: s.rarity,
    level: s.level, appearance: s.appearance, owner: s.owner,
  });
  const out = {
    contestId: row.id,
    code: cfg.formatId(row.id),
    challengeId: row.challenge_id,
    status: row.status,
    playerA: row.player_a,
    playerB: row.player_b,
    playerAUsername: row.player_a_username,
    playerBUsername: row.player_b_username,
    creatureAId: row.creature_a_id,
    creatureBId: row.creature_b_id,
    createdAt: iso(row.created_at),
    startedAt: iso(row.started_at),
    endsAt: iso(row.ends_at),
    completedAt: iso(row.completed_at),
    currentTurn: row.current_turn,
    turnNumber: row.turn_number,
    winnerCreatureId: row.winner_creature_id,
    loserCreatureId: row.loser_creature_id,
    winnerPlayer: row.winner_player,
    loserPlayer: row.loser_player,
    rewardStatus: row.reward_status,
    result: row.result || null,
    snapshotA: snap(row.snapshot_a),
    snapshotB: snap(row.snapshot_b),
  };
  if (full) out.log = row.log || [];
  return out;
}

// ── Resolving ─────────────────────────────────────────────────────────────

function randomUnit() {
  return crypto.randomInt(0, 2 ** 32) / 2 ** 32;
}

// The trick-off between two snapshots. Pure: the same snapshots and the same
// rng give the same Contest. Returns everything that is stored.
function resolve(a, b, rng) {
  rng = rng || randomUnit;
  const snaps = { a, b };
  const other = (side) => (side === 'a' ? 'b' : 'a');
  const stamina = { a: a.effectiveStats.hp, b: b.effectiveStats.hp };
  const scored = { a: 0, b: 0 };
  const crits = { a: 0, b: 0 };
  const first = cfg.firstMover(a, b);
  const log = [{
    turn: 0, kind: 'first', actor: first,
    text: snaps[first].name + ' goes first.',
  }];
  let actor = first;
  let turn = 0;
  while (stamina.a > 0 && stamina.b > 0 && turn < cfg.MAX_TURNS) {
    turn++;
    const rival = other(actor);
    const crit = rng() < cfg.critChance(snaps[actor].effectiveStats.luck);
    const points = cfg.trickPoints(snaps[actor], snaps[rival], crit);
    stamina[rival] = Math.max(0, stamina[rival] - points);
    scored[actor] += points;
    if (crit) crits[actor]++;
    log.push({
      turn, kind: crit ? 'crit' : 'trick', actor, rival, points, crit, staminaLeft: stamina[rival],
      text: crit
        ? snaps[actor].name + ' pulls off a show-stopper! ' + snaps[rival].name + ' keeps up: -' + points + ' Stamina.'
        : snaps[actor].name + ' shows off a trick. ' + snaps[rival].name + ' keeps up: -' + points + ' Stamina.',
    });
    actor = rival;
  }
  // Out of Stamina loses. (The safety stop: more Stamina left wins, then
  // whoever went first.)
  let winner;
  if (stamina.a <= 0) winner = 'b';
  else if (stamina.b <= 0) winner = 'a';
  else winner = stamina.a / a.effectiveStats.hp >= stamina.b / b.effectiveStats.hp ? 'a' : first;
  const loser = other(winner);
  log.push({ turn, kind: 'out', actor: loser, text: snaps[loser].name + ' runs out of Stamina.' });
  log.push({ turn, kind: 'win', actor: winner, text: String(snaps[winner].name).toUpperCase() + ' WINS.' });
  return {
    first, winner, loser, turns: turn, log,
    points: scored, crits, staminaLeft: stamina,
    rewards: { [winner]: cfg.WIN_REWARD, [loser]: cfg.LOSS_REWARD },
  };
}

// Resolve this Contest if it is ACTIVE and its time is up, inside the caller's
// transaction: lock it, roll it once, pay both players once, release the
// Creatures. Anything else is returned as it is.
async function settleIn(db, contestId, now, rng) {
  const { rows } = await db.query('SELECT * FROM contests WHERE id = $1 FOR UPDATE', [contestId]);
  const row = rows[0];
  if (!row || row.status !== 'ACTIVE' || new Date(row.ends_at).getTime() > now.getTime()) return row || null;
  const r = resolve(row.snapshot_a, row.snapshot_b, rng);
  const player = { a: row.player_a, b: row.player_b };
  const creature = { a: row.creature_a_id, b: row.creature_b_id };
  const key = cfg.formatId(row.id);
  // Two wallets, always credited in the same order, so two resolutions
  // sharing a wallet can never wait on each other.
  for (const side of ['a', 'b'].sort((x, y) => (player[x] < player[y] ? -1 : 1))) {
    try {
      await stead.creditStead(db, player[side], r.rewards[side], 'CONTEST_REWARD', {
        contestId: row.id, contest: key, result: side === r.winner ? 'WIN' : 'LOSS', creatureId: creature[side],
      }, { key });
    } catch (err) {
      if (err.code !== 'duplicate_entry') throw err; // already paid: never twice
    }
  }
  await db.query('DELETE FROM contest_creature_locks WHERE contest_id = $1', [row.id]);
  const updated = await db.query(
    `UPDATE contests SET status = 'COMPLETED', completed_at = ends_at, current_turn = NULL, turn_number = $2,
       winner_creature_id = $3, loser_creature_id = $4, winner_player = $5, loser_player = $6,
       log = $7, result = $8, reward_status = 'PAID'
     WHERE id = $1 RETURNING *`,
    [row.id, r.turns, creature[r.winner], creature[r.loser], player[r.winner], player[r.loser],
      JSON.stringify(r.log), JSON.stringify({
        first: r.first, winner: r.winner, loser: r.loser, turns: r.turns,
        points: r.points, crits: r.crits, staminaLeft: r.staminaLeft, rewards: r.rewards,
      })]
  );
  return updated.rows[0];
}

// Resolve every Contest whose time is up that involves this wallet (or these
// Creatures), each in its own transaction.
async function settleDue(pool, now, { wallet, creatureIds } = {}, rng) {
  const { rows } = await pool.query(
    `SELECT id FROM contests WHERE status = 'ACTIVE' AND ends_at <= $1
       AND (player_a = $2 OR player_b = $2 OR creature_a_id = ANY($3::int[]) OR creature_b_id = ANY($3::int[]))
     ORDER BY id`,
    [now, wallet || '', creatureIds || []]
  );
  for (const { id } of rows) await inTransaction(pool, (db) => settleIn(db, id, now, rng));
  return rows.length;
}

// Mark this wallet's PENDING challenges whose time is up as EXPIRED.
async function expireDue(db, wallet, now) {
  await db.query(
    `UPDATE contest_challenges SET status = 'EXPIRED', responded_at = expires_at
     WHERE status = 'PENDING' AND expires_at <= $1 AND (challenger_wallet = $2 OR opponent_wallet = $2)`,
    [now, wallet]
  );
}

// ── The Creature's availability ───────────────────────────────────────────

// 'ready' | 'working' | 'in_contest' for one Creature at `now`.
async function availability(db, creatureId, now) {
  const locked = await contestLocks.lockedContest(db, creatureId, now);
  if (locked) return { status: 'in_contest', contestId: locked.contestId, endsAt: locked.endsAt };
  const working = await care.workingNow(db, creatureId, now);
  if (working) return { status: 'working', workEndsAt: working.endsAt };
  return { status: 'ready' };
}

// Refuse a Creature that is Working or in a running Contest. A Contest of
// its whose time is up is resolved first (inside this transaction).
async function assertFree(db, row, now, rng) {
  const lock = (await db.query('SELECT contest_id FROM contest_creature_locks WHERE creature_id = $1', [row.id])).rows[0];
  if (lock) {
    const settled = await settleIn(db, lock.contest_id, now, rng);
    if (settled && settled.status === 'ACTIVE') throw new ContestError('in_contest', contestLocks.IN_CONTEST_MESSAGE, 409);
  }
  if (await care.workingNow(db, row.id, now)) {
    throw new ContestError('working', (row.name || 'This Creature') + ' is working. Contests unavailable until it is back.', 409);
  }
}

// ── Challenges ────────────────────────────────────────────────────────────

// The wallet a typed opponent names: a wallet address as it is, or a Homeroom
// username through `lookup` (the platform's user directory: handle ->
// { found, user: { id, username } }), then the wallet that user used Genesis
// with and that owns a Creature. Answers { wallet, username }.
async function resolveOpponent(db, raw, lookup) {
  const text = String(raw == null ? '' : raw).trim();
  if (!text) throw new ContestError('no_opponent', 'Who do you want to challenge?');
  if (WALLET.test(text)) return { wallet: text, username: null };
  const m = USERNAME.exec(text);
  if (!m) throw new ContestError('bad_opponent', 'Enter a Homeroom username or a wallet address.');
  let found;
  try {
    found = lookup ? await lookup(m[1]) : null;
  } catch (err) {
    found = null;
  }
  if (!found) throw new ContestError('lookup_unavailable', 'Couldn\'t look up that player right now. Try their wallet address.', 503);
  if (!found.found || !found.user) throw new ContestError('no_player', 'No Homeroom player is called @' + m[1] + '.', 404);
  const { rows } = await db.query(
    `SELECT c.owner FROM genesis_wallets g JOIN creatures c ON c.owner = g.wallet_id
     WHERE g.user_id = $1 AND c.gene IS NOT NULL ORDER BY c.id LIMIT 1`,
    [String(found.user.id)]
  );
  if (!rows[0]) throw new ContestError('no_creature', '@' + found.user.username + ' has no Creature yet.', 404);
  return { wallet: rows[0].owner, username: found.user.username };
}

// Challenge another player with one of this wallet's Creatures, at `now`.
async function challenge(pool, wallet, username, { creatureId, opponent }, now, lookup) {
  if (!wallet) throw new ContestError('no_wallet', 'Link a wallet to your Homeroom account first.');
  if (!Number.isInteger(creatureId) || creatureId < 1) throw new ContestError('bad_creature', 'Choose your Creature.');
  const opp = await resolveOpponent(pool, opponent, lookup);
  if (opp.wallet === wallet) throw new ContestError('self', 'You cannot compete against yourself.');
  await settleDue(pool, now, { creatureIds: [creatureId] });
  return inTransaction(pool, async (db) => {
    const row = (await db.query('SELECT * FROM creatures WHERE id = $1 FOR UPDATE', [creatureId])).rows[0];
    if (!row || !row.gene) throw new ContestError('not_found', 'No Creature has that ID.', 404);
    if (row.owner !== wallet) throw new ContestError('not_yours', 'Choose one of your own Creatures.', 403);
    await assertFree(db, row, now);
    const hasCreature = await db.query('SELECT 1 FROM creatures WHERE owner = $1 AND gene IS NOT NULL LIMIT 1', [opp.wallet]);
    if (!hasCreature.rows.length) throw new ContestError('no_creature', 'That player has no Creature yet.', 404);
    await db.query(
      `UPDATE contest_challenges SET status = 'EXPIRED', responded_at = expires_at
       WHERE status = 'PENDING' AND expires_at <= $1 AND challenger_creature_id = $2 AND opponent_wallet = $3`,
      [now, creatureId, opp.wallet]
    );
    let inserted;
    try {
      inserted = await db.query(
        `INSERT INTO contest_challenges (challenger_wallet, challenger_username, challenger_creature_id,
           opponent_wallet, opponent_username, created_at, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [wallet, username || null, creatureId, opp.wallet, opp.username, now,
          new Date(now.getTime() + cfg.CHALLENGE_EXPIRES_HOURS * 3600 * 1000)]
      );
    } catch (err) {
      if (err.code === '23505') throw new ContestError('already_challenged', 'You already challenged that player with this Creature.', 409);
      throw err;
    }
    const creatures = await creatureSummaries(db, [creatureId]);
    return { challenge: toChallenge(inserted.rows[0], creatures, now) };
  });
}

async function lockChallenge(db, challengeId) {
  if (!Number.isInteger(challengeId) || challengeId < 1) throw new ContestError('not_found', 'No challenge has that number.', 404);
  const { rows } = await db.query('SELECT * FROM contest_challenges WHERE id = $1 FOR UPDATE', [challengeId]);
  if (!rows[0]) throw new ContestError('not_found', 'No challenge has that number.', 404);
  return rows[0];
}

const ANSWERED = {
  ACCEPTED: 'This challenge was already accepted.',
  DECLINED: 'This challenge was already declined.',
  EXPIRED: 'This challenge has expired.',
  CANCELLED: 'This challenge was cancelled.',
};

function assertPending(ch, now) {
  if (ch.status !== 'PENDING') throw new ContestError('already_answered', ANSWERED[ch.status], 409);
  if (new Date(ch.expires_at).getTime() <= now.getTime()) throw new ContestError('already_answered', ANSWERED.EXPIRED, 409);
}

// The opponent accepts with one of their own Creatures: the Contest starts.
// opts.contestId is used only by the staging seed, for a fixed number.
async function accept(pool, wallet, username, challengeId, creatureId, now, opts) {
  if (!wallet) throw new ContestError('no_wallet', 'Link a wallet to your Homeroom account first.');
  if (!Number.isInteger(creatureId) || creatureId < 1) throw new ContestError('bad_creature', 'Choose your Creature.');
  const rng = opts && opts.rng;
  return inTransaction(pool, async (db) => {
    const ch = await lockChallenge(db, challengeId);
    if (ch.challenger_wallet === wallet) throw new ContestError('self', 'You cannot compete against yourself.', 403);
    if (ch.opponent_wallet !== wallet) throw new ContestError('not_yours', 'This challenge is for another player.', 403);
    assertPending(ch, now);
    if (creatureId === ch.challenger_creature_id) throw new ContestError('not_yours', 'Choose one of your own Creatures.', 403);

    // Both Creature rows, lowest id first.
    const ids = [ch.challenger_creature_id, creatureId].sort((x, y) => x - y);
    const locked = {};
    for (const id of ids) {
      const r = (await db.query('SELECT * FROM creatures WHERE id = $1 FOR UPDATE', [id])).rows[0];
      if (r) locked[id] = r;
    }
    const mine = locked[creatureId];
    const theirs = locked[ch.challenger_creature_id];
    if (!mine || !mine.gene) throw new ContestError('not_found', 'No Creature has that ID.', 404);
    if (mine.owner !== wallet) throw new ContestError('not_yours', 'Choose one of your own Creatures.', 403);
    if (!theirs || theirs.owner !== ch.challenger_wallet) {
      throw new ContestError('challenger_gone', 'The challenger no longer has that Creature.', 409);
    }
    if (mine.owner === theirs.owner) throw new ContestError('self', 'You cannot compete against yourself.', 403);
    await assertFree(db, theirs, now, rng);
    await assertFree(db, mine, now, rng);

    // The snapshots: everything the Contest will ever read about them.
    const snapshot = async (id) => {
      const c = await creaturesLib.getById(db, id, now);
      return {
        creatureId: c.creatureId, owner: c.owner, name: c.name, species: c.species, rarity: c.rarity,
        level: c.level, appearance: c.appearance,
        baseStats: c.stats, trainingBonus: c.trainingBonus, gearBonus: c.gearBonus, effectiveStats: c.effectiveStats,
        condition: c.care.condition, conditionMultiplier: cfg.conditionMultiplier(c.care.condition),
        gearIds: Object.values(c.gear).filter(Boolean).map((g) => g.gearId),
        takenAt: now.toISOString(),
      };
    };
    const snapA = await snapshot(theirs.id);
    const snapB = await snapshot(mine.id);
    const ends = new Date(now.getTime() + cfg.CONTEST_DURATION_SECONDS * 1000);
    const forcedId = opts && Number.isInteger(opts.contestId) ? opts.contestId : null;
    const params = [ch.id, ch.challenger_wallet, wallet, ch.challenger_username, username || null,
      theirs.id, mine.id, now, ends, JSON.stringify(snapA), JSON.stringify(snapB)];
    if (forcedId) params.push(forcedId);
    const inserted = await db.query(
      `INSERT INTO contests (${forcedId ? 'id, ' : ''}challenge_id, player_a, player_b, player_a_username, player_b_username,
         creature_a_id, creature_b_id, status, created_at, started_at, ends_at, snapshot_a, snapshot_b)
       VALUES (${forcedId ? '$12, ' : ''}$1, $2, $3, $4, $5, $6, $7, 'ACTIVE', $8, $8, $9, $10, $11) RETURNING *`,
      params
    );
    const contest = inserted.rows[0];
    try {
      await db.query(
        'INSERT INTO contest_creature_locks (creature_id, contest_id, locked_at) VALUES ($1, $3, $4), ($2, $3, $4)',
        [theirs.id, mine.id, contest.id, now]
      );
    } catch (err) {
      if (err.code === '23505') throw new ContestError('in_contest', contestLocks.IN_CONTEST_MESSAGE, 409);
      throw err;
    }
    await db.query(
      `UPDATE contest_challenges SET status = 'ACCEPTED', accepted_at = $2, responded_at = $2, contest_id = $3,
         opponent_username = COALESCE($4, opponent_username)
       WHERE id = $1`,
      [ch.id, now, contest.id, username || null]
    );
    return { contest: toContest(contest, true) };
  });
}

// The opponent declines, or the challenger cancels: once, while PENDING.
async function answer(pool, wallet, challengeId, now, as) {
  if (!wallet) throw new ContestError('no_wallet', 'Link a wallet to your Homeroom account first.');
  return inTransaction(pool, async (db) => {
    const ch = await lockChallenge(db, challengeId);
    const party = as === 'DECLINED' ? ch.opponent_wallet : ch.challenger_wallet;
    if (party !== wallet) {
      throw new ContestError('not_yours', as === 'DECLINED' ? 'This challenge is for another player.' : 'Only the challenger can cancel it.', 403);
    }
    assertPending(ch, now);
    const { rows } = await db.query(
      'UPDATE contest_challenges SET status = $2, responded_at = $3 WHERE id = $1 RETURNING *',
      [ch.id, as, now]
    );
    const creatures = await creatureSummaries(db, [ch.challenger_creature_id]);
    return { challenge: toChallenge(rows[0], creatures, now) };
  });
}

function decline(pool, wallet, challengeId, now) { return answer(pool, wallet, challengeId, now, 'DECLINED'); }
function cancel(pool, wallet, challengeId, now) { return answer(pool, wallet, challengeId, now, 'CANCELLED'); }

// ── What the page shows ───────────────────────────────────────────────────

// One Contest by its number, resolved first if its time is up. Anyone can
// read it: it is the same stored result for both players.
async function getContest(pool, contestId, now) {
  if (!Number.isInteger(contestId) || contestId < 1) return null;
  await inTransaction(pool, (db) => settleIn(db, contestId, now));
  const { rows } = await pool.query('SELECT * FROM contests WHERE id = $1', [contestId]);
  return rows[0] ? toContest(rows[0], true) : null;
}

// Everything the Contests screen needs for this wallet: incoming and sent
// challenges, running Contests, the latest finished ones, and its Creatures
// with whether each is free.
async function overview(pool, wallet, now) {
  if (!wallet) return { walletId: null, incoming: [], outgoing: [], active: [], history: [], creatures: [], serverNow: now.toISOString() };
  await expireDue(pool, wallet, now);
  await settleDue(pool, now, { wallet });
  const incoming = (await pool.query(
    "SELECT * FROM contest_challenges WHERE opponent_wallet = $1 AND status = 'PENDING' ORDER BY id DESC LIMIT 50",
    [wallet]
  )).rows;
  const outgoing = (await pool.query(
    `SELECT * FROM contest_challenges WHERE challenger_wallet = $1
       AND (status = 'PENDING' OR responded_at > $2) ORDER BY id DESC LIMIT 20`,
    [wallet, new Date(now.getTime() - 24 * 3600 * 1000)]
  )).rows;
  const contestRows = async (where, limit) => (await pool.query(
    `SELECT * FROM contests WHERE (player_a = $1 OR player_b = $1) AND ${where} ORDER BY id DESC LIMIT ${Number(limit)}`,
    [wallet]
  )).rows;
  const active = await contestRows("status = 'ACTIVE'", 50);
  const history = await contestRows("status = 'COMPLETED'", cfg.HISTORY_LIMIT);
  const creatures = await creatureSummaries(pool, Array.from(new Set(incoming.concat(outgoing).map((r) => r.challenger_creature_id))));
  const owned = await creaturesLib.listOwned(pool, wallet, now);
  const mine = [];
  for (const c of owned) {
    if (!c.gene) continue;
    mine.push(Object.assign(summary(c), {
      condition: c.care ? c.care.condition : null,
      effectiveStats: c.effectiveStats,
      availability: await availability(pool, c.creatureId, now),
    }));
  }
  return {
    walletId: wallet,
    incoming: incoming.map((r) => toChallenge(r, creatures, now)),
    outgoing: outgoing.map((r) => toChallenge(r, creatures, now)),
    active: active.map((r) => toContest(r, false)),
    history: history.map((r) => toContest(r, false)),
    creatures: mine,
    serverNow: now.toISOString(),
  };
}

module.exports = {
  ContestError, ensureSchema, resolve, settleIn, settleDue, availability, resolveOpponent,
  challenge, accept, decline, cancel, getContest, overview, toContest,
};
