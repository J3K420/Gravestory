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
//                             control: /begin-scan reserves an allowance slot (reserve_scan) and
//                             issues a token naming that reservation; each paid call then spends one
//                             unit of the reservation's finite per-route call budget (consume_budget),
//                             and the scan is RECORDED (commit_reservation) once the bio succeeds. So
//                             the paid pipeline can no longer be driven by anyone holding the (public)
//                             CLIENT_KEY or spoofing Origin, and a leaked token is bounded to one
//                             scan's budget rather than unbounded calls.
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

// Per-scan token / reservation lifetime. The begin→commit window spans the ENTIRE
// research fan-out + biography, and a single Gemini call can take up to 30s
// (biography.js TIMEOUT_MS), with biography running serially AFTER the fan-out — so
// on flaky cellular a real foreground scan can run well over a minute, and a briefly
// backgrounded scan (the JS thread freezes — architectural, see the resuming-scan
// work) resumes later still. The TTL must comfortably exceed that or, under enforce,
// a slow/resumed scan's late paid calls hit consume_budget's `expires_at > now()`
// filter → 402 → the pipeline breaks mid-flight after real spend already landed.
//
// 10 min covers a slow + briefly-backgrounded scan with margin. IMPORTANT: the call
// VOLUME is bounded by the per-route reservation BUDGET (consume_budget), NOT by this
// TTL — so a longer TTL does NOT widen the leaked-token attack surface (a leaked token
// still drains at most one scan's 6 Gemini / 12 Tavily budget). The TTL only governs
// how long an abandoned reservation holds its allowance slot before aging out. So we
// can afford a generous TTL for pipeline resilience without weakening the cost control.
const SCAN_TOKEN_TTL_SECONDS = 10 * 60;

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
      // The admin dashboard is run as a local file (Origin: null) or from an
      // arbitrary host, so its preflight reflects the request origin rather than
      // the public allowlist. Safe because /admin/metrics is gated by the
      // ADMIN_KEY bearer token, NOT by CORS — a cross-origin page still cannot
      // read it without the secret. See adminCorsHeaders + handleAdminMetrics.
      if (url.pathname === '/admin/metrics') {
        return new Response(null, { status: 204, headers: adminCorsHeaders(origin) });
      }
      return new Response(null, {
        status: 204,
        headers: corsHeaders(origin, allowed),
      });
    }

    // ── RevenueCat webhook: bypass Origin/CLIENT_KEY auth — has its own auth ──
    if (url.pathname === '/revenuecat-webhook') {
      return await handleRevenueCatWebhook(request, env, origin, allowed);
    }

    // ── Admin metrics dashboard: bypass the public CLIENT_KEY gate — it has its
    // OWN secret (ADMIN_KEY, a Bearer token). Placed here, BEFORE the CLIENT_KEY
    // block, exactly like the RevenueCat webhook: the public CLIENT_KEY is in
    // client source, so gating admin metrics behind it would be no gate at all.
    if (url.pathname === '/admin/metrics') {
      return await handleAdminMetrics(request, url, env, origin);
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
      if (url.pathname === '/commit-scan') {
        return await handleCommitScan(request, env, origin, allowed);
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
      // RESIDUAL (documented): /gemini-jwt is NOT covered by the per-scan reservation
      // budget (verify + OCR must run BEFORE begin-scan), so a scripted holder of a
      // valid JWT can call verify/OCR Gemini beyond the 8/12 reservation cap, bounded
      // only by their (ban-able) account. Acceptable for launch; a per-user rate limit
      // here is the fast-follow if abused. [re-review 2026-06-27]
      if (url.pathname.startsWith('/gemini-jwt/')) {
        const gate = await requireUserJwt(request, env, origin, allowed);
        if (gate) return gate;
        return await handleGemini(request, url, env, origin, allowed, '/gemini-jwt/');
      }
      // Paid routes — require a valid per-scan token AND spend one unit of that
      // reservation's per-route call budget (requireScanBudget). The budget is what
      // makes the token a HARD limit on call VOLUME (not just entry). 'gemini' and
      // 'tavily' are the two budget buckets; /tavily-extract shares the tavily bucket.
      if (url.pathname.startsWith('/gemini/')) {
        const gate = await requireScanBudget(request, env, 'gemini', origin, allowed);
        if (gate) return gate;
        return await handleGemini(request, url, env, origin, allowed);
      }
      if (url.pathname === '/tavily') {
        const gate = await requireScanBudget(request, env, 'tavily', origin, allowed);
        if (gate) return gate;
        return await handleTavily(request, env, origin, allowed);
      }
      if (url.pathname === '/tavily-extract') {
        const gate = await requireScanBudget(request, env, 'tavily', origin, allowed);
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

// ── Per-scan metering: /begin-scan (RESERVE) + /commit-scan (RECORD) ────
//
// THE server-side cost control. One scan = many paid proxy calls, so the token alone
// can't meter (a stateless token authorizes UNBOUNDED calls for its TTL). The fix is a
// per-scan RESERVATION (scan_reservations, migration 029) that bounds BOTH minting and
// call volume, with NO client-triggerable delete (a "refund my scan" route is, by
// construction, an allowance-reset vector — abandoned, see migration 027 history):
//   • /begin-scan — verify JWT → reserve_scan() (advisory-locked: counts live pending
//     holds toward allowance, so it BOUNDS token minting; creates a reservation with
//     finite per-route call budgets) → mint a token NAMING that reservation. A client
//     with only the public CLIENT_KEY can't mint one.
//   • paid routes — verify token + consume_budget() one unit per call (requireScanBudget),
//     so a leaked token drains at most one scan's budget, not the whole pool.
//   • /commit-scan — verify JWT + token → commit_reservation() flips the pending hold
//     to a permanent scan_event → called ONCE after the biography is produced.
//   A mid-pipeline failure never commits → the pending hold ages out via its TTL →
//   the scan costs nothing, with no delete a client could abuse.
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

  // 2. RESERVE: allowance check (counting live pending holds) + create a reservation
  //    carrying this scan's per-route call budgets. The reservation holds an allowance
  //    slot immediately (bounds token minting) and is decremented per paid call
  //    (bounds volume). It records NO permanent scan_event — that happens at commit.
  const rpcRes = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/reserve_scan`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': env.SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    },
    body: JSON.stringify({
      p_user_id: userId,
      p_is_unlimited: isUnlimited,
      p_ttl_seconds: SCAN_TOKEN_TTL_SECONDS,
      // Budgets with headroom over the real worst case so a legitimate scan never
      // 402s, while an abused token is still bounded to one scan's spend.
      // Gemini: 3 logical scan-window calls (resolveSymbolMeanings, generateBiography,
      // resolveMentions), EACH of which fires a 2nd /gemini request to the fallback
      // model on 503/429/overload — so the real worst case is up to 6 (3×fallback).
      // 8 leaves margin. Tavily: up to 6 search slots + 2 extract = 8; 12 leaves margin.
      p_gemini: 8,
      p_tavily: 12,
    }),
  });
  if (!rpcRes.ok) {
    // Supabase failure — fail CLOSED (never hand out a token we can't account for).
    const detail = await rpcRes.text().catch(() => '');
    console.warn('begin-scan reserve_scan failed', JSON.stringify({ userId, status: rpcRes.status, detail: detail.slice(0, 200) }));
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

  // 3. Mint the token naming this reservation. exp = the DB-computed reservation
  //    expiry, so the stateless token-expiry and the row's expires_at agree exactly.
  const scanToken = await mintScanToken(result.reservation_id, userId, result.expires_at, env.SCAN_TOKEN_SECRET);
  return json({ token: scanToken, used: result.used, allowance: result.allowance }, 200, origin, allowed);
}

// /commit-scan — convert the pending reservation into a permanent scan_event AFTER
// the pipeline succeeds. JWT-gated AND token-gated: the reservation id comes from the
// signed X-Scan-Token (so a caller can only commit the reservation they were issued),
// and the token's userId must match the JWT's userId. commit_reservation flips
// pending→committed + INSERTs the scan_event (idempotent on retry). There is NO
// delete/refund counterpart — "failure costs nothing" is achieved by simply NOT
// committing (the pending hold ages out via its TTL), which a client cannot abuse to
// reset its allowance. [re-review 2026-06-26: reservation/budget model]
async function handleCommitScan(request, env, origin, allowed) {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405, origin, allowed);
  }
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
    return json({ error: 'Supabase not configured' }, 500, origin, allowed);
  }
  if (!env.SCAN_TOKEN_SECRET) {
    return json({ error: 'SCAN_TOKEN_SECRET not configured' }, 500, origin, allowed);
  }
  // JWT identity.
  const auth = await resolveUser(request, env);
  if (!auth.userId) {
    return json({ error: auth.error || 'Unauthorized', code: auth.code || 'NO_AUTH' }, auth.status || 401, origin, allowed);
  }
  // Reservation id from the signed token; the token's userId must match the JWT.
  const tok = request.headers.get('X-Scan-Token') || '';
  const v = tok ? await verifyScanToken(tok, env.SCAN_TOKEN_SECRET) : { valid: false };
  if (!v.valid || v.userId !== auth.userId) {
    return json({ error: 'Invalid scan token', code: 'BAD_SCAN_TOKEN' }, 400, origin, allowed);
  }
  const rpcRes = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/commit_reservation`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': env.SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    },
    body: JSON.stringify({ p_reservation_id: v.reservationId, p_user_id: auth.userId }),
  });
  if (!rpcRes.ok) {
    const detail = await rpcRes.text().catch(() => '');
    console.warn('commit-scan commit_reservation failed', JSON.stringify({ userId: auth.userId, status: rpcRes.status, detail: detail.slice(0, 200) }));
    return json({ error: 'Could not record scan', code: 'COMMIT_FAILED' }, 503, origin, allowed);
  }
  const result = await rpcRes.json().catch(() => null);
  return json({ committed: result?.committed === true }, 200, origin, allowed);
}

