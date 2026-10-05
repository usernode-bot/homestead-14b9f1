const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const jwt = require('jsonwebtoken');
const genesis = require('./lib/genesis');
const creatures = require('./lib/creatures');
const homestead = require('./lib/homestead');
const work = require('./lib/work');
const stead = require('./lib/stead');
const care = require('./lib/care');
const gear = require('./lib/gear');

const app = express();
const port = process.env.PORT || 3000;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// The platform signs user-identity tokens with an RSA private key it never
// shares. Containers get only the PUBLIC half, so this app can verify who a
// user is but cannot mint an identity — and neither can any other app.
const JWT_PUBLIC_KEY = (process.env.USERNODE_JWT_PUBLIC_KEY || '')
  .replace(/\\n/g, '\n');

// Tokens are minted for one app: the audience is this app's numeric id, so a
// token issued for a different app is rejected below rather than accepted as
// a valid user.
const APP_AUDIENCE = process.env.USERNODE_APP_ID
  ? 'usernode:app:' + process.env.USERNODE_APP_ID
  : null;

// Visitors with no Homeroom account ("guests") may look around this app at
// its own address, read-only (every public app). The platform marks
// them with a token of their own: ES256, signed by a key of its own (its
// public half is USERNODE_GUEST_JWT_PUBLIC_KEY), this audience, `pur:
// 'guest'`, `guest: true`, and no id or username. Such a visitor is
// `req.guest`, never `req.user`, and every write they try is answered 401
// `account_required`, which the bridge turns into "Make an account to
// continue".
const GUEST_AUDIENCE = APP_AUDIENCE ? APP_AUDIENCE + ':guest' : null;
const GUEST_PUBLIC_KEY = (process.env.USERNODE_GUEST_JWT_PUBLIC_KEY || '')
  .replace(/\\n/g, '\n');

// Paths that stay open without authentication. Add a path here (and add it
// with `app.get`/`app.post` below) if you deliberately want it public.
// Everything else requires a valid platform-issued JWT.
const PUBLIC_API_PATHS = new Set(['/health']);

app.use(express.json());

// The platform's three centrally hosted files — the bridge, the native UI
// kit and the Tailwind runtime — are reachable at these paths on this app's
// OWN origin, so index.html can load them with a RELATIVE path and never
// name the platform's hostname. A hostname baked into an app is what breaks
// every app at once when the platform's domain moves.
//
// In production and on a staging preview the platform's edge answers these
// before the request ever reaches this process (a per-app Ingress rule on
// Kubernetes, the wildcard site's matcher on the docker runtime). This
// handler is what makes the same relative paths work under a plain
// `node server.js`, where there is no edge in front of the app at all.
//
// Registered BEFORE the auth middleware because these three files are
// public: the platform serves them anonymously from any app origin, and a
// login redirect arriving where a <script> was expected is exactly the
// failure a relative path is meant to avoid.
// The platform's origin, at RUNTIME, and ONLY from the variable the platform
// injects. No hostname is written into this file: a baked-in one is what left
// the whole fleet pointing at a domain the platform had moved away from.
// Unset only outside the platform (a plain local `node server.js`) — set
// USERNODE_PLATFORM_ORIGIN there too if you want the hosted assets locally.
const PLATFORM_ORIGIN = (process.env.USERNODE_PLATFORM_ORIGIN || '')
  .replace(/\/+$/, '');

app.get(/^\/usernode-(?:bridge|native|tailwind)\//, async (req, res) => {
  try {
    if (!PLATFORM_ORIGIN) return res.sendStatus(503);
    const upstream = await fetch(PLATFORM_ORIGIN + req.path);
    if (!upstream.ok) return res.sendStatus(upstream.status);
    const type = upstream.headers.get('content-type');
    if (type) res.type(type);
    // max-age=0 with revalidation, never a long TTL: the whole point of
    // central hosting is that a platform-side fix lands on the next load.
    res.set('Cache-Control', 'public, max-age=0, must-revalidate');
    return res.send(Buffer.from(await upstream.arrayBuffer()));
  } catch (err) {
    console.warn('hosted asset fetch failed: ' + err.message);
    return res.sendStatus(502);
  }
});

