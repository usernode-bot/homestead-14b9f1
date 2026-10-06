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
//
// Players also sell each other the Resources their Creatures brought home
// from Work (market_listings; rules in public/js/market-config.js):
// - Listing is ONE transaction under a lock on the seller's Homestead: the
//   Resources leave its storage and sit on the listing until it is sold or
//   cancelled, so a listing can always be delivered. A listing is the whole
//   lot at one price in STEAD.
// - A listing moves once, from active to sold or cancelled (a trigger), and
//   what it sells, for how much and by whom never change.
// - Buying is ONE transaction under a lock on the listing, then the buyer's
//   Homestead, then both STEAD accounts (in a fixed order): the buyer can't be
//   the seller, needs room in storage and enough STEAD. debitStead takes the
//   price from the buyer (RESOURCE_PURCHASE) and creditStead pays the seller
//   the same (RESOURCE_SALE), both keyed LISTING-<id>, so a listing pays out
//   once however many taps or tabs arrive. Anything refused changes nothing.
// - Cancelling returns the Resources to the seller's storage, which needs
//   room for them. Only the seller can cancel, and only an unsold listing.
const cfg = require('../public/js/food-config');
const mcfg = require('../public/js/market-config');
const hcfg = require('../public/js/homestead-config');
const stead = require('./stead');
const homestead = require('./homestead');
const { inTransaction } = homestead;

class MarketplaceError extends Error {
  constructor(code, message, status) {
    super(message);
    this.code = code;
    this.status = status || 400;
  }
}

const LEDGER_TYPE = 'MARKETPLACE_PURCHASE';
const BUY_TYPE = 'RESOURCE_PURCHASE';
const SALE_TYPE = 'RESOURCE_SALE';

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

    CREATE TABLE IF NOT EXISTS market_listings (
      id SERIAL PRIMARY KEY,
      seller TEXT NOT NULL,
      seller_name TEXT,
      resource TEXT NOT NULL,
      quantity INT NOT NULL CHECK (quantity >= 1),
      price BIGINT NOT NULL CHECK (price >= 1),
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'sold', 'cancelled')),
      buyer TEXT,
      buyer_name TEXT,
      request_key TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      closed_at TIMESTAMPTZ,
      CONSTRAINT market_listings_buyer_when_sold CHECK ((status = 'sold') = (buyer IS NOT NULL)),
      CONSTRAINT market_listings_closed_at CHECK ((status = 'active') = (closed_at IS NULL)),
      CONSTRAINT market_listings_not_own CHECK (buyer IS NULL OR buyer <> seller)
    );
    ALTER TABLE market_listings DROP CONSTRAINT IF EXISTS market_listings_values;
    ALTER TABLE market_listings ADD CONSTRAINT market_listings_values CHECK (
      resource IN (${sqlList(hcfg.RESOURCES.map((r) => r.key))})
      AND price <= ${Number(mcfg.MAX_PRICE)}
    );
    CREATE UNIQUE INDEX IF NOT EXISTS market_listings_once_per_key
      ON market_listings (seller, request_key) WHERE request_key IS NOT NULL;
    CREATE INDEX IF NOT EXISTS market_listings_active ON market_listings (id DESC) WHERE status = 'active';
    CREATE INDEX IF NOT EXISTS market_listings_by_seller ON market_listings (seller, id DESC);

    CREATE OR REPLACE FUNCTION market_listing_rules() RETURNS trigger AS $$
    BEGIN
      IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'A listing can never be removed'; END IF;
      IF NEW.id IS DISTINCT FROM OLD.id OR NEW.seller IS DISTINCT FROM OLD.seller
         OR NEW.seller_name IS DISTINCT FROM OLD.seller_name OR NEW.resource IS DISTINCT FROM OLD.resource
         OR NEW.quantity IS DISTINCT FROM OLD.quantity OR NEW.price IS DISTINCT FROM OLD.price
         OR NEW.request_key IS DISTINCT FROM OLD.request_key OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
        RAISE EXCEPTION 'What a listing sells, its price and its seller can never change';
      END IF;
      IF OLD.status <> 'active' AND (NEW.status IS DISTINCT FROM OLD.status OR NEW.buyer IS DISTINCT FROM OLD.buyer
         OR NEW.buyer_name IS DISTINCT FROM OLD.buyer_name OR NEW.closed_at IS DISTINCT FROM OLD.closed_at) THEN
        RAISE EXCEPTION 'A sold or cancelled listing can never change';
      END IF;
      RETURN NEW;
    END $$ LANGUAGE plpgsql;
    DROP TRIGGER IF EXISTS market_listing_rules ON market_listings;
    CREATE TRIGGER market_listing_rules BEFORE UPDATE OR DELETE ON market_listings
      FOR EACH ROW EXECUTE FUNCTION market_listing_rules();
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

