// HOMESTEAD wallet connection, through Homeroom.
//
// "Connecting" reads the wallet linked to the signed-in Homeroom account,
// as the server verified it from the platform's identity token
// (GET /api/me -> req.user.usernode_pubkey). Nothing is signed or sent: this
// is only the identity Genesis (genesis.js) builds on.
// Disconnecting forgets the connection on this device.
(function () {
  var store = window.HOMESTEAD_STORE;
  var params = new URLSearchParams(window.location.search);
  // Inside the Homeroom frame the token arrives as ?token=; at the app's own
  // address the platform's edge adds it as a header, so there may be none.
  var token = params.get('token') || '';
  var REMEMBER_KEY = 'homestead:wallet-connected';

  // GET by default; pass { method: 'POST', body: {...} } to write.
  function api(path, opts) {
    opts = opts || {};
    var headers = {};
    if (token) headers['x-usernode-token'] = token;
    var u = window.usernode;
    if (u && u.previewNow && typeof u.now === 'function') {
      headers['x-usernode-now'] = u.now().toISOString();
    }
    var init = { method: opts.method || 'GET', headers: headers };
    if (opts.body !== undefined) {
      headers['content-type'] = 'application/json';
      init.body = JSON.stringify(opts.body);
    }
    return fetch(path, init);
  }

  function shortAddress(address) {
    if (!address) return '';
    return address.length > 14 ? address.slice(0, 7) + '…' + address.slice(-4) : address;
  }

  // quiet: a background reconnect, which fails without a message.
  async function connect(quiet) {
    store.update('wallet', { status: 'connecting', error: null });
    var me;
    try {
      var res = await api('/api/me');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      me = await res.json();
    } catch (err) {
      store.update('wallet', {
        status: 'disconnected',
        error: quiet ? null : "Couldn't reach Homeroom. Check your connection and try again.",
      });
      return;
    }
    if (me.guest) {
      store.update('wallet', { status: 'disconnected', error: null });
      if (!quiet) {
        try { window.usernode.askForAccount({ action: 'connect a wallet' }); } catch (_) {}
      }
      return;
    }
    if (!me.user || !me.user.wallet) {
      try { localStorage.removeItem(REMEMBER_KEY); } catch (_) {}
      store.update('wallet', {
        status: 'disconnected',
        username: me.user ? me.user.username : null,
        error: quiet ? null : 'No wallet is linked to your Homeroom account yet. Link one in Homeroom, then connect again.',
      });
      return;
    }
    try { localStorage.setItem(REMEMBER_KEY, '1'); } catch (_) {}
    store.update('wallet', {
      status: 'connected',
      address: me.user.wallet,
      username: me.user.username,
      error: null,
    });
  }

  function disconnect() {
    try { localStorage.removeItem(REMEMBER_KEY); } catch (_) {}
    store.update('wallet', store.createInitialState().wallet);
  }

  // Reconnect quietly if this device connected before.
  function restore() {
    var remembered = false;
    try { remembered = localStorage.getItem(REMEMBER_KEY) === '1'; } catch (_) {}
    if (remembered) connect(true);
  }

  window.HOMESTEAD_WALLET = {
    connect: connect,
    disconnect: disconnect,
    restore: restore,
    shortAddress: shortAddress,
    token: token,
    api: api,
  };
})();
