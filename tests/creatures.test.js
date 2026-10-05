// Creature generation, identity and naming.
// The generator and name tests always run; the database tests need
// DATABASE_URL (a throwaway database: they drop and recreate the game tables).
const test = require('node:test');
const assert = require('node:assert');
const { Pool } = require('pg');
const cfg = require('../public/js/creature-config');
const names = require('../public/js/creature-name');
const generator = require('../lib/creature-generator');
const genesis = require('../lib/genesis');
const { fundAndMint } = require('./support');
const creatures = require('../lib/creatures');

test('name validator', () => {
  assert.deepStrictEqual(names.validate('  Bambang  '), { ok: true, name: 'Bambang' });
  assert.deepStrictEqual(names.validate('Big   Bruno 2'), { ok: true, name: 'Big Bruno 2' });
  assert.strictEqual(names.validate('Zoë').ok, true);
  for (const bad of ['', '   ', 'B', 'A'.repeat(21), 'Bru<no>', 'Bru\u0000no', 'Bru\nno', 'Bru-no', null, 42]) {
    assert.strictEqual(names.validate(bad).ok, false, JSON.stringify(bad));
  }
  assert.strictEqual(names.validate('A'.repeat(20)).ok, true);
});

test('config is complete and consistent', () => {
  assert.strictEqual(cfg.RARITIES.map((r) => r.label).join(','), 'Common,Uncommon,Rare,Epic,Legendary,Omega');
  assert.ok(cfg.SPECIES.length >= 8 && cfg.SPECIES.length <= 12);
  assert.strictEqual(new Set(cfg.SPECIES.map((s) => s.geneCode)).size, cfg.SPECIES.length);
  assert.ok(cfg.NAME_POOL.length >= 40);
  assert.strictEqual(new Set(cfg.NAME_POOL).size, cfg.NAME_POOL.length, 'no duplicate names');
  for (const n of cfg.NAME_POOL) assert.ok(names.validate(n).ok, n);
  for (const sp of cfg.SPECIES) assert.ok(!cfg.NAME_POOL.includes(sp.label), 'a name is not a Species: ' + sp.label);
  assert.strictEqual(cfg.PERSONALITIES.length, 10);
  assert.strictEqual(cfg.TRADES.map((t) => t.label).join(','), 'Farmer,Miner,Lumberjack,Fisher,Smith,Mystic');
});

test('generator rolls valid, varied Creatures', () => {
  const rng = generator.seededRng('test');
  const seen = { rarity: new Set(), species: new Set(), mutation: new Set(), head: new Set() };
  for (let i = 0; i < 3000; i++) {
    const c = generator.generate(rng);
    const rarity = cfg.byId(cfg.RARITIES, c.rarity);
    assert.ok(rarity && cfg.byId(cfg.SPECIES, c.species));
    assert.ok(cfg.NAME_POOL.includes(c.name));
    assert.ok(cfg.byId(cfg.PERSONALITIES, c.personality) && cfg.byId(cfg.TRADES, c.trade));
    assert.ok(cfg.byId(cfg.MUTATIONS, c.mutation));
    assert.strictEqual(c.appearance.mutation, c.mutation);
    assert.strictEqual(c.level, cfg.START_LEVEL);
    for (const { key } of cfg.STATS) {
      assert.ok(Number.isInteger(c.stats[key]) && c.stats[key] >= 1 && c.stats[key] <= cfg.STAT_RANGES[key].cap);
    }
    if (c.rarity === 'common') assert.ok(['none', 'spikes', 'patches', 'tail'].includes(c.mutation));
    if (c.rarity === 'omega') {
      assert.notStrictEqual(c.mutation, 'none');
      assert.strictEqual(c.appearance.skin, 'void');
    }
    seen.rarity.add(c.rarity); seen.species.add(c.species); seen.mutation.add(c.mutation); seen.head.add(c.appearance.head);
  }
  assert.strictEqual(seen.rarity.size, 6);
  assert.strictEqual(seen.species.size, cfg.SPECIES.length);
  assert.strictEqual(seen.mutation.size, cfg.MUTATIONS.length);
  assert.ok(seen.head.has('gem') && seen.head.has('lobed') && seen.head.has('jagged'), 'high tiers reach unusual silhouettes');
  assert.deepStrictEqual(generator.generate(generator.seededRng('x')), generator.generate(generator.seededRng('x')));
});

