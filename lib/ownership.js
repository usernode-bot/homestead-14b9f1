// HOMESTEAD ownership cap: the one place the per-wallet Creature limit lives.
//
// A wallet holds at most MAX_OWNED_CREATURES (public/js/config.js): the
// Creatures it owns now (creatures.owner, whoever created them) plus its
// Seeds not yet awakened (each already holds the place its Creature will
// take, so an Awaken never needs refusing). There is no global cap.
//
// Every system that gives a wallet a Creature or a Seed must, inside its own
// transaction: lockWallet, then assertRoom, then write. Genesis does
// (lib/genesis.js). A future Marketplace must move a Creature only through
// transferCreature, inside its sale transaction: a listed Creature keeps its
// owner (so it still counts for the seller) until the sale completes, and a
// buyer already at the limit is refused with nothing changed.
//
// A wallet over the limit (it got there before the limit existed) keeps
// every Creature: nothing here ever takes one away. It is only refused when
// it tries to gain more.
const { MAX_OWNED_CREATURES } = require('../public/js/config');

class OwnershipError extends Error {
  constructor(code, message, status) {
    super(message);
    this.code = code;
    this.status = status || 400;
  }
}

const FULL_MESSAGE = 'Collection Full. You own ' + MAX_OWNED_CREATURES + ' Creatures, the most one wallet can hold.';

// Serialize every change to this wallet's holdings until the transaction
// ends. db must be a client inside a transaction.
async function lockWallet(db, wallet) {
  await db.query("SELECT pg_advisory_xact_lock(hashtext('homestead-wallet:' || $1))", [String(wallet)]);
}

// What this wallet holds now. db may be the pool or a client.
async function ownedCount(db, wallet) {
  const { rows } = await db.query(
    `SELECT (SELECT COUNT(*) FROM creatures WHERE owner = $1)::int AS creatures,
            (SELECT COUNT(*) FROM seeds WHERE owner = $1 AND creature_id IS NULL)::int AS dormant`,
    [wallet]
  );
  const creatures = rows[0].creatures;
  const dormantSeeds = rows[0].dormant;
  return { owned: creatures + dormantSeeds, creatures, dormantSeeds, max: MAX_OWNED_CREATURES };
}

// Refuse when the wallet has no room for one more. Call it while holding
// lockWallet for that wallet, so no other transaction can take the place
// between this check and the write.
async function assertRoom(db, wallet) {
  const count = await ownedCount(db, wallet);
  if (count.owned >= count.max) throw new OwnershipError('collection_full', FULL_MESSAGE, 409);
  return count;
}

// Move one Creature from one wallet to another, inside the caller's
// transaction (a completed Marketplace sale). Refused, changing nothing, when
// the seller doesn't own it or the buyer has no room. Only `owner` changes:
// the Creature's identity, its creation history and both wallets' Genesis
// records stay as they are.
async function transferCreature(db, creatureId, fromWallet, toWallet) {
  if (!fromWallet || !toWallet) throw new OwnershipError('no_wallet', 'Both wallets are needed.');
  if (fromWallet === toWallet) throw new OwnershipError('same_wallet', 'That Creature is already yours.');
  // Both wallets, always in the same order, so two transfers never deadlock.
  for (const w of [fromWallet, toWallet].sort()) await lockWallet(db, w);
  const { rows } = await db.query('SELECT id, owner FROM creatures WHERE id = $1 FOR UPDATE', [creatureId]);
  if (!rows[0]) throw new OwnershipError('not_found', 'No Creature has that ID.', 404);
  if (rows[0].owner !== fromWallet) throw new OwnershipError('not_yours', 'The seller no longer owns that Creature.', 409);
  await assertRoom(db, toWallet);
  await db.query('UPDATE creatures SET owner = $2 WHERE id = $1', [creatureId, toWallet]);
  return { creatureId, from: fromWallet, to: toWallet };
}

module.exports = { OwnershipError, FULL_MESSAGE, lockWallet, ownedCount, assertRoom, transferCreature };
