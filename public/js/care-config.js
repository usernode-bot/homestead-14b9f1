// HOMESTEAD Feeding + Training configuration: the one place their rules and
// balance live.
//
// Loaded by the page (window.HOMESTEAD_CARE_CONFIG) AND by the server
// (require('./public/js/care-config')), so both read the same values and run
// the same calculations: current hunger, hunger state, condition, Work
// efficiency (and its rounding) and effective stats.
//
// Hunger is never counted down by a timer. A Creature stores its hunger as of
// a moment (hunger_updated_at), and its hunger at any later moment is worked
// out from the time since then, so it goes on while nobody has the app open.
// Hunger never hurts a Creature: at 0 it is STARVING, and that is all.
(function (root) {
  var HUNGER_MAX = 100;
  // How much hunger a Creature loses each hour (from full to 0 in 50 hours).
  var HUNGER_LOSS_PER_HOUR = 2;

  // Feeding: what one feed costs (Fodder, from the Homestead's storage) and
  // how much hunger it gives back. Never above HUNGER_MAX.
  var FEED_RESOURCE = 'fodder';
  var FEED_FODDER_COST = 1;
  var FEED_HUNGER_RESTORE = 25;

  // Hunger states, highest first: a Creature is in the first one whose min
  // its current hunger reaches.
  var HUNGER_STATES = Object.freeze([
    Object.freeze({ id: 'WELL_FED', label: 'WELL FED', min: 80 }),
    Object.freeze({ id: 'HUNGRY', label: 'HUNGRY', min: 30 }),
    Object.freeze({ id: 'STARVING', label: 'STARVING', min: 0 }),
  ]);

  // Condition. For now it follows the hunger state; it is its own value so it
  // can grow other causes later without touching hunger.
  var CONDITIONS = Object.freeze([
    Object.freeze({ id: 'GOOD', label: 'GOOD' }),
    Object.freeze({ id: 'FAIR', label: 'FAIR' }),
    Object.freeze({ id: 'POOR', label: 'POOR' }),
  ]);
  var CONDITION_BY_HUNGER_STATE = Object.freeze({ WELL_FED: 'GOOD', HUNGRY: 'FAIR', STARVING: 'POOR' });

  // Work efficiency by hunger state: the share of its rolled Resources a Work
  // brings home. Applied to Resource output only (Work never pays STEAD).
  var WORK_EFFICIENCY = Object.freeze({ WELL_FED: 1.0, HUNGRY: 0.85, STARVING: 0.6 });

  // Training: what one session costs in STEAD and what it adds to one stat.
  var TRAINING_COST = 10;
  var TRAINING_AMOUNT = 1;
  var MAX_TRAINING_BONUS = 50;
  // The stats that can be trained (creature-config.js STATS keys).
  var TRAINABLE_STATS = Object.freeze(['hp', 'attack', 'defense', 'speed', 'luck']);

  function clampHunger(n) {
    return Math.max(0, Math.min(HUNGER_MAX, n));
  }

  // Hunger at `now` for hunger `stored` as of `since` (a Date or ISO time).
  // A whole number, never below 0. A `now` before `since` (a preview shown as
  // of an earlier moment) counts as no time passed.
  function currentHunger(stored, since, now) {
    var from = new Date(since).getTime();
    var to = new Date(now).getTime();
    var hours = isFinite(from) && isFinite(to) ? Math.max(0, (to - from) / 3600000) : 0;
    return clampHunger(Math.ceil(Number(stored) - hours * HUNGER_LOSS_PER_HOUR));
  }

  // The stored form of hunger at `now`: the current whole value and the exact
  // moment hunger reached it, so saving it never slows the loss down (saving
  // "99 as of now" every few minutes would otherwise keep it at 99 forever).
  function settleHunger(stored, since, now) {
    var hunger = currentHunger(stored, since, now);
    var from = new Date(since).getTime();
    var to = new Date(now).getTime();
    if (!isFinite(from) || to <= from) return { hunger: hunger, since: new Date(isFinite(from) ? from : to) };
    var reached = hunger > 0 ? from + ((Number(stored) - hunger) / HUNGER_LOSS_PER_HOUR) * 3600000 : to;
    return { hunger: hunger, since: new Date(Math.min(to, Math.max(from, reached))) };
  }

  function hungerState(hunger) {
    for (var i = 0; i < HUNGER_STATES.length; i++) {
      if (hunger >= HUNGER_STATES[i].min) return HUNGER_STATES[i];
    }
    return HUNGER_STATES[HUNGER_STATES.length - 1];
  }

  function condition(hunger) {
    var id = CONDITION_BY_HUNGER_STATE[hungerState(hunger).id];
    return CONDITIONS.find(function (c) { return c.id === id; });
  }

  function efficiency(hunger) {
    return WORK_EFFICIENCY[hungerState(hunger).id];
  }

  // The one rounding rule for Resource output: round down to a whole amount
  // (10 Wood at 85% is 8). The tiny epsilon keeps 10 x 0.6 at 6, not 5.
  function applyEfficiency(amount, eff) {
    return Math.max(0, Math.floor(Number(amount) * eff + 1e-9));
  }

  // Bonuses from systems that do not exist yet. Gear and Traits will return
  // their own per-stat bonuses here; until then they add nothing.
  function gearBonus(/* creature, statKey */) { return 0; }
  function traitBonus(/* creature, statKey */) { return 0; }

  // The one effective-stat calculation: base + training + gear + traits.
  // `creature` has stats (base) and trainingBonus.
  function effectiveStat(creature, key) {
    var base = Number(creature && creature.stats && creature.stats[key]) || 0;
    var training = Number(creature && creature.trainingBonus && creature.trainingBonus[key]) || 0;
    return base + training + gearBonus(creature, key) + traitBonus(creature, key);
  }

  function effectiveStats(creature) {
    var out = {};
    TRAINABLE_STATS.forEach(function (key) { out[key] = effectiveStat(creature, key); });
    return out;
  }

  function isTrainable(key) {
    return TRAINABLE_STATS.indexOf(key) !== -1;
  }

  var config = Object.freeze({
    HUNGER_MAX: HUNGER_MAX,
    HUNGER_LOSS_PER_HOUR: HUNGER_LOSS_PER_HOUR,
    FEED_RESOURCE: FEED_RESOURCE,
    FEED_FODDER_COST: FEED_FODDER_COST,
    FEED_HUNGER_RESTORE: FEED_HUNGER_RESTORE,
    HUNGER_STATES: HUNGER_STATES,
    CONDITIONS: CONDITIONS,
    WORK_EFFICIENCY: WORK_EFFICIENCY,
    TRAINING_COST: TRAINING_COST,
    TRAINING_AMOUNT: TRAINING_AMOUNT,
    MAX_TRAINING_BONUS: MAX_TRAINING_BONUS,
    TRAINABLE_STATS: TRAINABLE_STATS,
    clampHunger: clampHunger,
    currentHunger: currentHunger,
    settleHunger: settleHunger,
    hungerState: hungerState,
    condition: condition,
    efficiency: efficiency,
    applyEfficiency: applyEfficiency,
    effectiveStat: effectiveStat,
    effectiveStats: effectiveStats,
    isTrainable: isTrainable,
  });

  if (typeof module === 'object' && module.exports) module.exports = config;
  else root.HOMESTEAD_CARE_CONFIG = config;
})(typeof window !== 'undefined' ? window : this);