const url = process.env.DATABASE_URL;

test('Creatures in Postgres', { skip: !url && 'DATABASE_URL is not set' }, async (t) => {
  const pool = new Pool({ connectionString: url });
  t.after(() => pool.end());

  async function reset() {
    await pool.query('DROP TABLE IF EXISTS contest_creature_locks, contests, contest_challenges, gear_starter_claims, gear_items, creatures, seeds, genesis_wallets, stead_ledger, stead_accounts CASCADE');
    await genesis.ensureSchema(pool);
    await genesis.ensureSchema(pool);
  }
  async function awakenFor(wallet) {
    const m = await fundAndMint(pool, wallet, wallet);
    return genesis.awaken(pool, wallet, m.seed.seedId);
  }

  await t.test('Awaken stores a complete Creature and reads it back unchanged', async () => {
    await reset();
    const a = await awakenFor('ut1alice');
    const c = a.creature;
    assert.ok(names.validate(c.name).ok);
    assert.match(c.gene, /^[A-Z]{4,5}-[0-9A-F]{4}$/);
    assert.ok(c.gene.startsWith(cfg.byId(cfg.SPECIES, c.species).geneCode + '-'));
    for (const key of ['species', 'rarity', 'personality', 'mutation', 'trade']) assert.ok(c[key], key);
    assert.strictEqual(c.level, 1);
    assert.strictEqual(typeof c.appearance, 'object');
    for (let i = 0; i < 3; i++) {
      const again = await genesis.getState(pool, 'ut1alice');
      assert.deepStrictEqual(again.creature, c, 'reloading never re-rolls');
    }
    assert.deepStrictEqual(await creatures.getById(pool, c.creatureId), c);
    assert.deepStrictEqual(await creatures.listOwned(pool, 'ut1alice'), [c]);
    assert.deepStrictEqual(await creatures.listOwned(pool, 'ut1bob'), []);
  });

  await t.test('rename changes only the name, as often as the owner likes', async () => {
    await reset();
    const before = (await awakenFor('ut1alice')).creature;
    const r1 = await creatures.rename(pool, 'ut1alice', before.creatureId, '  Bambang ');
    assert.strictEqual(r1.name, 'Bambang');
    assert.deepStrictEqual(Object.assign({}, r1, { name: before.name }), before);
    const r2 = await creatures.rename(pool, 'ut1alice', before.creatureId, 'Bruno Two');
    assert.strictEqual(r2.name, 'Bruno Two');
    assert.strictEqual(r2.gene, before.gene);
    const s = await genesis.getState(pool, 'ut1alice');
    assert.strictEqual(s.creature.name, 'Bruno Two');
    assert.strictEqual(s.genesis.genesisUsed, true, 'renaming never resets Genesis');
    assert.strictEqual(s.slots.creatures, 1);
    const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM creatures');
    assert.strictEqual(rows[0].n, 1, 'renaming never creates a Creature');
  });

  await t.test('only the owner can rename, and only to a valid name', async () => {
    await reset();
    const c = (await awakenFor('ut1alice')).creature;
    await assert.rejects(creatures.rename(pool, 'ut1bob', c.creatureId, 'Mine Now'), { code: 'not_yours' });
    await assert.rejects(creatures.rename(pool, 'ut1alice', c.creatureId, 'x'), { code: 'bad_name' });
    await assert.rejects(creatures.rename(pool, 'ut1alice', c.creatureId, '<b>hi</b>'), { code: 'bad_name' });
    await pool.query("UPDATE creatures SET owner = 'ut1bob' WHERE id = $1", [c.creatureId]);
    await assert.rejects(creatures.rename(pool, 'ut1alice', c.creatureId, 'Still Mine'), { code: 'not_yours' });
    assert.strictEqual((await creatures.rename(pool, 'ut1bob', c.creatureId, 'New Home')).name, 'New Home');
  });

  await t.test('generated traits and identity can never be changed', async () => {
    await reset();
    const c = (await awakenFor('ut1alice')).creature;
    for (const sql of [
      "UPDATE creatures SET gene = 'GLOOP-0000' WHERE id = $1",
      "UPDATE creatures SET rarity = 'omega' WHERE id = $1",
      'UPDATE creatures SET base_hp = base_hp + 1 WHERE id = $1',
      `UPDATE creatures SET appearance = '{}'::jsonb WHERE id = $1`,
      'UPDATE creatures SET seed_id = seed_id + 1 WHERE id = $1',
    ]) await assert.rejects(pool.query(sql, [c.creatureId]), sql);
  });

  await t.test('concurrent awakens across wallets get unique ids and Genes', async () => {
    await reset();
    const wallets = Array.from({ length: 12 }, (_, i) => 'ut1w' + i);
    const seeds = [];
    for (const w of wallets) seeds.push((await fundAndMint(pool, w, w)).seed.seedId);
    const results = await Promise.all(wallets.map((w, i) => genesis.awaken(pool, w, seeds[i])));
    const ids = results.map((r) => r.creature.creatureId);
    const genes = results.map((r) => r.creature.gene);
    assert.strictEqual(new Set(ids).size, 12);
    assert.strictEqual(new Set(genes).size, 12);
  });

  await t.test('a Gene that is taken is never reused', async () => {
    await reset();
    // The same seeded rng twice would produce the same Gene first.
    const m1 = await fundAndMint(pool, 'ut1a', 'a');
    const m2 = await fundAndMint(pool, 'ut1b', 'b');
    const a = await genesis.awaken(pool, 'ut1a', m1.seed.seedId, generator.seededRng('same'));
    const b = await genesis.awaken(pool, 'ut1b', m2.seed.seedId, generator.seededRng('same'));
    assert.strictEqual(a.creature.species, b.creature.species);
    assert.notStrictEqual(a.creature.gene, b.creature.gene);
  });

  await t.test('a failed Awaken leaves nothing behind', async () => {
    await reset();
    const m = await fundAndMint(pool, 'ut1alice', 7);
    const broken = () => { throw new Error('boom'); };
    await assert.rejects(genesis.awaken(pool, 'ut1alice', m.seed.seedId, broken));
    const s = await genesis.getState(pool, 'ut1alice');
    assert.strictEqual(s.slots.creatures, 0);
    assert.strictEqual(s.creature, null);
    assert.strictEqual(s.seed.status, 'DORMANT');
    const ok = await genesis.awaken(pool, 'ut1alice', m.seed.seedId);
    assert.strictEqual(ok.creature.creatureId, 1);
  });

  await t.test('Creatures from before the generator are filled in once, the same way everywhere', async () => {
    await reset();
    const c = (await awakenFor('ut1alice')).creature;
    // Simulate a PR #2 Creature: drop the trigger, clear the traits.
    await pool.query('ALTER TABLE creatures DISABLE TRIGGER creatures_identity_permanent');
    await pool.query(`UPDATE creatures SET (${creatures.TRAIT_COLUMNS}) = (NULL, NULL, NULL, 1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL)`);
    await pool.query('ALTER TABLE creatures ENABLE TRIGGER creatures_identity_permanent');
    assert.strictEqual(await creatures.backfill(pool), 1);
    const filled = await creatures.getById(pool, c.creatureId);
    assert.ok(filled.gene && filled.name && filled.appearance);
    const expected = generator.generate(generator.seededRng('homestead-creature:' + c.creatureId));
    assert.strictEqual(filled.name, expected.name);
    assert.strictEqual(filled.species, expected.species);
    assert.strictEqual(await creatures.backfill(pool), 0, 'never twice');
    assert.deepStrictEqual(await creatures.getById(pool, c.creatureId), filled);
  });

  await t.test('there is no global Creature cap', async () => {
    await reset();
    await pool.query("SELECT setval('creatures_id_seq', 5000)");
    const a = await awakenFor('ut1last');
    assert.strictEqual(a.creature.creatureId, 5001);
    assert.ok(a.creature.gene);
  });
});
