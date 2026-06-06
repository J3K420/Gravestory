// GraveStory proxy — Cloudflare Worker
//
// Front-end calls:
//   POST /gemini/{model-id}   body: Gemini generateContent payload
//   POST /tavily              body: { query, search_depth, max_results, include_answer }
//   POST /wikitree            body: WikiTree searchPerson params as JSON
//   POST /overpass            body: { query: <QL string> }
//   POST /upload-image        body: { data: <base64>, contentType: <mime> }
//
// Secrets (set via `wrangler secret put`):
//   GEMINI_KEY
//   TAVILY_KEY
//   CLIENT_KEY   — shared secret sent by web + mobile as X-Client-Key header.
//                  Blocks direct API calls (curl, scrapers) that have no Origin header.
//                  Not a true secret (it's in client source) but forces meaningful work
//                  to abuse the endpoint and can be rotated independently.
//
// Vars (set in wrangler.toml [vars]):
//   ALLOWED_ORIGIN   comma-separated origins, e.g. "https://j3k420.github.io,http://localhost:5500"
//                    Use "*" only for local testing — never in production.
//   R2_PUBLIC_URL    public base URL for R2 bucket (no trailing slash)
//
// R2 binding: IMAGES

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const TAVILY_URL  = 'https://api.tavily.com/search';

// Allowlist of model IDs that may be called. Prevents callers from requesting
// expensive or experimental models we don't intend to expose.
const ALLOWED_MODELS = new Set([
  'gemini-3.1-flash-lite',
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-2.0-flash',
  'gemini-1.5-flash',
  'gemini-1.5-flash-8b',
]);

// 10 MB decoded limit for image uploads
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

// 64 KB limit for Overpass queries (prevents absurdly large QL payloads)
const MAX_OVERPASS_QUERY_BYTES = 64 * 1024;

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';

    // ALLOWED_ORIGIN may be a single origin or a comma-separated list.
    // Use "*" only for permissive local testing.
    const allowedRaw = env.ALLOWED_ORIGIN || '*';
    const allowed = allowedRaw === '*'
      ? '*'
      : allowedRaw.split(',').map(s => s.trim()).filter(Boolean);

    // ── CORS preflight ────────────────────────────────────────────
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(origin, allowed),
      });
    }

    // ── Auth: Origin check (browser) + CLIENT_KEY (mobile / direct) ──
    //
    // Browser requests include an Origin header — enforce the allowlist.
    // Non-browser requests (React Native, direct API calls) have no Origin
    // header, so Origin checking alone can't stop them. We require a
    // CLIENT_KEY header for those instead.
    //
    // Priority:
    //   1. If allowed === "*" → skip all checks (local dev only)
    //   2. If Origin present → must be in allowlist
    //   3. If no Origin → must supply X-Client-Key matching CLIENT_KEY secret
    if (allowed !== '*') {
      if (origin) {
        if (!allowed.includes(origin)) {
          return json({ error: 'Forbidden origin' }, 403, origin, allowed);
        }
      } else {
        // No Origin — require the shared client key
        const clientKey = request.headers.get('X-Client-Key') || '';
        if (!env.CLIENT_KEY || clientKey !== env.CLIENT_KEY) {
          return json({ error: 'Forbidden' }, 403, origin, allowed);
        }
      }
    }

    // ── Routes ────────────────────────────────────────────────────
    try {
      if (url.pathname.startsWith('/gemini/')) {
        return await handleGemini(request, url, env, origin, allowed);
      }
      if (url.pathname === '/tavily') {
        return await handleTavily(request, env, origin, allowed);
      }
      if (url.pathname === '/wikitree') {
        return await handleWikiTree(request, origin, allowed);
      }
      if (url.pathname === '/overpass') {
        return await handleOverpass(request, origin, allowed);
      }
      if (url.pathname === '/upload-image') {
        return await handleUpload(request, env, origin, allowed);
      }
      return json({ error: 'Not found', path: url.pathname }, 404, origin, allowed);
    } catch (err) {
      return json({ error: 'Worker error', detail: String(err && err.message || err) }, 500, origin, allowed);
    }
  },
};

// ── Gemini: POST /gemini/{model-id} ──────────────────────────────
async function handleGemini(request, url, env, origin, allowed) {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405, origin, allowed);
  }
  if (!env.GEMINI_KEY) {
    return json({ error: 'GEMINI_KEY not configured' }, 500, origin, allowed);
  }

  const modelId = url.pathname.slice('/gemini/'.length);
  if (!modelId || modelId.includes('/')) {
    return json({ error: 'Invalid model id' }, 400, origin, allowed);
  }
  // Only allow explicitly approved models — prevents callers from requesting
  // expensive or experimental models not in the intended call path.
  if (!ALLOWED_MODELS.has(modelId)) {
    return json({ error: 'Model not allowed', model: modelId }, 400, origin, allowed);
  }

  const body = await request.text();
  const upstream = `${GEMINI_BASE}/${encodeURIComponent(modelId)}:generateContent?key=${env.GEMINI_KEY}`;

  const res = await fetch(upstream, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  });

  const text = await res.text();
  return new Response(text, {
    status: res.status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders(origin, allowed),
    },
  });
}