// Verify the caller's Supabase JWT (Authorization: Bearer) against /auth/v1/user
// and return the authoritative { userId, isUnlimited }. On any failure returns
// { userId: null, status, code, error } so the caller can shape its own response.
// Shared by /begin-scan, /commit-scan and the /gemini-jwt gate (DRY — same auth check).
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
// Response (4xx/5xx) to BLOCK, or null to proceed. Unlike requireScanBudget there is
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

// Gate for a paid route. Verifies the scan-token ENVELOPE (authentic + unexpired),
// then SPENDS one unit of that reservation's per-route call budget (consume_budget).
// The budget is the real cost control — it bounds call VOLUME, so a leaked token can
// drain at most one scan's worth, not the whole prepaid pool. Returns a Response to
// BLOCK, or null to proceed (budget decremented).
//
// route is 'gemini' or 'tavily' (the budget bucket).
//
// Fail direction:
//   • ENFORCE (SCAN_TOKEN_ENFORCE="true"): every failure fails CLOSED — bad/missing
//     token → 403, exhausted/expired budget → 402, Supabase unreachable → 503. Better
//     an outage than an open faucet on prepaid funds.
//   • TRANSITION ("false"/unset): observe but ALLOW — logs each failure (incl. a
//     "would_block" for an exhausted budget) and proceeds, so the worker can deploy
//     before the token-sending OTA AND so real budget consumption can be watched in
//     `wrangler tail` to confirm the budgets are sized right BEFORE flipping enforce.
async function requireScanBudget(request, env, route, origin, allowed) {
  const enforce = String(env.SCAN_TOKEN_ENFORCE || '').toLowerCase() === 'true';
  const path = new URL(request.url).pathname;
  const tok = request.headers.get('X-Scan-Token') || '';

  // Misconfiguration trap (audit 2026-06-26): with SCAN_TOKEN_SECRET unset, no token
  // can verify, so in transition mode EVERY paid call silently passes unmetered.
  // Log loudly so it's caught in tail; under enforce, fail closed.
  if (!env.SCAN_TOKEN_SECRET) {
    console.error('SCAN metering INERT: SCAN_TOKEN_SECRET unset — paid routes are unmetered',
      JSON.stringify({ path, enforce }));
    if (enforce) {
      return json({ error: 'Scan metering misconfigured', code: 'METERING_INERT' }, 503, origin, allowed);
    }
    return null;  // transition: allow (logged)
  }

  // 1. Verify the token envelope (cheap, no DB). Yields the reservationId + userId.
  const v = tok ? await verifyScanToken(tok, env.SCAN_TOKEN_SECRET) : { valid: false };
  if (!v.valid) {
    if (!enforce) {
      console.warn('scan-token transition', JSON.stringify({ reason: tok ? 'invalid_or_expired' : 'missing', path }));
      return null;
    }
    return json({ error: 'Scan token required', code: 'NO_SCAN_TOKEN' }, 403, origin, allowed);
  }

  // 2. Spend one unit of the reservation's per-route budget (atomic decrement-or-fail).
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
    // Can't reach the budget store. Under enforce fail closed; transition allow.
    if (enforce) return json({ error: 'Budget store unavailable', code: 'BUDGET_CHECK_FAILED' }, 503, origin, allowed);
    return null;
  }
  let dec, rpcRes;
  try {
    rpcRes = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/consume_budget`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': env.SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      },
      body: JSON.stringify({ p_reservation_id: v.reservationId, p_user_id: v.userId, p_route: route }),
    });
    dec = rpcRes.ok ? await rpcRes.json().catch(() => null) : null;
  } catch {
    dec = null; rpcRes = null;
  }

  if (!rpcRes || !rpcRes.ok || dec == null) {
    // Supabase failure — fail CLOSED under enforce, observe under transition.
    console.warn('consume_budget transport failure', JSON.stringify({ route, path, status: rpcRes?.status }));
    if (enforce) return json({ error: 'Could not verify scan budget', code: 'BUDGET_CHECK_FAILED' }, 503, origin, allowed);
    return null;
  }

  if (dec.ok !== true) {
    // Budget exhausted / expired / wrong user. Under enforce 402; transition observe.
    if (!enforce) {
      console.warn('scan-budget would_block', JSON.stringify({ route, path, reason: dec.reason }));
      return null;
    }
    return json({ error: 'Scan budget exhausted', code: 'BUDGET_EXHAUSTED', reason: dec.reason }, 402, origin, allowed);
  }

  return null;  // budget decremented — proceed to the upstream paid call
}

// Token format: base64url(`${reservationId}.${userId}.${exp}`) + "." + base64url(HMAC).
// The HMAC binds reservationId+userId+exp so the client can't forge/extend it. The
// reservationId NAMES the server-side call budget (scan_reservations) that the paid
// routes decrement — the token is a fast forgery-proof envelope, the budget is the
// real limit. reservationId + userId are UUIDs (no '.'), so the 3-field split is
// unambiguous. exp is passed in (the DB-computed reservation expiry) so the
// stateless token-expiry and the row's expires_at agree exactly.
async function mintScanToken(reservationId, userId, exp, secret) {
  const payload = `${reservationId}.${userId}.${exp}`;
  const sig = await hmacSha256(payload, secret);
  return `${b64urlEncode(payload)}.${b64urlEncode(sig)}`;
}

// Returns { valid:false } on bad sig / malformed / expired, or
// { valid:true, reservationId, userId, exp } on a verified, unexpired envelope.
// NOTE: a valid envelope does NOT mean budget remains — the paid route must still
// call consume_budget. This only proves authenticity + non-expiry (cheap, no DB).
async function verifyScanToken(tok, secret) {
  try {
    const dot = tok.indexOf('.');
    if (dot < 0) return { valid: false };
    const payloadB64 = tok.slice(0, dot);
    const sigB64 = tok.slice(dot + 1);
    const payload = b64urlDecodeToString(payloadB64);
    const expectedSig = await hmacSha256(payload, secret);
    if (!timingSafeEqualStr(sigB64, b64urlEncode(expectedSig))) return { valid: false };
    // payload = reservationId.userId.exp — split on the FIRST two dots only (the
    // two UUIDs contain none; exp is a plain integer).
    const d1 = payload.indexOf('.');
    const d2 = payload.indexOf('.', d1 + 1);
    if (d1 < 0 || d2 < 0) return { valid: false };
    const reservationId = payload.slice(0, d1);
    const userId = payload.slice(d1 + 1, d2);
    const exp = parseInt(payload.slice(d2 + 1), 10);
    if (!reservationId || !userId || !Number.isFinite(exp)) return { valid: false };
    if (Math.floor(Date.now() / 1000) > exp) return { valid: false };  // expired
    return { valid: true, reservationId, userId, exp };
  } catch {
    return { valid: false };
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
  // contentType is attacker-controlled. ABSENT (undefined/null) → default to JPEG.
  // PRESENT but not a string (number/object) → malformed: reject 415 (don't silently
  // treat it as JPEG, and never let .toLowerCase() throw a TypeError → opaque 500).
  // [audit 2026-06-26; re-verify: present-non-string now 415s, matching the comment]
  if (body.contentType != null && typeof body.contentType !== 'string') {
    return json({ error: 'Invalid contentType' }, 415, origin, allowed);
  }
  const requested = (body.contentType || 'image/jpeg').toLowerCase().split(';')[0].trim();
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

// ── Admin metrics dashboard: GET /admin/metrics ───────────────────
// Returns ONE JSON blob of every metric the admin dashboard renders, pulling
// from each data source IN PARALLEL (Promise.allSettled — one slow or failing
// source can NEVER sink the whole dashboard; it degrades to status:'error' for
// that section only). Every section carries a `status` so the UI never presents
// a number as authoritative when it isn't:
//   live     — pulled from a real API just now
//   derived  — computed/estimated from our own data (no upstream API exists)
//   degraded — the source needs setup we don't have yet (shows a fallback)
//   error    — the source was tried and failed
//
// Auth: its OWN Bearer secret (ADMIN_KEY), constant-time compared, fail-closed
// if unset — copied verbatim from the RevenueCat webhook pattern. The public
// CLIENT_KEY is NOT involved (this route runs before that gate).
//
// The service-role key (SUPABASE_SERVICE_KEY) stays entirely server-side; the
// browser only ever receives the aggregated JSON below.
// Note: this route uses adminJson/adminCorsHeaders (origin-reflecting), NOT the
// allowlist-based json()/corsHeaders() the public routes use — the dashboard
// runs as a local file (Origin: null) and is gated by the bearer token instead.
async function handleAdminMetrics(request, url, env, origin) {
  if (request.method !== 'GET') {
    return adminJson({ error: 'Method not allowed' }, 405, origin);
  }

  // Auth — Bearer ADMIN_KEY, constant-time, fail-closed (same shape as the
  // RevenueCat webhook secret check above).
  const authHeader = request.headers.get('Authorization') || '';
  if (!env.ADMIN_KEY || !timingSafeEqualStr(authHeader, `Bearer ${env.ADMIN_KEY}`)) {
    return adminJson({ error: 'Unauthorized' }, 401, origin);
  }

  // Funnel window: ?hours=N (default 720 = 30d). Clamped to a sane range so a
  // huge value can't ask Supabase for an unbounded scan.
  const hoursRaw = Number(url.searchParams.get('hours'));
  const windowHours = Number.isFinite(hoursRaw) && hoursRaw > 0
    ? Math.min(hoursRaw, 24 * 365)
    : 720;
  const sinceIso = new Date(Date.now() - windowHours * 3600 * 1000).toISOString();

  // Fan out: every source resolves to its own {status, ...} object. allSettled
  // means a thrown source becomes status:'error', not a 500 for the whole page.
  const [summary, funnel, revenuecat, gcloud] = await Promise.all([
    adminSupabaseSummary(env).catch((e) => ({ status: 'error', error: String(e && e.message || e) })),
    adminSupabaseFunnel(env, sinceIso).catch((e) => ({ status: 'error', error: String(e && e.message || e) })),
    adminRevenueCat(env).catch((e) => ({ status: 'error', error: String(e && e.message || e) })),
    adminGoogleCloud(env).catch((e) => ({ status: 'error', error: String(e && e.message || e) })),
  ]);

  // Tavily has NO usage API — derive from our own lifetime scan count + the
  // known cost model (reference-tavily-cost-model: ~$0.0075/credit, ~10 credits
  // & ~$0.08 per scan; 4000 credits / $30 per month plan). Surfaced alongside a
  // deep-link to the real dashboard (iframing is blocked by Tavily's headers).
  const lifetimeScans = (summary && summary.scans && typeof summary.scans.lifetime === 'number')
    ? summary.scans.lifetime
    : null;
  const tavily = adminTavilyDerived(lifetimeScans);

  return adminJson({
    ok: true,
    generated_at: new Date().toISOString(),
    window_hours: windowHours,
    summary,        // product/usage/money-in/conversion/reports (Supabase RPC)
    funnel,         // analytics_events tally over the window (Supabase REST)
    revenuecat,     // purchases/revenue (RevenueCat API) or degraded
    google_cloud: gcloud, // spend vs budget (BigQuery export) or degraded
    tavily,         // derived estimate + deep-link
  }, 200, origin);
}

// Supabase service-role fetch helper (mirrors the sb() pattern in
// handleDeleteAccount): raw fetch with service-role in BOTH apikey + Authorization.
function adminSb(env, path, init) {
  return fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      'apikey': env.SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...(init && init.headers),
    },
  });
}

// Heavy aggregates via the migration-030 RPC (one round-trip, service-role only).
async function adminSupabaseSummary(env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
    return { status: 'degraded', reason: 'Supabase service key not configured on the Worker' };
  }
  const res = await adminSb(env, 'rpc/admin_metrics_summary', { method: 'POST', body: '{}' });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`admin_metrics_summary ${res.status}: ${detail.slice(0, 200)}`);
  }
  const data = await res.json();
  return { status: 'live', ...data };
}

// Funnel: pull analytics_events over the window and tally client-side (small
// volume; same approach as tools/metrics-digest/digest.mjs). Capped at 50k rows.
async function adminSupabaseFunnel(env, sinceIso) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
    return { status: 'degraded', reason: 'Supabase service key not configured on the Worker' };
  }
  // order=DESC so that if the window exceeds the 50k cap we keep the NEWEST
  // 50k events and drop the stale tail — the opposite would hide today's spike,
  // the one thing a "what's happening now" dashboard must never miss.
  const q = `analytics_events?select=event,user_id&created_at=gte.${encodeURIComponent(sinceIso)}&order=created_at.desc&limit=50000`;
  const res = await adminSb(env, q, { method: 'GET' });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`analytics_events ${res.status}: ${detail.slice(0, 200)}`);
  }
  const rows = await res.json();
  const tally = {};
  let guestStarts = 0;
  for (const r of rows) {
    tally[r.event] = (tally[r.event] || 0) + 1;
    if (r.event === 'scan_started' && !r.user_id) guestStarts++;
  }
  const ev = (n) => tally[n] || 0;
  const started = ev('scan_started');
  return {
    status: 'live',
    truncated: rows.length >= 50000, // honest flag: tally is partial past 50k rows
    counts: {
      scan_started: started,
      verification_rejected: ev('verification_rejected'),
      ocr_done: ev('ocr_done'),
      bio_shown: ev('bio_shown'),
      bio_cache_hit: ev('bio_cache_hit'),
      story_saved: ev('story_saved'),
      made_public: ev('made_public'),
      paywall_shown: ev('paywall_shown'),
      scan_limit_hit: ev('scan_limit_hit'),
      purchase_completed: ev('purchase_completed'),
      scan_abandoned: ev('scan_abandoned'),
      pipeline_error: ev('pipeline_error'),
    },
    guest_starts: guestStarts,
    signed_in_starts: started - guestStarts,
    total_events: rows.length,
  };
}

// RevenueCat — authoritative MRR / revenue / active subs via the v2
// overview-metrics endpoint: GET /v2/projects/{id}/metrics/overview.
//   env.REVENUECAT_SECRET_KEY  — a v2 SECRET key (sk_...) with the
//                                charts_metrics:overview:read permission.
//   env.REVENUECAT_PROJECT_ID  — the project id (from the dashboard URL, or
//                                GET /v2/projects). Optional: if absent we look
//                                it up via the projects list with the same key.
// Defensive: RC's docs are ambiguous about whether a secret key (vs an OAuth
// atk_ token) may hold the charts_metrics scope. So we TRY the secret key and,
// if RC rejects it (401/403), return `degraded` carrying RC's own error text
// rather than crashing — the in-DB credits ledger still drives Money-in either
// way. Any non-2xx or shape surprise degrades, never throws past this function.
async function adminRevenueCat(env) {
  if (!env.REVENUECAT_SECRET_KEY) {
    return {
      status: 'degraded',
      reason: 'No REVENUECAT_SECRET_KEY on the Worker — using the in-DB credits ledger instead.',
      dashboard_url: 'https://app.revenuecat.com/',
    };
  }
  const headers = {
    'Authorization': `Bearer ${env.REVENUECAT_SECRET_KEY}`,
    'Content-Type': 'application/json',
  };

  // Resolve the project id (explicit env wins; else take the first project).
  let projectId = env.REVENUECAT_PROJECT_ID || '';
  if (!projectId) {
    const pRes = await fetch('https://api.revenuecat.com/v2/projects', { headers });
    if (!pRes.ok) {
      const detail = await pRes.text().catch(() => '');
      return {
        status: 'degraded',
        reason: `RevenueCat /projects ${pRes.status}: ${detail.slice(0, 160)}`,
        dashboard_url: 'https://app.revenuecat.com/',
      };
    }
    const pData = await pRes.json().catch(() => null);
    projectId = pData && Array.isArray(pData.items) && pData.items[0] && pData.items[0].id;
    if (!projectId) {
      return {
        status: 'degraded',
        reason: 'RevenueCat key valid but no projects returned — set REVENUECAT_PROJECT_ID.',
        dashboard_url: 'https://app.revenuecat.com/',
      };
    }
  }

  const mRes = await fetch(
    `https://api.revenuecat.com/v2/projects/${encodeURIComponent(projectId)}/metrics/overview?currency=USD`,
    { headers }
  );
  if (!mRes.ok) {
    const detail = await mRes.text().catch(() => '');
    // 401/403 most likely = the secret key lacks charts_metrics scope (may need
    // an OAuth atk_ token). Surface it plainly instead of failing the dashboard.
    return {
      status: 'degraded',
      reason: `RevenueCat metrics ${mRes.status}: ${detail.slice(0, 200)}`,
      dashboard_url: `https://app.revenuecat.com/projects/${encodeURIComponent(projectId)}`,
    };
  }
  const data = await mRes.json().catch(() => null);
  const metrics = data && Array.isArray(data.metrics) ? data.metrics : [];
  // Flatten [{id, value}] into {id: number|null}. Coerce value to a number so a
  // string ("123") renders with separators and a surprise object degrades to
  // null instead of crashing the dashboard's toLocaleString.
  const byId = {};
  for (const m of metrics) {
    if (!m || m.id == null) continue;
    const n = Number(m.value);
    byId[m.id] = Number.isFinite(n) ? n : null;
  }
  // Present-but-empty overview = key/scope/project issue, not a real $0 account.
  // Degrade (don't show a green "live" pill next to dashes).
  if (Object.keys(byId).length === 0) {
    return {
      status: 'degraded',
      reason: 'RevenueCat returned no metrics — check the key scope (charts_metrics:overview:read) and project id.',
      dashboard_url: `https://app.revenuecat.com/projects/${encodeURIComponent(projectId)}`,
    };
  }
  return {
    status: 'live',
    currency: (data && data.currency) || 'USD',
    mrr: byId.mrr ?? null,
    active_subscriptions: byId.active_subscriptions ?? null,
    active_trials: byId.active_trials ?? null,
    revenue_last_28_days: byId.revenue_last_28_days ?? null,
    new_customers_last_28_days: byId.new_customers_last_28_days ?? null,
    active_users_last_28_days: byId.active_users_last_28_days ?? null,
    dashboard_url: `https://app.revenuecat.com/projects/${encodeURIComponent(projectId)}`,
  };
}

