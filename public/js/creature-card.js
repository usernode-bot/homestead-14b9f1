// HOMESTEAD Creature Card: the reusable ways a stored Creature is shown.
//
// - card(c, opts): the compact card (art, name, Species, rarity, level),
//   for Collection and later the Marketplace, contests and Breeding.
// - hero(c, opts): the large panel at the top of a Creature's profile.
// - statsList(c) / identityList(c): the base stats and the permanent identity.
// - feedingSection(c, opts) / trainingSection(c, opts): hunger and condition
//   with the owner's FEED control; base, training, Gear and effective stats
//   with the owner's TRAIN controls. Every number comes from the server; the
//   costs and limits are read from care-config.js. The Gear section itself is
//   gear-view.js.
//
// The name is the one thing a person types, so it is never written into this
// HTML: each place it shows is a <span data-creature-name="<id>">, filled in
// as text by app.js.
(function () {
  var cfg = window.HOMESTEAD_CREATURE_CONFIG;
  var care = window.HOMESTEAD_CARE_CONFIG;
  var foods = window.HOMESTEAD_FOOD_CONFIG;
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

  function statLabel(key) {
    var s = cfg.STATS.find(function (x) { return x.key === key; });
    return s ? s.label : key;
  }

  // What the last Feed or Train did, as a short status line.
  function noticeText(n) {
    if (!n) return '';
    if (n.kind === 'fed' && n.food) return 'Fed! +' + Number(n.restored) + ' Hunger, -1 ' + (foods.food(n.food) || { name: 'food' }).name;
    if (n.kind === 'fed') return 'Fed! +' + Number(n.restored) + ' Hunger, -' + Number(n.fodderSpent) + ' Fodder';
    if (n.kind === 'trained') return 'Trained! +' + Number(n.amount) + ' ' + statLabel(n.stat) + ', -' + Number(n.cost) + ' STEAD';
    return '';
  }

  // "14:30", or "Wed 14:30" when it isn't today.
  function holdTime(iso) {
    var d = new Date(iso);
    if (isNaN(d)) return '';
    var time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    return d.toDateString() === new Date().toDateString() ? time : d.toLocaleDateString('en-US', { weekday: 'short' }) + ' ' + time;
  }

  // Hunger and condition, and for the owner one feeding panel: the Fodder on
  // hand with FEED, then the Marketplace food they hold as extras. opts:
  // { canAct, controls, pending, notice, error }
  function feedingSection(c, opts) {
    opts = opts || {};
    var k = c.care || { hunger: care.HUNGER_MAX, hungerState: 'WELL_FED', hungerLabel: 'WELL FED', condition: 'GOOD' };
    var max = care.HUNGER_MAX;
    var pct = Math.max(0, Math.min(100, (k.hunger / max) * 100));
    var rows =
      '<li class="list-row flex-col items-stretch gap-2">' +
        '<span class="flex items-baseline justify-between gap-3">' +
          '<span class="text-small font-bold">HUNGER</span>' +
          '<span class="font-bold tabular-nums" data-hunger="' + Number(k.hunger) + '">' + Number(k.hunger) + ' / ' + max + '</span>' +
        '</span>' +
        '<span class="h-2 overflow-hidden rounded-full bg-raised" role="progressbar" aria-label="Hunger" aria-valuemin="0" aria-valuemax="' + max + '" aria-valuenow="' + Number(k.hunger) + '">' +
          '<span class="block h-full rounded-full ' + (k.hungerState === 'WELL_FED' ? 'bg-accent' : k.hungerState === 'HUNGRY' ? 'bg-punk' : 'bg-danger') + '" style="width:' + pct + '%"></span>' +
        '</span>' +
        '<span class="text-body font-black" data-hunger-state="' + k.hungerState + '">' + k.hungerLabel + '</span>' +
        (k.holdUntil ? '<span class="text-small font-bold text-accent" data-hunger-hold>Stays full until ' + holdTime(k.holdUntil) + '</span>' : '') +
      '</li>' +
      '<li class="list-row justify-between gap-4"><span class="text-muted">Condition</span>' +
        '<span class="font-bold" data-condition="' + k.condition + '">' + k.condition + '</span></li>' +
      '<li class="list-row justify-between gap-4"><span class="text-muted">Work output</span>' +
        '<span class="font-bold tabular-nums" data-work-efficiency>' + Math.round(care.efficiency(k.hunger) * 100) + '%</span></li>';

    if (opts.canAct) {
      var ctl = opts.controls;
      var full = k.hunger >= max;
      var fodder = ctl ? Number(ctl.fodder) || 0 : null;
      var short = ctl && fodder < care.FEED_FODDER_COST;
      var busy = !!opts.pending;
      var why = !ctl ? '' : full ? 'Already Full' : short ? 'Need ' + care.FEED_FODDER_COST + ' Fodder' : '';
      var owned = (ctl && ctl.food) || {};
      var have = foods.FOODS.filter(function (f) { return Number(owned[f.id]) > 0; });
      var foodButtons = have.map(function (f) {
        var pending = opts.pending === 'feed:' + f.id;
        return '<button type="button" class="btn-secondary" data-action="feed-food" data-food="' + f.id + '"' + (full || busy ? ' disabled' : '') + '>' +
          (pending ? 'FEEDING…' : f.name.toUpperCase() + ' ×' + Number(owned[f.id])) + '</button>';
      }).join('');
      var n = opts.notice;
      rows +=
        '<li class="list-row flex-col items-stretch gap-3" data-feeding>' +
          '<span class="flex items-baseline justify-between gap-3">' +
            '<span class="text-small font-bold">FODDER</span>' +
            '<span class="font-bold tabular-nums" data-fodder="' + (ctl ? fodder : '') + '">' + (ctl ? fodder : '…') + '</span>' +
          '</span>' +
          '<p class="text-small text-muted">Feeding uses ' + care.FEED_FODDER_COST + ' Fodder for +' + care.FEED_HUNGER_RESTORE + ' Hunger. Farmers bring Fodder home from Work.</p>' +
          '<button type="button" class="btn-primary" data-action="feed"' + (!ctl || full || short || busy ? ' disabled' : '') + '>' +
            (opts.pending === 'feed' ? 'FEEDING…' : 'FEED') + '</button>' +
          '<span class="flex flex-col items-stretch gap-2" data-food-feeding>' +
            (have.length
              ? '<span class="flex flex-wrap gap-2">' + foodButtons + '</span>'
              : (ctl ? '<p class="text-small text-muted" data-food-empty>No food yet.</p>' : '')) +
            '<a href="/marketplace" data-nav class="text-small font-bold underline decoration-punk underline-offset-4" data-food-market-link>Buy food in the Marketplace.</a>' +
          '</span>' +
          (why ? '<p class="text-small font-bold text-muted" data-feed-blocked>' + why + '</p>' : '') +
          (n && n.kind === 'fed' ? '<p class="text-small font-bold text-accent" role="status" data-care-notice>' + noticeText(n) + '</p>' : '') +
        '</li>';
    }
    return '<section data-hunger-section><h3 class="section-label">Hunger</h3><ul class="list">' + rows + '</ul></section>';
  }

  // Base, training, Gear and effective stats; for the owner a TRAIN button on
  // each. data-stat keeps the base value. opts as feedingSection.
  function trainingSection(c, opts) {
    opts = opts || {};
    var ctl = opts.canAct ? opts.controls : null;
    var bonus = c.trainingBonus || {};
    var gearBonus = care.gearBonuses(c);
    var effective = care.effectiveStats(c);
    var working = !!(ctl && ctl.working);
    var inContest = !!(ctl && ctl.inContest);
    var poor = !!(ctl && Number(ctl.steadBalance) < care.TRAINING_COST);
    var busy = !!opts.pending;
    var head = '';
    if (opts.canAct) {
      head =
        '<li class="list-row flex-wrap justify-between gap-x-4 gap-y-1">' +
          '<span class="text-body font-bold" data-training-cost>Cost: ' + care.TRAINING_COST + ' STEAD per +' + care.TRAINING_AMOUNT + '</span>' +
          '<span class="text-small text-muted">You have <span class="font-bold tabular-nums text-fg" data-training-stead>' + (ctl ? Number(ctl.steadBalance).toLocaleString('en-US') : '…') + '</span> STEAD</span>' +
        '</li>' +
        (working ? '<li class="list-row"><p class="text-body font-bold" data-training-blocked="working">Creature is working. Training unavailable.</p></li>'
          : inContest ? '<li class="list-row"><p class="text-body font-bold" data-training-blocked="contest">Creature is in a contest. Training unavailable.</p></li>'
          : poor ? '<li class="list-row"><p class="text-body text-muted" data-training-blocked="stead">Need ' + care.TRAINING_COST + ' STEAD to train. Daily Check-in on Home pays STEAD.</p></li>' : '') +
        (opts.notice && opts.notice.kind === 'trained' ? '<li class="list-row"><p class="text-body font-bold text-accent" role="status" data-care-notice>' + noticeText(opts.notice) + '</p></li>' : '');
    }
    var rows = cfg.STATS.map(function (s) {
      var base = Number(c.stats && c.stats[s.key]) || 0;
      var b = Number(bonus[s.key]) || 0;
      var gb = Number(gearBonus[s.key]) || 0;
      var atMax = b >= care.MAX_TRAINING_BONUS;
      var button = '';
      if (opts.canAct) {
        var pending = opts.pending === 'train:' + s.key;
        button = '<button type="button" class="btn-secondary w-full whitespace-nowrap px-3 sm:w-40" data-action="train" data-stat="' + s.key + '"' +
          ' aria-label="Train ' + s.label + ' for ' + care.TRAINING_COST + ' STEAD"' +
          (!ctl || atMax || working || inContest || poor || busy ? ' disabled' : '') + '>' +
          (atMax ? 'MAX TRAINING' : pending ? 'TRAINING…' : '+ TRAIN') + '</button>';
      }
      return '<li class="list-row flex-wrap gap-x-4 gap-y-2" data-training-stat="' + s.key + '">' +
        '<span class="w-20 shrink-0 text-small font-bold">' + s.label.toUpperCase() + '</span>' +
        '<dl class="grid min-w-60 flex-1 grid-cols-4 gap-2 text-small">' +
          '<div><dt class="text-muted">Base</dt><dd class="font-bold tabular-nums" data-stat="' + s.key + '">' + base + '</dd></div>' +
          '<div><dt class="text-muted">Training</dt><dd class="font-bold tabular-nums" data-training-bonus="' + s.key + '">+' + b + '</dd></div>' +
          '<div><dt class="text-muted">Gear</dt><dd class="tabular-nums' + (gb ? ' font-bold' : ' text-muted') + '" data-gear-bonus="' + s.key + '">+' + gb + '</dd></div>' +
          '<div><dt class="text-muted">Effective</dt><dd class="text-body font-black tabular-nums" data-effective-stat="' + s.key + '">' + effective[s.key] + '</dd></div>' +
        '</dl>' +
        button +
      '</li>';
    }).join('');
    return '<section data-training><h3 class="section-label">' + (opts.canAct ? 'Stats and training' : 'Stats') + '</h3>' +
      '<ul class="list" data-stats>' + head + rows + '</ul>' +
      '<p class="mt-2 px-1 text-small text-muted">Effective is Base plus Training plus Gear.' +
        (opts.canAct ? ' Each stat can gain up to +' + care.MAX_TRAINING_BONUS + ' from training. Base stats never change.' : '') + '</p>' +
    '</section>';
  }

  // Whether the Creature can compete right now (lib/contests.js availability),
  // with CHALLENGE for its owner, or CHALLENGE OWNER for another connected
  // player. opts: { contest, canAct, canChallengeOwner }
  function contestSection(c, opts) {
    var a = opts.contest;
    if (!a) return '';
    var row;
    if (a.status === 'in_contest') {
      row = '<span class="text-body font-black" data-contest-availability="in_contest">IN CONTEST</span>' +
        '<a href="/contests/' + Number(a.contestId) + '" data-nav class="btn-secondary">View contest</a>';
    } else if (a.status === 'working') {
      row = '<span><span class="block text-body font-black" data-contest-availability="working">WORKING</span>' +
        '<span class="block text-small text-muted">Contests unavailable</span></span>';
    } else {
      var button = opts.canAct
        ? '<button type="button" class="btn-secondary" data-action="contest-prefill" data-creature-id="' + Number(c.creatureId) + '">CHALLENGE</button>'
        : opts.canChallengeOwner
          ? '<button type="button" class="btn-secondary" data-action="contest-prefill" data-opponent-of="' + Number(c.creatureId) + '">CHALLENGE OWNER</button>'
          : '';
      row = '<span class="text-body" data-contest-availability="ready">Ready to compete.</span>' + button;
    }
    return '<section data-contest-section><h3 class="section-label">Contests</h3><ul class="list">' +
      '<li class="list-row flex-wrap justify-between gap-3">' + row + '</li></ul></section>';
  }

  // The whole profile: hero; Contests; hunger and identity side by side;
  // Gear; then stats and training.
  // opts: { canRename, canAct, controls, pending, notice, error, gear, contest, canChallengeOwner }
  function profile(c, opts) {
    opts = opts || {};
    return '<div class="max-w-3xl" data-creature-profile="' + Number(c.creatureId) + '">' +
      hero(c, opts) +
      (opts.error ? '<p role="alert" class="mt-4 px-1 text-small text-danger" data-field="care-error"></p>' : '') +
      (opts.contest ? '<div class="mt-8">' + contestSection(c, opts) + '</div>' : '') +
      '<div class="mt-8 grid gap-6 md:grid-cols-2">' +
        feedingSection(c, opts) +
        '<section><h3 class="section-label">Identity</h3>' + identityList(c) + '</section>' +
      '</div>' +
      '<div class="mt-8">' + window.HOMESTEAD_GEAR_VIEW.section(c, { canAct: opts.canAct, gear: opts.gear }) + '</div>' +
      '<div class="mt-8">' + trainingSection(c, opts) + '</div>' +
    '</div>';
  }

  window.HOMESTEAD_CREATURE_CARD = {
    formatId: formatId, card: card, hero: hero, profile: profile,
    statsList: statsList, identityList: identityList, feedingSection: feedingSection, trainingSection: trainingSection, art: art, rarityBadge: rarityBadge, nameSpan: nameSpan,
  };
})();
