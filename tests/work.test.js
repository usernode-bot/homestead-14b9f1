// Work & Resources: a Creature works at its Trade's building and brings
// resources home to its Homestead's storage.
// The config tests always run; the database tests need DATABASE_URL (a
// throwaway database: they drop and recreate the game tables).
const test = require('node:test');
const assert = require('node:assert');
const { Pool } = require('pg');
const ccfg = require('../public/js/creature-config');
const hcfg = require('../public/js/homestead-config');
const wcfg = require('../public/js/work-config');
const genesis = require('../lib/genesis');
const creatures = require('../lib/creatures');
const homestead = require('../lib/homestead');
const work = require('../lib/work');

const HOUR = 3600 * 1000;

test('Work config', () => {
  assert.deepStrictEqual(wcfg.DURATIONS.map((d) => [d.id, d.hours]), [['1h', 1], ['4h', 4], ['8h', 8]]);
  const buildings = {};
  for (const t of ccfg.TRADES) buildings[t.id] = wcfg.buildingFor(t.id);
  assert.deepStrictEqual(buildings, {
    farmer: 'barn', miner: 'mine', lumberjack: 'lumber-camp', fisher: 'fishing-hut', smith: 'workshop', mystic: 'mystic-shrine',
  });
  for (const id of Object.values(buildings)) assert.ok(hcfg.building(id), id);
  const keys = hcfg.RESOURCES.map((r) => r.key);
  for (const t of Object.values(wcfg.TRADES)) {
    for (const [key, [min, max]] of Object.entries(t.perHour)) {
      assert.ok(keys.includes(key), key);
      assert.ok(Number.isInteger(min) && Number.isInteger(max) && min >= 0 && max >= min, key);
    }
  }
  assert.deepStrictEqual(wcfg.TRADES.miner.perHour, { stone: [12, 24], ore: [4, 10], crystal: [0, 1] });
  // Every resource is in exactly one inventory group.
  assert.deepStrictEqual(wcfg.RESOURCE_GROUPS.flatMap((g) => g.keys).sort(), keys.slice().sort());
  assert.strictEqual(wcfg.formatSpan(2 * HOUR + 17 * 60000), '2h 17m');
  assert.strictEqual(wcfg.formatSpan(4 * HOUR), '4h');
});

test('rewards are one roll per hour in each configured range, with no rarity multiplier', () => {
  const min = work.rollRewards('miner', 4, (lo) => lo);
  const max = work.rollRewards('miner', 4, (lo, hi) => hi);
  assert.deepStrictEqual(min, { stone: 48, ore: 16, crystal: 0 });
  assert.deepStrictEqual(max, { stone: 96, ore: 40, crystal: 4 });
  for (let i = 0; i < 50; i++) {
    const r = work.rollRewards('fisher', 1);
    assert.ok(r.fish >= 8 && r.fish <= 18 && r.rareFish >= 0 && r.rareFish <= 2);
  }
  assert.throws(() => work.rollRewards('pirate', 1), work.WorkError);
});

const url = process.env.DATABASE_URL;

