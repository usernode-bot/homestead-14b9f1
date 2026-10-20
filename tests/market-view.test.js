// Marketplace view: BUY's search, category chips and sort, the row states,
// and SELL's storage, edit row and status tags. No database: this renders the
// view the page renders, from the real config files.
const test = require('node:test');
const assert = require('node:assert');

// market-view.js reads everything off `window` at load, so the configs go on
// global.window before it is required.
global.window = global;
global.HOMESTEAD_STEAD_CONFIG = require('../public/js/stead-config');
global.HOMESTEAD_FOOD_CONFIG = require('../public/js/food-config');
global.HOMESTEAD_MARKET_CONFIG = require('../public/js/market-config');
global.HOMESTEAD_HOMESTEAD_CONFIG = require('../public/js/homestead-config');
global.HOMESTEAD_WORK_CONFIG = require('../public/js/work-config');
global.HOMESTEAD_WALLET = { shortAddress: (a) => (a ? a.slice(0, 7) + '…' : '') };

require('../public/js/market-view');
const view = global.HOMESTEAD_MARKET_VIEW;
const hcfg = global.HOMESTEAD_HOMESTEAD_CONFIG;
const mcfg = global.HOMESTEAD_MARKET_CONFIG;

const L = (id, resource, quantity, price, sellerName) =>
  ({ listingId: id, resource, quantity, price, seller: 'ut1' + (sellerName || 'anon'), sellerName: sellerName || null, status: 'active', createdAt: '2026-10-05T10:00:00Z' });
const LISTINGS = [
  L(4, 'crystal', 1, 750, 'rival'),
  L(3, 'ore', 8, 24, 'challenger'),
  L(2, 'wood', 12, 30, 'rival'),
  L(1, 'stone', 30, 30, null),
];
const ids = (rows) => rows.map((l) => l.listingId);

function state(patch, wallet) {
  return {
    wallet: { status: wallet === false ? 'idle' : 'connected', address: 'ut1me' },
    marketplace: Object.assign({
      status: 'ready', walletId: 'ut1me', owned: { 'grub-snack': 0, 'monster-meal': 0, 'punk-feast': 0 }, steadBalance: 100,
      pending: null, notice: null, error: null, listings: LISTINGS, myListings: [],
      storage: { storage: Object.assign(hcfg.emptyStorage(), { wood: 4, stone: 9 }), used: 13 },
      packsToday: {}, browse: { query: '', category: 'all', sort: 'newest' }, details: null, editing: null,
    }, patch),
  };
}
const page = (s, tab) => view.page(s, '<h1>MARKETPLACE</h1>', tab);
const browse = (b) => ({ query: '', category: 'all', sort: 'newest', ...b });

test('categories and prices each', () => {
  assert.deepStrictEqual(view.categoryOf('wood'), { id: 'lumber-camp', label: 'Lumber Camp' });
  assert.deepStrictEqual(view.categoryOf('rune'), { id: 'mystic-shrine', label: 'Mystic Shrine' });
  assert.strictEqual(view.priceEach(30, 12), 2.5);
  assert.strictEqual(view.formatEach(view.priceEach(10, 3)), '3.33');
  assert.deepStrictEqual(view.chips().map((c) => c.id), ['all', 'barn', 'mine', 'lumber-camp', 'fishing-hut', 'workshop', 'mystic-shrine', 'food']);
  // Saved browse state that no longer makes sense falls back to the defaults.
  assert.deepStrictEqual(view.normalizeBrowse({ query: 'ore', category: 'castle', sort: 'random' }), { query: 'ore', category: 'all', sort: 'newest' });
});

