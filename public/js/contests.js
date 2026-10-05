// HOMESTEAD Contests, in the page: this wallet's challenges and Contests,
// sending, accepting, declining and cancelling (lib/contests.js), and the
// Contest open at /contests/<id>.
//
// The server owns every rule and every result: who may challenge whom, which
// Creature is free, who goes first, every trick and show-stopper, the winner
// and the STEAD. The page only shows what it stored, so both players see the
// same Contest. The other player's moves arrive by asking again: every few
// seconds on the Contests screens, less often elsewhere (for the nav badge).
(function () {
  var store = window.HOMESTEAD_STORE;
  var wallet = window.HOMESTEAD_WALLET;
  var loadSeq = 0;
  var viewSeq = 0;
  var lastFetch = 0;
  var lastViewFetch = 0;

  // What the person is typing or choosing. Kept out of the store so a
  // background refresh never wipes it.
  var form = { creatureId: null, opponent: '', acceptCreatureId: null };

  function onContestScreen() {
    return /^\/contests(\/\d{1,9})?\/?$/.test(window.location.pathname);
  }
  function viewedId() {
    var m = /^\/contests\/(\d{1,9})\/?$/.exec(window.location.pathname);
    return m ? Number(m[1]) : null;
  }

  function who(username, address) {
    return username ? '@' + username : wallet.shortAddress(address);
  }

  // What changed for this player since the last answer, as one line: the
  // other player's moves (sent, accepted, declined) and finished Contests.
  function changes(before, after) {
    if (!before || before.walletId !== after.walletId) return null;
    var lines = [];
    var told = {}; // Contests already mentioned
    var was = {};
    before.outgoing.forEach(function (c) { was[c.challengeId] = c.status; });
    after.outgoing.forEach(function (c) {
      if (was[c.challengeId] !== 'PENDING' || c.status === 'PENDING') return;
      var name = who(c.opponentUsername, c.opponentWallet);
      if (c.status === 'ACCEPTED') { told[c.contestId] = true; lines.push(name + ' accepted your challenge. Contest #' + c.contestId + ' started.'); }
      else if (c.status === 'DECLINED') lines.push(name + ' declined your challenge.');
      else if (c.status === 'EXPIRED') lines.push('Your challenge to ' + name + ' expired.');
    });
    var known = {};
    before.incoming.forEach(function (c) { known[c.challengeId] = true; });
    after.incoming.forEach(function (c) {
      if (!known[c.challengeId]) lines.push(who(c.challengerUsername, c.challengerWallet) + ' challenged you.');
    });
    var running = {};
    before.active.forEach(function (c) { running[c.contestId] = true; });
    after.active.forEach(function (c) {
      if (!running[c.contestId] && !told[c.contestId]) lines.push('Contest #' + c.contestId + ' started.');
    });
    after.history.forEach(function (c) {
      if (running[c.contestId]) lines.push('Contest #' + c.contestId + ' is complete.');
    });
    return lines.length ? lines.join(' ') : null;
  }

  function signature(x) {
    return JSON.stringify([x.walletId, x.incoming, x.outgoing, x.active, x.history, x.creatures]);
  }

  function apply(data, extra) {
    var s = store.get().contests;
    var w = store.get().wallet;
    if (w.status !== 'connected' || data.walletId !== w.address) return;
    var before = s.status === 'ready' ? s : null;
    var patch = {
      status: 'ready',
      walletId: data.walletId,
      incoming: data.incoming || [],
      outgoing: data.outgoing || [],
      active: data.active || [],
      history: data.history || [],
      creatures: data.creatures || [],
      clockOffset: data.serverNow ? new Date(data.serverNow).getTime() - Date.now() : 0,
    };
    var note = changes(before, patch);
    if (note) patch.notice = note;
    // Nothing changed: leave the screen alone (an open picker stays open).
    if (before && !extra && !note && signature(patch) === signature(before)) return;
    store.update('contests', Object.assign(patch, extra || {}));
  }

  async function load() {
    if (store.get().wallet.status !== 'connected') return;
    var seq = ++loadSeq;
    lastFetch = Date.now();
    if (store.get().contests.status === 'idle' || store.get().contests.status === 'error') store.update('contests', { status: 'loading' });
    try {
      var res = await wallet.api('/api/contests');
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var data = await res.json();
      if (seq !== loadSeq) return;
      apply(data);
    } catch (err) {
      if (seq !== loadSeq) return;
      if (store.get().contests.status !== 'ready') store.update('contests', { status: 'error' });
    }
  }

  function ensure() {
    var state = store.get();
    if (state.wallet.status !== 'connected') return;
    var s = state.contests;
    if (s.status === 'loading' || s.status === 'error') return;
    if (s.status === 'ready' && s.walletId === state.wallet.address) return;
    load();
  }

  // One write at a time; the answer is the whole overview again.
  async function request(kind, path, body, noticeFor) {
    var s = store.get().contests;
    if (s.pending) return false;
    store.update('contests', { pending: kind, notice: null, error: null });
    try {
      var res = await wallet.api(path, { method: 'POST', body: body || {} });
      var data = await res.json().catch(function () { return {}; });
      if (!res.ok) {
        store.update('contests', { pending: null, error: data.message || 'That didn\'t work. Try again.' });
        load(); // show what changed (the other player, another tab)
        return false;
      }
      loadSeq++; // an older background answer must not overwrite this one
      apply(data, { pending: null, notice: noticeFor(data), error: null });
      if (store.get().contests.pending) store.update('contests', { pending: null });
      return data;
    } catch (err) {
      store.update('contests', { pending: null, error: 'Couldn\'t reach HOMESTEAD. Check your connection and try again.' });
      return false;
    }
  }

  async function challenge() {
    var creatureId = Number(form.creatureId);
    var opponent = String(form.opponent || '').trim();
    if (!creatureId) { store.update('contests', { error: 'Choose your Creature.', notice: null }); return; }
    if (!opponent) { store.update('contests', { error: 'Who do you want to challenge?', notice: null }); return; }
    var data = await request('challenge', '/api/contests/challenges', { creatureId: creatureId, opponent: opponent }, function (d) {
      return 'Challenge sent to ' + who(d.challenge.opponentUsername, d.challenge.opponentWallet) + '.';
    });
    if (data) { form.opponent = ''; store.update('contests', {}); }
  }

  function startAccept(challengeId) {
    form.acceptCreatureId = null;
    store.update('contests', { accepting: challengeId, notice: null, error: null });
  }
  function stopAccept() {
    store.update('contests', { accepting: null });
  }

  async function accept(challengeId) {
    var creatureId = Number(form.acceptCreatureId);
    if (!creatureId) { store.update('contests', { error: 'Choose your Creature.', notice: null }); return; }
    var data = await request('accept:' + challengeId, '/api/contests/challenges/' + Number(challengeId) + '/accept', { creatureId: creatureId }, function (d) {
      return 'Contest #' + d.contest.contestId + ' started.';
    });
    if (data) {
      store.update('contests', { accepting: null });
      if (window.HOMESTEAD_APP) window.HOMESTEAD_APP.navigate('/contests/' + Number(data.contest.contestId));
    }
  }

  function decline(challengeId) {
    return request('decline:' + challengeId, '/api/contests/challenges/' + Number(challengeId) + '/decline', {}, function () {
      return 'Challenge declined.';
    });
  }

  function cancel(challengeId) {
    return request('cancel:' + challengeId, '/api/contests/challenges/' + Number(challengeId) + '/cancel', {}, function () {
      return 'Challenge cancelled.';
    });
  }

  // The Contest at /contests/<id>. quiet: refresh without the loading screen.
  async function view(id, force, quiet) {
    var v = store.get().contests.viewed;
    if (!force && v.id === id && v.status !== 'error') return;
    var seq = ++viewSeq;
    lastViewFetch = Date.now();
    if (!quiet || v.id !== id) store.update('contests', { viewed: { status: 'loading', id: id, contest: null, walletId: null, clockOffset: 0 } });
    try {
      var res = await wallet.api('/api/contests/' + id);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      var data = await res.json();
      if (seq !== viewSeq) return;
      var next = {
        status: data.contest ? 'ready' : 'missing', id: id, contest: data.contest, walletId: data.walletId,
        clockOffset: data.serverNow ? new Date(data.serverNow).getTime() - Date.now() : 0,
      };
      var cur = store.get().contests.viewed;
      if (quiet && cur.status === next.status && JSON.stringify(cur.contest) === JSON.stringify(next.contest)) return;
      var wasActive = cur.contest && cur.contest.status === 'ACTIVE';
      store.update('contests', { viewed: next });
      // It just finished: the balance and lists changed too.
      if (wasActive && data.contest && data.contest.status === 'COMPLETED') {
        if (window.HOMESTEAD_STEAD) window.HOMESTEAD_STEAD.load();
        load();
      }
    } catch (err) {
      if (seq !== viewSeq) return;
      if (!quiet) store.update('contests', { viewed: Object.assign({}, store.get().contests.viewed, { status: 'error' }) });
    }
  }

  // Prefill the challenge form (from a Creature's profile).
  function prefill(values) {
    if (values.creatureId) form.creatureId = Number(values.creatureId);
    if (values.opponent) form.opponent = String(values.opponent);
    store.update('contests', { notice: null, error: null, accepting: null });
  }

  function clearMessages() {
    var s = store.get().contests;
    if (s.notice || s.error || s.accepting) store.update('contests', { notice: null, error: null, accepting: null });
  }

  // Typing and choosing go into `form`, without a re-render.
  document.addEventListener('input', function (e) {
    var key = e.target && e.target.dataset && e.target.dataset.contestInput;
    if (key) form[key] = e.target.value;
  });
  document.addEventListener('change', function (e) {
    var key = e.target && e.target.dataset && e.target.dataset.contestInput;
    if (key) form[key] = e.target.value;
  });
  document.addEventListener('submit', function (e) {
    if (e.target && e.target.id === 'contest-challenge-form') { e.preventDefault(); challenge(); }
  });

  // Countdowns tick in place (no re-render), and a running Contest whose
  // time is up is asked for again at once.
  function tick() {
    var s = store.get().contests;
    var now = Date.now();
    var due = false;
    document.querySelectorAll('[data-countdown]').forEach(function (el) {
      var offset = Number(el.dataset.offset) || 0;
      var left = Math.max(0, Math.ceil((new Date(el.dataset.countdown).getTime() - (now + offset)) / 1000));
      if (left === 0) due = true;
      el.textContent = Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0');
    });
    if (store.get().wallet.status !== 'connected' && !viewedId()) return;
    if (document.hidden) return;
    var id = viewedId();
    if (id && s.viewed.id === id && s.viewed.status === 'ready' && s.viewed.contest && s.viewed.contest.status === 'ACTIVE') {
      if (due ? now - lastViewFetch > 1500 : now - lastViewFetch > 5000) view(id, true, true);
    }
    if (store.get().wallet.status !== 'connected') return;
    var every = onContestScreen() ? (due ? 1500 : 4000) : 20000;
    if (s.status === 'ready' && now - lastFetch > every) load();
  }
  setInterval(tick, 1000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) tick(); });

  // Follow the wallet: a different wallet starts over.
  var lastKey = null;
  store.subscribe(function (state) {
    var key = state.wallet.status + ':' + state.wallet.address;
    if (key === lastKey) return;
    lastKey = key;
    if (state.wallet.status === 'connecting') return;
    var fresh = store.createInitialState().contests;
    fresh.viewed = state.contests.viewed;
    store.update('contests', fresh);
    form = { creatureId: null, opponent: '', acceptCreatureId: null };
    if (state.wallet.status === 'connected') load();
    var id = viewedId();
    if (id) view(id, true, true);
  });

  window.HOMESTEAD_CONTESTS = {
    load: load, ensure: ensure, view: view, challenge: challenge, startAccept: startAccept, stopAccept: stopAccept,
    accept: accept, decline: decline, cancel: cancel, prefill: prefill, clearMessages: clearMessages,
    form: function () { return form; }, who: who,
  };
})();
