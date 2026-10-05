// Homesteads: one per wallet, holding the wallet's existing Creature.
// The config test always runs; the database tests need DATABASE_URL (a
// throwaway database: they drop and recreate the game tables).
const test = require('node:test');
const assert = require('node:assert');
const { Pool } = require('pg');
const hcfg = require('../public/js/homestead-config');
const wcfg = require('../public/js/work-config');
const genesis = require('../lib/genesis');
const creatures = require('../lib/creatures');
const homestead = require('../lib/homestead');

test('Homestead config', () => {
  assert.deepStrictEqual(hcfg.START, { level: 1, capacity: 1, storageCapacity: 100 });
  assert.strictEqual(hcfg.BUILDINGS.map((b) => b.name).join(','), 'Barn,Mine,Lumber Camp,Fishing Hut,Workshop,Mystic Shrine');
  for (const b of hcfg.BUILDINGS) assert.ok(b.description.length > 10, b.id);
  assert.deepStrictEqual(hcfg.BUILDING_START, { level: 0, unlocked: false });
  const empty = hcfg.emptyStorage();
  assert.strictEqual(Object.keys(empty).length, hcfg.RESOURCES.length);
  assert.ok(Object.values(empty).every((v) => v === 0));
  assert.strictEqual(hcfg.storageUsed(empty), 0);
  assert.strictEqual(hcfg.formatId(1), '#0001');
});

const url = process.env.DATABASE_URL;

