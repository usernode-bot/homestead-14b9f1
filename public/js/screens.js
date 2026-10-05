// HOMESTEAD screens. Each screen is a function (state) -> HTML string for
// static copy; anything a person typed or owns (username, wallet) is set
// afterwards as text in app.js, never written into this HTML.
(function () {
  var config = window.HOMESTEAD_CONFIG;

  function fmt(n) { return Number(n).toLocaleString('en-US'); }

  // Simple line icons, one per screen, drawn in currentColor.
  var ICONS = {
    home: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
    creature: '<path d="M7 9l2-4 3 3 3-3 2 4"/><path d="M4 15a8 6 0 0 0 16 0c0-3.5-3.6-6-8-6s-8 2.5-8 6z"/><circle cx="12" cy="14" r="2"/>',
    homestead: '<path d="M4 20V9l8-5 8 5v11"/><path d="M9 20v-5a3 3 0 0 1 6 0v5"/><path d="M2 20h20"/>',
    marketplace: '<path d="M20 12l-8 8-9-9V3h8z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
    collection: '<rect x="3" y="5" width="12" height="16" rx="2"/><path d="M8 3h11a2 2 0 0 1 2 2v13"/>',
    profile: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
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

  function home(state) {
    var max = config.MAX_CREATURE_SUPPLY;
    var created = state.supply.created;
    var pct = Math.min(100, (created / max) * 100);
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
        '<div class="md:col-span-2">' +
          '<div class="collectible text-center" id="supply">' +
            '<span class="sticker absolute -top-3 left-4">' + fmt(max) + ' CREATURES EVER</span>' +
            '<p class="mt-4 text-display tabular-nums" id="supply-count">' + fmt(created) + ' / ' + fmt(max) + '</p>' +
            '<div class="mt-4 h-2 overflow-hidden rounded-full bg-raised" role="progressbar" aria-label="Creatures created" aria-valuemin="0" aria-valuemax="' + max + '" aria-valuenow="' + created + '">' +
              '<div class="h-full rounded-full bg-accent" style="width:' + pct + '%"></div>' +
            '</div>' +
            '<p class="mt-3 text-small text-muted">No Creatures have been created yet.</p>' +
          '</div>' +
        '</div>' +
      '</section>' +
      '<section class="mt-6 max-w-2xl">' +
        '<h2 class="section-label">About the game</h2>' +
        '<ul class="list">' +
          '<li class="list-row items-start">' + icon('creature', 'mt-0.5 h-5 w-5 shrink-0 text-punk') + '<p class="text-body">HOMESTEAD is a collectible game about cute, strange punk monsters.</p></li>' +
          '<li class="list-row items-start">' + icon('collection', 'mt-0.5 h-5 w-5 shrink-0 text-punk') + '<p class="text-body">There will only ever be ' + fmt(max) + ' Creatures.</p></li>' +
          '<li class="list-row items-start">' + icon('profile', 'mt-0.5 h-5 w-5 shrink-0 text-punk') + '<p class="text-body">Each wallet will eventually have ' + (config.GENESIS_PER_WALLET === 1 ? 'one' : fmt(config.GENESIS_PER_WALLET)) + ' Genesis opportunity.</p></li>' +
          '<li class="list-row items-start">' + icon('homestead', 'mt-0.5 h-5 w-5 shrink-0 text-punk') + '<p class="text-body">Your Creature will eventually be able to live, work, train, compete, and trade.</p></li>' +
        '</ul>' +
        '<p class="mt-3 px-1 text-small text-muted">None of these systems are live yet. They arrive in future updates.</p>' +
      '</section>';
  }

  function creature(state, route) {
    return placeholder(route, 'No Creature yet.', "Creatures can't be awakened yet. When Genesis opens, yours will live here.");
  }
  function homestead(state, route) {
    return placeholder(route, 'Your Homestead is waiting for its Creature.', 'Once you have a Creature, this is where it will make its home.');
  }
  function marketplace(state, route) {
    return placeholder(route, 'No Creatures listed yet.', 'Trading opens in a future update.');
  }
  function collection(state, route) {
    return placeholder(route, 'Your collection is empty.', 'Creatures you own will be collected here.');
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
          '<li class="list-row justify-between"><span class="text-muted">Creature</span><span>No Creature yet.</span></li>' +
        '</ul>' +
        '<button type="button" class="btn-secondary mt-4" data-action="disconnect">Disconnect wallet</button>' +
      '</section>';
  }

  window.HOMESTEAD_SCREENS = {
    ROUTES: ROUTES,
    icon: icon,
    render: { home: home, creature: creature, homestead: homestead, marketplace: marketplace, collection: collection, profile: profile },
  };
})();
