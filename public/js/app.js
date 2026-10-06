// HOMESTEAD app shell: navigation, the wallet area, and screen rendering.
(function () {
  var store = window.HOMESTEAD_STORE;
  var wallet = window.HOMESTEAD_WALLET;
  var screens = window.HOMESTEAD_SCREENS;
  var genesis = window.HOMESTEAD_GENESIS;
  var creatures = window.HOMESTEAD_CREATURES;
  var homesteads = window.HOMESTEAD_HOMESTEADS;
  var stead = window.HOMESTEAD_STEAD;
  var gear = window.HOMESTEAD_GEAR;
  var contests = window.HOMESTEAD_CONTESTS;
  var market = window.HOMESTEAD_MARKETPLACE;
  var contestView = window.HOMESTEAD_CONTEST_VIEW;
  var navEl = document.getElementById('nav');
  var walletEl = document.getElementById('wallet');
  var viewEl = document.getElementById('view');

  // A Creature by id, /creature/<id>: the player's own sit under MY HOMESTEAD.
  var CREATURE_PATH = /^\/creature\/(\d{1,9})$/;
  // A Homestead by its number, /homestead/<id>, sits under MY HOMESTEAD.
  var HOMESTEAD_PATH = /^\/homestead\/(\d{1,9})$/;
  // A Contest by its number, /contests/<id>, belongs under CONTESTS.
  var CONTEST_PATH = /^\/contests\/(\d{1,9})$/;

  function currentRoute() {
    var path = window.location.pathname.replace(/\/+$/, '') || '/';
    var m = CREATURE_PATH.exec(path);
    if (m) {
      var mine = screens.ROUTES.find(function (r) { return r.key === 'creature'; });
      return { path: path, key: 'creatureById', label: 'CREATURE', nav: mine, creatureId: Number(m[1]) };
    }
    var hm = HOMESTEAD_PATH.exec(path);
    if (hm) {
      var home = screens.ROUTES.find(function (r) { return r.key === 'homestead'; });
      return { path: path, key: 'homesteadById', label: 'HOMESTEAD', nav: home, homesteadId: Number(hm[1]) };
    }
    var cm = CONTEST_PATH.exec(path);
    if (cm) {
      return { path: path, key: 'contestById', label: 'CONTEST', nav: screens.ROUTES.find(function (r) { return r.key === 'contests'; }), contestId: Number(cm[1]) };
    }
    // The Gear inventory is opened from the Homestead, and sits under it.
    if (path === '/gear') {
      return { path: path, key: 'gear', label: 'GEAR', nav: screens.ROUTES.find(function (r) { return r.key === 'homestead'; }) };
    }
    return screens.ROUTES.find(function (r) { return r.path === path; }) || screens.ROUTES[0];
  }

  // MY HOMESTEAD is current on its tabs, the Gear inventory, a Homestead by
  // number and the player's own Creatures.
  function inMyHomestead(route) {
    return route.group === 'mine' || route.key === 'gear' || route.key === 'homesteadById' ||
      (route.key === 'creatureById' && store.get().viewedCreature.ownedByYou);
  }

  function renderNav(route) {
    // Challenges waiting for this player show as a count on CONTESTS.
    var c = store.get().contests;
    var waiting = store.get().wallet.status === 'connected' && c.status === 'ready' ? c.incoming.length : 0;
    navEl.innerHTML = screens.NAV.map(function (r) {
      var current = r.key === 'mine' ? inMyHomestead(route) : r === route || (r === route.nav && route.contestId);
      return '<li><a href="' + r.path + '" data-nav class="nav-tab"' + (r.key === 'mine' ? ' data-nav-mine' : '') +
        (current ? ' aria-current="page"' : '') + '>' +
        screens.icon(r.icon || r.key, 'h-4 w-4') + r.label +
        (r.key === 'contests' && waiting
          ? '<span class="rounded-full bg-punk px-1.5 text-small font-black tabular-nums text-ground" data-contest-badge="' + waiting + '">' + waiting + '<span class="sr-only"> ' + (waiting === 1 ? 'challenge' : 'challenges') + ' waiting</span></span>'
          : '') +
        '</a></li>';
    }).join('');
    var active = navEl.querySelector('[aria-current="page"]');
    if (active && active.scrollIntoView) active.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  // The header's one button: the player's Homeroom username, opening their
  // profile (wallet and STEAD balance are shown there), or CONNECT.
  function renderWallet(state, route) {
    var w = state.wallet;
    if (w.status === 'connected') {
      walletEl.innerHTML =
        '<a href="/profile" data-nav class="nav-tab" data-player-button' + (route.key === 'profile' ? ' aria-current="page"' : '') + '>' +
          screens.icon('profile', 'h-4 w-4 shrink-0') +
          '<span class="max-w-40 truncate" data-field="player-name"></span>' +
        '</a>';
    } else {
      var busy = w.status === 'connecting';
      walletEl.innerHTML =
        '<button type="button" class="btn-primary whitespace-nowrap px-3 text-small sm:px-4 sm:text-body" data-action="connect"' + (busy ? ' disabled' : '') + '>' +
          (busy ? 'CONNECTING…' : 'CONNECT') +
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
      'player-name': w.username || 'PROFILE',
      error: w.error || '',
      'genesis-error': state.genesis.error || '',
      'work-error': state.homestead.error || '',
      'stead-error': state.stead.error || '',
      'care-error': state.viewedCreature.error || '',
      'gear-error': state.gear.error || '',
      'market-error': state.marketplace.error || '',
    };
    document.querySelectorAll('[data-field]').forEach(function (el) {
      el.textContent = values[el.dataset.field] || '';
    });
    // Creature names: typed by their owners, so always set as text.
    var nameById = {};
    (state.genesis.history || []).forEach(function (h) {
      if (h.creatureId) nameById[h.creatureId] = h.creatureName;
    });
    [state.creature, state.viewedCreature.creature, state.homestead.creature, state.viewedHomestead.creature].concat(state.collection.creatures).forEach(function (c) {
      if (c) nameById[c.creatureId] = c.name;
    });
    document.querySelectorAll('[data-creature-name]').forEach(function (el) {
      el.textContent = nameById[el.dataset.creatureName] || '';
    });
  }

  function creatureFor(id) {
    var state = store.get();
    if (state.viewedCreature.creature && state.viewedCreature.creature.creatureId === id) return state.viewedCreature.creature;
    return state.creature && state.creature.creatureId === id ? state.creature : null;
  }

  // On /creature, the id of this wallet's own Creature, or null.
  function ownCreatureId(route) {
    var state = store.get();
    if (route.key !== 'creature' || state.wallet.status !== 'connected' || !state.creature) return null;
    return state.creature.owner === state.genesis.walletId ? state.creature.creatureId : null;
  }

  // Coming back to a Creature's profile reloads it quietly, so hunger and the
  // Feed and Train controls are current (Work may have started meanwhile).
  function refreshCreature() {
    var route = currentRoute();
    var id = route.creatureId || ownCreatureId(route);
    if (id && store.get().viewedCreature.id === id && store.get().viewedCreature.status === 'ready') creatures.view(id, true, true);
  }

  function render() {
    var route = currentRoute();
    // Starts the load (which re-renders) only when this Creature isn't showing.
    if (route.creatureId) creatures.view(route.creatureId);
    // My Creature loads the same way, for its Feed and Train controls (once:
    // a failed load keeps showing the Creature without them).
    var ownId = ownCreatureId(route);
    if (ownId && store.get().viewedCreature.id !== ownId) creatures.view(ownId);
    if (route.homesteadId) homesteads.view(route.homesteadId);
    // Opens this wallet's Homestead (which re-renders) only when it isn't
    // already open for this wallet and Creature. Never during the render itself.
    if (route.key === 'homestead') homesteads.open();
    // The Gear inventory, for the Gear screen and the owner's Gear picker.
    if (route.key === 'gear' || route.creatureId || ownId) gear.ensure();
    if (route.key === 'contests') contests.ensure();
    if (route.key === 'marketplace') market.ensure();
    if (route.contestId) contests.view(route.contestId);
    var state = store.get();
    var title = route.title || route.label;
    document.title = title === 'HOME' || title === 'HOMESTEAD' ? 'HOMESTEAD' : title + ' · HOMESTEAD';
    renderNav(route);
    renderWallet(state, route);
    // A re-render (another player's move arriving) keeps the field being typed in.
    var focused = document.activeElement && viewEl.contains(document.activeElement) && document.activeElement.id ? document.activeElement : null;
    var focusId = focused ? focused.id : null;
    var selection = focused && typeof focused.selectionStart === 'number' ? [focused.selectionStart, focused.selectionEnd] : null;
    viewEl.innerHTML = screens.render[route.key](state, route);
    fillFields(state);
    contestView.fill(viewEl);
    if (focusId) {
      var again = document.getElementById(focusId);
      if (again) {
        again.focus({ preventScroll: true });
        if (selection && typeof again.setSelectionRange === 'function') {
          try { again.setSelectionRange(selection[0], selection[1]); } catch (_) {}
        }
      }
    }
  }

  // A Gear message or open slot picker belongs to the screen it was made on.
  function clearGearMessages() {
    var g = store.get().gear;
    if (g.notice || g.error || g.choosing) store.update('gear', { notice: null, error: null, choosing: null });
  }

  function navigate(path) {
    // Keep the query (the Homeroom token, theme and preview parameters).
    history.pushState(null, '', path + window.location.search);
    clearGearMessages();
    contests.clearMessages();
    market.clearMessages();
    refreshCreature();
    // The Marketplace shows this wallet's STEAD and food as they now are.
    if (path === '/marketplace' && store.get().marketplace.status === 'ready') market.load();
    if (CONTEST_PATH.test(path)) contests.view(Number(CONTEST_PATH.exec(path)[1]), true, true);
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
      else if (name === 'disconnect') wallet.disconnect();
      else if (name === 'genesis-mint') genesis.confirm();
      else if (name === 'genesis-confirm') genesis.mint();
      else if (name === 'genesis-cancel') genesis.cancelConfirm();
      else if (name === 'awaken') genesis.awaken();
      else if (name === 'genesis-retry') genesis.load();
      else if (name === 'stead-claim') stead.claim();
      else if (name === 'stead-retry') stead.load();
      else if (name === 'collection-retry') creatures.loadCollection();
      else if (name === 'creature-retry') creatures.view(currentRoute().creatureId, true);
      else if (name === 'homestead-retry') { if (store.get().genesis.status === 'error') genesis.load(); else homesteads.open(true); }
      else if (name === 'homestead-view-retry') homesteads.view(currentRoute().homesteadId, true);
      else if (name === 'work-start') homesteads.startWork(Number(action.dataset.creatureId), action.dataset.duration, action.dataset.building);
      else if (name === 'work-collect') homesteads.collect(Number(action.dataset.workId));
      else if (name === 'work-collect-pending') homesteads.collectPending();
      else if (name === 'feed') creatures.feed();
      else if (name === 'feed-food') creatures.feed(action.dataset.food);
      else if (name === 'buy-food') market.buy(action.dataset.food);
      else if (name === 'marketplace-retry') market.load();
      else if (name === 'train') creatures.train(action.dataset.stat);
      else if (name === 'gear-claim') gear.claim();
      else if (name === 'gear-retry') gear.load();
      else if (name === 'gear-choose') gear.choose(Number(action.dataset.creatureId), action.dataset.slot);
      else if (name === 'gear-choose-cancel') gear.cancelChoose();
      else if (name === 'gear-equip') gear.equip(Number(action.dataset.creatureId), Number(action.dataset.gearId), action.dataset.slot);
      else if (name === 'gear-unequip') gear.unequip(Number(action.dataset.creatureId), action.dataset.slot);
      else if (name === 'contests-retry') contests.load();
      else if (name === 'contest-view-retry') contests.view(currentRoute().contestId, true);
      else if (name === 'contest-accept-start') contests.startAccept(Number(action.dataset.challengeId));
      else if (name === 'contest-accept-cancel') contests.stopAccept();
      else if (name === 'contest-accept') contests.accept(Number(action.dataset.challengeId));
      else if (name === 'contest-decline') contests.decline(Number(action.dataset.challengeId));
      else if (name === 'contest-cancel') contests.cancel(Number(action.dataset.challengeId));
      else if (name === 'contest-prefill') {
        // From a Creature's profile: challenge with it, or challenge its owner.
        var shown = store.get().viewedCreature.creature;
        if (action.dataset.creatureId) contests.prefill({ creatureId: Number(action.dataset.creatureId) });
        else if (shown && Number(action.dataset.opponentOf) === shown.creatureId) contests.prefill({ opponent: shown.owner });
        navigate('/contests');
      }
      else if (name === 'rename') {
        var holder = action.closest('[data-creature-id]');
        creatures.openRename(holder && creatureFor(Number(holder.dataset.creatureId)));
      }
      return;
    }
    // A tap anywhere else dismisses the wallet's message.
    if (!e.target.closest('#wallet') && store.get().wallet.error) store.update('wallet', { error: null });
  });
  window.addEventListener('popstate', function () { clearGearMessages(); refreshCreature(); render(); });
  store.subscribe(render);
  window.HOMESTEAD_APP = { navigate: navigate };

  render();
  genesis.load();
  wallet.restore();
})();
