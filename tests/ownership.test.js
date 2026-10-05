// The per-wallet Creature cap and the transfer rule a future Marketplace must
// use (lib/ownership.js), against a real Postgres. Skipped without
// DATABASE_URL; it drops and recreates the game tables.
const test = require('node:test');
const assert = require('node:assert');
const { Pool } = require('pg');
const genesis = require('../lib/genesis');
const ownership = require('../lib/ownership');
const { MAX_OWNED_CREATURES } = require('../public/js/config');
const { fundAndMint } = require('./support');

const url = process.env.DATABASE_URL;

test('Ownership cap and transfers', { skip: !url && 'DATABASE_URL is not set' }, async (t) => {
  const pool = new Pool({ connectionString: url });
  t.after(() => pool.end());

  async function reset() {
    await pool.query(`DROP TABLE IF EXISTS contest_creature_locks, contests, contest_challenges, gear_starter_claims, gear_items,
      creatures, seeds, genesis_wallets, stead_ledger, stead_accounts CASCADE`);
    await genesis.ensureSchema(pool);
  }
  async function creaturesFor(wallet, n) {
    const ids = [];
    for (let i = 0; i < n; i++) {
      const m = await fundAndMint(pool, wallet, wallet);
      await genesis.awaken(pool, wallet, m.seed.seedId);
      ids.push((await pool.query('SELECT creature_id FROM seeds WHERE id = $1', [m.seed.seedId])).rows[0].creature_id);
    }
    return ids;
  }
  async function inTx(fn) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const r = await fn(client);
      await client.query('COMMIT');
      return r;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }
  const move = (id, from, to) => inTx((db) => ownership.transferCreature(db, id, from, to));
  async function genesisRows() {
    return (await pool.query('SELECT * FROM genesis_wallets ORDER BY wallet_id')).rows;
  }

  await t.test('the count is owned Creatures plus waiting Seeds', async () => {
    await reset();
    await creaturesFor('ut1alice', 2);
    await fundAndMint(pool, 'ut1alice', 'ut1alice');
    assert.deepStrictEqual(await ownership.ownedCount(pool, 'ut1alice'),
      { owned: 3, creatures: 2, dormantSeeds: 1, max: MAX_OWNED_CREATURES });
  });

  await t.test('a completed transfer moves the Creature and the places, and never Genesis', async () => {
    await reset();
    const [id] = await creaturesFor('ut1seller', 1);
    await creaturesFor('ut1buyer', 1);
    const before = await genesisRows();
    // Listed (or anything short of a completed sale) leaves it the seller's.
    assert.strictEqual((await ownership.ownedCount(pool, 'ut1seller')).owned, 1);
    await move(id, 'ut1seller', 'ut1buyer');
    assert.strictEqual((await ownership.ownedCount(pool, 'ut1seller')).owned, 0);
    assert.strictEqual((await ownership.ownedCount(pool, 'ut1buyer')).owned, 2);
    const row = (await pool.query('SELECT owner, created_by, genesis FROM creatures WHERE id = $1', [id])).rows[0];
    assert.deepStrictEqual(row, { owner: 'ut1buyer', created_by: 'ut1seller', genesis: true });
    assert.deepStrictEqual(await genesisRows(), before, 'no Genesis record changes');
  });

  await t.test('a buyer at the limit is refused and nothing changes', async () => {
    await reset();
    const [id] = await creaturesFor('ut1seller', 1);
    await creaturesFor('ut1buyer', MAX_OWNED_CREATURES);
    await assert.rejects(move(id, 'ut1seller', 'ut1buyer'), { code: 'collection_full' });
    assert.strictEqual((await pool.query('SELECT owner FROM creatures WHERE id = $1', [id])).rows[0].owner, 'ut1seller');
    assert.strictEqual((await ownership.ownedCount(pool, 'ut1buyer')).owned, MAX_OWNED_CREATURES);
  });

  await t.test('a waiting Seed counts against the buyer too', async () => {
    await reset();
    const [id] = await creaturesFor('ut1seller', 1);
    await creaturesFor('ut1buyer', MAX_OWNED_CREATURES - 1);
    await fundAndMint(pool, 'ut1buyer', 'ut1buyer');
    await assert.rejects(move(id, 'ut1seller', 'ut1buyer'), { code: 'collection_full' });
  });

  await t.test('only the current owner can be the seller', async () => {
    await reset();
    const [id] = await creaturesFor('ut1seller', 1);
    await assert.rejects(move(id, 'ut1other', 'ut1buyer'), { code: 'not_yours' });
    await assert.rejects(move(id, 'ut1seller', 'ut1seller'), { code: 'same_wallet' });
    await assert.rejects(move(999999, 'ut1seller', 'ut1buyer'), { code: 'not_found' });
  });

  await t.test('a transfer and a Genesis racing for the last place: exactly one wins', async () => {
    for (let round = 0; round < 4; round++) {
      await reset();
      const [id] = await creaturesFor('ut1seller', 1);
      await creaturesFor('ut1buyer', MAX_OWNED_CREATURES - 1);
      await require('../lib/stead').creditStead(pool, 'ut1buyer', require('../public/js/config').GENESIS_COST, 'DAILY_CHECKIN', { test: true }, { key: 'race-' + round });
      const results = await Promise.allSettled([
        move(id, 'ut1seller', 'ut1buyer'),
        genesis.mint(pool, 'ut1buyer', 'ut1buyer'),
      ]);
      const won = results.filter((r) => r.status === 'fulfilled' && (r.value.created !== false)).length;
      assert.strictEqual(won, 1, 'round ' + round);
      for (const r of results.filter((r) => r.status === 'rejected')) assert.strictEqual(r.reason.code, 'collection_full');
      assert.strictEqual((await ownership.ownedCount(pool, 'ut1buyer')).owned, MAX_OWNED_CREATURES);
    }
  });

  await t.test('two transfers to the same buyer racing for the last place: exactly one wins', async () => {
    await reset();
    const [a] = await creaturesFor('ut1sellerA', 1);
    const [b] = await creaturesFor('ut1sellerB', 1);
    await creaturesFor('ut1buyer', MAX_OWNED_CREATURES - 1);
    const results = await Promise.allSettled([move(a, 'ut1sellerA', 'ut1buyer'), move(b, 'ut1sellerB', 'ut1buyer')]);
    assert.strictEqual(results.filter((r) => r.status === 'fulfilled').length, 1);
    assert.strictEqual((await ownership.ownedCount(pool, 'ut1buyer')).owned, MAX_OWNED_CREATURES);
  });

  await t.test('a wallet already over the limit keeps everything and is refused more', async () => {
    await reset();
    await creaturesFor('ut1big', MAX_OWNED_CREATURES);
    const [extra1] = await creaturesFor('ut1x', 1);
    const [extra2] = await creaturesFor('ut1y', 1);
    // Got there before the limit existed.
    await pool.query("UPDATE creatures SET owner = 'ut1big' WHERE id = ANY($1::int[])", [[extra1, extra2]]);
    assert.strictEqual((await ownership.ownedCount(pool, 'ut1big')).owned, MAX_OWNED_CREATURES + 2);
    await assert.rejects(fundAndMint(pool, 'ut1big', 'ut1big'), { code: 'collection_full' });
    assert.strictEqual((await ownership.ownedCount(pool, 'ut1big')).owned, MAX_OWNED_CREATURES + 2);
  });
});
