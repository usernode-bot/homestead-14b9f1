// HOMESTEAD screens. Each screen is a function (state) -> HTML string for
// static copy; anything a person typed or owns (username, wallet) is set
// afterwards as text in app.js, never written into this HTML.
(function () {
  var config = window.HOMESTEAD_CONFIG;
  var creatureConfig = window.HOMESTEAD_CREATURE_CONFIG;
  var cards = window.HOMESTEAD_CREATURE_CARD;
  var homesteadView = window.HOMESTEAD_HOMESTEAD_VIEW;
  var steadConfig = window.HOMESTEAD_STEAD_CONFIG;

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
  };
  function icon(name, cls) {
    return '<svg class="' + (cls || 'h-5 w-5') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICONS[name] + '</svg>';
  }

  // The six screens, in navigation order.
  var ROUTES = [
    { path: '/', key: 'home', label: 'HOME' },
    { path: '/creature', key: 'creature', label: 'MY CREATURE' },
    { path: '/homestead', key: 'homestead', label: 'HOMESTEAD' },
    { path: '/marketplace', key: 'marketplace', label: 'MARKETPLACE' },
    { path: '/collection', key: 'collection', label: 'COLLECTION' },
    { path: '/profile', key: 'profile', label: 'PROFILE' },
  ];

  function pageHeading(route) {
    return '<h1 class="mb-6 flex items-center gap-3 text-title font-black tracking-tight">' +
      '<span class="flex h-10 w-10 items-center justify-center rounded-xl bg-raised text-punk">' + icon(route.key) + '</span>' +
      route.label + '</h1>';
  }

  // The empty state every unbuilt screen shows: a framed, dashed placeholder.
  function placeholder(route, title, detail) {
    return pageHeading(route) +
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

  function isSoldOut(state) {
    return state.supply.status === 'ready' && state.supply.created >= config.MAX_CREATURE_SUPPLY;
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

  // Genesis on Home: exactly one of mint, sold out, the Seed or the Creature.
  function genesisPanel(state) {
    var max = config.MAX_CREATURE_SUPPLY;
    var w = state.wallet;
    var g = state.genesis;
    var connected = w.status === 'connected';
    var soldOut = isSoldOut(state);
    var errorLine = g.error ? '<p role="alert" class="mt-3 text-small text-danger" data-field="genesis-error"></p>' : '';
    var soldOutBlock =
      '<div class="mt-4" data-genesis-sold-out>' +
        '<p class="text-heading font-black text-punk">GENESIS SOLD OUT</p>' +
        '<p class="text-body text-muted">All ' + fmt(max) + ' Creatures have been awakened.</p>' +
      '</div>';

    if (connected && (g.status === 'idle' || g.status === 'loading')) {
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

    if (connected && g.genesisUsed) {
      var c = state.creature;
      var seed = state.seed;
      if (c && c.owner === g.walletId) {
        return '<section class="collectible" id="genesis" data-genesis="creature">' +
          '<span class="sticker absolute -top-3 left-4">GENESIS</span>' +
          '<div class="flex flex-col items-center gap-6 pt-2 sm:flex-row">' +
            cards.art(c, 'h-32 w-32') +
            '<div class="min-w-0 text-center sm:text-left">' +
              '<h2 class="text-small font-bold text-muted">YOUR CREATURE</h2>' +
              '<p class="break-words text-title font-black tracking-tight" data-creature-id="' + c.creatureId + '">' + cards.nameSpan(c) + '</p>' +
              '<p class="mt-1 flex flex-wrap items-center justify-center gap-2 text-body sm:justify-start"><span class="font-bold">' + speciesLabel(c) + '</span>' + cards.rarityBadge(c) + '</p>' +
              (g.notice === 'creature-awakened' ? '<p class="mt-2 text-body font-bold text-accent" role="status">Your Seed awakened.</p>' : '') +
              '<p class="mt-2 text-body text-muted">' + cards.formatId(c.creatureId) + ', awakened from Seed #' + c.seedId + ' on ' + fmtDate(c.createdAt) + '.</p>' +
              '<a href="/creature" data-nav class="btn-secondary mt-4">View My Creature</a>' +
            '</div>' +
          '</div>' +
        '</section>';
      }
      if (!c && seed && seed.owner === g.walletId && seed.creatureId == null) {
        var busy = g.pending === 'awaken';
        return '<section class="collectible" id="genesis" data-genesis="seed">' +
          '<span class="sticker absolute -top-3 left-4">GENESIS</span>' +
          '<div class="flex flex-col items-center gap-6 pt-2 sm:flex-row">' +
            SEED_ART +
            '<div class="text-center sm:text-left">' +
              '<h2 class="text-title font-black tracking-tight">YOUR SEED</h2>' +
              '<p class="mt-1 inline-block rounded-full bg-raised px-3 py-1 text-small font-black tracking-wide text-punk" data-seed-status>' + seed.status + '</p>' +
              (g.notice === 'seed-created' ? '<p class="mt-2 text-body font-bold text-accent" role="status">Genesis created. Seed #' + seed.seedId + ' is yours.</p>' : '') +
              '<p class="mt-2 text-body text-muted">Something is waiting inside.</p>' +
              (soldOut ? soldOutBlock : '') +
              '<button type="button" class="btn-primary mt-4" data-action="awaken"' + (busy || soldOut ? ' disabled' : '') + '>' +
                (busy ? 'AWAKENING…' : 'AWAKEN') +
              '</button>' +
              errorLine +
            '</div>' +
          '</div>' +
        '</section>';
      }
      // Used, but this wallet no longer holds what it made (a later transfer).
      return '<section class="collectible" id="genesis" data-genesis="used">' +
        '<h2 class="text-title font-black tracking-tight">GENESIS USED</h2>' +
        '<p class="mt-1 text-body text-muted">This wallet has already used its one Genesis.</p>' +
      '</section>';
    }

    // Mint: available, or disabled with the reason shown.
    var mintBusy = g.pending === 'mint';
    var disabled = !connected || soldOut || mintBusy || state.supply.status !== 'ready';
    var reason = '';
    if (!connected) {
      reason = '<p class="mt-3 text-small text-muted">Connect your wallet to use Genesis.</p>' +
        (w.status === 'connecting' ? '' : '<button type="button" class="btn-secondary mt-3" data-action="connect">CONNECT WALLET</button>');
    } else if (!soldOut) {
      reason = '<p class="mt-3 text-small text-muted">Each wallet gets one Genesis, ever. It creates a Seed you can awaken into a Creature.</p>';
    }
    return '<section class="collectible" id="genesis" data-genesis="' + (soldOut ? 'sold-out' : 'mint') + '">' +
      (soldOut
        ? '<h2 class="text-title font-black tracking-tight">GENESIS SOLD OUT</h2>' +
          '<p class="mt-1 text-body text-muted">All ' + fmt(max) + ' Creatures have been awakened.</p>' +
          '<p class="mt-1 text-heading font-black tabular-nums text-punk">' + fmt(state.supply.created) + ' / ' + fmt(max) + '</p>'
        : '<h2 class="text-title font-black tracking-tight">GENESIS</h2>' +
          '<p class="mt-1 text-body text-muted">Create your first Seed.</p>') +
      '<button type="button" class="btn-primary mt-4" data-action="genesis-mint"' + (disabled ? ' disabled' : '') + '>' +
        (mintBusy ? 'CREATING SEED…' : 'GENESIS MINT') +
      '</button>' +
      reason +
      errorLine +
    '</section>';
  }

  function supplyCard(state) {
    var max = config.MAX_CREATURE_SUPPLY;
    var s = state.supply;
    var body;
    if (s.status === 'loading') {
      body = '<div class="mt-4 flex justify-center" aria-busy="true"><span class="sr-only">Loading supply</span><div class="skeleton h-12 w-56"></div></div>' +
        '<div class="skeleton mt-4 h-2"></div>' +
        '<div class="skeleton mx-auto mt-3 h-5 w-40"></div>';
    } else if (s.status === 'error') {
      body = '<div class="state-error pb-0">' +
        '<p class="text-body">Couldn\'t load the Creature supply.</p>' +
        '<button type="button" class="btn-secondary" data-action="genesis-retry">Retry</button>' +
      '</div>';
    } else {
      var created = s.created;
      var pct = Math.min(100, (created / max) * 100);
      body = '<p class="mt-4 text-display tabular-nums" id="supply-count" data-created="' + created + '">' + fmt(created) + ' / ' + fmt(max) + '</p>' +
        '<div class="mt-4 h-2 overflow-hidden rounded-full bg-raised" role="progressbar" aria-label="Creatures awakened" aria-valuemin="0" aria-valuemax="' + max + '" aria-valuenow="' + created + '">' +
          '<div class="h-full rounded-full bg-accent" style="width:' + pct + '%"></div>' +
        '</div>' +
        '<p class="mt-3 text-small text-muted">' +
          (created >= max ? 'GENESIS SOLD OUT. Every Creature has been awakened.'
            : created === 0 ? 'No Creatures have been awakened yet.'
            : 'Creatures awakened') +
        '</p>';
    }
    return '<div class="collectible text-center" id="supply">' +
      '<span class="sticker absolute -top-3 left-4">' + fmt(max) + ' CREATURES EVER</span>' +
      body +
    '</div>';
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
    var max = config.MAX_CREATURE_SUPPLY;
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
        // The supply card: the one number that matters in this game.
        '<div class="md:col-span-2">' + supplyCard(state) + '</div>' +
      '</section>' +
      '<div class="mt-4 max-w-2xl">' + genesisPanel(state) + '</div>' +
      '<div class="mt-10 max-w-2xl">' + checkInCard(state) + '</div>' +
      '<section class="mt-10 max-w-2xl">' +
        '<h2 class="section-label">About the game</h2>' +
        '<ul class="list">' +
          '<li class="list-row items-start">' + icon('creature', 'mt-0.5 h-5 w-5 shrink-0 text-punk') + '<p class="text-body">HOMESTEAD is a collectible game about cute, strange punk monsters.</p></li>' +
          '<li class="list-row items-start">' + icon('collection', 'mt-0.5 h-5 w-5 shrink-0 text-punk') + '<p class="text-body">There will only ever be ' + fmt(max) + ' Creatures.</p></li>' +
          '<li class="list-row items-start">' + icon('profile', 'mt-0.5 h-5 w-5 shrink-0 text-punk') + '<p class="text-body">Each wallet gets ' + (config.GENESIS_PER_WALLET === 1 ? 'one' : fmt(config.GENESIS_PER_WALLET)) + ' Genesis, ever: a Seed to awaken into a Creature.</p></li>' +
          '<li class="list-row items-start">' + icon('homestead', 'mt-0.5 h-5 w-5 shrink-0 text-punk') + '<p class="text-body">Your Creature will eventually be able to live, work, train, compete, and trade.</p></li>' +
        '</ul>' +
        '<p class="mt-3 px-1 text-small text-muted">Genesis is live. Everything else arrives in future updates.</p>' +
      '</section>';
  }

  // The profile options for the Creature open in viewedCreature: its owner
  // can rename, feed and train it.
  function profileOpts(v, mine) {
    return {
      canRename: mine, canAct: mine, controls: v.controls,
      pending: v.pending, notice: v.notice, error: v.error,
    };
  }

  function creature(state, route) {
    var c = state.creature;
    if (ownsGenesisCreature(state)) {
      // app.js loads it into viewedCreature for its Feed and Train controls;
      // until then it shows with those controls waiting.
      var v = state.viewedCreature;
      if (v.id === c.creatureId && v.status === 'ready' && v.creature) {
        return pageHeading(route) + cards.profile(v.creature, profileOpts(v, v.ownedByYou));
      }
      return pageHeading(route) + cards.profile(c, { canRename: true, canAct: true, controls: null });
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
      return pageHeading(route) +
        '<section class="collectible state-empty max-w-3xl py-14" data-empty="homestead">' +
          '<span class="mb-2 flex h-16 w-16 items-center justify-center rounded-2xl border-2 border-dashed border-line text-muted">' + icon('homestead', 'h-8 w-8') + '</span>' +
          '<p class="text-heading font-black">CONNECT HOMEROOM WALLET</p>' +
          '<p class="max-w-sm text-body text-muted">Your Homestead belongs to the wallet linked to your Homeroom account.</p>' +
          '<button type="button" class="btn-secondary mt-2" data-action="connect">CONNECT WALLET</button>' +
        '</section>';
    }
    var h = state.homestead;
    if (w.status === 'connected' && (state.genesis.status === 'error' || h.status === 'error')) {
      return pageHeading(route) +
        '<section class="collectible state-error max-w-3xl">' +
          '<p class="text-heading">Couldn\'t load your Homestead.</p>' +
          '<p class="max-w-sm text-body text-muted">Your Creature is safe. Check your connection and try again.</p>' +
          '<button type="button" class="btn-secondary mt-2" data-action="homestead-retry">Retry</button>' +
        '</section>';
    }
    if (w.status !== 'connected' || h.status !== 'ready') return pageHeading(route) + homesteadLoading();
    if (!h.homestead || !h.creature) {
      return pageHeading(route) +
        '<section class="collectible state-empty max-w-3xl py-14" data-empty="homestead-waiting">' +
          '<span class="mb-2 flex h-16 w-16 items-center justify-center rounded-2xl border-2 border-dashed border-line text-muted">' + icon('homestead', 'h-8 w-8') + '</span>' +
          '<p class="text-heading font-black">YOUR HOMESTEAD IS WAITING</p>' +
          '<p class="max-w-sm text-body text-muted">Awaken your Genesis Creature to move in.</p>' +
          '<a href="/" data-nav class="btn-secondary mt-2">Go to Genesis</a>' +
        '</section>';
    }
    return pageHeading(route) + homesteadView.page(h.homestead, h.creature, {
      work: h.work, canAct: true, pending: h.pending, error: h.error, scope: 'own', clockOffset: h.clockOffset,
    });
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
  function marketplace(state, route) {
    return placeholder(route, 'No Creatures listed yet.', 'Trading opens in a future update.');
  }
  // A Creature by its id, /creature/<id>: anyone can look; only its owner
  // can rename it.
  function creatureById(state, route) {
    var v = state.viewedCreature;
    var mine = v.status === 'ready' && v.ownedByYou && state.wallet.status === 'connected';
    var heading = pageHeading(mine ? route : { key: 'creature', label: 'CREATURE' });
    if (v.status === 'ready' && v.creature) return heading + cards.profile(v.creature, profileOpts(v, mine));
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

  function collection(state, route) {
    if (state.wallet.status !== 'connected') {
      return placeholder(route, 'Your collection is empty.', 'Connect your wallet to see the Creatures you own.');
    }
    var col = state.collection;
    if (col.status === 'error') {
      return pageHeading(route) +
        '<section class="collectible state-error">' +
          '<p class="text-heading">Couldn\'t load your collection.</p>' +
          '<p class="max-w-sm text-body text-muted">Your Creatures are safe. Check your connection and try again.</p>' +
          '<button type="button" class="btn-secondary mt-2" data-action="collection-retry">Retry</button>' +
        '</section>';
    }
    if (col.status !== 'ready') {
      return pageHeading(route) +
        '<div class="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4" aria-busy="true"><span class="sr-only">Loading your collection</span>' +
          '<div class="collectible"><div class="skeleton aspect-square w-full rounded-2xl"></div><div class="skeleton mt-3 h-6 w-24"></div><div class="skeleton mt-2 h-5 w-16"></div></div>' +
          '<div class="collectible"><div class="skeleton aspect-square w-full rounded-2xl"></div><div class="skeleton mt-3 h-6 w-24"></div><div class="skeleton mt-2 h-5 w-16"></div></div>' +
        '</div>';
    }
    if (!col.creatures.length) {
      return pageHeading(route) +
        '<section class="collectible state-empty py-14" data-empty="collection">' +
          '<span class="mb-2 flex h-16 w-16 items-center justify-center rounded-2xl border-2 border-dashed border-line text-muted">' + icon('collection', 'h-8 w-8') + '</span>' +
          '<p class="text-heading">Your collection is empty.</p>' +
          '<p class="max-w-sm text-body text-muted">Use Genesis on Home to awaken your first Creature.</p>' +
          '<a href="/" data-nav class="btn-secondary mt-2">Go to Genesis</a>' +
        '</section>';
    }
    return pageHeading(route) +
      '<p class="section-label">' + col.creatures.length + (col.creatures.length === 1 ? ' Creature' : ' Creatures') + '</p>' +
      '<div class="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4" data-collection>' +
        col.creatures.map(function (c) { return cards.card(c, { href: '/creature/' + Number(c.creatureId) }); }).join('') +
      '</div>';
  }

  function profileGenesis(state) {
    var g = state.genesis;
    if (g.status === 'error') return "Couldn't load";
    if (g.status !== 'ready') return 'Loading…';
    return g.genesisUsed ? 'Used' : 'Available';
  }

  function profile(state, route) {
    var w = state.wallet;
    if (w.status !== 'connected') {
      return pageHeading(route) +
        '<section class="collectible state-empty py-14" data-empty="profile">' +
          '<span class="mb-2 flex h-16 w-16 items-center justify-center rounded-2xl border-2 border-dashed border-line text-muted">' + icon('profile', 'h-8 w-8') + '</span>' +
          '<p class="text-heading">Connect your wallet to view your profile.</p>' +
          '<p class="max-w-sm text-body text-muted">Use CONNECT WALLET at the top of the screen. It uses the wallet linked to your Homeroom account.</p>' +
        '</section>';
    }
    return pageHeading(route) +
      '<section class="max-w-xl">' +
        '<ul class="list">' +
          '<li class="list-row justify-between"><span class="text-muted">Player</span><span class="font-bold" data-field="username"></span></li>' +
          '<li class="list-row justify-between gap-4"><span class="text-muted">Wallet</span><span class="min-w-0 break-all text-right font-mono text-small" data-field="address"></span></li>' +
          '<li class="list-row justify-between"><span class="text-muted">Genesis</span><span>' + profileGenesis(state) + '</span></li>' +
          '<li class="list-row justify-between"><span class="text-muted">STEAD Balance</span><span>' + profileStead(state) + '</span></li>' +
          '<li class="list-row justify-between"><span class="text-muted">Creature</span><span>' +
            (ownsGenesisCreature(state)
              ? '<a href="/creature" data-nav class="font-bold underline decoration-punk underline-offset-4">' + cards.nameSpan(state.creature) + '</a> <span class="font-mono text-small text-muted">' + cards.formatId(state.creature.creatureId) + '</span>'
              : 'No Creature yet.') +
          '</span></li>' +
        '</ul>' +
        steadHistory(state) +
        '<button type="button" class="btn-secondary mt-6" data-action="disconnect">Disconnect wallet</button>' +
      '</section>';
  }

  window.HOMESTEAD_SCREENS = {
    ROUTES: ROUTES,
    icon: icon,
    render: { home: home, creature: creature, creatureById: creatureById, homestead: homestead, homesteadById: homesteadById, marketplace: marketplace, collection: collection, profile: profile },
  };
})();
