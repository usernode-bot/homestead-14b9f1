// Contests: the formulas, the resolver, and challenge -> accept -> resolve
// in Postgres, with the races the request names.
// The config tests always run; the database tests need DATABASE_URL (a
// throwaway database: they drop and recreate the game tables).
const test = require('node:test');
const assert = require('node:assert');
const { Pool } = require('pg');
const cfg = require('../public/js/contest-config');
const genesis = require('../lib/genesis');
const creatures = require('../lib/creatures');
const homestead = require('../lib/homestead');
const work = require('../lib/work');
const stead = require('../lib/stead');
const care = require('../lib/care');
const gear = require('../lib/gear');
const contests = require('../lib/contests');

function snap(id, stats, condition) {
  return {
    creatureId: id, name: 'C' + id,
    effectiveStats: Object.assign({ hp: 60, attack: 50, defense: 30, speed: 40, luck: 10 }, stats),
    condition: condition || 'GOOD',
  };
}

test('points, condition, show-stoppers and turn order follow the config', () => {
  assert.strictEqual(cfg.trickPoints(snap(1), snap(2), false), 20);
  assert.strictEqual(cfg.trickPoints(snap(1, {}, 'FAIR'), snap(2), false), 17);
  assert.strictEqual(cfg.trickPoints(snap(1, {}, 'POOR'), snap(2), false), 12);
  assert.strictEqual(cfg.trickPoints(snap(1), snap(2), true), 30);
  // Never below 1, even when Defense is higher, even in POOR condition.
  assert.strictEqual(cfg.trickPoints(snap(1, { attack: 10 }, 'POOR'), snap(2, { defense: 90 }), false), 1);
  assert.strictEqual(cfg.critChance(10), 0.1);
  assert.strictEqual(cfg.critChance(80), cfg.MAX_CRIT_CHANCE);
  assert.strictEqual(cfg.firstMover(snap(1, { speed: 40 }), snap(2, { speed: 32 })), 'a');
  assert.strictEqual(cfg.firstMover(snap(1, { speed: 32 }), snap(2, { speed: 40 })), 'b');
  // Equal Speed: higher Luck, then the lower Creature ID.
  assert.strictEqual(cfg.firstMover(snap(5, { luck: 1 }), snap(2, { luck: 9 })), 'b');
  assert.strictEqual(cfg.firstMover(snap(5), snap(2)), 'b');
  assert.strictEqual(cfg.firstMover(snap(2), snap(5)), 'a');
});

test('the resolver ends when one Stamina reaches 0 and logs every trick', () => {
  const a = snap(1, { hp: 60, attack: 50, defense: 30, speed: 40 });
  const b = snap(2, { hp: 60, attack: 41, defense: 30, speed: 32 });
  const r = contests.resolve(a, b, () => 0.99); // no show-stoppers
  // A scores 20 a trick, B 11: A needs 3 tricks, goes first, wins on turn 5.
  assert.strictEqual(r.first, 'a');
  assert.strictEqual(r.winner, 'a');
  assert.strictEqual(r.turns, 5);
  assert.deepStrictEqual(r.points, { a: 60, b: 22 });
  assert.deepStrictEqual(r.staminaLeft, { a: 38, b: 0 });
  assert.deepStrictEqual(r.rewards, { a: cfg.WIN_REWARD, b: cfg.LOSS_REWARD });
  assert.strictEqual(r.log[0].text, 'C1 goes first.');
  assert.strictEqual(r.log.filter((e) => e.kind === 'trick').length, 5);
  assert.strictEqual(r.log[r.log.length - 1].text, 'C1 WINS.');
  // Every show-stopper roll hits: 30 a trick, two tricks.
  const crit = contests.resolve(a, b, () => 0);
  assert.strictEqual(crit.turns, 3);
  assert.deepStrictEqual(crit.crits, { a: 2, b: 1 });
});

const url = process.env.DATABASE_URL;

