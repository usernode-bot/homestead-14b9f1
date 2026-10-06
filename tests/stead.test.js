// STEAD Points, the ledger and Daily Check-in.
// The config tests always run; the database tests need DATABASE_URL (a
// throwaway database: they drop and recreate the STEAD tables).
const test = require('node:test');
const assert = require('node:assert');
const { Pool } = require('pg');
const cfg = require('../public/js/stead-config');
const stead = require('../lib/stead');

test('STEAD config', () => {
  assert.strictEqual(cfg.NAME, 'STEAD');
  assert.deepStrictEqual(Array.from(cfg.CHECKIN_REWARDS), [100, 120, 150, 180, 220, 250, 500]);
  assert.deepStrictEqual([1, 2, 3, 4, 5, 6, 7].map(cfg.rewardFor), [100, 120, 150, 180, 220, 250, 500]);
  assert.strictEqual(cfg.nextCycleDay(7), 1);
  assert.strictEqual(cfg.nextCycleDay(3), 4);
  assert.strictEqual(cfg.GAME_TIMEZONE, 'UTC');
  assert.strictEqual(cfg.dayKey(new Date('2026-10-05T23:59:59Z')), '2026-10-05');
  assert.strictEqual(cfg.dayKey(new Date('2026-10-06T00:00:00Z')), '2026-10-06');
  assert.strictEqual(cfg.addDays('2026-03-01', -1), '2026-02-28');
  assert.strictEqual(cfg.formatSigned(1240), '+1,240');
  assert.strictEqual(cfg.formatSigned(-50), '-50');
  // Daily Check-in, Training, Contest rewards, Genesis, Marketplace
  // purchases and Resource trades are live; the rest are reserved, spending
  // types.
  const active = Object.keys(cfg.TYPES).filter((k) => cfg.TYPES[k].active);
  assert.deepStrictEqual(active, ['DAILY_CHECKIN', 'TRAINING', 'CONTEST_REWARD', 'GENESIS', 'MARKETPLACE_PURCHASE', 'RESOURCE_PURCHASE', 'RESOURCE_SALE']);
  for (const k of ['TRAINING', 'GENESIS', 'MARKETPLACE_PURCHASE', 'RESOURCE_PURCHASE', 'FEEDING', 'GEAR', 'UPGRADE', 'MARKETPLACE_FEE', 'BREEDING']) {
    assert.strictEqual(cfg.TYPES[k].direction, 'debit', k);
  }
  assert.strictEqual(cfg.TYPES.RESOURCE_SALE.direction, 'credit');
});

test('check-in state: claimable, claimed, continued, missed and looping', () => {
  const now = new Date('2026-10-05T12:00:00Z');
  assert.deepStrictEqual(
    (({ day, reward, claimedToday, currentStreak }) => ({ day, reward, claimedToday, currentStreak }))(stead.checkInState(null, now)),
    { day: 1, reward: 100, claimedToday: false, currentStreak: 0 }
  );
  const acct = (last, cycleDay, streak) => ({ last_claim_date: last, cycle_day: cycleDay, current_streak: streak });
  const yesterday = stead.checkInState(acct('2026-10-04', 3, 3), now);
  assert.strictEqual(yesterday.day, 4);
  assert.strictEqual(yesterday.reward, 180);
  assert.strictEqual(yesterday.currentStreak, 3);
  const today = stead.checkInState(acct('2026-10-05', 4, 4), now);
  assert.strictEqual(today.claimedToday, true);
  assert.strictEqual(today.day, 4);
  assert.strictEqual(today.nextDay, 5);
  assert.strictEqual(today.nextReward, 220);
  const missed = stead.checkInState(acct('2026-10-03', 5, 5), now);
  assert.strictEqual(missed.day, 1);
  assert.strictEqual(missed.currentStreak, 0);
  const looped = stead.checkInState(acct('2026-10-04', 7, 7), now);
  assert.strictEqual(looped.day, 1);
  assert.strictEqual(looped.reward, 100);
});

const url = process.env.DATABASE_URL;

