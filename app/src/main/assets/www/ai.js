/* Fusion Predict – AI service calls (Claude by Anthropic)
 * 1) readScreenshot: finds the match(es) and any bookmaker odds in a screenshot (vision)
 * 2) research: searches the web for current form, team news, head-to-head and stats, returned as JSON
 * Calls go straight to the API with the owner's key (testing) or through a Fusion Labs server.
 */
(function (root) {
  'use strict';
  const API_URL = 'https://api.anthropic.com/v1/messages';
  const DEFAULT_MODEL = 'claude-sonnet-5-5';

  const TEAM_SHAPE = '{"name":"","position":null,"points":null,"overall":{"played":0,"w":0,"d":0,"l":0,"gf":0,"ga":0},"home_record":{"played":0,"w":0,"d":0,"l":0,"gf":0,"ga":0},"away_record":{"played":0,"w":0,"d":0,"l":0,"gf":0,"ga":0},"last6":{"played":6,"results":"WDLWWL","gf":0,"ga":0},"xg_for_per_game":null,"xg_against_per_game":null,"clean_sheets":null,"btts_pct":null,"over25_pct":null,"shots_per_game":null,"possession_pct":null,"top_scorers":[{"name":"","goals":0,"availability":"available|doubtful|out"}],"absences":[{"name":"","position":"GK|DEF|MID|FWD","importance":"key|regular|squad","reason":""}],"rest_days":null}';

  function researchPrompt(m, today) {
    return 'You are the research engine of Fusion Predict, a football match analysis app. Today is ' + today + ' (South African time).\n\n' +
      'Match: ' + m.home + ' vs ' + m.away + (m.competition ? ' (' + m.competition + ')' : '') + (m.kickoff ? ', kick-off ' + m.kickoff : '') + '.\n' +
      'The first team named is the home team. If this fixture is not the next scheduled meeting, use the next one.\n\n' +
      'Search the web for up-to-date facts: both teams\' CURRENT domestic league season table (played, wins, draws, losses, goals for and against), their home and away splits, last 6 results in all competitions, expected goals (xG) if published, team news (injuries, suspensions, doubtful players), predicted or confirmed line-ups, top league scorers per team, days since each team\'s previous match, recent head-to-head results, and the league\'s average home and away goals per game this season (or last season if too early).\n' +
      'Prefer reliable sources such as the league\'s official site, BBC Sport, ESPN, Sky Sports, FBref, Soccerway, Flashscore, FotMob, Transfermarkt and KickOff.com. Use a handful of focused searches.\n\n' +
      'Then reply with ONLY one JSON object, no other text, in exactly this shape (use null when a number is genuinely unavailable; never invent numbers):\n' +
      '{"match":{"home":"","away":"","competition":"","kickoff":"YYYY-MM-DD HH:MM SAST","venue":"","neutral_venue":false},' +
      '"league":{"name":"","season":"","avg_home_goals":null,"avg_away_goals":null},' +
      '"home":' + TEAM_SHAPE + ',"away":' + TEAM_SHAPE + ',' +
      '"h2h":[{"date":"YYYY-MM-DD","home":"","away":"","score":"2-1","competition":""}],' +
      '"lineups":"confirmed|predicted|unknown",' +
      '"summary":"2-3 plain sentences on how the match is likely to play out",' +
      '"key_factors":["4-6 short factual points, e.g. key absences, form, home record, head-to-head"],' +
      '"data_as_of":"YYYY-MM-DD",' +
      '"sources":[{"title":"","url":""}]}\n' +
      'Rules: "overall", "home_record" and "away_record" are domestic league games this season only. "last6.results" lists the most recent first. Keep "key_factors" neutral and factual. Do not recommend bets.';
  }

  const SCREENSHOT_PROMPT = 'This is a screenshot from a sportsbook, search result, fixture list or TV. Identify every football (soccer) match shown and any bookmaker odds next to them. ' +
    'Convert fractional or American odds to decimal. Reply with ONLY one JSON object, no other text:\n' +
    '{"sport":"football|other|unknown","matches":[{"home":"","away":"","competition":"","kickoff":"as shown, e.g. Sat 18 Oct 15:00","odds":{"home":null,"draw":null,"away":null,"over25":null,"under25":null,"btts_yes":null,"btts_no":null},"bookmaker":""}]}\n' +
    'Use full official team names where you can tell them (e.g. "Man Utd" → "Manchester United"). If there are no matches, return {"sport":"unknown","matches":[]}.';

  function friendlyError(status, body, model) {
    const raw = body && body.error ? (typeof body.error === 'string' ? body.error : body.error.message || '') : '';
    let msg;
    if (status === 401) msg = 'The AI key was rejected. Check that you pasted the whole key.';
    else if (status === 403) msg = 'This key isn’t allowed to use the AI service. Check your Anthropic account.';
    else if (status === 404) msg = 'The AI model “' + model + '” wasn’t found. Clear the AI model box in Profile to use the default.';
    else if (/credit|billing|balance/i.test(raw)) msg = 'Your Anthropic account has run out of credit. Add credit at console.anthropic.com.';
    else if (/web search|web_search/i.test(raw)) msg = 'Web search is switched off for this Anthropic account. Turn it on in the Claude Console under Settings → Privacy/Features.';
    else if (status === 413) msg = 'The screenshot is too large. Try a smaller one.';
    else if (status === 429) msg = 'Too many requests in a short time. Wait a minute and try again.';
    else if (status >= 500) msg = 'The AI service is busy right now. Try again in a moment.';
    else msg = raw || 'The AI service returned an error (' + status + ').';
    const e = new Error(msg); e.config = [401, 403, 404].includes(status) || /credit|billing|balance|web search/i.test(raw); return e;
  }

  function parseJson(text) {
    const s = String(text || ''); const a = s.indexOf('{'), b = s.lastIndexOf('}');
    if (a < 0 || b <= a) throw new Error('The AI reply couldn’t be read. Please try again.');
    try { return JSON.parse(s.slice(a, b + 1)); } catch (e) { throw new Error('The AI reply couldn’t be read. Please try again.'); }
  }

  function create(cfg) {
    // cfg: () => ({ apiKey, model, serverUrl })
    async function post(body) {
      const c = cfg(); const model = body.model;
      let res;
      try {
        if (c.serverUrl) {
          res = await fetch(c.serverUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ request: body }) });
        } else {
          res = await fetch(API_URL, { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': c.apiKey, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' }, body: JSON.stringify(body) });
        }
      } catch (e) {
        throw new Error('Couldn’t reach the AI service. Check that your phone is online and try again.');
      }
      let j = null; try { j = await res.json(); } catch (e) { /* not JSON */ }
      if (!res.ok) throw friendlyError(res.status, j, model);
      if (!j) throw new Error('The AI reply couldn’t be read. Please try again.');
      return j;
    }

    const textOf = (content) => (content || []).filter(b => b.type === 'text').map(b => b.text).join('');

    async function readScreenshot(b64, mediaType) {
      const c = cfg();
      const j = await post({
        model: c.model || DEFAULT_MODEL, max_tokens: 1500,
        messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: mediaType || 'image/jpeg', data: b64 } }, { type: 'text', text: SCREENSHOT_PROMPT }] }],
      });
      const out = parseJson(textOf(j.content));
      out.matches = (out.matches || []).filter(m => m && m.home && m.away);
      return out;
    }

    async function research(match, today, onProgress) {
      const c = cfg();
      const messages = [{ role: 'user', content: researchPrompt(match, today) }];
      const sources = []; let searches = 0; let final = null;
      for (let turn = 0; turn < 4; turn++) {
        const j = await post({
          model: c.model || DEFAULT_MODEL, max_tokens: 6000, messages,
          tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 8, user_location: { type: 'approximate', country: 'ZA', timezone: 'Africa/Johannesburg' } }],
        });
        (j.content || []).forEach(b => {
          if (b.type === 'server_tool_use') { searches++; if (onProgress) onProgress(searches, b.input && b.input.query); }
          if (b.type === 'web_search_tool_result' && Array.isArray(b.content)) b.content.slice(0, 3).forEach(r => { if (r.url && !sources.some(s => s.url === r.url)) sources.push({ title: r.title || r.url, url: r.url }); });
        });
        if (j.stop_reason === 'pause_turn') { messages.push({ role: 'assistant', content: j.content }); continue; }
        final = j; break;
      }
      if (!final) throw new Error('The research took too long. Please try again.');
      const data = parseJson(textOf(final.content));
      // Prefer the sources the AI cited; fall back to the search results it read
      if (!Array.isArray(data.sources) || !data.sources.length) data.sources = sources.slice(0, 8);
      data.sources = data.sources.filter(s => s && /^https?:\/\//.test(s.url || '')).slice(0, 10);
      data._searches = searches;
      return data;
    }

    async function test() {
      const c = cfg();
      await post({ model: c.model || DEFAULT_MODEL, max_tokens: 5, messages: [{ role: 'user', content: 'Reply with OK' }] });
      return true;
    }

    return { readScreenshot, research, test, DEFAULT_MODEL };
  }

  const api = { create, parseJson, researchPrompt, DEFAULT_MODEL };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.FPAI = api;
})(typeof window !== 'undefined' ? window : this);
