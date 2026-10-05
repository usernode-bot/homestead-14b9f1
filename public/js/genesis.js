// HOMESTEAD Genesis -> Seed -> Awaken, in the page.
//
// The server (lib/genesis.js, lib/ownership.js) owns every rule: the cost in
// STEAD, how many Creatures a wallet can hold, one waiting Seed at a time,
// one Creature per Seed. This only loads the state into the store and sends
// the two actions, refusing to send a second while one is in flight. Genesis
// asks for a confirmation first, and each confirmed tap gets one requestId
// that a retry reuses, so the server spends STEAD on it at most once.
(function () {
  var store = window.HOMESTEAD_STORE;
  var wallet = window.HOMESTEAD_WALLET;
  var loadSeq = 0;

  function apply(data) {
    var connected = store.get().wallet.status === 'connected';
    if (!connected || !data.genesis || data.genesis.walletId !== store.get().wallet.address) return;
    store.update('seed', data.seed);
    store.update('creature', data.creature);
    store.update('slots', Object.assign({ status: 'ready' }, data.slots));
    store.update('genesis', {
      status: 'ready',
      walletId: data.genesis.walletId,
      genesisUsed: data.genesis.genesisUsed,
      history: data.history || [],
    });
  }

  // This wallet's Genesis and Creature count. Nothing to load without one.
  async function load() {
    var seq = ++loadSeq;
    if (store.get().wallet.status !== 'connected') return;
    store.update('genesis', { status: 'loading' });
    if (store.get().slots.status !== 'ready') store.update('slots', { status: 'loading' });
    try {
      var res = await wallet.api('/api/genesis');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var data = await res.json();
      if (seq !== loadSeq) return;
      apply(data);
    } catch (err) {
      if (seq !== loadSeq) return;
      store.update('genesis', { status: 'error' });
      store.update('slots', { status: 'error' });
    }
  }

  function newRequestId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'r' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
  }

  // A request that never got an answer is sent once more with the same body
  // (the same requestId), so the server applies it at most once.
  async function act(kind, path, body) {
    var g = store.get().genesis;
    if (g.pending) return; // one request at a time
    store.update('genesis', { pending: kind, error: null, notice: null, confirming: false });
    var res = null;
    for (var attempt = 0; attempt < 2 && !res; attempt++) {
      try {
        res = await wallet.api(path, { method: 'POST', body: body || {} });
      } catch (err) {
        res = null;
      }
    }
    if (!res) {
      // It may or may not have reached the server: reload to find out.
      store.update('genesis', { pending: null, error: "Couldn't reach HOMESTEAD. Check your connection and try again." });
      load();
      refreshOthers();
      return;
    }
    var data = await res.json().catch(function () { return {}; });
    if (!res.ok) {
      store.update('genesis', { pending: null, error: data.message || "That didn't work. Try again." });
      // Whatever happened (another tab, say), show what the server now holds.
      load();
      refreshOthers();
      return;
    }
    var awakenedId = null;
    if (kind === 'awaken' && data.created && body && body.seedId) {
      var made = (data.history || []).find(function (h) { return h.seedId === body.seedId; });
      awakenedId = made ? made.creatureId : null;
    }
    store.update('genesis', {
      pending: null,
      notice: data.created ? (kind === 'mint' ? 'seed-created' : 'creature-awakened') : null,
      awakenedId: awakenedId,
    });
    apply(data);
    refreshOthers();
  }

  // What a Genesis or Awaken also changes elsewhere: STEAD, and the collection.
  function refreshOthers() {
    if (window.HOMESTEAD_STEAD) window.HOMESTEAD_STEAD.load();
    if (window.HOMESTEAD_CREATURES && store.get().collection.status !== 'idle') window.HOMESTEAD_CREATURES.loadCollection();
  }

  // GENESIS MINT only opens the confirmation; CONFIRM sends it.
  function confirm() {
    if (store.get().genesis.pending) return;
    store.update('genesis', { confirming: true, error: null, notice: null });
  }
  function cancelConfirm() {
    store.update('genesis', { confirming: false });
  }

  function mint() {
    return act('mint', '/api/genesis/mint', { requestId: newRequestId() });
  }

  function awaken() {
    var seed = store.get().seed;
    if (!seed) return;
    return act('awaken', '/api/genesis/awaken', { seedId: seed.seedId });
  }

  // Follow the wallet: load its Genesis when it connects, forget it when it
  // disconnects (everything stays on the server).
  var lastWallet = store.get().wallet.status + ':' + store.get().wallet.address;
  store.subscribe(function (state) {
    var key = state.wallet.status + ':' + state.wallet.address;
    if (key === lastWallet) return;
    lastWallet = key;
    if (state.wallet.status === 'connected') load();
    else if (state.wallet.status === 'disconnected') {
      loadSeq++;
      store.update('genesis', store.createInitialState().genesis);
      store.update('slots', store.createInitialState().slots);
      store.update('seed', null);
      store.update('creature', null);
    }
  });

  window.HOMESTEAD_GENESIS = { load: load, mint: mint, awaken: awaken, confirm: confirm, cancelConfirm: cancelConfirm };
})();