// "Now" for this request, as a Date: `req.now`, set for every request by
// the middleware below. Read the day and the time through it (and
// `usernode.now()` in the page), never `new Date()` or SQL's NOW(),
// wherever they decide what shows: a reminder, a rota, a deadline.
// Production always gets the real time. A staging preview may be shown as of
// a chosen moment: the platform opens it with `?un-now=<ISO time>`, and the
// page sends `usernode.now()` on as the `x-usernode-now` header. Only a
// staging container reads either. See "Time-dependent features" in the
// platform conventions.
const IS_STAGING = process.env.USERNODE_ENV === 'staging';
const PREVIEW_NOW = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;
function requestNow(req) {
  const raw = IS_STAGING ? (req.headers['x-usernode-now'] || req.query['un-now']) : null;
  return typeof raw === 'string' && PREVIEW_NOW.test(raw) ? new Date(raw) : new Date();
}

// Verify platform-issued JWT if one was passed, then enforce auth on
// anything not explicitly marked public. The iframe adds `?token=…`
// on load; the frontend script forwards the token via `x-usernode-token`
// on subsequent fetches.
app.use((req, res, next) => {
  req.now = requestNow(req);
  const token = req.query.token || req.headers['x-usernode-token'];
  if (token && JWT_PUBLIC_KEY && APP_AUDIENCE) {
    try {
      // Pin the algorithm, issuer and audience. Without `algorithms` a
      // caller could hand us an HS256 token signed with the public PEM
      // (which every app knows) and forge any user.
      const claims = jwt.verify(token, JWT_PUBLIC_KEY, {
        algorithms: ['RS256'],
        issuer: 'usernode',
        audience: APP_AUDIENCE,
      });
      // `pur` names what the token is for. Only user-identity tokens
      // authenticate a person here.
      if (claims && claims.pur === 'iframe') req.user = claims;
    } catch {}
  }
  if (!req.user && token && GUEST_PUBLIC_KEY && GUEST_AUDIENCE) {
    try {
      const guest = jwt.verify(token, GUEST_PUBLIC_KEY, {
        algorithms: ['ES256'],
        issuer: 'usernode',
        audience: GUEST_AUDIENCE,
      });
      if (guest && guest.pur === 'guest' && guest.guest === true) req.guest = true;
    } catch {}
  }

  // Static assets (CSS/JS/images) are always served; the API and the HTML
  // shell are gated so direct hits to the staging/prod subdomain don't
  // leak app data to the public internet. A guest may READ: every GET,
  // `/api/*` included, so read routes must not assume req.user (use
  // `req.user ? req.user.id : null`). Every write needs an account.
  if (req.method !== 'GET' || req.path.startsWith('/api/')) {
    if (PUBLIC_API_PATHS.has(req.path)) return next();
    if (!req.user && req.guest) {
      if (req.method === 'GET' || req.method === 'HEAD') return next();
      return res.status(401).json({ error: 'account_required' });
    }
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
  }
  next();
});

let shuttingDown = false;
app.get('/health', (_req, res) => {
  if (shuttingDown) return res.status(503).json({ status: 'shutting_down' });
  res.json({ status: 'ok' });
});

// The template ships no favicon file; index.html carries an inline SVG
// icon instead. Answer 204 here so anything that still probes
// /favicon.ico (older browsers, direct visits) doesn't fall through to
// the auth-gated catch-all and surface a 401 in the console on every
// fresh load.
app.get('/favicon.ico', (_req, res) => res.status(204).end());