test('Work in Postgres', { skip: !url && 'DATABASE_URL is not set' }, async (t) => {
  const pool = new Pool({ connectionString: url });
  t.after(() => pool.end());

  async function reset() {
    await pool.query('DROP TABLE IF EXISTS creature_work, homestead_buildings, homesteads, creatures, seeds, genesis_wallets, creature_supply CASCADE');
    await genesis.ensureSchema(pool);
    await homestead.ensureSchema(pool);
    await work.ensureSchema(pool);
    await work.ensureSchema(pool);
  }
  // A wallet with a Creature of the given Trade, living in its open Homestead.
  async function homeWith(wallet, trade) {
    const m = await genesis.mint(pool, wallet, wallet);
    const c = (await genesis.awaken(pool, wallet, m.seed.seedId)).creature;
    // Trade is rolled at Awaken and permanent; the test sets it past the
    // identity trigger only to pick which Trade it exercises.
    if (trade && c.trade !== trade) {
      await pool.query('ALTER TABLE creatures DISABLE TRIGGER USER');
      await pool.query('UPDATE creatures SET trade = $2 WHERE id = $1', [c.creatureId, trade]);
      await pool.query('ALTER TABLE creatures ENABLE TRIGGER USER');
    }
    const opened = await homestead.open(pool, wallet);
    return { creature: opened.creature, home: opened.homestead };
  }
  const T0 = new Date('2026-10-05T10:00:00Z');
  const at = (hours) => new Date(T0.getTime() + hours * HOUR);
  async function count(sql, params) {
    return (await pool.query(sql, params)).rows[0].n;
  }

  await t.test('only the Trade building unlocks, and Work only starts there', async () => {
    await reset();
    const { creature, home } = await homeWith('ut1alice', 'miner');
    assert.deepStrictEqual(home.buildings.filter((b) => b.unlocked).map((b) => b.buildingId), ['mine']);
    for (const wrong of ['barn', 'workshop']) {
      await assert.rejects(work.start(pool, 'ut1alice', { creatureId: creature.creatureId, durationId: '1h', buildingId: wrong }, T0),
        (e) => e.code === 'wrong_building');
    }
    await assert.rejects(work.start(pool, 'ut1alice', { creatureId: creature.creatureId, durationId: '2h' }, T0), (e) => e.code === 'bad_duration');
    await assert.rejects(work.start(pool, 'ut1bob', { creatureId: creature.creatureId, durationId: '1h' }, T0), (e) => e.code === 'no_homestead');
    const r = await work.start(pool, 'ut1alice', { creatureId: creature.creatureId, durationId: '4h', buildingId: 'mine' }, T0);
    assert.strictEqual(r.started, true);
    assert.strictEqual(r.work.trade, 'miner');
    assert.strictEqual(r.work.buildingId, 'mine');
    assert.strictEqual(r.work.durationSeconds, 4 * 3600);
    assert.strictEqual(r.work.startedAt, T0.toISOString());
    assert.strictEqual(r.work.status, 'working');
  });

  await t.test('another wallet cannot send your Creature to work', async () => {
    await reset();
    const { creature } = await homeWith('ut1alice', 'miner');
    await homeWith('ut1bob', 'farmer');
    await assert.rejects(work.start(pool, 'ut1bob', { creatureId: creature.creatureId, durationId: '1h' }, T0), (e) => e.code === 'not_resident');
  });

  await t.test('rapid repeated starts make exactly one Work', async () => {
    await reset();
    const { creature } = await homeWith('ut1alice', 'miner');
    const results = await Promise.all(Array.from({ length: 8 }, () =>
      work.start(pool, 'ut1alice', { creatureId: creature.creatureId, durationId: '1h' }, T0)));
    assert.strictEqual(results.filter((r) => r.started).length, 1);
    assert.strictEqual(new Set(results.map((r) => r.work.workId)).size, 1);
    assert.strictEqual(await count('SELECT COUNT(*)::int AS n FROM creature_work'), 1);
    // A different duration while working still returns the same Work.
    const again = await work.start(pool, 'ut1alice', { creatureId: creature.creatureId, durationId: '8h' }, at(0.5));
    assert.strictEqual(again.started, false);
    assert.strictEqual(again.work.durationId, '1h');
  });

  await t.test('completion comes from timestamps, and rewards are rolled once', async () => {
    await reset();
    const { creature, home } = await homeWith('ut1alice', 'miner');
    await work.start(pool, 'ut1alice', { creatureId: creature.creatureId, durationId: '4h' }, T0);
    // Nobody looks for 6.5 hours: nothing ran in between.
    let o = await work.overview(pool, home.homesteadId, at(2), { settle: true });
    assert.strictEqual(o.active[0].status, 'working');
    assert.strictEqual(o.active[0].rewards, null);
    await assert.rejects(work.collect(pool, 'ut1alice', o.active[0].workId, at(2)), (e) => e.code === 'not_finished');
    // A read-only look after the end shows it complete without rolling.
    o = await work.overview(pool, home.homesteadId, at(6.5), { settle: false });
    assert.strictEqual(o.active[0].status, 'completed');
    assert.strictEqual(o.active[0].rewards, null);
    o = await work.overview(pool, home.homesteadId, at(6.5), { settle: true, randInt: (lo) => lo });
    const rewards = o.active[0].rewards;
    assert.deepStrictEqual(rewards, { stone: 48, ore: 16, crystal: 0 });
    // Opening again (another tab, a refresh) never re-rolls.
    o = await work.overview(pool, home.homesteadId, at(7), { settle: true, randInt: (lo, hi) => hi });
    assert.deepStrictEqual(o.active[0].rewards, rewards);
    await assert.rejects(pool.query("UPDATE creature_work SET rewards = '{\"stone\": 999}'"));
  });

  await t.test('collect adds to storage exactly once, and the Creature is idle again', async () => {
    await reset();
    const { creature, home } = await homeWith('ut1alice', 'smith');
    const before = await creatures.getById(pool, creature.creatureId);
    const { work: w } = await work.start(pool, 'ut1alice', { creatureId: creature.creatureId, durationId: '1h' }, T0);
    const results = await Promise.all(Array.from({ length: 6 }, () => work.collect(pool, 'ut1alice', w.workId, at(1), () => 7)));
    assert.strictEqual(results.filter((r) => !r.alreadyClaimed).length, 1);
    const h = (await homestead.open(pool, 'ut1alice')).homestead;
    assert.strictEqual(h.storage.parts, 7, 'paid out once');
    assert.strictEqual(h.storageUsed, 7);
    const again = await work.collect(pool, 'ut1alice', w.workId, at(2));
    assert.deepStrictEqual(again.moved, {});
    const o = await work.overview(pool, home.homesteadId, at(2), { settle: true });
    assert.deepStrictEqual(o.active, []);
    assert.strictEqual(o.history.length, 1);
    assert.deepStrictEqual(o.history[0].rewards, { parts: 7 });
    assert.strictEqual(o.pendingTotal, 0);
    // The Creature is unchanged by working.
    assert.deepStrictEqual(await creatures.getById(pool, creature.creatureId), before);
    // Idle again: a new Work can start.
    assert.strictEqual((await work.start(pool, 'ut1alice', { creatureId: creature.creatureId, durationId: '1h' }, at(2))).started, true);
    // Collected can never pass the reward.
    await assert.rejects(pool.query(`UPDATE creature_work SET collected = '{"parts": 8}' WHERE id = $1`, [w.workId]));
    await assert.rejects(pool.query('DELETE FROM creature_work WHERE id = $1', [w.workId]));
  });

  await t.test('a full storage keeps the rest pending instead of losing it', async () => {
    await reset();
    const { creature, home } = await homeWith('ut1alice', 'miner');
    await pool.query('UPDATE homesteads SET storage = $2 WHERE id = $1',
      [home.homesteadId, JSON.stringify(Object.assign(hcfg.emptyStorage(), { stone: 92 }))]);
    const { work: w } = await work.start(pool, 'ut1alice', { creatureId: creature.creatureId, durationId: '1h' }, T0);
    const r = await work.collect(pool, 'ut1alice', w.workId, at(1), (lo, hi) => hi); // stone 24, ore 10, crystal 1
    assert.deepStrictEqual(r.moved, { stone: 8 });
    assert.deepStrictEqual(r.work.pending, { stone: 16, ore: 10, crystal: 1 });
    let o = await work.overview(pool, home.homesteadId, at(1), { settle: true });
    assert.deepStrictEqual(o.active, [], 'the Creature is free to work again');
    assert.strictEqual(o.pendingTotal, 27);
    let h = (await homestead.open(pool, 'ut1alice')).homestead;
    assert.strictEqual(h.storageUsed, 100);
    // Still full: collecting pending moves nothing and loses nothing.
    assert.deepStrictEqual((await work.collectPending(pool, 'ut1alice', at(2))).moved, {});
    // Space frees up (a future system spends resources): the rest arrives.
    await pool.query('UPDATE homesteads SET storage = $2 WHERE id = $1',
      [home.homesteadId, JSON.stringify(Object.assign(hcfg.emptyStorage(), { stone: 50 }))]);
    const all = await Promise.all([1, 2, 3].map(() => work.collectPending(pool, 'ut1alice', at(3))));
    const movedTotal = {};
    for (const r of all) for (const [k, n] of Object.entries(r.moved)) movedTotal[k] = (movedTotal[k] || 0) + n;
    assert.deepStrictEqual(movedTotal, { stone: 16, ore: 10, crystal: 1 }, 'concurrent collects move it once between them');
    h = (await homestead.open(pool, 'ut1alice')).homestead;
    assert.deepStrictEqual([h.storage.stone, h.storage.ore, h.storage.crystal], [66, 10, 1], 'each pending amount arrived once');
    o = await work.overview(pool, home.homesteadId, at(3), { settle: true });
    assert.strictEqual(o.pendingTotal, 0);
  });

  await t.test('history shows the latest entries, newest first', async () => {
    await reset();
    const { creature, home } = await homeWith('ut1alice', 'smith');
    for (let i = 0; i < wcfg.HISTORY_LIMIT + 2; i++) {
      const { work: w } = await work.start(pool, 'ut1alice', { creatureId: creature.creatureId, durationId: '1h' }, at(i * 2));
      await work.collect(pool, 'ut1alice', w.workId, at(i * 2 + 1), () => 1);
      await pool.query("UPDATE homesteads SET storage = '{}'::jsonb WHERE id = $1", [home.homesteadId]);
    }
    const o = await work.overview(pool, home.homesteadId, at(100), { settle: false });
    assert.strictEqual(o.history.length, wcfg.HISTORY_LIMIT);
    assert.ok(o.history[0].workId > o.history[1].workId);
  });
});
