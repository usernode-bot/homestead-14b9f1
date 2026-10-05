// HOMESTEAD game configuration: the one place game-wide rules live.
//
// Loaded by the page (<script src="/js/config.js">, as window.HOMESTEAD_CONFIG)
// AND by the server (require('./public/js/config')), so both read the same
// numbers. Every system that creates, counts or displays Creatures must read
// MAX_CREATURE_SUPPLY from here; never write the number anywhere else.
(function (root) {
  var config = Object.freeze({
    // There can never be more than this many Creatures, ever.
    MAX_CREATURE_SUPPLY: 5000,
    // Each wallet will eventually get one Genesis opportunity (not built yet).
    GENESIS_PER_WALLET: 1,
  });

  if (typeof module === 'object' && module.exports) module.exports = config;
  else root.HOMESTEAD_CONFIG = config;
})(typeof window !== 'undefined' ? window : this);
