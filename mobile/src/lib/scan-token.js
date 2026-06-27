import { PROXY_BASE, CLIENT_KEY } from './config';
import { supabase } from './supabase';

// ── Per-scan token (mobile) ───────────────────────────────────────
//
// The server-side cost control. Before a scan runs its (many) paid Gemini/Tavily
// proxy calls, the client calls beginScan() ONCE. The Worker verifies the user's
// JWT, atomically records the scan against their allowance (consume_scan RPC), and
// — only if allowed — returns a short-lived HMAC token bound to that user. Every
// paid proxy call then sends that token as X-Scan-Token; the Worker rejects paid
// calls without a valid token (once SCAN_TOKEN_ENFORCE is on).
//
// The token lives in module scope for the duration of the current scan. proxyHeaders()
// is the single source of headers for paid calls, so no call site can forget it.

let _scanToken = null;

// Call ONCE at the start of a scan. Returns:
//   { allowed: true,  used, allowance }                       — proceed; token armed
//   { allowed: false, code, used?, allowance?, error }        — block; show the right UI
// codes: NO_AUTH (signed out) · AT_LIMIT (out of scans) · CHECK_FAILED (fail-closed)
export async function beginScan() {
  let token = null;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    token = session?.access_token || null;
  } catch {
    token = null;
  }
  if (!token) {
    _scanToken = null;
    return { allowed: false, code: 'NO_AUTH', error: 'Sign in to scan.' };
  }

  let res;
  try {
    res = await fetch(`${PROXY_BASE}/begin-scan`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Client-Key': CLIENT_KEY,
        'Authorization': `Bearer ${token}`,
      },
    });
  } catch (e) {
    // Network failure — fail closed (do not let a scan run unmetered).
    _scanToken = null;
    return { allowed: false, code: 'CHECK_FAILED', error: 'Could not reach the server. Check your connection and try again.' };
  }

  let body = null;
  try { body = await res.json(); } catch { body = null; }

  if (res.ok && body?.token) {
    _scanToken = body.token;
    return { allowed: true, used: body.used, allowance: body.allowance };
  }

  _scanToken = null;
  // 402 = AT_LIMIT, 401 = auth, 503 = CHECK_FAILED, else generic.
  const code = body?.code || (res.status === 402 ? 'AT_LIMIT' : res.status === 401 ? 'NO_AUTH' : 'CHECK_FAILED');
  return {
    allowed: false,
    code,
    used: body?.used,
    allowance: body?.allowance,
    error: body?.error || 'Could not start the scan. Please try again.',
  };
}

// Headers for a paid proxy call (Gemini / Tavily). Always includes X-Client-Key;
// adds X-Scan-Token when a scan is armed. Spread into a fetch init's headers.
export function proxyHeaders(extra = {}) {
  const h = { 'Content-Type': 'application/json', 'X-Client-Key': CLIENT_KEY, ...extra };
  if (_scanToken) h['X-Scan-Token'] = _scanToken;
  return h;
}

// Clear the token at the end of a scan (or on discard) so a stale token is never
// reused across scans. Non-essential (tokens expire), but tidy.
export function endScan() {
  _scanToken = null;
}

// Headers for a JWT-authorized Gemini call that runs OUTSIDE a scan window and must
// NOT consume a scan — i.e. the /gemini-jwt route on the Worker. Callers:
//   • verifyIsGravestone — the FIRST paid call, runs before beginScan so a
//     non-gravestone photo doesn't burn a scan.
//   • readGravestone (OCR) — also runs before beginScan (the scan is counted AFTER
//     OCR), so it authenticates by JWT, not a scan token it doesn't have yet.
//   • redactLivingNamesForPublic at Save/Share/make-public — publish-time, where
//     there is no scan token at all (an already-saved story toggled public has no
//     scan). Without the JWT route it would 403 under enforcement; the redactor
//     fails CLOSED on an auth failure so a living relative's name can't leak.
// NOTE: resolveSymbolMeanings + resolveMentions run INSIDE the scan window and use
// the scan-token route (proxyHeaders), NOT this one — do not move them here.
// Returns null when there is no signed-in session (the caller must handle that —
// these routes require a real user; CLIENT_KEY alone is not accepted).
export async function jwtProxyHeaders(extra = {}) {
  let jwt = null;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    jwt = session?.access_token || null;
  } catch {
    jwt = null;
  }
  if (!jwt) return null;
  return {
    'Content-Type': 'application/json',
    'X-Client-Key': CLIENT_KEY,
    'Authorization': `Bearer ${jwt}`,
    ...extra,
  };
}

// The Worker route base for JWT-authorized (non-scan-consuming) Gemini calls.
// Mirrors PROXY_BASE + '/gemini-jwt/' vs the scan-token-gated '/gemini/'.
export const GEMINI_JWT_PATH = '/gemini-jwt';
