# HOMESTEAD

**Awaken a Monster. Give it a Home. Make it Yours.**

A collectible game about cute, strange punk monsters, built on Homeroom.
Each wallet can own up to 10 Creatures; Genesis costs 500 STEAD.

This is the foundation (PR #1): navigation, a Homeroom wallet connection,
the Home screen with a Creature counter and placeholder screens
for My Creature, Homestead, Marketplace, Collection and Profile. No gameplay
exists yet.

## Layout

- `public/js/config.js`: game-wide constants, `MAX_OWNED_CREATURES` and `GENESIS_COST`
  (shared by the page and the server).
- `public/js/state.js`: the central game-state store, one slot per system.
- `public/js/wallet.js`: connect/disconnect, using the wallet linked to the
  signed-in Homeroom account (`GET /api/me`).
- `public/js/screens.js`, `public/js/app.js`: screens, navigation and routing.
- `server.js`: Express server with Homeroom auth and `GET /api/me`.
- `styles/tailwind-input.css`, `tailwind.config.js`: the design tokens and
  components, compiled to `public/tailwind.css` by `npm run build`.

See `CLAUDE.md` for the rules future changes follow.
