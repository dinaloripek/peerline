// Peerline's dashboard. It reads window.RADAR (written beside dashboard/ by main.ts) and renders
// the ranked board, a detail view per protocol with its model breakdown and farm plan, the peer
// table the model priced from, and the live-token calibration set. No network: every byte it
// shows is in data.js.

(function () {
  'use strict';
  var DATA = window.RADAR;
  var rows = DATA.rows;
  var bySlug = {};
  rows.forEach(function (r) { bySlug[r.slug] = r; });

  var state = { q: '', cat: 'all', chain: 'all', tier: 'all', sort: 'rank', showAll: false, slug: null };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function money(n) {
    if (n == null) return '—';
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + n;
  }
  function pct(n) {
    if (n == null) return '—';
    return (n > 0 ? '+' : '') + n.toFixed(1) + '%';
  }
  function ageText(days) {
    if (days == null) return 'unknown';
    if (days >= 730) return (days / 365.25).toFixed(1) + ' y';
    if (days >= 60) return Math.round(days / 30.4) + ' mo';
    return days + ' d';
  }
  function el(id) { return document.getElementById(id); }

  /* Masthead stats */
  el('mastStats').innerHTML =
    stat(DATA.scanned_size, 'protocols scanned') +
    stat(DATA.board_size, 'pre-token rows') +
    stat(DATA.watchlist_size + ' / ' + DATA.watchlist_size, 'watchlist covered') +
    stat('×' + DATA.global_multiple.toFixed(3), 'global peer median');
  function stat(v, label) {
    return '<div class="stat"><b>' + esc(v) + '</b><span>' + esc(label) + '</span></div>';
  }

  /* Model strip */
  el('modelStrip').innerHTML =
    '<div class="formula">implied value = TVL × <em>peer multiple</em> × <em>growth</em> × <em>maturity</em></div>' +
    '<p>The peer multiple is the median market-cap / TVL of the live-token protocols in the same category ' +
    '(' + DATA.global_peers + ' peers priced; a category with fewer than 3 peers prices with its family, or with the ' +
    'global median ×' + DATA.global_multiple.toFixed(3) + '). Growth reads the 7-day TVL change, maturity reads how long ' +
    'the protocol has run with no token. No protocol name is priced by hand. Snapshot as of ' + esc(DATA.as_of) + '.</p>';

  /* Controls */
  var cats = {}, chains = {};
  rows.forEach(function (r) {
    if (r.category) cats[r.category] = 1;
    r.chains.forEach(function (c) { chains[c] = 1; });
  });
  el('cat').innerHTML = '<option value="all">All categories</option>' + Object.keys(cats).sort().map(function (c) {
    return '<option>' + esc(c) + '</option>';
  }).join('');
  el('chain').innerHTML = '<option value="all">All chains</option>' + Object.keys(chains).sort().map(function (c) {
    return '<option>' + esc(c) + '</option>';
  }).join('');
  el('q').addEventListener('input', function () { state.q = this.value.trim().toLowerCase(); state.showAll = true; renderBoard(); });
  el('cat').addEventListener('change', function () { state.cat = this.value; renderBoard(); });
  el('chain').addEventListener('change', function () { state.chain = this.value; renderBoard(); });
  el('sort').addEventListener('change', function () { state.sort = this.value; renderBoard(); });
  el('tierSeg').addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    state.tier = b.getAttribute('data-tier');
    this.querySelectorAll('button').forEach(function (x) { x.classList.toggle('on', x === b); });
    renderBoard();
  });
  el('more').addEventListener('click', function () { state.showAll = true; renderBoard(); });

  function filtered() {
    var out = rows.filter(function (r) {
      if (state.tier !== 'all' && r.tier !== state.tier) return false;
      if (state.cat !== 'all' && r.category !== state.cat) return false;
      if (state.chain !== 'all' && r.chains.indexOf(state.chain) < 0) return false;
      if (state.q && (r.name + ' ' + r.slug).toLowerCase().indexOf(state.q) < 0) return false;
      return true;
    });
    var by = {
      rank: function (a, b) { return a.rank - b.rank; },
      tvl: function (a, b) { return b.tvl_usd - a.tvl_usd; },
      growth: function (a, b) { return (b.change_7d == null ? -1e9 : b.change_7d) - (a.change_7d == null ? -1e9 : a.change_7d); },
      age: function (a, b) { return (b.age_days == null ? -1 : b.age_days) - (a.age_days == null ? -1 : a.age_days); },
      multiple: function (a, b) { return b.multiple - a.multiple; }
    };
    return out.sort(by[state.sort] || by.rank);
  }

  function renderBoard() {
    var list = filtered();
    var top = rows.length ? rows[0].implied_value_usd : 1;
    var shown = state.showAll ? list : list.slice(0, 60);
    el('boardCount').textContent = list.length + ' of ' + rows.length + ' rows' +
      (!state.showAll && list.length > 60 ? ' — first 60 shown' : '');
    el('more').style.display = !state.showAll && list.length > 60 ? '' : 'none';
    el('rows').innerHTML = shown.map(function (r) {
      var share = Math.max(0.4, (r.implied_value_usd / top) * 100);
      var chg = r.change_7d == null ? '<span class="muted">—</span>'
        : '<span class="' + (r.change_7d >= 0 ? 'up' : 'down') + '">' + pct(r.change_7d) + '</span>';
      return '<tr data-slug="' + esc(r.slug) + '">' +
        '<td class="rank num">' + r.rank + '</td>' +
        '<td><span class="name">' + esc(r.name) + '</span>' +
          '<span class="pill' + (r.tier === 'early' ? ' early' : '') + '">' + (r.tier === 'watchlist' ? 'watchlist' : 'early find') + '</span>' +
          '<div class="sub">' + esc(r.category || 'Uncategorised') + ' · listed ' + esc(r.listed_at || 'unknown') + '</div></td>' +
        '<td class="sub">' + esc(r.chains.slice(0, 3).join(', ') || '—') + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') + '</td>' +
        '<td class="num money">' + money(r.tvl_usd) + '</td>' +
        '<td class="num">' + chg + '</td>' +
        '<td class="num">' + ageText(r.age_days) + '</td>' +
        '<td class="num money">×' + r.multiple.toFixed(3) + '</td>' +
        '<td class="num implied">' + money(r.implied_value_usd) + '</td>' +
        '<td class="bar-cell"><div class="bar"><i style="width:' + share.toFixed(1) + '%"></i></div></td>' +
        '</tr>';
    }).join('');
  }
  el('rows').addEventListener('click', function (e) {
    var tr = e.target.closest('tr[data-slug]');
    if (tr) showDetail(tr.getAttribute('data-slug'), true);
  });

  /* Detail view */
  function splitStep(s) {
    var m = /^(.*?)\s*Cost:\s*(.*?)\.\s*Time:\s*(.*?)\.?$/.exec(s);
    if (!m) return { text: s, ct: '' };
    return { text: m[1], ct: 'Cost: <b>' + esc(m[2]) + '</b> · Time: <b>' + esc(m[3]) + '</b>' };
  }
  function showDetail(slug, scroll) {
    var r = bySlug[slug];
    if (!r) return;
    state.slug = slug;
    el('boardView').hidden = true;
    var d = el('detailView');
    d.hidden = false;
    var src = r.multiple_source === 'category' ? 'its own category peers'
      : r.multiple_source === 'family' ? 'its family peers (' + r.priced_as + ')' : 'the global peer set';
    d.innerHTML =
      '<button class="back" id="backBtn">← Back to the board</button>' +
      '<div class="detail-card">' +
      '<h2>' + esc(r.name) + ' <span class="pill' + (r.tier === 'early' ? ' early' : '') + '">' +
        (r.tier === 'watchlist' ? 'on the watchlist' : 'early find, below the watchlist floor') + '</span></h2>' +
      '<p class="muted">' + esc(r.category || 'Uncategorised') + ' · ' + esc(r.chains.join(', ') || 'no chain recorded') +
        ' · records no token in the snapshot of ' + esc(DATA.as_of) + '</p>' +
      '<div class="detail-grid">' +
        kv(money(r.implied_value_usd), 'implied value, rank #' + r.rank) +
        kv(money(r.tvl_usd), 'TVL') +
        kv(pct(r.change_7d), 'TVL change, 7d') +
        kv(ageText(r.age_days), 'running with no token') +
        kv('×' + r.multiple.toFixed(3), 'peer multiple') +
        kv(String(r.peers), 'live peers priced') +
      '</div>' +
      '<div class="breakdown">' + money(r.tvl_usd) + ' TVL × <em>' + r.multiple.toFixed(3) + '</em> (' + esc(src) + ') × <em>' +
        r.growth_factor.toFixed(3) + '</em> growth × <em>' + r.maturity_factor.toFixed(3) + '</em> maturity = <em>' +
        money(r.implied_value_usd) + '</em></div>' +
      '<h3 style="margin-top:18px">Farm plan</h3>' +
      '<ol class="farm">' + r.farm_steps.map(function (s) {
        var p = splitStep(s);
        return '<li>' + esc(p.text) + (p.ct ? '<div class="ct">' + p.ct + '</div>' : '') + '</li>';
      }).join('') + '</ol>' +
      '<p class="muted">The implied value is this board\'s own claim from the snapshot\'s figures, not a prediction ' +
      'that a token will be issued or what it would trade at. Farm at your own risk; a position can lose value.</p>' +
      '</div>';
    el('backBtn').addEventListener('click', function () {
      d.hidden = true;
      el('boardView').hidden = false;
      state.slug = null;
    });
    if (scroll) window.scrollTo(0, 0);
  }

  function kv(v, label) {
    return '<div class="kv"><b>' + esc(v) + '</b><span>' + esc(label) + '</span></div>';
  }

  /* Model section: the peer table the multiples came from */
  el('modelSection').innerHTML =
    '<h2>How the pricing works</h2>' +
    '<p>For every category with at least 3 live-token protocols holding $5M or more of TVL, the model takes the median ' +
    'of their market-cap / TVL ratios, with wild ratios outside 0.02–5 left out. A pre-token protocol is priced at its ' +
    'own TVL times that median. Categories too new to have 3 live peers — the risk curators and capital allocators among ' +
    'them — price with their family (Yield for curators and allocators, Lending for CDPs, Liquid Staking for staking ' +
    'pools), and the rest with the global median. Growth and maturity then adjust the price: a protocol whose TVL is ' +
    'climbing is worth more than a shrinking one of the same size, and one that has run for years with no token is a ' +
    'stronger launch candidate than last month\'s. Every one of the ' + DATA.board_size + ' rows — the whole ' +
    DATA.watchlist_size + '-protocol watchlist and ' + DATA.early_size + ' early finds below its $50M floor — is priced ' +
    'by this one function, and the peer table below is printed so any row can be recomputed by hand.</p>' +
    '<table class="peer-table"><thead><tr><th>Peer category</th><th class="num">Live peers</th><th class="num">Median cap / TVL</th></tr></thead>' +
    '<tbody>' + DATA.peer_table.map(function (p) {
      return '<tr><td>' + esc(p.category) + '</td><td class="num">' + p.peers + '</td><td class="num money">×' + p.median.toFixed(3) + '</td></tr>';
    }).join('') + '</tbody></table>';

  /* Calibration strip: live-token protocols, the market's own values */
  el('liveSection').innerHTML =
    '<h2>The calibration set</h2>' +
    '<p>These protocols already have a token, so the board never ranks them: it shows the market\'s own value for the ' +
    'largest of them, because their cap / TVL ratios are what the peer multiples above are made of. A pre-token ' +
    'protocol\'s implied value is a claim about what its token would be worth if its record stayed as it is.</p>' +
    '<div class="table-wrap"><table><thead><tr><th>Protocol</th><th>Category</th><th class="num">TVL</th>' +
    '<th class="num">Market cap</th><th class="num">Cap / TVL</th></tr></thead><tbody>' +
    DATA.live.map(function (p) {
      return '<tr><td><span class="name">' + esc(p.name) + '</span></td><td class="sub">' + esc(p.category || '—') +
        '</td><td class="num money">' + money(p.tvl_usd) + '</td><td class="num money">' + money(p.mcap_usd) +
        '</td><td class="num money">' + (p.multiple == null ? '—' : '×' + p.multiple.toFixed(3)) + '</td></tr>';
    }).join('') + '</tbody></table></div>';

  el('foot').textContent = 'Peerline ' + DATA.model_version + ' · snapshot: ' + DATA.source + ' · board built only from that ' +
    'snapshot\'s figures · implied values are the board\'s own claims, not make.fun\'s and not financial advice.';

  /* Entry state from the address: ?view=detail&slug=…, ?cat=…, ?tier=…, ?q=… */
  var params = new URLSearchParams(window.location.search);
  if (params.get('cat')) { state.cat = params.get('cat'); el('cat').value = state.cat; }
  if (params.get('q')) { state.q = params.get('q').toLowerCase(); el('q').value = params.get('q'); state.showAll = true; }
  if (params.get('tier')) {
    state.tier = params.get('tier');
    el('tierSeg').querySelectorAll('button').forEach(function (x) {
      x.classList.toggle('on', x.getAttribute('data-tier') === state.tier);
    });
  }
  renderBoard();
  if (params.get('view') === 'detail' && params.get('slug')) showDetail(params.get('slug'), false);
})();
