// HOMESTEAD player suggestions for the Opponent field of the challenge form:
// typing a username (with or without "@") lists matching Homeroom players
// under the field. Arrow keys move through them, Enter or a tap picks one,
// Escape closes the list. A wallet address (ut1…) is left alone.
//
// The names come from the platform's user directory through the bridge
// (usernode.searchUsers, a prefix match). It answers only inside Homeroom; a
// refusal (opened standalone) simply shows no list, and typing still works.
(function () {
  var INPUT_ID = 'contest-opponent';
  var LIST_ID = 'contest-opponent-suggestions';
  var LIMIT = 5;
  var DEBOUNCE_MS = 200;
  var HANDLE = /^@?([A-Za-z0-9_.-]{1,40})$/;
  var WALLET_START = /^ut1/i;

  var timer = null;
  var seq = 0;
  var picking = false; // the input event pick() sends itself
  var cache = {}; // prefix (lower case) -> [{ id, username }]
  var shown = { query: null, users: [], active: -1 };

  // The prefix to search for, or null when the text is not a username.
  function prefixOf(value) {
    var text = String(value || '').trim();
    if (!text || WALLET_START.test(text)) return null;
    var m = HANDLE.exec(text);
    return m ? m[1] : null;
  }

  function input() { return document.getElementById(INPUT_ID); }

  function close() {
    shown = { query: null, users: [], active: -1 };
    var list = document.getElementById(LIST_ID);
    if (list) list.remove();
    var el = input();
    if (el) { el.setAttribute('aria-expanded', 'false'); el.removeAttribute('aria-activedescendant'); }
  }

  function draw() {
    var el = input();
    var old = document.getElementById(LIST_ID);
    if (old) old.remove();
    if (!el || !shown.users.length) { close(); return; }
    var list = document.createElement('ul');
    list.id = LIST_ID;
    list.className = 'list absolute inset-x-0 top-full z-20 mt-1';
    list.setAttribute('role', 'listbox');
    list.setAttribute('aria-label', 'Players');
    list.setAttribute('data-opponent-suggestions', '');
    shown.users.forEach(function (u, i) {
      var row = document.createElement('li');
      row.id = LIST_ID + '-' + i;
      row.className = 'list-row cursor-pointer text-body' + (i === shown.active ? ' bg-raised' : ' hover:bg-raised');
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', i === shown.active ? 'true' : 'false');
      row.dataset.username = u.username;
      var name = document.createElement('span');
      name.className = 'font-bold';
      name.textContent = '@' + u.username;
      row.appendChild(name);
      list.appendChild(row);
    });
    el.insertAdjacentElement('afterend', list);
    el.setAttribute('aria-expanded', 'true');
    if (shown.active >= 0) el.setAttribute('aria-activedescendant', LIST_ID + '-' + shown.active);
    else el.removeAttribute('aria-activedescendant');
  }

  function show(query, users) {
    var el = input();
    if (!el || document.activeElement !== el || prefixOf(el.value) !== query) return;
    // An exact match already typed needs no list.
    var exact = users.length === 1 && users[0].username.toLowerCase() === query.toLowerCase();
    shown = { query: query, users: exact ? [] : users.slice(0, LIMIT), active: -1 };
    draw();
  }

  function search(query) {
    var key = query.toLowerCase();
    if (cache[key]) { show(query, cache[key]); return; }
    var api = window.usernode;
    if (!api || typeof api.searchUsers !== 'function') { close(); return; }
    var mine = ++seq;
    Promise.resolve()
      .then(function () { return api.searchUsers(query, { limit: LIMIT }); })
      .then(function (data) {
        var users = (data && Array.isArray(data.users) ? data.users : []).filter(function (u) {
          return u && typeof u.username === 'string';
        });
        cache[key] = users;
        if (mine === seq) show(query, users);
      })
      .catch(function () { if (mine === seq) close(); }); // no shell: no list, typing still works
  }

  function pick(username) {
    var el = input();
    if (!el) return;
    el.value = '@' + username;
    // Let contests.js keep the value the same way as typing does.
    picking = true;
    try { el.dispatchEvent(new Event('input', { bubbles: true })); } finally { picking = false; }
    clearTimeout(timer);
    seq++;
    close();
    el.focus({ preventScroll: true });
  }

  document.addEventListener('input', function (e) {
    if (!e.target || e.target.id !== INPUT_ID || picking) return;
    clearTimeout(timer);
    var query = prefixOf(e.target.value);
    if (!query) { seq++; close(); return; }
    timer = setTimeout(function () { search(query); }, DEBOUNCE_MS);
  });

  document.addEventListener('keydown', function (e) {
    if (!e.target || e.target.id !== INPUT_ID || !shown.users.length) return;
    var n = shown.users.length;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      shown.active = (shown.active + 1) % n;
      draw();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      shown.active = shown.active <= 0 ? n - 1 : shown.active - 1;
      draw();
    } else if (e.key === 'Enter' && shown.active >= 0) {
      e.preventDefault(); // pick, don't send the challenge yet
      pick(shown.users[shown.active].username);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      seq++;
      close();
    }
  });

  // pointerdown, so the field keeps focus and the pick lands before blur.
  document.addEventListener('pointerdown', function (e) {
    var row = e.target && e.target.closest && e.target.closest('#' + LIST_ID + ' [data-username]');
    if (!row) return;
    e.preventDefault();
    pick(row.dataset.username);
  });

  document.addEventListener('focusout', function (e) {
    if (e.target && e.target.id === INPUT_ID) {
      // A re-render replaces the field; render() focuses the new one again.
      setTimeout(function () {
        if (document.activeElement && document.activeElement.id === INPUT_ID) return;
        seq++;
        close();
      }, 0);
    }
  });

  // After the screen re-renders (another player's move arriving), put an
  // open list back under the new field.
  function restore() {
    if (shown.users.length && input()) draw();
  }

  window.HOMESTEAD_USER_SUGGEST = { restore: restore, prefixOf: prefixOf };
})();
