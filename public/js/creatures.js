// HOMESTEAD Creatures, in the page: the wallet's collection, the Creature
// open at /creature/<id>, and renaming.
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
  async function view(id, force) {
    var v = store.get().viewedCreature;
    if (!force && v.id === id && v.status !== 'error') return;
    var seq = ++viewSeq;
    store.update('viewedCreature', { status: 'loading', id: id, creature: null, ownedByYou: false });
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
      store.update('viewedCreature', { status: 'ready', creature: data.creature, ownedByYou: data.ownedByYou });
    } catch (err) {
      if (seq !== viewSeq) return;
      store.update('viewedCreature', { status: 'error' });
    }
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

  window.HOMESTEAD_CREATURES = { loadCollection: loadCollection, view: view, openRename: openRename };
})();
