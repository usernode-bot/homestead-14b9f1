// HOMESTEAD game configuration: the one place game-wide rules live.
//
// Loaded by the page (<script src="/js/config.js">, as window.HOMESTEAD_CONFIG)
// AND by the server (require('./public/js/config')), so both read the same
// numbers. There is no global Creature cap, and none may be added. A wallet
// owns at most MAX_OWNED_CREATURES (lib/ownership.js), and each Genesis costs
// GENESIS_COST STEAD (lib/genesis.js). Never write either number elsewhere.
(function (root) {
  var config = Object.freeze({
    // The most Creatures one wallet can hold: those it owns now plus its
    // Seeds still waiting to be awakened.
    MAX_OWNED_CREATURES: 10,
    // What one Genesis costs, in STEAD (a GENESIS ledger entry).
    GENESIS_COST: 500,
  });

  if (typeof module === 'object' && module.exports) module.exports = config;
  else root.HOMESTEAD_CONFIG = config;
})(typeof window !== 'undefined' ? window : this);
