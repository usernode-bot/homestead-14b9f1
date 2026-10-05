// HOMESTEAD Creatures, in the page: the wallet's collection, the Creature
// open at /creature/<id>, renaming, and Feeding + Training (lib/care.js).
//
// Everything shown comes from the server, which generated it once at Awaken
// and stored it. Nothing here rolls or invents a Creature.
(function () {
  var store = window.HOMESTEAD_STORE;
  var wallet = window.HOMESTEAD_WALLET;
  var names = window.HOMESTEAD_CREATURE_NAME;
  var collectionSeq = 0;
  var viewSeq = 0;

  async function loadCollection() {
    var seq = ++collectionSeq;
    if (store.get().wallet.status !== 'connected') {
      store.update('collection', { status: 'idle', creatures: [] });
      return;
    }
    store.update('collection', { status: 'loading' });
    try {
      var res = await wallet.api('/api/creatures');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var data = await res.json();
      if (seq !== collectionSeq) return;
      store.update('collection', { status: 'ready', creatures: data.creatures });
    } catch (err) {
      if (seq !== collectionSeq) return;
      store.update('collection', { status: 'error' });
    }
  }

  // Load the Creature at /creature/<id>, unless it is already showing.
  // quiet: reload what is showing without the loading screen.
  async function view(id, force, quiet) {
    var v = store.get().viewedCreature;
    if (!force && v.id === id && v.status !== 'error') return;
    var seq = ++viewSeq;
    if (!quiet || v.id !== id) {
      store.update('viewedCreature', { status: 'loading', id: id, creature: null, ownedByYou: false, controls: null, contest: null, pending: null, notice: null, error: null });
    }
    try {
      var res = await wallet.api('/api/creatures/' + id);
      if (seq !== viewSeq) return;
      if (res.status === 404) {
        store.update('viewedCreature', { status: 'missing' });
        return;
      }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var data = await res.json();
      if (seq !== viewSeq) return;
      // The server answers an id nobody has with creature: null.
      if (!data.creature) {
        store.update('viewedCreature', { status: 'missing' });
        return;
      }
      store.update('viewedCreature', { status: 'ready', creature: data.creature, ownedByYou: data.ownedByYou, controls: data.controls || null, contest: data.contest || null });
    } catch (err) {
      if (seq !== viewSeq) return;
      if (!quiet) store.update('viewedCreature', { status: 'error' });
    }
  }

  // ── Feeding + Training ────────────────────────────────────────────────────
  // One request at a time (the buttons are disabled meanwhile). Each tap gets
  // its own requestId; a request that never got an answer is sent once more
  // with the SAME id, so the server applies it at most once. The server
  // answers with the Creature and the owner's controls as they now are.
  function newRequestId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'r' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
  }

  async function careRequest(kind, path, body, noticeFor) {
    var v = store.get().viewedCreature;
    if (v.status !== 'ready' || !v.ownedByYou || v.pending) return;
    var id = v.id;
    body = Object.assign({ requestId: newRequestId() }, body);
    store.update('viewedCreature', { pending: kind, notice: null, error: null });
    var res = null;
    for (var attempt = 0; attempt < 2 && !res; attempt++) {
      try {
        res = await wallet.api(path, { method: 'POST', body: body });
      } catch (err) {
        res = null; // no answer: try once more with the same requestId
      }
    }
    if (store.get().viewedCreature.id !== id) return;
    if (!res) {
      store.update('viewedCreature', { pending: null, error: 'Couldn\'t reach HOMESTEAD. Check your connection and try again.' });
      view(id, true, true);
      return;
    }
    var data = await res.json().catch(function () { return {}; });
    if (!res.ok) {
      store.update('viewedCreature', { pending: null, error: data.message || 'That didn\'t work. Try again.' });
      view(id, true, true); // show what changed (another tab, Work started)
      return;
    }
    store.update('viewedCreature', { pending: null, controls: data.controls, notice: noticeFor(data) });
    replace(data.creature);
    afterCare(kind);
  }

  // What else a Feed or Train changed: storage (Fodder) or the STEAD balance.
  function afterCare(kind) {
    if (kind === 'feed') {
      // The Homestead reloads its storage next time it is opened.
      if (store.get().homestead.status === 'ready') store.update('homestead', { key: null });
    } else if (window.HOMESTEAD_STEAD) {
      window.HOMESTEAD_STEAD.load();
    }
  }

  function feed() {
    var v = store.get().viewedCreature;
    return careRequest('feed', '/api/creatures/' + Number(v.id) + '/feed', {}, function (data) {
      return { kind: 'fed', restored: data.fed.restored, fodderSpent: data.fed.fodderSpent };
    });
  }

  function train(stat) {
    var v = store.get().viewedCreature;
    return careRequest('train:' + stat, '/api/creatures/' + Number(v.id) + '/train', { stat: stat }, function (data) {
      return { kind: 'trained', stat: data.trained.stat, amount: data.trained.amount, cost: data.trained.cost };
    });
  }

  // Put a Creature the server returned everywhere it shows.
  function replace(creature) {
    var state = store.get();
    if (state.creature && state.creature.creatureId === creature.creatureId) store.update('creature', creature);
    if (state.collection.creatures.some(function (c) { return c.creatureId === creature.creatureId; })) {
      store.update('collection', {
        creatures: state.collection.creatures.map(function (c) { return c.creatureId === creature.creatureId ? creature : c; }),
      });
    }
    if (state.viewedCreature.creature && state.viewedCreature.creature.creatureId === creature.creatureId) {
      store.update('viewedCreature', { creature: creature });
    }
  }

  // ── Rename dialog (the <dialog id="rename-dialog"> in index.html) ─────────
  var dialog = document.getElementById('rename-dialog');
  var form = document.getElementById('rename-form');
  var input = document.getElementById('rename-input');
  var currentEl = document.getElementById('rename-current');
  var errorEl = document.getElementById('rename-error');
  var saveBtn = document.getElementById('rename-save');
  var renaming = null; // the Creature being renamed
  var saving = false;

  function showError(message) {
    errorEl.textContent = message || '';
    errorEl.hidden = !message;
    input.setAttribute('aria-invalid', message ? 'true' : 'false');
  }

  function openRename(creature) {
    if (!creature || !dialog) return;
    renaming = creature;
    currentEl.textContent = creature.name || '';
    input.value = creature.name || '';
    input.maxLength = names.RULES.max + 10; // room to trim spaces; the validator decides
    showError(null);
    saveBtn.disabled = false;
    saveBtn.textContent = 'SAVE';
    dialog.showModal();
    input.focus();
    input.select();
  }

  function closeRename() {
    if (saving) return;
    renaming = null;
    if (dialog.open) dialog.close();
  }

  async function save() {
    if (!renaming || saving) return;
    var check = names.validate(input.value);
    if (!check.ok) { showError(check.error); input.focus(); return; }
    if (check.name === renaming.name) { closeRename(); return; }
    saving = true;
    saveBtn.disabled = true;
    saveBtn.textContent = 'SAVING…';
    showError(null);
    try {
      var res = await wallet.api('/api/creatures/' + renaming.creatureId + '/name', { method: 'POST', body: { name: check.name } });
      var data = await res.json().catch(function () { return {}; });
      saving = false;
      saveBtn.disabled = false;
      saveBtn.textContent = 'SAVE';
      if (!res.ok) { showError(data.message || "Couldn't rename. Try again."); return; }
      replace(data.creature);
      closeRename();
    } catch (err) {
      saving = false;
      saveBtn.disabled = false;
      saveBtn.textContent = 'SAVE';
      showError("Couldn't reach HOMESTEAD. Check your connection and try again.");
    }
  }

  if (dialog) {
    form.addEventListener('submit', function (e) { e.preventDefault(); save(); });
    document.getElementById('rename-cancel').addEventListener('click', closeRename);
    dialog.addEventListener('cancel', function (e) { if (saving) e.preventDefault(); else renaming = null; });
    input.addEventListener('input', function () { if (!errorEl.hidden) showError(null); });
  }

  // Follow the wallet and the Genesis Creature: reload the collection when
  // either changes (a new Awaken adds a Creature).
  var lastKey = null;
  store.subscribe(function (state) {
    var key = state.wallet.status + ':' + state.wallet.address + ':' + (state.creature ? state.creature.creatureId : '');
    if (key === lastKey) return;
    lastKey = key;
    if (state.wallet.status === 'connecting') return;
    loadCollection();
    var v = state.viewedCreature;
    if (v.id != null) view(v.id, true); // whether you own it may have changed
  });

  window.HOMESTEAD_CREATURES = { loadCollection: loadCollection, view: view, openRename: openRename, feed: feed, train: train, replace: replace };
})();
