// GraveStory proxy — Cloudflare Worker
//
// Front-end calls:
//   POST /begin-scan              header: Authorization: Bearer <user JWT>  → { token } (one per scan)
//   POST /gemini/{model-id}       header: X-Scan-Token   body: Gemini generateContent payload
//   POST /tavily                  header: X-Scan-Token   body: { query, search_depth, max_results, include_answer }
//   POST /tavily-extract          header: X-Scan-Token   body: { urls: <string|string[]> }
//   POST /wikitree                body: WikiTree searchPerson params as JSON
//   POST /overpass                body: { query: <QL string> }
//   POST /upload-image            body: { data: <base64>, contentType: <mime> }
//   POST /delete-account          header: Authorization: Bearer <user JWT>  (irreversible)
//   POST /revenuecat-webhook      body: RevenueCat event payload (server-to-server)
//
// Secrets (set via `wrangler secret put`):
//   GEMINI_KEY
//   TAVILY_KEY
//   CLIENT_KEY              — shared secret for web + mobile (X-Client-Key header).
//                             Blocks direct API calls (curl, scrapers) that have no Origin header.
//                             Not a true secret (it's in client source) but forces meaningful work
//                             to abuse the endpoint and can be rotated independently.
//   SCAN_TOKEN_SECRET       — HMAC key for the per-scan tokens minted by /begin-scan and required
//                             by the paid /gemini and /tavily routes. The REAL server-side cost
//                             control: a token is issued only after consume_scan() records the scan
//                             against the user's allowance, so the paid pipeline can no longer be
//                             driven by anyone holding the (public) CLIENT_KEY or spoofing Origin.
//   REVENUECAT_WEBHOOK_SECRET — must match the Authorization Bearer value in RevenueCat dashboard
//   SUPABASE_SERVICE_KEY    — Supabase service-role key (bypasses RLS; never expose to clients)
//
// Vars (set in wrangler.toml [vars]):
//   ALLOWED_ORIGIN   comma-separated origins, e.g. "https://j3k420.github.io,http://localhost:5500"
//                    Use "*" only for local testing — never in production.
//   SCAN_TOKEN_ENFORCE  "true" → paid routes REQUIRE a valid X-Scan-Token (403 otherwise).
//                       Anything else (unset/"false") → transition mode: a token is verified when
//                       present, but a request WITHOUT one is still served (and logged). This lets
//                       the Worker deploy + migration land BEFORE every client has the token-sending
//                       OTA, so a tester mid-rollout is not locked out. Flip to "true" once
//                       logs show tokens flowing from all clients.
//   R2_PUBLIC_URL    public base URL for R2 bucket (no trailing slash)
//   SUPABASE_URL     Supabase project URL (not sensitive)
//
// R2 binding: IMAGES

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const TAVILY_URL  = 'https://api.tavily.com/search';
const TAVILY_EXTRACT_URL = 'https://api.tavily.com/extract';