function resourceLabel(key) {
  const r = hcfg.RESOURCES.find((x) => x.key === key);
  return r ? r.label : key;
}

function toListing(row) {
  return {
    listingId: row.id,
    seller: row.seller,
    sellerName: row.seller_name || null,
    resource: row.resource,
    label: resourceLabel(row.resource),
    quantity: row.quantity,
    price: Number(row.price),
    status: row.status,
    buyer: row.buyer || null,
    buyerName: row.buyer_name || null,
    createdAt: row.created_at,
    closedAt: row.closed_at,
  };
}

// This wallet's storage as the sell form needs it, or null with no Homestead.
async function ownStorage(db, owner) {
  if (!owner) return null;
  const { rows } = await db.query('SELECT storage, storage_capacity FROM homesteads WHERE owner = $1', [owner]);
  if (!rows[0]) return null;
  const h = homestead.toHomestead(Object.assign({ id: 0, owner, level: 1 }, rows[0]), []);
  return { storage: h.storage, used: h.storageUsed, capacity: h.storageCapacity };
}

// Active listings for sale (other wallets' only, when there is a wallet), and
// this wallet's own: everything still up, then the latest sold or cancelled.
async function readListings(db, owner) {
  const forSale = await db.query(
    `SELECT * FROM market_listings WHERE status = 'active' AND ($1::text IS NULL OR seller <> $1)
     ORDER BY id DESC LIMIT $2`,
    [owner || null, mcfg.LISTINGS_SHOWN]
  );
  let mine = [];
  if (owner) {
    const active = await db.query("SELECT * FROM market_listings WHERE seller = $1 AND status = 'active' ORDER BY id DESC", [owner]);
    const closed = await db.query(
      "SELECT * FROM market_listings WHERE seller = $1 AND status <> 'active' ORDER BY closed_at DESC, id DESC LIMIT $2",
      [owner, mcfg.HISTORY_SHOWN]
    );
    mine = active.rows.concat(closed.rows).map(toListing);
  }
  return { listings: forSale.rows.map(toListing), myListings: mine };
}

