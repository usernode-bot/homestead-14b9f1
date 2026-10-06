// The Marketplace: food bought with STEAD.
// The config tests always run; the database tests need DATABASE_URL (a
// throwaway database: they drop and recreate the STEAD and food tables).
const test = require('node:test');
const assert = require('node:assert');
const { Pool } = require('pg');
const cfg = require('../public/js/food-config');
const stead = require('../lib/stead');
const marketplace = require('../lib/marketplace');

const T0 = new Date('2026-10-05T10:00:00Z');

test('food config', () => {
  assert.deepStrictEqual(cfg.FOODS.map((f) => [f.id, f.price]), [['grub-snack', 10], ['monster-meal', 25], ['punk-feast', 60]]);
  assert.strictEqual(cfg.MAX_OWNED_PER_FOOD, 99);
  assert.strictEqual(cfg.food('cake'), null);
  assert.deepStrictEqual(cfg.applyFood(30, cfg.food('grub-snack'), T0), { hunger: 70, since: T0 });
  assert.strictEqual(cfg.applyFood(80, cfg.food('grub-snack'), T0).hunger, 100);
  assert.strictEqual(cfg.applyFood(0, cfg.food('monster-meal'), T0).hunger, 100);
  const feast = cfg.applyFood(10, cfg.food('punk-feast'), T0);
  assert.strictEqual(feast.hunger, 100);
  assert.strictEqual(feast.since.toISOString(), '2026-10-06T10:00:00.000Z');
});

const url = process.env.DATABASE_URL;

test('Marketplace in Postgres', { skip: !url && 'DATABASE_URL is not set' }, async (t) => {
  const pool = new Pool({ connectionString: url });
  t.after(() => pool.end());

  async function reset() {
    await pool.query('DROP TABLE IF EXISTS food_inventory, stead_ledger, stead_accounts CASCADE');
    await stead.ensureSchema(pool);
    await marketplace.ensureSchema(pool);
    await marketplace.ensureSchema(pool); // idempotent
  }
  async function fund(owner, amount) {
    await stead.creditStead(pool, owner, amount, 'DAILY_CHECKIN', {}, { key: 'fund-' + amount });
  }

  await t.test('without a wallet: the catalog, nothing owned, no balance', async () => {
    await reset();
    const s = await marketplace.getState(pool, null);
    assert.strictEqual(s.foods.length, 3);
    assert.deepStrictEqual(s.owned, { 'grub-snack': 0, 'monster-meal': 0, 'punk-feast': 0 });
    assert.strictEqual(s.steadBalance, null);
    await assert.rejects(marketplace.buy(pool, null, 'grub-snack', null, T0), { code: 'no_wallet' });
  });

  await t.test('buying takes exactly the price and adds one to the inventory', async () => {
    await reset();
    await fund('ut1alice', 100);
    let r = await marketplace.buy(pool, 'ut1alice', 'grub-snack', 'buy-req-0001', T0);
    assert.deepStrictEqual([r.bought.foodId, r.bought.price, r.steadBalance, r.owned['grub-snack']], ['grub-snack', 10, 90, 1]);
    r = await marketplace.buy(pool, 'ut1alice', 'monster-meal', null, T0);
    assert.deepStrictEqual([r.steadBalance, r.owned['monster-meal']], [65, 1]);
    r = await marketplace.buy(pool, 'ut1alice', 'punk-feast', null, T0);
    assert.deepStrictEqual([r.steadBalance, r.owned['punk-feast']], [5, 1]);
    const ledger = await stead.getSteadLedger(pool, 'ut1alice');
    assert.deepStrictEqual(ledger.slice(0, 3).map((e) => [e.type, e.label, e.amount]), [
      ['MARKETPLACE_PURCHASE', 'Marketplace', -60], ['MARKETPLACE_PURCHASE', 'Marketplace', -25], ['MARKETPLACE_PURCHASE', 'Marketplace', -10],
    ]);
    assert.deepStrictEqual(ledger[2].metadata, { foodId: 'grub-snack', quantity: 1 });
  });

  await t.test('too little STEAD is refused and changes nothing', async () => {
    await reset();
    await fund('ut1alice', 24);
    await assert.rejects(marketplace.buy(pool, 'ut1alice', 'monster-meal', null, T0), { code: 'not_enough_stead', status: 409, message: 'Need 25 STEAD.' });
    assert.strictEqual(await stead.getSteadBalance(pool, 'ut1alice'), 24);
    assert.strictEqual((await marketplace.ownedFood(pool, 'ut1alice'))['monster-meal'], 0);
    // A wallet that never had STEAD gets no account either.
    await assert.rejects(marketplace.buy(pool, 'ut1bob', 'grub-snack', null, T0), { code: 'not_enough_stead' });
    assert.strictEqual((await pool.query("SELECT 1 FROM stead_accounts WHERE owner = 'ut1bob'")).rows.length, 0);
    await assert.rejects(marketplace.buy(pool, 'ut1alice', 'cake', null, T0), { code: 'bad_food' });
    await assert.rejects(marketplace.buy(pool, 'ut1alice', 'grub-snack', 'no!', T0), { code: 'bad_request_id' });
  });

  await t.test('the same tap twice charges once', async () => {
    await reset();
    await fund('ut1alice', 100);
    const results = await Promise.all(Array.from({ length: 5 }, () => marketplace.buy(pool, 'ut1alice', 'grub-snack', 'same-tap-0001', T0)));
    assert.strictEqual(results.filter((r) => !r.replayed).length, 1);
    assert.strictEqual(await stead.getSteadBalance(pool, 'ut1alice'), 90);
    assert.strictEqual((await marketplace.ownedFood(pool, 'ut1alice'))['grub-snack'], 1);
  });

  await t.test('many buys at once never overspend', async () => {
    await reset();
    await fund('ut1alice', 75);
    const results = await Promise.allSettled(Array.from({ length: 6 }, (_, i) =>
      marketplace.buy(pool, 'ut1alice', i % 2 ? 'monster-meal' : 'grub-snack', 'tab-' + String(i).padStart(6, '0'), T0)));
    const spent = results.filter((r) => r.status === 'fulfilled').reduce((sum, r) => sum + r.value.bought.price, 0);
    assert.ok(results.filter((r) => r.status === 'rejected').every((r) => r.reason.code === 'not_enough_stead'));
    const balance = await stead.getSteadBalance(pool, 'ut1alice');
    assert.strictEqual(balance, 75 - spent);
    assert.ok(balance >= 0);
    const owned = await marketplace.ownedFood(pool, 'ut1alice');
    assert.strictEqual(owned['grub-snack'] * 10 + owned['monster-meal'] * 25, spent);
  });

  await t.test('a wallet holds at most 99 of one food', async () => {
    await reset();
    await fund('ut1alice', 100);
    await pool.query("INSERT INTO food_inventory (owner, food_id, quantity) VALUES ('ut1alice', 'grub-snack', 99)");
    await assert.rejects(marketplace.buy(pool, 'ut1alice', 'grub-snack', null, T0), { code: 'max_owned' });
    assert.strictEqual(await stead.getSteadBalance(pool, 'ut1alice'), 100);
    await assert.rejects(pool.query("UPDATE food_inventory SET quantity = 100 WHERE owner = 'ut1alice'"), /food_inventory_values/);
    await assert.rejects(pool.query("INSERT INTO food_inventory (owner, food_id, quantity) VALUES ('ut1alice', 'cake', 1)"), /food_inventory_values/);
  });
});