// Per-scan token lifetime. One scan fires many proxy calls (OCR + symbol-resolution
// + biography Gemini, plus up to 6 Tavily slots + 2 extracts), so the token must
// outlive a whole scan but not be reusable indefinitely.
//
// ⚠️ KNOWN RESIDUAL RISK (audit 2026-06-26): this stateless HMAC token gates ENTRY
// but NOT VOLUME — while valid, it authorizes an UNBOUNDED number of paid calls. A
// leaked/extracted token is therefore an all-you-can-drain pass on the prepaid
// Tavily pool for its remaining lifetime, off a SINGLE recorded scan. A stateless
// token cannot bound call volume; the real fix is a per-token call budget in
// KV/Durable Objects (consume_scan returns a scan_id; each paid call atomically
// decrements a remaining-calls budget) — deferred to backlog #11 (Worker budget
// guard). To cap the residual until then we keep the TTL SHORT: a real scan
// completes well under 3 min even on flaky cellular, so a leaked token buys an
// attacker only minutes, not a quarter-hour. Do NOT lengthen this without the
// KV budget guard in place.
const SCAN_TOKEN_TTL_SECONDS = 3 * 60;

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

    // ── RevenueCat webhook: bypass Origin/CLIENT_KEY auth — has its own auth ──
    if (url.pathname === '/revenuecat-webhook') {
      return await handleRevenueCatWebhook(request, env, origin, allowed);
    }

    // ── Auth: shared CLIENT_KEY + (for browsers) Origin allowlist ──
    //
    // SECURITY (audit 2026-06-26): the Origin header is NOT authentication — any
    // non-browser client can set it to an arbitrary value. The old code treated a
    // present-and-allowlisted Origin as sufficient and only required X-Client-Key
    // when Origin was ABSENT, so a one-line curl carrying "Origin: <allowed>"
    // skipped the key entirely. We now ALWAYS require X-Client-Key, and use the
    // Origin allowlist ONLY as an additional gate for real browser requests (and
    // to decide the CORS response header). The key is public (in client source),
    // so it is only a speed-bump — the REAL cost control is the per-scan token
    // gate on the paid routes below.
    //
    // Priority:
    //   1. If allowed === "*" → skip all checks (local dev only)
    //   2. X-Client-Key must always match CLIENT_KEY
    //   3. If an Origin header is present, it must also be in the allowlist
    if (allowed !== '*') {
      const clientKey = request.headers.get('X-Client-Key') || '';
      if (!env.CLIENT_KEY || !timingSafeEqualStr(clientKey, env.CLIENT_KEY)) {
        return json({ error: 'Forbidden' }, 403, origin, allowed);
      }
      if (origin && !allowed.includes(origin)) {
        return json({ error: 'Forbidden origin' }, 403, origin, allowed);
      }
    }

    // ── Routes ────────────────────────────────────────────────────
    try {
      if (url.pathname === '/begin-scan') {
        return await handleBeginScan(request, env, origin, allowed);
      }
      // JWT-gated Gemini (NO scan token, does NOT consume a scan). For the paid
      // Gemini calls that legitimately happen BEFORE the scan is counted or at
      // publish-time — where no scan token exists:
      //   • verifyIsGravestone + readGravestone (OCR) — run BEFORE begin-scan (the
      //     scan is counted AFTER OCR so a non-gravestone photo doesn't burn a scan),
      //     yet must still be authenticated.
      //   • publish-time redactLivingNamesForPublic — fires at Save/Share/make-public,
      //     where there is no scan token (an already-saved story toggled public has no
      //     scan at all). Without this route it would 403 under enforcement; the client
      //     redactor fails CLOSED on an auth failure so a living relative's name can't
      //     leak to the public map (the S62 guard). [audit 2026-06-26]
      // Bounded by requiring a valid Supabase JWT (a real account, ban-able) — not
      // the public CLIENT_KEY — so it is not the open faucet the bare /gemini route was.
      if (url.pathname.startsWith('/gemini-jwt/')) {
        const gate = await requireUserJwt(request, env, origin, allowed);
        if (gate) return gate;
        return await handleGemini(request, url, env, origin, allowed, '/gemini-jwt/');
      }
      // Paid routes — require a valid per-scan token (see verifyScanToken).
      if (url.pathname.startsWith('/gemini/')) {
        const gate = await requireScanToken(request, env, origin, allowed);
        if (gate) return gate;
        return await handleGemini(request, url, env, origin, allowed);
      }
      if (url.pathname === '/tavily') {
        const gate = await requireScanToken(request, env, origin, allowed);
        if (gate) return gate;
        return await handleTavily(request, env, origin, allowed);
      }
      if (url.pathname === '/tavily-extract') {
        const gate = await requireScanToken(request, env, origin, allowed);
        if (gate) return gate;
        return await handleTavilyExtract(request, env, origin, allowed);
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
      if (url.pathname === '/delete-account') {
        return await handleDeleteAccount(request, env, origin, allowed);
      }
      return json({ error: 'Not found', path: url.pathname }, 404, origin, allowed);
    } catch (err) {
      return json({ error: 'Worker error', detail: String(err && err.message || err) }, 500, origin, allowed);
    }
  },
};

