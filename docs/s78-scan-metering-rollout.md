# S78 — Server-side scan metering: deploy & rollout runbook

Branch `fix/worker-money-delete-audit-s78`. This change closes a **critical** hole: the
paid Gemini/Tavily pipeline had **zero server-side metering** (the scan limit was
client-only; the public `CLIENT_KEY` ships in the app bundle and `Origin` is spoofable),
so anyone could call the Worker directly and drain the prepaid Tavily pool to outage.

## What it adds

- **`/begin-scan`** (Worker): verifies the user JWT → `consume_scan()` RPC (atomic
  allowance check + `scan_event` INSERT) → mints a short-lived (3 min) HMAC **scan token**.
- Paid routes **`/gemini`, `/tavily`, `/tavily-extract`** require the scan token
  (`requireScanToken`), gated by `SCAN_TOKEN_ENFORCE`.
- **`/gemini-jwt`** (Worker): JWT-gated, NO scan token, does NOT consume a scan — for the
  Gemini calls that run before the scan is counted (`verifyIsGravestone`, `readGravestone`)
  or at publish time (`redactLivingNamesForPublic`).
- **Migration 026**: `consume_scan` (with `pg_advisory_xact_lock` to close a TOCTOU) +
  `clawback_scan_credits` (refund handling + refund-abuse `RAISE WARNING`).
- Mobile: `beginScan()` wired after OCR (so rejects don't count, cache-hits do); the
  old client `incrementScanCount()` REMOVED (was a double-count); verify/OCR/redact on the
  JWT route; Tavily + biography on the scan-token route; redaction **fails CLOSED** on auth
  failure (no living-name leak).
- Hardening: refund clawback, SVG-upload XSS fix, durable record of unmapped-product
  GRANTs, constant-time secret compares, account-delete strict/best-effort split + PGRST204
  tolerance, upload contentType/data type guards.

## Deploy order (DO IN THIS SEQUENCE)

1. **Run migration 026** in the Supabase SQL editor (after 025). Idempotent. Run the
   VERIFICATION queries at the bottom of the file — confirm both functions are
   `SECURITY DEFINER`, executable only by `service_role`, and the `consume_scan` smoke
   test (1st–3rd allowed, 4th denied).
2. **Set the Worker secret**: `wrangler secret put SCAN_TOKEN_SECRET` (a random 32+ byte
   value). Confirm `SUPABASE_SERVICE_KEY` is also set. *(Without the secret, `/begin-scan`
   500s and — in transition mode — paid routes serve unmetered but now log
   `SCAN metering INERT` loudly on every paid request.)*
3. **Deploy the Worker in TRANSITION mode** (`SCAN_TOKEN_ENFORCE = "false"`, the default):
   `cd worker && wrangler deploy`. Un-tokened requests are still served + logged, so
   nothing breaks while clients are still rolling out.
4. **OTA the mobile bundle** to `production`:
   `cd mobile && npx eas update --branch production --environment production`. This wiring
   is PURE JS (no native module), so an OTA is correct — no new build needed.
5. **Watch `wrangler tail`.** Confirm `X-Scan-Token` is arriving on BOTH `/gemini` AND
   `/tavily*`, and that `scan-token transition` "missing" logs from mobile dwindle to zero
   as testers update. Confirm `/begin-scan` + `/gemini-jwt` are getting traffic.

## ⚠️ DO NOT flip `SCAN_TOKEN_ENFORCE = "true"` until ALL of these hold

1. `wrangler tail` shows tokens on /gemini AND /tavily* with no remaining mobile "missing".
2. **The WEB pipeline is handled.** As of this change the web PWA (`js/`) still calls
   `/gemini` + `/tavily` with ONLY `X-Client-Key` and has NO token machinery — flipping
   enforce **WILL 403 every web scan and take the live web app offline**. Before enforce,
   either (a) retire the web scan pipeline (the landing-page pivot), or (b) port
   `begin-scan` + `X-Scan-Token` + the `/gemini-jwt` split to `js/`.
3. On-device tested: a real scan completes end-to-end with a token; at-limit → Paywall;
   make-public still redacts living names.

Flipping enforce is a `wrangler.toml` edit + `wrangler deploy` (or `wrangler secret`/var
update) — no code change.

## Known residual (documented, deferred)

- **Token gates entry, not volume.** A leaked/extracted scan token authorizes unbounded
  paid calls for its (now 3-min) lifetime. The true fix is a per-token call budget in
  Cloudflare KV/Durable Objects — **backlog #11 (Worker budget guard)**. The 3-min TTL caps
  the residual to minutes; do NOT lengthen the TTL without the KV budget guard.
- **Refund-loop** (buy → run all scans → refund → repeat): not auto-blocked; every clawback
  is durably recorded (negative-amount `revenuecat_events` row) and `RAISE WARNING`s the
  user's lifetime refund count. Detection query is in migration 026. Auto-block is a
  fast-follow if it shows up.
- **Unmapped refund** is dropped (not recorded); only unmapped GRANTs get a durable row.

## Rollback

- Worker: redeploy the previous `worker.js` (the paid routes go back to CLIENT_KEY-only).
  Transition mode means there is no client-breaking dependency to unwind.
- Mobile: the OTA can be reverted with a prior `eas update`. With the Worker in transition
  mode, an old (non-token) client and a new (token) client both work, so rollback of either
  side independently is safe.
- Migration 026 functions are additive (`consume_scan`/`clawback_scan_credits`); leaving
  them in place is harmless if the Worker stops calling them.
