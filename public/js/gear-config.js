// HOMESTEAD Gear configuration: the one place Gear slots, the stats Gear can
// add to, and the starter Gear catalog live.
//
// Loaded by the page (window.HOMESTEAD_GEAR_CONFIG) AND by the server
// (require('./public/js/gear-config')), so both read the same catalog.
//
// Gear is equipment a Creature wears in a slot. Its stats are additive
// bonuses beside the Creature's base stats and training bonuses, which Gear
// never changes. The effective-stat calculation that adds them up is
// care-config.js effectiveStat (base + training + gear + traits).
//
// Every Gear item is a stored row (lib/gear.js) that copies its name, rarity,
// type and stats from the catalog entry it was made from, so an item keeps
// what it is even if the catalog changes later.
(function (root) {
  // The slots every Creature has, in the order they show. A Gear item's type
  // is the id of the slot it fits; one item per slot. Homeroom's content
  // rules allow no weapons as objects or game mechanics, so the hand slot is
  // a Tool and holds tools.
  var SLOTS = Object.freeze([
    Object.freeze({ id: 'tool', label: 'Tool' }),
    Object.freeze({ id: 'accessory', label: 'Accessory' }),
  ]);

  // The stats Gear can add to (creature-config.js STATS keys), with the short
  // labels used on Gear lines ("ATK +12").
  var STATS = Object.freeze([
    Object.freeze({ key: 'hp', short: 'HP' }),
    Object.freeze({ key: 'attack', short: 'ATK' }),
    Object.freeze({ key: 'defense', short: 'DEF' }),
    Object.freeze({ key: 'speed', short: 'SPD' }),
    Object.freeze({ key: 'luck', short: 'LUCK' }),
  ]);

  // The starter Gear catalog. rarity is a creature-config.js RARITIES id (the
  // same six tiers as Creatures), type a SLOTS id, stats whole numbers for
  // STATS keys (a stat it leaves out adds 0). trait is reserved for later
  // and is null for every starter item. Add an item here and nowhere else.
  var CATALOG = Object.freeze([
    Object.freeze({ id: 'rusty-wrench', name: 'Rusty Wrench', rarity: 'common', type: 'tool', stats: Object.freeze({ attack: 3 }), trait: null }),
    Object.freeze({ id: 'leather-charm', name: 'Leather Charm', rarity: 'common', type: 'accessory', stats: Object.freeze({ defense: 2 }), trait: null }),
    Object.freeze({ id: 'moon-hammer', name: 'Moon Hammer', rarity: 'rare', type: 'tool', stats: Object.freeze({ attack: 12, speed: 3 }), trait: null }),
    Object.freeze({ id: 'lucky-bone', name: 'Lucky Bone', rarity: 'rare', type: 'accessory', stats: Object.freeze({ luck: 8 }), trait: null }),
    Object.freeze({ id: 'iron-drill', name: 'Iron Drill', rarity: 'epic', type: 'tool', stats: Object.freeze({ attack: 18, defense: 5 }), trait: null }),
  ]);

  // The starter kit: what CLAIM STARTER GEAR gives a wallet, once ever
  // (lib/gear.js claimStarter). CATALOG ids, one item each.
  var STARTER_KIT = Object.freeze(['rusty-wrench', 'leather-charm', 'moon-hammer', 'lucky-bone', 'iron-drill']);

  function byId(list, id) {
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  function isSlot(id) { return !!byId(SLOTS, id); }

  // The permanent, human-readable Gear ID: GEAR-001.
  function formatId(id) { return 'GEAR-' + String(id).padStart(3, '0'); }

  // A Gear item's stat bonuses as [{ key, short, value }], non-zero only, in
  // STATS order: what a Gear line shows.
  function statLines(stats) {
    var out = [];
    STATS.forEach(function (s) {
      var v = Number(stats && stats[s.key]) || 0;
      if (v) out.push({ key: s.key, short: s.short, value: v });
    });
    return out;
  }

  var config = Object.freeze({
    SLOTS: SLOTS,
    STATS: STATS,
    CATALOG: CATALOG,
    STARTER_KIT: STARTER_KIT,
    byId: byId,
    isSlot: isSlot,
    formatId: formatId,
    statLines: statLines,
  });

  if (typeof module === 'object' && module.exports) module.exports = config;
  else root.HOMESTEAD_GEAR_CONFIG = config;
})(typeof window !== 'undefined' ? window : this);
