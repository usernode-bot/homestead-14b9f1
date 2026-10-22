// Home view: the order of its blocks and the quick links under Genesis.
// No database: this renders the view the page renders, from the real config
// files and the real NAV.
const test = require('node:test');
const assert = require('node:assert');

// screens.js reads everything off `window` at load, so the stubs go on
// global.window before it is required.
global.window = global;
global.HOMESTEAD_CONFIG = require('../public/js/config');
global.HOMESTEAD_STEAD_CONFIG = require('../public/js/stead-config');
global.HOMESTEAD_CONTEST_CONFIG = require('../public/js/contest-config');
global.HOMESTEAD_CREATURE_CARD = { nameSpan: () => '', formatId: String };

require('../public/js/screens');
const screens = global.HOMESTEAD_SCREENS;

function state() {
  return {
    wallet: { status: 'disconnected' },
    slots: { status: 'idle' },
    genesis: { status: 'idle' },
    stead: { status: 'idle' },
    seed: null,
    creature: null,
  };
}

function html() {
  return screens.render.home(state());
}

test('Home shows its blocks in order: count, Genesis, quick links, check-in, how to play, About', () => {
  const out = html();
  const marks = [
    'id="creature-slots"',
    'id="genesis"',
    'data-quick-links',
    'id="daily-check-in"',
    'id="how-to-play"',
    'About the game',
  ];
  const at = marks.map((m) => out.indexOf(m));
  at.forEach((i, n) => assert.ok(i !== -1, 'missing ' + marks[n]));
  for (let i = 1; i < at.length; i++) {
    assert.ok(at[i] > at[i - 1], marks[i] + ' should come after ' + marks[i - 1]);
  }
});

test('Home has three quick links to MY HOMESTEAD, BATTLE and MARKETPLACE', () => {
  const out = html();
  const links = out.match(/<a [^>]*data-quick-link="[^"]+"[^>]*>/g) || [];
  assert.strictEqual(links.length, 3);
  const expected = [
    ['mine', '/creature', 'MY HOMESTEAD'],
    ['contests', '/contests', 'BATTLE'],
    ['marketplace', '/marketplace', 'MARKETPLACE'],
  ];
  expected.forEach(([key, href, label], i) => {
    assert.ok(links[i].includes('data-quick-link="' + key + '"'), key);
    assert.ok(links[i].includes('href="' + href + '"'), href);
    assert.ok(links[i].includes('data-nav'), key + ' goes through the router');
    const cell = out.slice(out.indexOf(links[i]));
    const end = cell.indexOf('</a>');
    assert.ok(cell.slice(0, end).includes(label), label);
  });
});

test('The tagline is smaller on phones and keeps its desktop size', () => {
  const out = html();
  const tagline = out.match(/<p class="([^"]*)">\s*<span class="block">Awaken a Monster\./);
  assert.ok(tagline, 'tagline not found');
  assert.ok(tagline[1].split(' ').includes('text-heading'));
  assert.ok(tagline[1].split(' ').includes('md:text-title'));
});