// Who is signed in, and the Homeroom wallet linked to their account. The
// page's CONNECT WALLET reads this: the address comes from the platform's
// verified identity token, never from anything the browser claims.
app.get('/api/me', (req, res) => {
  if (!req.user) return res.json({ guest: true, user: null });
  res.json({
    guest: false,
    user: {
      id: req.user.id,
      username: req.user.username,
      wallet: req.user.usernode_pubkey || null,
    },
  });
});

// Genesis -> Seed -> Awaken (lib/genesis.js). The wallet is always the one
// the platform's verified token links to this account, never one the browser
// names. Reading works for guests (supply only); writes need a linked wallet.
function genesisWallet(req) {
  return req.user && req.user.usernode_pubkey ? req.user.usernode_pubkey : null;
}

function sendGenesisError(res, err) {
  if (err instanceof genesis.GenesisError || err instanceof creatures.CreatureError || err instanceof work.WorkError || err instanceof stead.SteadError || err instanceof care.CareError || err instanceof gear.GearError) {
    return res.status(err.status).json({ error: err.code, message: err.message });
  }
  console.error('[genesis]', err);
  return res.status(500).json({ error: 'server_error', message: 'Something went wrong. Try again.' });
}

app.get('/api/genesis', async (req, res) => {
  try {
    res.json(await genesis.getState(pool, genesisWallet(req)));
  } catch (err) {
    sendGenesisError(res, err);
  }
});

app.post('/api/genesis/mint', async (req, res) => {
  const wallet = genesisWallet(req);
  if (!wallet) return res.status(400).json({ error: 'no_wallet', message: 'Link a wallet to your Homeroom account first.' });
  try {
    res.json(await genesis.mint(pool, wallet, req.user.id));
  } catch (err) {
    sendGenesisError(res, err);
  }
});

app.post('/api/genesis/awaken', async (req, res) => {
  const wallet = genesisWallet(req);
  if (!wallet) return res.status(400).json({ error: 'no_wallet', message: 'Link a wallet to your Homeroom account first.' });
  const seedId = Number(req.body && req.body.seedId);
  if (!Number.isInteger(seedId) || seedId < 1) return res.status(400).json({ error: 'bad_seed', message: 'Which Seed?' });
  try {
    res.json(await genesis.awaken(pool, wallet, seedId));
  } catch (err) {
    sendGenesisError(res, err);
  }
});

// Creatures (lib/creatures.js). Reading is open to anyone who can see the
// app: a Creature is a public collectible. Renaming needs the owner's wallet.
app.get('/api/creatures', async (req, res) => {
  try {
    res.json({ creatures: await creatures.listOwned(pool, genesisWallet(req), req.now) });
  } catch (err) {
    sendGenesisError(res, err);
  }
});

function creatureIdParam(req) {
  const id = Number(req.params.id);
  return Number.isInteger(id) && id >= 1 ? id : null;
}

// An id nobody has is answered 200 with creature: null (not 404), so opening
// /creature/<unknown> shows "not found" without a failed request in the
// console.
app.get('/api/creatures/:id', async (req, res) => {
  const id = creatureIdParam(req);
  if (!id) return res.json({ creature: null, ownedByYou: false });
  try {
    const creature = await creatures.getById(pool, id, req.now);
    if (!creature) return res.json({ creature: null, ownedByYou: false });
    const wallet = genesisWallet(req);
    const ownedByYou = !!wallet && creature.owner === wallet;
    // The owner also gets what the Feed and Train controls need.
    res.json({ creature, ownedByYou, controls: ownedByYou ? await care.controls(pool, wallet, id, req.now) : null });
  } catch (err) {
    sendGenesisError(res, err);
  }
});

app.post('/api/creatures/:id/name', async (req, res) => {
  const wallet = genesisWallet(req);
  if (!wallet) return res.status(400).json({ error: 'no_wallet', message: 'Link a wallet to your Homeroom account first.' });
  const id = creatureIdParam(req);
  if (!id) return res.status(404).json({ error: 'not_found', message: 'No Creature has that ID.' });
  try {
    res.json({ creature: await creatures.rename(pool, wallet, id, req.body && req.body.name) });
  } catch (err) {
    sendGenesisError(res, err);
  }
});

