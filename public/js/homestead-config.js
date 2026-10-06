// HOMESTEAD Homestead configuration: the one place Homestead rules live.
//
// Loaded by the page (window.HOMESTEAD_HOMESTEAD_CONFIG) AND by the server
// (require('./public/js/homestead-config')), so both read the same values.
// The server stores each Homestead's own level, capacity, buildings and
// storage; these are only the starting values and the fixed lists.
//
// Nothing here produces anything yet. Work, production, upgrades and
// building unlocks arrive in later updates and will read and raise the
// stored values (level, capacity, storage_capacity, building level/unlocked).
(function (root) {
  // Every Homestead starts here.
  var START = Object.freeze({
    level: 1,
    capacity: 1, // how many Creatures can live in it
    // Storage is unlimited in practice: a very large fixed number inside the
    // INT range that nobody will ever reach in play, and that is never shown.
    storageCapacity: 2000000000,
  });

  // The building slots every Homestead has, in display order. Each starts at
  // level 0, locked. Add a building here and every Homestead gets its slot
  // the next time its owner opens it.
  var BUILDINGS = Object.freeze([
    { id: 'barn', name: 'Barn', description: 'A place to keep food and care for your creatures.' },
    { id: 'mine', name: 'Mine', description: 'A place to dig for stone, ore, and crystals.' },
    { id: 'lumber-camp', name: 'Lumber Camp', description: 'A place to gather wood and hardwood.' },
    { id: 'fishing-hut', name: 'Fishing Hut', description: 'A place to catch fish and other strange things.' },
    { id: 'workshop', name: 'Workshop', description: 'A place to craft and improve equipment.' },
    { id: 'mystic-shrine', name: 'Mystic Shrine', description: 'A strange place for mystical creatures and rare materials.' },
  ].map(Object.freeze));
  var BUILDING_START = Object.freeze({ level: 0, unlocked: false });
  var LOCKED_NOTE = 'Requires future Homestead progression.';

  // What storage can hold. Every Homestead starts with all of them at zero;
  // their total can never pass the Homestead's storage capacity.
  var RESOURCES = Object.freeze([
    { key: 'grain', label: 'Grain' },
    { key: 'fodder', label: 'Fodder' },
    { key: 'wood', label: 'Wood' },
    { key: 'hardwood', label: 'Hardwood' },
    { key: 'stone', label: 'Stone' },
    { key: 'ore', label: 'Ore' },
    { key: 'crystal', label: 'Crystal' },
    { key: 'fish', label: 'Fish' },
    { key: 'rareFish', label: 'Rare Fish' },
    { key: 'parts', label: 'Parts' },
    { key: 'essence', label: 'Essence' },
    { key: 'rune', label: 'Rune' },
  ].map(Object.freeze));

  function emptyStorage() {
    var s = {};
    RESOURCES.forEach(function (r) { s[r.key] = 0; });
    return s;
  }

  function storageUsed(storage) {
    return RESOURCES.reduce(function (sum, r) { return sum + (Number(storage && storage[r.key]) || 0); }, 0);
  }

  // The human-readable Homestead number: #0001.
  function formatId(id) { return '#' + String(Number(id) || 0).padStart(4, '0'); }

  function building(id) {
    return BUILDINGS.find(function (b) { return b.id === id; }) || null;
  }

  var config = Object.freeze({
    START: START,
    BUILDINGS: BUILDINGS,
    BUILDING_START: BUILDING_START,
    LOCKED_NOTE: LOCKED_NOTE,
    RESOURCES: RESOURCES,
    emptyStorage: emptyStorage,
    storageUsed: storageUsed,
    formatId: formatId,
    building: building,
  });

  if (typeof module === 'object' && module.exports) module.exports = config;
  else root.HOMESTEAD_HOMESTEAD_CONFIG = config;
})(typeof window !== 'undefined' ? window : this);
