// HOMESTEAD game state: one central store every screen reads from.
//
// Each future system gets its own top-level slot here, empty until the PR
// that builds it fills it in. Screens never keep their own copy of game data:
// they read store.get() and re-render on store.subscribe().
(function () {
  function createInitialState() {
    return {
      // The signed-in Homeroom account and its linked wallet (see wallet.js).
      wallet: {
        status: 'disconnected', // 'disconnected' | 'connecting' | 'connected'
        address: null, // the account's linked Homeroom wallet, ut1...
        username: null,
        error: null, // why the last connect attempt did not connect
      },
      // How many Creatures this wallet holds, out of
      // HOMESTEAD_CONFIG.MAX_OWNED_CREATURES: owned now plus Seeds waiting to
      // be awakened, as the server counted them (lib/ownership.js).
      slots: { status: 'idle', owned: 0, creatures: 0, dormantSeeds: 0, max: 0 }, // status: 'idle' | 'loading' | 'ready' | 'error'
      // This wallet's Genesis (see genesis.js and lib/genesis.js): repeatable,
      // for HOMESTEAD_CONFIG.GENESIS_COST STEAD each.
      genesis: {
        status: 'idle', // 'idle' | 'loading' | 'ready' | 'error'
        walletId: null,
        genesisUsed: false,
        history: [], // the Geneses this wallet used, newest first
        confirming: false, // the "Spend 500 STEAD?" step is showing
        pending: null, // 'mint' | 'awaken' while a request is in flight
        notice: null, // 'seed-created' | 'creature-awakened' after one succeeds
        awakenedId: null, // the Creature the last Awaken made
        error: null, // what the last mint or awaken could not do
      },
      creature: null, // this wallet's first-owned Creature (lib/creatures.js shape)
      // Every Creature this wallet owns (creatures.js).
      collection: { status: 'idle', creatures: [] }, // status: 'idle' | 'loading' | 'ready' | 'error'
      // The Creature open at /creature/<id>, or this wallet's own at /creature
      // (creatures.js). controls is what its owner's Feed and Train need
      // (lib/care.js controls shape), null for anyone else.
      viewedCreature: {
        status: 'idle', // 'idle' | 'loading' | 'ready' | 'error' | 'missing'
        id: null,
        creature: null,
        ownedByYou: false,
        controls: null,
        contest: null, // whether it can compete: lib/contests.js availability shape
        pending: null, // 'feed' | 'train:<stat>' while a request is in flight
        notice: null, // what the last Feed or Train did: { kind, ... }
        error: null, // what the last Feed or Train could not do
      },
      seed: null, // this wallet's Genesis Seed waiting to be awakened
      // This wallet's Homestead and the Creature living in it (homestead.js,
      // lib/homestead.js shape). key is the wallet and Creature it was opened for.
      // work is its Work (lib/work.js overview shape); clockOffset is the
      // server's clock minus this device's, in ms, for the countdown.
      homestead: {
        status: 'idle', // 'idle' | 'loading' | 'ready' | 'error'
        key: null,
        homestead: null,
        creature: null,
        work: null,
        clockOffset: 0,
        pending: null, // 'start' | 'collect' while a Work request is in flight
        error: null, // what the last Work request could not do
      },
      // The Homestead open at /homestead/<id> (homestead.js).
      viewedHomestead: { status: 'idle', id: null, homestead: null, creature: null, work: null, clockOffset: 0, ownedByYou: false }, // status adds 'missing'
      // Resources live in the Homestead's storage (homestead.storage), not here.
      resources: {},
      // This wallet's STEAD Points, its ledger (newest first) and Daily
      // Check-in (stead.js, lib/stead.js shape). The server owns every
      // number; the page only shows what it answered.
      stead: {
        status: 'idle', // 'idle' | 'loading' | 'ready' | 'error'
        walletId: null,
        steadBalance: null, // null while no wallet is connected
        checkIn: null,
        ledger: [],
        pending: null, // 'claim' while a claim is in flight
        notice: null, // 'claimed' after a claim succeeds
        error: null, // what the last claim could not do
      },
      // This wallet's Gear inventory (gear.js, lib/gear.js inventory shape):
      // every item it owns, equipped or not. The Gear a Creature has on comes
      // with the Creature (creature.gear).
      gear: {
        status: 'idle', // 'idle' | 'loading' | 'ready' | 'error'
        walletId: null,
        items: [],
        starterClaimed: false,
        choosing: null, // { creatureId, slot } while picking Gear for a slot
        pending: null, // 'claim' | 'equip:<gearId>' | 'unequip:<slot>' while a request is in flight
        notice: null, // what the last claim, equip or unequip did: { kind, ... }
        error: null, // what the last one could not do
      },
      // Head-to-head Contests between two players (contests.js,
      // lib/contests.js overview shape). Non-violent trick-offs, see CLAUDE.md
      // content rules. Every result is the server's; viewed is the Contest
      // open at /contests/<id>. clockOffset: server clock minus this device's.
      contests: {
        status: 'idle', // 'idle' | 'loading' | 'ready' | 'error'
        walletId: null,
        incoming: [], // PENDING challenges for this wallet
        outgoing: [], // this wallet's challenges: pending, and answered in the last day
        active: [], // running Contests
        history: [], // the latest finished Contests, newest first
        creatures: [], // this wallet's Creatures with their availability
        clockOffset: 0,
        accepting: null, // the challengeId whose Creature picker is open
        pending: null, // 'challenge' | 'accept:<id>' | 'decline:<id>' | 'cancel:<id>' while in flight
        notice: null, // what just happened, as one line
        error: null, // what the last request could not do
        viewed: { status: 'idle', id: null, contest: null, walletId: null, clockOffset: 0 }, // status adds 'missing'
      },
      // Food bought with STEAD, and players' Resource listings
      // (marketplace.js and lib/marketplace.js).
      marketplace: {
        status: 'idle', // 'idle' | 'loading' | 'ready' | 'error'
        walletId: null,
        owned: {}, // { foodId: how many this wallet holds }
        steadBalance: null,
        pending: null, // 'buy:<foodId>' | 'list' | 'buy-listing:<id>' | 'cancel-listing:<id>' while in flight
        notice: null, // the last purchase: { foodId, price }, or { kind, listing } for a listing
        error: null, // what the last request could not do
        listings: [], // other players' Resource listings for sale, newest first
        myListings: [], // this wallet's listings: up for sale, then the latest sold or cancelled
        storage: null, // { storage, used, capacity } of this wallet's Homestead, or null
      },
      breeding: null,
    };
  }

  var state = createInitialState();
  var listeners = new Set();

  window.HOMESTEAD_STORE = {
    get: function () { return state; },
    // Shallow-merge a patch into one slot: update('wallet', { status: ... }).
    update: function (slot, patch) {
      if (!(slot in state)) throw new Error('Unknown game-state slot: ' + slot);
      var current = state[slot];
      // A null patch clears the slot (seed, creature).
      var next = patch && current && typeof current === 'object' && !Array.isArray(current)
        ? Object.assign({}, current, patch)
        : patch;
      state = Object.assign({}, state, { [slot]: next });
      listeners.forEach(function (fn) { fn(state); });
    },
    subscribe: function (fn) {
      listeners.add(fn);
      return function () { listeners.delete(fn); };
    },
    createInitialState: createInitialState,
  };
})();