// Feeding + Training (lib/care.js). The owner only, one transaction each.
// requestId is made once per tap by the page: a retry or a duplicate of the
// same tap is answered with the current state (replayed: true) and changes
// nothing. Both answer { creature, controls } so the page shows one truth.
app.post('/api/creatures/:id/feed', async (req, res) => {
  const wallet = genesisWallet(req);
  if (!wallet) return res.status(400).json({ error: 'no_wallet', message: 'Link a wallet to your Homeroom account first.' });
  const id = creatureIdParam(req);
  if (!id) return res.status(404).json({ error: 'not_found', message: 'No Creature has that ID.' });
  try {
    res.json(await care.feed(pool, wallet, id, req.body && req.body.requestId, req.now));
  } catch (err) {
    sendGenesisError(res, err);
  }
});

app.post('/api/creatures/:id/train', async (req, res) => {
  const wallet = genesisWallet(req);
  if (!wallet) return res.status(400).json({ error: 'no_wallet', message: 'Link a wallet to your Homeroom account first.' });
  const id = creatureIdParam(req);
  if (!id) return res.status(404).json({ error: 'not_found', message: 'No Creature has that ID.' });
  const body = req.body || {};
  try {
    res.json(await care.train(pool, wallet, id, String(body.stat || ''), body.requestId, req.now));
  } catch (err) {
    sendGenesisError(res, err);
  }
});

// Gear (lib/gear.js). The inventory and every change are for the wallet the
// platform's verified token links to this account. Equip and unequip are one
// transaction each and free (no STEAD); they answer with the Creature as it
// now is and the whole inventory, so the page shows one truth. Repeating one
// (double tap, another tab) changes nothing a second time.
app.get('/api/gear', async (req, res) => {
  try {
    res.json(await gear.inventory(pool, genesisWallet(req)));
  } catch (err) {
    sendGenesisError(res, err);
  }
});

// The starter kit, once per wallet, ever.
app.post('/api/gear/claim-starter', async (req, res) => {
  const wallet = genesisWallet(req);
  if (!wallet) return res.status(400).json({ error: 'no_wallet', message: 'Link a wallet to your Homeroom account first.' });
  try {
    res.json(await gear.claimStarter(pool, wallet));
  } catch (err) {
    sendGenesisError(res, err);
  }
});

app.post('/api/creatures/:id/gear/equip', async (req, res) => {
  const wallet = genesisWallet(req);
  if (!wallet) return res.status(400).json({ error: 'no_wallet', message: 'Link a wallet to your Homeroom account first.' });
  const id = creatureIdParam(req);
  if (!id) return res.status(404).json({ error: 'not_found', message: 'No Creature has that ID.' });
  const body = req.body || {};
  try {
    const result = await gear.equip(pool, wallet, id, Number(body.gearId), String(body.slot || ''));
    res.json({
      creature: await creatures.getById(pool, id, req.now),
      gear: await gear.inventory(pool, wallet),
      result,
    });
  } catch (err) {
    sendGenesisError(res, err);
  }
});

app.post('/api/creatures/:id/gear/unequip', async (req, res) => {
  const wallet = genesisWallet(req);
  if (!wallet) return res.status(400).json({ error: 'no_wallet', message: 'Link a wallet to your Homeroom account first.' });
  const id = creatureIdParam(req);
  if (!id) return res.status(404).json({ error: 'not_found', message: 'No Creature has that ID.' });
  try {
    const result = await gear.unequip(pool, wallet, id, String((req.body && req.body.slot) || ''));
    res.json({
      creature: await creatures.getById(pool, id, req.now),
      gear: await gear.inventory(pool, wallet),
      result,
    });
  } catch (err) {
    sendGenesisError(res, err);
  }
});

