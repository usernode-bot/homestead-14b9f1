// HOMESTEAD Gear, in the page: this wallet's Gear inventory, the starter
// claim, and equipping and unequipping (lib/gear.js).
//
// The server owns every rule: who owns what, which slot an item fits, and
// that an item is on at most one Creature. This loads the inventory into the
// store and sends one request at a time (the buttons are disabled meanwhile).
// Repeating a request is safe anyway: the server changes nothing twice.
(function () {
  var store = window.HOMESTEAD_STORE;
  var wallet = window.HOMESTEAD_WALLET;
  var cfg = window.HOMESTEAD_GEAR_CONFIG;
  var loadSeq = 0;

  function apply(data) {
    var w = store.get().wallet;
    if (w.status !== 'connected' || data.walletId !== w.address) return;
    store.update('gear', { status: 'ready', walletId: data.walletId, items: data.items || [], starterClaimed: !!data.starterClaimed });
  }

  async function load() {
    if (store.get().wallet.status !== 'connected') return;
    var seq = ++loadSeq;
    if (store.get().gear.status !== 'ready') store.update('gear', { status: 'loading' });
    try {
      var res = await wallet.api('/api/gear');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var data = await res.json();
      if (seq !== loadSeq) return;
      apply(data);
    } catch (err) {
      if (seq !== loadSeq) return;
      store.update('gear', { status: 'error' });
    }
  }

  // Load the inventory unless it is already loaded (or loading) for this wallet.
  function ensure() {
    var state = store.get();
    if (state.wallet.status !== 'connected') return;
    var g = state.gear;
    if (g.status === 'loading' || (g.status === 'ready' && g.walletId === state.wallet.address)) return;
    if (g.status === 'error') return; // Retry reloads it
    load();
  }

  async function request(kind, path, body, noticeFor) {
    var g = store.get().gear;
    if (g.pending) return;
    store.update('gear', { pending: kind, notice: null, error: null });
    try {
      var res = await wallet.api(path, { method: 'POST', body: body || {} });
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok) {
        store.update('gear', { pending: null, error: data.message || 'That didn\'t work. Try again.' });
        load(); // show what changed (another tab)
        if (body && body.creatureId && window.HOMESTEAD_CREATURES) refreshCreature(body.creatureId);
        return;
      }
      if (data.creature && window.HOMESTEAD_CREATURES) window.HOMESTEAD_CREATURES.replace(data.creature);
      store.update('gear', { pending: null, choosing: null, notice: noticeFor(data) });
      if (data.gear) apply(data.gear);
    } catch (err) {
      // It may or may not have reached the server: reload to find out.
      store.update('gear', { pending: null, error: 'Couldn\'t reach HOMESTEAD. Check your connection and try again.' });
      load();
    }
  }

  function refreshCreature(creatureId) {
    var v = store.get().viewedCreature;
    if (v.id === creatureId) window.HOMESTEAD_CREATURES.view(creatureId, true, true);
  }

  function slotLabel(slot) {
    var s = cfg.byId(cfg.SLOTS, slot);
    return s ? s.label : slot;
  }

  function claim() {
    return request('claim', '/api/gear/claim-starter', {}, function (data) {
      return data.alreadyClaimed ? null : { kind: 'claimed', count: data.granted.length };
    });
  }

  function equip(creatureId, gearId, slot) {
    return request('equip:' + gearId, '/api/creatures/' + Number(creatureId) + '/gear/equip', { gearId: gearId, slot: slot, creatureId: creatureId }, function (data) {
      var r = data.result;
      if (r.replaced) return { kind: 'replaced', slotLabel: slotLabel(slot), oldName: r.replaced.name, newName: r.equipped.name, creatureId: creatureId };
      return { kind: 'equipped', name: r.equipped.name, creatureId: creatureId };
    });
  }

  function unequip(creatureId, slot) {
    return request('unequip:' + slot, '/api/creatures/' + Number(creatureId) + '/gear/unequip', { slot: slot, creatureId: creatureId }, function (data) {
      var r = data.result;
      return r.unequipped ? { kind: 'unequipped', name: r.unequipped.name } : null;
    });
  }

  // Open the picker for one of a Creature's slots, or close it.
  function choose(creatureId, slot) {
    store.update('gear', { choosing: { creatureId: creatureId, slot: slot }, notice: null, error: null });
    ensure();
  }
  function cancelChoose() {
    store.update('gear', { choosing: null });
  }

  // Forget the inventory when the wallet disconnects or changes.
  var lastWallet = null;
  store.subscribe(function (state) {
    var key = state.wallet.status + ':' + state.wallet.address;
    if (key === lastWallet) return;
    lastWallet = key;
    if (state.gear.status !== 'idle' || state.gear.notice || state.gear.choosing) {
      loadSeq++;
      store.update('gear', store.createInitialState().gear);
    }
  });

  window.HOMESTEAD_GEAR = { load: load, ensure: ensure, claim: claim, equip: equip, unequip: unequip, choose: choose, cancelChoose: cancelChoose };
})();
