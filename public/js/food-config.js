// HOMESTEAD Marketplace food configuration: the one place food rules and
// balance live.
//
// Loaded by the page (window.HOMESTEAD_FOOD_CONFIG) AND by the server
// (require('./public/js/food-config')), so both read the same values and work
// out a food's effect the same way.
//
// Foods are bought with STEAD in the Marketplace (lib/marketplace.js) and fed
// to a Creature from its profile (lib/care.js). Every food only acts on
// Hunger, the one care stat a Creature has: no food changes base stats,
// training or Level. There is no randomness in buying or feeding.
//
// PROVISIONAL: the names, prices and effects below are a first draft and will
// be replaced when the full food details arrive. Change them only here.
(function (root) {
  var care = typeof module === 'object' && module.exports
    ? require('./care-config')
    : root.HOMESTEAD_CARE_CONFIG;

  // effect: restore adds that much Hunger; fill fills Hunger to HUNGER_MAX;
  // holdHours (with fill) keeps it there that long before Hunger starts to
  // drop again.
  var FOODS = Object.freeze([
    { id: 'grub-snack', name: 'Grub Snack', price: 10, description: '+40 Hunger.', effect: Object.freeze({ restore: 40 }) },
    { id: 'monster-meal', name: 'Monster Meal', price: 25, description: 'Fills Hunger to 100.', effect: Object.freeze({ fill: true }) },
    { id: 'punk-feast', name: 'Punk Feast', price: 60, description: 'Fills Hunger to 100, then no Hunger is lost for 24 hours.', effect: Object.freeze({ fill: true, holdHours: 24 }) },
  ].map(Object.freeze));

  // The most of one food a wallet can hold.
  var MAX_OWNED_PER_FOOD = 99;

  function food(id) {
    return FOODS.find(function (f) { return f.id === id; }) || null;
  }

  // What feeding `f` to a Creature whose current Hunger is `hungerBefore`
  // stores at `now`: { hunger, since }. A hold stores full Hunger as of a
  // moment holdHours ahead, so care-config.js currentHunger counts no loss
  // until then (it treats a moment still to come as no time passed).
  function applyFood(hungerBefore, f, now) {
    var e = f.effect;
    var hunger = e.fill ? care.HUNGER_MAX : care.clampHunger(Number(hungerBefore) + (Number(e.restore) || 0));
    var since = new Date(new Date(now).getTime() + (Number(e.holdHours) || 0) * 3600000);
    return { hunger: hunger, since: since };
  }

  var config = Object.freeze({
    FOODS: FOODS,
    MAX_OWNED_PER_FOOD: MAX_OWNED_PER_FOOD,
    food: food,
    applyFood: applyFood,
  });

  if (typeof module === 'object' && module.exports) module.exports = config;
  else root.HOMESTEAD_FOOD_CONFIG = config;
})(typeof window !== 'undefined' ? window : this);
