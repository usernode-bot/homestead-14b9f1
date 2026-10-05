// HOMESTEAD STEAD Points: the one internal gameplay currency, its ledger, and
// Daily Check-in.
//
// Balance and rules live in public/js/stead-config.js. The rules the tables,
// trigger and these transactions enforce:
// - Each wallet has at most one stead_accounts row: its balance (never below
//   0, a CHECK) and its check-in streak. A wallet with no row has 0 STEAD;
//   reading never creates one.
// - Every change to a balance is one stead_ledger entry (owner, type, amount,
//   balance_after, created_at, metadata), written in the same transaction
//   that changes the balance, under a lock on the account row. Income is a
//   positive amount, an expense a negative one. The ledger is append-only (a
//   trigger), so the sum of a wallet's entries is always its balance.
// - creditStead and debitStead are the only way to change a balance.
//   Nothing else writes stead_accounts.balance or stead_ledger.
// - An entry may carry a key that is unique per (owner, type): Daily
//   Check-in uses the game-timezone date, so one wallet can only ever check
//   in once per calendar day, however many clicks, tabs or retries arrive.
// - STEAD is not on-chain. Nothing here is a blockchain transaction.
const cfg = require('../public/js/stead-config');
const { inTransaction } = require('./homestead');

class SteadError extends Error {
  constructor(code, message, status) {
    super(message);
    this.code = code;
    this.status = status || 400;
  }
}

async function ensureSchema(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS stead_accounts (
      owner TEXT PRIMARY KEY,
      balance BIGINT NOT NULL DEFAULT 0 CHECK (balance >= 0),
      current_streak INT NOT NULL DEFAULT 0 CHECK (current_streak >= 0),
      cycle_day INT NOT NULL DEFAULT 0 CHECK (cycle_day >= 0),
      last_claim_date DATE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS stead_ledger (
      id BIGSERIAL PRIMARY KEY,
      owner TEXT NOT NULL REFERENCES stead_accounts (owner),
      type TEXT NOT NULL,
      amount BIGINT NOT NULL CHECK (amount <> 0),
      balance_after BIGINT NOT NULL CHECK (balance_after >= 0),
      entry_key TEXT,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS stead_ledger_once_per_key
      ON stead_ledger (owner, type, entry_key) WHERE entry_key IS NOT NULL;
    CREATE INDEX IF NOT EXISTS stead_ledger_by_owner ON stead_ledger (owner, id DESC);

    CREATE OR REPLACE FUNCTION stead_ledger_append_only() RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION 'A STEAD ledger entry can never be changed or removed';
    END $$ LANGUAGE plpgsql;
    DROP TRIGGER IF EXISTS stead_ledger_append_only ON stead_ledger;
    CREATE TRIGGER stead_ledger_append_only BEFORE UPDATE OR DELETE ON stead_ledger
      FOR EACH ROW EXECUTE FUNCTION stead_ledger_append_only();
  `);
}

// A checked-out client (inside inTransaction) has release(); the pool does not.
function withTransaction(db, fn) {
  return typeof db.release === 'function' ? fn(db) : inTransaction(db, fn);
}

// Create the wallet's account if needed, then lock it for this transaction.
async function lockAccount(db, owner) {
  await db.query('INSERT INTO stead_accounts (owner) VALUES ($1) ON CONFLICT (owner) DO NOTHING', [owner]);
  const r = await db.query(
    `SELECT owner, balance::float8 AS balance, current_streak, cycle_day,
            to_char(last_claim_date, 'YYYY-MM-DD') AS last_claim_date
     FROM stead_accounts WHERE owner = $1 FOR UPDATE`,
    [owner]
  );
  return r.rows[0];
}

function toEntry(row) {
  const t = cfg.type(row.type);
  return {
    id: Number(row.id),
    owner: row.owner,
    type: row.type,
    label: t ? t.label : row.type,
    amount: Number(row.amount),
    balanceAfter: Number(row.balance_after),
    timestamp: row.created_at.toISOString(),
    metadata: row.metadata || {},
  };
}

// The one place a balance changes. `signed` is positive for income, negative
// for an expense. opts.key makes the entry unique per (owner, type).
async function applyChange(db, owner, signed, type, metadata, opts) {
  if (!owner) throw new SteadError('no_wallet', 'Link a wallet to your Homeroom account first.');
  const t = cfg.type(type);
  if (!t || !t.active) throw new SteadError('unknown_type', 'That kind of STEAD change is not available yet.');
  if ((signed > 0) !== (t.direction === 'credit')) throw new SteadError('wrong_direction', 'That kind of STEAD change cannot go that way.');
  const account = await lockAccount(db, owner);
  const balance = account.balance + signed;
  if (balance < 0) throw new SteadError('insufficient_stead', 'Not enough STEAD.', 409);
  let inserted;
  try {
    inserted = await db.query(
      `INSERT INTO stead_ledger (owner, type, amount, balance_after, entry_key, metadata)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [owner, type, signed, balance, (opts && opts.key) || null, metadata || {}]
    );
  } catch (err) {
    if (err.code === '23505') throw new SteadError('duplicate_entry', 'That STEAD change was already recorded.', 409);
    throw err;
  }
  await db.query('UPDATE stead_accounts SET balance = $2, updated_at = NOW() WHERE owner = $1', [owner, balance]);
  return toEntry(inserted.rows[0]);
}

