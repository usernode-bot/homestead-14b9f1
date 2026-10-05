// Genesis -> Seed -> Awaken against a real Postgres.
// Run: DATABASE_URL=postgres://... npm test  (skipped when DATABASE_URL is unset)
// It drops and recreates the game tables, so point it at a throwaway database.
const test = require('node:test');
const assert = require('node:assert');
const { Pool } = require('pg');
const genesis = require('../lib/genesis');
const { MAX_CREATURE_SUPPLY } = require('../public/js/config');

const url = process.env.DATABASE_URL;

test('Genesis, Seed and Awaken', { skip: !url && 'DATABASE_URL is not set' }, async (t) => {
  const pool = new Pool({ connectionString: url });
  t.after(() => pool.end());

  async function reset() {
    await pool.query('DROP TABLE IF EXISTS creatures, seeds, genesis_wallets, creature_supply CASCADE');
    await genesis.ensureSchema(pool);
    await genesis.ensureSchema(pool); // boot twice: idempotent
  }

  await t.test('an unused wallet is eligible and supply starts at 0', async () => {
    await reset();
    const s = await genesis.getState(pool, 'ut1alice');
    assert.deepStrictEqual(s.supply, { created: 0, max: MAX_CREATURE_SUPPLY });
    assert.strictEqual(s.genesis.genesisUsed, false);
    assert.strictEqual(s.seed, null);
  });

  await t.test('concurrent mints create exactly one dormant Seed', async () => {
    await reset();
    const results = await Promise.all(Array.from({ length: 8 }, () => genesis.mint(pool, 'ut1alice', 7)));
    assert.strictEqual(results.filter((r) => r.created).length, 1);
    const { rows } = await pool.query('SELECT * FROM seeds');
    assert.strictEqual(rows.length, 1);
    const s = await genesis.getState(pool, 'ut1alice');
    assert.strictEqual(s.genesis.genesisUsed, true);
    assert.strictEqual(s.genesis.genesisSeedId, rows[0].id);
    assert.strictEqual(s.seed.status, 'DORMANT');
    assert.strictEqual(s.seed.genesis, true);
    assert.strictEqual(s.seed.creatureId, null);
    assert.strictEqual(s.supply.created, 0, 'a Seed is not a Creature');
  });

  await t.test('genesis_used can never be reset or deleted', async () => {
    await reset();
    await genesis.mint(pool, 'ut1alice', 7);
    await assert.rejects(pool.query("UPDATE genesis_wallets SET genesis_used = false WHERE wallet_id = 'ut1alice'"));
    await assert.rejects(pool.query("DELETE FROM genesis_wallets WHERE wallet_id = 'ut1alice'"));
  });

  await t.test('concurrent awakens create one Creature and bump supply once', async () => {
    await reset();
    await pool.query('UPDATE creature_supply SET created = 4821');
    const m = await genesis.mint(pool, 'ut1alice', 7);
    const results = await Promise.all(Array.from({ length: 8 }, () => genesis.awaken(pool, 'ut1alice', m.seed.seedId)));
    assert.strictEqual(results.filter((r) => r.created).length, 1);
    const s = await genesis.getState(pool, 'ut1alice');
    assert.strictEqual(s.supply.created, 4822);
    assert.strictEqual(s.creature.creatureId, 4822);
    assert.strictEqual(s.creature.seedId, m.seed.seedId);
    assert.strictEqual(s.creature.genesis, true);
    assert.strictEqual(s.seed.status, 'AWAKENED');
    assert.strictEqual(s.genesis.genesisCreatureId, 4822);
    const again = await genesis.awaken(pool, 'ut1alice', m.seed.seedId);
    assert.strictEqual(again.created, false);
    assert.strictEqual(again.creature.creatureId, 4822);
    const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM creatures');
    assert.strictEqual(rows[0].n, 1);
  });

  await t.test('another wallet cannot awaken your Seed', async () => {
    await reset();
    const m = await genesis.mint(pool, 'ut1alice', 7);
    await assert.rejects(genesis.awaken(pool, 'ut1bob', m.seed.seedId), { code: 'seed_not_found' });
  });

  await t.test('a transfer keeps Genesis used and the Creature the same', async () => {
    await reset();
    const m = await genesis.mint(pool, 'ut1alice', 7);
    const a = await genesis.awaken(pool, 'ut1alice', m.seed.seedId);
    await pool.query("UPDATE creatures SET owner = 'ut1bob' WHERE id = $1", [a.creature.creatureId]);
    const again = await genesis.mint(pool, 'ut1alice', 7);
    assert.strictEqual(again.created, false);
    assert.strictEqual(again.genesis.genesisUsed, true);
    assert.strictEqual(again.creature.creatureId, a.creature.creatureId);
    assert.strictEqual(again.creature.owner, 'ut1bob');
  });

  await t.test('supply never passes the cap', async () => {
    await reset();
    await pool.query('UPDATE creature_supply SET created = $1', [MAX_CREATURE_SUPPLY - 1]);
    const wallets = ['ut1a', 'ut1b', 'ut1c', 'ut1d'];
    const seeds = [];
    for (const w of wallets) seeds.push((await genesis.mint(pool, w, w)).seed.seedId);
    const results = await Promise.allSettled(wallets.map((w, i) => genesis.awaken(pool, w, seeds[i])));
    assert.strictEqual(results.filter((r) => r.status === 'fulfilled').length, 1);
    for (const r of results.filter((r) => r.status === 'rejected')) assert.strictEqual(r.reason.code, 'sold_out');
    const s = await genesis.getState(pool, null);
    assert.strictEqual(s.supply.created, MAX_CREATURE_SUPPLY);
    const { rows } = await pool.query("SELECT COUNT(*)::int AS n FROM seeds WHERE status = 'DORMANT'");
    assert.strictEqual(rows[0].n, 3, 'a refused awaken leaves the Seed dormant');
    await assert.rejects(genesis.mint(pool, 'ut1late', 9), { code: 'sold_out' });
    const late = await genesis.getState(pool, 'ut1late');
    assert.strictEqual(late.genesis.genesisUsed, false, 'a refused mint does not use the Genesis');
    await assert.rejects(pool.query('UPDATE creature_supply SET created = created + 1'));
  });
});
