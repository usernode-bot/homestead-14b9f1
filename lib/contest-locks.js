// HOMESTEAD Contest locks: the one question other systems ask about Contests.
//
// While a Contest runs, both of its Creatures are locked to it
// (contest_creature_locks, one row per Creature: the primary key is what
// keeps a Creature out of two Contests at once). A locked Creature cannot
// start Work, train or change its Gear, so nothing can change the stats its
// Contest was snapshotted with. Once the Contest's time is up the lock no
// longer holds: its result comes from the snapshot, whatever happens next.
//
// Kept apart from lib/contests.js so Work, Training and Gear can ask without
// depending on it. The tables are created by contests.ensureSchema.

// The Contest this Creature is locked to at `now` ({ contestId, endsAt }), or
// null. db may be the pool or a client inside a transaction.
async function lockedContest(db, creatureId, now) {
  const { rows } = await db.query(
    `SELECT c.id, c.ends_at FROM contest_creature_locks l JOIN contests c ON c.id = l.contest_id
     WHERE l.creature_id = $1 AND c.status = 'ACTIVE' AND c.ends_at > $2`,
    [creatureId, now || new Date()]
  );
  return rows[0] ? { contestId: rows[0].id, endsAt: new Date(rows[0].ends_at).toISOString() } : null;
}

const IN_CONTEST_MESSAGE = 'Creature is already in a contest.';

module.exports = { lockedContest, IN_CONTEST_MESSAGE };
