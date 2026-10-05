// HOMESTEAD screens. Each screen is a function (state) -> HTML string for
// static copy; anything a person typed or owns (username, wallet) is set
// afterwards as text in app.js, never written into this HTML.
(function () {
  var config = window.HOMESTEAD_CONFIG;
  var creatureConfig = window.HOMESTEAD_CREATURE_CONFIG;
  var cards = window.HOMESTEAD_CREATURE_CARD;
  var homesteadView = window.HOMESTEAD_HOMESTEAD_VIEW;
  var steadConfig = window.HOMESTEAD_STEAD_CONFIG;
  var gearView = window.HOMESTEAD_GEAR_VIEW;
  var contestView = window.HOMESTEAD_CONTEST_VIEW;

  function fmt(n) { return Number(n).toLocaleString('en-US'); }

  // Simple line icons, one per screen, drawn in currentColor.
  var ICONS = {
    home: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
    creature: '<path d="M7 9l2-4 3 3 3-3 2 4"/><path d="M4 15a8 6 0 0 0 16 0c0-3.5-3.6-6-8-6s-8 2.5-8 6z"/><circle cx="12" cy="14" r="2"/>',
    homestead: '<path d="M4 20V9l8-5 8 5v11"/><path d="M9 20v-5a3 3 0 0 1 6 0v5"/><path d="M2 20h20"/>',
    marketplace: '<path d="M20 12l-8 8-9-9V3h8z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
    collection: '<rect x="3" y="5" width="12" height="16" rx="2"/><path d="M8 3h11a2 2 0 0 1 2 2v13"/>',
    profile: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    gear: '<path d="M8 7V5a4 4 0 0 1 8 0v2"/><rect x="4" y="7" width="16" height="14" rx="3"/><path d="M9 13h6"/>',
    contests: '<path d="M8 21h8M12 17v4"/><path d="M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M7 6H4a3 3 0 0 0 3 4M17 6h3a3 3 0 0 1-3 4"/>',
  };
  function icon(name, cls) {
    return '<svg class="' + (cls || 'h-5 w-5') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICONS[name] + '</svg>';
  }

  // The screens. PROFILE is reached from the header's player button instead
  // of a tab (header: true). The 'mine' group are the tabs of MY HOMESTEAD, in
  // tab order; title is the browser title when it differs from the label.
  var ROUTES = [
    { path: '/', key: 'home', label: 'HOME' },
    { path: '/creature', key: 'creature', label: 'CREATURE', title: 'MY CREATURE', group: 'mine' },
    { path: '/homestead', key: 'homestead', label: 'HOMESTEAD', group: 'mine' },
    { path: '/collection', key: 'collection', label: 'COLLECTION', group: 'mine' },
    { path: '/contests', key: 'contests', label: 'CONTESTS' },
    { path: '/marketplace', key: 'marketplace', label: 'MARKETPLACE' },
    { path: '/profile', key: 'profile', label: 'PROFILE', header: true },
  ];
  function routeByKey(key) { return ROUTES.find(function (r) { return r.key === key; }); }
  var MINE_TABS = ROUTES.filter(function (r) { return r.group === 'mine'; });

  // The top menu, in order. MY HOMESTEAD opens its first tab.
  var NAV = [
    routeByKey('home'),
    { path: MINE_TABS[0].path, key: 'mine', label: 'MY HOMESTEAD', icon: 'homestead' },
    routeByKey('contests'),
    routeByKey('marketplace'),
  ];

  function pageHeading(route) {
    return '<h1 class="mb-6 flex items-center gap-3 text-title font-black tracking-tight">' +
      '<span class="flex h-10 w-10 items-center justify-center rounded-xl bg-raised text-punk">' + icon(route.key) + '</span>' +
      route.label + '</h1>';
  }

  // MY HOMESTEAD's heading, with its CREATURE / HOMESTEAD / COLLECTION tabs;
  // activeKey is the tab showing.
  function myHomesteadHeading(activeKey) {
    return '<h1 class="mb-3 flex items-center gap-3 text-title font-black tracking-tight">' +
        '<span class="flex h-10 w-10 items-center justify-center rounded-xl bg-raised text-punk">' + icon('homestead') + '</span>' +
        'MY HOMESTEAD</h1>' +
      '<nav aria-label="My Homestead" class="-mx-1 mb-6 overflow-x-auto px-1 py-1">' +
        '<ul class="flex gap-1" data-mine-tabs>' +
          MINE_TABS.map(function (r) {
            return '<li><a href="' + r.path + '" data-nav class="nav-tab" data-mine-tab="' + r.key + '"' + (r.key === activeKey ? ' aria-current="page"' : '') + '>' + r.label + '</a></li>';
          }).join('') +
        '</ul>' +
      '</nav>';
  }
  // The heading a screen starts with: MY HOMESTEAD's tabs for its own tabs.
  function screenHeading(route) {
    return route.group === 'mine' ? myHomesteadHeading(route.key) : pageHeading(route);
  }

  // The empty state every unbuilt screen shows: a framed, dashed placeholder.
  function placeholder(route, title, detail) {
    return screenHeading(route) +
      '<section class="collectible state-empty py-14" data-empty="' + route.key + '">' +
        '<span class="mb-2 flex h-16 w-16 items-center justify-center rounded-2xl border-2 border-dashed border-line text-muted">' + icon(route.key, 'h-8 w-8') + '</span>' +
        '<p class="text-heading">' + title + '</p>' +
        '<p class="max-w-sm text-body text-muted">' + detail + '</p>' +
      '</section>';
  }

  function fmtDate(iso) {
    var d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function speciesLabel(c) {
    var sp = creatureConfig.byId(creatureConfig.SPECIES, c.species);
    return sp ? sp.label : 'Creature';
  }

  function ownsGenesisCreature(state) {
    return state.wallet.status === 'connected' && state.creature && state.creature.owner === state.genesis.walletId;
  }

  // The dormant Seed: a stitched-up pod with a lime mohawk of sprouts and a
  // crack glowing from inside. Nothing about the Creature shows through.
  var SEED_ART =
    '<svg class="h-40 w-32 shrink-0" viewBox="0 0 120 150" aria-hidden="true">' +
      '<path d="M40 40l6-22 7 15 7-25 7 25 7-15 6 22z" class="fill-accent"/>' +
      '<path d="M60 34c28 0 46 34 46 62 0 30-20 48-46 48S14 126 14 96c0-28 18-62 46-62z" class="fill-raised stroke-line" stroke-width="3"/>' +
      '<path d="M60 38c-9 26 9 56 0 102" fill="none" class="stroke-punk" stroke-width="3" stroke-linecap="round" stroke-dasharray="7 7"/>' +
      '<path d="M53 58l13 4M51 82l14 3M52 106l14 3" fill="none" class="stroke-punk" stroke-width="3" stroke-linecap="round"/>' +
      '<path d="M80 74l7 7-5 5 7 8" fill="none" class="stroke-accent" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>' +
      '<circle cx="34" cy="104" r="5" class="fill-ground stroke-punk" stroke-width="3"/>' +
    '</svg>';

  // ── Genesis and the Creature count ───────────────────────────────────
  var MAX_OWNED = config.MAX_OWNED_CREATURES;
  var GENESIS_COST = config.GENESIS_COST;
  function isFull(state) {
    return state.slots.status === 'ready' && state.slots.owned >= state.slots.max;
  }
  var FULL_TEXT = 'You own ' + fmt(MAX_OWNED) + ' Creatures, the most one wallet can hold. Genesis is unavailable.';

  // Genesis on Home: loading, the Seed waiting to be awakened, or GENESIS
  // (with its confirmation step). Every rule is checked again on the server.
  function genesisPanel(state) {
    var w = state.wallet;
    var g = state.genesis;
    var connected = w.status === 'connected';
    var errorLine = g.error ? '<p role="alert" class="mt-3 text-small text-danger" data-field="genesis-error"></p>' : '';

    if (connected && (g.status === 'idle' || g.status === 'loading') && !(g.status === 'loading' && state.slots.status === 'ready')) {
      return '<section class="collectible" id="genesis" aria-busy="true">' +
        '<span class="sr-only">Loading your Genesis</span>' +
        '<div class="skeleton h-7 w-40"></div>' +
        '<div class="skeleton mt-3 h-5 w-64 max-w-full"></div>' +
        '<div class="skeleton mt-5 h-11 w-44"></div>' +
      '</section>';
    }
    if (connected && g.status === 'error') {
      return '<section class="collectible state-error" id="genesis">' +
        '<p class="text-heading">Couldn\'t load your Genesis.</p>' +
        '<p class="max-w-sm text-body text-muted">Nothing has changed. Check your connection and try again.</p>' +
        '<button type="button" class="btn-secondary mt-2" data-action="genesis-retry">Retry</button>' +
      '</section>';
    }

    var seed = state.seed;
    if (connected && seed && seed.owner === g.walletId && seed.creatureId == null) {
      var busy = g.pending === 'awaken';
      return '<section class="collectible" id="genesis" data-genesis="seed">' +
        '<span class="sticker absolute -top-3 left-4">GENESIS</span>' +
        '<div class="flex flex-col items-center gap-6 pt-2 sm:flex-row">' +
          SEED_ART +
          '<div class="text-center sm:text-left">' +
            '<h2 class="text-title font-black tracking-tight">YOUR SEED</h2>' +
            '<p class="mt-1 inline-block rounded-full bg-raised px-3 py-1 text-small font-black tracking-wide text-punk" data-seed-status>' + seed.status + '</p>' +
            (g.notice === 'seed-created' ? '<p class="mt-2 text-body font-bold text-accent" role="status">Genesis created. Seed #' + Number(seed.seedId) + ' is yours.</p>' : '') +
            '<p class="mt-2 text-body text-muted">Something is waiting inside.</p>' +
            '<button type="button" class="btn-primary mt-4" data-action="awaken"' + (busy ? ' disabled' : '') + '>' +
              (busy ? 'AWAKENING…' : 'AWAKEN') +
            '</button>' +
            errorLine +
          '</div>' +
        '</div>' +
      '</section>';
    }

    // GENESIS: available, or disabled with the first reason that applies.
    var st = state.stead;
    var balanceKnown = connected && st.status === 'ready' && st.steadBalance != null;
    var full = connected && isFull(state);
    var poor = balanceKnown && st.steadBalance < GENESIS_COST;
    var mintBusy = g.pending === 'mint';
    var disabled = !connected || full || poor || mintBusy || g.status !== 'ready';
    var reason = '';
    if (!connected) {
      reason = '<p class="mt-3 text-small text-muted" data-genesis-blocked="connect">Connect your wallet to use Genesis.</p>' +
        (w.status === 'connecting' ? '' : '<button type="button" class="btn-secondary mt-3" data-action="connect">CONNECT WALLET</button>');
    } else if (full) {
      reason = '<p class="mt-3 text-small font-bold" data-genesis-blocked="full">Collection Full.</p>';
    } else if (poor) {
      reason = '<p class="mt-3 text-small text-muted" data-genesis-blocked="stead">Need ' + steadAmount(GENESIS_COST) + ' for Genesis. Daily Check-in on Home pays STEAD.</p>';
    }
    var awakened = '';
    if (connected && g.notice === 'creature-awakened') {
      awakened = '<p class="mb-4 text-body font-bold text-accent" role="status" data-genesis-awakened>Your Seed awakened.' +
        (g.awakenedId ? ' <a href="/creature/' + Number(g.awakenedId) + '" data-nav class="underline decoration-punk underline-offset-4">Meet ' + cards.nameSpan({ creatureId: g.awakenedId }) + '</a>' : '') +
        '</p>';
    }
    var action = g.confirming && !disabled
      ? '<div class="mt-4 rounded-xl border-2 border-line p-4" data-genesis-confirm>' +
          '<p class="text-body font-bold">Spend ' + steadAmount(GENESIS_COST) + ' to create a Seed?</p>' +
          '<div class="mt-3 flex flex-wrap gap-3">' +
            '<button type="button" class="btn-primary" data-action="genesis-confirm">CONFIRM</button>' +
            '<button type="button" class="btn-secondary" data-action="genesis-cancel">Cancel</button>' +
          '</div>' +
        '</div>'
      : '<button type="button" class="btn-primary mt-4" data-action="genesis-mint"' + (disabled ? ' disabled' : '') + '>' +
          (mintBusy ? 'CREATING SEED…' : 'GENESIS MINT') +
        '</button>';
    return '<section class="collectible" id="genesis" data-genesis="' + (full ? 'full' : 'mint') + '">' +
      awakened +
      '<h2 class="text-title font-black tracking-tight">GENESIS</h2>' +
      '<p class="mt-1 text-body text-muted">Create a new Seed. Cost: <span class="font-bold text-fg" data-genesis-cost="' + GENESIS_COST + '">' + steadAmount(GENESIS_COST) + '</span></p>' +
      (balanceKnown ? '<p class="mt-1 text-small text-muted">You have <span class="font-bold tabular-nums text-fg" data-genesis-stead>' + steadConfig.format(st.steadBalance) + '</span> STEAD</p>' : '') +
      action +
      reason +
      errorLine +
    '</section>';
  }

  // How many Creatures this wallet holds, out of MAX_OWNED_CREATURES: owned
  // now plus Seeds waiting to be awakened, as the server counted them.
  function creatureCountCard(state) {
    var connected = state.wallet.status === 'connected';
    var s = state.slots;
    var head = '<h2 class="text-small font-bold text-muted">CREATURES</h2>';
    var body;
    if (!connected) {
      body = '<p class="mt-2 text-display tabular-nums" id="creature-count" data-owned="">— / ' + fmt(MAX_OWNED) + '</p>' +
        '<p class="mt-3 text-small text-muted">Connect your wallet to see your Creatures.</p>';
    } else if (s.status === 'error') {
      body = '<div class="state-error pb-0">' +
        '<p class="text-body">Couldn\'t load your Creatures.</p>' +
        '<button type="button" class="btn-secondary" data-action="genesis-retry">Retry</button>' +
      '</div>';
    } else if (s.status !== 'ready') {
      body = '<div class="mt-3 flex justify-center" aria-busy="true"><span class="sr-only">Loading your Creatures</span><div class="skeleton h-12 w-40"></div></div>' +
        '<div class="skeleton mt-4 h-2"></div>';
    } else {
      var full = s.owned >= s.max;
      var pct = Math.min(100, (s.owned / s.max) * 100);
      body = '<p class="mt-2 text-display tabular-nums" id="creature-count" data-owned="' + Number(s.owned) + '">' + fmt(s.owned) + ' / ' + fmt(s.max) + '</p>' +
        '<div class="mt-4 h-2 overflow-hidden rounded-full bg-raised" role="progressbar" aria-label="Creatures in your collection" aria-valuemin="0" aria-valuemax="' + Number(s.max) + '" aria-valuenow="' + Number(Math.min(s.owned, s.max)) + '">' +
          '<div class="h-full rounded-full bg-accent" style="width:' + pct + '%"></div>' +
        '</div>' +
        (s.dormantSeeds ? '<p class="mt-3 text-small text-muted" data-dormant-seeds="' + Number(s.dormantSeeds) + '">Includes ' + fmt(s.dormantSeeds) + ' dormant Seed' + (s.dormantSeeds === 1 ? '' : 's') + '</p>' : '') +
        (full ? '<p class="mt-3 text-small text-muted" data-collection-full>' + FULL_TEXT + '</p>' : '');
      if (full) head = '<span class="sticker absolute -top-3 left-4">Collection Full</span>' + head;
    }
    return '<div class="collectible text-center" id="creature-slots">' + head + body + '</div>';
  }

  // The Geneses this wallet has used, newest first (PROFILE).
  function genesisHistory(state) {
    var g = state.genesis;
    var heading = '<h2 class="section-label mt-8">Genesis history</h2>';
    if (g.status === 'error') {
      return heading + '<div class="list"><div class="state-error">' +
        '<p class="text-body">Couldn\'t load your Genesis history.</p>' +
        '<button type="button" class="btn-secondary" data-action="genesis-retry">Retry</button>' +
      '</div></div>';
    }
    if (g.status !== 'ready') {
      return heading + '<ul class="list" aria-busy="true"><li class="list-row"><span class="sr-only">Loading Genesis history</span><div class="skeleton h-5 w-full"></div></li></ul>';
    }
    if (!g.history.length) {
      return heading + '<div class="list"><div class="state-empty" data-empty="genesis-history">' +
        '<p class="text-heading">No Genesis yet.</p>' +
        '<p class="max-w-sm text-body text-muted">Genesis on Home creates a Seed you can awaken into a Creature.</p>' +
      '</div></div>';
    }
    return heading + '<ul class="list" data-genesis-history>' + g.history.map(function (h) {
      return '<li class="list-row justify-between gap-4" data-genesis-seed="' + Number(h.seedId) + '">' +
        '<span class="min-w-0"><span class="block font-bold">Seed #' + Number(h.seedId) + '</span>' +
          '<span class="block text-small text-muted">' + fmtDate(h.createdAt) + ' · ' + (Number(h.cost) > 0 ? steadAmount(h.cost) : 'Free') + '</span></span>' +
        (h.creatureId
          ? '<a href="/creature/' + Number(h.creatureId) + '" data-nav class="shrink-0 text-right font-bold underline decoration-punk underline-offset-4">' + cards.nameSpan({ creatureId: h.creatureId }) + ' <span class="font-mono text-small text-muted">' + cards.formatId(h.creatureId) + '</span></a>'
          : '<span class="shrink-0 text-small font-black text-punk">Dormant</span>') +
      '</li>';
    }).join('') + '</ul>';
  }

  // ── STEAD Points ──────────────────────────────────────────────────────
  // Every number below is what the server answered (lib/stead.js).
  function steadAmount(n) { return steadConfig.format(n) + ' ' + steadConfig.NAME; }

  // The 7 days of the cycle: claimed days ticked, today ringed, the rest
  // waiting. day is today's cycle day (claimed or not).
  function checkInStrip(c) {
    var days = [];
    for (var d = 1; d <= steadConfig.cycleLength(); d++) {
      var done = c && (d < c.day || (d === c.day && c.claimedToday));
      var today = c && d === c.day && !c.claimedToday;
      var cls = done ? 'border-accent bg-accent text-on-accent'
        : today ? 'border-accent text-fg'
        : 'border-line text-muted';
      days.push(
        '<li class="flex min-h-14 flex-col items-center justify-center rounded-lg border-2 ' + cls + '" data-check-in-day="' + d + '" data-state="' + (done ? 'claimed' : today ? 'today' : 'waiting') + '">' +
          (done ? icon('check', 'h-5 w-5') + '<span class="sr-only">Day ' + d + ' claimed</span>'
            : '<span class="text-body font-black tabular-nums"><span class="sr-only">Day </span>' + d + '</span>') +
          '<span class="text-small font-bold tabular-nums' + (done ? '' : ' text-muted') + '" aria-hidden="true">' + steadConfig.format(steadConfig.rewardFor(d)) + '</span>' +
        '</li>'
      );
    }
    return '<ol class="mt-4 grid grid-cols-7 gap-1.5" aria-label="Seven day streak">' + days.join('') + '</ol>';
  }

  function checkInCard(state) {
    var s = state.stead;
    var connected = state.wallet.status === 'connected';
    var head = '<span class="sticker absolute -top-3 left-4">7 DAY STREAK</span>' +
      '<h2 class="text-title font-black tracking-tight">DAILY CHECK-IN</h2>';
    if (!connected) {
      return '<section class="collectible" id="daily-check-in" data-check-in="connect">' + head +
        '<p class="mt-1 text-body text-muted">Earn STEAD every day you check in.</p>' +
        checkInStrip(null) +
        '<p class="mt-4 text-small text-muted">Connect your wallet to check in.</p>' +
      '</section>';
    }
    if (s.status === 'error') {
      return '<section class="collectible state-error" id="daily-check-in" data-check-in="error">' +
        '<p class="text-heading">Couldn\'t load your Daily Check-in.</p>' +
        '<p class="max-w-sm text-body text-muted">Your STEAD is safe. Check your connection and try again.</p>' +
        '<button type="button" class="btn-secondary mt-2" data-action="stead-retry">Retry</button>' +
      '</section>';
    }
    var c = s.checkIn;
    if (s.status !== 'ready' || !c) {
      return '<section class="collectible" id="daily-check-in" aria-busy="true">' +
        '<span class="sr-only">Loading your Daily Check-in</span>' +
        '<div class="skeleton h-7 w-48"></div>' +
        '<div class="skeleton mt-4 h-14"></div>' +
        '<div class="skeleton mt-4 h-11 w-36"></div>' +
      '</section>';
    }
    var busy = s.pending === 'claim';
    var today = '<p class="text-small font-bold text-muted">TODAY · DAY ' + c.day + '</p>' +
      '<p class="text-heading font-black tabular-nums" data-check-in-reward="' + c.reward + '">+' + steadAmount(c.reward) + '</p>';
    var action = c.claimedToday
      ? '<div data-check-in-claimed>' +
          '<p class="flex items-center gap-1.5 text-body font-black text-accent" role="status">' + icon('check', 'h-5 w-5') + 'CLAIMED TODAY</p>' +
          '<p class="text-body text-muted">Come back tomorrow.</p>' +
          '<p class="mt-2 text-small text-muted">Next reward: <span class="font-bold text-fg">Day ' + c.nextDay + ', ' + steadAmount(c.nextReward) + '</span></p>' +
        '</div>'
      : '<button type="button" class="btn-primary w-full sm:w-auto sm:min-w-36" data-action="stead-claim"' + (busy ? ' disabled' : '') + '>' +
          (busy ? 'CLAIMING…' : 'CLAIM') +
        '</button>';
    return '<section class="collectible" id="daily-check-in" data-check-in="' + (c.claimedToday ? 'claimed' : 'claimable') + '">' + head +
      checkInStrip(c) +
      '<div class="mt-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">' +
        '<div>' + today + '</div>' +
        action +
      '</div>' +
      (s.error ? '<p role="alert" class="mt-3 text-small text-danger" data-field="stead-error"></p>' : '') +
      '<p class="mt-4 text-small text-muted">Current streak: <span class="font-bold text-fg" data-check-in-streak="' + c.currentStreak + '">' + c.currentStreak + (c.currentStreak === 1 ? ' day' : ' days') + '</span>. A new day starts at midnight ' + c.timezone + '.</p>' +
    '</section>';
  }

  // "Oct 05": the game day a check-in was for, else the entry's date in the
  // game timezone.
  function steadEntryDate(e) {
    var tz = steadConfig.GAME_TIMEZONE;
    var d = e.metadata && /^\d{4}-\d{2}-\d{2}$/.test(e.metadata.claimDate || '')
      ? new Date(e.metadata.claimDate + 'T12:00:00Z') : new Date(e.timestamp);
    return isNaN(d) ? '' : d.toLocaleDateString('en-US', { month: 'short', day: '2-digit', timeZone: e.metadata && e.metadata.claimDate ? 'UTC' : tz });
  }

  function steadHistory(state) {
    var s = state.stead;
    var heading = '<h2 class="section-label mt-8">STEAD History</h2>';
    if (s.status === 'error') {
      return heading + '<div class="list"><div class="state-error">' +
        '<p class="text-body">Couldn\'t load your STEAD History.</p>' +
        '<button type="button" class="btn-secondary" data-action="stead-retry">Retry</button>' +
      '</div></div>';
    }
    if (s.status !== 'ready') {
      return heading + '<ul class="list" aria-busy="true"><li class="list-row"><span class="sr-only">Loading STEAD History</span><div class="skeleton h-5 w-full"></div></li><li class="list-row"><div class="skeleton h-5 w-full"></div></li></ul>';
    }
    if (!s.ledger.length) {
      return heading + '<div class="list"><div class="state-empty" data-empty="stead-history">' +
        '<p class="text-heading">No STEAD yet.</p>' +
        '<p class="max-w-sm text-body text-muted">Claim your Daily Check-in on Home to earn your first STEAD.</p>' +
        '<a href="/" data-nav class="btn-secondary mt-2">Go to Daily Check-in</a>' +
      '</div></div>';
    }
    return heading + '<ul class="list" data-stead-history>' + s.ledger.map(function (e) {
      return '<li class="list-row justify-between" data-stead-entry="' + Number(e.id) + '" data-type="' + e.type + '">' +
        '<span class="min-w-0"><span class="block font-bold">' + (steadConfig.type(e.type) || { label: 'STEAD' }).label + '</span>' +
          '<span class="block text-small text-muted">' + steadEntryDate(e) + ' · Balance ' + steadConfig.format(e.balanceAfter) + '</span></span>' +
        '<span class="shrink-0 font-black tabular-nums' + (e.amount > 0 ? ' text-accent' : '') + '">' + steadConfig.formatSigned(e.amount) + '</span>' +
      '</li>';
    }).join('') + '</ul>';
  }

  function profileStead(state) {
    var s = state.stead;
    if (s.status === 'error') return "Couldn't load";
    if (s.status !== 'ready' || s.steadBalance == null) return 'Loading…';
    return '<span class="font-black tabular-nums" data-profile-stead="' + s.steadBalance + '">' + steadAmount(s.steadBalance) + '</span>';
  }

  function home(state) {
    return '' +
      '<section class="grid items-center gap-8 py-4 md:grid-cols-5 md:py-10">' +
        '<div class="md:col-span-3">' +
          '<h1 class="text-display">HOMESTEAD</h1>' +
          '<p class="mt-4 text-title font-black leading-tight tracking-tight">' +
            '<span class="block">Awaken a Monster.</span>' +
            '<span class="block">Give it a Home.</span>' +
            '<span class="block text-accent">Make it Yours.</span>' +
          '</p>' +
        '</div>' +
        // This wallet's Creatures, out of the most one wallet can hold.
        '<div class="md:col-span-2">' + creatureCountCard(state) + '</div>' +
      '</section>' +
      '<div class="mt-4 max-w-2xl">' + genesisPanel(state) + '</div>' +
      '<div class="mt-10 max-w-2xl">' + checkInCard(state) + '</div>' +
      '<section class="mt-10 max-w-2xl">' +
        '<h2 class="section-label">About the game</h2>' +
        '<ul class="list">' +
          '<li class="list-row items-start">' + icon('creature', 'mt-0.5 h-5 w-5 shrink-0 text-punk') + '<p class="text-body">HOMESTEAD is a collectible game about cute, strange punk monsters.</p></li>' +
          '<li class="list-row items-start">' + icon('collection', 'mt-0.5 h-5 w-5 shrink-0 text-punk') + '<p class="text-body">Each wallet can own up to ' + fmt(MAX_OWNED) + ' Creatures.</p></li>' +
          '<li class="list-row items-start">' + icon('profile', 'mt-0.5 h-5 w-5 shrink-0 text-punk') + '<p class="text-body">Genesis costs ' + steadAmount(GENESIS_COST) + ' and creates a Seed you can awaken into a Creature.</p></li>' +
          '<li class="list-row items-start">' + icon('homestead', 'mt-0.5 h-5 w-5 shrink-0 text-punk') + '<p class="text-body">Your Creature will eventually be able to live, work, train, compete, and trade.</p></li>' +
        '</ul>' +
        '<p class="mt-3 px-1 text-small text-muted">Genesis is live. Everything else arrives in future updates.</p>' +
      '</section>';
  }

  // The profile options for the Creature open in viewedCreature: its owner
  // can rename, feed, train and change its Gear.
  function profileOpts(state, v, mine) {
    return {
      canRename: mine, canAct: mine, controls: v.controls,
      pending: v.pending, notice: v.notice, error: v.error, gear: state.gear,
      contest: v.contest, canChallengeOwner: !mine && state.wallet.status === 'connected' && !!v.creature && v.creature.owner !== state.wallet.address,
    };
  }

  function creature(state, route) {
    var c = state.creature;
    if (ownsGenesisCreature(state)) {
      // app.js loads it into viewedCreature for its Feed and Train controls;
      // until then it shows with those controls waiting.
      var v = state.viewedCreature;
      if (v.id === c.creatureId && v.status === 'ready' && v.creature) {
        return screenHeading(route) + cards.profile(v.creature, profileOpts(state, v, v.ownedByYou));
      }
      return screenHeading(route) + cards.profile(c, { canRename: true, canAct: true, controls: null, gear: state.gear });
    }
    var hasSeed = state.wallet.status === 'connected' && state.seed && !c;
    return placeholder(route, 'No Creature yet.', hasSeed
      ? 'Your Seed is still dormant. Awaken it on Home.'
      : 'Use Genesis on Home to create a Seed, then awaken it into your Creature.');
  }
  function homesteadLoading() {
    return '<div class="max-w-3xl" aria-busy="true"><span class="sr-only">Loading your Homestead</span>' +
      '<section class="collectible">' +
        '<div class="flex items-end justify-between gap-4 pb-4 pt-2"><div class="skeleton h-9 w-32"></div><div class="skeleton h-9 w-20"></div></div>' +
        '<div class="skeleton h-64 rounded-xl sm:h-80"></div>' +
        '<div class="skeleton mx-auto mt-4 h-9 w-40"></div>' +
      '</section>' +
      '<div class="mt-8 grid grid-cols-2 gap-3 lg:grid-cols-3"><div class="skeleton h-40 rounded-xl"></div><div class="skeleton h-40 rounded-xl"></div><div class="skeleton h-40 rounded-xl"></div></div>' +
    '</div>';
  }

  // This wallet's Homestead: connect first; then waiting for a Creature, or
  // the whole Homestead with its Creature at home.
  function homestead(state, route) {
    var w = state.wallet;
    if (w.status === 'disconnected') {
      return screenHeading(route) +
        '<section class="collectible state-empty max-w-3xl py-14" data-empty="homestead">' +
          '<span class="mb-2 flex h-16 w-16 items-center justify-center rounded-2xl border-2 border-dashed border-line text-muted">' + icon('homestead', 'h-8 w-8') + '</span>' +
          '<p class="text-heading font-black">CONNECT HOMEROOM WALLET</p>' +
          '<p class="max-w-sm text-body text-muted">Your Homestead belongs to the wallet linked to your Homeroom account.</p>' +
          '<button type="button" class="btn-secondary mt-2" data-action="connect">CONNECT WALLET</button>' +
        '</section>';
    }
    var h = state.homestead;
    if (w.status === 'connected' && (state.genesis.status === 'error' || h.status === 'error')) {
      return screenHeading(route) +
        '<section class="collectible state-error max-w-3xl">' +
          '<p class="text-heading">Couldn\'t load your Homestead.</p>' +
          '<p class="max-w-sm text-body text-muted">Your Creature is safe. Check your connection and try again.</p>' +
          '<button type="button" class="btn-secondary mt-2" data-action="homestead-retry">Retry</button>' +
        '</section>';
    }
    if (w.status !== 'connected' || h.status !== 'ready') return screenHeading(route) + homesteadLoading();
    if (!h.homestead || !h.creature) {
      return screenHeading(route) +
        '<section class="collectible state-empty max-w-3xl py-14" data-empty="homestead-waiting">' +
          '<span class="mb-2 flex h-16 w-16 items-center justify-center rounded-2xl border-2 border-dashed border-line text-muted">' + icon('homestead', 'h-8 w-8') + '</span>' +
          '<p class="text-heading font-black">YOUR HOMESTEAD IS WAITING</p>' +
          '<p class="max-w-sm text-body text-muted">Awaken your Genesis Creature to move in.</p>' +
          '<a href="/" data-nav class="btn-secondary mt-2">Go to Genesis</a>' +
        '</section>';
    }
    return screenHeading(route) + homesteadView.page(h.homestead, h.creature, {
      work: h.work, canAct: true, pending: h.pending, error: h.error, scope: 'own', clockOffset: h.clockOffset,
    }) +
      '<section class="mt-8 max-w-3xl">' +
        '<h2 class="section-label">Gear</h2>' +
        '<ul class="list"><li><a href="/gear" data-nav class="list-row justify-between hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus" data-gear-link>' +
          '<span class="flex items-center gap-3">' + icon('gear', 'h-5 w-5 shrink-0 text-punk') + '<span class="font-bold">Gear inventory</span></span>' +
          '<span class="text-small text-muted">Open</span>' +
        '</a></li></ul>' +
      '</section>';
  }

  // The Gear inventory, /gear: this wallet's Gear, equipped or not. EQUIP puts
  // Gear on the wallet's own Creature.
  function gear(state, route) {
    // Opened from the Homestead, so it sits under MY HOMESTEAD's HOMESTEAD tab.
    var heading = myHomesteadHeading('homestead') +
      '<h2 class="mb-4 flex items-center gap-2 text-heading font-black">' + icon('gear', 'h-5 w-5 text-punk') + route.label + '</h2>';
    if (state.wallet.status !== 'connected') {
      return heading +
        '<section class="collectible state-empty max-w-3xl py-14" data-empty="gear">' +
          '<span class="mb-2 flex h-16 w-16 items-center justify-center rounded-2xl border-2 border-dashed border-line text-muted">' + icon('gear', 'h-8 w-8') + '</span>' +
          '<p class="text-heading">Connect your wallet to see your Gear.</p>' +
          '<p class="max-w-sm text-body text-muted">Gear belongs to the wallet linked to your Homeroom account.</p>' +
          (state.wallet.status === 'connecting' ? '' : '<button type="button" class="btn-secondary mt-2" data-action="connect">CONNECT WALLET</button>') +
        '</section>';
    }
    return heading + gearView.inventory(state, ownsGenesisCreature(state) ? state.creature : null);
  }

  // A Homestead by its number, /homestead/<id>: anyone can look.
  function homesteadById(state, route) {
    var v = state.viewedHomestead;
    var heading = pageHeading(route.nav || route);
    // Read-only here, even for its owner: Work is sent from HOMESTEAD.
    if (v.status === 'ready' && v.homestead) {
      return heading + homesteadView.page(v.homestead, v.creature, { work: v.work, canAct: false, scope: 'viewed', clockOffset: v.clockOffset });
    }
    if (v.status === 'missing') {
      return heading +
        '<section class="collectible state-empty max-w-3xl py-14" data-empty="homestead-missing">' +
          '<p class="text-heading">No Homestead has that number.</p>' +
          '<p class="max-w-sm text-body text-muted">Its owner may not have moved in yet.</p>' +
          '<a href="/homestead" data-nav class="btn-secondary mt-2">Go to my Homestead</a>' +
        '</section>';
    }
    if (v.status === 'error') {
      return heading +
        '<section class="collectible state-error max-w-3xl">' +
          '<p class="text-heading">Couldn\'t load this Homestead.</p>' +
          '<p class="max-w-sm text-body text-muted">Check your connection and try again.</p>' +
          '<button type="button" class="btn-secondary mt-2" data-action="homestead-view-retry">Retry</button>' +
        '</section>';
    }
    return heading + homesteadLoading();
  }
  // Contests between two players, /contests, and one Contest, /contests/<id>.
  function contests(state, route) {
    return contestView.page(state, pageHeading(route));
  }
  function contestById(state, route) {
    return contestView.detail(state, pageHeading({ key: 'contests', label: 'CONTEST' }));
  }
  function marketplace(state, route) {
    return placeholder(route, 'No Creatures listed yet.', 'Trading opens in a future update.');
  }
  // A Creature by its id, /creature/<id>: anyone can look; only its owner
  // can rename it.
  function creatureById(state, route) {
    var v = state.viewedCreature;
    var mine = v.status === 'ready' && v.ownedByYou && state.wallet.status === 'connected';
    // The player's own Creatures sit under MY HOMESTEAD: the CREATURE tab for
    // the one it shows, COLLECTION for the rest.
    var heading = mine
      ? myHomesteadHeading(state.creature && state.creature.creatureId === v.creature.creatureId ? 'creature' : 'collection')
      : pageHeading({ key: 'creature', label: 'CREATURE' });
    if (v.status === 'ready' && v.creature) return heading + cards.profile(v.creature, profileOpts(state, v, mine));
    if (v.status === 'missing') {
      return heading +
        '<section class="collectible state-empty py-14" data-empty="creature-missing">' +
          '<p class="text-heading">No Creature has that ID.</p>' +
          '<p class="max-w-sm text-body text-muted">It may not have awakened yet.</p>' +
          '<a href="/collection" data-nav class="btn-secondary mt-2">Go to Collection</a>' +
        '</section>';
    }
    if (v.status === 'error') {
      return heading +
        '<section class="collectible state-error">' +
          '<p class="text-heading">Couldn\'t load this Creature.</p>' +
          '<p class="max-w-sm text-body text-muted">Check your connection and try again.</p>' +
          '<button type="button" class="btn-secondary mt-2" data-action="creature-retry">Retry</button>' +
        '</section>';
    }
    return heading +
      '<section class="collectible max-w-3xl" aria-busy="true"><span class="sr-only">Loading this Creature</span>' +
        '<div class="flex flex-col items-center gap-6 sm:flex-row">' +
          '<div class="skeleton h-48 w-48 rounded-2xl"></div>' +
          '<div class="w-full max-w-xs"><div class="skeleton h-5 w-24"></div><div class="skeleton mt-3 h-9 w-48"></div><div class="skeleton mt-3 h-6 w-40"></div></div>' +
        '</div>' +
      '</section>';
  }

  // "Creatures 3 / 10", from the server's count (Seeds waiting included).
  function collectionCount(state) {
    var s = state.slots;
    var owned = s.status === 'ready' ? s.owned : state.collection.creatures.length;
    var full = s.status === 'ready' && s.owned >= s.max;
    return '<p class="section-label" data-collection-count="' + Number(owned) + '">Creatures ' + fmt(owned) + ' / ' + fmt(MAX_OWNED) + '</p>' +
      (full ? '<p class="mb-4 flex flex-wrap items-center gap-3 px-1 text-small text-muted" data-collection-full><span class="sticker">Collection Full</span>' + FULL_TEXT + '</p>' : '');
  }

  function collection(state, route) {
    if (state.wallet.status !== 'connected') {
      return placeholder(route, 'Your collection is empty.', 'Connect your wallet to see the Creatures you own.');
    }
    var col = state.collection;
    if (col.status === 'error') {
      return screenHeading(route) +
        '<section class="collectible state-error">' +
          '<p class="text-heading">Couldn\'t load your collection.</p>' +
          '<p class="max-w-sm text-body text-muted">Your Creatures are safe. Check your connection and try again.</p>' +
          '<button type="button" class="btn-secondary mt-2" data-action="collection-retry">Retry</button>' +
        '</section>';
    }
    if (col.status !== 'ready') {
      return screenHeading(route) +
        '<div class="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4" aria-busy="true"><span class="sr-only">Loading your collection</span>' +
          '<div class="collectible"><div class="skeleton aspect-square w-full rounded-2xl"></div><div class="skeleton mt-3 h-6 w-24"></div><div class="skeleton mt-2 h-5 w-16"></div></div>' +
          '<div class="collectible"><div class="skeleton aspect-square w-full rounded-2xl"></div><div class="skeleton mt-3 h-6 w-24"></div><div class="skeleton mt-2 h-5 w-16"></div></div>' +
        '</div>';
    }
    if (!col.creatures.length) {
      return screenHeading(route) +
        '<section class="collectible state-empty py-14" data-empty="collection">' +
          '<span class="mb-2 flex h-16 w-16 items-center justify-center rounded-2xl border-2 border-dashed border-line text-muted">' + icon('collection', 'h-8 w-8') + '</span>' +
          '<p class="text-heading">Your collection is empty.</p>' +
          '<p class="max-w-sm text-body text-muted">Use Genesis on Home to awaken your first Creature.</p>' +
          '<a href="/" data-nav class="btn-secondary mt-2">Go to Genesis</a>' +
        '</section>';
    }
    return screenHeading(route) +
      collectionCount(state) +
      '<div class="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4" data-collection>' +
        col.creatures.map(function (c) { return cards.card(c, { href: '/creature/' + Number(c.creatureId) }); }).join('') +
      '</div>';
  }

  function profileCreatures(state) {
    var s = state.slots;
    if (s.status === 'error') return "Couldn't load";
    if (s.status !== 'ready') return 'Loading…';
    return '<span class="font-black tabular-nums" data-profile-creatures="' + Number(s.owned) + '">' + fmt(s.owned) + ' / ' + fmt(s.max) + '</span>' +
      (s.owned >= s.max ? ' <span class="text-small font-bold text-punk">Collection Full</span>' : '');
  }

  function profile(state, route) {
    var w = state.wallet;
    if (w.status !== 'connected') {
      return pageHeading(route) +
        '<section class="collectible state-empty py-14" data-empty="profile">' +
          '<span class="mb-2 flex h-16 w-16 items-center justify-center rounded-2xl border-2 border-dashed border-line text-muted">' + icon('profile', 'h-8 w-8') + '</span>' +
          '<p class="text-heading">Connect your wallet to view your profile.</p>' +
          '<p class="max-w-sm text-body text-muted">Use CONNECT at the top of the screen. It uses the wallet linked to your Homeroom account.</p>' +
        '</section>';
    }
    return pageHeading(route) +
      '<section class="max-w-xl">' +
        '<ul class="list">' +
          '<li class="list-row justify-between"><span class="text-muted">Player</span><span class="font-bold" data-field="username"></span></li>' +
          '<li class="list-row justify-between gap-4" data-profile-wallet><span class="text-muted">Wallet</span><span class="flex min-w-0 flex-wrap items-center justify-end gap-x-2 gap-y-1"><span class="flex shrink-0 items-center gap-1.5 text-small font-bold text-accent"><span class="h-2.5 w-2.5 rounded-full bg-accent" aria-hidden="true"></span>Connected</span><span class="min-w-0 break-all text-right font-mono text-small" data-field="address"></span></span></li>' +
          '<li class="list-row justify-between"><span class="text-muted">Creatures</span><span>' + profileCreatures(state) + '</span></li>' +
          '<li class="list-row justify-between"><span class="text-muted">STEAD Balance</span><span>' + profileStead(state) + '</span></li>' +
          '<li class="list-row justify-between"><span class="text-muted">Creature</span><span>' +
            (ownsGenesisCreature(state)
              ? '<a href="/creature" data-nav class="font-bold underline decoration-punk underline-offset-4">' + cards.nameSpan(state.creature) + '</a> <span class="font-mono text-small text-muted">' + cards.formatId(state.creature.creatureId) + '</span>'
              : 'No Creature yet.') +
          '</span></li>' +
        '</ul>' +
        steadHistory(state) +
        genesisHistory(state) +
        '<button type="button" class="btn-secondary mt-6" data-action="disconnect">Disconnect wallet</button>' +
      '</section>';
  }

  window.HOMESTEAD_SCREENS = {
    ROUTES: ROUTES,
    NAV: NAV,
    icon: icon,
    render: { home: home, gear: gear, contests: contests, contestById: contestById, creature: creature, creatureById: creatureById, homestead: homestead, homesteadById: homesteadById, marketplace: marketplace, collection: collection, profile: profile },
  };
})();