test('Contests in Postgres', { skip: !url && 'DATABASE_URL is not set' }, async (t) => {
  const pool = new Pool({ connectionString: url });
  t.after(() => pool.end());
  const T0 = new Date('2026-10-05T10:00:00Z');
  const at = (seconds) => new Date(T0.getTime() + seconds * 1000);
  const AFTER = at(cfg.CONTEST_DURATION_SECONDS + 20); // after any Contest accepted in the first 20 s

  async function reset() {
    await pool.query(`DROP TABLE IF EXISTS contest_creature_locks, contests, contest_challenges, gear_starter_claims, gear_items,
      creature_care_log, stead_ledger, stead_accounts, creature_work, homestead_buildings, homesteads, creatures, seeds,
      genesis_wallets, creature_supply CASCADE`);
    await genesis.ensureSchema(pool);
    await homestead.ensureSchema(pool);
    await work.ensureSchema(pool);
    await stead.ensureSchema(pool);
    await care.ensureSchema(pool);
    await contests.ensureSchema(pool);
    await contests.ensureSchema(pool); // idempotent
  }
  async function creatureFor(wallet) {
    const m = await genesis.mint(pool, wallet, 'user-' + wallet);
    return (await genesis.awaken(pool, wallet, m.seed.seedId)).creature;
  }
  async function identity(id) {
    const r = (await pool.query('SELECT * FROM creatures WHERE id = $1', [id])).rows[0];
    return {
      owner: r.owner, name: r.name, species: r.species, rarity: r.rarity, gene: r.gene, personality: r.personality,
      mutation: r.mutation, base: [r.base_hp, r.base_attack, r.base_defense, r.base_speed, r.base_luck],
      training: [r.training_hp, r.training_attack, r.training_defense, r.training_speed, r.training_luck],
    };
  }
  async function rewardsOf(wallet) {
    return (await pool.query("SELECT amount::int, entry_key FROM stead_ledger WHERE owner = $1 AND type = 'CONTEST_REWARD'", [wallet])).rows;
  }

  await t.test('the whole flow: challenge, two tabs accept, locks, resolve once, pay once', async () => {
    await reset();
    const bruno = await creatureFor('ut1alice');
    const momo = await creatureFor('ut1bob1');
    const before = { a: await identity(bruno.creatureId), b: await identity(momo.creatureId) };

    // Self-challenge is refused.
    await assert.rejects(contests.challenge(pool, 'ut1alice', 'alice', { creatureId: bruno.creatureId, opponent: 'ut1alice' }, T0),
      { code: 'self', message: 'You cannot compete against yourself.' });
    // Someone else's Creature is refused.
    await assert.rejects(contests.challenge(pool, 'ut1alice', 'alice', { creatureId: momo.creatureId, opponent: 'ut1bob1' }, T0),
      { code: 'not_yours' });
    // A wallet with no Creature is not an opponent.
    await assert.rejects(contests.challenge(pool, 'ut1alice', 'alice', { creatureId: bruno.creatureId, opponent: 'ut1nobody' }, T0),
      { code: 'no_creature' });

    const sent = await contests.challenge(pool, 'ut1alice', 'alice', { creatureId: bruno.creatureId, opponent: 'ut1bob1' }, T0);
    assert.strictEqual(sent.challenge.status, 'PENDING');
    // B refreshes: it is still there.
    const seen = await contests.overview(pool, 'ut1bob1', at(5));
    assert.strictEqual(seen.incoming.length, 1);
    assert.strictEqual(seen.incoming[0].challengerCreature.creatureId, bruno.creatureId);
    // A cannot accept their own challenge, nor with B's Creature id swapped in.
    await assert.rejects(contests.accept(pool, 'ut1alice', 'alice', sent.challenge.challengeId, momo.creatureId, at(5)), { code: 'self' });
    await assert.rejects(contests.accept(pool, 'ut1bob1', 'bob', sent.challenge.challengeId, bruno.creatureId, at(5)), { code: 'not_yours' });

    // Two tabs accept at once: exactly one wins.
    const tabs = await Promise.allSettled([1, 2].map(() =>
      contests.accept(pool, 'ut1bob1', 'bob', sent.challenge.challengeId, momo.creatureId, at(10))));
    assert.strictEqual(tabs.filter((r) => r.status === 'fulfilled').length, 1);
    assert.strictEqual(tabs.find((r) => r.status === 'rejected').reason.code, 'already_answered');
    const contest = tabs.find((r) => r.status === 'fulfilled').value.contest;
    assert.strictEqual((await pool.query('SELECT count(*)::int AS n FROM contests')).rows[0].n, 1);
    assert.strictEqual(contest.status, 'ACTIVE');
    assert.strictEqual(contest.playerA, 'ut1alice');
    assert.strictEqual(contest.playerB, 'ut1bob1');
    assert.deepStrictEqual(contest.snapshotA.effectiveStats, bruno.effectiveStats);
    assert.strictEqual(contest.snapshotA.condition, 'GOOD');
    // Decline or cancel after the accept is refused: one transition only.
    await assert.rejects(contests.decline(pool, 'ut1bob1', sent.challenge.challengeId, at(11)), { code: 'already_answered' });
    await assert.rejects(contests.cancel(pool, 'ut1alice', sent.challenge.challengeId, at(11)), { code: 'already_answered' });

    // Both Creatures are locked to the same Contest.
    const locks = (await pool.query('SELECT creature_id, contest_id FROM contest_creature_locks ORDER BY creature_id')).rows;
    assert.deepStrictEqual(locks.map((l) => l.contest_id), [contest.contestId, contest.contestId]);
    assert.deepStrictEqual((await contests.availability(pool, momo.creatureId, at(20))).status, 'in_contest');
    // Neither can enter another Contest, train, work or change Gear.
    const carl = await creatureFor('ut1carl');
    await assert.rejects(contests.challenge(pool, 'ut1alice', 'alice', { creatureId: bruno.creatureId, opponent: 'ut1carl' }, at(20)),
      { message: 'Creature is already in a contest.' });
    const fromCarl = await contests.challenge(pool, 'ut1carl', 'carl', { creatureId: carl.creatureId, opponent: 'ut1bob1' }, at(20));
    await assert.rejects(contests.accept(pool, 'ut1bob1', 'bob', fromCarl.challenge.challengeId, momo.creatureId, at(21)),
      { message: 'Creature is already in a contest.' });
    await stead.creditStead(pool, 'ut1alice', 100, 'DAILY_CHECKIN', {}, { key: 'd1' });
    await assert.rejects(care.train(pool, 'ut1alice', bruno.creatureId, 'attack', null, at(22)), { code: 'in_contest' });
    await homestead.open(pool, 'ut1alice', at(22));
    await assert.rejects(work.start(pool, 'ut1alice', { creatureId: bruno.creatureId, durationId: '1h' }, at(22)), { code: 'in_contest' });
    const kit = await gear.claimStarter(pool, 'ut1alice');
    await assert.rejects(gear.equip(pool, 'ut1alice', bruno.creatureId, kit.granted[0].gearId, kit.granted[0].type, at(22)), { code: 'in_contest' });

    // Not finished yet: nothing paid.
    assert.strictEqual((await contests.getContest(pool, contest.contestId, at(30))).status, 'ACTIVE');
    assert.deepStrictEqual(await rewardsOf('ut1alice'), []);

    // Time is up: both players open it at once, and again later.
    const [ra, rb] = await Promise.all([contests.getContest(pool, contest.contestId, AFTER), contests.getContest(pool, contest.contestId, AFTER)]);
    const later = await contests.getContest(pool, contest.contestId, at(3600));
    for (const r of [rb, later]) {
      assert.deepStrictEqual(
        { w: r.winnerCreatureId, l: r.loserCreatureId, log: r.log, turns: r.turnNumber, result: r.result },
        { w: ra.winnerCreatureId, l: ra.loserCreatureId, log: ra.log, turns: ra.turnNumber, result: ra.result });
    }
    assert.strictEqual(ra.status, 'COMPLETED');
    assert.strictEqual(ra.rewardStatus, 'PAID');
    assert.ok(ra.turnNumber >= 1);
    assert.strictEqual(ra.log[ra.log.length - 1].kind, 'win');
    const winnerWallet = ra.winnerPlayer;
    const loserWallet = ra.loserPlayer;
    assert.deepStrictEqual(new Set([winnerWallet, loserWallet]), new Set(['ut1alice', 'ut1bob1']));
    assert.deepStrictEqual(await rewardsOf(winnerWallet), [{ amount: cfg.WIN_REWARD, entry_key: 'CONTEST-001' }]);
    assert.deepStrictEqual(await rewardsOf(loserWallet), [{ amount: cfg.LOSS_REWARD, entry_key: 'CONTEST-001' }]);
    // Overviews (refreshes) settle nothing twice.
    await contests.overview(pool, 'ut1alice', at(4000));
    await contests.overview(pool, 'ut1bob1', at(4000));
    assert.strictEqual((await rewardsOf('ut1alice')).length, 1);
    assert.strictEqual((await rewardsOf('ut1bob1')).length, 1);
    // Both histories reference the same Contest.
    const ha = (await contests.overview(pool, 'ut1alice', at(4000))).history;
    const hb = (await contests.overview(pool, 'ut1bob1', at(4000))).history;
    assert.deepStrictEqual([ha[0].contestId, hb[0].contestId], [contest.contestId, contest.contestId]);
    // A completed Contest can never be changed or resolved again.
    await assert.rejects(pool.query("UPDATE contests SET status = 'ACTIVE' WHERE id = $1", [contest.contestId]));
    await assert.rejects(pool.query('DELETE FROM contests WHERE id = $1', [contest.contestId]));

    // Locks released; ownership and permanent stats unchanged; no Creatures made or lost.
    assert.strictEqual((await pool.query('SELECT count(*)::int AS n FROM contest_creature_locks')).rows[0].n, 0);
    assert.deepStrictEqual(await identity(bruno.creatureId), before.a);
    assert.deepStrictEqual(await identity(momo.creatureId), before.b);
    assert.strictEqual((await pool.query('SELECT count(*)::int AS n FROM creatures')).rows[0].n, 3);
    assert.strictEqual((await contests.availability(pool, bruno.creatureId, AFTER)).status, 'ready');
    // Training works again.
    await care.train(pool, 'ut1alice', bruno.creatureId, 'attack', null, AFTER);
  });

  await t.test('the snapshot, not the live Creature, decides the Contest', async () => {
    await reset();
    const a = await creatureFor('ut1alice');
    const b = await creatureFor('ut1bob1');
    const sent = await contests.challenge(pool, 'ut1alice', 'alice', { creatureId: a.creatureId, opponent: 'ut1bob1' }, T0);
    const { contest } = await contests.accept(pool, 'ut1bob1', 'bob', sent.challenge.challengeId, b.creatureId, T0);
    // Even a change behind the app's back after the start changes nothing.
    await pool.query('UPDATE creatures SET training_attack = 50 WHERE id = $1', [a.creatureId]);
    const done = await contests.getContest(pool, contest.contestId, AFTER);
    assert.deepStrictEqual(done.snapshotA.effectiveStats, a.effectiveStats);
    const replay = contests.resolve(done.snapshotA, done.snapshotB, () => 0.99);
    // With no show-stoppers rolled, replaying the snapshots gives the same winner.
    if (done.result.crits.a + done.result.crits.b === 0) assert.strictEqual(replay.winner, done.result.winner);
  });

  await t.test('a cancel and an accept at the same moment end in one state', async () => {
    await reset();
    const a = await creatureFor('ut1alice');
    const b = await creatureFor('ut1bob1');
    const sent = await contests.challenge(pool, 'ut1alice', 'alice', { creatureId: a.creatureId, opponent: 'ut1bob1' }, T0);
    const r = await Promise.allSettled([
      contests.cancel(pool, 'ut1alice', sent.challenge.challengeId, at(1)),
      contests.accept(pool, 'ut1bob1', 'bob', sent.challenge.challengeId, b.creatureId, at(1)),
    ]);
    assert.strictEqual(r.filter((x) => x.status === 'fulfilled').length, 1);
    const row = (await pool.query('SELECT status, contest_id FROM contest_challenges WHERE id = $1', [sent.challenge.challengeId])).rows[0];
    const n = (await pool.query('SELECT count(*)::int AS n FROM contests')).rows[0].n;
    if (row.status === 'CANCELLED') assert.strictEqual(n, 0);
    else assert.deepStrictEqual([row.status, n], ['ACCEPTED', 1]);
  });

  await t.test('decline, expiry, Working Creatures and username opponents', async () => {
    await reset();
    const a = await creatureFor('ut1alice');
    const b = await creatureFor('ut1bob1');
    const sent = await contests.challenge(pool, 'ut1alice', 'alice', { creatureId: a.creatureId, opponent: 'ut1bob1' }, T0);
    await assert.rejects(contests.challenge(pool, 'ut1alice', 'alice', { creatureId: a.creatureId, opponent: 'ut1bob1' }, T0),
      { code: 'already_challenged' });
    await assert.rejects(contests.decline(pool, 'ut1alice', sent.challenge.challengeId, at(1)), { code: 'not_yours' });
    const declined = await contests.decline(pool, 'ut1bob1', sent.challenge.challengeId, at(1));
    assert.strictEqual(declined.challenge.status, 'DECLINED');
    assert.strictEqual((await contests.overview(pool, 'ut1alice', at(2))).outgoing[0].status, 'DECLINED');
    await assert.rejects(contests.accept(pool, 'ut1bob1', 'bob', sent.challenge.challengeId, b.creatureId, at(2)), { code: 'already_answered' });

    // A challenge nobody answers expires.
    const again = await contests.challenge(pool, 'ut1alice', 'alice', { creatureId: a.creatureId, opponent: 'ut1bob1' }, at(3));
    const late = at(3 + cfg.CHALLENGE_EXPIRES_HOURS * 3600);
    await assert.rejects(contests.accept(pool, 'ut1bob1', 'bob', again.challenge.challengeId, b.creatureId, late), { code: 'already_answered' });
    assert.strictEqual((await contests.overview(pool, 'ut1bob1', late)).incoming.length, 0);
    assert.strictEqual((await pool.query('SELECT status FROM contest_challenges WHERE id = $1', [again.challenge.challengeId])).rows[0].status, 'EXPIRED');

    // A Working Creature can't challenge or accept.
    await homestead.open(pool, 'ut1bob1', late);
    await work.start(pool, 'ut1bob1', { creatureId: b.creatureId, durationId: '1h' }, late);
    const third = await contests.challenge(pool, 'ut1alice', 'alice', { creatureId: a.creatureId, opponent: 'ut1bob1' }, late);
    await assert.rejects(contests.accept(pool, 'ut1bob1', 'bob', third.challenge.challengeId, b.creatureId, late), { code: 'working' });
    assert.strictEqual((await contests.availability(pool, b.creatureId, late)).status, 'working');

    // A username goes through the directory, then the wallet that used Genesis.
    const lookup = async (h) => (h === 'bob' ? { found: true, user: { id: 'user-ut1bob1', username: 'bob' } } : { found: false, user: null });
    assert.deepStrictEqual(await contests.resolveOpponent(pool, '@bob', lookup), { wallet: 'ut1bob1', username: 'bob' });
    await assert.rejects(contests.resolveOpponent(pool, 'nobody', lookup), { code: 'no_player' });
    await assert.rejects(contests.resolveOpponent(pool, 'bob', async () => { throw new Error('down'); }), { code: 'lookup_unavailable' });
  });
});
