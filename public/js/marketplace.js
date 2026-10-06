// HOMESTEAD Marketplace, in the page: the food this wallet holds, its STEAD,
// and buying food (lib/marketplace.js).
//
// The server owns every rule: prices, the balance, the most of one food a
// wallet can hold. This loads that state into the store and sends one
// purchase at a time (the BUY buttons are disabled meanwhile). Each tap gets
// its own requestId; a purchase that never got an answer is sent once more
// with the SAME id, so the server charges for it at most once.
//
// Players' Resource listings work the same way: list, buy and cancel are one
// request at a time, the server answers with the whole Marketplace again, and
// a repeat is safe (a listing sells once). The sell form's typing is kept in
// `form`, never in the store, so typing doesn't re-render.
(function () {
  var store = window.HOMESTEAD_STORE;
  var wallet = window.HOMESTEAD_WALLET;
  var loadSeq = 0;
  var form = { resource: '', quantity: '', price: '' };

  // Without a connected wallet only what is for sale is shown.
  function apply(data) {
    var w = store.get().wallet;
    if (w.status !== 'connected') {
      store.update('marketplace', { status: 'ready', walletId: null, listings: data.listings || [] });
      return;
    }
    if (data.walletId !== w.address) return;
    store.update('marketplace', {
      status: 'ready', walletId: data.walletId, owned: data.owned || {}, steadBalance: data.steadBalance,
      listings: data.listings || [], myListings: data.myListings || [], storage: data.storage || null,
    });
    // The open Creature's FEED buttons show the same food.
    var v = store.get().viewedCreature;
    if (v.controls && v.ownedByYou) store.update('viewedCreature', { controls: Object.assign({}, v.controls, { food: data.owned || {} }) });
  }

  async function load() {
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

  // Load unless it is already loaded (or loading) for this wallet, or for
  // nobody while no wallet is connected.
  function ensure() {
    var state = store.get();
    var who = state.wallet.status === 'connected' ? state.wallet.address : null;
    var m = state.marketplace;
    if (m.status === 'loading' || (m.status === 'ready' && m.walletId === who)) return;
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

  // One listing request (list, buy or cancel). A request that never got an
  // answer is sent once more, unchanged: the server does it at most once.
  async function send(pendingKey, path, body, onDone) {
    var m = store.get().marketplace;
    if (m.pending || store.get().wallet.status !== 'connected') return;
    store.update('marketplace', { pending: pendingKey, notice: null, error: null });
    var res = null;
    for (var attempt = 0; attempt < 2 && !res; attempt++) {
      try {
        res = await wallet.api(path, { method: 'POST', body: body });
      } catch (err) {
        res = null;
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
      load(); // show what changed (someone else bought it, another tab)
      return;
    }
    store.update('marketplace', { pending: null, notice: onDone(data) });
    apply(data);
    if (window.HOMESTEAD_STEAD) window.HOMESTEAD_STEAD.load();
    // The Homestead's storage changed: open it fresh next time.
    if (window.HOMESTEAD_HOMESTEADS && window.HOMESTEAD_HOMESTEADS.forget) window.HOMESTEAD_HOMESTEADS.forget();
  }

  function listResources() {
    var body = { resource: form.resource, quantity: Number(form.quantity), price: Number(form.price), requestId: newRequestId() };
    send('list', '/api/marketplace/listings', body, function (data) {
      if (!data.listed) return null;
      form.quantity = '';
      form.price = '';
      return { kind: 'listed', listing: data.listed };
    });
  }

  function buyListing(id) {
    send('buy-listing:' + id, '/api/marketplace/listings/' + Number(id) + '/buy', {}, function (data) {
      return data.boughtListing ? { kind: 'bought-listing', listing: data.boughtListing } : null;
    });
  }

  function cancelListing(id) {
    send('cancel-listing:' + id, '/api/marketplace/listings/' + Number(id) + '/cancel', {}, function (data) {
      return data.cancelled ? { kind: 'cancelled', listing: data.cancelled } : null;
    });
  }

  function who(username, address) {
    return username ? '@' + username : wallet.shortAddress(address);
  }

  // After a render: players' names go in as text, and what was typed goes
  // back into the sell form as values.
  function fillForm(root) {
    root = root || document;
    var m = store.get().marketplace;
    var byId = {};
    (m.listings || []).concat(m.myListings || []).forEach(function (l) { byId[l.listingId] = l; });
    root.querySelectorAll('[data-listing-seller]').forEach(function (el) {
      var l = byId[el.dataset.listingSeller];
      el.textContent = l ? who(l.sellerName, l.seller) : '';
    });
    root.querySelectorAll('[data-listing-buyer]').forEach(function (el) {
      var l = byId[el.dataset.listingBuyer];
      el.textContent = l ? who(l.buyerName, l.buyer) : '';
    });
    var select = root.querySelector('#market-resource');
    if (select) {
      if (form.resource) select.value = form.resource;
      if (!select.value && select.options.length) select.selectedIndex = 0;
      form.resource = select.value;
    }
    var quantity = root.querySelector('#market-quantity');
    if (quantity) quantity.value = form.quantity;
    var price = root.querySelector('#market-price');
    if (price) price.value = form.price;
  }

  document.addEventListener('input', function (e) {
    var key = e.target && e.target.dataset && e.target.dataset.marketInput;
    if (key) form[key] = e.target.value;
  });
  document.addEventListener('change', function (e) {
    var key = e.target && e.target.dataset && e.target.dataset.marketInput;
    if (key) form[key] = e.target.value;
  });
  document.addEventListener('submit', function (e) {
    if (e.target && e.target.id === 'market-sell-form') { e.preventDefault(); listResources(); }
  });

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

  window.HOMESTEAD_MARKETPLACE = {
    load: load, ensure: ensure, forget: forget, buy: buy, clearMessages: clearMessages,
    buyListing: buyListing, cancelListing: cancelListing, fillForm: fillForm,
  };
})();
