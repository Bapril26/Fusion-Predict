/* Fusion Predict – app logic (offline-first single-page app inside an Android WebView) */
(function () {
  'use strict';
  const M = window.FPModel;
  const APP_NAME = 'Fusion Predict';
  const STORE_KEY = 'fusionpredict_state_v1';
  const FREE_PER_WEEK = 2;          // free predictions per week
  const PRO_PER_DAY = 10;           // fair-use cap for Pro
  const PRICES = { monthly: 'R89.99', yearly: 'R749.99', yearlyPerMonth: 'R62.50', trialDays: 3 };
  const PRODUCT_ID = 'fusionpredict_pro';
  const PACKAGE = 'za.co.fusionlabs.predict';
  // When the Fusion Labs server is live, put its URL here so customers never need a key.
  const DEFAULT_SERVER_URL = '';
  const HELPLINE = '0800 006 008';
  const LEAGUES = [['psl', 'Betway Premiership (PSL)'], ['epl', 'Premier League'], ['ucl', 'Champions League'], ['laliga', 'La Liga'], ['seriea', 'Serie A'], ['bundesliga', 'Bundesliga'], ['ligue1', 'Ligue 1'], ['bafana', 'Bafana Bafana & CAF']];

  const HPN = window.HPNative || null;
  const TEST_BUILD = !!window.HP_EMBED || !!(HPN && HPN.isTestBuild && HPN.isTestBuild());
  const HAS_BILLING = !!(HPN && HPN.billingBuy);
  const APP_VERSION = (HPN && HPN.appVersion && HPN.appVersion()) || '1.0';
  const ICON = window.HP_ICON || 'icon.png';

  // ───────── State ─────────
  const defaults = () => ({ profile: null, history: [], pro: { active: false }, proTest: false, usage: { week: '', count: 0, day: '', dayCount: 0 }, apiKey: '', model: '', serverUrl: '', aiTest: null });
  let S;
  try { S = Object.assign(defaults(), JSON.parse(localStorage.getItem(STORE_KEY) || '{}')); } catch (e) { S = defaults(); }
  function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(S)); } catch (e) { toast('Couldn’t save on this phone'); } }

  const AI = window.FPAI.create(() => ({ apiKey: S.apiKey, model: S.model || window.FPAI.DEFAULT_MODEL, serverUrl: S.serverUrl || DEFAULT_SERVER_URL }));
  const aiReady = () => !!(S.serverUrl || DEFAULT_SERVER_URL || S.apiKey);

  // ───────── Helpers ─────────
  const $ = s => document.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const pct = p => Math.round((p || 0) * 100) + '%';
  const pct1 = p => ((p || 0) * 100).toFixed(1) + '%';
  const dec = d => d ? d.toFixed(2) : '–';
  const num = x => (x === null || x === undefined || x === '' || isNaN(+x)) ? null : +x;
  const dkey = d => d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
  const todayKey = () => dkey(new Date());
  const weekKey = () => { const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return dkey(d); };
  const todayLong = () => new Date().toLocaleDateString('en-ZA', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, 2800); }

  function isPro() { return !!((S.pro && S.pro.active) || (TEST_BUILD && S.proTest)); }
  function usageReset() { if (S.usage.week !== weekKey()) { S.usage.week = weekKey(); S.usage.count = 0; } if (S.usage.day !== todayKey()) { S.usage.day = todayKey(); S.usage.dayCount = 0; } }
  function predictionsLeft() { usageReset(); return isPro() ? Math.max(0, PRO_PER_DAY - S.usage.dayCount) : Math.max(0, FREE_PER_WEEK - S.usage.count); }
  function countUse() { usageReset(); S.usage.count++; S.usage.dayCount++; save(); }

  // ───────── Router (hash in the app, in-page stack when embedded) ─────────
  const USE_HASH = !window.HP_EMBED;
  let ROUTE = '/home'; const STACK = [];
  const curRoute = () => USE_HASH ? (location.hash.replace(/^#/, '') || '/home') : ROUTE;
  function go(path) {
    if (USE_HASH) { if (location.hash === '#' + path) render(); else location.hash = path; return; }
    STACK.push(ROUTE); ROUTE = path; closeSheet(); render();
  }
  function back() { if (USE_HASH) { if (history.length > 1) history.back(); else go('/home'); } else { ROUTE = STACK.pop() || '/home'; closeSheet(); render(); } }

  function sheet(html) { const w = $('#sheet'); w.innerHTML = '<div class="sheet" role="dialog" aria-modal="true"><div class="grab"></div>' + html + '</div>'; w.hidden = false; }
  function closeSheet() { $('#sheet').hidden = true; $('#sheet').innerHTML = ''; }
  function askConfirm(msg, yes, cb) { askConfirm.cb = cb; sheet('<h2>' + esc(msg) + '</h2><div class="actions mt"><button class="btn ghost" data-act="closeSheet">Cancel</button><button class="btn danger" data-act="confirmYes">' + esc(yes) + '</button></div>'); }

  function topbar(title, showBack) {
    return '<div class="topbar">' + (showBack ? '<button class="iconbtn" data-act="back" aria-label="Back">←</button>' : '<img class="logo-sm" src="' + ICON + '" alt="">') + '<h1>' + esc(title) + '</h1></div>';
  }
  const credit = () => '<footer class="credit">Created by <b>Fusion Labs</b></footer>';

  // ───────── Prediction cache ─────────
  const PRED = {};
  function predOf(entry) { if (!PRED[entry.id]) PRED[entry.id] = M.predict(entry.data); return PRED[entry.id]; }
  const entryById = id => id === 'demo' ? demoEntry() : S.history.find(h => h.id === id);
  function demoEntry() { const d = window.FP_DEMO; return { id: 'demo', at: Date.now(), demo: true, match: d.match, odds: d._odds, data: d }; }

  // ───────── Views ─────────
  const views = {};

  views.welcome = () => '<section class="age-gate">' +
    '<img class="logo-lg" src="' + ICON + '" alt="Fusion Predict logo"><h1>Fusion Predict</h1><div class="tag">Read the game before kick-off.</div>' +
    '<p>Screenshot any football match and get an AI analysis in seconds: win chances, likely scores, goal scorers and fair odds.</p>' +
    '<div class="feat"><div><span>📸</span>Snap a match from a betting site, Google or a fixture list</div><div><span>📊</span>Form, team news, head-to-head and key stats</div><div><span>🎯</span>Win/draw/loss chances, scorelines and a recommended pick</div><div><span>💰</span>Fair odds compared with the bookmaker’s prices</div></div>' +
    '<label class="check" for="age-ok"><input type="checkbox" id="age-ok" data-act="ageTick"' + (views._age ? ' checked' : '') + '><span>I am <b>18 or older</b>. I understand predictions are estimates, not guarantees, and Fusion Predict doesn’t place bets.</span></label>' +
    '<button class="btn block" data-act="startSetup"' + (views._age ? '' : ' disabled') + '>Get started</button>' +
    '<p class="small" style="margin-top:14px">Gambling problem? Free, confidential help: <b>' + HELPLINE + '</b> (National Responsible Gambling Programme).</p>' +
    '<p class="credit-dark">Created by <b>Fusion Labs</b></p></section>';

  let draft = null;
  views.setup = () => {
    draft = draft || Object.assign({ name: '', leagues: ['psl', 'epl'] }, S.profile || {});
    const edit = !!S.profile;
    return topbar(edit ? 'Edit profile' : 'Quick setup', edit) + '<div class="wrap">' +
      (edit ? '' : '<p class="muted">Two quick questions, then you’re ready to predict.</p>') +
      '<label class="f" for="pf-name">Your first name (optional)</label><input class="in" id="pf-name" data-bind="name" value="' + esc(draft.name) + '" placeholder="e.g. Sipho" autocomplete="given-name">' +
      '<label class="f">Leagues you follow</label><div class="chips wrapc">' + LEAGUES.map(([k, l]) => '<button class="chip ' + (draft.leagues.includes(k) ? 'on' : '') + '" data-act="toggleLeague" data-val="' + k + '">' + esc(l) + '</button>').join('') + '</div>' +
      '<button class="btn block mt" data-act="finishSetup">' + (edit ? 'Save' : 'Start predicting') + '</button></div>';
  };

  views.home = () => {
    const p = S.profile || {}; const h = new Date().getHours();
    const greet = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
    const left = predictionsLeft(); const rec = record();
    const recent = S.history.slice(0, 3);
    return '<div class="hello"><div class="row"><div class="spacer"><p class="muted" style="margin:0">' + greet + (p.name ? ',' : '') + '</p><h1>' + (p.name ? esc(p.name) : 'Welcome') + ' 👋</h1></div><img class="logo-sm" src="' + ICON + '" alt=""></div>' +
      (isPro() ? '<span class="pill navy">★ Pro</span>' : '<span class="pill">' + left + ' of ' + FREE_PER_WEEK + ' free predictions left this week</span>') + '</div>' +
      '<div class="wrap"><div class="pred-hero"><h2>Predict a match</h2><p>Screenshot a match from your betting app, Google or a fixture list.</p><div class="btns">' +
      '<label class="btn block" for="shot-home">📸 Upload a screenshot</label><input id="shot-home" class="shot-input" type="file" accept="image/*" hidden>' +
      '<button class="btn alt block" data-act="typeTeams">⌨️ Type the teams instead</button></div></div>' +
      '<div class="card"><div class="steps3"><div><b>1</b>Screenshot a match</div><div><b>2</b>AI researches form &amp; news</div><div><b>3</b>Get chances, scores &amp; odds</div></div></div>' +
      (rec.settled ? '<div class="section-h"><h2>Your track record</h2><a class="small" href="#/history">History →</a></div>' + recordHtml(rec) : '') +
      '<div class="section-h"><h2>Recent predictions</h2>' + (S.history.length ? '<a class="small" href="#/history">See all →</a>' : '') + '</div>' +
      (recent.length ? recent.map(histRow).join('') : '<div class="card muted">No predictions yet. <button class="linkbtn" data-act="openDemo">See an example prediction</button></div>') +
      (isPro() ? '' : '<a class="card pro-card mt" href="#/premium"><h3>★ Go Pro</h3><p>Unlimited predictions, full stats, scorer chances, value vs the bookmaker and match scenarios. From ' + PRICES.monthly + '/month.</p></a>') +
      '</div>';
  };

  // ── Predict flow ──
  let flow = { stage: 'start' };
  const resetFlow = () => { flow = { stage: 'start' }; };
  views.predict = () => {
    const left = predictionsLeft(); let body = '';
    if (flow.stage === 'start') {
      body = '<div class="pred-hero"><h2>New prediction</h2><p>Use a screenshot that shows the two teams. Odds on the screenshot are compared too.</p><div class="btns">' +
        '<label class="btn block" for="shot-pick">🖼️ Upload a screenshot</label><input id="shot-pick" class="shot-input" type="file" accept="image/*" hidden>' +
        '<button class="btn alt block" data-act="takePhoto">📷 Take a photo of a screen</button><input id="shot-cam" class="shot-input" type="file" accept="image/*" capture="environment" hidden>' +
        '<button class="btn alt block" data-act="typeTeams">⌨️ Type the teams</button></div></div>' +
        '<p class="small muted center">' + (isPro() ? '★ Pro · ' + left + ' predictions left today' : left + ' of ' + FREE_PER_WEEK + ' free predictions left this week · <a href="#/premium">Go Pro for unlimited</a>') + '</p>' +
        aiSetupCard();
    } else if (flow.stage === 'type') {
      body = '<div class="card"><h3>Which match?</h3><form data-form="typed"><label class="f" for="t-home">Home team</label><input class="in" id="t-home" name="home" required placeholder="e.g. Kaizer Chiefs" value="' + esc(flow.match && flow.match.home || '') + '">' +
        '<label class="f" for="t-away">Away team</label><input class="in" id="t-away" name="away" required placeholder="e.g. Orlando Pirates" value="' + esc(flow.match && flow.match.away || '') + '">' +
        '<label class="f" for="t-comp">Competition (optional)</label><input class="in" id="t-comp" name="competition" placeholder="e.g. Betway Premiership" value="' + esc(flow.match && flow.match.competition || '') + '">' +
        '<label class="f" for="t-date">Date (optional)</label><input class="in" id="t-date" name="kickoff" placeholder="e.g. Saturday" value="' + esc(flow.match && flow.match.kickoff || '') + '">' +
        '<button class="btn block mt">Analyse match</button></form></div><button class="btn ghost block" data-act="resetFlow">Cancel</button>';
    } else if (flow.stage === 'reading') {
      body = (flow.img ? '<img class="shot-img" src="' + flow.img + '" alt="Your screenshot">' : '') + '<div class="card center mt"><div class="spinner"></div><p>Reading your screenshot…</p></div>';
    } else if (flow.stage === 'choose') {
      body = '<img class="shot-img" src="' + flow.img + '" alt="Your screenshot"><h2 class="mt">Which match?</h2><p class="muted small">We found ' + flow.matches.length + ' matches on your screenshot.</p>' +
        flow.matches.map((m, i) => '<button class="match-pick" data-act="chooseMatch" data-i="' + i + '"><b>' + esc(m.home) + ' vs ' + esc(m.away) + '</b><br><span class="small muted">' + esc([m.competition, m.kickoff].filter(Boolean).join(' · ')) + (m.odds && m.odds.home ? ' · odds ' + [m.odds.home, m.odds.draw, m.odds.away].map(x => x || '–').join(' / ') : '') + '</span></button>').join('') +
        '<button class="btn ghost block" data-act="resetFlow">Cancel</button>';
    } else if (flow.stage === 'confirm') {
      const m = flow.match; const o = flow.odds || {};
      body = (flow.img ? '<img class="shot-img" src="' + flow.img + '" alt="Your screenshot">' : '') +
        '<div class="card mt"><h3>Is this right?</h3><div class="fixture mt"><div class="team">' + esc(m.home) + '<span class="side">Home</span></div><div class="vs">VS</div><div class="team">' + esc(m.away) + '<span class="side">Away</span></div></div>' +
        '<p class="meta-line">' + esc([m.competition, m.kickoff].filter(Boolean).join(' · ') || 'Competition not shown') + '</p>' +
        (o.home || o.draw || o.away ? '<p class="meta-line">Bookmaker odds found: <b>' + [o.home, o.draw, o.away].map(x => x || '–').join(' / ') + '</b>' + (flow.bookmaker ? ' (' + esc(flow.bookmaker) + ')' : '') + '</p>' : '') +
        '<div class="row wrapr mt"><button class="btn sm ghost" data-act="swapTeams">⇄ Swap home/away</button><button class="btn sm ghost" data-act="editMatch">✏️ Edit</button></div></div>' +
        '<button class="btn block" data-act="runResearch">Analyse match</button><button class="btn ghost block mt" data-act="resetFlow">Cancel</button>';
    } else if (flow.stage === 'researching') {
      const st = (done, active, label) => '<li class="' + (done || active ? '' : 'todo') + '"><span class="ic">' + (done ? '✅' : active ? '<div class="spinner"></div>' : '⚪') + '</span><span>' + label + '</span></li>';
      body = '<div class="card"><div class="fixture"><div class="team">' + esc(flow.match.home) + '</div><div class="vs">VS</div><div class="team">' + esc(flow.match.away) + '</div></div></div>' +
        '<div class="card"><ul class="progress-list">' + st(true, false, 'Match identified') +
        st(false, true, 'Researching form, team news and stats' + (flow.searches ? ' <span class="small muted">(' + flow.searches + ' searches)</span>' : '') + (flow.query ? '<br><span class="small muted">“' + esc(flow.query) + '”</span>' : '')) +
        st(false, false, 'Running the match model') + '</ul></div><p class="small muted center">This usually takes 20–60 seconds.</p>';
    } else if (flow.stage === 'error') {
      body = '<div class="alert warn"><b>Couldn’t finish the prediction.</b><br>' + esc(flow.error) + '</div>' + (flow.configError ? aiSetupCard(true) : '') +
        '<div class="actions">' + (flow.retry ? '<button class="btn" data-act="retryFlow">Try again</button>' : '') + '<button class="btn ghost" data-act="resetFlow">Start over</button></div>';
    }
    return topbar('Predict', false) + '<div class="wrap">' + body + '</div>';
  };

  function aiSetupCard(force) {
    if (window.HP_EMBED) return '<div class="alert info mt">This browser preview can’t run live predictions. <button class="linkbtn" data-act="openDemo">See an example prediction</button></div>';
    if (aiReady() && !force) {
      const t = S.aiTest || {};
      return '<p class="small center muted">' + (t.ok === true ? '✅ AI connected' : t.ok === false ? '⚠️ ' + esc(t.msg) : 'AI set up') + ' · <button class="linkbtn small" data-act="testAI">Test connection</button></p>';
    }
    return '<div class="card mt"><h3>🔌 Connect the AI</h3><p class="small muted">Predictions use Claude (by Anthropic) with web search. Paste your API key from <b>console.anthropic.com</b>. It’s stored only on this phone.</p>' +
      '<label class="f" for="ai-key">AI key</label><input class="in" id="ai-key" type="password" data-setting="apiKey" value="' + esc(S.apiKey) + '" placeholder="sk-ant-…" autocomplete="off">' +
      '<div class="row wrapr mt"><button class="btn sm" data-act="testAI">Save &amp; test</button><button class="linkbtn" data-act="openDemo">See an example</button></div></div>';
  }

  // ── Result ──
  const TABS = [['overview', 'Overview', false], ['stats', 'Stats', true], ['scores', 'Scores', true], ['scorers', 'Scorers', true], ['odds', 'Odds', true], ['scenarios', 'Scenarios', true]];
  let tab = 'overview';
  views.match = (id) => {
    const e = entryById(id); if (!e) return views.history();
    const d = e.data; const P = predOf(e); const H = d.home || {}, A = d.away || {};
    const o = P.outcomes; const hn = H.name || e.match.home, an = A.name || e.match.away;
    const pickIcon = { home: '🏠', away: '✈️', draw: '🤝', '1X': '🛡️', X2: '🛡️', 'O2.5': '⚽', 'U2.5': '🧱', BTTS: '🔁', NBTTS: '🚫' }[P.pick.key] || '🎯';
    const pickLabel = P.pick.key === 'home' ? hn + ' to win' : P.pick.key === 'away' ? an + ' to win' : P.pick.key === '1X' ? hn + ' or draw' : P.pick.key === 'X2' ? an + ' or draw' : P.pick.label;
    let html = topbar(e.demo ? 'Example prediction' : 'Prediction', true) + '<div class="wrap">' +
      (e.demo ? '<div class="demo-note">Example with made-up teams, so you can see how a prediction looks.</div>' : '') +
      '<div class="card"><div class="fixture"><div class="team">' + esc(hn) + '<span class="side">Home</span></div><div class="vs">VS</div><div class="team">' + esc(an) + '<span class="side">Away</span></div></div>' +
      '<p class="meta-line">' + esc([d.match && d.match.competition || e.match.competition, d.match && d.match.kickoff || e.match.kickoff].filter(Boolean).join(' · ')) + '</p>' +
      '<div class="probbar" role="img" aria-label="Home ' + pct(o.home) + ', draw ' + pct(o.draw) + ', away ' + pct(o.away) + '"><i class="ph" style="width:' + (o.home * 100) + '%"></i><i class="pd" style="width:' + (o.draw * 100) + '%"></i><i class="pa" style="width:' + (o.away * 100) + '%"></i></div>' +
      '<div class="problabels"><div><b>' + pct(o.home) + '</b>Home win</div><div><b>' + pct(o.draw) + '</b>Draw</div><div><b>' + pct(o.away) + '</b>Away win</div></div></div>' +
      '<div class="card pickcard"><span class="big">' + pickIcon + '</span><div class="spacer"><span class="small muted">Our pick</span><h3>' + esc(pickLabel) + '</h3><span class="small">' + pct(P.pick.p) + ' chance · </span><span class="conf ' + P.confidence + '">' + P.confidence + ' confidence</span></div></div>' +
      '<div class="tabs" role="tablist">' + TABS.map(([k, l, pro]) => '<button role="tab" aria-selected="' + (tab === k) + '" class="' + (tab === k ? 'on' : '') + '" data-act="tab" data-val="' + k + '">' + l + (pro && !isPro() ? '<span class="lk">🔒</span>' : '') + '</button>').join('') + '</div>';
    const locked = TABS.find(t => t[0] === tab)[2] && !isPro() && !e.demo;
    html += locked ? lockedCard() : tabHtml(tab, e, P, hn, an);
    if (!e.demo) html += settleCard(e, P);
    if ((d.sources || []).length) html += '<div class="card sources"><h3>Sources</h3>' + d.sources.map(s => '<a href="' + esc(s.url) + '" target="_blank" rel="noopener">' + esc(s.title || s.url) + '</a>').join('') + '</div>';
    html += '<p class="disclaimer">Predictions are statistical estimates based on public data' + (d.data_as_of ? ' (as of ' + esc(d.data_as_of) + ')' : '') + ' and can be wrong. Fusion Predict does not place bets or give financial advice. 18+ only. Gambling problem? Call <b>' + HELPLINE + '</b>.</p></div>';
    return html;
  };
  function lockedCard() {
    return '<div class="card locked"><div class="big">🔒</div><h3>Part of Fusion Predict Pro</h3><p class="muted">Full stats, every scoreline, goal-scorer chances, value against the bookmaker and match scenarios.</p><a class="btn" href="#/premium">Unlock Pro</a></div>';
  }
  function formBadges(s) { return '<span class="form-badges">' + String(s || '').toUpperCase().replace(/[^WDL]/g, '').slice(0, 6).split('').map(c => '<i class="' + c + '">' + c + '</i>').join('') + '</span>'; }
  function tabHtml(t, e, P, hn, an) {
    const d = e.data; const H = d.home || {}, A = d.away || {};
    if (t === 'overview') {
      return (d.summary ? '<div class="card"><h3>Match preview</h3><p>' + esc(d.summary) + '</p></div>' : '') +
        ((d.key_factors || []).length || P.notes.length ? '<div class="card"><h3>Key factors</h3><ul class="checklist">' + (d.key_factors || []).concat(P.notes).slice(0, 8).map(k => '<li>' + esc(k) + '</li>').join('') + '</ul></div>' : '') +
        '<div class="card"><h3>Expected goals</h3><div class="fixture"><div class="team" style="font-size:28px">' + P.lh.toFixed(2) + '</div><div class="vs">xG</div><div class="team" style="font-size:28px">' + P.la.toFixed(2) + '</div></div>' +
        '<h3 class="mt">Most likely scores</h3>' + P.scores.slice(0, 3).map(s => hbar(s.h + ' – ' + s.a, s.p, P.scores[0].p)).join('') + '</div>' +
        '<div class="card"><h3>Form (last 6)</h3><div class="food-row"><span>' + esc(hn) + '</span>' + formBadges(H.last6 && H.last6.results) + '</div><div class="food-row"><span>' + esc(an) + '</span>' + formBadges(A.last6 && A.last6.results) + '</div>' +
        '<p class="small muted mt">Data quality: ' + (P.quality >= 0.7 ? 'good' : P.quality >= 0.4 ? 'fair' : 'limited') + (d.lineups ? ' · Line-ups ' + esc(d.lineups) : '') + '</p></div>';
    }
    if (t === 'stats') {
      const g = (T, k) => { const x = T.overall || {}; return x.played ? num(x[k]) / x.played : null; };
      const ppg = T => { const x = T.overall || {}; return x.played ? ((num(x.w) || 0) * 3 + (num(x.d) || 0)) / x.played : null; };
      const fpts = T => { const r = String(T.last6 && T.last6.results || '').toUpperCase().replace(/[^WDL]/g, ''); return r ? r.split('').reduce((a, c) => a + (c === 'W' ? 3 : c === 'D' ? 1 : 0), 0) : null; };
      const cs = T => { const x = T.overall || {}; return x.played && num(T.clean_sheets) !== null ? T.clean_sheets / x.played * 100 : null; };
      const rows = [
        ['League position', num(H.position), num(A.position), 'low', 0], ['Points per game', ppg(H), ppg(A), 'high', 2],
        ['Goals scored / game', g(H, 'gf'), g(A, 'gf'), 'high', 2], ['Goals conceded / game', g(H, 'ga'), g(A, 'ga'), 'low', 2],
        ['xG for / game', num(H.xg_for_per_game), num(A.xg_for_per_game), 'high', 2], ['xG against / game', num(H.xg_against_per_game), num(A.xg_against_per_game), 'low', 2],
        ['Clean sheets %', cs(H), cs(A), 'high', 0], ['Both teams scored %', num(H.btts_pct), num(A.btts_pct), '', 0],
        ['Over 2.5 goals %', num(H.over25_pct), num(A.over25_pct), '', 0], ['Form points (last 6)', fpts(H), fpts(A), 'high', 0],
        ['Shots / game', num(H.shots_per_game), num(A.shots_per_game), 'high', 1],
      ];
      const cell = (v, other, better, dp) => { if (v === null) return '–'; const b = better && other !== null && (better === 'high' ? v > other : v < other); return '<span class="' + (b ? 'best' : '') + '">' + v.toFixed(dp) + '</span>'; };
      const rec = (r) => r && r.played ? r.w + '-' + r.d + '-' + r.l + ' · ' + r.gf + ':' + r.ga : '–';
      return '<div class="card"><div class="cmp-head"><span>' + esc(hn) + '</span><span>' + esc(an) + '</span></div><table class="cmp"><tbody>' +
        rows.map(([l, a, b, better, dp]) => '<tr><td>' + cell(a, b, better, dp) + '</td><td>' + l + '</td><td>' + cell(b, a, better, dp) + '</td></tr>').join('') + '</tbody></table></div>' +
        '<div class="card"><h3>Home &amp; away (W-D-L · goals)</h3><div class="food-row"><span>' + esc(hn) + ' at home</span><b>' + rec(H.home_record) + '</b></div><div class="food-row"><span>' + esc(an) + ' away</span><b>' + rec(A.away_record) + '</b></div>' +
        '<div class="food-row"><span>' + esc(hn) + ' away</span><span>' + rec(H.away_record) + '</span></div><div class="food-row"><span>' + esc(an) + ' at home</span><span>' + rec(A.home_record) + '</span></div></div>' +
        ((d.h2h || []).length ? '<div class="card"><h3>Head-to-head</h3>' + d.h2h.slice(0, 6).map(m => '<div class="food-row"><span>' + esc(m.home) + ' <b>' + esc(m.score) + '</b> ' + esc(m.away) + '</span><span class="small muted">' + esc(m.date || '') + '</span></div>').join('') + '</div>' : '') +
        absencesCard(H, A, hn, an);
    }
    if (t === 'scores') {
      const T = P.totals;
      return '<div class="card"><h3>Most likely scores</h3>' + P.scores.map(s => hbar(s.h + ' – ' + s.a, s.p, P.scores[0].p)).join('') + '</div>' +
        '<div class="card"><h3>Total goals</h3>' + T.dist.map(x => hbar(x.goals + ' goals', x.p, Math.max.apply(null, T.dist.map(y => y.p)))).join('') + '</div>' +
        '<div class="card"><h3>Goal lines</h3><table class="otable"><thead><tr><th>Line</th><th>Over</th><th>Under</th></tr></thead><tbody>' + T.lines.map(l => '<tr><td>' + l.line + '</td><td>' + pct(l.over) + '</td><td>' + pct(l.under) + '</td></tr>').join('') + '</tbody></table>' +
        '<div class="food-row mt"><span>Both teams score</span><b>' + pct(T.btts) + '</b></div><div class="food-row"><span>' + esc(hn) + ' clean sheet</span><b>' + pct(T.homeCS) + '</b></div><div class="food-row"><span>' + esc(an) + ' clean sheet</span><b>' + pct(T.awayCS) + '</b></div></div>';
    }
    if (t === 'scorers') {
      const list = (arr, name) => '<div class="card"><h3>' + esc(name) + '</h3>' + (arr.length ? arr.map(s => hbar(s.name, s.p, 0.7, true) + (s.status && s.status !== 'available' ? '<p class="small muted" style="margin:-4px 0 6px 0">' + esc(s.status) + '</p>' : '')).join('') : '<p class="muted small">No scorer data found for this team.</p>') + '</div>';
      return list(P.scorers.home, hn) + list(P.scorers.away, an) + '<p class="small muted">Chance of scoring at any time, based on each player’s share of the team’s league goals and the expected goals for this match.</p>';
    }
    if (t === 'odds') {
      const b = e.odds || {};
      const rows = [[hn + ' win', P.fair.home, b.home], ['Draw', P.fair.draw, b.draw], [an + ' win', P.fair.away, b.away], ['Over 2.5 goals', P.fair.over25, b.over25], ['Under 2.5 goals', P.fair.under25, b.under25], ['Both teams score', P.fair.bttsYes, b.btts_yes], ['Not both score', P.fair.bttsNo, b.btts_no]];
      const anyBook = rows.some(r => num(r[2]));
      const margin = num(b.home) && num(b.draw) && num(b.away) ? (1 / b.home + 1 / b.draw + 1 / b.away - 1) : null;
      return '<div class="card"><h3>Fair odds</h3><div class="scroll-x"><table class="otable"><thead><tr><th>Market</th><th>Chance</th><th>Fair</th><th>Frac</th><th>US</th>' + (anyBook ? '<th>Book</th><th>Value</th>' : '') + '</tr></thead><tbody>' +
        rows.map(([l, f, bk]) => { const v = M.value(f.p, bk); return '<tr><td>' + esc(l) + '</td><td>' + pct(f.p) + '</td><td>' + dec(f.decimal) + '</td><td>' + f.fractional + '</td><td>' + f.american + '</td>' + (anyBook ? '<td>' + (num(bk) ? (+bk).toFixed(2) : '–') + '</td><td class="' + (v && v.edge > 0 ? 'edge-pos' : 'edge-neg') + '">' + (v ? (v.edge > 0 ? '+' : '') + (v.edge * 100).toFixed(1) + '%' : '–') + '</td>' : '') + '</tr>'; }).join('') + '</tbody></table></div>' +
        (margin !== null ? '<p class="small muted mt">Bookmaker margin on the match result: <b>' + pct1(margin) + '</b>.</p>' : '') +
        '<p class="small muted mt">' + (anyBook ? '“Value” compares our chance with the bookmaker’s price. A positive number means the price is higher than our fair odds. It is not a guarantee of profit.' : 'Upload a screenshot that shows the bookmaker’s odds to compare prices.') + '</p></div>';
    }
    if (t === 'scenarios') {
      return '<div class="card"><h3>If this happens…</h3><p class="small muted">How the result chances change under different match scenarios.</p>' + P.scenarios.map(s =>
        '<div class="mt"><div class="row"><b class="spacer">' + esc(s.label) + '</b><span class="small muted">' + pct(s.chance) + ' likely</span></div>' +
        '<div class="probbar" style="margin:6px 0 4px"><i class="ph" style="width:' + s.outcome.home * 100 + '%"></i><i class="pd" style="width:' + s.outcome.draw * 100 + '%"></i><i class="pa" style="width:' + s.outcome.away * 100 + '%"></i></div>' +
        '<div class="problabels small"><div>Home ' + pct(s.outcome.home) + '</div><div>Draw ' + pct(s.outcome.draw) + '</div><div>Away ' + pct(s.outcome.away) + '</div></div></div>').join('') + '</div>';
    }
    return '';
  }
  function absencesCard(H, A, hn, an) {
    const row = x => '<div class="food-row"><span>' + esc(x.name) + ' <span class="small muted">' + esc([x.position, x.reason].filter(Boolean).join(' · ')) + '</span></span><span class="small">' + esc(x.importance || '') + '</span></div>';
    const h = H.absences || [], a = A.absences || [];
    if (!h.length && !a.length) return '';
    return '<div class="card"><h3>Team news</h3>' + (h.length ? '<p class="small muted"><b>' + esc(hn) + '</b></p>' + h.map(row).join('') : '') + (a.length ? '<p class="small muted mt"><b>' + esc(an) + '</b></p>' + a.map(row).join('') : '') + '</div>';
  }
  function hbar(label, p, max, wide) { return '<div class="hbar"' + (wide ? ' style="grid-template-columns:1fr 1fr 52px"' : '') + '><span>' + esc(label) + '</span><div class="bar"><i style="width:' + Math.min(100, p / (max || 1) * 100) + '%"></i></div><span>' + pct(p) + '</span></div>'; }
  function settleCard(e, P) {
    if (e.final) {
      const ok = M.settle(P.pick.key, e.final.h, e.final.a);
      return '<div class="card"><h3>Final score: ' + e.final.h + ' – ' + e.final.a + '</h3><p class="' + (ok ? 'edge-pos' : 'muted') + '">' + (ok ? '✅ Our pick was right' : '❌ Our pick missed') + '</p><button class="linkbtn" data-act="clearFinal" data-id="' + e.id + '">Change score</button></div>';
    }
    return '<div class="card"><h3>Add the final score</h3><p class="small muted">After the match, add the score to build your track record.</p><form class="row" data-form="final" data-id="' + e.id + '"><input class="in" name="h" type="number" min="0" max="20" inputmode="numeric" required aria-label="Home goals" style="max-width:80px"><span>–</span><input class="in" name="a" type="number" min="0" max="20" inputmode="numeric" required aria-label="Away goals" style="max-width:80px"><button class="btn sm" style="min-height:50px">Save</button></form></div>';
  }

  // ── History ──
  function record() {
    const s = S.history.filter(h => h.final); const won = s.filter(h => M.settle(predOf(h).pick.key, h.final.h, h.final.a)).length;
    return { total: S.history.length, settled: s.length, won, rate: s.length ? won / s.length : 0 };
  }
  const recordHtml = r => '<div class="record"><div><b>' + r.total + '</b><span>Predictions</span></div><div><b>' + r.won + '/' + r.settled + '</b><span>Picks correct</span></div><div><b>' + (r.settled ? pct(r.rate) : '–') + '</b><span>Hit rate</span></div></div>';
  function histRow(h) {
    const P = predOf(h); const ok = h.final ? M.settle(P.pick.key, h.final.h, h.final.a) : null;
    return '<a class="card hist" href="#/match/' + h.id + '"><span class="st">' + (ok === null ? '⏳' : ok ? '✅' : '❌') + '</span><span class="tx"><b>' + esc(h.match.home) + ' vs ' + esc(h.match.away) + '</b><span class="small muted">' + esc(P.pick.label) + ' · ' + pct(P.pick.p) + ' · ' + new Date(h.at).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' }) + (h.final ? ' · FT ' + h.final.h + '-' + h.final.a : '') + '</span></span></a>';
  }
  views.history = () => topbar('History', false) + '<div class="wrap">' + (S.history.length ? recordHtml(record()) + '<div class="mt">' + S.history.map(histRow).join('') + '</div>' +
    '<button class="linkbtn" style="color:var(--warn)" data-act="clearHistory">Clear history</button>' :
    '<div class="empty-state"><div class="big">📒</div><p>Your predictions will be saved here. Add the final scores afterwards to see your hit rate.</p><a class="btn" href="#/predict">Make a prediction</a></div>') + '</div>';

  // ── Profile ──
  views.profile = () => {
    const p = S.profile || {};
    return topbar('Profile', false) + '<div class="wrap">' +
      '<div class="card"><div class="food-row"><div><span class="small muted">Name</span><br><b>' + (p.name ? esc(p.name) : '<span class="muted">Not set</span>') + '</b></div><a class="storebtn" style="text-decoration:none;align-self:center" href="#/setup">Edit</a></div>' +
      '<div class="food-row"><div><span class="small muted">Leagues</span><br><b>' + esc((p.leagues || []).map(k => (LEAGUES.find(l => l[0] === k) || [k, k])[1]).join(', ') || 'None') + '</b></div></div></div>' +
      '<a class="card pro-card" href="#/premium"><h3>' + (isPro() ? '★ Fusion Predict Pro is active' : '★ Go Pro') + '</h3><p>' + (isPro() ? (S.pro.active ? 'Thanks for your support. Manage your subscription.' : 'Pro is switched on for testing.') : 'Unlimited predictions, full stats, scorers, value and scenarios. From ' + PRICES.monthly + '/month.') + '</p></a>' +
      (TEST_BUILD ? testSwitchHtml() : '') +
      (TEST_BUILD || !DEFAULT_SERVER_URL ? '<div class="card"><h3>🔌 AI connection</h3><p class="small"><b>Status:</b> ' + (!aiReady() ? '⚪ Not connected' : (S.aiTest || {}).ok === true ? '✅ Connected' : (S.aiTest || {}).ok === false ? '⚠️ ' + esc(S.aiTest.msg) : '🟡 Not tested yet') + '</p>' +
        '<label class="f" for="set-key">AI key (Anthropic)</label><input class="in" id="set-key" type="password" data-setting="apiKey" value="' + esc(S.apiKey) + '" placeholder="sk-ant-…" autocomplete="off">' +
        '<label class="f" for="set-model">AI model</label><input class="in" id="set-model" data-setting="model" value="' + esc(S.model || window.FPAI.DEFAULT_MODEL) + '">' +
        '<label class="f" for="set-url">Fusion Labs server (optional)</label><input class="in" id="set-url" type="url" data-setting="serverUrl" value="' + esc(S.serverUrl) + '" placeholder="https://…workers.dev" autocomplete="off">' +
        '<p class="small muted">Before a public launch, use the server so the key isn’t stored in the app.</p><button class="btn soft block" data-act="testAI">Test connection</button></div>' : '') +
      '<div class="card rg"><h3>Play responsibly</h3><p class="small">Predictions are estimates and can be wrong. Only bet what you can afford to lose, set limits, and take breaks.</p><p class="small">Free, confidential counselling (National Responsible Gambling Programme): <b>' + HELPLINE + '</b></p></div>' +
      '<div class="card"><h3>Data</h3><p class="small muted">Your predictions are stored privately on this phone.</p><button class="btn danger block" data-act="reset">Reset app &amp; delete my data</button></div>' +
      '<p class="disclaimer center">' + APP_NAME + ' v' + esc(APP_VERSION) + (TEST_BUILD ? ' (test build)' : '') + ' · by Fusion Labs<br>18+ only. Predictions are not financial advice.</p></div>';
  };

  // ── Pro (Google Play subscriptions) ──
  let BILL = { status: HAS_BILLING ? 'loading' : 'none', plans: [], busy: false };
  let premPlan = 'yearly'; let restoreRequested = false;
  const periodText = p => ({ P1W: 'week', P1M: 'month', P3M: '3 months', P6M: '6 months', P1Y: 'year' }[p] || p);
  function trialText(p) { const m = /^P(\d+)([DWM])$/.exec(p || ''); if (!m) return ''; return m[2] === 'M' ? m[1] + '-month' : (+m[1] * (m[2] === 'W' ? 7 : 1)) + '-day'; }
  function planInfo() {
    const out = {};
    (BILL.plans || []).forEach(pl => {
      const ph = pl.phases || []; const last = ph[ph.length - 1]; if (!last) return;
      const free = ph.find(x => x.micros === 0); const cur = out[pl.basePlanId] || {};
      if (!cur.price || free) out[pl.basePlanId] = { price: last.price, period: periodText(last.period), micros: last.micros, trial: free ? trialText(free.period) : (cur.trial || '') };
    });
    return out;
  }
  window.HPBilling = raw => {
    let e; try { e = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (x) { return; }
    if (e.type === 'plans') { BILL.status = 'ready'; BILL.plans = e.plans || []; }
    else if (e.type === 'not_listed') { BILL.status = 'not_listed'; BILL.busy = false; }
    else if (e.type === 'cancelled') { BILL.busy = false; toast('Purchase cancelled'); }
    else if (e.type === 'error') { BILL.busy = false; if (e.where === 'unavailable') BILL.status = 'unavailable'; toast(e.message); }
    else if (e.type === 'entitlement') {
      const was = isPro(); const asked = restoreRequested; restoreRequested = false; BILL.busy = false;
      S.pro = { active: !!e.active, autoRenewing: !!e.autoRenewing, checkedAt: Date.now() }; save();
      if (e.pending) toast('Your payment is pending. Pro switches on once Google confirms it.');
      else if (e.active && !was) toast('Welcome to Fusion Predict Pro ★');
      else if (asked) toast(e.active ? 'Pro restored ★' : 'No active subscription found');
    }
    const r = curRoute(); if (/^\/(premium|profile|home|match)/.test(r)) render();
  };
  function testSwitchHtml() {
    return '<div class="card test-card"><div class="row"><div class="spacer"><b>🧪 Turn on Pro for testing</b><br><span class="small muted">Only in test builds. Unlocks every Pro feature without paying. Play Store customers don’t see this.</span></div>' +
      '<button class="switch ' + (S.proTest ? 'on' : '') + '" role="switch" aria-checked="' + (S.proTest ? 'true' : 'false') + '" aria-label="Pro for testing" data-act="toggleProTest"><span></span></button></div></div>';
  }
  views.premium = () => {
    const info = planInfo();
    const m = info.monthly || { price: PRICES.monthly, period: 'month' };
    const y = info.yearly || { price: PRICES.yearly, period: 'year', trial: PRICES.trialDays + '-day' };
    const sel = premPlan === 'monthly' ? m : y;
    const saving = info.monthly && info.yearly && info.monthly.micros ? Math.round((1 - info.yearly.micros / (info.monthly.micros * 12)) * 100) : 31;
    const perMonth = info.yearly && info.yearly.micros ? 'R' + (info.yearly.micros / 12e6).toFixed(2) : PRICES.yearlyPerMonth;
    let action;
    if (S.pro && S.pro.active) action = '<div class="alert ok"><b>★ Fusion Predict Pro is active.</b> Thank you!</div><a class="btn ghost block" href="https://play.google.com/store/account/subscriptions?sku=' + PRODUCT_ID + '&package=' + PACKAGE + '">Manage or cancel subscription</a>';
    else if (HAS_BILLING && BILL.status === 'ready') action = '<button class="btn block" data-act="buyPro"' + (BILL.busy ? ' disabled' : '') + '>' + (sel.trial ? 'Start ' + sel.trial + ' free trial' : 'Subscribe for ' + sel.price + '/' + sel.period) + '</button><p class="small muted center mt">' + (sel.trial ? 'Free for ' + sel.trial.replace('-', ' ') + 's, then ' : '') + sel.price + ' per ' + sel.period + '. Cancel anytime in Google Play.</p>';
    else if (HAS_BILLING && BILL.status === 'loading') action = '<div class="center"><div class="spinner"></div><p class="small muted">Loading prices from Google Play…</p></div>';
    else action = '<div class="alert info"><b>Payments open when Fusion Predict is on Google Play.</b><br>' + (TEST_BUILD ? 'This is a test version, so use the switch below to try every Pro feature for free.' : 'Please install Fusion Predict from the Google Play Store to subscribe.') + '</div>';
    return topbar('Fusion Predict Pro', true) + '<div class="wrap">' +
      '<div class="card center pro-hero"><img class="logo-sm" src="' + ICON + '" alt=""><h1 class="mt">Read every game</h1><p>The full analysis, for every match you care about.</p></div>' +
      '<div class="card"><table class="compare"><thead><tr><th></th><th>Free</th><th>Pro</th></tr></thead><tbody>' +
      [['Predictions', FREE_PER_WEEK + ' a week', 'Unlimited*'], ['Win/draw/loss chances & our pick', '✓', '✓'], ['Match preview & key factors', '✓', '✓'], ['Full stats comparison & team news', '–', '✓'], ['Every scoreline & goal lines', '–', '✓'], ['Goal-scorer chances', '–', '✓'], ['Fair odds & value vs bookmaker', '–', '✓'], ['Match scenarios', '–', '✓']]
        .map(r => '<tr><td>' + r[0] + '</td><td>' + r[1] + '</td><td><b>' + r[2] + '</b></td></tr>').join('') + '</tbody></table><p class="small muted mt">*Fair use: up to ' + PRO_PER_DAY + ' predictions a day.</p></div>' +
      (S.pro && S.pro.active ? '' :
        '<button class="plan-opt ' + (premPlan === 'yearly' ? 'on' : '') + '" data-act="premPlan" data-val="yearly"><span class="spacer"><b>Yearly</b> <span class="pill">Save ' + saving + '%</span><br><span class="small muted">' + y.price + ' a year · ' + perMonth + ' a month' + (y.trial ? ' · ' + y.trial + ' free trial' : '') + '</span></span><span class="price-big">' + y.price + '</span></button>' +
        '<button class="plan-opt ' + (premPlan === 'monthly' ? 'on' : '') + '" data-act="premPlan" data-val="monthly"><span class="spacer"><b>Monthly</b><br><span class="small muted">Cancel anytime</span></span><span class="price-big">' + m.price + '</span></button>') +
      action + (HAS_BILLING ? '<button class="linkbtn block center mt" data-act="restorePro">Restore purchases</button>' : '') + (TEST_BUILD ? testSwitchHtml() : '') +
      '<p class="disclaimer">Payment is charged to your Google Play account. The subscription renews automatically unless cancelled at least 24 hours before the end of the current period. 18+ only. Predictions are estimates and not financial advice.</p></div>';
  };

  // ───────── Flow logic ─────────
  function resizeImage(file) {
    return new Promise((resolve, reject) => {
      if (file.type && !/^image\//.test(file.type)) { reject(new Error('That file isn’t an image. Choose a screenshot (JPG or PNG).')); return; }
      const url = URL.createObjectURL(file); const img = new Image();
      img.onload = () => { const k = Math.min(1, 1600 / Math.max(img.width, img.height)); const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url); resolve(c.toDataURL('image/jpeg', 0.88)); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That image couldn’t be opened. Try another screenshot.')); };
      img.src = url;
    });
  }
  function canStart() {
    if (window.HP_EMBED) { openDemo(); return false; }
    if (predictionsLeft() <= 0) { go('/premium'); toast(isPro() ? 'You’ve reached today’s fair-use limit. Try again tomorrow.' : 'You’ve used this week’s free predictions. Go Pro for unlimited.'); return false; }
    if (!aiReady()) { flow = { stage: 'error', error: 'The AI isn’t connected yet. Paste your AI key below, then try again.', configError: true }; go('/predict'); render(); return false; }
    return true;
  }
  async function onShot(e) {
    const f = e.target.files && e.target.files[0]; e.target.value = ''; if (!f) return;
    if (!canStart()) return;
    let img; try { img = await resizeImage(f); } catch (err) { toast(err.message); return; }
    flow = { stage: 'reading', img }; if (!curRoute().startsWith('/predict')) go('/predict'); else render();
    try {
      const r = await AI.readScreenshot(img.split(',')[1], 'image/jpeg');
      const foot = (r.matches || []);
      if (r.sport === 'other' && !foot.length) throw new Error('This looks like a different sport. Fusion Predict covers football for now.');
      if (!foot.length) throw new Error('We couldn’t find a football match on this screenshot. Make sure both team names are visible, or type the teams instead.');
      flow.matches = foot;
      if (foot.length === 1) useMatch(foot[0]); else flow.stage = 'choose';
    } catch (err) { flow = { stage: 'error', error: err.message, configError: !!err.config, img, retry: 'read' }; }
    if (curRoute().startsWith('/predict')) render();
  }
  function useMatch(m) { flow.match = { home: m.home, away: m.away, competition: m.competition || '', kickoff: m.kickoff || '' }; flow.odds = m.odds || {}; flow.bookmaker = m.bookmaker || ''; flow.stage = 'confirm'; }
  async function runResearch() {
    if (!canStart()) return;
    const match = flow.match; flow.stage = 'researching'; flow.searches = 0; flow.query = ''; render();
    try {
      const data = await AI.research(match, todayLong(), (n, q) => { flow.searches = n; flow.query = q || ''; if (curRoute().startsWith('/predict')) render(); });
      if (!data.home || !data.away) throw new Error('The research came back incomplete. Please try again.');
      data.home.name = data.home.name || match.home; data.away.name = data.away.name || match.away;
      const entry = { id: uid(), at: Date.now(), match: { home: data.home.name, away: data.away.name, competition: (data.match && data.match.competition) || match.competition, kickoff: (data.match && data.match.kickoff) || match.kickoff }, odds: flow.odds || {}, data, final: null };
      M.predict(data); // throws early if the data is unusable
      S.history.unshift(entry); if (S.history.length > 80) S.history.length = 80;
      countUse(); S.aiTest = { ok: true, at: Date.now() }; save();
      resetFlow(); tab = 'overview'; go('/match/' + entry.id);
    } catch (err) {
      flow = Object.assign(flow, { stage: 'error', error: err.message || 'Something went wrong. Please try again.', configError: !!err.config, retry: 'research' });
      if (curRoute().startsWith('/predict')) render();
    }
  }
  function openDemo() { tab = 'overview'; go('/match/demo'); }
  async function testAI() {
    if (!aiReady()) { toast('Paste your AI key first'); return; }
    toast('Testing the AI connection…');
    try { await AI.test(); S.aiTest = { ok: true, at: Date.now() }; toast('✅ AI connected'); }
    catch (e) { S.aiTest = { ok: false, msg: e.message, at: Date.now() }; toast('⚠️ ' + e.message); }
    save(); render();
  }

  // ───────── Router render ─────────
  function render() {
    const raw = curRoute(); const [path] = raw.split('?'); const parts = path.split('/').filter(Boolean);
    let name = parts[0] || 'home'; const arg = parts[1];
    if (!S.profile && name !== 'setup') name = views._ageDone ? 'setup' : 'welcome';
    const fn = views[name] || views.home;
    const noTabs = name === 'welcome' || (name === 'setup' && !S.profile);
    document.body.classList.toggle('no-tabs', noTabs);
    $('#tabbar').hidden = noTabs;
    document.querySelectorAll('#tabbar a').forEach(a => a.classList.toggle('on', a.dataset.tab === name || (name === 'match' && a.dataset.tab === 'history')));
    $('#app').innerHTML = fn(arg) + (noTabs ? '' : credit());
    document.querySelectorAll('.shot-input').forEach(i => i.addEventListener('change', onShot));
    if (render.last !== path) { window.scrollTo(0, 0); render.last = path; }
  }

  // ───────── Actions ─────────
  const A = {
    back() { back(); },
    closeSheet() { closeSheet(); },
    confirmYes() { const cb = askConfirm.cb; askConfirm.cb = null; closeSheet(); if (cb) cb(); },
    ageTick(el) { views._age = el.checked; render(); },
    startSetup() { if (!views._age) return; views._ageDone = true; go('/setup'); render(); },
    toggleLeague(el) { const v = el.dataset.val; const i = draft.leagues.indexOf(v); i >= 0 ? draft.leagues.splice(i, 1) : draft.leagues.push(v); render(); },
    finishSetup() { const edit = !!S.profile; S.profile = Object.assign({ adult: true, at: Date.now() }, draft); draft = null; save(); if (edit) { toast('Profile saved'); back(); } else { go('/home'); toast('You’re ready. Upload a screenshot to predict a match ⚽'); } },
    typeTeams() { if (window.HP_EMBED) { openDemo(); return; } flow = { stage: 'type', match: flow.match }; go('/predict'); render(); },
    takePhoto() {
      if (HPN && HPN.cameraStatus && HPN.cameraStatus() === 'prompt') { HPN.requestCamera(); return; }
      const i = $('#shot-cam'); if (i) i.click();
    },
    chooseMatch(el) { useMatch(flow.matches[+el.dataset.i]); render(); },
    swapTeams() { const m = flow.match; const o = flow.odds || {}; flow.match = Object.assign({}, m, { home: m.away, away: m.home }); flow.odds = Object.assign({}, o, { home: o.away, away: o.home }); render(); },
    editMatch() { flow.stage = 'type'; render(); },
    runResearch() { runResearch(); },
    resetFlow() { resetFlow(); render(); },
    retryFlow() { if (flow.retry === 'research' && flow.match) runResearch(); else resetFlow(), render(); },
    openDemo() { openDemo(); },
    tab(el) { tab = el.dataset.val; render(); },
    clearFinal(el) { const e = S.history.find(h => h.id === el.dataset.id); if (e) { e.final = null; save(); render(); } },
    clearHistory() { askConfirm('Delete all saved predictions?', 'Delete', () => { S.history = []; save(); render(); }); },
    testAI() { testAI(); },
    premPlan(el) { premPlan = el.dataset.val; render(); },
    buyPro() { if (!HAS_BILLING) return; BILL.busy = true; render(); HPN.billingBuy(premPlan); setTimeout(() => { if (BILL.busy) { BILL.busy = false; render(); } }, 15000); },
    restorePro() { if (!HAS_BILLING) return; restoreRequested = true; toast('Checking Google Play…'); HPN.billingRestore(); },
    toggleProTest() { S.proTest = !S.proTest; save(); render(); toast(S.proTest ? 'Pro switched on for testing ★' : 'Pro testing switched off'); },
    reset() { askConfirm('Delete all Fusion Predict data from this phone? This can’t be undone.', 'Delete everything', () => { try { localStorage.removeItem(STORE_KEY); } catch (e) { /* ignore */ } S = defaults(); views._age = false; views._ageDone = false; STACK.length = 0; go('/welcome'); render(); }); },
  };
  window.HPCameraPermission = status => {
    if (status === 'granted') toast('Camera allowed. Tap “Take a photo” again.');
    else toast('Camera access is off. You can still upload a screenshot, or allow the camera in phone Settings → Apps → Fusion Predict.');
  };

  document.addEventListener('click', e => {
    if (!USE_HASH) { const a = e.target.closest('a[href^="#/"]'); if (a) { e.preventDefault(); go(a.getAttribute('href').slice(1)); return; } }
    const el = e.target.closest('[data-act]'); if (!el) { if (e.target.id === 'sheet') closeSheet(); return; }
    const fn = A[el.dataset.act]; if (!fn) return;
    if (el.tagName !== 'INPUT') e.preventDefault();
    fn(el, e);
  });
  document.addEventListener('input', e => {
    const el = e.target;
    if (el.dataset.bind && draft) { draft[el.dataset.bind] = el.value; return; }
    if (el.dataset.setting) { S[el.dataset.setting] = el.value.trim(); S.aiTest = null; save(); }
  });
  document.addEventListener('submit', e => {
    const f = e.target; const kind = f.dataset.form; if (!kind) return; e.preventDefault();
    const fd = new FormData(f);
    if (kind === 'typed') {
      const home = String(fd.get('home') || '').trim(), away = String(fd.get('away') || '').trim();
      if (!home || !away) { toast('Enter both teams'); return; }
      flow.match = { home, away, competition: String(fd.get('competition') || '').trim(), kickoff: String(fd.get('kickoff') || '').trim() };
      flow.odds = flow.odds || {}; runResearch();
    }
    if (kind === 'final') {
      const h = +fd.get('h'), a = +fd.get('a'); const en = S.history.find(x => x.id === f.dataset.id);
      if (en && h >= 0 && a >= 0) { en.final = { h, a }; save(); render(); toast(M.settle(predOf(en).pick.key, h, a) ? '✅ Our pick was right' : 'Score saved'); }
    }
  });
  if (USE_HASH) window.addEventListener('hashchange', () => { closeSheet(); render(); });
  if (HAS_BILLING) { try { HPN.billingRefresh(); } catch (e) { BILL.status = 'unavailable'; } }
  if (S.profile) views._age = true;
  render();
})();