// ── Per-scan token: /begin-scan + verification ────────────────────
//
// THE server-side cost control. One scan = many paid proxy calls, so we cannot
// meter per call. Instead the client calls /begin-scan ONCE per scan with the
// user's Supabase JWT; we verify it, resolve the authoritative user_id +
// is_unlimited from app_metadata, atomically record the scan against the user's
// allowance via consume_scan() (returns allowed/denied), and — only when allowed —
// mint a short-lived HMAC token bound to that user. The paid routes require that
// token. A client holding only the public CLIENT_KEY (or spoofing Origin) cannot
// mint a token, so cannot drive the paid pipeline.
async function handleBeginScan(request, env, origin, allowed) {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405, origin, allowed);
  }
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
    return json({ error: 'Supabase not configured' }, 500, origin, allowed);
  }
  if (!env.SCAN_TOKEN_SECRET) {
    return json({ error: 'SCAN_TOKEN_SECRET not configured' }, 500, origin, allowed);
  }

  // 1. Verify the caller's JWT → authoritative user_id + app_metadata.
  const auth = await resolveUser(request, env);
  if (!auth.userId) {
    return json({ error: auth.error || 'Sign in to scan', code: auth.code || 'NO_AUTH' }, auth.status || 401, origin, allowed);
  }
  const { userId, isUnlimited } = auth;

  // 2. Atomically check allowance + record the scan (service-role RPC).
  const rpcRes = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/consume_scan`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': env.SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    },
    body: JSON.stringify({ p_user_id: userId, p_is_unlimited: isUnlimited }),
  });
  if (!rpcRes.ok) {
    // Supabase failure — fail CLOSED (never hand out a token we can't account for).
    const detail = await rpcRes.text().catch(() => '');
    console.warn('begin-scan consume_scan failed', JSON.stringify({ userId, status: rpcRes.status, detail: detail.slice(0, 200) }));
    return json({ error: 'Could not verify scan allowance', code: 'CHECK_FAILED' }, 503, origin, allowed);
  }
  const result = await rpcRes.json().catch(() => null);
  if (!result || result.allowed !== true) {
    return json({
      error: 'Scan limit reached',
      code: 'AT_LIMIT',
      used: result?.used, allowance: result?.allowance,
    }, 402, origin, allowed);
  }

  // 3. Mint the scan token bound to this user.
  const scanToken = await mintScanToken(userId, env.SCAN_TOKEN_SECRET);
  return json({ token: scanToken, used: result.used, allowance: result.allowance }, 200, origin, allowed);
}

// Verify the caller's Supabase JWT (Authorization: Bearer) against /auth/v1/user
// and return the authoritative { userId, isUnlimited }. On any failure returns
// { userId: null, status, code, error } so the caller can shape its own response.
// Shared by /begin-scan and the /gemini-jwt gate (DRY — the same auth check).
async function resolveUser(request, env) {
  const authHeader = request.headers.get('Authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!token) {
    return { userId: null, status: 401, code: 'NO_AUTH', error: 'Sign in to continue' };
  }
  let userRes;
  try {
    userRes = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
      headers: { 'Authorization': `Bearer ${token}`, 'apikey': env.SUPABASE_SERVICE_KEY },
    });
  } catch {
    // Supabase unreachable — fail closed (caller must not proceed without a verified user).
    return { userId: null, status: 503, code: 'CHECK_FAILED', error: 'Could not verify session' };
  }
  if (!userRes.ok) {
    return { userId: null, status: 401, code: 'BAD_AUTH', error: 'Invalid or expired session' };
  }
  try {
    const u = await userRes.json();
    if (!u?.id) return { userId: null, status: 401, code: 'BAD_AUTH', error: 'Could not resolve user' };
    // app_metadata is server-controlled (NOT user_metadata) — a client cannot forge it.
    return { userId: u.id, isUnlimited: u?.app_metadata?.is_unlimited === true };
  } catch {
    return { userId: null, status: 401, code: 'BAD_AUTH', error: 'Could not resolve user' };
  }
}

// Gate for /gemini-jwt: require a valid Supabase JWT (not a scan token). Returns a
// Response (4xx/5xx) to BLOCK, or null to proceed. Unlike requireScanToken there is
// NO transition mode — this route is brand new, so every client that calls it always
// sends the JWT; there is no legacy un-authed caller to grandfather in.
async function requireUserJwt(request, env, origin, allowed) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
    return json({ error: 'Supabase not configured' }, 500, origin, allowed);
  }
  const auth = await resolveUser(request, env);
  if (!auth.userId) {
    return json({ error: auth.error || 'Unauthorized', code: auth.code || 'NO_AUTH' }, auth.status || 401, origin, allowed);
  }
  return null;
}

// Returns a Response (the 403) when the gate should BLOCK, or null when the
// request may proceed. In transition mode (SCAN_TOKEN_ENFORCE !== "true") a
// missing/invalid token is logged but allowed through, so clients without the
// token-sending OTA keep working during rollout.
async function requireScanToken(request, env, origin, allowed) {
  const enforce = String(env.SCAN_TOKEN_ENFORCE || '').toLowerCase() === 'true';
  const tok = request.headers.get('X-Scan-Token') || '';

  // Misconfiguration trap (audit 2026-06-26): with SCAN_TOKEN_SECRET unset, no
  // token can ever verify, so in transition mode EVERY paid call silently passes
  // unmetered and the operator believes the fix is live when it is completely
  // inert. /begin-scan 500s on the unset secret, but nothing surfaces on the paid
  // routes. Log loudly on every paid request so it is caught in `wrangler tail`.
  if (!env.SCAN_TOKEN_SECRET) {
    console.error('SCAN metering INERT: SCAN_TOKEN_SECRET unset — paid routes are unmetered',
      JSON.stringify({ path: new URL(request.url).pathname, enforce }));
    // With no secret we cannot verify; under enforcement that means a hard 503
    // (fail closed — better an outage than a silent open door), and in transition
    // mode fall through to the un-tokened-allow path below (with the error logged).
    if (enforce) {
      return json({ error: 'Scan metering misconfigured', code: 'METERING_INERT' }, 503, origin, allowed);
    }
  }

  const ok = tok && env.SCAN_TOKEN_SECRET
    ? await verifyScanToken(tok, env.SCAN_TOKEN_SECRET)
    : false;

  if (ok) return null;  // valid token — proceed

  if (!enforce) {
    // Transition mode: observe but do not block. Distinguish "no token at all"
    // (old client) from "bad/expired token" (bug) so the logs are actionable.
    console.warn('scan-token transition', JSON.stringify({
      reason: tok ? 'invalid_or_expired' : 'missing',
      path: new URL(request.url).pathname,
    }));
    return null;
  }
  return json({ error: 'Scan token required', code: 'NO_SCAN_TOKEN' }, 403, origin, allowed);
}

// Token format: base64url(`${userId}.${expEpochSeconds}`) + "." + base64url(HMAC-SHA256).
// Stateless (no DB lookup on the hot path); the HMAC binds userId+exp so it can't
// be forged or extended. Bound to one recorded scan of allowance already consumed.
async function mintScanToken(userId, secret) {
  // exp uses request-time wall clock; Workers expose Date in the request scope.
  const exp = Math.floor(Date.now() / 1000) + SCAN_TOKEN_TTL_SECONDS;
  const payload = `${userId}.${exp}`;
  const sig = await hmacSha256(payload, secret);
  return `${b64urlEncode(payload)}.${b64urlEncode(sig)}`;
}

async function verifyScanToken(tok, secret) {
  try {
    const dot = tok.indexOf('.');
    if (dot < 0) return false;
    const payloadB64 = tok.slice(0, dot);
    const sigB64 = tok.slice(dot + 1);
    const payload = b64urlDecodeToString(payloadB64);
    const expectedSig = await hmacSha256(payload, secret);
    // Constant-time compare of the raw signature bytes.
    if (!timingSafeEqualStr(sigB64, b64urlEncode(expectedSig))) return false;
    const sep = payload.lastIndexOf('.');
    if (sep < 0) return false;
    const exp = parseInt(payload.slice(sep + 1), 10);
    if (!Number.isFinite(exp)) return false;
    if (Math.floor(Date.now() / 1000) > exp) return false;  // expired
    return true;
  } catch {
    return false;
  }
}

async function hmacSha256(message, secret) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(message));
  // Return a binary string so b64urlEncode can base64 it.
  return String.fromCharCode(...new Uint8Array(sig));
}

function b64urlEncode(str) {
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlDecodeToString(b64url) {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
  return atob(b64);
}

// Comparison that does not early-out on the first differing character (avoids the
// classic byte-by-byte timing oracle of `a === b` on a secret). It folds a length
// difference into the accumulator and scans to the longer length, so a wrong prefix
// is not distinguishable by a fast return. NOTE: it is NOT perfectly constant-time —
// the loop bound is max(len) so it can still leak the LONGER input's length via
// timing. That is acceptable here: the secrets it guards (scan-token signature,
// CLIENT_KEY, RevenueCat secret) are fixed-length and not length-secret, and the
// signature it most matters for is a fixed 256-bit HMAC. (Earlier comment claimed
// it hashed both inputs to SHA-256 first — it does not; corrected 2026-06-26.)
function timingSafeEqualStr(a, b) {
  // Fast structural rejects (do not leak content): both must be strings.
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  let diff = a.length ^ b.length;
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

// ── Gemini: POST /gemini/{model-id} (scan-token gated) ───────────
//                POST /gemini-jwt/{model-id} (JWT gated, no scan) ──
// prefix is the route base ('/gemini/' or '/gemini-jwt/') so the same upstream
// proxy serves both gates; only the auth in the route table differs. Both paths
// stay constrained to ALLOWED_MODELS — /gemini-jwt does not widen the model set.
async function handleGemini(request, url, env, origin, allowed, prefix = '/gemini/') {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405, origin, allowed);
  }
  if (!env.GEMINI_KEY) {
    return json({ error: 'GEMINI_KEY not configured' }, 500, origin, allowed);
  }

  const modelId = url.pathname.slice(prefix.length);
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

// ── Tavily Extract: POST /tavily-extract ──────────────────────────
// Returns the full page text for a known URL (e.g. a FindAGrave memorial that
// slot 1 already matched). The Tavily search snippet misses the family links,
// plot info, and contributor bio further down the page; /extract returns the
// whole thing. Fired conditionally by the client, so this is just a thin proxy.
async function handleTavilyExtract(request, env, origin, allowed) {
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

  const res = await fetch(TAVILY_EXTRACT_URL, {
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

  // body is attacker-controlled JSON: data must be a STRING (a non-string .length
  // would skip the size guard below, and atob would throw an opaque 500). [audit]
  if (!body || typeof body.data !== 'string' || !body.data) {
    return json({ error: 'Missing or invalid data field' }, 400, origin, allowed);
  }

  // Validate base64 size before decoding — 1 base64 char ≈ 0.75 bytes
  if (body.data.length > MAX_UPLOAD_BYTES * 1.4) {
    return json({ error: 'Image too large' }, 413, origin, allowed);
  }

  // Allowlist RASTER image types only. The old startsWith('image/') admitted
  // image/svg+xml — and SVG can embed <script>, so an SVG served inline from the
  // public R2 domain is stored XSS / arbitrary-content hosting (audit 2026-06-26).
  // Normalize to the validated type and never echo a caller-chosen Content-Type.
  const RASTER = { 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
  // Coerce a non-string contentType (number/object) to a clean 415 rather than a
  // TypeError → opaque 500 on .toLowerCase(). [audit 2026-06-26]
  const ctRaw = typeof body.contentType === 'string' ? body.contentType : '';
  const requested = (ctRaw || 'image/jpeg').toLowerCase().split(';')[0].trim();
  const ext = RASTER[requested];
  if (!ext) {
    return json({ error: 'Only JPEG, PNG, or WebP images are allowed' }, 415, origin, allowed);
  }
  // Store the canonical type, not the raw request value.
  const contentType = requested === 'image/jpg' ? 'image/jpeg' : requested;

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

// ── RevenueCat webhook: POST /revenuecat-webhook ──────────────────
// Server-to-server — no Origin or CLIENT_KEY. Auth is REVENUECAT_WEBHOOK_SECRET.
// RevenueCat sets this value in the Authorization header of every webhook request.
async function handleRevenueCatWebhook(request, env, origin, allowed) {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405, origin, allowed);
  }

  // Validate RevenueCat webhook secret (constant-time — audit 2026-06-26).
  const authHeader = request.headers.get('Authorization') || '';
  if (!env.REVENUECAT_WEBHOOK_SECRET ||
      !timingSafeEqualStr(authHeader, `Bearer ${env.REVENUECAT_WEBHOOK_SECRET}`)) {
    return json({ error: 'Unauthorized' }, 401, origin, allowed);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400, origin, allowed);
  }

  const event = body?.event;
  if (!event) {
    return json({ error: 'Missing event field' }, 400, origin, allowed);
  }

  const userId    = event.app_user_id;
  const productId = event.product_id;
  // event.id is RevenueCat's idempotency key: unique per event and STABLE across
  // retries/redeliveries, so we use it to grant/clawback each event at most once.
  const eventId   = event.id;

  // CREDIT_MAP must stay in sync with Play Console + PaywallScreen PRODUCT_IDS.
  const CREDIT_MAP = {
    gravestory_5_scans:   5,
    gravestory_20_scans:  20,
    gravestory_60_scans:  60,
    gravestory_150_scans: 150,
  };

  // Event taxonomy:
  //  * GRANT — a purchase: add credits.
  //  * CLAWBACK — a refund/cancellation/expiration of a consumable: remove credits.
  //  * everything else — acknowledge with 200 and do nothing (RC retries on non-2xx).
  const GRANT_TYPES    = new Set(['NON_SUBSCRIPTION_PURCHASE', 'NON_RENEWING_PURCHASE', 'INITIAL_PURCHASE']);
  const CLAWBACK_TYPES = new Set(['CANCELLATION', 'REFUND', 'EXPIRATION']);
  const isGrant    = GRANT_TYPES.has(event.type);
  const isClawback = CLAWBACK_TYPES.has(event.type);

  if (!isGrant && !isClawback) {
    return json({ ok: true, action: 'ignored', type: event.type }, 200, origin, allowed);
  }

  if (!userId || !productId) {
    console.warn('webhook missing ids', JSON.stringify({ type: event.type, eventId, userId, productId }));
    return json({ error: 'Missing app_user_id or product_id' }, 400, origin, allowed);
  }

  // No event id means we cannot dedupe safely. Acknowledge (2xx) so RC does not
  // retry a request we would only re-process unsafely; not expected in practice.
  if (!eventId) {
    console.warn('webhook missing event id', JSON.stringify({ type: event.type, userId, productId }));
    return json({ ok: true, action: 'ignored', reason: 'missing event id' }, 200, origin, allowed);
  }

  const credits = CREDIT_MAP[productId];
  if (credits == null) {
    // Unknown product — may be a test SKU or from another app in the same RC
    // project. For a GRANT this is also the "real SKU not yet in CREDIT_MAP"
    // footgun (user paid, would get 0). We still 200 (a 5xx would make RC hammer
    // test/foreign SKUs forever), but for a GRANT we DURABLY record the event so a
    // paid-but-ungranted purchase is reconcilable from the DB, not just ephemeral
    // `wrangler tail` logs. [audit 2026-06-26]
    if (isGrant) {
      console.warn('webhook GRANT for unmapped product — user may have paid for 0 credits', JSON.stringify({ eventId, userId, productId }));
      if (eventId && userId && env.SUPABASE_URL && env.SUPABASE_SERVICE_KEY) {
        // amount NULL = a flagged-for-review row (no credits granted); dedupe on
        // event_id like every other ledger write so a retry doesn't duplicate it.
        // Best-effort: a failure here must not change the 200 (we already chose to
        // ack). Reuse the revenuecat_events ledger (migration 017).
        try {
          await fetch(`${env.SUPABASE_URL}/rest/v1/revenuecat_events`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'apikey': env.SUPABASE_SERVICE_KEY,
              'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
              'Prefer': 'resolution=ignore-duplicates,return=minimal',
            },
            body: JSON.stringify({ event_id: eventId, user_id: userId, product_id: productId, amount: null }),
          });
        } catch (e) {
          console.warn('webhook unmapped-GRANT durable record failed (still acking)', JSON.stringify({ eventId, err: String(e && e.message || e) }));
        }
      }
    }
    return json({ ok: true, action: 'ignored', reason: 'unknown product', product_id: productId }, 200, origin, allowed);
  }

  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
    return json({ error: 'Supabase not configured' }, 500, origin, allowed);
  }

  const rpcName = isClawback ? 'clawback_scan_credits' : 'add_scan_credits';
  const rpcRes = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/${rpcName}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': env.SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    },
    body: JSON.stringify({ p_user_id: userId, p_amount: credits, p_event_id: eventId }),
  });

  if (!rpcRes.ok) {
    const detail = await rpcRes.text().catch(() => '');
    // A non-Supabase-user app_user_id (e.g. an anonymous RC id from a purchase
    // before Purchases.logIn, or a user who deleted their account) violates the
    // revenuecat_events.user_id FK (SQLSTATE 23503). That is a PERMANENT error —
    // retrying re-runs the same failing INSERT forever. Detect it and return 200
    // (give up) + log for manual reconciliation, instead of 500 (infinite retry).
    const isFkViolation = rpcRes.status === 409 || /23503|foreign key|violates foreign key/i.test(detail);
    if (isFkViolation) {
      console.warn('webhook permanent FK failure — purchase dropped, needs manual grant', JSON.stringify({ eventId, userId, productId, credits, detail: detail.slice(0, 200) }));
      return json({ ok: true, action: 'dropped', reason: 'unresolvable user', event_id: eventId }, 200, origin, allowed);
    }
    // Genuine transient Supabase failure: 5xx so RevenueCat RETRIES. The retry
    // carries the same event.id, so dedupe still prevents a double-grant.
    console.warn('webhook transient RPC failure — will retry', JSON.stringify({ rpc: rpcName, eventId, userId, status: rpcRes.status, detail: detail.slice(0, 200) }));
    return json({ error: 'Supabase RPC failed', status: rpcRes.status, detail }, 500, origin, allowed);
  }

  // RPC body is the boolean return value: true = applied, false = duplicate.
  const applied = await rpcRes.json().catch(() => null);
  if (applied === false) {
    return json({ ok: true, action: 'duplicate', user_id: userId, event_id: eventId }, 200, origin, allowed);
  }

  if (isClawback) {
    return json({ ok: true, action: 'clawback', user_id: userId, credits_removed: credits, event_id: eventId }, 200, origin, allowed);
  }
  return json({ ok: true, user_id: userId, credits_added: credits, event_id: eventId }, 200, origin, allowed);
}

// ── Account deletion: POST /delete-account ────────────────────────
// IRREVERSIBLE. Deletes the caller's auth user + ALL their data + their R2
// images. Required by Google Play's account-deletion policy (in-app path).
//
// AUTH MODEL: the caller proves identity with their OWN Supabase JWT
// (Authorization: Bearer <access_token>). We verify it against Supabase's
// /auth/v1/user endpoint to resolve the real user_id — we NEVER trust a
// user_id sent in the body. Only AFTER verification do we use the service-role
// key (which bypasses RLS) to delete, and every delete is scoped to that
// verified user_id, so a valid token can only ever delete its own account.
//
// ORDER: R2 images first (need the URLs, which live in rows we're about to
// delete) → child/data rows → finally the auth user. We delete data rows
// explicitly rather than relying on FK cascade so this is correct regardless
// of each table's ON DELETE rule, and so it also works for tables keyed on
// reporter_id (content_reports) which has ON DELETE SET NULL, not cascade.
async function handleDeleteAccount(request, env, origin, allowed) {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405, origin, allowed);
  }
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
    return json({ error: 'Supabase not configured' }, 500, origin, allowed);
  }

  // 1. Verify the caller's JWT → resolve the authoritative user_id.
  const authHeader = request.headers.get('Authorization') || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!token) {
    return json({ error: 'Missing bearer token' }, 401, origin, allowed);
  }

  const userRes = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'apikey': env.SUPABASE_SERVICE_KEY,
    },
  });
  if (!userRes.ok) {
    return json({ error: 'Invalid or expired session' }, 401, origin, allowed);
  }
  let userId;
  try {
    const u = await userRes.json();
    userId = u?.id;
  } catch {
    userId = null;
  }
  if (!userId) {
    return json({ error: 'Could not resolve user' }, 401, origin, allowed);
  }

  const sb = (path, init) => fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      'apikey': env.SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...(init && init.headers),
    },
  });

  // 2. Collect this user's R2 image keys from stories + grave_photos, then
  //    delete those objects from R2. Keys are random UUIDs with no user prefix
  //    (handleUpload), so we can only find them via the stored URLs. Best-effort:
  //    a failed R2 delete must NOT block account deletion (orphan blob at worst).
  if (env.IMAGES && env.R2_PUBLIC_URL) {
    const urls = new Set();
    try {
      // Pull image_url + portrait URLs. Portraits are Wikimedia/file:// URLs
      // today (not in R2), but the prefix guard below skips any non-bucket URL,
      // so including the portrait columns future-proofs this against a later
      // change that uploads portraits to R2 without orphaning blobs.
      const sRes = await sb(`stories?user_id=eq.${userId}&select=image_url,portrait_left_url,portrait_right_url`, { method: 'GET' });
      if (sRes.ok) for (const r of await sRes.json()) {
        if (r.image_url) urls.add(r.image_url);
        if (r.portrait_left_url) urls.add(r.portrait_left_url);
        if (r.portrait_right_url) urls.add(r.portrait_right_url);
      }
      const pRes = await sb(`grave_photos?user_id=eq.${userId}&select=image_url`, { method: 'GET' });
      if (pRes.ok) for (const r of await pRes.json()) { if (r.image_url) urls.add(r.image_url); }
    } catch { /* non-fatal — proceed to row deletion regardless */ }

    const base = env.R2_PUBLIC_URL.replace(/\/$/, '');
    for (const url of urls) {
      // Only delete objects that live in OUR bucket (prefix match), and derive
      // the key as everything after the public base URL. Strip any query suffix
      // (cache-busting / CDN rewrite) before deriving the key.
      if (typeof url === 'string' && url.startsWith(base + '/')) {
        const key = url.slice(base.length + 1).split('?')[0].split('#')[0];
        if (key && !key.includes('..')) {
          try { await env.IMAGES.delete(key); } catch { /* orphan at worst */ }
        }
      }
    }
  }

  // 3. Delete all of this user's data rows (service-role bypasses RLS). Order
  //    children → parents where it matters; each scoped to the verified userId.
  //    A 'missing table' is tolerated by BODY match; any other failure aborts so
  //    we never delete the auth user while data rows survive.
  const failures = [];
  // A genuinely-missing table/column is identified by the response BODY (not the
  // status code — an infra 404/406 must still abort so we never delete the auth
  // user while data rows survive). PGRST205 = table not in schema cache; PGRST200 =
  // FK relationship; PGRST204 = column not found (a stale schema cache or unrun
  // 024/025 migration) — added 2026-06-26 so a missing graves column can't 500 the
  // whole deletion (a Play account-deletion-policy failure).
  const tolerate = (detail) =>
    /relation .* does not exist|undefined_table|could not find the .* column|PGRST20[045]/i.test(detail);
  // STRICT: a failure (other than a tolerated missing table/column) ABORTS the whole
  // deletion — used for the hard-deletes of the user's own rows, where a survivor is
  // an orphaned auth-less data row.
  const runStrict = async (label, init, path) => {
    try {
      const res = await sb(path, init);
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        if (!tolerate(detail)) failures.push({ path: label, status: res.status, detail: detail.slice(0, 200) });
      }
    } catch (e) {
      failures.push({ path: label, error: String(e && e.message || e) });
    }
  };
  // BEST-EFFORT: never blocks the irreversible auth-user delete. Used ONLY for the
  // de-identification (anonymize/null) steps — on a missing column there is BY
  // DEFINITION no residual UUID to leak, so a cosmetic column/cache issue must not
  // strand a user unable to delete their account. Logged, not failed. [audit 2026-06-26]
  const runBestEffort = async (label, init, path) => {
    try {
      const res = await sb(path, init);
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        console.warn('delete-account best-effort step failed (non-blocking)', JSON.stringify({ step: label, status: res.status, detail: detail.slice(0, 200) }));
      }
    } catch (e) {
      console.warn('delete-account best-effort step threw (non-blocking)', JSON.stringify({ step: label, error: String(e && e.message || e) }));
    }
  };
  const minimal = { method: 'DELETE', headers: { 'Prefer': 'return=minimal' } };
  const patchNull = (col) => ({ method: 'PATCH', headers: { 'Prefer': 'return=minimal' }, body: JSON.stringify({ [col]: null }) });

  // 3a. Hard-delete the user's own rows (STRICT — must succeed or abort).
  const deletes = [
    `grave_photos?user_id=eq.${userId}`,
    `tributes?user_id=eq.${userId}`,
    `scan_events?user_id=eq.${userId}`,
    `scan_credits?user_id=eq.${userId}`,
    `analytics_events?user_id=eq.${userId}`,
    `stories?user_id=eq.${userId}`,
    `user_prefs?user_id=eq.${userId}`,
  ];
  for (const path of deletes) await runStrict(path, minimal, path);

  // 3b. ANONYMIZE rather than delete: the user's filed content_reports are a
  //     Play-required, intended-tamper-proof moderation/takedown queue (migration
  //     013 designed the FK as ON DELETE SET NULL precisely so reports OUTLIVE the
  //     reporter). Hard-deleting them would let a user erase the moderation
  //     evidence they generated. Null the reporter linkage; keep the report.
  //     Best-effort: a missing reporter_id column has no UUID left to leak anyway.
  await runBestEffort('content_reports(anonymize)', patchNull('reporter_id'), `content_reports?reporter_id=eq.${userId}`);

  // 3c. The shared `graves` table is NOT deleted (it is canonical, referenced by
  //     other users' stories), but it stores the user's UUID in corrected_by /
  //     marker_set_by (migrations 024/025 — plain uuid columns, NO FK, so the
  //     auth-user delete does not clean them). Null them so the deletion is
  //     complete (no residual personal identifier survives — Play data-deletion).
  //     Best-effort: if 024/025 haven't run in this env, the column simply isn't
  //     there to hold a UUID — must not block the delete.
  await runBestEffort('graves(corrected_by)', patchNull('corrected_by'), `graves?corrected_by=eq.${userId}`);
  await runBestEffort('graves(marker_set_by)', patchNull('marker_set_by'), `graves?marker_set_by=eq.${userId}`);

  // If any DATA delete genuinely failed, do NOT delete the auth user — we don't
  // want an orphaned auth-less data row set. Surface it so the client can retry.
  if (failures.length) {
    return json({ error: 'Data deletion incomplete', failures }, 500, origin, allowed);
  }

  // 4. Finally, delete the auth user itself (admin API, service-role).
  const authDel = await fetch(`${env.SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
    method: 'DELETE',
    headers: {
      'apikey': env.SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    },
  });
  if (!authDel.ok) {
    const detail = await authDel.text().catch(() => '');
    return json({ error: 'Auth user deletion failed', status: authDel.status, detail: detail.slice(0, 200) }, 500, origin, allowed);
  }

  return json({ ok: true, deleted: true, user_id: userId }, 200, origin, allowed);
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
    'Access-Control-Allow-Headers': 'Content-Type, X-Client-Key, Authorization',
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
