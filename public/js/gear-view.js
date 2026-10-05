// HOMESTEAD Gear views: how a Gear item, a Creature's Gear slots and the Gear
// inventory are shown.
//
// - section(c, opts): the Gear section of a Creature's profile, with its
//   owner's EQUIP GEAR, CHANGE and UNEQUIP controls and the slot picker.
// - inventory(state): the Gear screen (/gear).
//
// Gear names come from the catalog, but are escaped anyway. Creature names
// are typed by their owners, so they are only ever <span data-creature-name>,
// filled in as text by app.js.
(function () {
  var cfg = window.HOMESTEAD_GEAR_CONFIG;
  var creatureCfg = window.HOMESTEAD_CREATURE_CONFIG;

  function esc(text) {
    return String(text == null ? '' : text).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  function nameSpan(creatureId) {
    return '<span data-creature-name="' + Number(creatureId) + '"></span>';
  }

  function slotLabel(slot) {
    var s = cfg.byId(cfg.SLOTS, slot);
    return s ? s.label : slot;
  }

  function rarityBadge(item) {
    var r = creatureCfg.byId(creatureCfg.RARITIES, item.rarity) || creatureCfg.RARITIES[0];
    return '<span class="rarity-badge ' + r.visual.badgeClass + '" data-rarity="' + r.id + '">' + r.label.toUpperCase() + '</span>';
  }


  // "ATK +12 · SPD +3"
  function statsLine(item) {
    var lines = cfg.statLines(item.stats);
    if (!lines.length) return 'No stat bonus';
    return lines.map(function (l) {
      return '<span data-gear-stat="' + l.key + '">' + l.short + ' +' + Number(l.value) + '</span>';
    }).join(' · ');
  }

  // A Gear item's name, rarity (the badge), type, Gear ID and stats.
  function itemSummary(item) {
    return '<span class="flex flex-wrap items-center gap-2"><span class="text-body font-black" data-gear-name>' + esc(item.name) + '</span>' + rarityBadge(item) + '</span>' +
      '<span class="mt-0.5 block text-small text-muted"><span data-gear-type="' + item.type + '">' + slotLabel(item.type) + '</span> · <span class="font-mono">' + esc(item.code) + '</span></span>' +
      '<span class="mt-1 block text-small font-bold tabular-nums">' + statsLine(item) + '</span>';
  }

  // What the last claim, equip or unequip did.
  function noticeText(n) {
    if (!n) return '';
    if (n.kind === 'claimed') return 'Starter Gear claimed! ' + Number(n.count) + ' items added to your Gear inventory.';
    if (n.kind === 'equipped') return 'Equipped! ' + esc(n.name) + ' → ' + nameSpan(n.creatureId);
    if (n.kind === 'replaced') return esc(n.slotLabel) + ' replaced. ' + esc(n.oldName) + ' returned to inventory. ' + esc(n.newName) + ' equipped.';
    if (n.kind === 'unequipped') return 'Unequipped! ' + esc(n.name) + ' returned to Gear inventory.';
    return '';
  }

  function notice(g, cls) {
    return g.notice ? '<p class="' + cls + ' text-body font-bold text-accent" role="status" data-gear-notice="' + g.notice.kind + '">' + noticeText(g.notice) + '</p>' : '';
  }

  function errorLine(g, cls) {
    return g.error ? '<p role="alert" class="' + cls + ' text-small text-danger" data-field="gear-error"></p>' : '';
  }

  // The items this wallet could put in `slot` on this Creature: its own, of
  // that type, not on any Creature.
  function candidates(g, slot) {
    return g.items.filter(function (i) { return i.type === slot && i.equippedCreatureId == null; });
  }

  // The picker under a slot: the items that fit, each with EQUIP.
  function picker(c, slot, current, g) {
    var head = '<span class="flex items-center justify-between gap-3">' +
      '<span class="text-small font-bold">Choose Gear for this slot</span>' +
      '<button type="button" class="btn-secondary" data-action="gear-choose-cancel">CANCEL</button>' +
    '</span>';
    if (g.status === 'error') {
      return '<div class="flex flex-col gap-3 border-t border-line pt-3" data-gear-picker="' + slot + '">' + head +
        '<p class="text-small text-muted">Couldn\'t load your Gear inventory.</p>' +
        '<button type="button" class="btn-secondary self-start" data-action="gear-retry">Retry</button></div>';
    }
    if (g.status !== 'ready') {
      return '<div class="flex flex-col gap-3 border-t border-line pt-3" data-gear-picker="' + slot + '" aria-busy="true">' + head +
        '<span class="sr-only">Loading your Gear</span><div class="skeleton h-12 w-full"></div></div>';
    }
    var list = candidates(g, slot);
    if (!list.length) {
      return '<div class="flex flex-col gap-3 border-t border-line pt-3" data-gear-picker="' + slot + '">' + head +
        '<p class="text-small text-muted" data-gear-picker-empty>No ' + slotLabel(slot) + ' in your Gear inventory.</p>' +
        '<a href="/gear" data-nav class="btn-secondary self-start">Open Gear inventory</a></div>';
    }
    return '<div class="flex flex-col gap-3 border-t border-line pt-3" data-gear-picker="' + slot + '">' + head +
      (current ? '<p class="text-small text-muted">Equipping one returns ' + esc(current.name) + ' to your inventory.</p>' : '') +
      '<ul class="divide-y divide-line">' + list.map(function (item) {
        var pending = g.pending === 'equip:' + item.gearId;
        return '<li class="flex flex-wrap items-center justify-between gap-3 py-3" data-gear-option="' + Number(item.gearId) + '">' +
          '<span class="min-w-0">' + itemSummary(item) + '</span>' +
          '<button type="button" class="btn-secondary" data-action="gear-equip" data-creature-id="' + Number(c.creatureId) + '" data-gear-id="' + Number(item.gearId) + '" data-slot="' + slot + '"' +
            (g.pending ? ' disabled' : '') + '>' + (pending ? 'EQUIPPING…' : 'EQUIP') + '</button>' +
        '</li>';
      }).join('') + '</ul></div>';
  }

  // The Gear section of a Creature's profile. opts: { canAct, gear } where
  // gear is the store's gear slot (the owner's inventory).
  function section(c, opts) {
    opts = opts || {};
    var g = opts.canAct ? opts.gear : null;
    var equipped = c.gear || {};
    var rows = cfg.SLOTS.map(function (s) {
      var item = equipped[s.id] || null;
      var choosing = g && g.choosing && g.choosing.creatureId === c.creatureId && g.choosing.slot === s.id;
      var busy = !!(g && g.pending);
      var body = item
        ? '<div data-gear-equipped="' + Number(item.gearId) + '">' + itemSummary(item) + '</div>'
        : '<p class="text-body text-muted" data-gear-empty>Empty</p>';
      var actions = '';
      if (g && !choosing) {
        actions = '<span class="flex flex-wrap gap-2">' +
          (item
            ? '<button type="button" class="btn-secondary" data-action="gear-choose" data-creature-id="' + Number(c.creatureId) + '" data-slot="' + s.id + '"' + (busy ? ' disabled' : '') + '>CHANGE</button>' +
              '<button type="button" class="btn-secondary" data-action="gear-unequip" data-creature-id="' + Number(c.creatureId) + '" data-slot="' + s.id + '"' + (busy ? ' disabled' : '') + '>' +
                (g.pending === 'unequip:' + s.id ? 'UNEQUIPPING…' : 'UNEQUIP') + '</button>'
            : '<button type="button" class="btn-secondary" data-action="gear-choose" data-creature-id="' + Number(c.creatureId) + '" data-slot="' + s.id + '"' + (busy ? ' disabled' : '') + '>EQUIP GEAR</button>') +
        '</span>';
      }
      return '<li class="list-row flex-col items-stretch gap-3" data-gear-slot="' + s.id + '">' +
        '<span class="text-small font-bold">' + s.label.toUpperCase() + '</span>' +
        body + actions +
        (choosing ? picker(c, s.id, item, g) : '') +
      '</li>';
    }).join('');
    return '<section data-gear-section>' +
      '<h3 class="section-label">Gear</h3>' +
      (g ? notice(g, 'mb-3 px-1') + errorLine(g, 'mb-3 px-1') : '') +
      '<ul class="list">' + rows + '</ul>' +
      (g ? '<p class="mt-2 px-1 text-small text-muted">Equipping is free and Gear stays on while your Creature works. <a href="/gear" data-nav class="font-bold text-fg underline decoration-punk underline-offset-4">Open Gear inventory</a></p>' : '') +
    '</section>';
  }

  // The starter claim: the screen's one primary action while unclaimed.
  function claimBlock(g) {
    var busy = g.pending === 'claim';
    return '<section class="collectible state-empty py-10" data-empty="gear-starter">' +
      '<p class="text-heading">No Gear yet.</p>' +
      '<p class="max-w-sm text-body text-muted">Claim the starter kit: ' + cfg.STARTER_KIT.length + ' pieces of Gear for your Creature\'s ' +
        cfg.SLOTS.map(function (s) { return s.label; }).join(' and ') + ' slots. One kit per wallet.</p>' +
      '<button type="button" class="btn-primary mt-2" data-action="gear-claim"' + (busy ? ' disabled' : '') + '>' + (busy ? 'CLAIMING…' : 'CLAIM STARTER GEAR') + '</button>' +
    '</section>';
  }

  // The Gear screen. target is the Creature the EQUIP buttons put Gear on
  // (this wallet's own), or null when it has none.
  function inventory(state, target) {
    var g = state.gear;
    if (g.status === 'error') {
      return '<section class="collectible state-error max-w-3xl">' +
        '<p class="text-heading">Couldn\'t load your Gear.</p>' +
        '<p class="max-w-sm text-body text-muted">Your Gear is safe. Check your connection and try again.</p>' +
        '<button type="button" class="btn-secondary mt-2" data-action="gear-retry">Retry</button>' +
      '</section>';
    }
    if (g.status !== 'ready') {
      return '<ul class="list max-w-3xl" aria-busy="true"><li class="list-row"><span class="sr-only">Loading your Gear</span><div class="skeleton h-12 w-full"></div></li>' +
        '<li class="list-row"><div class="skeleton h-12 w-full"></div></li><li class="list-row"><div class="skeleton h-12 w-full"></div></li></ul>';
    }
    var head = notice(g, 'mb-4') + errorLine(g, 'mb-4');
    if (!g.items.length) return '<div class="max-w-3xl">' + head + (g.starterClaimed ? '' : claimBlock(g)) + '</div>';
    var targetLine = target
      ? '<p class="mb-4 text-body text-muted" data-gear-target="' + Number(target.creatureId) + '">EQUIP puts Gear on <span class="font-bold text-fg">' + nameSpan(target.creatureId) + '</span>. Equipping is free.</p>'
      : '<p class="mb-4 text-body text-muted" data-gear-target="">Awaken a Creature on Home to equip Gear.</p>';
    var list = '<ul class="list" data-gear-inventory>' + g.items.map(function (item) {
      var on = item.equippedCreatureId;
      var action = '';
      if (on != null) {
        var pendingOff = g.pending === 'unequip:' + item.type;
        action = '<button type="button" class="btn-secondary" data-action="gear-unequip" data-creature-id="' + Number(on) + '" data-slot="' + item.type + '"' + (g.pending ? ' disabled' : '') + '>' +
          (pendingOff ? 'UNEQUIPPING…' : 'UNEQUIP') + '</button>';
      } else if (target) {
        var pendingOn = g.pending === 'equip:' + item.gearId;
        action = '<button type="button" class="btn-secondary" data-action="gear-equip" data-creature-id="' + Number(target.creatureId) + '" data-gear-id="' + Number(item.gearId) + '" data-slot="' + item.type + '"' + (g.pending ? ' disabled' : '') + '>' +
          (pendingOn ? 'EQUIPPING…' : 'EQUIP') + '</button>';
      }
      return '<li class="list-row flex-wrap justify-between" data-gear-item="' + Number(item.gearId) + '" data-equipped="' + (on != null) + '">' +
        '<span class="min-w-0">' + itemSummary(item) +
          '<span class="mt-1 block text-small' + (on != null ? ' font-bold text-accent' : ' text-muted') + '" data-gear-status>' +
            (on != null ? 'Equipped on ' + nameSpan(on) : 'In inventory') + '</span>' +
        '</span>' +
        action +
      '</li>';
    }).join('') + '</ul>';
    return '<div class="max-w-3xl">' + head + (g.starterClaimed ? '' : claimBlock(g)) + targetLine +
      '<p class="section-label">' + g.items.length + (g.items.length === 1 ? ' item' : ' items') + '</p>' + list + '</div>';
  }

  window.HOMESTEAD_GEAR_VIEW = { section: section, inventory: inventory, itemSummary: itemSummary };
})();