test('filtering listings by search and category', () => {
  assert.deepStrictEqual(ids(view.filterListings(LISTINGS, browse({ query: 'WOOD' }))), [2]);
  assert.deepStrictEqual(ids(view.filterListings(LISTINGS, browse({ query: 'mine' }))), [4, 3, 1]); // the category's name
  assert.deepStrictEqual(ids(view.filterListings(LISTINGS, browse({ query: '@rival' }))), [4, 2]); // the seller
  assert.deepStrictEqual(ids(view.filterListings(LISTINGS, browse({ category: 'mine' }))), [4, 3, 1]);
  assert.deepStrictEqual(ids(view.filterListings(LISTINGS, browse({ category: 'mine', query: 'ore' }))), [3]);
  assert.deepStrictEqual(view.filterListings(LISTINGS, browse({ category: 'food' })), []);
  // Packs and food follow the same chip.
  assert.deepStrictEqual(view.filterPacks(browse({ category: 'mine' })).map((p) => p.resource), ['stone', 'ore', 'crystal']);
  assert.deepStrictEqual(view.filterPacks(browse({ category: 'food' })), []);
  assert.deepStrictEqual(view.filterFoods(browse({ category: 'mine' })), []);
  assert.deepStrictEqual(view.filterFoods(browse({ query: 'feast' })).map((f) => f.id), ['punk-feast']);
});

test('sorting listings', () => {
  assert.deepStrictEqual(ids(view.sortListings(LISTINGS, 'newest')), [4, 3, 2, 1]);
  assert.deepStrictEqual(ids(view.sortListings(LISTINGS, 'each')), [1, 2, 3, 4]); // 1, 2.5, 3, 750 each
  assert.deepStrictEqual(ids(view.sortListings(LISTINGS, 'price')), [3, 2, 1, 4]); // 24, 30 (newer first), 30, 750
  assert.deepStrictEqual(ids(view.sortListings(LISTINGS, 'quantity')), [1, 2, 3, 4]);
  assert.deepStrictEqual(view.filterPacks(browse({ sort: 'price' })).map((p) => p.pack.price)[0], 30);
});

