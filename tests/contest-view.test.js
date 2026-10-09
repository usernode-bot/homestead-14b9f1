// Contest view copy: what the screens say happens when a challenge or a
// Contest runs out of time. The numbers come from contest-config.js and
// stead-config.js, not from these tests. No database: this renders the view
// the page renders.
const test = require('node:test');
const assert = require('node:assert');

// contest-view.js reads everything off `window` at load, so the stubs go on
// global.window before it is required.
global.window = global;

global.HOMESTEAD_CONTEST_CONFIG = require('../public/js/contest-config');
global.HOMESTEAD_STEAD_CONFIG = require('../public/js/stead-config');
global.HOMESTEAD_CREATURE_CONFIG = { SPECIES: [], byId: () => null, STATS: [{ key: 'hp', label: 'HP' }] };
global.HOMESTEAD_CREATURE_CARD = { art: () => '', rarityBadge: () => '' };
global.HOMESTEAD_WALLET = { shortAddress: (a) => a };
global.HOMESTEAD_CONTESTS = { form: () => ({}) };

require('../public/js/contest-view');
const view = global.HOMESTEAD_CONTEST_VIEW;

function pageState(incoming) {
  return {
    wallet: { status: 'connected' },
    contests: {
      status: 'ready', notice: null, error: null,
      incoming: incoming, active: [], outgoing: [], history: [],
      creatures: [], accepting: null, pending: null, walletId: null, clockOffset: 0,
    },
  };
}

function activeContest() {
  const snap = (id) => ({
    creatureId: id, name: 'Grub ' + id, owner: 'ut1wallet' + id,
    effectiveStats: { hp: 60, attack: 50, defense: 30, speed: 40, luck: 10 },
    condition: 'GOOD',
  });
  return { viewed: {
    status: 'ready', walletId: null, clockOffset: 0,
    contest: {
      contestId: 12, status: 'ACTIVE',
      playerA: 'w1', playerB: 'w2', playerAUsername: null, playerBUsername: null,
      creatureAId: 1, creatureBId: 2, winnerCreatureId: null,
      snapshotA: snap(1), snapshotB: snap(2),
      endsAt: new Date().toISOString(), log: [], result: null,
    },
  } };
}

test('each incoming challenge says how long it waits and that expiry costs nothing', () => {
  const html = view.page(pageState([{
    challengeId: 3, challengerUsername: 'rivetkid', challengerWallet: 'ut1abc',
    challengerCreature: { name: 'Grub Mohawk', species: 'sludgeling' },
  }]), '<h1>BATTLE</h1>');
  assert.match(html, /data-challenge-expiry/);
  assert.ok(html.includes('Answer within ' + global.HOMESTEAD_CONTEST_CONFIG.CHALLENGE_EXPIRES_HOURS + ' hours'));
  assert.ok(html.includes('nothing is lost and no STEAD is taken'));
});

test('How contests work explains that an unanswered challenge expires free', () => {
  const html = view.page(pageState([]), '<h1>BATTLE</h1>');
  assert.ok(html.includes('A challenge waits ' + global.HOMESTEAD_CONTEST_CONFIG.CHALLENGE_EXPIRES_HOURS + ' hours for an answer'));
  assert.ok(html.includes('no STEAD is lost'));
});

test('a running contest says the result is in and STEAD is paid when time is up', () => {
  const html = view.detail({ contests: activeContest() }, '<h1>BATTLE</h1>');
  assert.ok(html.includes('data-contest-running'));
  assert.ok(html.includes('When the time is up, the result is in and STEAD is paid'));
  assert.ok(html.includes('+' + global.HOMESTEAD_STEAD_CONFIG.format(global.HOMESTEAD_CONTEST_CONFIG.WIN_REWARD) + ' STEAD to the winner'));
  assert.ok(html.includes('+' + global.HOMESTEAD_STEAD_CONFIG.format(global.HOMESTEAD_CONTEST_CONFIG.LOSS_REWARD) + ' STEAD to the other player'));
});

test('a completed contest keeps its own result line, not the running note', () => {
  const c = activeContest();
  c.viewed.contest.status = 'COMPLETED';
  c.viewed.contest.winnerCreatureId = 1;
  c.viewed.contest.turnNumber = 4;
  c.viewed.contest.result = { winner: 'a', turns: 4, points: { a: 20, b: 10 }, crits: { a: 0, b: 0 }, rewards: { a: 25, b: 5 } };
  const html = view.detail({ contests: c }, '<h1>BATTLE</h1>');
  assert.ok(!html.includes('When the time is up'));
  assert.ok(html.includes('data-contest-winner'));
});
