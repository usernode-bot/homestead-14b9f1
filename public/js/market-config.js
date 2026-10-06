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
// fee and no randomness. Creatures, Gear and food are not sold here.
(function (root) {
  // The most listings one wallet can have up for sale at once.
  var MAX_ACTIVE_LISTINGS = 10;
  // The highest price a listing can ask, in STEAD (for the whole listing).
  var MAX_PRICE = 1000000;
  // How many listings the Marketplace shows for sale, newest first.
  var LISTINGS_SHOWN = 50;
  // How many of this wallet's sold and cancelled listings it shows.
  var HISTORY_SHOWN = 10;

  // Whole numbers only: a quantity from 1 up, a price from 1 to MAX_PRICE.
  function validQuantity(n) { return Number.isSafeInteger(n) && n >= 1; }
  function validPrice(n) { return Number.isSafeInteger(n) && n >= 1 && n <= MAX_PRICE; }

  var config = Object.freeze({
    MAX_ACTIVE_LISTINGS: MAX_ACTIVE_LISTINGS,
    MAX_PRICE: MAX_PRICE,
    LISTINGS_SHOWN: LISTINGS_SHOWN,
    HISTORY_SHOWN: HISTORY_SHOWN,
    validQuantity: validQuantity,
    validPrice: validPrice,
  });

  if (typeof module === 'object' && module.exports) module.exports = config;
  else root.HOMESTEAD_MARKET_CONFIG = config;
})(typeof window !== 'undefined' ? window : this);
