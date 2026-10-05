// HOMESTEAD Work configuration: the one place Work rules and balance live.
//
// Loaded by the page (window.HOMESTEAD_WORK_CONFIG) AND by the server
// (require('./public/js/work-config')), so both read the same values.
//
// Creature -> Trade -> Work -> Building -> Resources. A Creature only works at
// the building of its own Trade, for one of the DURATIONS, and brings home the
// resources its Trade produces. Rewards are rolled once, on the server, when
// the Work is complete (lib/work.js). Work never produces HOME Points and
// never changes the Creature.
(function (root) {
  // How long a Creature can be sent to work. id is what the server stores.
  var DURATIONS = Object.freeze([
    { id: '1h', hours: 1, label: '1 HOUR' },
    { id: '4h', hours: 4, label: '4 HOURS' },
    { id: '8h', hours: 8, label: '8 HOURS' },
  ].map(Object.freeze));

  // Each Trade (creature-config.js TRADES ids) works at one building
  // (homestead-config.js BUILDINGS ids) and produces these resources
  // (homestead-config.js RESOURCES keys), each a [min, max] range PER HOUR.
  // Initial balancing values only. verb/doing/done are the words shown.
  var TRADES = Object.freeze({
    farmer: { building: 'barn', doing: 'Farming', done: 'farming', perHour: { grain: [8, 16], fodder: [3, 8] } },
    miner: { building: 'mine', doing: 'Mining', done: 'mining', perHour: { stone: [12, 24], ore: [4, 10], crystal: [0, 1] } },
    lumberjack: { building: 'lumber-camp', doing: 'Chopping wood', done: 'chopping wood', perHour: { wood: [10, 22], hardwood: [2, 6] } },
    fisher: { building: 'fishing-hut', doing: 'Fishing', done: 'fishing', perHour: { fish: [8, 18], rareFish: [0, 2] } },
    smith: { building: 'workshop', doing: 'Crafting', done: 'crafting', perHour: { parts: [4, 10] } },
    mystic: { building: 'mystic-shrine', doing: 'Channeling', done: 'channeling', perHour: { essence: [3, 8], rune: [0, 2] } },
  });

  // How many finished Work entries the history shows.
  var HISTORY_LIMIT = 20;

  // The groups the Resources inventory shows (homestead-config.js RESOURCES
  // keys, in order).
  var RESOURCE_GROUPS = Object.freeze([
    { id: 'food', label: 'Food', keys: ['grain', 'fodder'] },
    { id: 'materials', label: 'Materials', keys: ['wood', 'hardwood', 'stone', 'ore', 'crystal'] },
    { id: 'other', label: 'Other', keys: ['fish', 'rareFish', 'parts', 'essence', 'rune'] },
  ].map(Object.freeze));

  function duration(id) {
    return DURATIONS.find(function (d) { return d.id === id; }) || null;
  }

  function trade(id) {
    return Object.prototype.hasOwnProperty.call(TRADES, id) ? TRADES[id] : null;
  }

  // The one building a Trade works at, or null.
  function buildingFor(tradeId) {
    var t = trade(tradeId);
    return t ? t.building : null;
  }

  // "4h", "1h 30m", "25m", "Under a minute" for a span in milliseconds.
  function formatSpan(ms) {
    var mins = Math.max(0, Math.ceil(Number(ms) / 60000));
    if (mins < 1) return 'Under a minute';
    var h = Math.floor(mins / 60);
    var m = mins % 60;
    return h ? h + 'h' + (m ? ' ' + m + 'm' : '') : m + 'm';
  }

  var config = Object.freeze({
    DURATIONS: DURATIONS,
    TRADES: TRADES,
    HISTORY_LIMIT: HISTORY_LIMIT,
    RESOURCE_GROUPS: RESOURCE_GROUPS,
    duration: duration,
    trade: trade,
    buildingFor: buildingFor,
    formatSpan: formatSpan,
  });

  if (typeof module === 'object' && module.exports) module.exports = config;
  else root.HOMESTEAD_WORK_CONFIG = config;
})(typeof window !== 'undefined' ? window : this);