// ── Tavily: POST /tavily ──────────────────────────────────────────
async function handleTavily(request, env, origin, allowed) {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405, origin, allowed);
  }
  if (!env.TAVILY_KEY) {
    return json({ error: 'TAVILY_KEY not configured' }, 500, origin, allowed);
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400, origin, allowed);
  }
  payload.api_key = env.TAVILY_KEY;

  const res = await fetch(TAVILY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  return new Response(text, {
    status: res.status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders(origin, allowed),
    },
  });
}

// ── WikiTree: POST /wikitree ──────────────────────────────────────
async function handleWikiTree(request, origin, allowed) {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405, origin, allowed);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400, origin, allowed);
  }

  const params = new URLSearchParams();
  params.set('action', body.action || 'searchPerson');
  if (body.FirstName) params.set('FirstName', body.FirstName);
  if (body.LastName)  params.set('LastName',  body.LastName);
  if (body.BirthDate) params.set('BirthDate', body.BirthDate);
  if (body.DeathDate) params.set('DeathDate', body.DeathDate);
  if (body.fields)    params.set('fields',    body.fields);
  params.set('format', 'json');

  const res = await fetch('https://api.wikitree.com/api.php', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'application/json, text/plain, */*',
      'Accept-Language': 'en-US,en;q=0.9',
      'Referer': 'https://www.wikitree.com/',
      'Origin': 'https://www.wikitree.com',
    },
    body: params.toString(),
  });

  const text = await res.text();
  return new Response(text, {
    status: res.status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders(origin, allowed),
    },
  });
}

// ── Overpass API proxy: POST /overpass ────────────────────────────
const OVERPASS_ENDPOINTS = [
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass-api.de/api/interpreter',
];

async function handleOverpass(request, origin, allowed) {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405, origin, allowed);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400, origin, allowed);
  }

  if (!body?.query) {
    return json({ error: 'Missing query field' }, 400, origin, allowed);
  }
  if (body.query.length > MAX_OVERPASS_QUERY_BYTES) {
    return json({ error: 'Query too large' }, 400, origin, allowed);
  }

  const payload = 'data=' + encodeURIComponent(body.query);
  let lastStatus = 502, lastText = '';

  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'Mozilla/5.0 (compatible; GraveStory/1.0)',
          'Accept': 'application/json',
        },
        body: payload,
      });
      if (res.ok) {
        return new Response(res.body, {
          status: 200,
          headers: { 'Content-Type': 'application/json', ...corsHeaders(origin, allowed) },
        });
      }
      const text = await res.text();
      lastStatus = res.status;
      lastText = text.slice(0, 300);
    } catch (e) {
      lastStatus = 502;
      lastText = String(e && e.message || e);
    }
  }

  return json({ error: 'All Overpass mirrors failed', lastStatus, detail: lastText }, 502, origin, allowed);
}

// ── R2 image upload: POST /upload-image ──────────────────────────
async function handleUpload(request, env, origin, allowed) {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405, origin, allowed);
  }
  if (!env.IMAGES) {
    return json({ error: 'R2 binding IMAGES not configured' }, 500, origin, allowed);
  }
  if (!env.R2_PUBLIC_URL) {
    return json({ error: 'R2_PUBLIC_URL not configured' }, 500, origin, allowed);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400, origin, allowed);
  }

  if (!body || !body.data) {
    return json({ error: 'Missing data field' }, 400, origin, allowed);
  }

  // Validate base64 size before decoding — 1 base64 char ≈ 0.75 bytes
  if (body.data.length > MAX_UPLOAD_BYTES * 1.4) {
    return json({ error: 'Image too large' }, 413, origin, allowed);
  }

  const contentType = body.contentType || 'image/jpeg';
  // Only allow image types — prevents using the upload endpoint as a file host
  if (!contentType.startsWith('image/')) {
    return json({ error: 'Only image uploads are allowed' }, 400, origin, allowed);
  }
  const ext = contentType.includes('png') ? 'png' : 'jpg';

  let bytes;
  try {
    const binaryString = atob(body.data);
    // Double-check decoded size
    if (binaryString.length > MAX_UPLOAD_BYTES) {
      return json({ error: 'Image too large' }, 413, origin, allowed);
    }
    bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
  } catch (err) {
    return json({ error: 'Invalid base64 data' }, 400, origin, allowed);
  }

  // Random unguessable filename prevents enumeration of others' images
  const key = `${Date.now()}-${crypto.randomUUID()}.${ext}`;

  try {
    await env.IMAGES.put(key, bytes, {
      httpMetadata: { contentType },
    });
  } catch (err) {
    return json({ error: 'R2 put failed', detail: String(err && err.message || err) }, 500, origin, allowed);
  }

  const publicUrl = `${env.R2_PUBLIC_URL}/${key}`;
  return json({ url: publicUrl }, 200, origin, allowed);
}

// ── helpers ───────────────────────────────────────────────────────
function corsHeaders(origin, allowed) {
  let acao;
  if (allowed === '*') {
    acao = '*';
  } else if (origin && allowed.includes(origin)) {
    acao = origin;
  } else {
    acao = allowed[0] || '';
  }
  return {
    'Access-Control-Allow-Origin': acao,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Client-Key',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

function json(obj, status, origin, allowed) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders(origin, allowed),
    },
  });
}
