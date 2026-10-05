// Shared test helpers. Not a test file itself (npm test runs *.test.js).
const crypto = require('crypto');
const genesis = require('../lib/genesis');
const stead = require('../lib/stead');
const { GENESIS_COST } = require('../public/js/config');

// Genesis costs STEAD: pay this wallet exactly that (a keyed test credit),
// then use Genesis. Answers what genesis.mint answers.
async function fundAndMint(pool, wallet, user, opts) {
  await stead.creditStead(pool, wallet, GENESIS_COST, 'DAILY_CHECKIN', { test: true }, { key: 'TEST-GENESIS-' + crypto.randomUUID() });
  return genesis.mint(pool, wallet, user, opts);
}

module.exports = { fundAndMint };
