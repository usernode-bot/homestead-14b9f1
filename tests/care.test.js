// Feeding + Training: hunger from timestamps, Feeding with Fodder, Training
// with STEAD, and the hunger efficiency on Work.
// The config tests always run; the database tests need DATABASE_URL (a
// throwaway database: they drop and recreate the game tables).
const test = require('node:test');
const assert = require('node:assert');
const { Pool } = require('pg');
const cfg = require('../public/js/care-config');
const genesis = require('../lib/genesis');
const { fundAndMint } = require('./support');
const creatures = require('../lib/creatures');
const homestead = require('../lib/homestead');
const work = require('../lib/work');
const stead = require('../lib/stead');
const care = require('../lib/care');

const HOUR = 3600 * 1000;

test('Feeding + Training config', () => {
  assert.strictEqual(cfg.HUNGER_MAX, 100);
  assert.strictEqual(cfg.HUNGER_LOSS_PER_HOUR, 2);
  assert.strictEqual(cfg.FEED_FODDER_COST, 1);
  assert.strictEqual(cfg.FEED_HUNGER_RESTORE, 25);
  assert.deepStrictEqual(Object.assign({}, cfg.WORK_EFFICIENCY), { WELL_FED: 1, HUNGRY: 0.85, STARVING: 0.6 });
  assert.strictEqual(cfg.TRAINING_COST, 10);
  assert.strictEqual(cfg.TRAINING_AMOUNT, 1);
  assert.strictEqual(cfg.MAX_TRAINING_BONUS, 50);
});

test('hunger is worked out from timestamps and never goes below 0', () => {
  const t0 = new Date('2026-10-05T10:00:00Z');
  const at = (h) => new Date(t0.getTime() + h * HOUR);
  assert.strictEqual(cfg.currentHunger(100, t0, t0), 100);
  assert.strictEqual(cfg.currentHunger(100, t0, at(9)), 82);
  assert.strictEqual(cfg.currentHunger(100, t0, at(1000)), 0);
  // Earlier than the stored moment (a preview shown in the past): unchanged.
  assert.strictEqual(cfg.currentHunger(62, t0, at(-5)), 62);
  // States, condition and efficiency at their edges.
  const at_ = (h) => [cfg.hungerState(h).id, cfg.condition(h).id, cfg.efficiency(h)];
  assert.deepStrictEqual(at_(100), ['WELL_FED', 'GOOD', 1]);
  assert.deepStrictEqual(at_(80), ['WELL_FED', 'GOOD', 1]);
  assert.deepStrictEqual(at_(79), ['HUNGRY', 'FAIR', 0.85]);
  assert.deepStrictEqual(at_(30), ['HUNGRY', 'FAIR', 0.85]);
  assert.deepStrictEqual(at_(29), ['STARVING', 'POOR', 0.6]);
  assert.deepStrictEqual(at_(0), ['STARVING', 'POOR', 0.6]);
  // Saving hunger often never slows its loss.
  let stored = 100;
  let since = t0;
  for (let m = 10; m <= 600; m += 10) {
    const s = cfg.settleHunger(stored, since, at(m / 60));
    stored = s.hunger;
    since = s.since;
  }
  assert.strictEqual(stored, 80);
  assert.strictEqual(cfg.currentHunger(stored, since, at(20)), 60);
});

test('Work efficiency rounds down, and effective stats add training', () => {
  assert.strictEqual(cfg.applyEfficiency(10, 1), 10);
  assert.strictEqual(cfg.applyEfficiency(10, 0.85), 8);
  assert.strictEqual(cfg.applyEfficiency(10, 0.6), 6);
  assert.strictEqual(cfg.applyEfficiency(20, 0.85), 17);
  assert.deepStrictEqual(work.rollRewards('miner', 4, (lo) => lo, 0.6), { stone: 28, ore: 9, crystal: 0 });
  const c = { stats: { hp: 100, attack: 42, defense: 38, speed: 31, luck: 12 }, trainingBonus: { hp: 3, attack: 5, defense: 1, speed: 0, luck: 2 } };
  assert.deepStrictEqual(cfg.effectiveStats(c), { hp: 103, attack: 47, defense: 39, speed: 31, luck: 14 });
});

const url = process.env.DATABASE_URL;

