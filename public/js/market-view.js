// HOMESTEAD Marketplace screen, /marketplace (BUY) and /marketplace/sell
// (SELL). BUY: players' Resource listings, the app's Resource packs and food,
// with a search, category chips and a sort. SELL: this wallet's storage, the
// listing form and its own listings (edit, cancel).
//
// Everything shown is what the server answered (lib/marketplace.js) or the
// config files; nothing here decides a price or a rule. Searching, filtering
// and sorting only choose which of the answered rows show, and in what order.
// Players' names and the search typed are never written into this HTML:
// marketplace.js fillForm sets them as text after the screen renders.
(function () {
  var steadConfig = window.HOMESTEAD_STEAD_CONFIG;
  var foodConfig = window.HOMESTEAD_FOOD_CONFIG;
  var marketConfig = window.HOMESTEAD_MARKET_CONFIG;
  var homesteadConfig = window.HOMESTEAD_HOMESTEAD_CONFIG;
  var workConfig = window.HOMESTEAD_WORK_CONFIG;
  var walletLib = window.HOMESTEAD_WALLET;

  function fmt(n) { return Number(n).toLocaleString('en-US'); }
  function steadAmount(n) { return steadConfig.format(n) + ' ' + steadConfig.NAME; }
  function fmtDate(iso) {
    var d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function resourceLabel(key) {
    var r = homesteadConfig.RESOURCES.find(function (x) { return x.key === key; });
    return r ? r.label : key;
  }
  function lot(l) { return fmt(l.quantity) + ' ' + resourceLabel(l.resource); }

  // The price of one, from a price for `quantity`: whole numbers as they are,
  // anything else to at most two decimals.
  function priceEach(price, quantity) { return Number(price) / Number(quantity); }
  function formatEach(n) { return Number(n).toLocaleString('en-US', { maximumFractionDigits: 2 }); }
  function eachAmount(n) { return formatEach(n) + ' ' + steadConfig.NAME + ' each'; }

  // The Marketplace's Resource categories: one per Homestead building
  // (homestead-config.js BUILDINGS order), holding the Resources the Trade
  // that works there brings home (work-config.js TRADES), then "Other" for a
  // Resource no Trade produces. Derived, so a new Resource or building shows
  // up in the right place on its own. `keep` filters the Resources.
  function resourceCategories(keep) {
    var cats = homesteadConfig.BUILDINGS.map(function (b) { return { id: b.id, label: b.name, resources: [] }; });
    var other = { id: 'other', label: 'Other', resources: [] };
    homesteadConfig.RESOURCES.forEach(function (r) {
      if (keep && !keep(r)) return;
      var tradeId = Object.keys(workConfig.TRADES).find(function (t) {
        return Object.prototype.hasOwnProperty.call(workConfig.TRADES[t].perHour, r.key);
      });
      var building = tradeId ? workConfig.TRADES[tradeId].building : null;
      var cat = cats.find(function (c) { return c.id === building; }) || other;
      cat.resources.push(r);
    });
    return cats.concat(other).filter(function (c) { return c.resources.length; });
  }
  // The category a Resource is in: { id, label }.
  function categoryOf(key) {
    var cat = resourceCategories().find(function (c) { return c.resources.some(function (r) { return r.key === key; }); });
    return cat ? { id: cat.id, label: cat.label } : { id: 'other', label: 'Other' };
  }

  // BUY's search, category and sort. The chips are ALL, each category, FOOD.
  var SORTS = [
    { id: 'newest', label: 'Newest' },
    { id: 'each', label: 'Lowest price each' },
    { id: 'price', label: 'Lowest total price' },
    { id: 'quantity', label: 'Most first' },
  ];
  var DEFAULT_BROWSE = Object.freeze({ query: '', category: 'all', sort: 'newest' });
  function chips() {
    return [{ id: 'all', label: 'All' }]
      .concat(resourceCategories().map(function (c) { return { id: c.id, label: c.label }; }))
      .concat([{ id: 'food', label: 'Food' }]);
  }
  // A browse state as saved, with anything unknown back to its default.
  function normalizeBrowse(b) {
    b = b || {};
    return {
      query: typeof b.query === 'string' ? b.query.slice(0, 100) : '',
      category: chips().some(function (c) { return c.id === b.category; }) ? b.category : 'all',
      sort: SORTS.some(function (s) { return s.id === b.sort; }) ? b.sort : 'newest',
    };
  }

  function who(username, address) {
    return username ? '@' + username : walletLib.shortAddress(address);
  }
  function has(text, q) { return String(text || '').toLowerCase().indexOf(q) !== -1; }
  function needle(browse) { return String((browse && browse.query) || '').trim().toLowerCase(); }

  // Players' listings that match the search (Resource, category, seller) and
  // the chip. FOOD has no listings.
  function filterListings(listings, browse) {
    var q = needle(browse);
    var cat = (browse && browse.category) || 'all';
    if (cat === 'food') return [];
    return (listings || []).filter(function (l) {
      var c = categoryOf(l.resource);
      if (cat !== 'all' && c.id !== cat) return false;
      if (!q) return true;
      return has(resourceLabel(l.resource), q) || has(c.label, q) || has(who(l.sellerName, l.seller), q) || has(l.seller, q);
    });
  }
  // Newest is the server's order (newest first); the rest break ties newest first.
  function sortListings(listings, sort) {
    var rows = (listings || []).slice();
    var newest = function (a, b) { return Number(b.listingId) - Number(a.listingId); };
    var by = {
      each: function (a, b) { return priceEach(a.price, a.quantity) - priceEach(b.price, b.quantity) || newest(a, b); },
      price: function (a, b) { return Number(a.price) - Number(b.price) || newest(a, b); },
      quantity: function (a, b) { return Number(b.quantity) - Number(a.quantity) || newest(a, b); },
    }[sort] || newest;
    return rows.sort(by);
  }
  // The app's packs that match: [{ resource, label, pack, category }], in
  // config order, or by price each / total price for those sorts.
  function filterPacks(browse) {
    var q = needle(browse);
    var cat = (browse && browse.category) || 'all';
    if (cat === 'food') return [];
    var rows = [];
    resourceCategories(function (r) { return marketConfig.pack(r.key); }).forEach(function (c) {
      if (cat !== 'all' && c.id !== cat) return;
      c.resources.forEach(function (r) {
        if (q && !has(r.label, q) && !has(c.label, q)) return;
        rows.push({ resource: r.key, label: r.label, pack: marketConfig.pack(r.key), category: { id: c.id, label: c.label } });
      });
    });
    var sort = browse && browse.sort;
    if (sort === 'each') rows.sort(function (a, b) { return priceEach(a.pack.price, a.pack.size) - priceEach(b.pack.price, b.pack.size); });
    else if (sort === 'price') rows.sort(function (a, b) { return a.pack.price - b.pack.price; });
    return rows;
  }
  // The foods that match: only under ALL or FOOD.
  function filterFoods(browse) {
    var q = needle(browse);
    var cat = (browse && browse.category) || 'all';
    if (cat !== 'all' && cat !== 'food') return [];
    return foodConfig.FOODS.filter(function (f) { return !q || has(f.name, q) || has(f.description, q) || has('food', q); });
  }

  // ── Pieces ────────────────────────────────────────────────────────────
  function section(title, first, extra) {
    return '<h2 class="text-heading font-black' + (first ? '' : ' mt-10') + '">' + title + (extra || '') + '</h2>';
  }
  function countNote(n) { return ' <span class="text-small font-bold text-muted">· ' + fmt(n) + '</span>'; }
  // A row's name with its price sticker (and a status tag) beside it.
  function rowTitle(name, sticker, muted) {
    return '<span class="flex flex-wrap items-center gap-x-3 gap-y-1"><span class="text-body font-black tabular-nums' + (muted ? ' text-muted' : '') + '">' + name + '</span>' + sticker + '</span>';
  }
  // A small outlined status label: FOR SALE in lime, the others muted.
  function tag(label, live, attr) {
    return '<span class="inline-block rounded-md border px-2 py-0.5 text-small font-bold tracking-wide ' +
      (live ? 'border-accent text-accent' : 'border-line text-muted') + '"' + (attr || '') + '>' + label + '</span>';
  }
  function meta(parts) { return '<span class="mt-1 block text-small text-muted">' + parts.join(' · ') + '</span>'; }
  // Every BUY button has the same width, so they line up down each list.
  var ROW_BUTTON = 'w-28 shrink-0 sm:w-36';
  function buyButton(action, attrs, text, disabled) {
    return '<button type="button" class="btn-primary ' + ROW_BUTTON + '" data-action="' + action + '"' + attrs + (disabled ? ' disabled' : '') + '>' + text + '</button>';
  }
  function skeletonRows(label) {
    return '<ul class="list mt-3" aria-busy="true">' +
      '<li class="list-row"><span class="skeleton inline-block h-5 w-40"><span class="sr-only">' + label + '</span></span></li>' +
      '<li class="list-row"><span class="skeleton inline-block h-5 w-56"></span></li>' +
    '</ul>';
  }

  function marketTabs(active) {
    return '<nav aria-label="Marketplace" class="-mx-1 mb-6 overflow-x-auto px-1 py-1">' +
      '<ul class="flex gap-1" data-market-tabs>' +
        [{ id: 'buy', label: 'BUY', path: '/marketplace' }, { id: 'sell', label: 'SELL', path: '/marketplace/sell' }].map(function (t) {
          return '<li><a href="' + t.path + '" data-nav class="nav-tab" data-market-tab="' + t.id + '"' + (t.id === active ? ' aria-current="page"' : '') + '>' + t.label + '</a></li>';
        }).join('') +
      '</ul>' +
    '</nav>';
  }

  function marketNotice(m) {
    var n = m.notice;
    if (!n) return '';
    var text = '';
    if (n.kind === 'listed') text = 'Listed ' + lot(n.listing) + ' for ' + steadAmount(n.listing.price) + '.';
    else if (n.kind === 'relisted') text = 'Updated: ' + lot(n.listing) + ' for ' + steadAmount(n.listing.price) + '.';
    else if (n.kind === 'bought-listing') text = 'Bought ' + lot(n.listing) + ' for ' + steadAmount(n.listing.price) + '. It\'s in your storage.';
    else if (n.kind === 'bought-pack') text = 'Bought ' + fmt(n.pack.size) + ' ' + resourceLabel(n.pack.resource) + ' for ' + steadAmount(n.pack.price) + '. It\'s in your storage.';
    else if (n.kind === 'cancelled') text = 'Listing cancelled. ' + lot(n.listing) + ' went back to your storage.';
    else {
      var bought = foodConfig.food(n.foodId);
      if (bought) text = 'Bought 1 ' + bought.name + ' for ' + steadAmount(n.price) + '.';
    }
    return text ? '<p class="mb-4 text-body font-bold text-accent" role="status" data-market-notice>' + text + '</p>' : '';
  }

  // ── BUY ───────────────────────────────────────────────────────────────
  function browseBar(browse) {
    return '<div class="flex flex-wrap gap-2" data-market-browse-bar>' +
        '<label for="market-search" class="sr-only">Search the Marketplace</label>' +
        '<input id="market-search" type="search" class="field min-w-0 flex-1 basis-60" placeholder="Search Resources, food or sellers" autocomplete="off" maxlength="100" data-market-browse="query">' +
        '<label for="market-sort" class="sr-only">Sort</label>' +
        '<select id="market-sort" class="field w-auto shrink-0" data-market-browse="sort">' +
          SORTS.map(function (s) { return '<option value="' + s.id + '"' + (s.id === browse.sort ? ' selected' : '') + '>' + s.label + '</option>'; }).join('') +
        '</select>' +
      '</div>' +
      '<div class="-mx-1 mt-3 overflow-x-auto px-1 py-1">' +
        '<ul class="flex gap-1" data-market-chips aria-label="Categories">' +
          chips().map(function (c) {
            var on = c.id === browse.category;
            return '<li><button type="button" class="nav-tab border ' + (on ? 'border-transparent bg-accent text-on-accent hover:bg-accent hover:text-on-accent' : 'border-line') + '"' +
              ' data-action="market-category" data-category="' + c.id + '" data-market-chip="' + c.id + '" aria-pressed="' + on + '">' + c.label.toUpperCase() + '</button></li>';
          }).join('') +
        '</ul>' +
      '</div>';
  }

  function listingRow(l, m, connected, ready) {
    var id = Number(l.listingId);
    var cat = categoryOf(l.resource);
    var each = priceEach(l.price, l.quantity);
    var poor = ready && m.steadBalance != null && m.steadBalance < l.price;
    var open = Number(m.details) === id;
    var buy = '';
    if (connected) {
      var pending = m.pending === 'buy-listing:' + id;
      buy = buyButton('buy-listing', ' data-listing-id="' + id + '"', pending ? 'BUYING…' : poor ? 'Need ' + steadAmount(l.price) : 'BUY', !ready || m.pending || poor);
    }
    var details = '';
    if (open) {
      var p = marketConfig.pack(l.resource);
      var compare = '';
      if (p) {
        var packEach = priceEach(p.price, p.size);
        var word = each < packEach ? 'Cheaper than' : each > packEach ? 'Pricier than' : 'Same as';
        compare = word + ' the app\'s pack, ' + eachAmount(packEach);
      }
      details = '<dl class="grid basis-full grid-cols-2 gap-x-4 gap-y-2 border-t border-line pt-3 text-small sm:grid-cols-4" data-listing-details="' + id + '">' +
        '<div><dt class="text-muted">Listing</dt><dd class="font-bold tabular-nums">#' + id + '</dd></div>' +
        '<div><dt class="text-muted">Listed</dt><dd class="font-bold">' + (fmtDate(l.createdAt) || '—') + '</dd></div>' +
        '<div><dt class="text-muted">Price</dt><dd class="font-bold tabular-nums">' + eachAmount(each) + '</dd></div>' +
        '<div><dt class="text-muted">Seller</dt><dd class="font-bold break-all" data-listing-seller="' + id + '"></dd></div>' +
        (compare ? '<p class="col-span-2 sm:col-span-4" data-listing-compare>' + compare + '</p>' : '') +
      '</dl>';
    }
    return '<li class="list-row flex-wrap" data-listing="' + id + '" data-listing-resource="' + l.resource + '" data-market-category="' + cat.id + '"' +
        ' data-listing-state="' + (poor ? 'unaffordable' : 'available') + '">' +
      '<span class="min-w-0 flex-1 basis-48">' +
        rowTitle(lot(l), '<span class="sticker" data-listing-price="' + Number(l.price) + '">' + steadAmount(l.price) + '</span>', poor) +
        meta([cat.label, eachAmount(each), '<span data-listing-seller="' + id + '"></span>']) +
      '</span>' +
      '<span class="flex shrink-0 gap-2">' +
        '<button type="button" class="btn-secondary px-3" data-action="market-details" data-listing-id="' + id + '" aria-expanded="' + open + '">DETAILS</button>' +
        buy +
      '</span>' +
      details +
    '</li>';
  }

  function packRow(row, m, connected, ready) {
    var p = row.pack;
    var storage = m.storage && m.storage.storage;
    var left = ready ? Math.max(0, p.perDay - (Number(m.packsToday && m.packsToday[row.resource]) || 0)) : null;
    var have = ready ? Number(storage && storage[row.resource]) || 0 : null;
    var none = ready && left === 0;
    var poor = ready && m.steadBalance != null && m.steadBalance < p.price;
    var action = '';
    if (connected) {
      var pending = m.pending === 'buy-pack:' + row.resource;
      action = buyButton('buy-pack', ' data-pack="' + row.resource + '"', pending ? 'BUYING…' : none ? 'BUY' : poor ? 'Need ' + steadAmount(p.price) : 'BUY', !ready || m.pending || none || poor);
    }
    return '<li class="list-row flex-wrap" data-pack="' + row.resource + '" data-market-category="' + row.category.id + '"' +
        (left == null ? '' : ' data-packs-left="' + left + '"') + '>' +
      '<span class="min-w-0 flex-1 basis-48">' +
        rowTitle(fmt(p.size) + ' ' + row.label,
          '<span class="sticker" data-pack-price="' + p.price + '">' + steadAmount(p.price) + '</span>' + (none ? tag('SOLD OUT TODAY', false, ' data-sold-out') : ''),
          none || poor) +
        meta([row.category.label, eachAmount(priceEach(p.price, p.size)), left == null ? p.perDay + ' packs a day' : left + ' of ' + p.perDay + ' left today']) +
        (connected ? '<span class="mt-1 block text-small font-bold tabular-nums" data-pack-have="' + (have == null ? '' : have) + '">' +
          (have == null ? 'You have …' : 'You have ' + fmt(have)) + '</span>' : '') +
      '</span>' +
      action +
    '</li>';
  }

  function foodRow(f, m, connected, ready) {
    var owned = ready ? Number(m.owned[f.id]) || 0 : null;
    var full = ready && owned >= foodConfig.MAX_OWNED_PER_FOOD;
    var poor = ready && m.steadBalance != null && m.steadBalance < f.price;
    var action = '';
    if (connected) {
      var pending = m.pending === 'buy:' + f.id;
      action = buyButton('buy-food', ' data-food="' + f.id + '"', pending ? 'BUYING…' : full ? 'You have the most you can hold' : poor ? 'Need ' + steadAmount(f.price) : 'BUY', !ready || m.pending || full || poor);
    }
    return '<li class="list-row flex-wrap" data-food="' + f.id + '">' +
      '<span class="min-w-0 flex-1 basis-48">' +
        rowTitle(f.name, '<span class="sticker" data-food-price="' + f.price + '">' + steadAmount(f.price) + '</span>', full || poor) +
        '<span class="mt-1 block text-small text-muted">' + f.description + '</span>' +
        (connected ? '<span class="mt-1 block text-small font-bold tabular-nums" data-food-owned="' + (owned == null ? '' : owned) + '">' +
          (owned == null ? 'You have …' : 'You have ' + owned) + '</span>' : '') +
      '</span>' +
      action +
    '</li>';
  }

  function buyTab(state, m, connected, ready) {
    var browse = normalizeBrowse(m.browse);
    var q = needle(browse);
    var catLabel = (chips().find(function (c) { return c.id === browse.category; }) || {}).label;
    var out = browseBar(browse);
    var shown = 0;

    // From players.
    var players = '';
    if (browse.category !== 'food') {
      if (m.status === 'error' && !connected) {
        players = section('From players', false) +
          '<section class="collectible state-error mt-3">' +
            '<p class="text-heading">Couldn\'t load what\'s for sale.</p>' +
            '<button type="button" class="btn-secondary mt-2" data-action="marketplace-retry">Retry</button>' +
          '</section>';
        shown++;
      } else if (connected && m.status === 'error') {
        players = ''; // the error panel at the top says it
      } else if (m.status !== 'ready') {
        players = section('From players', false) + skeletonRows('Loading listings');
        shown++;
      } else {
        var rows = sortListings(filterListings(m.listings, browse), browse.sort);
        if (rows.length) {
          players = section('From players', false, countNote(rows.length)) +
            '<ul class="list mt-3" data-market-listings>' + rows.map(function (l) { return listingRow(l, m, connected, ready); }).join('') + '</ul>' +
            (m.listings.length >= marketConfig.LISTINGS_SHOWN ? '<p class="mt-2 px-1 text-small text-muted">Showing the newest ' + marketConfig.LISTINGS_SHOWN + ' listings.</p>' : '');
          shown += rows.length;
        } else if (!m.listings.length && !q) {
          players = section('From players', false) +
            '<p class="mt-2 px-1 text-small text-muted" data-empty="listings">No Resources for sale right now.' +
              (connected ? ' <a href="/marketplace/sell" data-nav class="font-bold text-accent underline">List yours on SELL.</a>' : '') + '</p>';
          shown++;
        } else if (!q) {
          players = section('From players', false) +
            '<p class="mt-2 px-1 text-small text-muted" data-empty="category-listings">No player listings in ' + catLabel + ' right now.</p>';
          shown++;
        }
      }
    }

    var packRows = filterPacks(browse);
    var packs = '';
    if (packRows.length) {
      packs = section('Resource packs', false, countNote(packRows.length)) +
        '<p class="mt-1 px-1 text-small text-muted">From the app. Bought packs go straight into your Homestead storage.</p>' +
        '<ul class="list mt-3" data-market-packs>' + packRows.map(function (r) { return packRow(r, m, connected, ready); }).join('') + '</ul>';
      shown += packRows.length;
    }

    var foods = filterFoods(browse);
    var food = '';
    if (foods.length) {
      food = section('Food', false) +
        '<ul class="list mt-3" data-market-foods>' + foods.map(function (f) { return foodRow(f, m, connected, ready); }).join('') + '</ul>' +
        '<p class="mt-3 px-1 text-small text-muted">Feed food to your Creature on its profile. Creature trading opens in a future update.</p>';
      shown += foods.length;
    }

    if (!shown) {
      return out + '<section class="collectible state-empty mt-8 py-10" data-empty="market-filter">' +
        '<p class="text-heading">Nothing matches <span data-market-query></span>.</p>' +
        '<p class="max-w-sm text-body text-muted">Try another word or category.</p>' +
        '<button type="button" class="btn-secondary mt-2" data-action="market-clear">CLEAR</button>' +
      '</section>';
    }
    return out + players + packs + food;
  }

  // ── SELL ──────────────────────────────────────────────────────────────
  function storageList(m, have) {
    var storage = m.storage && m.storage.storage;
    if (!have.length) {
      return '<ul class="list mt-3" data-market-storage><li class="list-row flex-wrap justify-between gap-3" data-empty="sell">' +
        '<span class="text-body text-muted">Nothing to sell yet. Send a Creature to work to bring home Resources.</span>' +
        '<a href="/homestead" data-nav class="btn-secondary shrink-0">Go to Homestead</a>' +
      '</li></ul>';
    }
    return '<ul class="list mt-3" data-market-storage>' + have.map(function (r) {
      return '<li class="list-row" data-storage-resource="' + r.key + '">' +
        '<span class="min-w-0 flex-1"><span class="text-body font-black">' + r.label + '</span>' +
          '<span class="ml-2 text-small text-muted">' + categoryOf(r.key).label + '</span></span>' +
        '<span class="text-body font-bold tabular-nums" data-storage-count="' + Number(storage[r.key]) + '">' + fmt(storage[r.key]) + '</span>' +
        '<button type="button" class="btn-secondary px-3" data-action="market-sell-resource" data-resource="' + r.key + '"' + (m.pending ? ' disabled' : '') + '>SELL</button>' +
      '</li>';
    }).join('') + '</ul>';
  }

  function sellForm(m, have, active) {
    var storage = m.storage.storage;
    var atMax = active >= marketConfig.MAX_ACTIVE_LISTINGS;
    var busy = m.pending === 'list';
    // Every Resource is in the list, grouped by category; the ones this
    // storage has none of can't be chosen.
    var options = resourceCategories().map(function (cat) {
      return '<optgroup label="' + cat.label + '">' + cat.resources.map(function (r) {
        var n = Number(storage[r.key]) || 0;
        return '<option value="' + r.key + '"' + (n > 0 ? (r === have[0] ? ' selected' : '') : ' disabled') + '>' +
          r.label + ' (' + fmt(n) + ')</option>';
      }).join('') + '</optgroup>';
    }).join('');
    return '<form id="market-sell-form" class="mt-3 grid gap-4 rounded-xl border border-line bg-surface p-4 sm:grid-cols-3" novalidate data-market-sell>' +
      '<div><label for="market-resource" class="block text-small text-muted">Resource</label>' +
        '<select id="market-resource" class="field mt-1" data-market-input="resource">' + options + '</select></div>' +
      '<div><label for="market-quantity" class="block text-small text-muted">How many</label>' +
        '<input id="market-quantity" class="field mt-1" type="number" inputmode="numeric" min="1" step="1" autocomplete="off" data-market-input="quantity"></div>' +
      '<div><label for="market-price" class="block text-small text-muted">Price for all (STEAD)</label>' +
        '<input id="market-price" class="field mt-1" type="number" inputmode="numeric" min="1" max="' + marketConfig.MAX_PRICE + '" step="1" autocomplete="off" data-market-input="price"></div>' +
      '<p class="text-small text-muted sm:col-span-3" data-market-summary aria-live="polite"></p>' +
      '<div class="sm:col-span-3"><button type="submit" class="btn-primary" data-action="market-list"' + (busy || m.pending || atMax ? ' disabled' : '') + '>' +
        (busy ? 'LISTING…' : 'LIST FOR SALE') + '</button>' +
        '<p class="mt-2 text-small text-muted">' + (atMax
          ? 'You have ' + marketConfig.MAX_ACTIVE_LISTINGS + ' listings up, the most at once. Cancel one or wait for a sale.'
          : 'The Resources leave your storage while they are listed. Cancel the listing to get them back.') + '</p></div>' +
    '</form>';
  }

  function myListingRow(l, m) {
    var id = Number(l.listingId);
    var price = '<span class="sticker">' + steadAmount(l.price) + '</span>';
    var attrs = ' data-my-listing="' + id + '" data-listing-status="' + l.status + '"';
    if (l.status === 'active' && Number(m.editing) === id) {
      var saving = m.pending === 'relist:' + id;
      return '<li class="list-row flex-col items-stretch"' + attrs + ' data-editing>' +
        rowTitle(lot(l), price + tag('FOR SALE', true)) +
        '<form id="market-edit-form" class="mt-1 grid gap-3 sm:grid-cols-2" novalidate data-listing-id="' + id + '">' +
          '<div><label for="market-edit-quantity" class="block text-small text-muted">How many</label>' +
            '<input id="market-edit-quantity" class="field mt-1" type="number" inputmode="numeric" min="1" step="1" autocomplete="off" data-market-edit="quantity"></div>' +
          '<div><label for="market-edit-price" class="block text-small text-muted">Price for all (STEAD)</label>' +
            '<input id="market-edit-price" class="field mt-1" type="number" inputmode="numeric" min="1" max="' + marketConfig.MAX_PRICE + '" step="1" autocomplete="off" data-market-edit="price"></div>' +
          '<p class="text-small text-muted sm:col-span-2">Saving takes this listing down and puts the new one up in its place.</p>' +
          '<div class="flex flex-wrap gap-2 sm:col-span-2">' +
            '<button type="submit" class="btn-primary" data-action="save-listing"' + (m.pending ? ' disabled' : '') + '>' + (saving ? 'SAVING…' : 'SAVE') + '</button>' +
            '<button type="button" class="btn-secondary" data-action="edit-listing-back"' + (m.pending ? ' disabled' : '') + '>BACK</button>' +
          '</div>' +
        '</form>' +
      '</li>';
    }
    var detail;
    var actions = '';
    if (l.status === 'active') {
      var cancelling = m.pending === 'cancel-listing:' + id;
      detail = tag('FOR SALE', true) + ' <span class="text-small text-muted">' + categoryOf(l.resource).label + ' · ' + eachAmount(priceEach(l.price, l.quantity)) + '</span>';
      actions = '<span class="flex shrink-0 gap-2">' +
        '<button type="button" class="btn-secondary px-3" data-action="edit-listing" data-listing-id="' + id + '"' + (m.pending ? ' disabled' : '') + '>EDIT</button>' +
        '<button type="button" class="btn-secondary px-3" data-action="cancel-listing" data-listing-id="' + id + '"' + (m.pending ? ' disabled' : '') + '>' + (cancelling ? 'CANCELLING…' : 'CANCEL') + '</button>' +
      '</span>';
    } else if (l.status === 'sold') {
      detail = tag('SOLD', false) + ' <span class="text-small text-muted">to <span data-listing-buyer="' + id + '"></span> · you got ' + steadAmount(l.price) + '</span>';
    } else {
      detail = tag('CANCELLED', false) + ' <span class="text-small text-muted">Back in your storage.</span>';
    }
    return '<li class="list-row flex-wrap"' + attrs + '>' +
      '<span class="min-w-0 flex-1 basis-48">' +
        rowTitle(lot(l), price, l.status !== 'active') +
        '<span class="mt-1 flex flex-wrap items-center gap-2">' + detail + '</span>' +
      '</span>' +
      actions +
    '</li>';
  }

  function sellTab(state, m, connected, ready) {
    if (!connected || m.status === 'error') return ''; // the panel at the top says it
    if (!ready) return section('Your storage', true) + skeletonRows('Loading your storage');
    var storage = m.storage && m.storage.storage;
    var have = storage ? homesteadConfig.RESOURCES.filter(function (r) { return Number(storage[r.key]) > 0; }) : [];
    var active = m.myListings.filter(function (l) { return l.status === 'active'; }).length;
    var out = section('Your storage', true) + storageList(m, have);
    if (have.length) out += section('New listing') + sellForm(m, have, active);
    out += section('Your listings', false, ' <span class="text-small font-bold text-muted" data-listings-up="' + active + '">· ' + active + ' of ' + marketConfig.MAX_ACTIVE_LISTINGS + ' up</span>');
    out += m.myListings.length
      ? '<ul class="list mt-3" data-my-listings>' + m.myListings.map(function (l) { return myListingRow(l, m); }).join('') + '</ul>'
      : '<p class="mt-2 px-1 text-small text-muted" data-empty="my-listings">No listings yet. Your listings and sales show here.</p>';
    return out;
  }

  // The whole screen: the tabs, the balance (or why it can't show), any
  // message, then the open tab.
  function page(state, heading, tab) {
    tab = tab === 'sell' ? 'sell' : 'buy';
    var m = state.marketplace;
    var connected = state.wallet.status === 'connected';
    var ready = connected && m.status === 'ready';
    var top;
    if (!connected) {
      top = '<section class="collectible state-empty mb-8 py-10" data-empty="marketplace">' +
        '<p class="text-heading">' + (tab === 'sell' ? 'Connect your wallet to sell.' : 'Connect your wallet to buy and sell.') + '</p>' +
        '<p class="max-w-sm text-body text-muted">Everything here is paid in STEAD from the wallet linked to your Homeroom account.</p>' +
        (state.wallet.status === 'connecting' ? '' : '<button type="button" class="btn-secondary mt-2" data-action="connect">CONNECT WALLET</button>') +
      '</section>';
    } else if (m.status === 'error') {
      top = '<section class="collectible state-error mb-8">' +
        '<p class="text-heading">Couldn\'t load the Marketplace.</p>' +
        '<p class="max-w-sm text-body text-muted">Your STEAD is safe. Check your connection and try again.</p>' +
        '<button type="button" class="btn-secondary mt-2" data-action="marketplace-retry">Retry</button>' +
      '</section>';
    } else {
      top = '<ul class="list mb-6"><li class="list-row justify-between"><span class="text-muted">STEAD Balance</span>' +
        (ready && m.steadBalance != null
          ? '<span class="font-black tabular-nums" data-market-stead="' + Number(m.steadBalance) + '">' + steadAmount(m.steadBalance) + '</span>'
          : '<span class="skeleton inline-block h-5 w-24" aria-busy="true"><span class="sr-only">Loading your STEAD</span></span>') +
      '</li></ul>';
    }
    var messages = marketNotice(m) +
      (m.error ? '<p role="alert" class="mb-4 text-small text-danger" data-field="market-error"></p>' : '');
    return heading +
      '<div class="max-w-3xl" data-market-tab-panel="' + tab + '">' + marketTabs(tab) + top + messages +
        (tab === 'sell' ? sellTab(state, m, connected, ready) : buyTab(state, m, connected, ready)) +
      '</div>';
  }

  window.HOMESTEAD_MARKET_VIEW = {
    page: page,
    who: who,
    resourceLabel: resourceLabel,
    resourceCategories: resourceCategories,
    categoryOf: categoryOf,
    priceEach: priceEach,
    formatEach: formatEach,
    steadAmount: steadAmount,
    SORTS: SORTS,
    DEFAULT_BROWSE: DEFAULT_BROWSE,
    chips: chips,
    normalizeBrowse: normalizeBrowse,
    filterListings: filterListings,
    sortListings: sortListings,
    filterPacks: filterPacks,
    filterFoods: filterFoods,
  };
})();
