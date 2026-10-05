# HOMESTEAD

Awaken a Monster. Give it a Home. Make it Yours.

HOMESTEAD is a collectible game about cute, strange little monsters.
Each wallet raises **one Genesis Creature**, hatched through the
**Seed → Awaken** flow: tap Awaken and the server picks a species and a
name at random and your creature comes to live in your Homestead. Want
another monster later? Creatures can be bought and traded with other
players (planned, see below).

## Raising your creature

Your creature lives in your Homestead with two stats:

- **Strength** — starts at 5. What your creature will bring to battles
  in a later version.
- **Energy** — 0 to 100, starts at 100. Your creature's get-up-and-go.

Two actions care for it:

- **Feed** restores 20 Energy, capped at 100.
- **Train** costs 10 Energy and adds 1 Strength.

Every Feed and Train is written to the **Care log**, an append-only
history that is never edited or deleted, so your creature's story stays
exactly as it happened.

## Coming in later versions

Equipping your creature with **Gear**, sending it to **work**, **battles**,
and the **marketplace** for buying and trading creatures with other
players.

## Under the hood

- **Sign-in** — the server verifies the platform-issued user token (an
  RS256 JWT) on every request, so the app already knows who is using it.
  Guests can look around; every write asks them to make an account.
- **Database** — the app's own private Postgres: a `creatures` table
  (one row per wallet, guarded by a unique constraint) and the
  append-only `care_log`. Both are created idempotently on boot.
- **Styling** — Tailwind CSS, precompiled by `npm run build` during
  image creation with either Kubernetes/Paketo or standalone Docker, in
  a light and a dark look that follow the viewer's Homeroom theme.
- **Staging demos** — in staging, `/?demo=1` shows a populated Homestead
  with obviously fake data, served on request and never written to the
  database.

To change this app, ask Homeroom bot: open the app on Homeroom, tap the
Homeroom icon in the header, then **Ask for a change**. You can also run
Claude Code against this repo directly; start with `CLAUDE.md`, which
carries the app-specific notes and points at the platform rules.
