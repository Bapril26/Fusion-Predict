/* Fusion Predict – football match model
 * Turns researched team data into expected goals, a Dixon–Coles adjusted Poisson score matrix,
 * outcome probabilities, scorelines, totals, scenarios, scorer chances and fair odds.
 * Pure functions only, so it can be tested outside the app.
 */
(function (root) {
  'use strict';
  const MAXG = 10;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const num = (x) => (x === null || x === undefined || x === '' || isNaN(+x)) ? null : +x;

  function poisson(k, l) { let p = Math.exp(-l); for (let i = 1; i <= k; i++) p *= l / i; return p; }

  // Dixon–Coles low-score correction (rho < 0 slightly raises 0-0 and 1-1)
  function tau(h, a, lh, la, rho) {
    if (h === 0 && a === 0) return 1 - lh * la * rho;
    if (h === 0 && a === 1) return 1 + lh * rho;
    if (h === 1 && a === 0) return 1 + la * rho;
    if (h === 1 && a === 1) return 1 - rho;
    return 1;
  }

  function matrix(lh, la, rho) {
    rho = rho === undefined ? -0.08 : rho;
    const m = []; let sum = 0;
    for (let h = 0; h <= MAXG; h++) {
      m[h] = [];
      for (let a = 0; a <= MAXG; a++) { const p = poisson(h, lh) * poisson(a, la) * Math.max(0, tau(h, a, lh, la, rho)); m[h][a] = p; sum += p; }
    }
    for (let h = 0; h <= MAXG; h++) for (let a = 0; a <= MAXG; a++) m[h][a] /= sum;
    return m;
  }

  // Sum of probabilities over cells matching a condition
  function prob(m, fn) { let p = 0; for (let h = 0; h <= MAXG; h++) for (let a = 0; a <= MAXG; a++) if (fn(h, a)) p += m[h][a]; return p; }

  function outcomes(m) {
    return { home: prob(m, (h, a) => h > a), draw: prob(m, (h, a) => h === a), away: prob(m, (h, a) => h < a) };
  }

  function topScores(m, n) {
    const list = [];
    for (let h = 0; h <= 6; h++) for (let a = 0; a <= 6; a++) list.push({ h, a, p: m[h][a] });
    return list.sort((x, y) => y.p - x.p).slice(0, n || 6);
  }

  function totals(m) {
    const lines = [0.5, 1.5, 2.5, 3.5, 4.5].map(t => ({ line: t, over: prob(m, (h, a) => h + a > t) }));
    lines.forEach(l => { l.under = 1 - l.over; });
    const dist = []; for (let g = 0; g <= 6; g++) dist.push({ goals: g === 6 ? '6+' : String(g), p: g === 6 ? prob(m, (h, a) => h + a >= 6) : prob(m, (h, a) => h + a === g) });
    return { lines, btts: prob(m, (h, a) => h > 0 && a > 0), dist, homeCS: prob(m, (h, a) => a === 0), awayCS: prob(m, (h, a) => h === 0) };
  }

  // How the result chances change if a condition is true
  function scenarios(m) {
    const defs = [
      ['Over 2.5 goals', (h, a) => h + a > 2.5],
      ['Under 2.5 goals', (h, a) => h + a < 2.5],
      ['Both teams score', (h, a) => h > 0 && a > 0],
      ['Not both teams score', (h, a) => h === 0 || a === 0],
      ['Home team scores 2+', (h) => h >= 2],
      ['Away team scores 2+', (h, a) => a >= 2],
    ];
    return defs.map(([label, fn]) => {
      const pc = prob(m, fn);
      const o = pc > 0 ? { home: prob(m, (h, a) => fn(h, a) && h > a) / pc, draw: prob(m, (h, a) => fn(h, a) && h === a) / pc, away: prob(m, (h, a) => fn(h, a) && h < a) / pc } : { home: 0, draw: 0, away: 0 };
      return { label, chance: pc, outcome: o };
    });
  }

  // ── Odds helpers ──
  function decimalOdds(p) { return p > 0 ? 1 / p : null; }
  function american(dec) { if (!dec || dec <= 1) return '–'; return dec >= 2 ? '+' + Math.round((dec - 1) * 100) : String(Math.round(-100 / (dec - 1))); }
  function fractional(dec) {
    if (!dec || dec <= 1) return '–';
    const x = dec - 1; let best = [1, 1], err = Infinity;
    for (let d = 1; d <= 20; d++) { const n = Math.round(x * d); if (n < 1) continue; const e = Math.abs(n / d - x); if (e < err - 1e-9) { err = e; best = [n, d]; } }
    const g = (a, b) => b ? g(b, a % b) : a; const k = g(best[0], best[1]);
    return (best[0] / k) + '/' + (best[1] / k);
  }
  function fair(p) { const dec = decimalOdds(p); return { p, decimal: dec, fractional: fractional(dec), american: american(dec) }; }
  // Expected value of a R1 stake at the bookmaker price, using our probability
  function value(p, bookDec) { const b = num(bookDec); if (!b || b <= 1) return null; return { book: b, implied: 1 / b, edge: p * b - 1 }; }

  // ── Expected goals from researched data ──
  const perGame = (rec, key) => { if (!rec) return null; const g = num(rec.played); const v = num(rec[key]); return g && v !== null ? v / g : null; };

  // Shrinks a small-sample rate towards the league average
  function shrink(rate, n, prior, k) { if (rate === null || !n) return prior; return (rate * n + prior * k) / (n + k); }

  function absenceAdjust(list) {
    let att = 0, def = 0;
    (list || []).forEach(x => {
      const role = String(x.position || x.role || '').toUpperCase().slice(0, 3);
      const imp = String(x.importance || x.impact || '').toLowerCase();
      const w = imp.startsWith('key') || imp === 'high' ? 0.06 : imp.startsWith('reg') || imp === 'medium' ? 0.03 : 0.01;
      if (role.startsWith('FW') || role.startsWith('ATT') || role.startsWith('ST') || role.startsWith('WIN')) att += w;
      else if (role.startsWith('MID') || role.startsWith('MF') || role.startsWith('CM') || role.startsWith('AM')) { att += w * 0.6; def += w * 0.4; }
      else if (role.startsWith('DEF') || role.startsWith('DF') || role.startsWith('CB') || role.startsWith('FB') || role.startsWith('GK') || role.startsWith('GOA')) def += w;
    });
    return { att: Math.min(att, 0.18), def: Math.min(def, 0.18) };
  }

  /**
   * data: research JSON (see SCHEMA in app.js). Returns { lh, la, notes[], quality }
   */
  function expectedGoals(data) {
    const L = data.league || {};
    const lgH = clamp(num(L.avg_home_goals) || 1.45, 0.8, 2.2);
    const lgA = clamp(num(L.avg_away_goals) || 1.15, 0.6, 1.9);
    const H = data.home || {}, A = data.away || {};
    const notes = []; let quality = 0, checks = 0;
    const has = v => { checks++; if (v !== null && v !== undefined) quality++; return v; };

    // Venue-specific scoring/conceding rates, falling back to overall rates
    const hHome = H.home_record || {}, aAway = A.away_record || {}, hAll = H.overall || {}, aAll = A.overall || {};
    let hGF = has(perGame(hHome, 'gf')), hGA = perGame(hHome, 'ga'), nH = num(hHome.played) || 0;
    let aGF = has(perGame(aAway, 'gf')), aGA = perGame(aAway, 'ga'), nA = num(aAway.played) || 0;
    if (hGF === null) { hGF = perGame(hAll, 'gf'); hGA = perGame(hAll, 'ga'); nH = (num(hAll.played) || 0) / 2; }
    if (aGF === null) { aGF = perGame(aAll, 'gf'); aGA = perGame(aAll, 'ga'); nA = (num(aAll.played) || 0) / 2; }

    // Blend in expected-goals (xG) when available: better at predicting future scoring
    const hx = has(num(H.xg_for_per_game)), hxa = num(H.xg_against_per_game), ax = has(num(A.xg_for_per_game)), axa = num(A.xg_against_per_game);
    if (hx !== null && hGF !== null) hGF = 0.5 * hGF + 0.5 * hx * 1.08; // home boost on overall xG
    if (hxa !== null && hGA !== null) hGA = 0.5 * hGA + 0.5 * hxa * 0.92;
    if (ax !== null && aGF !== null) aGF = 0.5 * aGF + 0.5 * ax * 0.92;
    if (axa !== null && aGA !== null) aGA = 0.5 * aGA + 0.5 * axa * 1.08;

    const K = 4;
    const attH = shrink(hGF, nH, lgH, K) / lgH, defA = shrink(aGA, nA, lgH, K) / lgH;
    const attA = shrink(aGF, nA, lgA, K) / lgA, defH = shrink(hGA, nH, lgA, K) / lgA;
    let lh = lgH * attH * defA, la = lgA * attA * defH;

    // Recent form (last 6) nudges ±15%
    const form = (T, base) => {
      const f = T.last6 || {}; const gf = num(f.gf), ga = num(f.ga), g = num(f.played) || 6;
      if (gf === null || ga === null || !base) return [1, 1];
      has(gf);
      return [clamp(Math.pow((gf / g + 0.4) / (base.gf + 0.4), 0.35), 0.85, 1.15), clamp(Math.pow((ga / g + 0.4) / (base.ga + 0.4), 0.35), 0.85, 1.15)];
    };
    const baseH = hAll.played ? { gf: (num(hAll.gf) || 0) / hAll.played, ga: (num(hAll.ga) || 0) / hAll.played } : null;
    const baseA = aAll.played ? { gf: (num(aAll.gf) || 0) / aAll.played, ga: (num(aAll.ga) || 0) / aAll.played } : null;
    const [fhA, fhD] = form(H, baseH), [faA, faD] = form(A, baseA);
    lh *= fhA * faD; la *= faA * fhD;
    if (fhA > 1.05) notes.push((H.name || 'Home') + ' are scoring more than usual lately');
    if (faA > 1.05) notes.push((A.name || 'Away') + ' are scoring more than usual lately');
    if (fhD > 1.05) notes.push((H.name || 'Home') + ' have been leaking more goals recently');
    if (faD > 1.05) notes.push((A.name || 'Away') + ' have been leaking more goals recently');

    // Injuries and suspensions
    const adjH = absenceAdjust(H.absences), adjA = absenceAdjust(A.absences);
    lh *= (1 - adjH.att) * (1 + adjA.def); la *= (1 - adjA.att) * (1 + adjH.def);
    if (adjH.att + adjH.def >= 0.06) notes.push((H.name || 'Home') + ' are missing important players');
    if (adjA.att + adjA.def >= 0.06) notes.push((A.name || 'Away') + ' are missing important players');

    // Short rest (fewer than 4 days)
    const rH = num(H.rest_days), rA = num(A.rest_days);
    if (rH !== null && rH < 4) { lh *= 0.97; la *= 1.03; notes.push((H.name || 'Home') + ' have had little rest'); }
    if (rA !== null && rA < 4) { la *= 0.97; lh *= 1.03; notes.push((A.name || 'Away') + ' have had little rest'); }

    // Neutral venue removes home advantage
    if (data.neutral_venue === true) { const avg = (lh + la) / 2; lh = (lh + avg) / 2; la = (la + avg) / 2; }

    has(num(L.avg_home_goals)); has((data.h2h || []).length ? 1 : null); has((H.absences || A.absences) ? 1 : null);
    return { lh: clamp(lh, 0.15, 4.5), la: clamp(la, 0.15, 4.5), notes, quality: checks ? quality / checks : 0 };
  }

  function scorers(team, lambda, teamGoals) {
    const tg = num(teamGoals);
    return (team.top_scorers || []).slice(0, 5).map(s => {
      const goals = num(s.goals) || 0; if (!tg || !goals) return null;
      const share = clamp(goals / tg, 0, 0.6);
      const start = String(s.availability || '').toLowerCase().startsWith('doubt') ? 0.55 : String(s.availability || '').toLowerCase().startsWith('out') ? 0 : 0.9;
      const lp = lambda * share * start;
      return { name: s.name, goals, p: 1 - Math.exp(-lp), status: s.availability || '' };
    }).filter(x => x && x.p > 0).sort((a, b) => b.p - a.p);
  }

  function pick(o, t) {
    const opts = [
      { label: 'Home win', key: 'home', p: o.home }, { label: 'Draw', key: 'draw', p: o.draw }, { label: 'Away win', key: 'away', p: o.away },
    ];
    const best = opts.slice().sort((a, b) => b.p - a.p)[0];
    if (best.p >= 0.5) return best;
    const dc = [{ label: 'Home or draw', key: '1X', p: o.home + o.draw }, { label: 'Away or draw', key: 'X2', p: o.away + o.draw }].sort((a, b) => b.p - a.p)[0];
    const goals = [{ label: 'Over 2.5 goals', key: 'O2.5', p: t.lines[2].over }, { label: 'Under 2.5 goals', key: 'U2.5', p: t.lines[2].under }, { label: 'Both teams to score', key: 'BTTS', p: t.btts }, { label: 'Not both teams to score', key: 'NBTTS', p: 1 - t.btts }].sort((a, b) => b.p - a.p)[0];
    if (goals.p >= 0.62 && goals.p > dc.p - 0.08) return goals;
    return dc;
  }

  function confidence(p, quality) {
    let c = p >= 0.68 ? 2 : p >= 0.56 ? 1 : 0;
    if (quality < 0.3) c = 0;
    else if (quality < 0.5) c = Math.max(0, c - 1);
    return ['Low', 'Medium', 'High'][c];
  }

  // Full prediction from research data
  function predict(data) {
    const xg = expectedGoals(data);
    const m = matrix(xg.lh, xg.la);
    const o = outcomes(m); const t = totals(m);
    const p = pick(o, t);
    const hAll = (data.home || {}).overall || {}, aAll = (data.away || {}).overall || {};
    return {
      lh: xg.lh, la: xg.la, quality: xg.quality, notes: xg.notes,
      outcomes: o, totals: t, scores: topScores(m, 6), scenarios: scenarios(m),
      pick: p, confidence: confidence(p.p, xg.quality),
      scorers: { home: scorers(data.home || {}, xg.lh, hAll.gf), away: scorers(data.away || {}, xg.la, aAll.gf) },
      fair: { home: fair(o.home), draw: fair(o.draw), away: fair(o.away), over25: fair(t.lines[2].over), under25: fair(t.lines[2].under), bttsYes: fair(t.btts), bttsNo: fair(1 - t.btts) },
    };
  }

  // Did the pick win, given the final score?
  function settle(pk, h, a) {
    switch (pk) {
      case 'home': return h > a; case 'draw': return h === a; case 'away': return h < a;
      case '1X': return h >= a; case 'X2': return a >= h;
      case 'O2.5': return h + a > 2.5; case 'U2.5': return h + a < 2.5;
      case 'BTTS': return h > 0 && a > 0; case 'NBTTS': return h === 0 || a === 0;
      default: return null;
    }
  }

  const api = { poisson, matrix, outcomes, topScores, totals, scenarios, fair, value, american, fractional, expectedGoals, predict, settle, absenceAdjust };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.FPModel = api;
})(typeof window !== 'undefined' ? window : this);
