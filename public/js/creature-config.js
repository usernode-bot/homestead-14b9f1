// HOMESTEAD Creature configuration: every Creature rule and balance value.
//
// Loaded by the page (<script src="/js/creature-config.js">, as
// window.HOMESTEAD_CREATURE_CONFIG) AND by the server
// (require('./public/js/creature-config')). The server's generator
// (lib/creature-generator.js) rolls a Creature from these tables exactly once,
// at Awaken; the page only looks values up here to label and draw them.
// Rebalance here, never in a screen. The supply cap stays in config.js.
//
// Stored values are the `id`s below. Never rename an id once Creatures carry
// it: change the `label` instead.
(function (root) {
  // Base stats, rolled once at Awaken. Future Training and Gear add bonuses
  // on top; they never replace these.
  var STATS = [
    { key: 'hp', label: 'HP' },
    { key: 'attack', label: 'Attack' },
    { key: 'defense', label: 'Defense' },
    { key: 'speed', label: 'Speed' },
    { key: 'luck', label: 'Luck' },
  ];
  // Each stat rolls between min and max, then adds the Species bias and the
  // rarity bonus. `cap` is the most it can ever start at (for stat bars).
  var STAT_RANGES = {
    hp: { min: 50, max: 100, cap: 140 },
    attack: { min: 20, max: 70, cap: 110 },
    defense: { min: 20, max: 70, cap: 110 },
    speed: { min: 20, max: 70, cap: 110 },
    luck: { min: 10, max: 60, cap: 100 },
  };

  var START_LEVEL = 1;

  // An individual Creature name: see creature-name.js for the validator.
  var NAME_RULES = { min: 2, max: 20 };

  // Names a Creature can be given when it awakens. Add freely; every entry
  // must pass the name validator (a test checks).
  var NAME_POOL = [
    'Bruno', 'Momo', 'Grit', 'Bobo', 'Zuzu', 'Nox', 'Pip', 'Rocco', 'Kiki',
    'Muck', 'Tobi', 'Gogo', 'Wally', 'Dodo', 'Ziggy', 'Bix', 'Luma', 'Taco',
    'Pebble', 'Nibs', 'Fritz', 'Olo', 'Bunk', 'Gus', 'Mimi', 'Rufus', 'Sprocket',
    'Tilly', 'Wonk', 'Yoyo', 'Zed', 'Boop', 'Clem', 'Dottie', 'Fig', 'Grub',
    'Hank', 'Inky', 'Jojo', 'Kip', 'Lolo', 'Mango', 'Nugget', 'Opal', 'Pogs',
    'Quill', 'Rumble', 'Sid', 'Tuff', 'Ulf', 'Vex', 'Wiggs', 'Yuki', 'Zappa',
    'Bambi', 'Chonk', 'Dash', 'Echo', 'Fuzz', 'Gizmo', 'Huck', 'Iggy', 'Juno',
    'Kos', 'Lug', 'Mox', 'Noodle', 'Ozzy', 'Pudge', 'Rook', 'Scrap', 'Tank',
  ];

  // Colours a Creature can be drawn in. Each name is a CSS colour token,
  // --art-<name>, defined in styles/tailwind-input.css.
  var ART_COLORS = [
    'slime', 'toxic', 'mint', 'teal', 'sky', 'cobalt', 'grape', 'lilac',
    'bubblegum', 'coral', 'tangerine', 'lemon', 'rust', 'bone', 'ash',
  ];
  // Bright colours for irises, stickers and patches.
  var BRIGHT_COLORS = ['toxic', 'bubblegum', 'lemon', 'sky', 'tangerine', 'mint', 'coral'];
  // Punk clothing: mostly black leather, sometimes not.
  var CLOTHING_COLORS = ['ink', 'ink', 'ink', 'cobalt', 'grape', 'rust', 'ash'];

  // The original HOMESTEAD Species. `head` and `body` name shapes the
  // drawing (creature-art.js) knows; `skins` and `hairs` are ART_COLORS;
  // `statBias` shifts the base stat rolls; `geneCode` starts the Gene.
  var SPECIES = [
    { id: 'gloop', label: 'Gloop', geneCode: 'GLOOP', head: 'drop', body: 'round',
      skins: ['slime', 'mint', 'toxic'], hairs: ['bubblegum', 'grape', 'lemon'],
      statBias: { hp: 10, speed: -5 }, blurb: 'Drips a little when it gets excited.' },
    { id: 'snagg', label: 'Snagg', geneCode: 'SNAGG', head: 'square', body: 'stubby',
      skins: ['ash', 'cobalt', 'rust'], hairs: ['toxic', 'tangerine', 'bubblegum'],
      statBias: { defense: 10, luck: -5 }, blurb: 'Square jaw, big underbite, bigger heart.' },
    { id: 'mossling', label: 'Mossling', geneCode: 'MOSSL', head: 'fuzzy', body: 'round',
      skins: ['slime', 'teal', 'mint'], hairs: ['lemon', 'coral', 'bubblegum'],
      statBias: { hp: 5, luck: 5, speed: -5 }, blurb: 'A fuzzy puff that hums when it naps.' },
    { id: 'pogo', label: 'Pogo', geneCode: 'POGO', head: 'bean', body: 'tall',
      skins: ['tangerine', 'lemon', 'coral'], hairs: ['cobalt', 'grape', 'toxic'],
      statBias: { speed: 10, defense: -5 }, blurb: 'Cannot sit still. Will not sit still.' },
    { id: 'wispo', label: 'Wispo', geneCode: 'WISPO', head: 'ghost', body: 'tall',
      skins: ['lilac', 'bone', 'sky'], hairs: ['bubblegum', 'toxic', 'grape'],
      statBias: { luck: 10, hp: -5 }, blurb: 'Floats around corners nobody else can see.' },
    { id: 'boggle', label: 'Boggle', geneCode: 'BOGGL', head: 'wide', body: 'stubby',
      skins: ['teal', 'slime', 'grape'], hairs: ['tangerine', 'lemon', 'bubblegum'],
      statBias: { hp: 5, defense: 5, speed: -5 }, blurb: 'Wide grin, wide eyes, wide opinions.' },
    { id: 'krank', label: 'Krank', geneCode: 'KRANK', head: 'hex', body: 'stubby',
      skins: ['ash', 'sky', 'cobalt'], hairs: ['coral', 'toxic', 'lemon'],
      statBias: { attack: 5, defense: 5, luck: -5 }, blurb: 'Clicks and whirs like a wind-up toy.' },
    { id: 'grubbo', label: 'Grubbo', geneCode: 'GRUBB', head: 'round', body: 'round',
      skins: ['coral', 'bubblegum', 'lemon'], hairs: ['cobalt', 'toxic', 'grape'],
      statBias: { hp: 10, attack: -5 }, blurb: 'Round, squishy and always a bit peckish.' },
    { id: 'bramblet', label: 'Bramblet', geneCode: 'BRMBL', head: 'cloud', body: 'stubby',
      skins: ['grape', 'rust', 'slime'], hairs: ['toxic', 'lemon', 'bubblegum'],
      statBias: { attack: 10, hp: -5 }, blurb: 'Prickly outside, extremely huggable inside.' },
    { id: 'rootle', label: 'Rootle', geneCode: 'ROOTL', head: 'onion', body: 'tall',
      skins: ['lilac', 'bubblegum', 'tangerine'], hairs: ['slime', 'toxic', 'teal'],
      statBias: { luck: 5, speed: 5, defense: -5 }, blurb: 'Sprouted overnight and never stopped growing.' },
  ];

  // Rarity tiers, Common to Omega. `weight` is the generation weight (the
  // chance is weight / sum of weights). `statBonus` adds to every base stat.
  // `unlocks` lists the visual traits a tier ADDS: a Creature can use its own
  // tier's traits and every lower tier's, and leans toward its own
  // (UNLOCK_BIAS), so higher tiers really look different. `palette` says
  // where colours come from: 'species' (its Species' colours), 'clash' (any
  // hair colour), 'wild' (any skin and hair) or 'void' (a dark body with a
  // neon outline). `mutation` gives the chance of none and the mutations the
  // tier can roll. `visual` is how the tier is presented.
  var RARITIES = [
    { id: 'common', label: 'Common', weight: 50, statBonus: 0, palette: 'species',
      unlocks: {
        silhouettes: [], eyes: ['two', 'one', 'sleepy'], mouths: ['grin', 'smile', 'fang'],
        hair: ['mohawk', 'messy', 'buzz'], horns: ['none', 'nubs', 'ears'],
        clothing: ['none', 'tee'], accessories: ['none', 'earring', 'nosering'], markings: ['none'],
      },
      mutation: { noneChance: 0.7, pool: ['spikes', 'patches', 'tail'] },
      visual: { background: 'plain', frameClass: 'border-line', badgeClass: 'border border-line text-muted' } },
    { id: 'uncommon', label: 'Uncommon', weight: 25, statBonus: 4, palette: 'species',
      unlocks: {
        silhouettes: [], eyes: ['angry'], mouths: ['teeth', 'zigzag'],
        hair: ['spikes', 'double'], horns: ['floppy', 'antenna'],
        clothing: ['vest'], accessories: ['chain', 'pin'], markings: ['star', 'x'],
      },
      mutation: { noneChance: 0.55, pool: ['horns', 'fangs'] },
      visual: { background: 'dots', frameClass: 'border-line', badgeClass: 'border border-line text-fg' } },
    { id: 'rare', label: 'Rare', weight: 13, statBonus: 8, palette: 'clash',
      unlocks: {
        silhouettes: [], eyes: ['visor'], mouths: ['tongue'],
        hair: ['liberty'], horns: ['devil'],
        clothing: ['jacket'], accessories: ['collar', 'shades'], markings: ['bolt'],
      },
      mutation: { noneChance: 0.4, pool: ['extra-eye'] },
      visual: { background: 'stripes', frameClass: 'border-fg/40', badgeClass: 'border border-fg text-fg' } },
    { id: 'epic', label: 'Epic', weight: 7, statBonus: 12, palette: 'wild',
      unlocks: {
        silhouettes: ['gem'], eyes: ['spiral'], mouths: [],
        hair: ['flame'], horns: ['ram'],
        clothing: ['studded'], accessories: ['lipring'], markings: [],
      },
      mutation: { noneChance: 0.25, pool: ['glowing-mark'] },
      visual: { background: 'burst', frameClass: 'border-punk/60', badgeClass: 'border border-punk text-punk' } },
    { id: 'legendary', label: 'Legendary', weight: 4, statBonus: 18, palette: 'wild',
      unlocks: {
        silhouettes: ['lobed'], eyes: ['three'], mouths: [],
        hair: ['halo'], horns: ['quad'],
        clothing: ['spiked'], accessories: [], markings: ['crack'],
      },
      mutation: { noneChance: 0.1, pool: [] },
      visual: { background: 'sparkle', frameClass: 'border-punk', badgeClass: 'bg-punk text-ground' } },
    { id: 'omega', label: 'Omega', weight: 1, statBonus: 25, palette: 'void',
      unlocks: {
        silhouettes: ['jagged'], eyes: ['star'], mouths: [],
        hair: ['storm'], horns: [],
        clothing: [], accessories: ['halo'], markings: [],
      },
      mutation: { noneChance: 0, pool: [] },
      visual: { background: 'glitch', frameClass: 'border-fg', badgeClass: 'bg-fg text-ground' } },
  ];
  // How often a Creature picks from its own tier's new traits rather than
  // everything it has unlocked. `silhouette` is the chance an Epic or higher
  // swaps its Species head for an unusual one.
  var UNLOCK_BIAS = { trait: 0.6, silhouette: 0.5 };

  // Mutations, one per Creature at most. `weight` is relative among the
  // mutations a rarity can roll: rarer mutations weigh less.
  var MUTATIONS = [
    { id: 'none', label: 'None', weight: 0 },
    { id: 'spikes', label: 'Spikes', weight: 20 },
    { id: 'patches', label: 'Patches', weight: 20 },
    { id: 'tail', label: 'Tail', weight: 18 },
    { id: 'horns', label: 'Horns', weight: 14 },
    { id: 'fangs', label: 'Fangs', weight: 12 },
    { id: 'extra-eye', label: 'Extra Eye', weight: 8 },
    { id: 'glowing-mark', label: 'Glowing Mark', weight: 4 },
  ];

  // One permanent personality. No gameplay effect yet.
  var PERSONALITIES = [
    { id: 'lazy', label: 'Lazy' },
    { id: 'brave', label: 'Brave' },
    { id: 'greedy', label: 'Greedy' },
    { id: 'curious', label: 'Curious' },
    { id: 'grumpy', label: 'Grumpy' },
    { id: 'loyal', label: 'Loyal' },
    { id: 'chaotic', label: 'Chaotic' },
    { id: 'calm', label: 'Calm' },
    { id: 'reckless', label: 'Reckless' },
    { id: 'sneaky', label: 'Sneaky' },
  ];

  // A Creature's specialization (not the Marketplace). Work is not built yet.
  var TRADES = [
    { id: 'farmer', label: 'Farmer' },
    { id: 'miner', label: 'Miner' },
    { id: 'lumberjack', label: 'Lumberjack' },
    { id: 'fisher', label: 'Fisher' },
    { id: 'smith', label: 'Smith' },
    { id: 'mystic', label: 'Mystic' },
  ];

  function byId(list, id) {
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  var config = Object.freeze({
    STATS: STATS,
    STAT_RANGES: STAT_RANGES,
    START_LEVEL: START_LEVEL,
    NAME_RULES: NAME_RULES,
    NAME_POOL: NAME_POOL,
    ART_COLORS: ART_COLORS,
    BRIGHT_COLORS: BRIGHT_COLORS,
    CLOTHING_COLORS: CLOTHING_COLORS,
    SPECIES: SPECIES,
    RARITIES: RARITIES,
    UNLOCK_BIAS: UNLOCK_BIAS,
    MUTATIONS: MUTATIONS,
    PERSONALITIES: PERSONALITIES,
    TRADES: TRADES,
    byId: byId,
  });

  if (typeof module === 'object' && module.exports) module.exports = config;
  else root.HOMESTEAD_CREATURE_CONFIG = config;
})(typeof window !== 'undefined' ? window : this);
