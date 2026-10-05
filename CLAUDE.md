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

PR #1 built only the foundation: navigation, the wallet area, the Home screen
and placeholder screens. No Creatures, Genesis, listings, breeding or
transactions exist yet, and none may be faked.

- **Supply cap:** there can never be more than 5,000 Creatures.
  `MAX_CREATURE_SUPPLY` in `public/js/config.js` is the only place that number
  is written. The page reads it as `window.HOMESTEAD_CONFIG`, the server as
  `require('./public/js/config')`. Every Creature creation system must check it.
- **Game state:** `public/js/state.js` is the one store (`HOMESTEAD_STORE`),
  with a slot per future system (wallet, supply, creature, seed, homestead,
  resources, homePoints, gear, contests, marketplace, breeding). A new system
  fills its slot; screens read the store and re-render on `subscribe`.
- **Wallet:** CONNECT WALLET reads the wallet linked to the signed-in Homeroom
  account from `GET /api/me` (`req.user.usernode_pubkey`, verified by the
  server). Nothing is signed or sent. Disconnect forgets it on this device.
  Do not use the bridge's `getNodeAddress()` for this outside the native app:
  it falls back to a random mock address.
- **Screens:** `public/js/screens.js` (one render function per route),
  `public/js/app.js` (router, nav, wallet area). Routes are clean paths
  (`/`, `/creature`, `/homestead`, `/marketplace`, `/collection`, `/profile`);
  the server's catch-all serves `index.html` for each.
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
  `text-display` for the wordmark and the supply count only. Headings and nav
  are heavy (`font-black`/`font-bold`); nav labels and the supply sticker are
  uppercase by the owner's request.
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

- No game tables exist yet. Add each with `CREATE TABLE IF NOT EXISTS` in
  `start()` in `server.js`.
