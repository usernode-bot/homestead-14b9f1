# HOMESTEAD — notes for Claude Code

This app runs on **Homeroom**. If you're Claude Code
editing this repo, read the platform conventions before making
changes:

**Platform conventions (authoritative, always current):**
https://app.onhomeroom.com/claude.md

Fetch that URL at the start of each session — it's the single source
of truth for platform-wide behavior (auth model, `USERNODE_ENV`,
public/private tables, "don't `git push`", etc.). The hosted copy is
updated in place when platform rules change, so fetching it gives you
today's rules, not a stale snapshot.

When running inside Homeroom's dev-chat, those same conventions are
already injected into your system prompt, so the fetch is a no-op in
that path — but it's the right reflex when someone runs Claude Code
against this repo locally or from another harness.

## Connector permission prompts

This repo ships `.claude/settings.json`, which allows the **read-only**
Homeroom connector calls (`mcp__homeroom__get_*`,
`…__list_*`, `…__whoami`) so they stop prompting one at a time. Everything
that acts — filing a request, opening or advancing a proposal — still asks.
Claude Code applies those rules only after you accept the
workspace trust dialog, which lists them for review. See `.claude/README.md`
for the whole story, including what to do if you are still being prompted
(usually: your connector is registered under a different name than the rules
assume).

## Check that this checkout is current

You may be working in a fork of this app whose `main` is behind the app's
canonical repository, and nothing in the checkout says so: `git fetch origin`
compares the fork with itself. This matters before you **read** code to answer
a question about how the app behaves now, not only before you edit it.

The canonical repository is named in `.claude/homeroom-canonical-repo`. Check against
it, not against `origin`:

```sh
git fetch "$(cat .claude/homeroom-canonical-repo)" main
git merge-base --is-ancestor FETCH_HEAD HEAD && echo current || echo behind
```

`behind` means this checkout does not contain the canonical `main`. To answer
a question, read the canonical code instead (`git show FETCH_HEAD:<path>`,
`git grep <pattern> FETCH_HEAD`). To change code, start from the exact base
commit your Homeroom work order gives, and never merge or rebase onto the
canonical `main` yourself: which commit a change is diffed against decides
what the group votes on. With the Homeroom connector, `get_checkout_status`
answers the same question.

A session-start hook (`.claude/hooks/homeroom-freshness.sh`, see `.claude/README.md`) runs
this check for you and tells you when you are behind. It is silent offline, so
its silence is not proof the checkout is current. Inside Homeroom's dev-chat
the platform fixes the base commit, and none of this applies.

## Light and dark

HOMESTEAD has one fixed dark look (see "## Design"), so `<html>` carries the
`dark` class permanently and does not follow the viewer's Homeroom theme. Keep
the bridge `<script>` and the `usernode-dev-console@1` forwarder in
`public/index.html`: both are platform infrastructure.

If a rule below this line conflicts with the hosted conventions, the
hosted conventions win. This file is **app-specific**.

---

## About HOMESTEAD

**Awaken a Monster. Give it a Home. Make it Yours.**

A collectible game about cute, strange punk monsters. The Creature is the
collectible; the Homestead is the Creature's home. It must never look like a
farming simulator, medieval fantasy or a crypto dashboard.

PR #1 built the foundation: navigation, the wallet area, the Home screen and
placeholder screens. PR #2 added Genesis -> Seed -> Awaken (below). PR #3 made
the Creature a full collectible (below). PR #4 added the Homestead; PR #5 Work
& Resources (below); PR #6 STEAD Points and Daily Check-in (below); PR #7
Feeding + Training (below); PR #8 Gear (below); PR #9 Contests (below); then
Marketplace food (below). Creature listings, breeding, Gear crafting or
trading, other STEAD spending and transactions do not exist yet, and none may
be faked.

- **Genesis:** `lib/genesis.js` holds every rule, enforced in Postgres
  transactions. Genesis is repeatable for `GENESIS_COST` STEAD each
  (`debitStead`, type GENESIS), checked in order under a lock on the wallet:
  room under the ownership cap, no Genesis Seed still waiting (one at a time,
  a partial unique index), enough STEAD; then the Seed and its debit are
  written together. One Creature per Seed; ids come from `creatures_id_seq`
  (never reused). `genesis_wallets.genesis_used` (never back to false) means
  "has used Genesis" and links the Homeroom user to the wallet; it gates
  nothing. Nothing is on-chain: say "Genesis created", never "transaction
  confirmed". A future transfer changes only `creatures.owner`, through
  `lib/ownership.js`; `created_by` and `genesis_wallet` keep the history. `npm test` runs its
  tests against `DATABASE_URL` (a throwaway database: it drops the tables).

