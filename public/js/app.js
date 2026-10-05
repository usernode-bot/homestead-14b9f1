// HOMESTEAD app shell: navigation, the wallet area, and screen rendering.
(function () {
  var store = window.HOMESTEAD_STORE;
  var wallet = window.HOMESTEAD_WALLET;
  var screens = window.HOMESTEAD_SCREENS;
  var genesis = window.HOMESTEAD_GENESIS;
  var navEl = document.getElementById('nav');
  var walletEl = document.getElementById('wallet');
  var viewEl = document.getElementById('view');
  var walletMenuOpen = false;

  function currentRoute() {
    var path = window.location.pathname.replace(/\/+$/, '') || '/';
    return screens.ROUTES.find(function (r) { return r.path === path; }) || screens.ROUTES[0];
  }

  function renderNav(route) {
    navEl.innerHTML = screens.ROUTES.map(function (r) {
      return '<li><a href="' + r.path + '" data-nav class="nav-tab"' +
        (r === route ? ' aria-current="page"' : '') + '>' +
        screens.icon(r.key, 'h-4 w-4') + r.label + '</a></li>';
    }).join('');
    var active = navEl.querySelector('[aria-current="page"]');
    if (active && active.scrollIntoView) active.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  function renderWallet(state) {
    var w = state.wallet;
    if (w.status === 'connected') {
      walletEl.innerHTML =
        '<button type="button" class="btn-secondary whitespace-nowrap px-3 text-small" data-action="wallet-menu" aria-label="Wallet connected: ' + wallet.shortAddress(w.address).replace(/[^A-Za-z0-9…]/g, '') + '" aria-expanded="' + walletMenuOpen + '" aria-controls="wallet-menu">' +
          '<span class="h-2.5 w-2.5 rounded-full bg-accent" aria-hidden="true"></span>' +
          '<span class="font-mono text-small" data-field="short-address"></span>' +
        '</button>' +
        '<div id="wallet-menu" class="absolute right-0 top-full z-30 mt-2 w-72 rounded-2xl border-2 border-line bg-surface p-4"' + (walletMenuOpen ? '' : ' hidden') + '>' +
          '<p class="text-small font-bold text-accent">Connected</p>' +
          '<p class="mt-1 text-body font-bold" data-field="username"></p>' +
          '<p class="mt-1 break-all font-mono text-small text-muted" data-field="address"></p>' +
          '<button type="button" class="btn-secondary mt-4 w-full" data-action="disconnect">Disconnect</button>' +
        '</div>';
    } else {
      var busy = w.status === 'connecting';
      walletEl.innerHTML =
        '<button type="button" class="btn-primary whitespace-nowrap px-3 text-small sm:px-4 sm:text-body" data-action="connect"' + (busy ? ' disabled' : '') + '>' +
          (busy ? 'CONNECTING…' : 'CONNECT WALLET') +
        '</button>' +
        (w.error
          ? '<div role="alert" class="absolute right-0 top-full z-30 mt-2 w-72 rounded-2xl border-2 border-line bg-surface p-4 text-small">' +
              '<p data-field="error"></p>' +
            '</div>'
          : '');
    }
  }

  // Text a person owns goes in as text, never as HTML.
  function fillFields(state) {
    var w = state.wallet;
    var values = {
      'short-address': wallet.shortAddress(w.address),
      address: w.address || '',
      username: w.username ? '@' + w.username : '',
      error: w.error || '',
      'genesis-error': state.genesis.error || '',
    };
    document.querySelectorAll('[data-field]').forEach(function (el) {
      el.textContent = values[el.dataset.field] || '';
    });
  }

  function render() {
    var state = store.get();
    var route = currentRoute();
    document.title = route.label === 'HOME' || route.label === 'HOMESTEAD' ? 'HOMESTEAD' : route.label + ' · HOMESTEAD';
    renderNav(route);
    renderWallet(state);
    viewEl.innerHTML = screens.render[route.key](state, route);
    fillFields(state);
  }

  function navigate(path) {
    // Keep the query (the Homeroom token, theme and preview parameters).
    history.pushState(null, '', path + window.location.search);
    walletMenuOpen = false;
    render();
    window.scrollTo(0, 0);
    viewEl.focus({ preventScroll: true });
  }

  document.addEventListener('click', function (e) {
    var link = e.target.closest('a[data-nav]');
    if (link && !e.metaKey && !e.ctrlKey && !e.shiftKey && e.button === 0) {
      e.preventDefault();
      navigate(link.getAttribute('href'));
      return;
    }
    var action = e.target.closest('[data-action]');
    if (action) {
      var name = action.dataset.action;
      if (name === 'connect') wallet.connect(false);
      else if (name === 'disconnect') { walletMenuOpen = false; wallet.disconnect(); }
      else if (name === 'wallet-menu') { walletMenuOpen = !walletMenuOpen; render(); }
      else if (name === 'genesis-mint') genesis.mint();
      else if (name === 'awaken') genesis.awaken();
      else if (name === 'genesis-retry') genesis.load();
      return;
    }
    // A tap anywhere else closes the wallet menu or dismisses its message.
    if (!e.target.closest('#wallet')) {
      if (walletMenuOpen) { walletMenuOpen = false; render(); }
      else if (store.get().wallet.error) store.update('wallet', { error: null });
    }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && walletMenuOpen) { walletMenuOpen = false; render(); }
  });
  window.addEventListener('popstate', render);
  store.subscribe(render);

  render();
  genesis.load();
  wallet.restore();
})();