// Google Cloud spend — LIVE month-to-date cost via the BigQuery billing export.
// Requires a one-time setup: enable Cloud Billing → BigQuery export, then a
// service account with BigQuery Job User + Data Viewer. Env:
//   env.GCP_SA_EMAIL        — service-account email
//   env.GCP_SA_PRIVATE_KEY  — its private key (PEM, \n-escaped is fine)
//   env.GCP_PROJECT_ID      — project that runs the query / holds the dataset
//   env.GCP_BILLING_TABLE   — fully-qualified export table:
//                             `proj.dataset.gcp_billing_export_v1_XXXXXX_XXXXXX_XXXXXX`
// Falls back to budget + manually-pasted GCLOUD_LAST_SPEND when the SA isn't
// configured, so the card is never blank. Any failure degrades, never throws.
async function adminGoogleCloud(env) {
  // Number.isFinite guard so a typo'd secret becomes null, not NaN.
  const toNum = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
  const budget = env.GCLOUD_MONTHLY_BUDGET ? toNum(env.GCLOUD_MONTHLY_BUDGET) : null;
  const lastKnown = env.GCLOUD_LAST_SPEND ? toNum(env.GCLOUD_LAST_SPEND) : null;

  const haveSa = env.GCP_SA_EMAIL && env.GCP_SA_PRIVATE_KEY && env.GCP_PROJECT_ID && env.GCP_BILLING_TABLE;
  if (!haveSa) {
    return {
      status: 'degraded',
      reason: 'Live spend needs Cloud Billing → BigQuery export + a service account. Showing budget + last-pasted spend.',
      monthly_budget_usd: budget,
      last_known_spend_usd: lastKnown,
      dashboard_url: 'https://console.cloud.google.com/billing',
    };
  }

  try {
    const token = await gcpAccessToken(env);
    // MTD = sum(cost) + sum(credit amounts) for the current invoice month.
    // Backticks in the FQN are required by BigQuery; the table name comes from
    // our own trusted env, not user input, so no injection surface.
    const sql =
      'SELECT SUM(cost) + SUM(IFNULL((SELECT SUM(c.amount) FROM UNNEST(credits) c), 0)) AS mtd, ' +
      'ANY_VALUE(currency) AS currency ' +
      'FROM `' + env.GCP_BILLING_TABLE + '` ' +
      "WHERE invoice.month = FORMAT_DATE('%Y%m', CURRENT_DATE())";
    const qRes = await fetch(
      `https://bigquery.googleapis.com/bigquery/v2/projects/${encodeURIComponent(env.GCP_PROJECT_ID)}/queries`,
      {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: sql, useLegacySql: false, timeoutMs: 20000 }),
      }
    );
    if (!qRes.ok) {
      const detail = await qRes.text().catch(() => '');
      return {
        status: 'degraded',
        reason: `BigQuery ${qRes.status}: ${detail.slice(0, 200)}`,
        monthly_budget_usd: budget, last_known_spend_usd: lastKnown,
        dashboard_url: 'https://console.cloud.google.com/billing',
      };
    }
    const data = await qRes.json().catch(() => null);
    // BigQuery returns rows as { f: [{ v: <string> }, ...] }; col 0 = mtd, 1 = currency.
    const row = data && Array.isArray(data.rows) && data.rows[0];
    const mtdRaw = row && row.f && row.f[0] && row.f[0].v;
    const currency = (row && row.f && row.f[1] && row.f[1].v) || 'USD';
    const mtdNum = Number(mtdRaw);
    const mtd = (mtdRaw != null && Number.isFinite(mtdNum)) ? Math.round(mtdNum * 100) / 100 : null;
    return {
      status: 'live',
      month_to_date_usd: mtd,
      currency,
      monthly_budget_usd: budget,
      dashboard_url: 'https://console.cloud.google.com/billing',
    };
  } catch (e) {
    return {
      status: 'degraded',
      reason: `Google Cloud live query failed: ${String(e && e.message || e).slice(0, 160)}`,
      monthly_budget_usd: budget, last_known_spend_usd: lastKnown,
      dashboard_url: 'https://console.cloud.google.com/billing',
    };
  }
}