- **Creatures:** everything a Creature is (name, Species, rarity, base stats,
  personality, Gene, mutation, Trade, layered appearance) is rolled ONCE by
  `lib/creature-generator.js` inside the Awaken transaction and stored on the
  `creatures` row; a trigger refuses to change any of it afterwards. Only
  `owner`, `level` and `name` can change, and only the owner renames
  (`lib/creatures.js`). Every table and balance value is in
  `public/js/creature-config.js`; the name rules are `public/js/creature-name.js`
  (shared by page and server). The page only draws what is stored:
  `public/js/creature-art.js` (SVG, colours are the `--art-*` tokens, artwork
  only) and `public/js/creature-card.js` (card, profile). Future Training and
  Gear add bonuses beside the `base_*` stats, never over them.
- **Work:** `lib/work.js` owns every rule: a Creature works only at its
  Trade's building (unlocked by `homestead.open`), one unfinished Work per
  Creature (partial unique index), finished-ness always from `started_at` +
  duration and the request's `req.now`, rewards rolled once when settled,
  `collected` never above the reward (trigger), overflow kept pending on the
  record. Balance (durations, Trade -> building, per-hour ranges, resource
  groups, history size) is only in `public/js/work-config.js`. Work never
  produces STEAD and never changes the Creature.
- **STEAD Points** ("STEAD" in the UI) are the one internal gameplay currency:
  not a token, not crypto, not money, nothing on-chain. Never call it HOME,
  coins, gold or tokens. `lib/stead.js` owns it: one `stead_accounts` row per
  wallet (balance, never below 0; streak), an append-only `stead_ledger`
  (income positive, expenses negative), and `creditStead` / `debitStead` /
  `getSteadBalance` / `getSteadLedger` as the only way to touch a balance. A
  ledger entry may carry a key unique per (owner, type). Daily Check-in uses
  the date in `GAME_TIMEZONE`, so a wallet checks in once per calendar day,
  always worked out on the server from `req.now`. Rewards, timezone and every
  ledger type (spending types are reserved, inactive) are only in
  `public/js/stead-config.js`. The two economies stay separate: Work ->
  Resources, Daily Check-in -> STEAD.
- **Feeding + Training:** `lib/care.js` owns both, each one transaction under
  a lock on the Creature, then the Homestead, then the STEAD account, with an
  optional per-tap `requestId` (`creature_care_log`, and the TRAINING ledger
  key) so retries never apply twice. Hunger is stored as of
  `hunger_updated_at` and worked out from the time since; it never harms a
  Creature. Feeding spends Fodder from storage; Training spends STEAD via
  `debitStead` (type TRAINING), never while Working, never past the max.
  Training bonuses sit beside `base_*`; `effectiveStat` (base + training +
  gear 0 + traits 0) is the one stat calculation. Work stores the hunger
  efficiency at its start and rounds each Resource down. Every value and
  calculation is in `public/js/care-config.js`.
- **Gear:** `lib/gear.js` owns it: one `gear_items` row per item (permanent
  id shown as GEAR-001, its name, rarity, type, stats and trait copied from the
  catalog and never changed, never deleted), owned by a wallet and on at most
  one Creature (`equipped_creature_id`; a unique index allows one item per
  Creature and slot; a trigger refuses Gear on a Creature its owner doesn't
  own). Equip, replace and unequip are one transaction each under a lock on
  the Creature, free (no STEAD, no ledger entry), and repeat safely. The slots
  are Tool and Accessory: Homeroom's content rules allow no weapons, so there
  is no Weapon slot. Gear comes only from the once-per-wallet starter kit for
  now. Slots, stats and the catalog are only in `public/js/gear-config.js`;
  care-config.js `gearBonus` adds equipped Gear into `effectiveStat`.
- **Contests:** player-vs-player head-to-head play, built as a non-violent
  trick-off (content rules: never "battle", "attack" as an action, "damage" or
  "defeated" in copy). `lib/contests.js` owns it: a challenge
  (`contest_challenges`) is between two different wallets and moves once
  from PENDING (trigger), under a row lock, so two tabs or a cancel racing an
  accept end in one state. Accepting creates the one Contest for it
  (`contests.challenge_id` UNIQUE), locks both Creatures
  (`contest_creature_locks`, PK per Creature; `lib/contest-locks.js` is what
  Work, Training and Gear check) and saves a snapshot of both (effective
  stats via care-config.js, condition, Gear ids). After
  `CONTEST_DURATION_SECONDS` the first request resolves it once from the
  snapshots, stores the log and result, pays CONTEST_REWARD through
  `creditStead` keyed `CONTEST-<id>` (once per wallet) and releases the locks;
  a completed Contest is frozen. Ownership and permanent stats never change.
  Every value and formula is in `public/js/contest-config.js`. The opponent
  is a wallet address, or a Homeroom username resolved through the platform
  directory to the wallet that user used Genesis with.
