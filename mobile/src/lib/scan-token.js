import { PROXY_BASE, CLIENT_KEY } from './config';
import { supabase } from './supabase';

// ── Per-scan token (mobile) ───────────────────────────────────────
//
// The server-side cost control, split CHECK / COMMIT so a failed scan costs nothing:
//   • beginScan() — called ONCE before the paid calls. The Worker verifies the JWT,
//     RESERVES an allowance slot + per-route call budget (reserve_scan — records no
//     permanent scan_event), and — only if under allowance — returns a short-lived
//     HMAC token naming that reservation. Every paid proxy call sends it as
//     X-Scan-Token; the Worker verifies it AND spends one unit of the reservation's
//     budget per call (so a leaked token is bounded to one scan's worth).
//   • commitScan() — called ONCE after the biography succeeds. The Worker converts the
//     pending reservation into a permanent scan_event (commit_reservation). A
//     mid-pipeline failure never commits → the pending hold ages out via its TTL →
//     free, with no client-triggerable delete to abuse (a refund route was rejected
//     in review as an allowance-reset vector). [re-review 2026-06-26]
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

// Record the scan — call ONCE, only AFTER the biography is successfully produced.
// /begin-scan only RESERVED an allowance slot + armed the token; THIS converts the
// pending reservation into a permanent scan_event (server-side commit_reservation).
// A mid-pipeline failure simply never calls this → the pending hold ages out via its
// TTL and the scan costs nothing, with no client-triggerable delete to abuse.
// MUST send X-Scan-Token: the Worker reads the reservation id from the (signed) token
// so it commits exactly the reservation that was issued (and asserts the token's user
// matches the JWT). Returns { committed }. committed=false means the reservation was
// already committed/expired (rare). Best-effort: a network failure returns
// committed:false — the bio is still shown (uncounted scan is the safe direction;
// better than charging for nothing). [re-review 2026-06-26: reservation model]
export async function commitScan() {
  let jwt = null;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    jwt = session?.access_token || null;
  } catch {
    jwt = null;
  }
  if (!jwt || !_scanToken) return { committed: false };
  try {
    const res = await fetch(`${PROXY_BASE}/commit-scan`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Client-Key': CLIENT_KEY,
        'Authorization': `Bearer ${jwt}`,
        'X-Scan-Token': _scanToken,
      },
    });
    let body = null;
    try { body = await res.json(); } catch { body = null; }
    if (res.ok) return { committed: body?.committed === true };
  } catch {
    // network failure — uncounted scan (safe direction); bio still shown.
  }
  return { committed: false };
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
