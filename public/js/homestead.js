// HOMESTEAD Homesteads, in the page: this wallet's Homestead and the one open
// at /homestead/<id>.
//
// The server (lib/homestead.js) owns every rule: one Homestead per wallet,
// created the first time the wallet owns a Creature, holding the Creature the
// wallet owns now. This only asks for it when the Homestead screen shows and
// puts the answer in the store. Rendering never creates anything.
// Work (lib/work.js) is sent from here too: start, collect and the countdown.
(function () {
  var store = window.HOMESTEAD_STORE;
  var wallet = window.HOMESTEAD_WALLET;
  var wcfg = window.HOMESTEAD_WORK_CONFIG;
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
    store.update('homestead', { status: 'loading', key: key, error: null });
    try {
      var res = await wallet.api('/api/homestead', { method: 'POST', body: {} });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var data = await res.json();
      if (seq !== openSeq) return;
      store.update('homestead', ownPatch(data));
    } catch (err) {
      if (seq !== openSeq) return;
      store.update('homestead', { status: 'error' });
    }
  }

  // The store patch for a server answer with this wallet's Homestead.
  function ownPatch(data) {
    return {
      status: 'ready',
      homestead: data.homestead,
      creature: data.creature,
      work: data.work || null,
      clockOffset: clockOffset(data.work),
    };
  }

  function clockOffset(work) {
    var t = work && Date.parse(work.serverNow);
    return t ? t - Date.now() : 0;
  }

  // Reload this wallet's Homestead without showing the loading screen (when
  // Work finishes while the page is open). The server settles finished Work.
  async function refresh() {
    var h = store.get().homestead;
    if (h.status !== 'ready' || h.pending) return;
    var seq = ++openSeq;
    try {
      var res = await wallet.api('/api/homestead', { method: 'POST', body: {} });
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var data = await res.json();
      if (seq !== openSeq) return;
      store.update('homestead', ownPatch(data));
    } catch (err) {
      // Keep showing what is there; the next tick or visit tries again.
    }
  }

  // A Work request (start, collect, collect the rest). The server answers
  // with the whole Homestead; it refuses a second start and never pays twice,
  // so a double tap or another tab is harmless. Buttons are disabled while
  // one is in flight.
  async function workRequest(kind, path, body) {
    var h = store.get().homestead;
    if (h.status !== 'ready' || h.pending) return;
    var seq = ++openSeq;
    store.update('homestead', { pending: kind, error: null });
    try {
      var res = await wallet.api(path, { method: 'POST', body: body || {} });
      var data = await res.json().catch(function () { return {}; });
      if (seq !== openSeq) return;
      if (!res.ok) {
        store.update('homestead', { pending: null, error: data.message || 'Something went wrong. Try again.' });
        if (res.status === 409 || res.status === 403) refresh();
        return;
      }
      store.update('homestead', Object.assign(ownPatch(data), { pending: null }));
    } catch (err) {
      if (seq !== openSeq) return;
      store.update('homestead', { pending: null, error: 'Couldn\'t reach HOMESTEAD. Check your connection and try again.' });
    }
  }

  function startWork(creatureId, durationId, buildingId) {
    return workRequest('start', '/api/work/start', { creatureId: creatureId, durationId: durationId, buildingId: buildingId });
  }
  function collect(workId) {
    return workRequest('collect', '/api/work/' + Number(workId) + '/collect');
  }
  function collectPending() {
    return workRequest('collect', '/api/work/collect-pending');
  }

  // Load the Homestead at /homestead/<id>, unless it is already showing.
  // quiet: reload what is showing without the loading screen.
  async function view(id, force, quiet) {
    var v = store.get().viewedHomestead;
    if (!force && v.id === id && v.status !== 'error') return;
    var seq = ++viewSeq;
    if (!quiet) store.update('viewedHomestead', { status: 'loading', id: id, homestead: null, creature: null, work: null, ownedByYou: false });
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
      // The server answers a number nobody has with homestead: null.
      if (!data.homestead) {
        store.update('viewedHomestead', { status: 'missing' });
        return;
      }
      store.update('viewedHomestead', {
        status: 'ready', homestead: data.homestead, creature: data.creature,
        work: data.work || null, clockOffset: clockOffset(data.work), ownedByYou: data.ownedByYou,
      });
    } catch (err) {
      if (seq !== viewSeq) return;
      if (!quiet) store.update('viewedHomestead', { status: 'error' });
    }
  }

  // The Work countdown: once a second, update every time-remaining text and
  // progress bar from the stored start and end times (the server's clock,
  // never a counter). When a Work's time is up, reload once so the server
  // settles it and its rewards show. Closing the page stops nothing: the
  // server works it out from the timestamps.
  var refreshed = {};
  setInterval(function () {
    var els = document.querySelectorAll('[data-work-ends]');
    if (!els.length) return;
    var state = store.get();
    var dueOwn = false;
    var dueViewed = false;
    els.forEach(function (el) {
      var own = el.dataset.workScope === 'own';
      var offset = own ? state.homestead.clockOffset : state.viewedHomestead.clockOffset;
      var now = Date.now() + (offset || 0);
      var ends = Date.parse(el.dataset.workEnds);
      var started = Date.parse(el.dataset.workStarted);
      var left = ends - now;
      var text = el.querySelector('[data-work-remaining]');
      if (text) text.textContent = wcfg.formatSpan(left);
      var bar = el.querySelector('[data-work-progress]');
      if (bar && ends > started) bar.style.width = Math.min(100, Math.max(0, ((now - started) / (ends - started)) * 100)) + '%';
      if (left <= 0 && !refreshed[el.dataset.workId]) {
        refreshed[el.dataset.workId] = true;
        if (own) dueOwn = true; else dueViewed = true;
      }
    });
    if (dueOwn) refresh();
    if (dueViewed && state.viewedHomestead.id != null) view(state.viewedHomestead.id, true, true);
  }, 1000);

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

  // Its storage changed somewhere else (a Marketplace sale): open it again
  // the next time the Homestead screen shows.
  function forget() {
    if (store.get().homestead.key) store.update('homestead', { key: null });
  }

  window.HOMESTEAD_HOMESTEADS = { open: open, view: view, startWork: startWork, collect: collect, collectPending: collectPending, forget: forget };
})();
