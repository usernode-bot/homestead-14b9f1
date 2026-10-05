// HOMESTEAD Contests configuration: the one place their rules and balance
// live.
//
// Loaded by the page (window.HOMESTEAD_CONTEST_CONFIG) AND by the server
// (require('./public/js/contest-config')), so both read the same values. The
// server alone resolves a Contest (lib/contests.js); the page only shows what
// it stored.
//
// A Contest is head-to-head play between two DIFFERENT players, each with one
// of their own Creatures. Homeroom apps may not show combat or violence, so a
// Contest is a trick-off: the Creatures take turns showing off a trick, and
// the rival spends Stamina keeping up. The first to run out of Stamina loses.
// Nobody is hurt, nothing is permanent: Stamina exists only inside the
// Contest, and a Creature's stats, ownership and Gear never change.
//
// The stats are the Creature's effective stats (care-config.js effectiveStat:
// base + training + Gear + traits), saved once in a snapshot when the
// challenge is accepted:
// - HP is the Contest Stamina.
// - Speed decides who goes first.
// - Each trick scores max(1, Attack - rival Defense) points, times the
//   trickster's condition multiplier, which come off the rival's Stamina.
// - Luck is the chance of a show-stopper (a critical trick).
(function (root) {
  // A challenge waits this long for an answer, then expires.
  var CHALLENGE_EXPIRES_HOURS = 24;
  // How long a Contest runs once it is accepted. Both Creatures are locked to
  // it until then (no Work, Training, Gear changes or other Contests); then
  // it is resolved from the snapshots, once.
  var CONTEST_DURATION_SECONDS = 60;

  // How well a Creature performs in each condition (care-config.js CONDITIONS).
  // Never changes the Creature: it only scales its points in this Contest.
  var CONDITION_MULTIPLIER = Object.freeze({ GOOD: 1.0, FAIR: 0.85, POOR: 0.6 });

  // Show-stoppers: chance = Luck x CRIT_RATE, never above MAX_CRIT_CHANCE;
  // a show-stopper scores CRIT_MULTIPLIER times the points.
  var CRIT_RATE = 0.01;
  var MAX_CRIT_CHANCE = 0.25;
  var CRIT_MULTIPLIER = 1.5;

  // Points can never go below this, whatever the stats.
  var MIN_POINTS = 1;
  // A safety stop: no Contest runs longer than this many tricks. With at
  // least 1 point a trick it never comes close.
  var MAX_TURNS = 500;

  // STEAD paid when a Contest is resolved (lib/stead.js, type CONTEST_REWARD),
  // once per Contest and wallet.
  var WIN_REWARD = 25;
  var LOSS_REWARD = 5;

  // How many finished Contests Contest history shows. Older ones are kept.
  var HISTORY_LIMIT = 20;

  var CHALLENGE_STATUSES = Object.freeze(['PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'CANCELLED']);
  var CONTEST_STATUSES = Object.freeze(['PENDING', 'ACTIVE', 'COMPLETED', 'CANCELLED']);

  function conditionMultiplier(condition) {
    return Object.prototype.hasOwnProperty.call(CONDITION_MULTIPLIER, condition)
      ? CONDITION_MULTIPLIER[condition] : CONDITION_MULTIPLIER.GOOD;
  }

  // The one rounding rule for points: round down to a whole number, never
  // below MIN_POINTS. The tiny epsilon keeps 20 x 0.85 at 17, not 16.
  function roundPoints(x) {
    return Math.max(MIN_POINTS, Math.floor(Number(x) + 1e-9));
  }

  function critChance(luck) {
    return Math.max(0, Math.min(MAX_CRIT_CHANCE, (Number(luck) || 0) * CRIT_RATE));
  }

  // Points one trick scores. `performer` and `rival` are snapshots
  // ({ effectiveStats, condition }).
  function trickPoints(performer, rival, crit) {
    var base = Math.max(MIN_POINTS, performer.effectiveStats.attack - rival.effectiveStats.defense);
    return roundPoints(base * conditionMultiplier(performer.condition) * (crit ? CRIT_MULTIPLIER : 1));
  }

  // Who goes first: 'a' or 'b'. Higher Speed; on equal Speed higher Luck;
  // then the lower Creature ID. Never decided by the page.
  function firstMover(a, b) {
    var sa = a.effectiveStats.speed, sb = b.effectiveStats.speed;
    if (sa !== sb) return sa > sb ? 'a' : 'b';
    var la = a.effectiveStats.luck, lb = b.effectiveStats.luck;
    if (la !== lb) return la > lb ? 'a' : 'b';
    return a.creatureId < b.creatureId ? 'a' : 'b';
  }

  // "CONTEST-101": a Contest's id as the STEAD ledger records it.
  function formatId(id) { return 'CONTEST-' + String(id).padStart(3, '0'); }

  var config = Object.freeze({
    CHALLENGE_EXPIRES_HOURS: CHALLENGE_EXPIRES_HOURS,
    CONTEST_DURATION_SECONDS: CONTEST_DURATION_SECONDS,
    CONDITION_MULTIPLIER: CONDITION_MULTIPLIER,
    CRIT_RATE: CRIT_RATE,
    MAX_CRIT_CHANCE: MAX_CRIT_CHANCE,
    CRIT_MULTIPLIER: CRIT_MULTIPLIER,
    MIN_POINTS: MIN_POINTS,
    MAX_TURNS: MAX_TURNS,
    WIN_REWARD: WIN_REWARD,
    LOSS_REWARD: LOSS_REWARD,
    HISTORY_LIMIT: HISTORY_LIMIT,
    CHALLENGE_STATUSES: CHALLENGE_STATUSES,
    CONTEST_STATUSES: CONTEST_STATUSES,
    conditionMultiplier: conditionMultiplier,
    roundPoints: roundPoints,
    critChance: critChance,
    trickPoints: trickPoints,
    firstMover: firstMover,
    formatId: formatId,
  });

  if (typeof module === 'object' && module.exports) module.exports = config;
  else root.HOMESTEAD_CONTEST_CONFIG = config;
})(typeof window !== 'undefined' ? window : this);