function checkAmount(amount) {
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new SteadError('bad_amount', 'A STEAD amount is a whole number above 0.');
}

// Add `amount` STEAD to a wallet. db: the pool, or a client inside a
// transaction so the credit commits (or rolls back) with the rest of it.
async function creditStead(db, owner, amount, type, metadata, opts) {
  checkAmount(amount);
  return withTransaction(db, (c) => applyChange(c, owner, amount, type, metadata, opts));
}

// Take `amount` STEAD from a wallet; refused (insufficient_stead) rather than
// going below 0. Training (lib/care.js) is the first system that spends.
async function debitStead(db, owner, amount, type, metadata, opts) {
  checkAmount(amount);
  return withTransaction(db, (c) => applyChange(c, owner, -amount, type, metadata, opts));
}

async function getSteadBalance(db, owner) {
  if (!owner) return null;
  const r = await db.query('SELECT balance::float8 AS balance FROM stead_accounts WHERE owner = $1', [owner]);
  return r.rows[0] ? r.rows[0].balance : 0;
}

// Newest first.
async function getSteadLedger(db, owner, limit) {
  if (!owner) return [];
  const r = await db.query(
    'SELECT * FROM stead_ledger WHERE owner = $1 ORDER BY id DESC LIMIT $2',
    [owner, Math.max(1, Math.min(200, limit || cfg.HISTORY_LIMIT))]
  );
  return r.rows.map(toEntry);
}

// Daily Check-in at `now` for an account row (or none): which cycle day today
// is, what it pays, whether it is claimed, and what comes next.
function checkInState(account, now) {
  const today = cfg.dayKey(now);
  const yesterday = cfg.addDays(today, -1);
  const last = account ? account.last_claim_date : null;
  const lastCycleDay = account ? account.cycle_day : 0;
  // A date after today only happens on a preview shown as of an earlier
  // moment; it counts as claimed, never as a second chance.
  const claimedToday = !!last && last >= today;
  const continues = last === yesterday;
  const day = claimedToday ? lastCycleDay : continues ? cfg.nextCycleDay(lastCycleDay) : 1;
  const nextDay = cfg.nextCycleDay(day);
  return {
    today,
    timezone: cfg.GAME_TIMEZONE,
    claimedToday,
    canClaim: !claimedToday,
    // The streak only counts while it is unbroken (claimed today or yesterday).
    currentStreak: account && (claimedToday || continues) ? account.current_streak : 0,
    cycleDay: account && (claimedToday || continues) ? lastCycleDay : 0,
    lastClaimDate: last,
    day,
    reward: cfg.rewardFor(day),
    nextDay,
    nextReward: cfg.rewardFor(nextDay),
  };
}

async function readAccount(db, owner) {
  const r = await db.query(
    `SELECT owner, balance::float8 AS balance, current_streak, cycle_day,
            to_char(last_claim_date, 'YYYY-MM-DD') AS last_claim_date
     FROM stead_accounts WHERE owner = $1`,
    [owner]
  );
  return r.rows[0] || null;
}

// Everything the page shows for this wallet. No wallet: nothing, and no
// anonymous account.
async function getState(db, owner, now) {
  if (!owner) return { walletId: null, steadBalance: null, checkIn: null, ledger: [] };
  const account = await readAccount(db, owner);
  return {
    walletId: owner,
    steadBalance: account ? account.balance : 0,
    checkIn: checkInState(account, now),
    ledger: await getSteadLedger(db, owner),
  };
}

// Claim today's Daily Check-in, in one transaction: check today is not
// claimed, work out the cycle day and reward, credit it through creditStead
// (keyed by today's date) and record the streak. A second claim the same
// calendar day is refused with already_claimed.
async function claimCheckIn(pool, owner, now) {
  if (!owner) throw new SteadError('no_wallet', 'Link a wallet to your Homeroom account first.');
  const entry = await inTransaction(pool, async (db) => {
    const account = await lockAccount(db, owner);
    const s = checkInState(account, now);
    if (s.claimedToday) throw new SteadError('already_claimed', 'Already claimed today. Come back tomorrow.', 409);
    const continues = account.last_claim_date === cfg.addDays(s.today, -1);
    const streak = continues ? account.current_streak + 1 : 1;
    let credited;
    try {
      credited = await creditStead(db, owner, s.reward, 'DAILY_CHECKIN',
        { claimDate: s.today, cycleDay: s.day, streak }, { key: s.today });
    } catch (err) {
      if (err.code === 'duplicate_entry') throw new SteadError('already_claimed', 'Already claimed today. Come back tomorrow.', 409);
      throw err;
    }
    await db.query(
      `UPDATE stead_accounts SET current_streak = $2, cycle_day = $3, last_claim_date = $4::date, updated_at = NOW()
       WHERE owner = $1`,
      [owner, streak, s.day, s.today]
    );
    return credited;
  });
  return Object.assign(await getState(pool, owner, now), { claimed: entry });
}

module.exports = {
  SteadError,
  ensureSchema,
  creditStead,
  debitStead,
  getSteadBalance,
  getSteadLedger,
  checkInState,
  getState,
  claimCheckIn,
};
