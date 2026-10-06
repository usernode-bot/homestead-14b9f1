// The Marketplace: food bought with STEAD, and players' Resource listings.
// The config tests always run; the database tests need DATABASE_URL (a
// throwaway database: they drop and recreate the STEAD, food, listing and
// Homestead tables).
const test = require('node:test');
const assert = require('node:assert');
const { Pool } = require('pg');
const cfg = require('../public/js/food-config');
const stead = require('../lib/stead');
const marketplace = require('../lib/marketplace');
const mcfg = require('../public/js/market-config');
const genesis = require('../lib/genesis');
const homestead = require('../lib/homestead');
const hcfg = require('../public/js/homestead-config');

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
    await pool.query('DROP TABLE IF EXISTS food_inventory, market_listings, stead_ledger, stead_accounts CASCADE');
    // The Marketplace also reads the wallet's Homestead storage.
    await genesis.ensureSchema(pool);
    await homestead.ensureSchema(pool);
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

test('market config', () => {
  assert.strictEqual(mcfg.MAX_ACTIVE_LISTINGS, 10);
  assert.ok(mcfg.validQuantity(1) && !mcfg.validQuantity(0) && !mcfg.validQuantity(1.5));
  assert.ok(mcfg.validPrice(1) && mcfg.validPrice(mcfg.MAX_PRICE) && !mcfg.validPrice(mcfg.MAX_PRICE + 1) && !mcfg.validPrice(-3));
});

