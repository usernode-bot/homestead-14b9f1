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
      // Global Creature supply, read from the server (genesis.js). The cap
      // always comes from HOMESTEAD_CONFIG.MAX_CREATURE_SUPPLY.
      supply: { status: 'loading', created: 0 }, // status: 'loading' | 'ready' | 'error'
      // This wallet's one Genesis (see genesis.js and lib/genesis.js).
      genesis: {
        status: 'idle', // 'idle' | 'loading' | 'ready' | 'error'
        walletId: null,
        genesisUsed: false,
        genesisSeedId: null,
        genesisCreatureId: null,
        pending: null, // 'mint' | 'awaken' while a request is in flight
        notice: null, // 'seed-created' | 'creature-awakened' after one succeeds
        error: null, // what the last mint or awaken could not do
      },
      creature: null, // this wallet's Genesis Creature (lib/creatures.js shape)
      // Every Creature this wallet owns (creatures.js).
      collection: { status: 'idle', creatures: [] }, // status: 'idle' | 'loading' | 'ready' | 'error'
      // The Creature open at /creature/<id> (creatures.js).
      viewedCreature: { status: 'idle', id: null, creature: null, ownedByYou: false }, // status adds 'missing'
      seed: null, // this wallet's Genesis Seed
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
      gear: [],
      contests: null, // head-to-head play (see CLAUDE.md content rules)
      marketplace: { listings: [] },
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
