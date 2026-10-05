// HOMESTEAD Genesis -> Seed -> Awaken, in the page.
//
// The server (lib/genesis.js) owns every rule: one Genesis per wallet, one
// Creature per Seed, the supply cap. This only loads the state into the store
// and sends the two actions, refusing to send a second while one is in
// flight. A repeated request is safe anyway: the server answers it with the
// Seed or Creature that already exists.
(function () {
  var store = window.HOMESTEAD_STORE;
  var wallet = window.HOMESTEAD_WALLET;
  var loadSeq = 0;

  function apply(data) {
    store.update('supply', { status: 'ready', created: data.supply.created });
    var connected = store.get().wallet.status === 'connected';
    if (!connected || !data.genesis) return;
    store.update('seed', data.seed);
    store.update('creature', data.creature);
    store.update('genesis', {
      status: 'ready',
      walletId: data.genesis.walletId,
      genesisUsed: data.genesis.genesisUsed,
      genesisSeedId: data.genesis.genesisSeedId,
      genesisCreatureId: data.genesis.genesisCreatureId,
    });
  }

  // Load the supply, and this wallet's Genesis when a wallet is connected.
  async function load() {
    var seq = ++loadSeq;
    var connected = store.get().wallet.status === 'connected';
    if (store.get().supply.status === 'error') store.update('supply', { status: 'loading' });
    if (connected) store.update('genesis', { status: 'loading' });
    try {
      var res = await wallet.api('/api/genesis');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var data = await res.json();
      if (seq !== loadSeq) return;
      apply(data);
    } catch (err) {
      if (seq !== loadSeq) return;
      store.update('supply', { status: 'error' });
      if (connected) store.update('genesis', { status: 'error' });
    }
  }

  async function act(kind, path, body) {
    var g = store.get().genesis;
    if (g.pending) return; // one request at a time
    store.update('genesis', { pending: kind, error: null, notice: null });
    try {
      var res = await wallet.api(path, { method: 'POST', body: body || {} });
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok) {
        store.update('genesis', {
          pending: null,
          error: data.error === 'sold_out' ? null : (data.message || "That didn't work. Try again."),
        });
        // Whatever happened, show what the server now holds (a sold-out
        // refusal shows as the full supply).
        load();
        return;
      }
      store.update('genesis', {
        pending: null,
        notice: data.created ? (kind === 'mint' ? 'seed-created' : 'creature-awakened') : null,
      });
      apply(data);
    } catch (err) {
      // The request may or may not have reached the server: reload to find out.
      store.update('genesis', { pending: null, error: "Couldn't reach HOMESTEAD. Check your connection and try again." });
      load();
    }
  }

  function mint() {
    return act('mint', '/api/genesis/mint');
  }

  function awaken() {
    var seed = store.get().seed;
    if (!seed) return;
    return act('awaken', '/api/genesis/awaken', { seedId: seed.seedId });
  }

  // Follow the wallet: load its Genesis when it connects, forget it when it
  // disconnects (the Genesis itself stays used on the server).
  var lastWallet = store.get().wallet.status + ':' + store.get().wallet.address;
  store.subscribe(function (state) {
    var key = state.wallet.status + ':' + state.wallet.address;
    if (key === lastWallet) return;
    lastWallet = key;
    if (state.wallet.status === 'connected') load();
    else if (state.wallet.status === 'disconnected') {
      store.update('genesis', store.createInitialState().genesis);
      store.update('seed', null);
      store.update('creature', null);
    }
  });

  window.HOMESTEAD_GENESIS = { load: load, mint: mint, awaken: awaken };
})();
