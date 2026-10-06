// HOMESTEAD Marketplace: food bought with STEAD.
//
// The catalog, prices and effects are in public/js/food-config.js; feeding a
// bought food is lib/care.js. The rules these transactions and the table
// enforce:
// - Each wallet has at most one food_inventory row per food: how many it
//   holds, never below 0 or above MAX_OWNED_PER_FOOD (a CHECK).
// - Buying is ONE transaction under a lock on that inventory row, then the
//   STEAD account (inside debitStead): check the cap, take the price through
//   debitStead (a MARKETPLACE_PURCHASE ledger entry) and add one. Too little
//   STEAD, or a full stack, is refused and nothing changes.
// - A purchase may carry a requestId the page makes once per tap. It is the
//   ledger entry's key, so a retried or duplicated request is answered with
//   the state as it is and charges nothing a second time.
// - Bought food can't be sold, given away or refunded. Creature trading is
//   not built yet.
const cfg = require('../public/js/food-config');
const stead = require('./stead');
const { inTransaction } = require('./homestead');

class MarketplaceError extends Error {
  constructor(code, message, status) {
    super(message);
    this.code = code;
    this.status = status || 400;
  }
}

const LEDGER_TYPE = 'MARKETPLACE_PURCHASE';

function sqlList(values) {
  return values.map((v) => `'${String(v).replace(/'/g, "''")}'`).join(', ');
}

async function ensureSchema(db) {
  await db.query(`
    CREATE TABLE IF NOT EXISTS food_inventory (
      owner TEXT NOT NULL,
      food_id TEXT NOT NULL,
      quantity INT NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (owner, food_id)
    );
    ALTER TABLE food_inventory DROP CONSTRAINT IF EXISTS food_inventory_values;
    ALTER TABLE food_inventory ADD CONSTRAINT food_inventory_values CHECK (
      quantity BETWEEN 0 AND ${Number(cfg.MAX_OWNED_PER_FOOD)}
      AND food_id IN (${sqlList(cfg.FOODS.map((f) => f.id))})
    );
  `);
}

// A requestId is optional; when given it is 8 to 64 letters, digits or dashes.
function requestKey(raw) {
  if (raw == null || raw === '') return null;
  const key = String(raw);
  if (!/^[A-Za-z0-9-]{8,64}$/.test(key)) throw new MarketplaceError('bad_request_id', 'That request could not be read. Try again.');
  return key;
}

// How many of each food this wallet holds: { foodId: n }, every food listed.
async function ownedFood(db, owner) {
  const owned = {};
  cfg.FOODS.forEach((f) => { owned[f.id] = 0; });
  if (!owner) return owned;
  const { rows } = await db.query('SELECT food_id, quantity FROM food_inventory WHERE owner = $1', [owner]);
  rows.forEach((r) => { if (r.food_id in owned) owned[r.food_id] = Number(r.quantity) || 0; });
  return owned;
}

// Everything the Marketplace shows. No wallet: the catalog only.
async function getState(db, owner) {
  return {
    walletId: owner || null,
    foods: cfg.FOODS,
    owned: await ownedFood(db, owner),
    steadBalance: owner ? await stead.getSteadBalance(db, owner) : null,
  };
}

function needStead(f) {
  return new MarketplaceError('not_enough_stead', 'Need ' + f.price + ' STEAD.', 409);
}

// Buy one of a food for this wallet, at `now`.
async function buy(pool, owner, foodId, rawRequestId, now) {
  if (!owner) throw new MarketplaceError('no_wallet', 'Link a wallet to your Homeroom account first.');
  const f = cfg.food(String(foodId || ''));
  if (!f) throw new MarketplaceError('bad_food', 'Choose a food to buy.');
  const key = requestKey(rawRequestId);
  return inTransaction(pool, async (db) => {
    await db.query('INSERT INTO food_inventory (owner, food_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [owner, f.id]);
    const { rows } = await db.query('SELECT quantity FROM food_inventory WHERE owner = $1 AND food_id = $2 FOR UPDATE', [owner, f.id]);
    const quantity = Number(rows[0].quantity) || 0;

    // The same tap again: it already happened (the inventory lock made it
    // wait for the first one to finish).
    if (key) {
      const done = await db.query('SELECT id FROM stead_ledger WHERE owner = $1 AND type = $2 AND entry_key = $3', [owner, LEDGER_TYPE, key]);
      if (done.rows.length) {
        return Object.assign(await getState(db, owner), { bought: null, replayed: true });
      }
    }
    if (quantity + 1 > cfg.MAX_OWNED_PER_FOOD) {
      throw new MarketplaceError('max_owned', 'You have the most you can hold.', 409);
    }
    let entry;
    try {
      entry = await stead.debitStead(db, owner, f.price, LEDGER_TYPE, { foodId: f.id, quantity: 1 }, { key });
    } catch (err) {
      if (err.code === 'insufficient_stead') throw needStead(f);
      throw err;
    }
    await db.query('UPDATE food_inventory SET quantity = quantity + 1, updated_at = $3 WHERE owner = $1 AND food_id = $2', [owner, f.id, now]);
    return Object.assign(await getState(db, owner), {
      bought: { foodId: f.id, name: f.name, price: f.price, ledgerEntryId: entry.id },
      replayed: false,
    });
  });
}

module.exports = { MarketplaceError, ensureSchema, getState, ownedFood, buy };
