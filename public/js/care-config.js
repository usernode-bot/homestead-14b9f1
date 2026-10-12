// HOMESTEAD Feeding + Training configuration: the one place their rules and
// balance live.
//
// Loaded by the page (window.HOMESTEAD_CARE_CONFIG) AND by the server
// (require('./public/js/care-config')), so both read the same values and run
// the same calculations: current hunger, hunger state, condition, Work
// efficiency (and its rounding), effective stats, and what Training costs
// and the Level it reaches. The page loads it after homestead-config.js and
// work-config.js, which it reads.
//
// Hunger is never counted down by a timer. A Creature stores its hunger as of
// a moment (hunger_updated_at), and its hunger at any later moment is worked
// out from the time since then, so it goes on while nobody has the app open.
// Hunger never hurts a Creature: at 0 it is STARVING, and that is all.
(function (root) {
  var node = typeof module === 'object' && module.exports;
  var work = node ? require('./work-config') : root.HOMESTEAD_WORK_CONFIG;
  var home = node ? require('./homestead-config') : root.HOMESTEAD_HOMESTEAD_CONFIG;

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

  // Training: what one session adds to one stat.
  var TRAINING_AMOUNT = 1;
  var MAX_TRAINING_BONUS = 50;
  // The stats that can be trained (creature-config.js STATS keys).
  var TRAINABLE_STATS = Object.freeze(['hp', 'attack', 'defense', 'speed', 'luck']);

  // What one session costs: STEAD plus Resources from the Homestead's
  // storage, both rising with the Creature's Level (trainingCost).
  // PROVISIONAL balance: change it only here.
  var TRAINING_STEAD_BASE = 10;
  var TRAINING_STEAD_PER_LEVEL = 5;
  // Each of a stat's two main Resources.
  var TRAINING_MAIN_BASE = 2;
  var TRAINING_MAIN_PER_LEVEL = 2;
  var TRAINING_MAIN_MAX = 40;
  // Its rare Resource: 1 from TRAINING_RARE_FROM_LEVEL, one more every
  // TRAINING_RARE_EVERY Levels, never above TRAINING_RARE_MAX. At the caps one
  // session takes 40 + 40 + 5 Resources, which fits the default storage (100).
  var TRAINING_RARE_FROM_LEVEL = 5;
  var TRAINING_RARE_EVERY = 5;
  var TRAINING_RARE_MAX = 5;
  // Resources the Creature's own Trade brings home from Work cost this share
  // less (rounded up, at least 1).
  var TRADE_DISCOUNT = 0.25;
  // Every this many training points across all stats raise the Level by 1.
  var TRAININGS_PER_LEVEL = 5;
  var START_LEVEL = 1;
  var MAX_LEVEL = START_LEVEL + Math.floor(TRAINABLE_STATS.length * MAX_TRAINING_BONUS / TRAININGS_PER_LEVEL);

  // Which Resources (homestead-config.js RESOURCES keys) each stat's training
  // uses. Together they use every Resource every Trade brings home (a test
  // checks), so no Creature trains everything from its own Work alone.
  var TRAINING_RECIPES = Object.freeze({
    hp: Object.freeze({ main: Object.freeze(['grain', 'fodder']), rare: 'rareFish' }),
    attack: Object.freeze({ main: Object.freeze(['ore', 'stone']), rare: 'crystal' }),
    defense: Object.freeze({ main: Object.freeze(['wood', 'stone']), rare: 'hardwood' }),
    speed: Object.freeze({ main: Object.freeze(['fish', 'parts']), rare: 'rareFish' }),
    luck: Object.freeze({ main: Object.freeze(['essence', 'grain']), rare: 'rune' }),
  });

  function clampHunger(n) {
    return Math.max(0, Math.min(HUNGER_MAX, n));
  }

  // Hunger at `now` for hunger `stored` as of `since` (a Date or ISO time).
  // A whole number, never below 0. A `now` before `since` counts as no time
  // passed: a preview shown as of an earlier moment, or a food's hold
  // (food-config.js), which stores full Hunger as of a moment still to come.
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

  // What the Creature's equipped Gear adds to one stat: the sum of that stat
  // over every item in creature.gear ({ tool, accessory }, each a Gear item
  // or null; lib/gear.js shape). No Gear adds 0.
  function gearBonus(creature, key) {
    var gear = creature && creature.gear;
    if (!gear) return 0;
    var sum = 0;
    Object.keys(gear).forEach(function (slot) {
      var item = gear[slot];
      sum += Number(item && item.stats && item.stats[key]) || 0;
    });
    return sum;
  }
  // Traits do not exist yet: they add nothing.
  function traitBonus(/* creature, statKey */) { return 0; }

  function gearBonuses(creature) {
    var out = {};
    TRAINABLE_STATS.forEach(function (key) { out[key] = gearBonus(creature, key); });
    return out;
  }

  // The one effective-stat calculation: base + training + gear + traits.
  // `creature` has stats (base), trainingBonus and gear. Base stats and
  // training bonuses are only read, never changed, by Gear.
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

  function resourceLabel(key) {
    var r = home.RESOURCES.find(function (x) { return x.key === key; });
    return r ? r.label : key;
  }

  // The Level a Creature with these training bonuses has reached.
  function levelFor(trainingBonus) {
    var total = TRAINABLE_STATS.reduce(function (sum, k) {
      return sum + (Number(trainingBonus && trainingBonus[k]) || 0);
    }, 0);
    return START_LEVEL + Math.floor(total / TRAININGS_PER_LEVEL);
  }

  // What one session training `stat` costs a Creature at `level` whose Trade
  // is `tradeId`: { stead, resources: [{ key, label, amount, discounted }] },
  // main Resources first, then the rare one once the Level asks for it.
  function trainingCost(level, stat, tradeId) {
    var lv = Math.max(START_LEVEL, Math.floor(Number(level) || START_LEVEL));
    var recipe = TRAINING_RECIPES[stat];
    if (!recipe) return null;
    var main = Math.min(TRAINING_MAIN_MAX, TRAINING_MAIN_BASE + TRAINING_MAIN_PER_LEVEL * (lv - 1));
    var rare = lv < TRAINING_RARE_FROM_LEVEL ? 0
      : Math.min(TRAINING_RARE_MAX, 1 + Math.floor((lv - TRAINING_RARE_FROM_LEVEL) / TRAINING_RARE_EVERY));
    var t = work.trade(tradeId);
    var own = t ? t.perHour : {};
    var parts = recipe.main.map(function (k) { return [k, main]; });
    if (rare) parts.push([recipe.rare, rare]);
    return {
      stead: TRAINING_STEAD_BASE + TRAINING_STEAD_PER_LEVEL * (lv - 1),
      resources: parts.map(function (p) {
        var discounted = Object.prototype.hasOwnProperty.call(own, p[0]);
        var amount = discounted ? Math.max(1, Math.ceil(p[1] * (1 - TRADE_DISCOUNT) - 1e-9)) : p[1];
        return { key: p[0], label: resourceLabel(p[0]), amount: amount, discounted: discounted };
      }),
    };
  }

  // What is missing to pay `cost` from `storage` (Resource key -> amount) and
  // a STEAD balance: { stead: STEAD short (0 if enough), resources: [{ key,
  // label, need, have }] for each Resource there is too little of }.
  function shortfall(cost, storage, steadBalance) {
    return {
      stead: Math.max(0, cost.stead - (Number(steadBalance) || 0)),
      resources: cost.resources.map(function (r) {
        return { key: r.key, label: r.label, need: r.amount, have: Number(storage && storage[r.key]) || 0 };
      }).filter(function (r) { return r.have < r.need; }),
    };
  }

  // "6 more Fish and 6 more Parts" for shortfall(...).resources.
  function missingText(missing) {
    var parts = missing.map(function (m) { return (m.need - m.have) + ' more ' + m.label; });
    return parts.length > 1 ? parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1] : (parts[0] || '');
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
    TRAINING_AMOUNT: TRAINING_AMOUNT,
    MAX_TRAINING_BONUS: MAX_TRAINING_BONUS,
    TRAINABLE_STATS: TRAINABLE_STATS,
    TRAINING_STEAD_BASE: TRAINING_STEAD_BASE,
    TRAINING_STEAD_PER_LEVEL: TRAINING_STEAD_PER_LEVEL,
    TRAINING_MAIN_BASE: TRAINING_MAIN_BASE,
    TRAINING_MAIN_PER_LEVEL: TRAINING_MAIN_PER_LEVEL,
    TRAINING_MAIN_MAX: TRAINING_MAIN_MAX,
    TRAINING_RARE_FROM_LEVEL: TRAINING_RARE_FROM_LEVEL,
    TRAINING_RARE_EVERY: TRAINING_RARE_EVERY,
    TRAINING_RARE_MAX: TRAINING_RARE_MAX,
    TRADE_DISCOUNT: TRADE_DISCOUNT,
    TRAININGS_PER_LEVEL: TRAININGS_PER_LEVEL,
    START_LEVEL: START_LEVEL,
    MAX_LEVEL: MAX_LEVEL,
    TRAINING_RECIPES: TRAINING_RECIPES,
    clampHunger: clampHunger,
    currentHunger: currentHunger,
    settleHunger: settleHunger,
    hungerState: hungerState,
    condition: condition,
    efficiency: efficiency,
    applyEfficiency: applyEfficiency,
    gearBonus: gearBonus,
    gearBonuses: gearBonuses,
    effectiveStat: effectiveStat,
    effectiveStats: effectiveStats,
    isTrainable: isTrainable,
    levelFor: levelFor,
    trainingCost: trainingCost,
    shortfall: shortfall,
    missingText: missingText,
  });

  if (node) module.exports = config;
  else root.HOMESTEAD_CARE_CONFIG = config;
})(typeof window !== 'undefined' ? window : this);
