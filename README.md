# HOMESTEAD

**Awaken a Monster. Give it a Home. Make it Yours.**

A collectible game about cute, strange punk monsters, built on Homeroom.
There will only ever be 5,000 Creatures.

This is the foundation (PR #1): navigation, a Homeroom wallet connection,
the Home screen with the supply counter (0 / 5,000) and placeholder screens
for My Creature, Homestead, Marketplace, Collection and Profile. No gameplay
exists yet.

## Layout

- `public/js/config.js`: game-wide constants, including `MAX_CREATURE_SUPPLY`
  (shared by the page and the server).
- `public/js/state.js`: the central game-state store, one slot per system.
- `public/js/wallet.js`: connect/disconnect, using the wallet linked to the
  signed-in Homeroom account (`GET /api/me`).
- `public/js/screens.js`, `public/js/app.js`: screens, navigation and routing.
- `server.js`: Express server with Homeroom auth and `GET /api/me`.
- `styles/tailwind-input.css`, `tailwind.config.js`: the design tokens and
  components, compiled to `public/tailwind.css` by `npm run build`.

See `CLAUDE.md` for the rules future changes follow.
