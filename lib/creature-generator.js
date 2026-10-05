// HOMESTEAD Creature generator: rolls everything a Creature is, from the
// tables in public/js/creature-config.js.
//
// Called exactly once per Creature, inside the Awaken transaction
// (lib/genesis.js), and the result is stored. Nothing ever calls it to
// render: the page draws what was stored.
//
// `rng` is a function returning a float in [0, 1). New Creatures use
// cryptoRng; seededRng exists so that filling in a Creature awakened before
// this generator existed gives the same result wherever it runs.
const crypto = require('crypto');
const cfg = require('../public/js/creature-config');

function cryptoRng() {
  return crypto.randomBytes(4).readUInt32BE(0) / 4294967296;
}

// mulberry32 over a string hash: the same text always gives the same rolls.
function seededRng(text) {
  let h = 1779033703 ^ text.length;
  for (let i = 0; i < text.length; i++) {
    h = Math.imul(h ^ text.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(rng, list) {
  return list[Math.floor(rng() * list.length)];
}

function weighted(rng, list) {
  const total = list.reduce((sum, item) => sum + item.weight, 0);
  let roll = rng() * total;
  for (const item of list) {
    roll -= item.weight;
    if (roll < 0) return item;
  }
  return list[list.length - 1];
}

function randInt(rng, min, max) {
  return min + Math.floor(rng() * (max - min + 1));
}

// A trait from this rarity's unlocks, leaning toward the tier's own new ones.
function pickTrait(rng, tierIndex, category) {
  const own = cfg.RARITIES[tierIndex].unlocks[category];
  const all = [];
  for (let i = 0; i <= tierIndex; i++) all.push(...cfg.RARITIES[i].unlocks[category]);
  if (tierIndex > 0 && own.length && rng() < cfg.UNLOCK_BIAS.trait) return pick(rng, own);
  return pick(rng, all);
}

function rollMutation(rng, tierIndex) {
  const rarity = cfg.RARITIES[tierIndex];
  if (rng() < rarity.mutation.noneChance) return 'none';
  const allowed = new Set();
  for (let i = 0; i <= tierIndex; i++) cfg.RARITIES[i].mutation.pool.forEach((m) => allowed.add(m));
  const options = cfg.MUTATIONS.filter((m) => allowed.has(m.id) && m.weight > 0);
  return options.length ? weighted(rng, options).id : 'none';
}

function rollStats(rng, species, rarity) {
  const stats = {};
  for (const { key } of cfg.STATS) {
    const range = cfg.STAT_RANGES[key];
    const value = randInt(rng, range.min, range.max) + (species.statBias[key] || 0) + rarity.statBonus;
    stats[key] = Math.max(1, Math.min(range.cap, value));
  }
  return stats;
}

const SHADELESS_EYES = new Set(['visor', 'three', 'star']);

function rollAppearance(rng, species, tierIndex, mutation) {
  const rarity = cfg.RARITIES[tierIndex];
  const anyColor = cfg.ART_COLORS.filter((c) => c !== 'bone' && c !== 'ash');
  const exotic = [];
  for (let i = 0; i <= tierIndex; i++) exotic.push(...cfg.RARITIES[i].unlocks.silhouettes);
  const head = exotic.length && rng() < cfg.UNLOCK_BIAS.silhouette ? pick(rng, exotic) : species.head;
  const palette = rarity.palette;
  const eyes = pickTrait(rng, tierIndex, 'eyes');
  let accessory = pickTrait(rng, tierIndex, 'accessories');
  // Shades only fit over a plain pair (or one) of eyes.
  if (accessory === 'shades' && SHADELESS_EYES.has(eyes)) accessory = 'earring';
  return {
    v: 1,
    background: rarity.visual.background,
    head,
    body: species.body,
    skin: palette === 'void' ? 'void' : pick(rng, palette === 'wild' ? anyColor : species.skins),
    outline: palette === 'void' ? 'neon' : 'ink',
    hair: pickTrait(rng, tierIndex, 'hair'),
    hairColor: pick(rng, palette === 'species' ? species.hairs : anyColor),
    eyes,
    eyeColor: pick(rng, cfg.BRIGHT_COLORS),
    mouth: pickTrait(rng, tierIndex, 'mouths'),
    horns: pickTrait(rng, tierIndex, 'horns'),
    clothing: pickTrait(rng, tierIndex, 'clothing'),
    clothingColor: pick(rng, cfg.CLOTHING_COLORS),
    accessory,
    marking: pickTrait(rng, tierIndex, 'markings'),
    markColor: pick(rng, cfg.BRIGHT_COLORS),
    mutation,
  };
}

// Everything but the Gene's uniqueness, which needs the database
// (see creatures.uniqueGene). Returns plain values, ready to store.
function generate(rng) {
  const species = pick(rng, cfg.SPECIES);
  const rarity = weighted(rng, cfg.RARITIES);
  const tierIndex = cfg.RARITIES.indexOf(rarity);
  const mutation = rollMutation(rng, tierIndex);
  return {
    name: pick(rng, cfg.NAME_POOL),
    species: species.id,
    rarity: rarity.id,
    level: cfg.START_LEVEL,
    stats: rollStats(rng, species, rarity),
    personality: pick(rng, cfg.PERSONALITIES).id,
    mutation,
    trade: pick(rng, cfg.TRADES).id,
    appearance: rollAppearance(rng, species, tierIndex, mutation),
  };
}

// A Gene candidate: the Species code and four hex digits, GLOOP-7F2A.
function geneCandidate(rng, speciesId) {
  const species = cfg.byId(cfg.SPECIES, speciesId);
  const hex = Math.floor(rng() * 65536).toString(16).toUpperCase().padStart(4, '0');
  return species.geneCode + '-' + hex;
}

module.exports = { generate, geneCandidate, cryptoRng, seededRng };
