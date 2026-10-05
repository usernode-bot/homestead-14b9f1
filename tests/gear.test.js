// Gear: the starter catalog, the effective-stat calculation with Gear, and
// equip / replace / unequip in Postgres.
// The config tests always run; the database tests need DATABASE_URL (a
// throwaway database: they drop and recreate the game tables).
const test = require('node:test');
const assert = require('node:assert');
const { Pool } = require('pg');
const cfg = require('../public/js/gear-config');
const care = require('../public/js/care-config');
const creatureCfg = require('../public/js/creature-config');
const genesis = require('../lib/genesis');
const { fundAndMint } = require('./support');
const creatures = require('../lib/creatures');
const homestead = require('../lib/homestead');
const work = require('../lib/work');
const stead = require('../lib/stead');
const careLib = require('../lib/care');
const gear = require('../lib/gear');

test('Gear catalog is complete and uses the six rarity tiers', () => {
  assert.deepStrictEqual(cfg.SLOTS.map((s) => s.id), ['tool', 'accessory']);
  const rarities = creatureCfg.RARITIES.map((r) => r.id);
  const statKeys = cfg.STATS.map((s) => s.key);
  assert.deepStrictEqual(statKeys, care.TRAINABLE_STATS.slice());
  assert.strictEqual(new Set(cfg.CATALOG.map((i) => i.id)).size, cfg.CATALOG.length);
  for (const item of cfg.CATALOG) {
    assert.ok(rarities.includes(item.rarity), item.id);
    assert.ok(cfg.isSlot(item.type), item.id);
    for (const [k, v] of Object.entries(item.stats)) {
      assert.ok(statKeys.includes(k), item.id + ' ' + k);
      assert.ok(Number.isInteger(v) && v > 0, item.id + ' ' + k);
    }
  }
  for (const id of cfg.STARTER_KIT) assert.ok(cfg.byId(cfg.CATALOG, id), id);
  assert.strictEqual(cfg.formatId(1), 'GEAR-001');
  assert.deepStrictEqual(cfg.statLines({ speed: 3, attack: 12 }).map((l) => l.short + ' +' + l.value), ['ATK +12', 'SPD +3']);
});

test('effective stats are base + training + Gear, and Gear changes neither', () => {
  const c = {
    stats: { hp: 100, attack: 42, defense: 38, speed: 31, luck: 12 },
    trainingBonus: { hp: 0, attack: 5, defense: 0, speed: 0, luck: 0 },
    gear: { tool: { stats: { attack: 12, speed: 3 } }, accessory: { stats: { luck: 8 } } },
  };
  assert.deepStrictEqual(care.gearBonuses(c), { hp: 0, attack: 12, defense: 0, speed: 3, luck: 8 });
  assert.strictEqual(care.effectiveStat(c, 'attack'), 59);
  assert.deepStrictEqual(care.effectiveStats(c), { hp: 100, attack: 59, defense: 38, speed: 34, luck: 20 });
  assert.strictEqual(c.stats.attack, 42);
  assert.strictEqual(c.trainingBonus.attack, 5);
  c.gear.tool = null;
  assert.strictEqual(care.effectiveStat(c, 'attack'), 47);
  assert.strictEqual(care.effectiveStat({ stats: { attack: 42 }, trainingBonus: { attack: 5 } }, 'attack'), 47);
});

const url = process.env.DATABASE_URL;