// Everything the Marketplace shows. No wallet: the catalog and what is for
// sale.
async function getState(db, owner) {
  const listed = await readListings(db, owner);
  return {
    walletId: owner || null,
    foods: cfg.FOODS,
    owned: await ownedFood(db, owner),
    steadBalance: owner ? await stead.getSteadBalance(db, owner) : null,
    listings: listed.listings,
    myListings: listed.myListings,
    storage: await ownStorage(db, owner),
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

// A Homestead's storage as a full { key: amount } object, and its free room.
function storageOf(row) {
  const storage = hcfg.emptyStorage();
  for (const r of hcfg.RESOURCES) storage[r.key] = Number(row.storage && row.storage[r.key]) || 0;
  return { storage, free: Math.max(0, row.storage_capacity - hcfg.storageUsed(storage)) };
}

async function lockHomestead(db, owner) {
  const { rows } = await db.query('SELECT id, storage, storage_capacity FROM homesteads WHERE owner = $1 FOR UPDATE', [owner]);
  return rows[0] || null;
}

async function lockListing(db, listingId) {
  const id = Number(listingId);
  if (!Number.isInteger(id) || id < 1) throw new MarketplaceError('listing_missing', 'That listing doesn\'t exist.', 404);
  const { rows } = await db.query('SELECT * FROM market_listings WHERE id = $1 FOR UPDATE', [id]);
  if (!rows[0]) throw new MarketplaceError('listing_missing', 'That listing doesn\'t exist.', 404);
  return rows[0];
}

// "1,000,000".
function fmt(n) { return Number(n).toLocaleString('en-US'); }

function cleanName(name) {
  return name ? String(name).slice(0, 64) : null;
}

// List `quantity` of a Resource from this wallet's storage for `price` STEAD.
// requestId (once per tap) makes a retried request list nothing twice.
async function createListing(pool, owner, username, input, now) {
  if (!owner) throw new MarketplaceError('no_wallet', 'Link a wallet to your Homeroom account first.');
  const resource = String((input && input.resource) || '');
  if (!hcfg.RESOURCES.some((r) => r.key === resource)) throw new MarketplaceError('bad_resource', 'Choose a Resource to sell.');
  const quantity = Number(input.quantity);
  if (!mcfg.validQuantity(quantity)) throw new MarketplaceError('bad_quantity', 'Enter how many to sell, a whole number from 1.');
  const price = Number(input.price);
  if (!mcfg.validPrice(price)) throw new MarketplaceError('bad_price', 'Enter a price from 1 to ' + fmt(mcfg.MAX_PRICE) + ' STEAD.');
  const key = requestKey(input.requestId);
  return inTransaction(pool, async (db) => {
    const home = await lockHomestead(db, owner);
    if (!home) throw new MarketplaceError('no_homestead', 'You have no Resources to sell yet. Send a Creature to work first.', 409);
    if (key) {
      const done = await db.query('SELECT id FROM market_listings WHERE seller = $1 AND request_key = $2', [owner, key]);
      if (done.rows.length) return Object.assign(await getState(db, owner), { listed: null, replayed: true });
    }
    const active = await db.query("SELECT COUNT(*)::int AS n FROM market_listings WHERE seller = $1 AND status = 'active'", [owner]);
    if (active.rows[0].n >= mcfg.MAX_ACTIVE_LISTINGS) {
      throw new MarketplaceError('max_listings', 'You can have ' + mcfg.MAX_ACTIVE_LISTINGS + ' listings up at once. Cancel one or wait for a sale.', 409);
    }
    const { storage } = storageOf(home);
    if (storage[resource] < quantity) {
      throw new MarketplaceError('not_enough_resource', 'You have ' + storage[resource] + ' ' + resourceLabel(resource) + '.', 409);
    }
    storage[resource] -= quantity;
    await db.query('UPDATE homesteads SET storage = $2 WHERE id = $1', [home.id, JSON.stringify(storage)]);
    const ins = await db.query(
      `INSERT INTO market_listings (seller, seller_name, resource, quantity, price, request_key, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [owner, cleanName(username), resource, quantity, price, key, now]
    );
    return Object.assign(await getState(db, owner), { listed: toListing(ins.rows[0]), replayed: false });
  });
}

// Buy a whole listing for this wallet, at `now`.
async function buyListing(pool, owner, username, listingId, now) {
  if (!owner) throw new MarketplaceError('no_wallet', 'Link a wallet to your Homeroom account first.');
  // A wallet that owns a Creature but never opened its Homestead gets one
  // now, the same way opening it does, so bought Resources have a home.
  await homestead.open(pool, owner, now);
  return inTransaction(pool, async (db) => {
    const row = await lockListing(db, listingId);
    if (row.seller === owner) throw new MarketplaceError('own_listing', 'This is your own listing.', 409);
    // The same tap again, after it went through.
    if (row.status === 'sold' && row.buyer === owner) return Object.assign(await getState(db, owner), { boughtListing: null, replayed: true });
    if (row.status === 'sold') throw new MarketplaceError('already_sold', 'Someone else bought this listing first.', 409);
    if (row.status === 'cancelled') throw new MarketplaceError('listing_cancelled', 'The seller took this listing down.', 409);
    const home = await lockHomestead(db, owner);
    if (!home) throw new MarketplaceError('no_homestead', 'You need a Homestead to keep Resources. Awaken a Creature first.', 409);
    const { storage, free } = storageOf(home);
    if (free < row.quantity) {
      throw new MarketplaceError('no_room', 'Your storage has room for ' + free + ' more. Make room for ' + row.quantity + ' first.', 409);
    }
    const price = Number(row.price);
    // Both STEAD accounts, always in the same order, so two players buying
    // from each other at once wait for each other instead of deadlocking.
    const pair = [owner, row.seller].sort();
    await db.query('INSERT INTO stead_accounts (owner) VALUES ($1), ($2) ON CONFLICT (owner) DO NOTHING', pair);
    await db.query('SELECT owner FROM stead_accounts WHERE owner = ANY($1) ORDER BY owner FOR UPDATE', [pair]);
    const meta = { listingId: row.id, resource: row.resource, quantity: row.quantity };
    try {
      await stead.debitStead(db, owner, price, BUY_TYPE, Object.assign({ seller: row.seller }, meta), { key: 'LISTING-' + row.id });
    } catch (err) {
      if (err.code === 'insufficient_stead') throw new MarketplaceError('not_enough_stead', 'Need ' + fmt(price) + ' STEAD.', 409);
      throw err;
    }
    await stead.creditStead(db, row.seller, price, SALE_TYPE, Object.assign({ buyer: owner }, meta), { key: 'LISTING-' + row.id });
    storage[row.resource] += row.quantity;
    await db.query('UPDATE homesteads SET storage = $2 WHERE id = $1', [home.id, JSON.stringify(storage)]);
    const sold = await db.query(
      "UPDATE market_listings SET status = 'sold', buyer = $2, buyer_name = $3, closed_at = $4 WHERE id = $1 RETURNING *",
      [row.id, owner, cleanName(username), now]
    );
    return Object.assign(await getState(db, owner), { boughtListing: toListing(sold.rows[0]), replayed: false });
  });
}

// Take this wallet's unsold listing down: its Resources go back to storage.
async function cancelListing(pool, owner, listingId, now) {
  if (!owner) throw new MarketplaceError('no_wallet', 'Link a wallet to your Homeroom account first.');
  return inTransaction(pool, async (db) => {
    const row = await lockListing(db, listingId);
    if (row.seller !== owner) throw new MarketplaceError('not_your_listing', 'Only the seller can cancel a listing.', 403);
    if (row.status === 'cancelled') return Object.assign(await getState(db, owner), { cancelled: null, replayed: true });
    if (row.status === 'sold') throw new MarketplaceError('already_sold', 'This listing already sold.', 409);
    const home = await lockHomestead(db, owner);
    const { storage, free } = storageOf(home);
    if (free < row.quantity) {
      throw new MarketplaceError('no_room', 'Your storage has room for ' + free + ' more. Make room for ' + row.quantity + ' first.', 409);
    }
    storage[row.resource] += row.quantity;
    await db.query('UPDATE homesteads SET storage = $2 WHERE id = $1', [home.id, JSON.stringify(storage)]);
    const done = await db.query("UPDATE market_listings SET status = 'cancelled', closed_at = $2 WHERE id = $1 RETURNING *", [row.id, now]);
    return Object.assign(await getState(db, owner), { cancelled: toListing(done.rows[0]), replayed: false });
  });
}

module.exports = { MarketplaceError, ensureSchema, getState, ownedFood, buy, createListing, buyListing, cancelListing };
