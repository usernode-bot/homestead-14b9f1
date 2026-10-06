// HOMESTEAD Marketplace, in the page: the food this wallet holds, its STEAD,
// and buying food (lib/marketplace.js).
//
// The server owns every rule: prices, the balance, the most of one food a
// wallet can hold. This loads that state into the store and sends one
// purchase at a time (the BUY buttons are disabled meanwhile). Each tap gets
// its own requestId; a purchase that never got an answer is sent once more
// with the SAME id, so the server charges for it at most once.
(function () {
  var store = window.HOMESTEAD_STORE;
  var wallet = window.HOMESTEAD_WALLET;
  var loadSeq = 0;

  function apply(data) {
    var w = store.get().wallet;
    if (w.status !== 'connected' || data.walletId !== w.address) return;
    store.update('marketplace', { status: 'ready', walletId: data.walletId, owned: data.owned || {}, steadBalance: data.steadBalance });
    // The open Creature's FEED buttons show the same food.
    var v = store.get().viewedCreature;
    if (v.controls && v.ownedByYou) store.update('viewedCreature', { controls: Object.assign({}, v.controls, { food: data.owned || {} }) });
  }

  async function load() {
    if (store.get().wallet.status !== 'connected') return;
    var seq = ++loadSeq;
    if (store.get().marketplace.status !== 'ready') store.update('marketplace', { status: 'loading' });
    try {
      var res = await wallet.api('/api/marketplace');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var data = await res.json();
      if (seq !== loadSeq) return;
      apply(data);
    } catch (err) {
      if (seq !== loadSeq) return;
      store.update('marketplace', { status: 'error' });
    }
  }

  // Load unless it is already loaded (or loading) for this wallet.
  function ensure() {
    var state = store.get();
    if (state.wallet.status !== 'connected') return;
    var m = state.marketplace;
    if (m.status === 'loading' || (m.status === 'ready' && m.walletId === state.wallet.address)) return;
    if (m.status === 'error') return; // Retry reloads it
    load();
  }

  // Food was eaten somewhere else (a Creature's profile): load again next time.
  function forget() {
    if (store.get().marketplace.status === 'ready') store.update('marketplace', { status: 'idle' });
  }

  function newRequestId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'r' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
  }

  async function buy(foodId) {
    var m = store.get().marketplace;
    if (m.pending || store.get().wallet.status !== 'connected') return;
    var body = { foodId: foodId, requestId: newRequestId() };
    store.update('marketplace', { pending: 'buy:' + foodId, notice: null, error: null });
    var res = null;
    for (var attempt = 0; attempt < 2 && !res; attempt++) {
      try {
        res = await wallet.api('/api/marketplace/buy', { method: 'POST', body: body });
      } catch (err) {
        res = null; // no answer: try once more with the same requestId
      }
    }
    if (!res) {
      store.update('marketplace', { pending: null, error: 'Couldn\'t reach HOMESTEAD. Check your connection and try again.' });
      load();
      return;
    }
    var data = await res.json().catch(function () { return {}; });
    if (!res.ok) {
      store.update('marketplace', { pending: null, error: data.message || 'That didn\'t work. Try again.' });
      load(); // show what changed (another tab)
      return;
    }
    store.update('marketplace', { pending: null, notice: data.bought ? { foodId: data.bought.foodId, price: data.bought.price } : null });
    apply(data);
    if (window.HOMESTEAD_STEAD) window.HOMESTEAD_STEAD.load();
  }

  function clearMessages() {
    var m = store.get().marketplace;
    if (m.notice || m.error) store.update('marketplace', { notice: null, error: null });
  }

  // Forget this wallet's food on this device when it disconnects or changes.
  var lastWallet = null;
  store.subscribe(function (state) {
    var key = state.wallet.status + ':' + state.wallet.address;
    if (key === lastWallet) return;
    lastWallet = key;
    if (state.marketplace.status !== 'idle' || state.marketplace.notice || state.marketplace.error) {
      loadSeq++;
      store.update('marketplace', store.createInitialState().marketplace);
    }
  });

  window.HOMESTEAD_MARKETPLACE = { load: load, ensure: ensure, forget: forget, buy: buy, clearMessages: clearMessages };
})();
