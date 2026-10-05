// HOMESTEAD Homesteads, in the page: this wallet's Homestead and the one open
// at /homestead/<id>.
//
// The server (lib/homestead.js) owns every rule: one Homestead per wallet,
// created the first time the wallet owns a Creature, holding the Creature the
// wallet owns now. This only asks for it when the Homestead screen shows and
// puts the answer in the store. Rendering never creates anything.
(function () {
  var store = window.HOMESTEAD_STORE;
  var wallet = window.HOMESTEAD_WALLET;
  var openSeq = 0;
  var viewSeq = 0;

  // What this wallet's Homestead was last opened for: the wallet and the
  // Creature it owns. A change (connect, Awaken, transfer) opens it again.
  function keyFor(state) {
    return state.wallet.address + ':' + (state.creature ? state.creature.creatureId : '');
  }

  // Open this wallet's Homestead, unless it is already open for this wallet
  // and Creature. force: reload anyway (Retry).
  async function open(force) {
    var state = store.get();
    if (state.wallet.status !== 'connected') return;
    // Wait for the Genesis load, so a Creature awakened elsewhere is known.
    if (state.genesis.status !== 'ready') return;
    var key = keyFor(state);
    var h = state.homestead;
    if (!force && h.key === key && (h.status === 'loading' || h.status === 'ready')) return;
    var seq = ++openSeq;
    store.update('homestead', { status: 'loading', key: key });
    try {
      var res = await wallet.api('/api/homestead', { method: 'POST', body: {} });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var data = await res.json();
      if (seq !== openSeq) return;
      store.update('homestead', { status: 'ready', homestead: data.homestead, creature: data.creature });
    } catch (err) {
      if (seq !== openSeq) return;
      store.update('homestead', { status: 'error' });
    }
  }

  // Load the Homestead at /homestead/<id>, unless it is already showing.
  async function view(id, force) {
    var v = store.get().viewedHomestead;
    if (!force && v.id === id && v.status !== 'error') return;
    var seq = ++viewSeq;
    store.update('viewedHomestead', { status: 'loading', id: id, homestead: null, creature: null, ownedByYou: false });
    try {
      var res = await wallet.api('/api/homesteads/' + id);
      if (seq !== viewSeq) return;
      if (res.status === 404) {
        store.update('viewedHomestead', { status: 'missing' });
        return;
      }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var data = await res.json();
      if (seq !== viewSeq) return;
      store.update('viewedHomestead', { status: 'ready', homestead: data.homestead, creature: data.creature, ownedByYou: data.ownedByYou });
    } catch (err) {
      if (seq !== viewSeq) return;
      store.update('viewedHomestead', { status: 'error' });
    }
  }

  // Keep the Creature's new name when it is renamed elsewhere.
  store.subscribe(function (state) {
    var h = state.homestead;
    var c = state.creature;
    if (h.creature && c && h.creature.creatureId === c.creatureId && h.creature.name !== c.name) {
      store.update('homestead', { creature: c });
    }
  });

  // Forget this wallet's Homestead when the wallet disconnects or changes.
  var lastWallet = null;
  store.subscribe(function (state) {
    var key = state.wallet.status + ':' + state.wallet.address;
    if (key === lastWallet) return;
    lastWallet = key;
    if (state.homestead.status !== 'idle') {
      openSeq++;
      store.update('homestead', store.createInitialState().homestead);
    }
    var v = state.viewedHomestead;
    if (v.id != null && state.wallet.status !== 'connecting') view(v.id, true); // whether you own it may have changed
  });

  window.HOMESTEAD_HOMESTEADS = { open: open, view: view };
})();