test('Resource listings in Postgres', { skip: !url && 'DATABASE_URL is not set' }, async (t) => {
  const pool = new Pool({ connectionString: url });
  t.after(() => pool.end());
  let funds = 0;

  async function reset() {
    await pool.query(`DROP TABLE IF EXISTS food_inventory, market_listings, stead_ledger, stead_accounts, contest_creature_locks, contests,
      contest_challenges, gear_starter_claims, gear_items, creature_care_log, creature_work, homestead_buildings, homesteads CASCADE`);
    await genesis.ensureSchema(pool);
    await homestead.ensureSchema(pool);
    await stead.ensureSchema(pool);
    await marketplace.ensureSchema(pool);
    await marketplace.ensureSchema(pool); // idempotent
  }
  async function fund(owner, amount) {
    await stead.creditStead(pool, owner, amount, 'DAILY_CHECKIN', {}, { key: 'fund-' + (++funds) });
  }
  // A Homestead holding these Resources (and capacity, when given).
  async function home(owner, resources, capacity) {
    await pool.query('INSERT INTO homesteads (owner, storage, storage_capacity) VALUES ($1, $2, $3)',
      [owner, JSON.stringify(Object.assign(hcfg.emptyStorage(), resources)), capacity || 100]);
  }
  async function storage(owner) {
    return (await pool.query('SELECT storage FROM homesteads WHERE owner = $1', [owner])).rows[0].storage;
  }
  const list = (owner, resource, quantity, price, requestId) =>
    marketplace.createListing(pool, owner, owner.slice(3), { resource, quantity, price, requestId }, T0);

  await t.test('listing takes the Resources out of storage and puts them up for sale', async () => {
    await reset();
    await home('ut1sam', { wood: 20, ore: 3 });
    const r = await list('ut1sam', 'wood', 12, 30, 'list-req-0001');
    assert.deepStrictEqual([r.listed.resource, r.listed.label, r.listed.quantity, r.listed.price, r.listed.status, r.listed.sellerName], ['wood', 'Wood', 12, 30, 'active', 'sam']);
    assert.strictEqual((await storage('ut1sam')).wood, 8);
    assert.deepStrictEqual([r.storage.storage.wood, r.storage.used], [8, 11]);
    assert.deepStrictEqual(r.myListings.map((l) => l.listingId), [r.listed.listingId]);
    assert.deepStrictEqual(r.listings, []); // your own aren't shown as for sale
    // Anyone, even without a wallet, sees it for sale.
    const guest = await marketplace.getState(pool, null);
    assert.deepStrictEqual(guest.listings.map((l) => [l.resource, l.quantity, l.price, l.seller]), [['wood', 12, 30, 'ut1sam']]);
    // The same tap again lists nothing more.
    const again = await list('ut1sam', 'wood', 12, 30, 'list-req-0001');
    assert.strictEqual(again.replayed, true);
    assert.strictEqual((await storage('ut1sam')).wood, 8);
    assert.strictEqual((await pool.query('SELECT COUNT(*)::int AS n FROM market_listings')).rows[0].n, 1);
  });

  await t.test('listing refuses what the seller does not have and bad input', async () => {
    await reset();
    await home('ut1sam', { wood: 5 });
    await assert.rejects(list('ut1sam', 'wood', 6, 30), { code: 'not_enough_resource', message: 'You have 5 Wood.' });
    await assert.rejects(list('ut1sam', 'gold', 1, 30), { code: 'bad_resource' });
    await assert.rejects(list('ut1sam', 'wood', 0, 30), { code: 'bad_quantity' });
    await assert.rejects(list('ut1sam', 'wood', 1.5, 30), { code: 'bad_quantity' });
    await assert.rejects(list('ut1sam', 'wood', 1, 0), { code: 'bad_price' });
    await assert.rejects(list('ut1sam', 'wood', 1, mcfg.MAX_PRICE + 1), { code: 'bad_price' });
    await assert.rejects(list('ut1nohome', 'wood', 1, 5), { code: 'no_homestead' });
    await assert.rejects(marketplace.createListing(pool, null, null, { resource: 'wood', quantity: 1, price: 1 }, T0), { code: 'no_wallet' });
    assert.strictEqual((await storage('ut1sam')).wood, 5);
  });

  await t.test('a wallet has at most MAX_ACTIVE_LISTINGS up at once', async () => {
    await reset();
    await home('ut1sam', { stone: 50 });
    for (let i = 0; i < mcfg.MAX_ACTIVE_LISTINGS; i++) await list('ut1sam', 'stone', 1, 1);
    await assert.rejects(list('ut1sam', 'stone', 1, 1), { code: 'max_listings' });
    assert.strictEqual((await storage('ut1sam')).stone, 50 - mcfg.MAX_ACTIVE_LISTINGS);
  });

  await t.test('buying moves exactly the price to the seller and the Resources to the buyer', async () => {
    await reset();
    await home('ut1sam', { wood: 12 });
    await home('ut1bea', { fish: 10 });
    await fund('ut1bea', 100);
    const { listed } = await list('ut1sam', 'wood', 12, 30);
    const r = await marketplace.buyListing(pool, 'ut1bea', 'bea', listed.listingId, T0);
    assert.deepStrictEqual([r.boughtListing.status, r.boughtListing.buyer, r.boughtListing.buyerName], ['sold', 'ut1bea', 'bea']);
    assert.strictEqual(r.steadBalance, 70);
    assert.strictEqual(await stead.getSteadBalance(pool, 'ut1sam'), 30);
    assert.deepStrictEqual([(await storage('ut1bea')).wood, (await storage('ut1bea')).fish, (await storage('ut1sam')).wood], [12, 10, 0]);
    const [paid] = await stead.getSteadLedger(pool, 'ut1bea');
    const [got] = await stead.getSteadLedger(pool, 'ut1sam');
    assert.deepStrictEqual([paid.type, paid.amount, got.type, got.amount], ['RESOURCE_PURCHASE', -30, 'RESOURCE_SALE', 30]);
    assert.deepStrictEqual(got.metadata, { listingId: listed.listingId, resource: 'wood', quantity: 12, buyer: 'ut1bea' });
    // Gone from what is for sale; the seller sees it sold.
    assert.deepStrictEqual((await marketplace.getState(pool, null)).listings, []);
    const seller = await marketplace.getState(pool, 'ut1sam');
    assert.deepStrictEqual(seller.myListings.map((l) => [l.status, l.buyer]), [['sold', 'ut1bea']]);
    // The same buyer again: nothing more happens. Anyone else: already sold.
    const again = await marketplace.buyListing(pool, 'ut1bea', 'bea', listed.listingId, T0);
    assert.strictEqual(again.replayed, true);
    assert.strictEqual(again.steadBalance, 70);
    await home('ut1cal', {});
    await fund('ut1cal', 100);
    await assert.rejects(marketplace.buyListing(pool, 'ut1cal', 'cal', listed.listingId, T0), { code: 'already_sold', status: 409 });
    assert.strictEqual(await stead.getSteadBalance(pool, 'ut1cal'), 100);
    assert.strictEqual(await stead.getSteadBalance(pool, 'ut1sam'), 30);
  });

  await t.test('buying is refused for your own listing or too little STEAD, and changes nothing', async () => {
    await reset();
    await home('ut1sam', { wood: 12 });
    await home('ut1bea', {});
    await fund('ut1sam', 100);
    await fund('ut1bea', 29);
    const { listed } = await list('ut1sam', 'wood', 12, 30);
    await assert.rejects(marketplace.buyListing(pool, 'ut1sam', 'sam', listed.listingId, T0), { code: 'own_listing' });
    await assert.rejects(marketplace.buyListing(pool, 'ut1bea', 'bea', listed.listingId, T0), { code: 'not_enough_stead', message: 'Need 30 STEAD.' });
    await fund('ut1bea', 1);
    await assert.rejects(marketplace.buyListing(pool, 'ut1bea', 'bea', 999999, T0), { code: 'listing_missing', status: 404 });
    assert.deepStrictEqual([await stead.getSteadBalance(pool, 'ut1bea'), await stead.getSteadBalance(pool, 'ut1sam')], [30, 100]);
    assert.strictEqual((await storage('ut1bea')).wood, 0);
    assert.strictEqual((await pool.query('SELECT status FROM market_listings')).rows[0].status, 'active');
  });

  await t.test('many buyers at once: one gets it, the seller is paid once', async () => {
    await reset();
    await home('ut1sam', { crystal: 1 });
    const { listed } = await list('ut1sam', 'crystal', 1, 75);
    const buyers = ['ut1b1', 'ut1b2', 'ut1b3', 'ut1b4', 'ut1b5'];
    for (const b of buyers) { await home(b, {}); await fund(b, 100); }
    const results = await Promise.allSettled(buyers.map((b) => marketplace.buyListing(pool, b, null, listed.listingId, T0)));
    assert.strictEqual(results.filter((r) => r.status === 'fulfilled').length, 1);
    assert.ok(results.filter((r) => r.status === 'rejected').every((r) => r.reason.code === 'already_sold'));
    assert.strictEqual(await stead.getSteadBalance(pool, 'ut1sam'), 75);
    let total = 0;
    for (const b of buyers) total += await stead.getSteadBalance(pool, b);
    assert.strictEqual(total, 500 - 75);
  });

  await t.test('two players buying from each other at once both go through', async () => {
    await reset();
    await home('ut1sam', { wood: 5 });
    await home('ut1bea', { ore: 5 });
    await fund('ut1sam', 50);
    await fund('ut1bea', 50);
    const a = (await list('ut1sam', 'wood', 5, 20)).listed;
    const b = (await list('ut1bea', 'ore', 5, 10)).listed;
    await Promise.all([
      marketplace.buyListing(pool, 'ut1bea', null, a.listingId, T0),
      marketplace.buyListing(pool, 'ut1sam', null, b.listingId, T0),
    ]);
    assert.deepStrictEqual([await stead.getSteadBalance(pool, 'ut1sam'), await stead.getSteadBalance(pool, 'ut1bea')], [60, 40]);
  });

  await t.test('the seller can cancel an unsold listing and gets the Resources back', async () => {
    await reset();
    await home('ut1sam', { wood: 12 });
    await home('ut1bea', {});
    await fund('ut1bea', 100);
    const { listed } = await list('ut1sam', 'wood', 12, 30);
    await assert.rejects(marketplace.cancelListing(pool, 'ut1bea', listed.listingId, T0), { code: 'not_your_listing', status: 403 });
    // Storage always has room, so the Resources come straight back.
    const r = await marketplace.cancelListing(pool, 'ut1sam', listed.listingId, T0);
    assert.strictEqual(r.cancelled.status, 'cancelled');
    assert.strictEqual((await storage('ut1sam')).wood, 12);
    assert.strictEqual((await marketplace.cancelListing(pool, 'ut1sam', listed.listingId, T0)).replayed, true);
    assert.strictEqual((await storage('ut1sam')).wood, 12);
    await assert.rejects(marketplace.buyListing(pool, 'ut1bea', null, listed.listingId, T0), { code: 'listing_cancelled' });
    // A sold listing can't be cancelled.
    const sold = (await list('ut1sam', 'wood', 2, 5)).listed;
    await marketplace.buyListing(pool, 'ut1bea', null, sold.listingId, T0);
    await assert.rejects(marketplace.cancelListing(pool, 'ut1sam', sold.listingId, T0), { code: 'already_sold' });
    assert.strictEqual((await storage('ut1sam')).wood, 10);
  });

  await t.test('a listing never changes what it sells and moves only once', async () => {
    await reset();
    await home('ut1sam', { wood: 12 });
    const { listed } = await list('ut1sam', 'wood', 12, 30);
    await assert.rejects(pool.query('UPDATE market_listings SET price = 1 WHERE id = $1', [listed.listingId]), /can never change/);
    await assert.rejects(pool.query('DELETE FROM market_listings WHERE id = $1', [listed.listingId]), /never be removed/);
    await marketplace.cancelListing(pool, 'ut1sam', listed.listingId, T0);
    await assert.rejects(pool.query("UPDATE market_listings SET status = 'active', closed_at = NULL WHERE id = $1", [listed.listingId]), /can never change/);
    await assert.rejects(pool.query("INSERT INTO market_listings (seller, resource, quantity, price) VALUES ('ut1sam', 'gold', 1, 1)"), /market_listings_values/);
  });
});