// Homesteads (lib/homestead.js). Opening your own needs a linked wallet: it
// is created the first time that wallet owns a Creature, and the Creature in
// it is always the one the wallet owns now (checked on the server, never
// named by the browser). Anyone can look at a Homestead by its number.
// This wallet's Homestead with its Work (lib/work.js). Opening it settles
// Work whose time is up, rolling its rewards once.
async function ownHomestead(wallet, now) {
  // Save the Creature's hunger as of now (lib/care.js) before showing it.
  await care.syncHunger(pool, wallet, now);
  const opened = await homestead.open(pool, wallet, now);
  opened.work = opened.homestead
    ? await work.overview(pool, opened.homestead.homesteadId, now, { settle: true })
    : null;
  return opened;
}

app.post('/api/homestead', async (req, res) => {
  const wallet = genesisWallet(req);
  if (!wallet) return res.status(400).json({ error: 'no_wallet', message: 'Link a wallet to your Homeroom account first.' });
  try {
    res.json(await ownHomestead(wallet, req.now));
  } catch (err) {
    sendGenesisError(res, err);
  }
});

// A number nobody has is answered 200 with homestead: null (not 404), so
// opening /homestead/<unknown> shows "not found" without a failed request in
// the console. Reading never settles or changes Work.
app.get('/api/homesteads/:id', async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.json({ homestead: null, creature: null, work: null, ownedByYou: false });
  try {
    const found = await homestead.getById(pool, id, req.now);
    if (!found) return res.json({ homestead: null, creature: null, work: null, ownedByYou: false });
    const wallet = genesisWallet(req);
    found.work = await work.overview(pool, id, req.now, { settle: false });
    res.json(Object.assign(found, { ownedByYou: !!wallet && found.homestead.owner === wallet }));
  } catch (err) {
    sendGenesisError(res, err);
  }
});

// Work (lib/work.js). Every write is for the wallet's own Homestead, and
// answers with the whole Homestead again so the page shows one truth.
// Starting while the Creature already works, and collecting twice, are safe:
// the server hands back the same Work and never pays out twice.
app.post('/api/work/start', async (req, res) => {
  const wallet = genesisWallet(req);
  if (!wallet) return res.status(400).json({ error: 'no_wallet', message: 'Link a wallet to your Homeroom account first.' });
  const body = req.body || {};
  const creatureId = Number(body.creatureId);
  if (!Number.isInteger(creatureId) || creatureId < 1) return res.status(400).json({ error: 'bad_creature', message: 'Which Creature?' });
  try {
    const result = await work.start(pool, wallet, {
      creatureId,
      durationId: String(body.durationId || ''),
      buildingId: body.buildingId == null ? null : String(body.buildingId),
    }, req.now);
    res.json(Object.assign(await ownHomestead(wallet, req.now), { started: result.started }));
  } catch (err) {
    sendGenesisError(res, err);
  }
});

app.post('/api/work/:id/collect', async (req, res) => {
  const wallet = genesisWallet(req);
  if (!wallet) return res.status(400).json({ error: 'no_wallet', message: 'Link a wallet to your Homeroom account first.' });
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(404).json({ error: 'not_found', message: 'No Work with that number in your Homestead.' });
  try {
    const result = await work.collect(pool, wallet, id, req.now);
    res.json(Object.assign(await ownHomestead(wallet, req.now), { moved: result.moved, alreadyClaimed: result.alreadyClaimed }));
  } catch (err) {
    sendGenesisError(res, err);
  }
});

app.post('/api/work/collect-pending', async (req, res) => {
  const wallet = genesisWallet(req);
  if (!wallet) return res.status(400).json({ error: 'no_wallet', message: 'Link a wallet to your Homeroom account first.' });
  try {
    const result = await work.collectPending(pool, wallet, req.now);
    res.json(Object.assign(await ownHomestead(wallet, req.now), { moved: result.moved }));
  } catch (err) {
    sendGenesisError(res, err);
  }
});

