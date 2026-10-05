// HOMESTEAD Creature Card: the reusable ways a stored Creature is shown.
//
// - card(c, opts): the compact card (art, name, Species, rarity, level),
//   for Collection and later the Marketplace, contests and Breeding.
// - hero(c, opts): the large panel at the top of a Creature's profile.
// - statsList(c) / identityList(c): the base stats and the permanent identity.
//
// The name is the one thing a person types, so it is never written into this
// HTML: each place it shows is a <span data-creature-name="<id>">, filled in
// as text by app.js.
(function () {
  var cfg = window.HOMESTEAD_CREATURE_CONFIG;
  var artwork = window.HOMESTEAD_CREATURE_ART;

  function label(list, id) {
    var item = cfg.byId(list, id);
    return item ? item.label : '—';
  }
  function rarityOf(c) { return cfg.byId(cfg.RARITIES, c.rarity) || cfg.RARITIES[0]; }

  // The permanent, human-readable Creature ID: CR-00427.
  function formatId(id) { return 'CR-' + String(id).padStart(5, '0'); }

  // Gene and Creature ID are system values: only letters, digits and dashes
  // are ever shown.
  function safe(text) { return String(text == null ? '' : text).replace(/[^A-Za-z0-9-]/g, ''); }

  function nameSpan(c, cls) {
    return '<span class="' + (cls || '') + '" data-creature-name="' + Number(c.creatureId) + '"></span>';
  }

  function rarityBadge(c) {
    var r = rarityOf(c);
    return '<span class="rarity-badge ' + r.visual.badgeClass + '" data-rarity="' + r.id + '">' + r.label.toUpperCase() + '</span>';
  }

  function art(c, size) {
    return '<span class="block shrink-0 overflow-hidden rounded-2xl border-2 ' + rarityOf(c).visual.frameClass + ' ' + size + '">' +
      artwork.render(c.appearance, { cls: 'block h-full w-full' }) + '</span>';
  }

  function card(c, opts) {
    opts = opts || {};
    var inner =
      art(c, 'aspect-square w-full') +
      '<span class="mt-3 block truncate text-heading font-black">' + nameSpan(c) + '</span>' +
      '<span class="mt-0.5 block text-small text-muted">' + label(cfg.SPECIES, c.species) + '</span>' +
      '<span class="mt-2 flex items-center justify-between gap-2">' + rarityBadge(c) +
        '<span class="whitespace-nowrap text-small font-bold tabular-nums">Lv. ' + Number(c.level) + '</span></span>';
    var attrs = ' data-creature-card="' + Number(c.creatureId) + '"';
    return opts.href
      ? '<a href="' + opts.href + '" data-nav class="collectible block hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"' + attrs + '>' + inner + '</a>'
      : '<div class="collectible"' + attrs + '>' + inner + '</div>';
  }

  function hero(c, opts) {
    opts = opts || {};
    var species = cfg.byId(cfg.SPECIES, c.species);
    return '<section class="collectible" data-creature-id="' + Number(c.creatureId) + '">' +
      (c.genesis ? '<span class="sticker absolute -top-3 left-4">GENESIS</span>' : '') +
      '<div class="flex flex-col items-center gap-6 pt-2 sm:flex-row sm:items-center">' +
        art(c, 'h-48 w-48') +
        '<div class="min-w-0 text-center sm:text-left">' +
          '<p class="font-mono text-small text-muted">' + formatId(c.creatureId) + '</p>' +
          '<h2 class="mt-1 break-words text-title font-black tracking-tight">' + nameSpan(c) + '</h2>' +
          '<p class="mt-2 flex flex-wrap items-center justify-center gap-2 text-body sm:justify-start">' +
            '<span class="font-bold">' + label(cfg.SPECIES, c.species) + '</span>' + rarityBadge(c) +
            '<span class="font-bold tabular-nums">Lv. ' + Number(c.level) + '</span>' +
          '</p>' +
          (species ? '<p class="mt-2 text-small text-muted">' + species.blurb + '</p>' : '') +
          (opts.canRename ? '<button type="button" class="btn-secondary mt-4" data-action="rename">RENAME</button>' : '') +
        '</div>' +
      '</div>' +
    '</section>';
  }

  function statsList(c) {
    return '<ul class="list" data-stats>' + cfg.STATS.map(function (s) {
      var value = Number(c.stats && c.stats[s.key]) || 0;
      var pct = Math.min(100, (value / cfg.STAT_RANGES[s.key].cap) * 100);
      return '<li class="list-row">' +
        '<span class="w-20 shrink-0 text-small font-bold">' + s.label.toUpperCase() + '</span>' +
        '<span class="h-2 flex-1 overflow-hidden rounded-full bg-raised" aria-hidden="true"><span class="block h-full rounded-full bg-punk" style="width:' + pct + '%"></span></span>' +
        '<span class="w-10 shrink-0 text-right font-bold tabular-nums" data-stat="' + s.key + '">' + value + '</span>' +
      '</li>';
    }).join('') + '</ul>';
  }

  function row(name, value, attr) {
    return '<li class="list-row justify-between gap-4"><span class="text-muted">' + name + '</span>' +
      '<span class="text-right font-bold"' + (attr || '') + '>' + value + '</span></li>';
  }

  function identityList(c) {
    return '<ul class="list" data-identity>' +
      row('Creature ID', formatId(c.creatureId), ' data-creature-code') +
      row('Gene', '<span class="font-mono">' + safe(c.gene) + '</span>', ' data-gene') +
      row('Species', label(cfg.SPECIES, c.species)) +
      row('Personality', label(cfg.PERSONALITIES, c.personality)) +
      row('Mutation', label(cfg.MUTATIONS, c.mutation)) +
      row('Trade', label(cfg.TRADES, c.trade)) +
      row('Genesis', c.genesis ? 'Yes' : 'No') +
    '</ul>';
  }

  // The whole profile: hero, then stats and identity side by side.
  function profile(c, opts) {
    return '<div class="max-w-3xl" data-creature-profile="' + Number(c.creatureId) + '">' +
      hero(c, opts) +
      '<div class="mt-8 grid gap-6 md:grid-cols-2">' +
        '<section><h3 class="section-label">Base stats</h3>' + statsList(c) + '</section>' +
        '<section><h3 class="section-label">Identity</h3>' + identityList(c) + '</section>' +
      '</div>' +
    '</div>';
  }

  window.HOMESTEAD_CREATURE_CARD = {
    formatId: formatId, card: card, hero: hero, profile: profile,
    statsList: statsList, identityList: identityList, art: art, rarityBadge: rarityBadge, nameSpan: nameSpan,
  };
})();
