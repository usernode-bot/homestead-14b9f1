// HOMESTEAD STEAD Points and Daily Check-in, in the page.
//
// The server (lib/stead.js) owns every rule and number: the balance, the
// ledger, which calendar day it is and whether today is claimed. This only
// loads that state into the store and sends a claim, refusing to send a
// second while one is in flight. A repeated claim is safe anyway: the server
// refuses it and pays nothing.
(function () {
  var store = window.HOMESTEAD_STORE;
  var wallet = window.HOMESTEAD_WALLET;
  var loadSeq = 0;

  function apply(data) {
    var w = store.get().wallet;
    if (w.status !== 'connected' || data.walletId !== w.address) return;
    store.update('stead', {
      status: 'ready',
      walletId: data.walletId,
      steadBalance: data.steadBalance,
      checkIn: data.checkIn,
      ledger: data.ledger || [],
    });
  }

  async function load() {
    if (store.get().wallet.status !== 'connected') return;
    var seq = ++loadSeq;
    if (store.get().stead.status !== 'ready') store.update('stead', { status: 'loading' });
    try {
      var res = await wallet.api('/api/stead');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var data = await res.json();
      if (seq !== loadSeq) return;
      apply(data);
    } catch (err) {
      if (seq !== loadSeq) return;
      store.update('stead', { status: 'error' });
    }
  }

  async function claim() {
    var s = store.get().stead;
    if (s.pending || !s.checkIn || !s.checkIn.canClaim) return; // one claim at a time
    store.update('stead', { pending: 'claim', error: null, notice: null });
    try {
      var res = await wallet.api('/api/stead/check-in', { method: 'POST', body: {} });
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok) {
        store.update('stead', {
          pending: null,
          // Already claimed (another tab, say): just show the claimed state.
          error: data.error === 'already_claimed' ? null : (data.message || "That didn't work. Try again."),
        });
        load();
        return;
      }
      store.update('stead', { pending: null, notice: 'claimed' });
      apply(data);
    } catch (err) {
      // The claim may or may not have reached the server: reload to find out.
      store.update('stead', { pending: null, error: "Couldn't reach HOMESTEAD. Check your connection and try again." });
      load();
    }
  }

  // Follow the wallet: load its STEAD when it connects, forget it on this
  // device when it disconnects (the balance stays on the server).
  var lastWallet = store.get().wallet.status + ':' + store.get().wallet.address;
  store.subscribe(function (state) {
    var key = state.wallet.status + ':' + state.wallet.address;
    if (key === lastWallet) return;
    lastWallet = key;
    loadSeq++;
    store.update('stead', store.createInitialState().stead);
    if (state.wallet.status === 'connected') load();
  });

  window.HOMESTEAD_STEAD = { load: load, claim: claim };
})();