// STEAD Points and Daily Check-in (lib/stead.js). Always for the wallet the
// platform's verified token links to this account, never one the browser
// names, and every calendar day comes from the server's clock (req.now) in
// the game timezone. No wallet: no balance, and no anonymous account.
app.get('/api/stead', async (req, res) => {
  try {
    res.json(await stead.getState(pool, genesisWallet(req), req.now));
  } catch (err) {
    sendGenesisError(res, err);
  }
});

// One claim per wallet per calendar day: a second one (double click, another
// tab, a retry) is refused with already_claimed and pays nothing.
app.post('/api/stead/check-in', async (req, res) => {
  const wallet = genesisWallet(req);
  if (!wallet) return res.status(400).json({ error: 'no_wallet', message: 'Link a wallet to your Homeroom account first.' });
  try {
    res.json(await stead.claimCheckIn(pool, wallet, req.now));
  } catch (err) {
    sendGenesisError(res, err);
  }
});

app.use(express.static(path.join(__dirname, 'public')));

// HTML shell: serve the app if authenticated. Unauthenticated top-level
// visits (share links pasted into a browser — Sec-Fetch-Dest: document)
// are sent to the platform's chromeless view of this app, where the shell
// embeds it with a real token so the link just works. Every other
// tokenless case (iframe loads with an expired token, old browsers
// without Sec-Fetch-*) gets the "open in Homeroom" landing page instead
// of a redirect, so the platform shell is never loaded INSIDE its own
// app iframe and stray visits still don't reveal the app.
app.get('*', (req, res) => {
  if (!req.user && !req.guest) {
    // Deep-link pass-through (platform #743): carry the visited
    // path+query into the chromeless view so share links land on the
    // shared screen, not Home. The clean platform route stores `path`
    // as one encoded query value so an inner ?, &, or = survives. The
    // shell decodes and validates it as relative-only before use. The
    // character test keeps the
    // value attribute-safe for the landing anchor below — anything
    // unusual falls back to the bare link.
    const deepPath = /^\/[A-Za-z0-9\-._~!$&()*+,;=:@\/%?]*$/.test(req.originalUrl)
      ? '?path=' + encodeURIComponent(req.originalUrl) : '';
    if (PLATFORM_ORIGIN && req.get('sec-fetch-dest') === 'document') {
      return res.redirect(302, PLATFORM_ORIGIN + '/app/homestead-14b9f1/full' + deepPath);
    }
    return res.status(401).send(`<!doctype html><meta charset=utf-8><title>Open in Homeroom</title>
<body style="font-family:system-ui;background:#09090b;color:#e4e4e7;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0">
  <div style="max-width:24rem;padding:2rem;text-align:center">
    <h1 style="font-size:1.25rem;margin:0 0 0.5rem">Open this app inside Homeroom</h1>
    <p style="color:#a1a1aa;font-size:0.9rem;margin:0 0 1.25rem">This page is served via the platform; direct visits aren't authenticated.</p>
    <a href="${PLATFORM_ORIGIN}/app/homestead-14b9f1/full${deepPath}" style="display:inline-block;padding:0.5rem 1rem;background:#7c3aed;color:white;border-radius:0.5rem;text-decoration:none;font-size:0.9rem">Open in Homeroom</a>
  </div>
</body>`);
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Stop accepting connections, let in-flight requests finish for a moment,
// close the pool and exit. Every deploy replaces this container.
const DRAIN_MS = 3000;
let server;

async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[shutdown] ${signal} received, draining`);
  if (server) {
    server.close(() => {});
    server.closeIdleConnections?.();
    const t = setTimeout(() => server.closeAllConnections?.(), DRAIN_MS);
    t.unref?.();
  }
  try {
    await pool.end();
  } catch (e) {
    console.error('[shutdown] pool.end failed', e.message);
  }
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Staging previews start with an empty (or copied) database, so give them one
// obviously fake Creature to look at, made through the real Genesis -> Awaken
// path for a fake wallet (never the visitor's). Idempotent: a reboot finds the
// Genesis already used and changes nothing.
// The demo Homestead always has the number STAGING_DEMO_HOMESTEAD_ID, so the
// dapp.json checks can open /homestead/900001 whatever real Homesteads the
// copied production database already holds (they took the low numbers, so
// /homestead/1 is a real player's). The wallet is new for that reason too: a
// staging database that already gave the earlier demo wallet
// (ut1stagingdemowallet) a low number keeps it, since numbers never change.
const STAGING_DEMO_WALLET = 'ut1stagingdemohomestead';
const STAGING_DEMO_HOMESTEAD_ID = 900001;
async function seedStaging() {
  const minted = await genesis.mint(pool, STAGING_DEMO_WALLET, 'staging-demo-user');
  if (minted.seed && !minted.creature) await awakenDemo(minted.seed.seedId);
  // Reserve the demo Homestead's number (the sequence never reaches it), then
  // let the real open path fill in its buildings and move the Creature in.
  await pool.query(
    'INSERT INTO homesteads (id, owner, storage) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
    [STAGING_DEMO_HOMESTEAD_ID, STAGING_DEMO_WALLET, JSON.stringify(require('./public/js/homestead-config').emptyStorage())]
  );
  // The demo Creature's Homestead, made the same way an owner opening it does.
  const opened = await homestead.open(pool, STAGING_DEMO_WALLET);
  // Send the demo Creature to work once, through the real path, an hour ago
  // for 4 hours, so the preview shows Work in progress. Later boots find
  // Work already recorded and change nothing.
  if (opened.creature) {
    const any = await pool.query('SELECT 1 FROM creature_work WHERE creature_id = $1 LIMIT 1', [opened.creature.creatureId]);
    if (!any.rows.length) {
      await work.start(pool, STAGING_DEMO_WALLET, { creatureId: opened.creature.creatureId, durationId: '4h' },
        new Date(Date.now() - 3600 * 1000));
    }
    // Give the demo wallet its starter Gear and put a Tool and an Accessory
    // on the demo Creature, through the real paths, the first time only.
    const claimed = await gear.claimStarter(pool, STAGING_DEMO_WALLET);
    if (!claimed.alreadyClaimed) {
      const pick = (catalogId) => claimed.granted.find((g) => g.catalogId === catalogId);
      await gear.equip(pool, STAGING_DEMO_WALLET, opened.creature.creatureId, pick('moon-hammer').gearId, 'tool');
      await gear.equip(pool, STAGING_DEMO_WALLET, opened.creature.creatureId, pick('lucky-bone').gearId, 'accessory');
    }
  }
}
async function awakenDemo(seedId) {
  const awakened = await genesis.awaken(pool, STAGING_DEMO_WALLET, seedId);
  if (awakened.created) {
    await creatures.rename(pool, STAGING_DEMO_WALLET, awakened.creature.creatureId, 'Staging demo');
  }
}

async function start() {
  // Each game system adds its own idempotent CREATE TABLE IF NOT EXISTS here.
  await genesis.ensureSchema(pool);
  // Creatures awakened before the generator existed get their traits once.
  const filled = await creatures.backfill(pool);
  if (filled) console.log(`[creatures] filled in ${filled} earlier Creature(s)`);
  await homestead.ensureSchema(pool);
  await work.ensureSchema(pool);
  await stead.ensureSchema(pool);
  await care.ensureSchema(pool);
  if (IS_STAGING) await seedStaging().catch((err) => console.warn('[staging seed]', err.message));
  server = app.listen(port, () => console.log(`Listening on :${port}`));
  // Let Envoy retire idle upstream connections at 60s, with a 15s margin.
  server.keepAliveTimeout = 75_000;
}

start().catch(err => { console.error(err); process.exit(1); });