test('STEAD in Postgres', { skip: !url && 'DATABASE_URL is not set' }, async (t) => {
  const pool = new Pool({ connectionString: url });
  t.after(() => pool.end());
  await pool.query('DROP TABLE IF EXISTS stead_ledger, stead_accounts CASCADE');
  await stead.ensureSchema(pool);
  await stead.ensureSchema(pool); // idempotent

  const A = 'ut1walleta';
  const B = 'ut1walletb';
  const day = (d, h) => new Date(`2026-10-${String(d).padStart(2, '0')}T${String(h || 12).padStart(2, '0')}:00:00Z`);

  async function ledgerTotal(owner) {
    const r = await pool.query('SELECT COALESCE(SUM(amount), 0)::float8 AS s FROM stead_ledger WHERE owner = $1', [owner]);
    return r.rows[0].s;
  }

  await t.test('a new wallet has 0 STEAD and no account until it earns some', async () => {
    assert.strictEqual(await stead.getSteadBalance(pool, A), 0);
    const s = await stead.getState(pool, A, day(5));
    assert.strictEqual(s.steadBalance, 0);
    assert.deepStrictEqual(s.ledger, []);
    assert.strictEqual(s.checkIn.day, 1);
    const rows = await pool.query('SELECT 1 FROM stead_accounts');
    assert.strictEqual(rows.rows.length, 0);
    const none = await stead.getState(pool, null, day(5));
    assert.strictEqual(none.steadBalance, null);
    await assert.rejects(stead.claimCheckIn(pool, null, day(5)), { code: 'no_wallet' });
  });

  await t.test('claim pays Day 1, then a second claim the same calendar day is refused', async () => {
    const first = await stead.claimCheckIn(pool, A, day(5, 1));
    assert.strictEqual(first.steadBalance, 100);
    assert.strictEqual(first.claimed.type, 'DAILY_CHECKIN');
    assert.strictEqual(first.claimed.amount, 100);
    assert.strictEqual(first.claimed.balanceAfter, 100);
    assert.deepStrictEqual(first.claimed.metadata, { claimDate: '2026-10-05', cycleDay: 1, streak: 1 });
    assert.strictEqual(first.checkIn.claimedToday, true);
    assert.strictEqual(first.checkIn.nextReward, 120);
    await assert.rejects(stead.claimCheckIn(pool, A, day(5, 23)), { code: 'already_claimed', status: 409 });
    assert.strictEqual(await stead.getSteadBalance(pool, A), 100);
  });

  await t.test('many simultaneous claims pay exactly once', async () => {
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => stead.claimCheckIn(pool, B, day(5))));
    assert.strictEqual(results.filter((r) => r.status === 'fulfilled').length, 1);
    for (const r of results.filter((x) => x.status === 'rejected')) assert.strictEqual(r.reason.code, 'already_claimed');
    assert.strictEqual(await stead.getSteadBalance(pool, B), 100);
    assert.strictEqual((await stead.getSteadLedger(pool, B)).length, 1);
  });

  await t.test('the next calendar day continues the streak, even under 24 hours later', async () => {
    const s = await stead.claimCheckIn(pool, A, day(6, 0));
    assert.strictEqual(s.claimed.amount, 120);
    assert.strictEqual(s.steadBalance, 220);
    assert.strictEqual(s.checkIn.currentStreak, 2);
    const ledger = await stead.getSteadLedger(pool, A);
    assert.deepStrictEqual(ledger.map((e) => e.amount), [120, 100]); // newest first
    assert.deepStrictEqual(ledger.map((e) => e.balanceAfter), [220, 100]);
    assert.strictEqual(await ledgerTotal(A), 220);
  });

  await t.test('wallets keep separate balances', async () => {
    assert.strictEqual(await stead.getSteadBalance(pool, A), 220);
    assert.strictEqual(await stead.getSteadBalance(pool, B), 100);
  });

  await t.test('a missed day starts again at Day 1', async () => {
    // B claimed on the 5th; skip the 6th.
    const s = await stead.claimCheckIn(pool, B, day(7));
    assert.strictEqual(s.claimed.amount, 100);
    assert.strictEqual(s.claimed.metadata.cycleDay, 1);
    assert.strictEqual(s.checkIn.currentStreak, 1);
    assert.strictEqual(s.steadBalance, 200);
  });

  await t.test('seven days in a row follow the schedule and Day 8 pays Day 1 again', async () => {
    const C = 'ut1walletc';
    const paid = [];
    for (let d = 1; d <= 8; d++) paid.push((await stead.claimCheckIn(pool, C, day(d))).claimed.amount);
    assert.deepStrictEqual(paid, [100, 120, 150, 180, 220, 250, 500, 100]);
    const s = await stead.getState(pool, C, day(8));
    assert.strictEqual(s.checkIn.currentStreak, 8);
    assert.strictEqual(s.checkIn.cycleDay, 1);
    assert.strictEqual(s.steadBalance, 1620);
    assert.strictEqual(await ledgerTotal(C), 1620);
  });

  await t.test('only active types are recorded, credits only add and debits never go below 0', async () => {
    await assert.rejects(stead.creditStead(pool, A, 0, 'DAILY_CHECKIN'), { code: 'bad_amount' });
    await assert.rejects(stead.creditStead(pool, A, 10, 'NOT_A_TYPE'), { code: 'unknown_type' });
    // Spending systems other than Training are reserved, not live.
    await assert.rejects(stead.debitStead(pool, A, 50, 'GEAR'), { code: 'unknown_type' });
    await assert.rejects(stead.debitStead(pool, A, 50, 'DAILY_CHECKIN'), { code: 'wrong_direction' });
    // The same key for the same wallet and type is recorded once.
    await assert.rejects(stead.creditStead(pool, A, 10, 'DAILY_CHECKIN', {}, { key: '2026-10-05' }), { code: 'duplicate_entry' });
    assert.strictEqual(await stead.getSteadBalance(pool, A), 220);
    await assert.rejects(pool.query("UPDATE stead_accounts SET balance = -1 WHERE owner = $1", [A]), /stead_accounts_balance_check/);
  });

  await t.test('the ledger is append-only', async () => {
    await assert.rejects(pool.query('UPDATE stead_ledger SET amount = 999 WHERE owner = $1', [A]), /can never be changed/);
    await assert.rejects(pool.query('DELETE FROM stead_ledger WHERE owner = $1', [A]), /can never be changed/);
  });
});