- **Marketplace food:** `lib/marketplace.js` sells the foods in
  `public/js/food-config.js` (names, prices, effects: PROVISIONAL, change them
  only there) for STEAD: one purchase is one transaction under a lock on the
  wallet's `food_inventory` row, `debitStead` (type MARKETPLACE_PURCHASE,
  keyed by the tap's `requestId`), at most `MAX_OWNED_PER_FOOD` of a food.
  Food is fed through `lib/care.js` `feed(..., foodId)` and only acts on
  Hunger; a hold (Punk Feast) stores full Hunger as of a moment still to
  come, so `currentHunger` counts no loss until then. Food can't be sold,
  given or refunded.
- **Ownership cap:** a wallet owns at most `MAX_OWNED_CREATURES` (10),
  counted on the server from current ownership plus Seeds waiting to be
  awakened. There is no global Creature cap and none may be added. Every
  system that gives a wallet a Creature or Seed must go through
  `lib/ownership.js` (`lockWallet` + `assertRoom`, or `transferCreature` for a
  sale). `MAX_OWNED_CREATURES` and `GENESIS_COST` are written only in
  `public/js/config.js` (page: `window.HOMESTEAD_CONFIG`, server:
  `require('./public/js/config')`).
- **Game state:** `public/js/state.js` is the one store (`HOMESTEAD_STORE`),
  with a slot per future system (wallet, slots, creature, seed, homestead,
  resources, stead, gear, contests, marketplace, breeding). A new system
  fills its slot; screens read the store and re-render on `subscribe`.
- **Wallet:** CONNECT WALLET reads the wallet linked to the signed-in Homeroom
  account from `GET /api/me` (`req.user.usernode_pubkey`, verified by the
  server). Nothing is signed or sent. Disconnect forgets it on this device.
  Do not use the bridge's `getNodeAddress()` for this outside the native app:
  it falls back to a random mock address.
- **Screens:** `public/js/screens.js` (one render function per route),
  `public/js/app.js` (router, nav, wallet area). Routes are clean paths
  (`/`, `/creature`, `/homestead`, `/contests`, `/marketplace`, `/collection`,
  `/profile`, `/contests/<id>` under CONTESTS); the server's catch-all serves
  `index.html` for each. The top menu (`NAV` in screens.js) is HOME, MY
  HOMESTEAD, CONTESTS, MARKETPLACE: MY HOMESTEAD's page carries the tabs
  CREATURE (`/creature`), HOMESTEAD (`/homestead`) and COLLECTION
  (`/collection`), and also holds `/gear`, `/homestead/<id>` and the player's
  own `/creature/<id>`.
- **Content rules:** Homeroom apps may not include combat or fantasy violence,
  so head-to-head play is called "compete"/"contests", not battles. Design it
  as non-violent contests (races, talent shows, puzzles), and keep any Genesis
  or reward randomness free of paid loot-box mechanics.

## Design

- **Palette:** accent acid lime (`accent`, primary action and progress only);
  second colour hot pink (`punk`: stickers, stitches, icons, the mascot);
  neutrals violet-tinted ink greys.
- **Signature element:** the punk-monster mascot (a pink blob with a lime
  mohawk and one eye) in the wordmark, plus `collectible` panels with a dashed
  pink "stitch" and tilted pink `sticker` labels.
- **Type scale:** `text-title`, `text-heading`, `text-body`, `text-small`, plus
  `text-display` for the wordmark and the Creature count only. Headings and nav
  are heavy (`font-black`/`font-bold`); nav labels are uppercase by the
  owner's request.
- **One fixed look:** dark. A collectible game drawn as its own scene; the owner
  asked for a dark UI. Tokens are set once on `:root`.

The kit is in `styles/tailwind-input.css`: colour tokens (named in
`tailwind.config.js`) and components (`btn-primary`, `btn-secondary`, `field`,
`list`/`list-row`, `card`, `collectible`, `sticker`, `nav-tab`,
`section-label`, `skeleton`, `state-empty`, `state-error`).

- Colour comes only from the tokens: never a raw hex value or a stock palette class.
- Tap targets are at least 44 px; the buttons, fields and nav tabs already are.
- Every screen that loads data has honest loading, empty and error states.
- No cards in cards, no emoji as icons.

## App-specific conventions

- Add each game table with `CREATE TABLE IF NOT EXISTS`, called from
  `start()` in `server.js` (Genesis does this in `genesis.ensureSchema`).
