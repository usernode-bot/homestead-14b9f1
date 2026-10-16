// Genesis -> Seed -> Awaken against a real Postgres.
// Run: DATABASE_URL=postgres://... npm test  (skipped when DATABASE_URL is unset)
// It drops and recreates the game tables, so point it at a throwaway database.
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const { Pool } = require('pg');
const genesis = require('../lib/genesis');
const stead = require('../lib/stead');
const { MAX_OWNED_CREATURES, GENESIS_COST } = require('../public/js/config');
const { fundAndMint } = require('./support');

const url = process.env.DATABASE_URL;

test('Genesis, Seed and Awaken', { skip: !url && 'DATABASE_URL is not set' }, async (t) => {
  const pool = new Pool({ connectionString: url });
  t.after(() => pool.end());

  async function reset() {
    await pool.query(`DROP TABLE IF EXISTS contest_creature_locks, contests, contest_challenges, gear_starter_claims, gear_items,
      creatures, seeds, genesis_wallets, stead_ledger, stead_accounts, creature_supply CASCADE`);
    await genesis.ensureSchema(pool);
    await genesis.ensureSchema(pool); // boot twice: idempotent
  }
  async function pay(wallet, amount) {
    await stead.creditStead(pool, wallet, amount, 'DAILY_CHECKIN', { test: true }, { key: 'T-' + crypto.randomUUID() });
  }
  async function balance(wallet) { return stead.getSteadBalance(pool, wallet); }
  async function count(sql, params) { return (await pool.query(sql, params)).rows[0].n; }
  // Give a wallet `n` awakened Creatures through the real path.
  async function creaturesFor(wallet, n) {
    for (let i = 0; i < n; i++) {
      const m = await fundAndMint(pool, wallet, wallet);
      await genesis.awaken(pool, wallet, m.seed.seedId);
    }
  }
  async function snapshot(wallet) {
    return {
      balance: await balance(wallet),
      seeds: await count('SELECT COUNT(*)::int AS n FROM seeds WHERE owner = $1', [wallet]),
      creatures: await count('SELECT COUNT(*)::int AS n FROM creatures WHERE owner = $1', [wallet]),
      genesisEntries: await count("SELECT COUNT(*)::int AS n FROM stead_ledger WHERE owner = $1 AND type = 'GENESIS'", [wallet]),
    };
  }

  await t.test('a new wallet holds nothing; a guest gets no state', async () => {
    await reset();
    const s = await genesis.getState(pool, 'ut1alice');
    assert.deepStrictEqual(s.slots, { owned: 0, creatures: 0, dormantSeeds: 0, max: MAX_OWNED_CREATURES });
    assert.strictEqual(s.genesis.genesisUsed, false);
    assert.strictEqual(s.genesis.cost, GENESIS_COST);
    assert.strictEqual(s.seed, null);
    assert.deepStrictEqual(s.history, []);
    assert.deepStrictEqual(await genesis.getState(pool, null), { genesis: null, slots: null, seed: null, creature: null, history: null });
  });

  await t.test('Genesis spends 500 STEAD on one dormant Seed, which takes a place', async () => {
    await reset();
    await pay('ut1alice', GENESIS_COST);
    const m = await genesis.mint(pool, 'ut1alice', 7);
    assert.strictEqual(m.created, true);
    assert.strictEqual(m.seed.status, 'DORMANT');
    assert.strictEqual(m.seed.genesis, true);
    assert.strictEqual(m.slots.owned, 1);
    assert.strictEqual(m.slots.dormantSeeds, 1);
    assert.strictEqual(await balance('ut1alice'), 0);
    const entries = (await pool.query("SELECT amount::int, metadata FROM stead_ledger WHERE owner = 'ut1alice' AND type = 'GENESIS'")).rows;
    assert.deepStrictEqual(entries, [{ amount: -GENESIS_COST, metadata: { seedId: m.seed.seedId } }]);
    assert.strictEqual(m.history.length, 1);
    assert.strictEqual(m.history[0].cost, GENESIS_COST);
    assert.strictEqual(m.genesis.genesisUsed, true);
  });

  await t.test('refusals come in order (wallet, room, waiting Seed, STEAD) and change nothing', async () => {
    await reset();
    await assert.rejects(genesis.mint(pool, null, 7), { code: 'no_wallet' });

    // Not enough STEAD.
    await pay('ut1poor', GENESIS_COST - 1);
    const poor = await snapshot('ut1poor');
    await assert.rejects(genesis.mint(pool, 'ut1poor', 7), { code: 'not_enough_stead' });
    assert.deepStrictEqual(await snapshot('ut1poor'), poor);
    assert.strictEqual((await genesis.getState(pool, 'ut1poor')).genesis.genesisUsed, false, 'a refused Genesis is not recorded');

    // A Seed still waiting to be awakened.
    const m = await fundAndMint(pool, 'ut1seed', 7);
    await pay('ut1seed', GENESIS_COST);
    const waiting = await snapshot('ut1seed');
    await assert.rejects(genesis.mint(pool, 'ut1seed', 7), { code: 'seed_waiting' });
    assert.deepStrictEqual(await snapshot('ut1seed'), waiting);
    await genesis.awaken(pool, 'ut1seed', m.seed.seedId);

    // A full wallet is refused as full even with no STEAD at all.
    await creaturesFor('ut1full', MAX_OWNED_CREATURES);
    assert.strictEqual(await balance('ut1full'), 0);
    const full = await snapshot('ut1full');
    await assert.rejects(genesis.mint(pool, 'ut1full', 7), { code: 'collection_full' });
    await pay('ut1full', GENESIS_COST);
    await assert.rejects(genesis.mint(pool, 'ut1full', 7), { code: 'collection_full' });
    assert.deepStrictEqual(await snapshot('ut1full'), Object.assign(full, { balance: GENESIS_COST }));
    assert.strictEqual((await genesis.getState(pool, 'ut1full')).slots.owned, MAX_OWNED_CREATURES);
  });

  await t.test('Genesis can be used again once the Seed is awakened', async () => {
    await reset();
    const m1 = await fundAndMint(pool, 'ut1alice', 7);
    const a1 = await genesis.awaken(pool, 'ut1alice', m1.seed.seedId);
    const m2 = await fundAndMint(pool, 'ut1alice', 7);
    assert.strictEqual(m2.created, true);
    assert.notStrictEqual(m2.seed.seedId, m1.seed.seedId);
    const a2 = await genesis.awaken(pool, 'ut1alice', m2.seed.seedId);
    assert.notStrictEqual(a2.creature, null);
    assert.strictEqual(a2.slots.creatures, 2);
    assert.strictEqual(a2.creature.creatureId, a1.creature.creatureId, 'My Creature stays the first one');
    assert.deepStrictEqual(a2.history.map((h) => h.seedId), [m2.seed.seedId, m1.seed.seedId]);
    assert.ok(a2.history.every((h) => h.status === 'AWAKENED' && h.creatureId));
    assert.strictEqual(a2.genesis.genesisUsed, true);
  });

  await t.test('two Geneses racing for the 10th place: one Seed, one charge', async () => {
    await reset();
    await creaturesFor('ut1alice', MAX_OWNED_CREATURES - 1);
    await pay('ut1alice', GENESIS_COST * 2);
    const results = await Promise.allSettled(Array.from({ length: 8 }, () => genesis.mint(pool, 'ut1alice', 7)));
    const ok = results.filter((r) => r.status === 'fulfilled' && r.value.created);
    assert.strictEqual(ok.length, 1);
    for (const r of results.filter((r) => r.status === 'rejected')) assert.strictEqual(r.reason.code, 'collection_full');
    const s = await genesis.getState(pool, 'ut1alice');
    assert.strictEqual(s.slots.owned, MAX_OWNED_CREATURES);
    assert.strictEqual(await balance('ut1alice'), GENESIS_COST);
    assert.strictEqual(await count("SELECT COUNT(*)::int AS n FROM stead_ledger WHERE owner = 'ut1alice' AND type = 'GENESIS'"), MAX_OWNED_CREATURES);
  });

  await t.test('a repeated tap (same requestId) makes one Seed and one charge', async () => {
    await reset();
    await pay('ut1alice', GENESIS_COST * 3);
    const results = await Promise.all(Array.from({ length: 8 }, () => genesis.mint(pool, 'ut1alice', 7, { requestId: 'tap-0000001' })));
    assert.strictEqual(results.filter((r) => r.created).length, 1);
    assert.ok(results.every((r) => r.seed && r.seed.seedId === results[0].seed.seedId));
    assert.strictEqual(await count('SELECT COUNT(*)::int AS n FROM seeds'), 1);
    assert.strictEqual(await balance('ut1alice'), GENESIS_COST * 2);
    await assert.rejects(genesis.mint(pool, 'ut1alice', 7, { requestId: 'bad id!' }), { code: 'bad_request_id' });
  });

  await t.test('concurrent different taps still make one Seed: one waits at a time', async () => {
    await reset();
    await pay('ut1alice', GENESIS_COST * 3);
    const results = await Promise.allSettled(Array.from({ length: 6 }, () => genesis.mint(pool, 'ut1alice', 7, { requestId: crypto.randomUUID() })));
    assert.strictEqual(results.filter((r) => r.status === 'fulfilled' && r.value.created).length, 1);
    for (const r of results.filter((r) => r.status === 'rejected')) assert.strictEqual(r.reason.code, 'seed_waiting');
    assert.strictEqual(await balance('ut1alice'), GENESIS_COST * 2);
  });

  await t.test('a full wallet with a waiting Seed can still awaken it', async () => {
    await reset();
    await creaturesFor('ut1alice', MAX_OWNED_CREATURES - 1);
    const m = await fundAndMint(pool, 'ut1alice', 7);
    assert.strictEqual(m.slots.owned, MAX_OWNED_CREATURES);
    const a = await genesis.awaken(pool, 'ut1alice', m.seed.seedId);
    assert.strictEqual(a.created, true);
    assert.deepStrictEqual(a.slots, { owned: MAX_OWNED_CREATURES, creatures: MAX_OWNED_CREATURES, dormantSeeds: 0, max: MAX_OWNED_CREATURES });
  });

  await t.test('genesis_used can never be reset or deleted', async () => {
    await reset();
    await fundAndMint(pool, 'ut1alice', 7);
    await assert.rejects(pool.query("UPDATE genesis_wallets SET genesis_used = false WHERE wallet_id = 'ut1alice'"));
    await assert.rejects(pool.query("DELETE FROM genesis_wallets WHERE wallet_id = 'ut1alice'"));
  });

  await t.test('concurrent awakens create one Creature, numbered by the sequence', async () => {
    await reset();
    await pool.query("SELECT setval('creatures_id_seq', 4821)");
    const m = await fundAndMint(pool, 'ut1alice', 7);
    const results = await Promise.all(Array.from({ length: 8 }, () => genesis.awaken(pool, 'ut1alice', m.seed.seedId)));
    assert.strictEqual(results.filter((r) => r.created).length, 1);
    const s = await genesis.getState(pool, 'ut1alice');
    assert.strictEqual(s.creature.creatureId, 4822);
    assert.strictEqual(s.creature.seedId, m.seed.seedId);
    assert.strictEqual(s.creature.genesis, true);
    assert.strictEqual(s.seed, null, 'no Seed is waiting any more');
    assert.strictEqual(s.history[0].creatureId, 4822);
    const again = await genesis.awaken(pool, 'ut1alice', m.seed.seedId);
    assert.strictEqual(again.created, false);
    assert.strictEqual(again.creature.creatureId, 4822);
    assert.strictEqual(await count('SELECT COUNT(*)::int AS n FROM creatures'), 1);
  });

  await t.test('another wallet cannot awaken your Seed', async () => {
    await reset();
    const m = await fundAndMint(pool, 'ut1alice', 7);
    await assert.rejects(genesis.awaken(pool, 'ut1bob', m.seed.seedId), { code: 'seed_not_found' });
  });

  await t.test('the count follows current ownership, not who made the Creature', async () => {
    await reset();
    const m = await fundAndMint(pool, 'ut1alice', 7);
    const a = await genesis.awaken(pool, 'ut1alice', m.seed.seedId);
    await pool.query("UPDATE creatures SET owner = 'ut1bob' WHERE id = $1", [a.creature.creatureId]);
    const alice = await genesis.getState(pool, 'ut1alice');
    const bob = await genesis.getState(pool, 'ut1bob');
    assert.strictEqual(alice.slots.owned, 0);
    assert.strictEqual(alice.creature, null);
    assert.strictEqual(alice.genesis.genesisUsed, true);
    assert.strictEqual(alice.history.length, 1, 'Genesis history stays with the wallet that used it');
    assert.strictEqual(bob.slots.owned, 1);
    assert.strictEqual(bob.creature.creatureId, a.creature.creatureId);
    assert.strictEqual(bob.genesis.genesisUsed, false, 'receiving a Creature is not using Genesis');
  });

  await t.test('there is no global Creature cap', async () => {
    await reset();
    await pool.query("SELECT setval('creatures_id_seq', 5000)");
    const m = await fundAndMint(pool, 'ut1alice', 7);
    const a = await genesis.awaken(pool, 'ut1alice', m.seed.seedId);
    assert.strictEqual(a.creature.creatureId, 5001);
  });

  await t.test('the old supply counter carries over into the id sequence, then goes', async () => {
    await reset();
    // A database from before: the counter at 41 (a rollback skipped 41).
    await pool.query('DROP SEQUENCE creatures_id_seq CASCADE');
    await pool.query('CREATE TABLE creature_supply (id INT PRIMARY KEY, created INT NOT NULL)');
    await pool.query('INSERT INTO creature_supply VALUES (1, 41)');
    await genesis.ensureSchema(pool);
    assert.strictEqual((await pool.query("SELECT to_regclass('creature_supply') AS t")).rows[0].t, null);
    const m = await fundAndMint(pool, 'ut1alice', 7);
    const a = await genesis.awaken(pool, 'ut1alice', m.seed.seedId);
    assert.strictEqual(a.creature.creatureId, 42);
  });
});