test('Feeding + Training in Postgres', { skip: !url && 'DATABASE_URL is not set' }, async (t) => {
  const pool = new Pool({ connectionString: url });
  t.after(() => pool.end());

  async function reset() {
    await pool.query(`DROP TABLE IF EXISTS contest_creature_locks, contests, contest_challenges, gear_starter_claims, gear_items, creature_care_log, stead_ledger, stead_accounts, creature_work,
      homestead_buildings, homesteads, creatures, seeds, genesis_wallets CASCADE`);
    await genesis.ensureSchema(pool);
    await homestead.ensureSchema(pool);
    await work.ensureSchema(pool);
    await stead.ensureSchema(pool);
    await care.ensureSchema(pool);
    await care.ensureSchema(pool); // idempotent
    await require('../lib/contests').ensureSchema(pool);
  }
  const T0 = new Date('2026-10-05T10:00:00Z');
  const at = (hours) => new Date(T0.getTime() + hours * HOUR);
  // A wallet with a Creature living in its open Homestead, its hunger stored
  // as of T0, `fodder` Fodder in storage and `steadPoints` STEAD.
  async function setup(wallet, opts) {
    opts = opts || {};
    const m = await fundAndMint(pool, wallet, wallet);
    const c = (await genesis.awaken(pool, wallet, m.seed.seedId)).creature;
    if (opts.trade && c.trade !== opts.trade) {
      await pool.query('ALTER TABLE creatures DISABLE TRIGGER USER');
      await pool.query('UPDATE creatures SET trade = $2 WHERE id = $1', [c.creatureId, opts.trade]);
      await pool.query('ALTER TABLE creatures ENABLE TRIGGER USER');
    }
    await pool.query('UPDATE creatures SET hunger = $2, hunger_updated_at = $3, last_fed_at = $3 WHERE id = $1',
      [c.creatureId, opts.hunger == null ? 100 : opts.hunger, T0]);
    const opened = await homestead.open(pool, wallet);
    if (opts.fodder) {
      await pool.query("UPDATE homesteads SET storage = jsonb_set(storage, '{fodder}', $2::jsonb) WHERE owner = $1", [wallet, String(opts.fodder)]);
    }
    if (opts.steadPoints) await stead.creditStead(pool, wallet, opts.steadPoints, 'DAILY_CHECKIN', {}, { key: 'setup' });
    return { id: c.creatureId, base: c.stats, home: opened.homestead };
  }
  async function fodderOf(wallet) {
    return Number((await pool.query('SELECT storage FROM homesteads WHERE owner = $1', [wallet])).rows[0].storage.fodder);
  }

  await t.test('a new Creature starts full, fed at Awaken, with no training', async () => {
    await reset();
    const m = await fundAndMint(pool, 'ut1alice', 'ut1alice');
    const c = (await genesis.awaken(pool, 'ut1alice', m.seed.seedId)).creature;
    const row = (await pool.query('SELECT * FROM creatures WHERE id = $1', [c.creatureId])).rows[0];
    assert.strictEqual(row.hunger, 100);
    assert.strictEqual(row.condition, 'GOOD');
    assert.strictEqual(row.last_fed_at.getTime(), row.created_at.getTime());
    await assert.rejects(care.feed(pool, 'ut1alice', c.creatureId, null, row.created_at), { code: 'already_full' });
    const shown = await creatures.getById(pool, c.creatureId, new Date(row.created_at.getTime() + 10 * HOUR));
    assert.deepStrictEqual(shown.trainingBonus, { hp: 0, attack: 0, defense: 0, speed: 0, luck: 0 });
    assert.deepStrictEqual(shown.effectiveStats, shown.stats);
    assert.strictEqual(shown.care.hunger, 80);
    assert.strictEqual(shown.care.hungerState, 'WELL_FED');
  });

  await t.test('feeding takes exactly 1 Fodder for +25 hunger, capped at 100', async () => {
    await reset();
    const { id } = await setup('ut1alice', { hunger: 100, fodder: 3 });
    // 19 hours later: 62.
    let r = await care.feed(pool, 'ut1alice', id, 'feed-req-0001', at(19));
    assert.deepStrictEqual(r.fed, { hungerBefore: 62, hungerAfter: 87, restored: 25, fodderSpent: 1 });
    assert.strictEqual(r.creature.care.hunger, 87);
    assert.strictEqual(r.controls.fodder, 2);
    assert.strictEqual(await fodderOf('ut1alice'), 2);
    let row = (await pool.query('SELECT * FROM creatures WHERE id = $1', [id])).rows[0];
    assert.strictEqual(row.hunger, 87);
    assert.strictEqual(row.condition, 'GOOD');
    assert.strictEqual(row.last_fed_at.toISOString(), at(19).toISOString());
    // The same request again changes nothing.
    r = await care.feed(pool, 'ut1alice', id, 'feed-req-0001', at(19));
    assert.strictEqual(r.replayed, true);
    assert.strictEqual(await fodderOf('ut1alice'), 2);
    // 87 + 25 stops at 100.
    r = await care.feed(pool, 'ut1alice', id, 'feed-req-0002', at(19));
    assert.strictEqual(r.fed.hungerAfter, 100);
    assert.strictEqual(r.fed.restored, 13);
    // Full: refused, and no Fodder taken.
    await assert.rejects(care.feed(pool, 'ut1alice', id, 'feed-req-0003', at(19)), { code: 'already_full' });
    assert.strictEqual(await fodderOf('ut1alice'), 1);
  });

  await t.test('feeding with no Fodder, or someone else\'s Creature, is refused', async () => {
    await reset();
    const { id } = await setup('ut1alice', { hunger: 40 });
    await setup('ut1bob', { fodder: 5 });
    await assert.rejects(care.feed(pool, 'ut1alice', id, null, T0), { code: 'not_enough_fodder' });
    await assert.rejects(care.feed(pool, 'ut1bob', id, null, T0), { code: 'not_yours' });
    assert.strictEqual(await fodderOf('ut1bob'), 5);
    assert.strictEqual((await pool.query('SELECT hunger FROM creatures WHERE id = $1', [id])).rows[0].hunger, 40);
  });

  await t.test('a burst of feeds takes only the Fodder each one used', async () => {
    await reset();
    const { id } = await setup('ut1alice', { hunger: 30, fodder: 10 });
    // Five distinct taps and five duplicates of one tap, all at once.
    const results = await Promise.allSettled([
      ...Array.from({ length: 5 }, (_, i) => care.feed(pool, 'ut1alice', id, 'tap-distinct-' + i, T0)),
      ...Array.from({ length: 5 }, () => care.feed(pool, 'ut1alice', id, 'tap-same-0000', T0)),
    ]);
    const applied = results.filter((r) => r.status === 'fulfilled' && !r.value.replayed).length;
    // 30 -> 55 -> 80 -> 100: three feeds fit, the rest are already full or replays.
    assert.strictEqual(applied, 3);
    assert.strictEqual(await fodderOf('ut1alice'), 7);
    assert.strictEqual((await pool.query("SELECT COUNT(*)::int AS n FROM creature_care_log WHERE action = 'FEED'")).rows[0].n, 3);
  });

  await t.test('hunger never harms a Creature', async () => {
    await reset();
    const { id } = await setup('ut1alice', { hunger: 10 });
    const later = await creatures.getById(pool, id, at(10000));
    assert.strictEqual(later.care.hunger, 0);
    assert.strictEqual(later.care.condition, 'POOR');
    assert.strictEqual(later.owner, 'ut1alice');
    assert.deepStrictEqual(later.effectiveStats, later.stats);
  });

  await t.test('opening the Homestead saves hunger without changing it', async () => {
    await reset();
    const { id } = await setup('ut1alice', { hunger: 100 });
    assert.strictEqual(await care.syncHunger(pool, 'ut1alice', at(10.25)), 1);
    const row = (await pool.query('SELECT * FROM creatures WHERE id = $1', [id])).rows[0];
    assert.strictEqual(row.hunger, 80);
    assert.strictEqual(row.hunger_updated_at.toISOString(), at(10).toISOString());
    assert.strictEqual(row.last_fed_at.toISOString(), T0.toISOString());
    assert.strictEqual(cfg.currentHunger(row.hunger, row.hunger_updated_at, at(30)), 40);
    // Earlier moments never move it back.
    assert.strictEqual(await care.syncHunger(pool, 'ut1alice', at(1)), 0);
  });

  await t.test('training costs 10 STEAD for +1 and leaves base stats alone', async () => {
    await reset();
    const { id, base } = await setup('ut1alice', { steadPoints: 25 });
    const r = await care.train(pool, 'ut1alice', id, 'attack', 'train-req-0001', T0);
    assert.strictEqual(r.trained.bonusAfter, 1);
    assert.strictEqual(r.creature.trainingBonus.attack, 1);
    assert.deepStrictEqual(r.creature.stats, base);
    assert.strictEqual(r.creature.effectiveStats.attack, base.attack + 1);
    assert.strictEqual(r.controls.steadBalance, 15);
    const ledger = await stead.getSteadLedger(pool, 'ut1alice');
    assert.strictEqual(ledger[0].type, 'TRAINING');
    assert.strictEqual(ledger[0].amount, -10);
    assert.strictEqual(ledger[0].balanceAfter, 15);
    // A retry of the same tap: no second charge.
    const again = await care.train(pool, 'ut1alice', id, 'attack', 'train-req-0001', T0);
    assert.strictEqual(again.replayed, true);
    assert.strictEqual(await stead.getSteadBalance(pool, 'ut1alice'), 15);
    // 15 -> 5, then below 10 is refused with STEAD unchanged.
    await care.train(pool, 'ut1alice', id, 'luck', 'train-req-0002', T0);
    await assert.rejects(care.train(pool, 'ut1alice', id, 'luck', 'train-req-0003', T0), { code: 'not_enough_stead' });
    assert.strictEqual(await stead.getSteadBalance(pool, 'ut1alice'), 5);
    const row = (await pool.query('SELECT * FROM creatures WHERE id = $1', [id])).rows[0];
    assert.deepStrictEqual([row.training_attack, row.training_luck], [1, 1]);
    // Base stats cannot be written at all.
    await assert.rejects(pool.query('UPDATE creatures SET base_attack = base_attack + 1 WHERE id = $1', [id]), /can never change/);
  });

  await t.test('training is refused for a bad stat, another wallet, at the maximum and while working', async () => {
    await reset();
    const { id } = await setup('ut1alice', { steadPoints: 500, trade: 'miner' });
    await setup('ut1bob', { steadPoints: 500 });
    await assert.rejects(care.train(pool, 'ut1alice', id, 'charm', null, T0), { code: 'bad_stat' });
    await assert.rejects(care.train(pool, 'ut1bob', id, 'hp', null, T0), { code: 'not_yours' });
    await pool.query('UPDATE creatures SET training_speed = $2 WHERE id = $1', [id, cfg.MAX_TRAINING_BONUS]);
    await assert.rejects(care.train(pool, 'ut1alice', id, 'speed', null, T0), { code: 'max_training' });
    assert.strictEqual(await stead.getSteadBalance(pool, 'ut1alice'), 500);
    await assert.rejects(pool.query('UPDATE creatures SET training_speed = 51 WHERE id = $1', [id]), /creatures_care_ranges/);

    await work.start(pool, 'ut1alice', { creatureId: id, durationId: '1h' }, T0);
    await assert.rejects(care.train(pool, 'ut1alice', id, 'hp', null, at(0.5)), { code: 'working' });
    assert.strictEqual((await care.controls(pool, 'ut1alice', id, at(0.5))).working, true);
    assert.strictEqual(await stead.getSteadBalance(pool, 'ut1alice'), 500);
    // Once the Work's time is up the Creature can train again.
    const r = await care.train(pool, 'ut1alice', id, 'hp', null, at(1));
    assert.strictEqual(r.trained.bonusAfter, 1);
  });

  await t.test('rapid training from many tabs never overspends or passes the maximum', async () => {
    await reset();
    const { id } = await setup('ut1alice', { steadPoints: 55 });
    await pool.query('UPDATE creatures SET training_defense = $2 WHERE id = $1', [id, cfg.MAX_TRAINING_BONUS - 3]);
    const results = await Promise.allSettled(Array.from({ length: 10 }, (_, i) =>
      care.train(pool, 'ut1alice', id, 'defense', 'tab-' + String(i).padStart(6, '0'), T0)));
    assert.strictEqual(results.filter((r) => r.status === 'fulfilled').length, 3);
    assert.ok(results.filter((r) => r.status === 'rejected').every((r) => r.reason.code === 'max_training'));
    assert.strictEqual(await stead.getSteadBalance(pool, 'ut1alice'), 25);
    const row = (await pool.query('SELECT training_defense FROM creatures WHERE id = $1', [id])).rows[0];
    assert.strictEqual(row.training_defense, cfg.MAX_TRAINING_BONUS);
  });

  await t.test('hunger at the start of Work decides its Resource output', async () => {
    await reset();
    const { id, home } = await setup('ut1alice', { hunger: 50, trade: 'miner' });
    // 50 at T0 is HUNGRY: 85%.
    const s = await work.start(pool, 'ut1alice', { creatureId: id, durationId: '4h' }, T0);
    assert.strictEqual(s.work.efficiency, 0.85);
    assert.strictEqual(s.work.hungerState, 'HUNGRY');
    const o = await work.overview(pool, home.homesteadId, at(4), { settle: true, randInt: (lo) => lo });
    // Base: stone 48, ore 16, crystal 0.
    assert.deepStrictEqual(o.active[0].rewards, { stone: 40, ore: 13, crystal: 0 });
    // Efficiency is part of the record and never changes.
    await assert.rejects(pool.query('UPDATE creature_work SET efficiency = 1 WHERE creature_id = $1', [id]), /can never change/);
    // Work changes no STEAD.
    assert.strictEqual(await stead.getSteadBalance(pool, 'ut1alice'), 0);
  });
});
