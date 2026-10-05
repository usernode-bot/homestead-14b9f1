// HOMESTEAD STEAD Points configuration: the one place economy rules live.
//
// Loaded by the page (window.HOMESTEAD_STEAD_CONFIG) AND by the server
// (require('./public/js/stead-config')), so both read the same values.
//
// STEAD Points ("STEAD" in the UI) are HOMESTEAD's one internal gameplay
// currency. They are not a token, not crypto and not money, and nothing about
// them is on-chain. Every change is a ledger entry (lib/stead.js): income is a
// positive amount, an expense a negative one, and a balance never goes below 0.
// Work produces Resources, never STEAD.
(function (root) {
  // The short name shown everywhere.
  var NAME = 'STEAD';
  var LONG_NAME = 'STEAD Points';

  // The one game timezone every calendar day is counted in. A day is a date
  // here, never "24 hours since the last claim", and it is always worked out
  // on the server from the request's time, never from the browser's clock.
  var GAME_TIMEZONE = 'UTC';

  // Daily Check-in: the STEAD paid for each day of the 7-day cycle, Day 1
  // first. After Day 7 the cycle starts again at Day 1; a missed day also
  // starts again at Day 1.
  var CHECKIN_REWARDS = Object.freeze([100, 120, 150, 180, 220, 250, 500]);

  // Every kind of ledger entry. direction says whether it adds STEAD
  // ('credit') or takes it ('debit'). Only active types can be recorded;
  // the others are reserved for the systems that will spend STEAD. Training
  // (lib/care.js) is the first one that does.
  var TYPES = Object.freeze({
    DAILY_CHECKIN: Object.freeze({ label: 'Daily Check-in', direction: 'credit', active: true }),
    TRAINING: Object.freeze({ label: 'Training', direction: 'debit', active: true }),
    FEEDING: Object.freeze({ label: 'Feeding', direction: 'debit', active: false }),
    GEAR: Object.freeze({ label: 'Gear', direction: 'debit', active: false }),
    UPGRADE: Object.freeze({ label: 'Homestead Upgrade', direction: 'debit', active: false }),
    MARKETPLACE_FEE: Object.freeze({ label: 'Marketplace Fee', direction: 'debit', active: false }),
    BREEDING: Object.freeze({ label: 'Breeding', direction: 'debit', active: false }),
  });

  // How many ledger entries STEAD History shows.
  var HISTORY_LIMIT = 30;

  function type(id) {
    return Object.prototype.hasOwnProperty.call(TYPES, id) ? TYPES[id] : null;
  }

  // The cycle length (7) and the reward for a cycle day, 1-based.
  function cycleLength() { return CHECKIN_REWARDS.length; }
  function rewardFor(cycleDay) {
    return CHECKIN_REWARDS[(Math.max(1, cycleDay) - 1) % CHECKIN_REWARDS.length];
  }
  // The cycle day after this one: 7 -> 1.
  function nextCycleDay(cycleDay) {
    return cycleDay >= CHECKIN_REWARDS.length ? 1 : cycleDay + 1;
  }

  // The calendar date of `date` in the game timezone, as YYYY-MM-DD.
  var dayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: GAME_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' });
  function dayKey(date) {
    var parts = {};
    dayFormat.formatToParts(date).forEach(function (p) { parts[p.type] = p.value; });
    return parts.year + '-' + parts.month + '-' + parts.day;
  }
  // The YYYY-MM-DD date `days` after (or before) another one.
  function addDays(key, days) {
    var d = new Date(key + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }

  // "1,240" and "+100" / "-50".
  function format(n) { return Number(n).toLocaleString('en-US'); }
  function formatSigned(n) { return (n > 0 ? '+' : n < 0 ? '-' : '') + format(Math.abs(n)); }

  var config = Object.freeze({
    NAME: NAME,
    LONG_NAME: LONG_NAME,
    GAME_TIMEZONE: GAME_TIMEZONE,
    CHECKIN_REWARDS: CHECKIN_REWARDS,
    TYPES: TYPES,
    HISTORY_LIMIT: HISTORY_LIMIT,
    type: type,
    cycleLength: cycleLength,
    rewardFor: rewardFor,
    nextCycleDay: nextCycleDay,
    dayKey: dayKey,
    addDays: addDays,
    format: format,
    formatSigned: formatSigned,
  });

  if (typeof module === 'object' && module.exports) module.exports = config;
  else root.HOMESTEAD_STEAD_CONFIG = config;
})(typeof window !== 'undefined' ? window : this);