test('Homesteads in Postgres', { skip: !url && 'DATABASE_URL is not set' }, async (t) => {
  const pool = new Pool({ connectionString: url });
  t.after(() => pool.end());

  async function reset() {
    await pool.query('DROP TABLE IF EXISTS homestead_buildings, homesteads, creatures, seeds, genesis_wallets, creature_supply CASCADE');
    await genesis.ensureSchema(pool);
    await homestead.ensureSchema(pool);
    await homestead.ensureSchema(pool);
  }
  async function awakenFor(wallet) {
    const m = await genesis.mint(pool, wallet, wallet);
    return (await genesis.awaken(pool, wallet, m.seed.seedId)).creature;
  }
  async function count(table) {
    return (await pool.query(`SELECT COUNT(*)::int AS n FROM ${table}`)).rows[0].n;
  }

  await t.test('no Creature: nothing is created', async () => {
    await reset();
    assert.deepStrictEqual(await homestead.open(pool, 'ut1alice'), { created: false, homestead: null, creature: null });
    await genesis.mint(pool, 'ut1alice', 'alice'); // a dormant Seed is not a Creature
    assert.strictEqual((await homestead.open(pool, 'ut1alice')).homestead, null);
    assert.strictEqual(await count('homesteads'), 0);
  });

  await t.test('first open creates the Homestead with its Creature, later opens return the same one', async () => {
    await reset();
    const c = await awakenFor('ut1alice');
    const first = await homestead.open(pool, 'ut1alice');
    assert.strictEqual(first.created, true);
    const h = first.homestead;
    assert.strictEqual(h.owner, 'ut1alice');
    assert.strictEqual(h.level, 1);
    assert.strictEqual(h.capacity, 1);
    assert.strictEqual(h.creatureId, c.creatureId);
    assert.strictEqual(h.storageCapacity, 100);
    assert.strictEqual(h.storageUsed, 0);
    assert.deepStrictEqual(h.storage, hcfg.emptyStorage());
    // Only the building of the Creature's Trade is unlocked (PR #5 Work).
    const tradeBuilding = wcfg.buildingFor(c.trade);
    assert.deepStrictEqual(h.buildings.map((b) => [b.buildingId, b.level, b.unlocked]),
      hcfg.BUILDINGS.map((b) => (b.id === tradeBuilding ? [b.id, 1, true] : [b.id, 0, false])));
    assert.deepStrictEqual(first.creature, c, 'the Creature is the stored one, unchanged');

    for (let i = 0; i < 3; i++) {
      const again = await homestead.open(pool, 'ut1alice');
      assert.strictEqual(again.created, false);
      assert.deepStrictEqual(again.homestead, h);
      assert.deepStrictEqual(again.creature, c);
    }
    assert.strictEqual(await count('homesteads'), 1);
    await awakenFor('ut1bob');
    assert.strictEqual((await homestead.open(pool, 'ut1bob')).homestead.homesteadId, h.homesteadId + 1, 'reopening never uses up a number');
    assert.strictEqual(await count('creatures'), 2, 'opening never makes a Creature');
    assert.strictEqual(await count('homestead_buildings'), 2 * hcfg.BUILDINGS.length);
    assert.deepStrictEqual(await creatures.getById(pool, c.creatureId), c);
  });

  await t.test('concurrent opens make exactly one Homestead', async () => {
    await reset();
    await awakenFor('ut1alice');
    const results = await Promise.all(Array.from({ length: 8 }, () => homestead.open(pool, 'ut1alice')));
    assert.strictEqual(results.filter((r) => r.created).length, 1);
    assert.strictEqual(new Set(results.map((r) => r.homestead.homesteadId)).size, 1);
    assert.strictEqual(await count('homesteads'), 1);
  });

  await t.test('each wallet gets its own Homestead and only its own Creature', async () => {
    await reset();
    const a = await awakenFor('ut1alice');
    const b = await awakenFor('ut1bob');
    const ha = await homestead.open(pool, 'ut1alice');
    const hb = await homestead.open(pool, 'ut1bob');
    assert.notStrictEqual(ha.homestead.homesteadId, hb.homestead.homesteadId);
    assert.strictEqual(ha.creature.creatureId, a.creatureId);
    assert.strictEqual(hb.creature.creatureId, b.creatureId);
  });

  await t.test('a transferred Creature moves to its new owner\'s Homestead', async () => {
    await reset();
    const a = await awakenFor('ut1alice');
    const before = await homestead.open(pool, 'ut1alice');
    // A future Marketplace transfer changes only creatures.owner.
    await pool.query("UPDATE creatures SET owner = 'ut1bob' WHERE id = $1", [a.creatureId]);
    // Read-only: the old owner's Homestead no longer shows it.
    const viewed = await homestead.getById(pool, before.homestead.homesteadId);
    assert.strictEqual(viewed.creature, null);
    assert.strictEqual(viewed.homestead.creatureId, null);
    // The new owner gets a Homestead with the Creature, even before Alice reopens hers.
    const bob = await homestead.open(pool, 'ut1bob');
    assert.strictEqual(bob.created, true);
    assert.strictEqual(bob.creature.creatureId, a.creatureId);
    const alice = await homestead.open(pool, 'ut1alice');
    assert.strictEqual(alice.homestead.homesteadId, before.homestead.homesteadId, 'Alice keeps her Homestead');
    assert.strictEqual(alice.creature, null);
    assert.strictEqual(alice.homestead.creatureId, null);
  });

  await t.test('getById reads without creating or changing anything', async () => {
    await reset();
    const c = await awakenFor('ut1alice');
    assert.strictEqual(await homestead.getById(pool, 1), null);
    const opened = await homestead.open(pool, 'ut1alice');
    const viewed = await homestead.getById(pool, opened.homestead.homesteadId);
    assert.deepStrictEqual(viewed, { homestead: opened.homestead, creature: c });
  });

  await t.test('storage can never pass its capacity or go negative', async () => {
    await reset();
    await awakenFor('ut1alice');
    const { homestead: h } = await homestead.open(pool, 'ut1alice');
    const set = (storage) => pool.query('UPDATE homesteads SET storage = $2 WHERE id = $1', [h.homesteadId, JSON.stringify(storage)]);
    await assert.rejects(set(Object.assign(hcfg.emptyStorage(), { wood: 101 })));
    await assert.rejects(set(Object.assign(hcfg.emptyStorage(), { wood: 60, stone: 41 })));
    await assert.rejects(set(Object.assign(hcfg.emptyStorage(), { wood: -1 })));
    await assert.rejects(set(Object.assign(hcfg.emptyStorage(), { wood: 'lots' })));
    await assert.rejects(pool.query('UPDATE homesteads SET storage_capacity = -1 WHERE id = $1', [h.homesteadId]));
    await set(Object.assign(hcfg.emptyStorage(), { wood: 60, stone: 40 }));
    const again = await homestead.open(pool, 'ut1alice');
    assert.strictEqual(again.homestead.storageUsed, 100);
  });

  await t.test('a Homestead\'s id, owner and creation time are permanent', async () => {
    await reset();
    await awakenFor('ut1alice');
    const { homestead: h } = await homestead.open(pool, 'ut1alice');
    await assert.rejects(pool.query("UPDATE homesteads SET owner = 'ut1bob' WHERE id = $1", [h.homesteadId]));
    await assert.rejects(pool.query('UPDATE homesteads SET created_at = NOW() - interval \'1 day\' WHERE id = $1', [h.homesteadId]));
    await assert.rejects(pool.query('DELETE FROM homesteads WHERE id = $1', [h.homesteadId]));
  });
});