// Mint a short-lived GCP OAuth access token from a service account, via the
// signed-JWT (jwt-bearer) grant. Signs an RS256 JWT with the SA private key
// using WebCrypto (available in Workers), then exchanges it at the token
// endpoint for an access_token scoped to BigQuery (read).
async function gcpAccessToken(env) {
  const now = Math.floor(Date.now() / 1000);
  const claim = {
    iss: env.GCP_SA_EMAIL,
    scope: 'https://www.googleapis.com/auth/bigquery.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };
  const enc = (obj) => b64url(new TextEncoder().encode(JSON.stringify(obj)));
  const signingInput = `${enc({ alg: 'RS256', typ: 'JWT' })}.${enc(claim)}`;

  const key = await importGcpPrivateKey(env.GCP_SA_PRIVATE_KEY);
  const sig = await crypto.subtle.sign(
    { name: 'RSASSA-PKCS1-v1_5' },
    key,
    new TextEncoder().encode(signingInput)
  );
  const jwt = `${signingInput}.${b64url(new Uint8Array(sig))}`;

  const tRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${encodeURIComponent(jwt)}`,
  });
  if (!tRes.ok) {
    const detail = await tRes.text().catch(() => '');
    throw new Error(`token exchange ${tRes.status}: ${detail.slice(0, 160)}`);
  }
  const tData = await tRes.json();
  if (!tData.access_token) throw new Error('no access_token from Google');
  return tData.access_token;
}

// Import a service-account PEM private key (PKCS#8) for RS256 signing.
// Tolerates \n-escaped newlines (how it lands when pasted into a Worker secret).
async function importGcpPrivateKey(pem) {
  const clean = String(pem)
    .replace(/\\n/g, '\n')
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '');
  const der = Uint8Array.from(atob(clean), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey(
    'pkcs8',
    der.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
}

// base64url without padding (for JWT segments + signature).
function b64url(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Tavily — DERIVED (no usage API). Estimate from lifetime scan count using the
// known cost model. Always returns; the deep-link is the authoritative path.
function adminTavilyDerived(lifetimeScans) {
  const CREDITS_PER_SCAN = 10;     // ~4-5 advanced slots + a FindAGrave /extract
  const COST_PER_SCAN_USD = 0.08;  // reference-tavily-cost-model (typical)
  const MONTHLY_PLAN_CREDITS = 4000;
  const MONTHLY_PLAN_USD = 30;
  if (typeof lifetimeScans !== 'number') {
    return {
      status: 'derived',
      reason: 'Tavily has no usage API — estimate unavailable (scan count missing).',
      dashboard_url: 'https://app.tavily.com/',
    };
  }
  return {
    status: 'derived',
    note: 'No Tavily usage API exists — these are ESTIMATES from our scan count. Tap "Open Tavily" for the authoritative balance.',
    lifetime_scans: lifetimeScans,
    est_credits_used: lifetimeScans * CREDITS_PER_SCAN,
    est_cost_usd: +(lifetimeScans * COST_PER_SCAN_USD).toFixed(2),
    plan_credits_per_month: MONTHLY_PLAN_CREDITS,
    plan_usd_per_month: MONTHLY_PLAN_USD,
    est_scans_per_month_capacity: Math.floor(MONTHLY_PLAN_CREDITS / CREDITS_PER_SCAN),
    dashboard_url: 'https://app.tavily.com/',
  };
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
    // GET is here for the /admin/metrics dashboard (a cross-origin browser GET
    // preflight checks this list); all other routes are POST.
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    // X-Scan-Token must be advertised or a browser CORS preflight for a token-bearing
    // paid call fails. Not reachable from mobile (no Origin → no preflight), but
    // pre-arms the eventual web token port so it isn't a silent landmine. [re-verify]
    'Access-Control-Allow-Headers': 'Content-Type, X-Client-Key, Authorization, X-Scan-Token',
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

// CORS headers for the admin metrics route ONLY. Reflects the request origin
// (or '*' when the page is a local file → Origin: null/empty), so the dashboard
// can run from a file:// path or any host. This is NOT a security downgrade:
// /admin/metrics is protected by the ADMIN_KEY bearer token, and the browser's
// same-origin policy never let a cross-origin page READ a response it isn't
// authorized for — without the secret, an attacker site gets 401 regardless of
// what ACAO says. Kept entirely separate from corsHeaders() so the public
// CLIENT_KEY routes keep their strict origin allowlist.
function adminCorsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin || '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400',
    'Vary': 'Origin',
  };
}

// JSON response for the admin route — same as json() but with the origin-
// reflecting admin CORS headers instead of the allowlist-based ones.
function adminJson(obj, status, origin) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...adminCorsHeaders(origin),
    },
  });
}
