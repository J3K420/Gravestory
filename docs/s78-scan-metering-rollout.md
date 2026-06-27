# S78 — Server-side scan metering: deploy & rollout runbook

Branch `fix/worker-money-delete-audit-s78`. This change closes a **critical** hole: the
paid Gemini/Tavily pipeline had **zero server-side metering** (the scan limit was
client-only; the public `CLIENT_KEY` ships in the app bundle and `Origin` is spoofable),
so anyone could call the Worker directly and drain the prepaid Tavily pool to outage.

## What it adds

The metering went through three designs in review; the SHIPPED design is the
**reservation + per-call budget** (the only one that's a true hard cost control, not a
cooperative-client one). The earlier two (record-at-begin, check/commit) and a refund
route are documented in history but superseded.

- **`/begin-scan`** (Worker): verifies the user JWT → `reserve_scan()` RPC
  (advisory-locked: counts committed scans **+ live pending reservations** toward
  allowance, so it **bounds token minting**; creates a `pending` reservation carrying
  finite per-route call budgets — **8 Gemini / 12 Tavily**) → mints a short-lived (10 min)
  HMAC **scan token naming that reservation**. No permanent scan recorded here. (The
  10-min TTL covers a slow/briefly-backgrounded pipeline; call VOLUME is bounded by the
  budget, not the TTL, so a generous TTL doesn't widen the leaked-token surface.)
- Paid routes **`/gemini`, `/tavily`, `/tavily-extract`**: `requireScanBudget(route)`
  verifies the token envelope then **spends one unit** of the reservation's per-route
  budget (`consume_budget`, atomic decrement-or-402). This **bounds call volume** — a
  leaked token drains at most one scan's budget, not the pool. Gated by `SCAN_TOKEN_ENFORCE`.
- **`/commit-scan`** (Worker): verifies JWT **+ token** (token's user must match JWT) →
  `commit_reservation()` flips the pending hold to a permanent `scan_event`. Called ONCE
  after the biography is produced. A mid-pipeline failure never commits → the pending hold
  **ages out via its TTL** → the scan costs nothing, with **no client-triggerable delete**
  (a refund route was designed then rejected in review as an allowance-reset vector).
- **`/gemini-jwt`** (Worker): JWT-gated, NO scan token, no budget — for the Gemini calls
  before the scan (`verifyIsGravestone`, `readGravestone`) or at publish time
  (`redactLivingNamesForPublic`).
- **Migrations**: 026 (original `consume_scan` + `add/clawback_scan_credits`), 028
  (check/commit split — superseded), **029 (the SHIPPED model: `scan_reservations` table +
  `reserve_scan` + `consume_budget` + `commit_reservation`; drops 028's RPCs)**. All
  advisory-locked where needed, `SECURITY DEFINER`, service-role-only.
- Mobile: `beginScan()` (reserve+token) after OCR; `commitScan()` (sends X-Scan-Token) on
  success (full pipeline + cache hit); old client `incrementScanCount()` REMOVED;
  verify/OCR/redact on the JWT route; Tavily + biography on the scan-token route; redaction
  **fails CLOSED** on auth failure (no living-name leak).
- Hardening: purchase clawback, SVG-upload XSS fix, durable record of unmapped-product
  GRANTs, constant-time secret compares, account-delete strict/best-effort split + PGRST204
  tolerance, upload contentType/data type guards.

## Deploy order (DO IN THIS SEQUENCE)

1. **Run migrations 026 → 028 → 029** in the Supabase SQL editor (after 025). All
   idempotent. 026 (already run) + 028 are superseded by 029, which creates the
   reservation table + the three budget RPCs and DROPs 028's `check_scan_allowance` +
   `commit_scan`. Run the VERIFICATION block at the bottom of
   `029_scan_reservations_budget.sql` — confirm `reserve_scan` bounds minting (3 pending
   holds → 4th denied), `consume_budget` caps at 6 Gemini (7th → exhausted) + rejects a
   wrong-user decrement, and `commit_reservation` records exactly one `scan_event`
   (idempotent on retry). (The `026_VERIFY_live.sql` script is SUPERSEDED.)
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
   as testers update. Confirm `/begin-scan`, `/commit-scan`, and `/gemini-jwt` are getting
   traffic, and that scan COUNTS match successful bios (commit fires on success, not begin).

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

- **Token volume IS now bounded** (per-route budget via `consume_budget`) — the original
  "token gates entry not volume" hole is closed. The remaining residual is small: once
  enforce is on, a signed-in attacker can, within their free allowance (3), hold 3
  concurrent reservations = up to 3×(8 Gemini + 12 Tavily) paid calls in flight, let them
  age out (10 min), and repeat. Bounded per cycle and per account (a real, ban-able JWT),
  vastly better than the prior unbounded drain. Tightening (lower budgets, per-user mint
  rate-limit) is a fast-follow if abuse shows up — watch the `would_block` transition logs.
- **commit is cooperative** (best-effort from the client): a produced-but-uncommitted bio
  is uncounted (the safe direction — uncounted beats charging for nothing). The budget,
  not the commit, is the cost control, so this doesn't open a drain.
- **Refund-loop** (buy → run all scans → refund → repeat): not auto-blocked; every clawback
  is durably recorded (negative-amount `revenuecat_events` row) and `RAISE WARNING`s the
  user's lifetime refund count. Detection query is in migration 026. Auto-block is a
  fast-follow if it shows up.
- **Unmapped refund** is dropped (not recorded); only unmapped GRANTs get a durable row.
- **Reservation rows** accumulate (one per scan); allowance stays correct via the TTL
  age-out regardless. A `pg_cron` reaper to delete terminal rows is deferred (sketched in
  029's design notes) — purely table-size housekeeping, not correctness.

## Rollback

- Worker: redeploy the previous `worker.js` (the paid routes go back to CLIENT_KEY-only).
  Transition mode means there is no client-breaking dependency to unwind.
- Mobile: the OTA can be reverted with a prior `eas update`. With the Worker in transition
  mode, an old (non-token) client and a new (token) client both work, so rollback of either
  side independently is safe.
- Migration 026 functions are additive (`consume_scan`/`clawback_scan_credits`); leaving
  them in place is harmless if the Worker stops calling them.
