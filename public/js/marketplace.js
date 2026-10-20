// HOMESTEAD Marketplace, in the page: the food this wallet holds, its STEAD,
// and buying food (lib/marketplace.js).
//
// The server owns every rule: prices, the balance, the most of one food a
// wallet can hold. This loads that state into the store and sends one
// purchase at a time (the BUY buttons are disabled meanwhile). Each tap gets
// its own requestId; a purchase that never got an answer is sent once more
// with the SAME id, so the server charges for it at most once.
//
// Resource packs from the app and players' Resource listings work the same way: list, buy and cancel are one
// request at a time, the server answers with the whole Marketplace again, and
// a repeat is safe (a listing sells once). The sell form's typing is kept in
// `form`, never in the store, so typing doesn't re-render; so is an open
// edit's typing (`editForm`). Editing a listing replaces it (relist).
//
// BUY's search, category and sort are in the store (marketplace.browse), so
// changing them re-renders the list; they are kept in sessionStorage, so they
// survive switching tabs, other screens and a reload, until the app closes.
(function () {
  var store = window.HOMESTEAD_STORE;
  var wallet = window.HOMESTEAD_WALLET;
  var loadSeq = 0;
  var form = { resource: '', quantity: '', price: '' };
  var editForm = { quantity: '', price: '' };
  var BROWSE_KEY = 'homestead.market.browse';

  function view() { return window.HOMESTEAD_MARKET_VIEW; }

  function readBrowse() {
    try {
      var saved = JSON.parse(window.sessionStorage.getItem(BROWSE_KEY) || 'null');
      return saved ? view().normalizeBrowse(saved) : null;
    } catch (err) {
      return null; // storage off or unreadable: start from the defaults
    }
  }
  // Change BUY's search, category or sort, and keep it for the session.
  function browse(patch) {
    var next = view().normalizeBrowse(Object.assign({}, store.get().marketplace.browse, patch));
    store.update('marketplace', { browse: next, details: null });
    try { window.sessionStorage.setItem(BROWSE_KEY, JSON.stringify(next)); } catch (err) { /* not kept */ }
  }

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
      packsToday: data.packsToday || {},
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

  // One Resource pack from the app.
  function buyPack(resource) {
    send('buy-pack:' + resource, '/api/marketplace/resource-packs/buy', { resource: resource, requestId: newRequestId() }, function (data) {
      return data.boughtPack ? { kind: 'bought-pack', pack: data.boughtPack } : null;
    });
  }

  // EDIT on one of this wallet's listings (null closes it): the fields start
  // at what the listing sells for now.
  function editListing(id) {
    var m = store.get().marketplace;
    if (m.pending) return;
    var l = id == null ? null : (m.myListings || []).find(function (x) { return Number(x.listingId) === id && x.status === 'active'; });
    editForm = l ? { quantity: String(l.quantity), price: String(l.price) } : { quantity: '', price: '' };
    store.update('marketplace', { editing: l ? id : null, notice: null, error: null });
  }

  // SAVE: the listing is replaced by one with the new quantity and price.
  function saveEdit(id) {
    var body = { quantity: Number(editForm.quantity), price: Number(editForm.price), requestId: newRequestId() };
    send('relist:' + id, '/api/marketplace/listings/' + Number(id) + '/relist', body, function (data) {
      store.update('marketplace', { editing: null });
      return data.relisted ? { kind: 'relisted', listing: data.relisted } : null;
    });
  }

  function toggleDetails(id) {
    var m = store.get().marketplace;
    store.update('marketplace', { details: Number(m.details) === id ? null : id });
  }

  // SELL on a storage row: that Resource, all of it, in the form below.
  function prefill(resource) {
    var select = document.getElementById('market-resource');
    var option = select && select.querySelector('option[value="' + resource + '"]:not([disabled])');
    if (!option) return;
    var storage = store.get().marketplace.storage;
    form.resource = resource;
    form.quantity = String(Number(storage && storage.storage && storage.storage[resource]) || '');
    select.value = resource;
    var quantity = document.getElementById('market-quantity');
    if (quantity) quantity.value = form.quantity;
    updateSummary(document);
    var price = document.getElementById('market-price');
    if (price) {
      price.scrollIntoView({ block: 'center', behavior: 'smooth' });
      price.focus({ preventScroll: true });
    }
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

  // The line under the sell form: what LIST FOR SALE will publish, as text.
  function updateSummary(root) {
    var el = (root || document).querySelector('[data-market-summary]');
    if (!el) return;
    var v = view();
    var storage = store.get().marketplace.storage;
    var have = Number(storage && storage.storage && storage.storage[form.resource]) || 0;
    var quantity = Number(form.quantity);
    var price = Number(form.price);
    var label = v.resourceLabel(form.resource);
    var text;
    var warn = false;
    if (!form.resource || !(quantity >= 1) || !(price >= 1) || !Number.isInteger(quantity) || !Number.isInteger(price)) {
      text = 'Enter how many and a price to see your listing.';
    } else if (quantity > have) {
      text = 'You have ' + have.toLocaleString('en-US') + ' ' + label + '.';
      warn = true;
    } else {
      text = 'You\'ll list ' + quantity.toLocaleString('en-US') + ' ' + label + ' for ' + v.steadAmount(price) +
        ' (' + v.formatEach(v.priceEach(price, quantity)) + ' STEAD each).';
      var pack = window.HOMESTEAD_MARKET_CONFIG.pack(form.resource);
      if (pack) text += ' The app\'s pack is ' + v.formatEach(v.priceEach(pack.price, pack.size)) + ' STEAD each.';
    }
    el.textContent = text;
    el.classList.toggle('text-danger', warn);
    el.classList.toggle('text-fg', !warn && text.indexOf('You\'ll') === 0);
    el.classList.toggle('text-muted', !warn && text.indexOf('You\'ll') !== 0);
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
      // A Resource this storage has none of left is listed but can't be chosen.
      var kept = form.resource && select.querySelector('option[value="' + form.resource + '"]:not([disabled])');
      if (kept) select.value = form.resource;
      if (!select.value && select.options.length) select.selectedIndex = 0;
      form.resource = select.value;
    }
    var quantity = root.querySelector('#market-quantity');
    if (quantity) quantity.value = form.quantity;
    var price = root.querySelector('#market-price');
    if (price) price.value = form.price;
    updateSummary(root);
    var editQuantity = root.querySelector('#market-edit-quantity');
    if (editQuantity) editQuantity.value = editForm.quantity;
    var editPrice = root.querySelector('#market-edit-price');
    if (editPrice) editPrice.value = editForm.price;
    // BUY's search, and what was searched for in "Nothing matches", as text.
    var b = m.browse || {};
    var search = root.querySelector('#market-search');
    if (search && search.value !== (b.query || '')) search.value = b.query || '';
    root.querySelectorAll('[data-market-query]').forEach(function (el) {
      el.textContent = b.query ? '\u2018' + b.query + '\u2019' : 'these filters';
    });
  }

  function typed(e) {
    var data = e.target && e.target.dataset;
    if (!data) return;
    if (data.marketInput) { form[data.marketInput] = e.target.value; updateSummary(document); }
    if (data.marketEdit) editForm[data.marketEdit] = e.target.value;
  }
  document.addEventListener('input', function (e) {
    typed(e);
    if (e.target && e.target.dataset && e.target.dataset.marketBrowse === 'query') browse({ query: e.target.value });
  });
  document.addEventListener('change', function (e) {
    typed(e);
    if (e.target && e.target.dataset && e.target.dataset.marketBrowse === 'sort') browse({ sort: e.target.value });
  });
  document.addEventListener('submit', function (e) {
    if (e.target && e.target.id === 'market-sell-form') { e.preventDefault(); listResources(); }
    if (e.target && e.target.id === 'market-edit-form') { e.preventDefault(); saveEdit(Number(e.target.dataset.listingId)); }
  });

  // Leaving a screen closes its messages, an open edit and open DETAILS.
  function clearMessages() {
    var m = store.get().marketplace;
    if (m.notice || m.error || m.editing != null || m.details != null) {
      store.update('marketplace', { notice: null, error: null, editing: null, details: null });
    }
  }

  // Forget this wallet's food on this device when it disconnects or changes.
  var lastWallet = null;
  store.subscribe(function (state) {
    var key = state.wallet.status + ':' + state.wallet.address;
    if (key === lastWallet) return;
    lastWallet = key;
    if (state.marketplace.status !== 'idle' || state.marketplace.notice || state.marketplace.error) {
      loadSeq++;
      // The search, category and sort are this device's, not the wallet's.
      store.update('marketplace', Object.assign(store.createInitialState().marketplace, { browse: state.marketplace.browse }));
    }
  });

  var saved = readBrowse();
  if (saved) store.update('marketplace', { browse: saved });

  window.HOMESTEAD_MARKETPLACE = {
    load: load, ensure: ensure, forget: forget, buy: buy, clearMessages: clearMessages,
    buyPack: buyPack, buyListing: buyListing, cancelListing: cancelListing, fillForm: fillForm,
    editListing: editListing, toggleDetails: toggleDetails, browse: browse, prefill: prefill,
  };
})();