test('BUY: tabs, compact rows and their states', () => {
  const html = page(state(), 'buy');
  assert.match(html, /data-market-tab="buy" aria-current="page">BUY</);
  assert.doesNotMatch(html, /data-market-tab="sell" aria-current/);
  assert.match(html, /data-market-chip="all" aria-pressed="true"/);
  // The empty "None for sale" rows are gone: one row per listing.
  assert.doesNotMatch(html, /None for sale/);
  assert.strictEqual((html.match(/data-listing="/g) || []).length, 4);
  assert.match(html, /data-listing="2" data-listing-resource="wood" data-market-category="lumber-camp" data-listing-state="available"/);
  assert.match(html, /Lumber Camp · 2\.5 STEAD each · <span data-listing-seller="2">/);
  // 750 STEAD with 100: muted and "Need".
  assert.match(html, /data-listing="4"[^>]*data-listing-state="unaffordable"/);
  assert.match(html, /data-action="buy-listing" data-listing-id="4" disabled>Need 750 STEAD</);
  assert.match(html, /data-market-packs/);
  assert.match(html, /data-market-foods/);
});

test('BUY: DETAILS compares with the app\'s pack', () => {
  const html = page(state({ details: 2 }), 'buy');
  assert.match(html, /data-listing-details="2"/);
  assert.match(html, /Cheaper than the app's pack, 3 STEAD each/);
  assert.match(html, /aria-expanded="true"/);
  assert.match(page(state({ details: 4 }), 'buy'), /Pricier than the app's pack, 100 STEAD each/);
});

test('BUY: a building chip hides food; FOOD shows only food', () => {
  const mine = page(state({ browse: browse({ category: 'mine' }) }), 'buy');
  assert.doesNotMatch(mine, /data-market-foods/);
  assert.doesNotMatch(mine, /data-listing-resource="wood"/);
  assert.match(mine, /data-market-chip="mine" aria-pressed="true"/);
  const food = page(state({ browse: browse({ category: 'food' }) }), 'buy');
  assert.match(food, /data-market-foods/);
  assert.doesNotMatch(food, /data-market-listings|data-market-packs/);
  // A category with no player listings says so in one line.
  const fishing = page(state({ browse: browse({ category: 'fishing-hut' }) }), 'buy');
  assert.match(fishing, /No player listings in Fishing Hut right now\./);
});

test('BUY: nothing matching shows one empty state with CLEAR', () => {
  const html = page(state({ browse: browse({ query: 'zzz' }) }), 'buy');
  assert.match(html, /data-empty="market-filter"/);
  assert.match(html, /data-action="market-clear"/);
  assert.doesNotMatch(html, /data-market-listings|data-market-packs|data-market-foods/);
  // The query itself is filled in as text afterwards, never written in.
  assert.doesNotMatch(page(state({ browse: browse({ query: '<b>zzz' }) }), 'buy'), /<b>zzz/);
});

test('BUY: a pack at today\'s limit is SOLD OUT TODAY', () => {
  const html = page(state({ packsToday: { rune: mcfg.pack('rune').perDay } }), 'buy');
  assert.match(html, /data-pack="rune" data-market-category="mystic-shrine" data-packs-left="0">.*?SOLD OUT TODAY.*?data-action="buy-pack" data-pack="rune" disabled/);
  assert.doesNotMatch(html.split('data-pack="wood"')[1].split('</li>')[0], /SOLD OUT TODAY/);
});

test('BUY without a wallet: listings without BUY buttons', () => {
  const html = page(state({ walletId: null }, false), 'buy');
  assert.match(html, /data-listing="2"/);
  assert.doesNotMatch(html, /data-action="buy-listing"/);
  assert.match(html, /data-action="connect"/);
});

test('SELL: storage, form, listings with tags, and the edit row', () => {
  const mine = [
    { ...L(9, 'wood', 10, 25, 'me'), seller: 'ut1me' },
    { ...L(7, 'ore', 3, 12, 'me'), seller: 'ut1me', status: 'sold', buyer: 'ut1rival', buyerName: 'rival' },
    { ...L(6, 'stone', 1, 5, 'me'), seller: 'ut1me', status: 'cancelled' },
  ];
  const html = page(state({ myListings: mine }), 'sell');
  assert.match(html, /data-market-tab="sell" aria-current="page"/);
  assert.match(html, /data-storage-resource="wood"/);
  assert.match(html, /data-storage-resource="stone"/);
  assert.doesNotMatch(html, /data-storage-resource="ore"/);
  assert.match(html, /data-action="market-sell-resource" data-resource="wood"/);
  assert.match(html, /id="market-sell-form"/);
  assert.match(html, /data-market-summary/);
  assert.match(html, /data-listings-up="1">· 1 of 10 up/);
  assert.match(html, /data-my-listing="9" data-listing-status="active">.*?FOR SALE.*?data-action="edit-listing" data-listing-id="9".*?data-action="cancel-listing" data-listing-id="9"/);
  assert.match(html, /data-listing-status="sold">.*?SOLD</);
  assert.match(html, /data-listing-status="cancelled">.*?CANCELLED</);
  assert.doesNotMatch(html, /data-market-listings/); // BUY's rows aren't on SELL

  const editing = page(state({ myListings: mine, editing: 9 }), 'sell');
  assert.match(editing, /data-my-listing="9" data-listing-status="active" data-editing>/);
  assert.match(editing, /id="market-edit-form"[^>]*data-listing-id="9"/);
  assert.match(editing, /id="market-edit-quantity"/);
  assert.match(editing, /data-action="save-listing"/);
  assert.match(editing, /data-action="edit-listing-back"/);
});

test('SELL: empty storage, and no wallet', () => {
  const empty = page(state({ storage: { storage: hcfg.emptyStorage(), used: 0 } }), 'sell');
  assert.match(empty, /data-empty="sell"/);
  assert.doesNotMatch(empty, /market-sell-form/);
  assert.match(empty, /data-empty="my-listings"/);
  const guest = page(state({}, false), 'sell');
  assert.match(guest, /Connect your wallet to sell\./);
  assert.doesNotMatch(guest, /data-market-storage/);
  const loading = page(state({ status: 'loading' }), 'sell');
  assert.match(loading, /aria-busy="true"/);
});
