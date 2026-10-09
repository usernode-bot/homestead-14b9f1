// HOMESTEAD contest-view render tests: the expiry and payout notes.
// Pure string tests: no database, no server. They require the real
// contest-view.js with the real config modules and stub only what draws
// Creature art or talks to the network.
'use strict';

const test = require('node:test');
const assert = require('node:assert');

// The page globals contest-view.js reads at load time. The config modules
// are the real ones from public/js; the card art and wallet helpers are
// stubbed because they draw SVG or touch the bridge.
global.window = {
  HOMESTEAD_CONTEST_CONFIG: require('../public/js/contest-config'),
  HOMESTEAD_CREATURE_CONFIG: require('../public/js/creature-config'),
  HOMESTEAD_STEAD_CONFIG: require('../public/js/stead-config'),
  HOMESTEAD_CREATURE_CARD: {
    art: function () { return ''; },
    rarityBadge: function () { return ''; },
  },
  HOMESTEAD_WALLET: {
    shortAddress: function (a) { return String(a).slice(0, 6) + '…'; },
  },
  HOMESTEAD_CONTESTS: {
    form: function () { return {}; },
  },
};

require('../public/js/contest-view');
const view = global.window.HOMESTEAD_CONTEST_VIEW;
const cfg = global.window.HOMESTEAD_CONTEST_CONFIG;

function stats() {
  return { hp: 80, attack: 12, defense: 10, speed: 9, luck: 5 };
}

function snapshot(name) {
  return { name: name, owner: 'ut1' + name, effectiveStats: stats(), condition: 'GOOD' };
}

// A connected wallet with one incoming challenge and otherwise empty lists.
function pageState(withIncoming) {
  return {
    wallet: { status: 'connected' },
    contests: {
      status: 'ready',
      pending: null,
      accepting: null,
      creatures: [],
      incoming: withIncoming ? [{
        challengeId: 7,
        challengerUsername: 'rivalpunk',
        challengerWallet: 'ut1rival',
        challengerCreature: { name: 'Bruno', species: 'gloop' },
      }] : [],
      active: [],
      outgoing: [],
      history: [],
    },
  };
}

function activeContest(status) {
  const base = {
    contestId: 12,
    status: status,
    endsAt: new Date(Date.now() + 30000).toISOString(),
    playerA: 'ut1a', playerB: 'ut1b',
    playerAUsername: 'rivalpunk', playerBUsername: null,
    creatureAId: 1, creatureBId: 2, winnerCreatureId: 1,
    snapshotA: snapshot('Bruno'), snapshotB: snapshot('Mossy'),
  };
  if (status === 'COMPLETED') {
    base.result = { winner: 'a', rewards: { a: 25, b: 5 }, turns: 5, points: { a: 10, b: 4 }, crits: { a: 0, b: 0 } };
    base.log = [];
  }
  return base;
}

test('an incoming challenge says how long it waits and that nothing is lost', () => {
  const html = view.page(pageState(true), '<h1>BATTLE</h1>');
  const note = /data-challenge-expiry>([^<]*)</.exec(html);
  assert.ok(note, 'renders the expiry note on the challenge row');
  assert.ok(note[1].includes(cfg.CHALLENGE_EXPIRES_HOURS + ' hours'), 'uses the configured hours');
  assert.ok(note[1].includes('nothing is lost'), 'says nothing is lost');
});

test('How contests work explains challenge expiry, with no challenges pending', () => {
  const html = view.page(pageState(false), '<h1>BATTLE</h1>');
  assert.ok(!html.includes('data-challenge-expiry'), 'no challenge row, no challenge note');
  const row = /data-how-expiry[^>]*><p class="text-body">([^<]*)</.exec(html);
  assert.ok(row, 'renders the expiry row in How contests work');
  assert.ok(row[1].includes(cfg.CHALLENGE_EXPIRES_HOURS + ' hours'), 'uses the configured hours');
  assert.ok(row[1].includes('no STEAD is taken'), 'says no STEAD is taken');
});

test('a running contest says what the payout is when time is up', () => {
  const html = view.detail({ contests: { viewed: { status: 'ready', walletId: null, clockOffset: 0, contest: activeContest('ACTIVE') } } }, '<h1>BATTLE</h1>');
  const note = /data-contest-payout>([^<]*)</.exec(html);
  assert.ok(note, 'renders the payout note on a running contest');
  assert.ok(note[1].includes('+' + cfg.WIN_REWARD + ' STEAD'), 'shows the win reward from config');
  assert.ok(note[1].includes('+' + cfg.LOSS_REWARD + ' STEAD'), 'shows the other reward from config');
});

test('a completed contest does not show the payout note', () => {
  const html = view.detail({ contests: { viewed: { status: 'ready', walletId: null, clockOffset: 0, contest: activeContest('COMPLETED') } } }, '<h1>BATTLE</h1>');
  assert.ok(!html.includes('data-contest-payout'), 'no payout note once the contest is done');
});

test('the new copy never sounds like points are taken away', () => {
  const strings = [
    view.page(pageState(true), ''),
    view.page(pageState(false), ''),
    view.detail({ contests: { viewed: { status: 'ready', walletId: null, clockOffset: 0, contest: activeContest('ACTIVE') } } }, ''),
  ].join('\n');
  for (const banned of ['lost points', 'forfeit', 'penalty']) {
    assert.ok(!strings.toLowerCase().includes(banned), 'no "' + banned + '" in the new copy');
  }
});