test('Gear in Postgres', { skip: !url && 'DATABASE_URL is not set' }, async (t) => {
  const pool = new Pool({ connectionString: url });
  t.after(() => pool.end());

  async function reset() {
    await pool.query(`DROP TABLE IF EXISTS contest_creature_locks, contests, contest_challenges, gear_starter_claims, gear_items, creature_care_log, stead_ledger, stead_accounts,
      creature_work, homestead_buildings, homesteads, creatures, seeds, genesis_wallets CASCADE`);
    await genesis.ensureSchema(pool);
    await homestead.ensureSchema(pool);
    await work.ensureSchema(pool);
    await stead.ensureSchema(pool);
    await careLib.ensureSchema(pool);
    await gear.ensureSchema(pool); // idempotent
    await require('../lib/contests').ensureSchema(pool);
  }
  async function creatureFor(wallet) {
    const m = await fundAndMint(pool, wallet, wallet);
    return (await genesis.awaken(pool, wallet, m.seed.seedId)).creature;
  }
  async function kit(wallet) {
    const claimed = await gear.claimStarter(pool, wallet);
    const by = {};
    for (const g of claimed.granted) by[g.catalogId] = g.gearId;
    return by;
  }
  async function rowOf(id) {
    return (await pool.query('SELECT * FROM gear_items WHERE id = $1', [id])).rows[0];
  }

  await t.test('the starter kit is given once per wallet, with its metadata stored', async () => {
    await reset();
    const first = await gear.claimStarter(pool, 'ut1alice');
    assert.strictEqual(first.alreadyClaimed, false);
    assert.strictEqual(first.granted.length, cfg.STARTER_KIT.length);
    const hammer = first.granted.find((g) => g.catalogId === 'moon-hammer');
    assert.deepStrictEqual(
      { name: hammer.name, rarity: hammer.rarity, type: hammer.type, stats: hammer.stats, trait: hammer.trait, owner: hammer.owner, equippedCreatureId: hammer.equippedCreatureId },
      { name: 'Moon Hammer', rarity: 'rare', type: 'tool', stats: { attack: 12, speed: 3 }, trait: null, owner: 'ut1alice', equippedCreatureId: null }
    );
    assert.match(hammer.code, /^GEAR-\d{3,}$/);
    const again = await Promise.all([gear.claimStarter(pool, 'ut1alice'), gear.claimStarter(pool, 'ut1alice')]);
    assert.ok(again.every((r) => r.alreadyClaimed && r.granted.length === 0));
    const inv = await gear.inventory(pool, 'ut1alice');
    assert.strictEqual(inv.items.length, cfg.STARTER_KIT.length);
    assert.strictEqual(inv.starterClaimed, true);
    assert.deepStrictEqual(await gear.inventory(pool, 'ut1bob'), { walletId: 'ut1bob', items: [], starterClaimed: false });
  });

  await t.test('equip, replace and unequip change only the Gear, and persist', async () => {
    await reset();
    const c = await creatureFor('ut1alice');
    const g = await kit('ut1alice');
    const before = await creatures.getById(pool, c.creatureId);
    assert.deepStrictEqual(before.gear, { tool: null, accessory: null });
    assert.deepStrictEqual(before.effectiveStats, before.stats);

    const r1 = await gear.equip(pool, 'ut1alice', c.creatureId, g['moon-hammer'], 'tool');
    assert.strictEqual(r1.replaced, null);
    await gear.equip(pool, 'ut1alice', c.creatureId, g['lucky-bone'], 'accessory');
    // Read back fresh, as after a refresh.
    let now = await creatures.getById(pool, c.creatureId);
    assert.strictEqual(now.gear.tool.gearId, g['moon-hammer']);
    assert.strictEqual(now.gear.accessory.gearId, g['lucky-bone']);
    assert.deepStrictEqual(now.stats, before.stats);
    assert.deepStrictEqual(now.trainingBonus, before.trainingBonus);
    assert.strictEqual(now.gearBonus.attack, 12);
    assert.strictEqual(now.effectiveStats.attack, before.stats.attack + 12);
    assert.strictEqual(now.effectiveStats.speed, before.stats.speed + 3);
    assert.strictEqual(now.effectiveStats.luck, before.stats.luck + 8);
    assert.deepStrictEqual((await creatures.listOwned(pool, 'ut1alice'))[0].effectiveStats, now.effectiveStats);

    // Equipping it again changes nothing.
    const again = await gear.equip(pool, 'ut1alice', c.creatureId, g['moon-hammer'], 'tool');
    assert.strictEqual(again.alreadyEquipped, true);

    // Replace: the old Tool goes back to the inventory, never destroyed.
    const r2 = await gear.equip(pool, 'ut1alice', c.creatureId, g['iron-drill'], 'tool');
    assert.strictEqual(r2.replaced.gearId, g['moon-hammer']);
    assert.strictEqual((await rowOf(g['moon-hammer'])).equipped_creature_id, null);
    assert.strictEqual((await rowOf(g['iron-drill'])).equipped_creature_id, c.creatureId);
    now = await creatures.getById(pool, c.creatureId);
    assert.strictEqual(now.effectiveStats.attack, before.stats.attack + 18);
    assert.strictEqual(now.effectiveStats.defense, before.stats.defense + 5);
    assert.strictEqual((await gear.inventory(pool, 'ut1alice')).items.length, cfg.STARTER_KIT.length);

    // Unequip: the bonus is gone at once; a second unequip changes nothing.
    const off = await gear.unequip(pool, 'ut1alice', c.creatureId, 'tool');
    assert.strictEqual(off.unequipped.gearId, g['iron-drill']);
    assert.strictEqual((await gear.unequip(pool, 'ut1alice', c.creatureId, 'tool')).alreadyEmpty, true);
    now = await creatures.getById(pool, c.creatureId);
    assert.strictEqual(now.gear.tool, null);
    assert.strictEqual(now.effectiveStats.attack, before.stats.attack);
    assert.strictEqual(now.effectiveStats.luck, before.stats.luck + 8);
    // Nothing was spent and no STEAD entry was written (besides the Genesis
    // that made the Creature, and the test credit that paid for it).
    assert.strictEqual((await pool.query("SELECT COUNT(*)::int AS n FROM stead_ledger WHERE type <> 'GENESIS' AND NOT (metadata ? 'test')")).rows[0].n, 0);
  });

  await t.test('only the owner equips their own Gear on their own Creature, in the right slot', async () => {
    await reset();
    const a = await creatureFor('ut1alice');
    const b = await creatureFor('ut1bob');
    const ga = await kit('ut1alice');
    const gb = await kit('ut1bob');
    await assert.rejects(gear.equip(pool, 'ut1alice', a.creatureId, gb['moon-hammer'], 'tool'), { code: 'not_your_gear', status: 403 });
    await assert.rejects(gear.equip(pool, 'ut1alice', b.creatureId, ga['moon-hammer'], 'tool'), { code: 'not_yours', status: 403 });
    await assert.rejects(gear.equip(pool, 'ut1alice', a.creatureId, ga['moon-hammer'], 'accessory'), { code: 'wrong_slot' });
    await assert.rejects(gear.equip(pool, 'ut1alice', a.creatureId, ga['moon-hammer'], 'hat'), { code: 'bad_slot' });
    await assert.rejects(gear.equip(pool, 'ut1alice', a.creatureId, 999999, 'tool'), { code: 'not_found' });
    await gear.equip(pool, 'ut1bob', b.creatureId, gb['moon-hammer'], 'tool');
    await assert.rejects(gear.unequip(pool, 'ut1alice', b.creatureId, 'tool'), { code: 'not_yours' });
    assert.strictEqual((await rowOf(gb['moon-hammer'])).equipped_creature_id, b.creatureId);
    // The database itself refuses Gear on a Creature its owner doesn't own,
    // two items in one slot, and destroying Gear.
    await assert.rejects(pool.query('UPDATE gear_items SET equipped_creature_id = $2 WHERE id = $1', [ga['iron-drill'], b.creatureId]), /owner owns/);
    await assert.rejects(pool.query('UPDATE gear_items SET equipped_creature_id = $2 WHERE id = $1', [gb['iron-drill'], b.creatureId]), /gear_items_one_per_slot/);
    await assert.rejects(pool.query('DELETE FROM gear_items WHERE id = $1', [ga['rusty-wrench']]), /never be destroyed/);
    await assert.rejects(pool.query("UPDATE gear_items SET stats = '{\"attack\":99}' WHERE id = $1", [ga['rusty-wrench']]), /can never change/);
  });

  await t.test('an item is never on two Creatures, whatever the timing', async () => {
    await reset();
    const a = await creatureFor('ut1alice');
    const b = await creatureFor('ut1bob');
    // Alice now owns both Creatures (a future transfer changes only owner).
    await pool.query('UPDATE creatures SET owner = $1 WHERE id = $2', ['ut1alice', b.creatureId]);
    const g = await kit('ut1alice');
    const results = await Promise.allSettled([
      gear.equip(pool, 'ut1alice', a.creatureId, g['moon-hammer'], 'tool'),
      gear.equip(pool, 'ut1alice', b.creatureId, g['moon-hammer'], 'tool'),
    ]);
    assert.strictEqual(results.filter((r) => r.status === 'fulfilled').length, 1);
    assert.strictEqual(results.find((r) => r.status === 'rejected').reason.code, 'equipped_elsewhere');
    const on = (await pool.query('SELECT COUNT(*)::int AS n FROM gear_items WHERE id = $1 AND equipped_creature_id IS NOT NULL', [g['moon-hammer']])).rows[0].n;
    assert.strictEqual(on, 1);

    // Many taps putting different Tools on one Creature leave exactly one on.
    await gear.unequip(pool, 'ut1alice', a.creatureId, 'tool');
    await gear.unequip(pool, 'ut1alice', b.creatureId, 'tool');
    await Promise.all([g['moon-hammer'], g['iron-drill'], g['rusty-wrench'], g['moon-hammer']].map((id) =>
      gear.equip(pool, 'ut1alice', a.creatureId, id, 'tool')));
    const tools = (await pool.query("SELECT id FROM gear_items WHERE equipped_creature_id = $1 AND type = 'tool'", [a.creatureId])).rows;
    assert.strictEqual(tools.length, 1);
    assert.strictEqual((await gear.inventory(pool, 'ut1alice')).items.length, cfg.STARTER_KIT.length);
  });

  await t.test('Gear stays on through Work, Training and Feeding, and makes no Creature', async () => {
    await reset();
    const c = await creatureFor('ut1alice');
    const g = await kit('ut1alice');
    await gear.equip(pool, 'ut1alice', c.creatureId, g['moon-hammer'], 'tool');
    await homestead.open(pool, 'ut1alice');
    await stead.creditStead(pool, 'ut1alice', 100, 'DAILY_CHECKIN', {}, { key: 'setup' });
    const T0 = new Date('2026-10-05T10:00:00Z');
    await pool.query('UPDATE creatures SET hunger = 50, hunger_updated_at = $2 WHERE id = $1', [c.creatureId, T0]);

    const trained = await careLib.train(pool, 'ut1alice', c.creatureId, 'attack', null, T0);
    assert.strictEqual(trained.creature.trainingBonus.attack, 1);
    assert.strictEqual(trained.creature.gear.tool.gearId, g['moon-hammer']);
    assert.strictEqual(trained.creature.effectiveStats.attack, c.stats.attack + 1 + 12);

    await pool.query("UPDATE homesteads SET storage = jsonb_set(storage, '{fodder}', '3'::jsonb) WHERE owner = $1", ['ut1alice']);
    const fed = await careLib.feed(pool, 'ut1alice', c.creatureId, null, T0);
    assert.strictEqual(fed.creature.care.hunger, 75);
    assert.strictEqual(fed.creature.gear.tool.gearId, g['moon-hammer']);

    await work.start(pool, 'ut1alice', { creatureId: c.creatureId, durationId: '1h' }, T0);
    // Gear can still be changed while working, and is not taken off by Work.
    await gear.equip(pool, 'ut1alice', c.creatureId, g['lucky-bone'], 'accessory');
    const shown = await creatures.getById(pool, c.creatureId, T0);
    assert.strictEqual(shown.gear.tool.gearId, g['moon-hammer']);
    assert.strictEqual(shown.gear.accessory.gearId, g['lucky-bone']);
    assert.strictEqual(shown.stats.attack, c.stats.attack);
    assert.strictEqual((await pool.query('SELECT COUNT(*)::int AS n FROM creatures')).rows[0].n, 1);
  });
});
