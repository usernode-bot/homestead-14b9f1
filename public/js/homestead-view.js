// HOMESTEAD Homestead view: how a stored Homestead is shown.
//
// - page(h, c, opts): the whole Homestead: level and capacity, the scene with
//   its Creature in the middle, the buildings and storage.
//
// It only draws what the server stored. The Creature comes from the PR #3
// card and art (its name is a <span data-creature-name>, filled in as text by
// app.js), buildings and resources from homestead-config.js. Colours are the
// UI tokens only.
(function () {
  var hcfg = window.HOMESTEAD_HOMESTEAD_CONFIG;
  var ccfg = window.HOMESTEAD_CREATURE_CONFIG;
  var cards = window.HOMESTEAD_CREATURE_CARD;
  var artwork = window.HOMESTEAD_CREATURE_ART;

  function fmt(n) { return Number(n).toLocaleString('en-US'); }

  // Line icons on a 24 grid, drawn in currentColor (Lucide shapes, ISC).
  var ICONS = {
    barn: '<path d="M3 21V10l9-6 9 6v11"/><path d="M8 21v-7h8v7"/><path d="M8 14l8 7M16 14l-8 7"/>',
    mine: '<path d="M14.531 12.469 6.619 20.38a1 1 0 1 1-3-3l7.912-7.912"/><path d="M15.686 4.314A12.5 12.5 0 0 0 5.461 2.958 1 1 0 0 0 5.58 4.71a22 22 0 0 1 6.318 3.393"/><path d="M17.7 3.7a1 1 0 0 0-1.4 0l-4.6 4.6a1 1 0 0 0 0 1.4l2.6 2.6a1 1 0 0 0 1.4 0l4.6-4.6a1 1 0 0 0 0-1.4z"/><path d="M19.686 8.314a12.501 12.501 0 0 1 1.356 10.225 1 1 0 0 1-1.751-.119 22 22 0 0 0-3.393-6.319"/>',
    'lumber-camp': '<path d="M10 10v.2A3 3 0 0 1 8.9 16H5a3 3 0 0 1-1-5.8V10a3 3 0 0 1 6 0Z"/><path d="M7 16v6"/><path d="M13 19v3"/><path d="M12 19h8.3a1 1 0 0 0 .7-1.7L18 14h.3a1 1 0 0 0 .7-1.7L16 9h.2a1 1 0 0 0 .8-1.7L13 3l-1.4 1.5"/>',
    'fishing-hut': '<path d="M6.5 12c.94-3.46 4.94-6 8.5-6 3.56 0 6.06 2.54 7 6-.94 3.47-3.44 6-7 6s-7.56-2.53-8.5-6Z"/><path d="M18 12v.5"/><path d="M16 17.93a9.77 9.77 0 0 1 0-11.86"/><path d="M7 10.67C7 8 5.58 5.97 2.73 5.5c-1 1.5-1 5 .23 6.5-1.24 1.5-1.24 5-.23 6.5C5.58 18.03 7 16 7 13.33"/>',
    workshop: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
    'mystic-shrine': '<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/><path d="M20 3v4"/><path d="M22 5h-4"/>',
    lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
    storage: '<path d="M21 8 12 3 3 8v8l9 5 9-5z"/><path d="M3 8l9 5 9-5"/><path d="M12 13v8"/>',
  };
  function icon(name, cls) {
    return '<svg class="' + (cls || 'h-5 w-5') + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[name] || '') + '</svg>';
  }

  // A wallet address is a system value: only letters and digits are shown.
  function shortOwner(owner) {
    var a = String(owner || '').replace(/[^A-Za-z0-9]/g, '');
    return a.length > 14 ? a.slice(0, 7) + '…' + a.slice(-4) : a;
  }

  // The place itself: a crooked shack with a pink mascot sticker, a wonky
  // fence, a HOME sign, barrels and a crate, rocks, grass and odd plants, and
  // a worn path to the middle, where the Creature stands. Drawn on 600 x 300
  // and cropped from the sides on narrow screens, so the middle always shows.
  var SCENE =
    '<svg class="absolute inset-0 h-full w-full" viewBox="0 0 600 300" preserveAspectRatio="xMidYMax slice" aria-hidden="true" focusable="false">' +
      // Night sky specks and a moon.
      '<g class="fill-line"><circle cx="60" cy="40" r="2"/><circle cx="170" cy="70" r="1.5"/><circle cx="250" cy="30" r="2"/><circle cx="380" cy="55" r="1.5"/><circle cx="470" cy="28" r="2"/><circle cx="560" cy="80" r="1.5"/></g>' +
      '<path d="M512 62a20 20 0 1 1-18-28 15 15 0 0 0 18 28z" class="fill-raised"/>' +
      // Hills, then the yard.
      '<path d="M0 196Q90 150 190 182T390 172T600 186V300H0Z" class="fill-surface"/>' +
      '<path d="M0 226Q150 208 300 222T600 216V300H0Z" class="fill-raised"/>' +
      '<path d="M262 300Q284 262 288 236H312Q318 262 342 300Z" class="fill-line"/>' +
      // The fence, a little crooked, behind everything in the yard.
      '<g class="fill-surface stroke-line" stroke-width="3" stroke-linejoin="round">' +
        '<path d="M214 226l2-40 9 1-1 40z"/><path d="M262 224l1-38 9 0 0 38z"/><path d="M330 222l-1-40 9 0 1 40z"/><path d="M380 224l3-39 9 1-2 39z"/><path d="M432 226l-2-38 9-1 2 38z"/><path d="M548 228l1-40 9 1-1 40z"/>' +
      '</g>' +
      '<path d="M210 198L440 194M210 214L440 212M500 202L580 200" fill="none" class="stroke-line" stroke-width="5" stroke-linecap="round"/>' +
      // The shack: crooked walls, a sagging roof with a pink stitch, a door.
      '<path d="M100 232L104 146L214 152L210 234Z" class="fill-surface stroke-line" stroke-width="4" stroke-linejoin="round"/>' +
      '<path d="M104 172L213 177M103 196L212 200M102 218L211 222" fill="none" class="stroke-line" stroke-width="2"/>' +
      '<path d="M88 156Q150 92 158 96Q168 100 228 160Z" class="fill-line stroke-line" stroke-width="4" stroke-linejoin="round"/>' +
      '<path d="M104 146Q150 106 157 108Q166 112 212 152" fill="none" class="stroke-punk" stroke-width="2.5" stroke-dasharray="6 6" stroke-linecap="round"/>' +
      '<path d="M136 234V188Q150 176 164 188V234Z" class="fill-ground stroke-line" stroke-width="3"/>' +
      '<g transform="rotate(-8 186 168)">' +
        '<rect x="172" y="158" width="28" height="22" rx="4" class="fill-punk"/>' +
        '<path d="M178 162l3-6 3 5 2-6 2 6 3-5 3 6z" class="fill-accent"/>' +
        '<circle cx="186" cy="170" r="4" class="fill-fg"/><circle cx="187" cy="170.5" r="2" class="fill-ground"/>' +
      '</g>' +
      // The sign.
      '<path d="M418 232V196" class="stroke-line" stroke-width="5" stroke-linecap="round"/>' +
      '<g transform="rotate(-6 418 188)">' +
        '<rect x="392" y="176" width="52" height="24" rx="4" class="fill-punk"/>' +
        '<text x="418" y="193" text-anchor="middle" class="fill-ground" style="font: 900 14px system-ui, sans-serif">HOME</text>' +
      '</g>' +
      // Barrels and a crate.
      '<g class="stroke-line" stroke-width="3" stroke-linejoin="round">' +
        '<path d="M452 240Q448 214 454 196H486Q492 214 488 240Z" class="fill-surface"/>' +
        '<path d="M486 244Q482 222 487 206H513Q518 222 514 244Z" class="fill-surface"/>' +
        '<rect x="514" y="214" width="34" height="32" rx="3" class="fill-surface"/>' +
      '</g>' +
      '<path d="M451 208H489M450 228H490" fill="none" class="stroke-line" stroke-width="3"/>' +
      '<path d="M485 216H515M484 234H516" fill="none" class="stroke-punk" stroke-width="3"/>' +
      '<path d="M518 218L544 242M544 218L518 242" fill="none" class="stroke-line" stroke-width="3"/>' +
      '<path d="M462 214l8 6-6 4 10 4" fill="none" class="stroke-accent" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>' +
      // Rocks.
      '<path d="M228 262Q232 248 246 250Q258 252 256 264Z" class="fill-line"/>' +
      '<path d="M372 270Q376 260 386 262Q394 264 392 272Z" class="fill-line"/>' +
      '<path d="M80 258Q84 246 96 248Q104 252 102 260Z" class="fill-line"/>' +
      // Odd plants: a lime stalk with a pink bulb, and a spiky one.
      '<path d="M66 236Q60 206 70 186" fill="none" class="stroke-accent" stroke-width="4" stroke-linecap="round"/>' +
      '<circle cx="70" cy="182" r="9" class="fill-punk"/><circle cx="72" cy="180" r="3" class="fill-ground"/>' +
      '<path d="M528 270l4-22 4 16 4-20 4 18 4-14 2 22z" class="fill-accent"/>' +
      // Grass.
      '<path d="M130 262l4-10 3 9 4-12 3 13M200 276l3-9 3 8 4-11 2 12M408 252l3-9 3 8 4-11 2 12M470 278l4-10 3 9 4-12 3 13M40 280l3-9 3 8 4-11 2 12" fill="none" class="stroke-accent" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>' +
      // The Creature's shadow.
      '<ellipse cx="300" cy="268" rx="62" ry="9" class="fill-ground" opacity="0.6"/>' +
    '</svg>';

  // The scene, with the Creature standing in the middle (or an empty spot).
  function scene(c) {
    var middle = c
      ? '<span class="absolute bottom-5 left-1/2 -translate-x-1/2 sm:bottom-6" data-homestead-resident="' + Number(c.creatureId) + '">' +
          artwork.render(c.appearance, { cls: 'block h-36 w-36 sm:h-48 sm:w-48', bare: true }) +
        '</span>'
      : '<span class="absolute bottom-8 left-1/2 flex h-24 w-24 -translate-x-1/2 items-center justify-center rounded-full border-2 border-dashed border-line text-center text-small text-muted">Empty</span>';
    return '<div class="relative h-64 overflow-hidden rounded-xl bg-ground sm:h-80">' + SCENE + middle + '</div>';
  }

  function speciesLabel(c) {
    var sp = ccfg.byId(ccfg.SPECIES, c.species);
    return sp ? sp.label : 'Creature';
  }

  // Who lives here: name, Species, rarity, level and a small status line.
  function residentInfo(c) {
    if (!c) {
      return '<div class="mt-4 text-center" data-homestead-creature="none">' +
        '<p class="text-heading font-black">Nobody lives here right now.</p>' +
      '</div>';
    }
    return '<div class="mt-4 text-center" data-homestead-creature="' + Number(c.creatureId) + '" data-creature-id="' + Number(c.creatureId) + '">' +
      '<p class="break-words text-title font-black tracking-tight">' + cards.nameSpan(c) + '</p>' +
      '<p class="mt-1 flex flex-wrap items-center justify-center gap-2 text-body">' +
        '<span class="font-bold">' + speciesLabel(c) + '</span>' + cards.rarityBadge(c) +
        '<span class="font-bold tabular-nums">Lv. ' + Number(c.level) + '</span>' +
      '</p>' +
      '<p class="mt-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-small text-muted">' +
        '<span class="inline-flex items-center gap-1.5"><span class="h-2 w-2 rounded-full bg-accent" aria-hidden="true"></span>At home</span>' +
        '<a href="/creature/' + Number(c.creatureId) + '" data-nav class="font-mono underline decoration-punk underline-offset-4 hover:text-fg">' + cards.formatId(c.creatureId) + '</a>' +
      '</p>' +
    '</div>';
  }

  function buildingTile(b) {
    var status = b.unlocked
      ? '<span class="rarity-badge bg-accent text-on-accent">LEVEL ' + Number(b.level) + '</span>'
      : '<span class="inline-flex items-center gap-1 rounded-md bg-raised px-2 py-0.5 text-small font-black tracking-wide text-muted" data-building-status="locked">' + icon('lock', 'h-3.5 w-3.5') + 'LOCKED</span>';
    var def = hcfg.building(b.buildingId);
    return '<li class="card flex flex-col gap-2" data-building="' + (def ? def.id : '') + '" data-unlocked="' + (b.unlocked ? 'true' : 'false') + '">' +
      '<div class="flex items-start justify-between gap-2">' +
        '<span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-raised text-punk">' + icon(def ? def.id : '') + '</span>' +
        status +
      '</div>' +
      '<h3 class="text-body font-black">' + (def ? def.name : '') + '</h3>' +
      '<p class="text-small text-muted">' + (def ? def.description : '') + '</p>' +
      (b.unlocked ? '' : '<p class="mt-auto border-t border-line pt-2 text-small text-muted">' + hcfg.LOCKED_NOTE + '</p>') +
    '</li>';
  }

  function storageSection(h) {
    var used = Number(h.storageUsed) || 0;
    var cap = Number(h.storageCapacity) || 0;
    var pct = cap ? Math.min(100, (used / cap) * 100) : 0;
    var held = hcfg.RESOURCES.filter(function (r) { return Number(h.storage[r.key]) > 0; });
    return '<section class="mt-8" data-storage>' +
      '<h2 class="section-label">Storage</h2>' +
      '<ul class="list">' +
        '<li class="list-row flex-col items-stretch gap-3">' +
          '<span class="flex items-center justify-between gap-3">' +
            '<span class="flex items-center gap-3 font-bold">' + icon('storage', 'h-5 w-5 text-punk') + 'STORAGE</span>' +
            '<span class="font-black tabular-nums" data-storage-used="' + used + '" data-storage-capacity="' + cap + '">' + fmt(used) + ' / ' + fmt(cap) + '</span>' +
          '</span>' +
          '<span class="block h-2 overflow-hidden rounded-full bg-raised" role="progressbar" aria-label="Storage used" aria-valuemin="0" aria-valuemax="' + cap + '" aria-valuenow="' + used + '">' +
            '<span class="block h-full rounded-full bg-accent" style="width:' + pct + '%"></span>' +
          '</span>' +
        '</li>' +
        (held.length
          ? held.map(function (r) {
              return '<li class="list-row justify-between"><span>' + r.label + '</span><span class="font-bold tabular-nums">' + fmt(h.storage[r.key]) + '</span></li>';
            }).join('')
          : '<li class="list-row" data-storage-empty><span class="text-muted">Empty. Nothing is stored here yet.</span></li>') +
      '</ul>' +
    '</section>';
  }

  function page(h, c) {
    var residents = c ? 1 : 0;
    return '<div class="max-w-3xl" data-homestead="' + Number(h.homesteadId) + '">' +
      '<section class="collectible">' +
        '<span class="sticker absolute -top-3 left-4" data-homestead-id>HOMESTEAD ' + hcfg.formatId(h.homesteadId) + '</span>' +
        '<div class="flex flex-wrap items-end justify-between gap-4 pb-4 pt-2">' +
          '<div>' +
            '<p class="text-title font-black tracking-tight" data-homestead-level="' + Number(h.level) + '">Level ' + Number(h.level) + '</p>' +
            '<p class="text-small text-muted">Owner <span class="font-mono">' + shortOwner(h.owner) + '</span></p>' +
          '</div>' +
          '<div class="text-right">' +
            '<p class="text-small font-bold text-muted">CREATURES</p>' +
            '<p class="text-heading font-black tabular-nums" data-homestead-capacity="' + Number(h.capacity) + '">' + residents + ' / ' + Number(h.capacity) + '</p>' +
          '</div>' +
        '</div>' +
        scene(c) +
        residentInfo(c) +
      '</section>' +
      '<section class="mt-8">' +
        '<h2 class="section-label">Buildings</h2>' +
        '<ul class="grid grid-cols-2 gap-3 lg:grid-cols-3" data-buildings>' + h.buildings.map(buildingTile).join('') + '</ul>' +
      '</section>' +
      storageSection(h) +
    '</div>';
  }

  window.HOMESTEAD_HOMESTEAD_VIEW = { page: page, icon: icon };
})();
