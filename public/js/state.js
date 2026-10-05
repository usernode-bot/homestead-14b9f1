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
      // Global Creature supply. `created` stays 0 until Genesis exists; the
      // cap always comes from HOMESTEAD_CONFIG.MAX_CREATURE_SUPPLY.
      supply: { created: 0 },
      creature: null, // this wallet's Creature
      seed: null,
      homestead: null, // the Creature's home
      resources: {},
      homePoints: 0, // HOME Points
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
      var next = current && typeof current === 'object' && !Array.isArray(current)
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
