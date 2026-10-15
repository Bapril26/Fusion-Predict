/**
 * Fusion Predict – AI proxy server (Cloudflare Worker)
 * Keeps the Anthropic API key on the server instead of inside the app.
 *
 * Deploy (free tier is fine to start):
 *   1. dash.cloudflare.com → Workers & Pages → Create → Worker → paste this file → Deploy
 *   2. Worker → Settings → Variables → add a SECRET named ANTHROPIC_API_KEY
 *   3. Put the worker URL in app.js (DEFAULT_SERVER_URL) for Play Store builds,
 *      or paste it under Profile → AI connection → Fusion Labs server for testing.
 *
 * The app sends { request: <Messages API body> }. Only the models, tools and sizes the app
 * needs are allowed, so the key can't be used for anything else.
 */
const ALLOWED_MODELS = ['claude-sonnet-5-5', 'claude-haiku-5-5'];
const MAX_TOKENS = 6000;
const MAX_BODY = 8 * 1024 * 1024;

const CORS = {
  'Access-Control-Allow-Origin': 'https://appassets.androidplatform.net',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type',
};
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...CORS } });

function sanitise(req) {
  if (!req || typeof req !== 'object' || !Array.isArray(req.messages)) throw new Error('Invalid request');
  const model = ALLOWED_MODELS.includes(req.model) ? req.model : ALLOWED_MODELS[0];
  const out = { model, max_tokens: Math.min(+req.max_tokens || 1500, MAX_TOKENS), messages: req.messages };
  if (Array.isArray(req.tools) && req.tools.length) {
    // Only web search, with at most 8 searches per request
    out.tools = req.tools.filter(t => t && t.type === 'web_search_20250305').map(t => ({
      type: 'web_search_20250305', name: 'web_search', max_uses: Math.min(+t.max_uses || 8, 8),
      user_location: { type: 'approximate', country: 'ZA', timezone: 'Africa/Johannesburg' },
    }));
  }
  return out;
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    if (request.method !== 'POST') return json({ error: { message: 'Use POST' } }, 405);
    if (!env.ANTHROPIC_API_KEY) return json({ error: { message: 'The server has no ANTHROPIC_API_KEY secret set.' } }, 500);
    const len = +request.headers.get('content-length') || 0;
    if (len > MAX_BODY) return json({ error: { message: 'Request too large' } }, 413);

    let body;
    try { body = await request.json(); } catch { return json({ error: { message: 'Invalid request' } }, 400); }
    let req;
    try { req = sanitise(body.request); } catch (e) { return json({ error: { message: e.message } }, 400); }

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(req),
    });
    const text = await res.text();
    return new Response(text, { status: res.status, headers: { 'content-type': 'application/json', ...CORS } });
  },
};
