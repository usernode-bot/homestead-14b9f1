// HOMESTEAD player Marketplace configuration: the one place the rules for
// players selling Resources to each other live.
//
// Loaded by the page (window.HOMESTEAD_MARKET_CONFIG) AND by the server
// (require('./public/js/market-config')), so both read the same values.
//
// A player lists Resources their Creatures brought home from Work
// (homestead-config.js RESOURCES) for a price in STEAD. Listing takes the
// Resources out of their storage; another player buys the whole listing,
// paying the seller that price in STEAD; the seller can cancel a listing that
// hasn't sold and gets the Resources back (lib/marketplace.js). There is no
// fee and no randomness. Creatures and Gear are not sold here.
//
// The app also sells Resource packs for STEAD (PACKS): a fixed number of one
// Resource at a fixed price, one pack per purchase, at most perDay packs of a
// Resource per wallet per game day (stead-config.js GAME_TIMEZONE). Prices sit
// a little above what an hour of Work brings home, so Work and buying from
// players below the pack price stay the cheaper ways. PROVISIONAL: a first
// draft, change them only here.
(function (root) {
  // The most listings one wallet can have up for sale at once.
  var MAX_ACTIVE_LISTINGS = 10;
  // The highest price a listing can ask, in STEAD (for the whole listing).
  var MAX_PRICE = 1000000;
  // How many listings the Marketplace shows for sale, newest first.
  var LISTINGS_SHOWN = 50;
  // How many of this wallet's sold and cancelled listings it shows.
  var HISTORY_SHOWN = 10;

  // Resource packs, keyed by homestead-config.js RESOURCES key: size is how
  // many of the Resource one pack holds, price its STEAD, perDay the most
  // packs of it a wallet can buy in one game day.
  var PACKS = Object.freeze({
    grain: Object.freeze({ size: 10, price: 40, perDay: 5 }),
    fodder: Object.freeze({ size: 5, price: 45, perDay: 5 }),
    wood: Object.freeze({ size: 10, price: 30, perDay: 5 }),
    hardwood: Object.freeze({ size: 5, price: 60, perDay: 5 }),
    stone: Object.freeze({ size: 10, price: 30, perDay: 5 }),
    ore: Object.freeze({ size: 5, price: 35, perDay: 5 }),
    crystal: Object.freeze({ size: 1, price: 100, perDay: 2 }),
    fish: Object.freeze({ size: 10, price: 40, perDay: 5 }),
    rareFish: Object.freeze({ size: 1, price: 50, perDay: 2 }),
    parts: Object.freeze({ size: 5, price: 35, perDay: 5 }),
    essence: Object.freeze({ size: 5, price: 45, perDay: 5 }),
    rune: Object.freeze({ size: 1, price: 50, perDay: 2 }),
  });

  // The pack of a Resource, or null when the app doesn't sell it.
  function pack(key) {
    return Object.prototype.hasOwnProperty.call(PACKS, key) ? PACKS[key] : null;
  }

  // Whole numbers only: a quantity from 1 up, a price from 1 to MAX_PRICE.
  function validQuantity(n) { return Number.isSafeInteger(n) && n >= 1; }
  function validPrice(n) { return Number.isSafeInteger(n) && n >= 1 && n <= MAX_PRICE; }

  var config = Object.freeze({
    MAX_ACTIVE_LISTINGS: MAX_ACTIVE_LISTINGS,
    MAX_PRICE: MAX_PRICE,
    LISTINGS_SHOWN: LISTINGS_SHOWN,
    HISTORY_SHOWN: HISTORY_SHOWN,
    PACKS: PACKS,
    pack: pack,
    validQuantity: validQuantity,
    validPrice: validPrice,
  });

  if (typeof module === 'object' && module.exports) module.exports = config;
  else root.HOMESTEAD_MARKET_CONFIG = config;
})(typeof window !== 'undefined' ? window : this);
