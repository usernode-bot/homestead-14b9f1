// HOMESTEAD Contest screens: the Contests screen (challenge a player, the
// challenges for you, running Contests, sent challenges, history) and one
// Contest's result with its log.
//
// Everything shown is what the server stored (lib/contests.js); nothing here
// works out a turn, a winner or a reward. Creature names, usernames and log
// lines are typed or derived from what people typed, so they are never
// written into this HTML: text(value) leaves an empty <span data-t> and
// fill(root) sets each one as text after the screen renders.
(function () {
  var cfg = window.HOMESTEAD_CONTEST_CONFIG;
  var creatureCfg = window.HOMESTEAD_CREATURE_CONFIG;
  var cards = window.HOMESTEAD_CREATURE_CARD;
  var steadConfig = window.HOMESTEAD_STEAD_CONFIG;
  var walletLib = window.HOMESTEAD_WALLET;

  var texts = [];
  function text(value, cls) {
    texts.push(String(value == null ? '' : value));
    return '<span' + (cls ? ' class="' + cls + '"' : '') + ' data-t="' + (texts.length - 1) + '"></span>';
  }
  function fill(root) {
    var values = texts;
    root = root || document;
    root.querySelectorAll('[data-t]').forEach(function (el) {
      el.textContent = values[Number(el.dataset.t)] || '';
    });
    // What the person typed goes back in as a value, never as HTML.
    var input = root.querySelector('#contest-opponent');
    if (input && window.HOMESTEAD_CONTESTS) input.value = window.HOMESTEAD_CONTESTS.form().opponent || '';
    // An open list of player suggestions goes back under the new field.
    if (input && window.HOMESTEAD_USER_SUGGEST) window.HOMESTEAD_USER_SUGGEST.restore();
  }
  function reset() { texts = []; }

  function who(username, address) {
    return username ? '@' + username : walletLib.shortAddress(address);
  }
  function speciesLabel(c) {
    var sp = creatureCfg.byId(creatureCfg.SPECIES, c.species);
    return sp ? sp.label : 'Creature';
  }
  function countdown(iso, offset) {
    return '<span class="font-black tabular-nums" data-countdown="' + new Date(iso).toISOString() + '" data-offset="' + Number(offset || 0) + '">…</span>';
  }
  function stead(n) { return '+' + steadConfig.format(n) + ' ' + steadConfig.NAME; }
  function hours(n) { return Number(n) + (Number(n) === 1 ? ' hour' : ' hours'); }

  // The viewer's side of a Contest: 'a', 'b', or null for anyone else.
  function sideOf(contest, walletId) {
    if (!walletId) return null;
    if (contest.playerA === walletId) return 'a';
    if (contest.playerB === walletId) return 'b';
    return null;
  }

  function messages(s) {
    return (s.notice ? '<p class="mb-4 text-body font-bold text-accent" role="status" data-contest-notice>' + text(s.notice) + '</p>' : '') +
      (s.error ? '<p class="mb-4 text-body text-danger" role="alert" data-contest-error>' + text(s.error) + '</p>' : '');
  }

  var AVAILABILITY = { working: 'Working', in_contest: 'In a contest' };

  // A <select> of this wallet's Creatures. Busy ones are listed but can't be
  // chosen. `key` is the form field it fills (contests.js).
  function creaturePicker(id, key, creatures, chosen, label) {
    var options = '<option value="">Choose a Creature</option>' + creatures.map(function (c) {
      var busy = c.availability && c.availability.status !== 'ready';
      // Option text can't hold markup, so the name goes in as an attribute-safe label set by fill().
      return '<option value="' + Number(c.creatureId) + '"' + (Number(chosen) === c.creatureId && !busy ? ' selected' : '') + (busy ? ' disabled' : '') +
        ' data-t="' + (texts.push(c.name + ' · ' + speciesLabel(c) + (busy ? ' (' + AVAILABILITY[c.availability.status] + ')' : '')) - 1) + '"></option>';
    }).join('');
    return '<label for="' + id + '" class="block text-small text-muted">' + label + '</label>' +
      '<select id="' + id + '" class="field mt-1" data-contest-input="' + key + '">' + options + '</select>';
  }

  function connectState(heading) {
    return heading +
      '<section class="collectible state-empty max-w-3xl py-14" data-empty="contests">' +
        '<p class="text-heading">Connect your wallet to compete.</p>' +
        '<p class="max-w-sm text-body text-muted">Contests are between the wallets linked to two Homeroom accounts.</p>' +
        '<button type="button" class="btn-secondary mt-2" data-action="connect">CONNECT WALLET</button>' +
      '</section>';
  }

  function challengePanel(s, form) {
    var free = s.creatures.filter(function (c) { return c.availability && c.availability.status === 'ready'; });
    var body;
    if (!s.creatures.length) {
      body = '<p class="mt-2 text-body text-muted">You need a Creature to compete.</p>' +
        '<a href="/" data-nav class="btn-secondary mt-4">Go to Genesis</a>';
    } else {
      var chosen = form.creatureId;
      if (chosen == null && free.length) chosen = free[0].creatureId;
      if (chosen != null) form.creatureId = chosen;
      var busy = s.pending === 'challenge';
      body =
        '<form id="contest-challenge-form" class="mt-4 grid gap-4" novalidate>' +
          '<div>' + creaturePicker('contest-creature', 'creatureId', s.creatures, chosen, 'Your Creature') + '</div>' +
          '<div><label for="contest-opponent" class="block text-small text-muted">Opponent</label>' +
            '<div class="relative"><input id="contest-opponent" class="field mt-1" type="text" autocomplete="off" spellcheck="false" autocapitalize="off" placeholder="@username or ut1… wallet address" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-controls="contest-opponent-suggestions" data-contest-input="opponent" data-keep-value></div>' +
            '<p class="mt-1 text-small text-muted">Their Homeroom username, or the wallet address that owns their Creature.</p></div>' +
          '<div><button type="submit" class="btn-primary" data-action="contest-send"' + (busy || !free.length ? ' disabled' : '') + '>' + (busy ? 'SENDING…' : 'SEND CHALLENGE') + '</button>' +
            (!free.length ? '<p class="mt-2 text-small text-muted">All your Creatures are busy right now.</p>' : '') + '</div>' +
        '</form>';
    }
    return '<section class="collectible" id="contest-challenge">' +
      '<span class="sticker absolute -top-3 left-4">1 VS 1</span>' +
      '<h2 class="text-title font-black tracking-tight">CHALLENGE A PLAYER</h2>' +
      body +
    '</section>';
  }

  function incomingList(s, form) {
    if (!s.incoming.length) return '';
    return '<section class="mt-8" data-contest-incoming><h2 class="section-label">Challenges for you</h2><ul class="list">' + s.incoming.map(function (ch) {
      var c = ch.challengerCreature;
      var id = Number(ch.challengeId);
      var open = s.accepting === ch.challengeId;
      var busy = !!s.pending;
      if (open && form.acceptCreatureId == null) {
        var firstFree = s.creatures.find(function (x) { return x.availability && x.availability.status === 'ready'; });
        if (firstFree) form.acceptCreatureId = firstFree.creatureId;
      }
      var head = '<div class="flex items-center gap-3">' +
        (c ? cards.art(c, 'h-14 w-14') : '') +
        '<div class="min-w-0">' +
          '<p class="text-body">' + text(who(ch.challengerUsername, ch.challengerWallet), 'font-bold') + ' wants to compete with you.</p>' +
          (c ? '<p class="mt-1 flex flex-wrap items-center gap-2 text-small">' + text(c.name, 'font-bold') + '<span class="text-muted">' + speciesLabel(c) + '</span>' + cards.rarityBadge(c) + '</p>' : '') +
        '</div></div>';
      var actions = open
        ? '<div class="grid gap-3" data-contest-accepting="' + id + '">' +
            '<div>' + creaturePicker('contest-accept-creature', 'acceptCreatureId', s.creatures, form.acceptCreatureId, 'Choose your Creature') + '</div>' +
            '<div class="flex flex-wrap gap-2">' +
              '<button type="button" class="btn-secondary" data-action="contest-accept" data-challenge-id="' + id + '"' + (busy ? ' disabled' : '') + '>' + (s.pending === 'accept:' + id ? 'ACCEPTING…' : 'ACCEPT CONTEST') + '</button>' +
              '<button type="button" class="btn-secondary" data-action="contest-accept-cancel"' + (busy ? ' disabled' : '') + '>BACK</button>' +
            '</div></div>'
        : '<div class="flex flex-wrap gap-2">' +
            '<button type="button" class="btn-secondary" data-action="contest-accept-start" data-challenge-id="' + id + '"' + (busy ? ' disabled' : '') + '>ACCEPT</button>' +
            '<button type="button" class="btn-secondary" data-action="contest-decline" data-challenge-id="' + id + '"' + (busy ? ' disabled' : '') + '>' + (s.pending === 'decline:' + id ? 'DECLINING…' : 'DECLINE') + '</button>' +
          '</div>';
      var expiry = '<p class="text-small text-muted" data-challenge-expiry>Answer within ' + hours(cfg.CHALLENGE_EXPIRES_HOURS) + '. After that this challenge expires and simply goes away: nothing is lost.</p>';
      return '<li class="list-row flex-col items-stretch gap-3" data-challenge="' + id + '">' + head + expiry + actions + '</li>';
    }).join('') + '</ul></section>';
  }

  function vsLine(contest, side) {
    var me = side === 'b' ? contest.snapshotB : contest.snapshotA;
    var rival = side === 'b' ? contest.snapshotA : contest.snapshotB;
    return text(me.name, 'font-bold') + ' <span class="text-muted">vs</span> ' + text(rival.name, 'font-bold');
  }

  function activeList(s) {
    if (!s.active.length) return '';
    return '<section class="mt-8" data-contest-active><h2 class="section-label">Running now</h2><ul class="list">' + s.active.map(function (c) {
      var side = sideOf(c, s.walletId);
      return '<li><a href="/contests/' + Number(c.contestId) + '" data-nav class="list-row justify-between gap-3 hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus" data-contest-row="' + Number(c.contestId) + '">' +
        '<span class="min-w-0"><span class="block">' + vsLine(c, side) + '</span><span class="block text-small text-muted">Contest #' + Number(c.contestId) + '</span></span>' +
        '<span class="shrink-0 text-small text-muted">Result in ' + countdown(c.endsAt, s.clockOffset) + '</span>' +
      '</a></li>';
    }).join('') + '</ul></section>';
  }

  var STATUS_LABEL = { PENDING: 'Waiting', ACCEPTED: 'Accepted', DECLINED: 'Declined', EXPIRED: 'Expired', CANCELLED: 'Cancelled' };

  function outgoingList(s) {
    if (!s.outgoing.length) return '';
    return '<section class="mt-8" data-contest-outgoing><h2 class="section-label">Sent challenges</h2><ul class="list">' + s.outgoing.map(function (ch) {
      var id = Number(ch.challengeId);
      var c = ch.challengerCreature;
      var right = ch.status === 'PENDING'
        ? '<button type="button" class="btn-secondary shrink-0" data-action="contest-cancel" data-challenge-id="' + id + '"' + (s.pending ? ' disabled' : '') + '>' + (s.pending === 'cancel:' + id ? 'CANCELLING…' : 'CANCEL') + '</button>'
        : ch.status === 'ACCEPTED' && ch.contestId
          ? '<a href="/contests/' + Number(ch.contestId) + '" data-nav class="btn-secondary shrink-0">View contest</a>'
          : '';
      return '<li class="list-row justify-between gap-3" data-sent-challenge="' + id + '" data-status="' + ch.status + '">' +
        '<span class="min-w-0"><span class="block">' + (c ? text(c.name, 'font-bold') + ' vs ' : '') + text(who(ch.opponentUsername, ch.opponentWallet), 'font-bold') + '</span>' +
          '<span class="block text-small text-muted">' + STATUS_LABEL[ch.status] + '</span></span>' +
        right +
      '</li>';
    }).join('') + '</ul></section>';
  }

  function historyList(s) {
    var heading = '<h2 class="section-label">Contest history</h2>';
    if (!s.history.length) {
      return '<section class="mt-8">' + heading + '<div class="list"><div class="state-empty" data-empty="contest-history">' +
        '<p class="text-heading">No contests yet.</p>' +
        '<p class="max-w-sm text-body text-muted">Challenge a player above. Finished contests show here.</p>' +
      '</div></div></section>';
    }
    return '<section class="mt-8" data-contest-history>' + heading + '<ul class="list">' + s.history.map(function (c) {
      var side = sideOf(c, s.walletId);
      var won = c.winnerPlayer === s.walletId;
      var reward = c.result && c.result.rewards ? c.result.rewards[side] : 0;
      return '<li><a href="/contests/' + Number(c.contestId) + '" data-nav class="list-row justify-between gap-3 hover:bg-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus" data-contest-row="' + Number(c.contestId) + '" data-result="' + (won ? 'WIN' : 'LOSS') + '">' +
        '<span class="min-w-0"><span class="block">' + vsLine(c, side) + '</span>' +
          '<span class="block text-small text-muted">' + Number(c.turnNumber) + (c.turnNumber === 1 ? ' turn' : ' turns') + ' · Contest #' + Number(c.contestId) + '</span></span>' +
        '<span class="shrink-0 text-right"><span class="block font-black' + (won ? ' text-accent' : '') + '">' + (won ? 'WIN' : 'LOSS') + '</span>' +
          '<span class="block text-small font-bold tabular-nums">' + stead(reward) + '</span></span>' +
      '</a></li>';
    }).join('') + '</ul></section>';
  }

  function howItWorks() {
    return '<section class="mt-8"><h2 class="section-label">How contests work</h2><ul class="list">' +
      '<li class="list-row"><p class="text-body">The Creatures take turns showing off a trick. Keeping up costs the rival Stamina: the trickster\'s Attack minus the rival\'s Defense, at least ' + cfg.MIN_POINTS + '.</p></li>' +
      '<li class="list-row"><p class="text-body">Higher Speed goes first. Luck gives a chance of a show-stopper worth ' + cfg.CRIT_MULTIPLIER + ' times the points. Condition counts: Good 100%, Fair ' + Math.round(cfg.CONDITION_MULTIPLIER.FAIR * 100) + '%, Poor ' + Math.round(cfg.CONDITION_MULTIPLIER.POOR * 100) + '%.</p></li>' +
      '<li class="list-row" data-how-expiry><p class="text-body">A challenge waits ' + hours(cfg.CHALLENGE_EXPIRES_HOURS) + ' for an answer. If it isn\'t accepted by then it expires: no STEAD is taken, no Creature or stats change, and you can send a new one.</p></li>' +
      '<li class="list-row"><p class="text-body">Stats are saved when a challenge is accepted. For ' + cfg.CONTEST_DURATION_SECONDS + ' seconds both Creatures can\'t work, train or change Gear, then the result is in.</p></li>' +
      '<li class="list-row"><p class="text-body">The winner gets ' + stead(cfg.WIN_REWARD) + ', the other player ' + stead(cfg.LOSS_REWARD) + '. Nobody loses a Creature and no stats change.</p></li>' +
    '</ul></section>';
  }

  // /contests
  function page(state, heading) {
    reset();
    if (state.wallet.status !== 'connected') return connectState(heading);
    var s = state.contests;
    if (s.status === 'error') {
      return heading + '<section class="collectible state-error max-w-3xl">' +
        '<p class="text-heading">Couldn\'t load your contests.</p>' +
        '<p class="max-w-sm text-body text-muted">Your Creatures are safe. Check your connection and try again.</p>' +
        '<button type="button" class="btn-secondary mt-2" data-action="contests-retry">Retry</button>' +
      '</section>';
    }
    if (s.status !== 'ready') {
      return heading + '<div class="max-w-3xl" aria-busy="true"><span class="sr-only">Loading your contests</span>' +
        '<section class="collectible"><div class="skeleton h-8 w-56"></div><div class="skeleton mt-4 h-11"></div><div class="skeleton mt-4 h-11"></div><div class="skeleton mt-4 h-11 w-44"></div></section>' +
        '<div class="skeleton mt-8 h-24 rounded-xl"></div></div>';
    }
    var form = window.HOMESTEAD_CONTESTS.form();
    return heading + '<div class="max-w-3xl" data-contests>' +
      messages(s) +
      incomingList(s, form) +
      (s.incoming.length ? '<div class="mt-8">' + challengePanel(s, form) + '</div>' : challengePanel(s, form)) +
      activeList(s) +
      outgoingList(s) +
      historyList(s) +
      howItWorks() +
    '</div>';
  }

  function sideBlock(snap, username, won, done) {
    return '<div class="flex min-w-0 flex-1 flex-col items-center gap-2 text-center">' +
      cards.art(snap, 'h-24 w-24 sm:h-32 sm:w-32') +
      '<p class="max-w-full break-words text-heading font-black">' + text(snap.name) + '</p>' +
      '<p class="text-small text-muted">' + text(who(username, snap.owner)) + '</p>' +
      (done && won ? '<span class="sticker">WINNER</span>' : '') +
    '</div>';
  }

  function statsTable(contest) {
    var a = contest.snapshotA, b = contest.snapshotB;
    var rows = creatureCfg.STATS.map(function (s) {
      return '<li class="list-row justify-between gap-3"><span class="w-16 font-bold tabular-nums">' + a.effectiveStats[s.key] + '</span>' +
        '<span class="text-small font-bold text-muted">' + (s.key === 'hp' ? 'HP (STAMINA)' : s.label.toUpperCase()) + '</span>' +
        '<span class="w-16 text-right font-bold tabular-nums">' + b.effectiveStats[s.key] + '</span></li>';
    }).join('') +
      '<li class="list-row justify-between gap-3"><span class="w-16 font-bold">' + a.condition + '</span><span class="text-small font-bold text-muted">CONDITION</span><span class="w-16 text-right font-bold">' + b.condition + '</span></li>';
    return '<section class="mt-8" data-contest-snapshot><h2 class="section-label">Stats saved at the start</h2><ul class="list">' + rows + '</ul>' +
      '<p class="mt-2 px-1 text-small text-muted">Effective stats (base, training and Gear) when the challenge was accepted. Later changes don\'t affect this contest.</p></section>';
  }

  // /contests/<id>
  function detail(state, heading) {
    reset();
    var v = state.contests.viewed;
    if (v.status === 'missing') {
      return heading + '<section class="collectible state-empty max-w-3xl py-14" data-empty="contest-missing">' +
        '<p class="text-heading">No contest has that number.</p>' +
        '<a href="/contests" data-nav class="btn-secondary mt-2">Go to Contests</a>' +
      '</section>';
    }
    if (v.status === 'error') {
      return heading + '<section class="collectible state-error max-w-3xl">' +
        '<p class="text-heading">Couldn\'t load this contest.</p>' +
        '<p class="max-w-sm text-body text-muted">Check your connection and try again.</p>' +
        '<button type="button" class="btn-secondary mt-2" data-action="contest-view-retry">Retry</button>' +
      '</section>';
    }
    if (v.status !== 'ready' || !v.contest) {
      return heading + '<section class="collectible max-w-3xl" aria-busy="true"><span class="sr-only">Loading this contest</span>' +
        '<div class="flex justify-around gap-4"><div class="skeleton h-32 w-32 rounded-2xl"></div><div class="skeleton h-32 w-32 rounded-2xl"></div></div>' +
        '<div class="skeleton mx-auto mt-6 h-8 w-48"></div></section>';
    }
    var c = v.contest;
    var side = sideOf(c, v.walletId);
    var done = c.status === 'COMPLETED';
    var r = c.result;
    var top;
    if (done) {
      var winnerSnap = c.winnerCreatureId === c.creatureAId ? c.snapshotA : c.snapshotB;
      var mine = side ? (r.winner === side ? 'WIN' : 'LOSS') : null;
      var other = side === 'a' ? 'b' : 'a';
      top =
        '<p class="mt-6 text-center text-title font-black tracking-tight" data-contest-winner="' + Number(c.winnerCreatureId) + '">' + text(String(winnerSnap.name).toUpperCase() + ' WINS') + '</p>' +
        (mine
          ? '<p class="mt-2 text-center" data-contest-you="' + mine + '"><span class="text-heading font-black' + (mine === 'WIN' ? ' text-accent' : '') + '">' + mine + '</span> ' +
              '<span class="text-heading font-black tabular-nums">' + stead(r.rewards[side]) + '</span></p>'
          : '') +
        '<ul class="list mt-6" data-contest-totals>' +
          '<li class="list-row justify-between"><span class="text-muted">Turns</span><span class="font-bold tabular-nums">' + Number(r.turns) + '</span></li>' +
          (side
            ? '<li class="list-row justify-between"><span class="text-muted">Points scored</span><span class="font-bold tabular-nums">' + Number(r.points[side]) + '</span></li>' +
              '<li class="list-row justify-between"><span class="text-muted">Points conceded</span><span class="font-bold tabular-nums">' + Number(r.points[other]) + '</span></li>' +
              '<li class="list-row justify-between"><span class="text-muted">Show-stoppers</span><span class="font-bold tabular-nums">' + Number(r.crits[side]) + '</span></li>'
            : '<li class="list-row justify-between">' + text(c.snapshotA.name, 'text-muted') + '<span class="font-bold tabular-nums">' + Number(r.points.a) + ' points</span></li>' +
              '<li class="list-row justify-between">' + text(c.snapshotB.name, 'text-muted') + '<span class="font-bold tabular-nums">' + Number(r.points.b) + ' points</span></li>') +
        '</ul>';
    } else {
      top = '<p class="mt-6 text-center text-body" role="status" data-contest-running>Contest in progress. Result in ' + countdown(c.endsAt, v.clockOffset) + '.</p>' +
        '<p class="mt-1 text-center text-small text-muted">Both Creatures are locked to this contest until then.</p>' +
        '<p class="mt-1 text-center text-small text-muted" data-contest-payout>When the time is up the result is in: the winner gets ' + stead(cfg.WIN_REWARD) + ', the other player ' + stead(cfg.LOSS_REWARD) + '.</p>';
    }
    var log = done
      ? '<section class="mt-8"><h2 class="section-label">Contest log</h2><ol class="list" data-contest-log>' + c.log.map(function (e) {
          var strong = e.kind === 'crit' || e.kind === 'win' || e.kind === 'out';
          return '<li class="list-row" data-log-kind="' + e.kind + '">' + text(e.text, strong ? 'font-bold' : '') + '</li>';
        }).join('') + '</ol></section>'
      : '';
    return heading + '<div class="max-w-3xl" data-contest="' + Number(c.contestId) + '" data-contest-status="' + c.status + '">' +
      '<section class="collectible">' +
        '<span class="sticker absolute -top-3 left-4">' + (done ? 'CONTEST COMPLETE' : 'CONTEST #' + Number(c.contestId)) + '</span>' +
        '<div class="flex items-start gap-2 pt-4 sm:gap-6">' +
          sideBlock(c.snapshotA, c.playerAUsername, c.winnerCreatureId === c.creatureAId, done) +
          '<span class="mt-10 shrink-0 text-title font-black text-punk sm:mt-14">VS</span>' +
          sideBlock(c.snapshotB, c.playerBUsername, c.winnerCreatureId === c.creatureBId, done) +
        '</div>' +
        top +
      '</section>' +
      log +
      statsTable(c) +
      '<p class="mt-6"><a href="/contests" data-nav class="btn-secondary">All contests</a></p>' +
    '</div>';
  }

  window.HOMESTEAD_CONTEST_VIEW = { page: page, detail: detail, fill: fill, who: who };
})();
