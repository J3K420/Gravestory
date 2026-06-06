---
baseline_commit: b67cca0
---

# Story 1.3: Build RevenueCat Purchase Webhook Endpoint

Status: done

## Story

As a product owner,
I want the Cloudflare Worker to receive RevenueCat purchase events and credit the buyer's account,
so that purchased scan credit packs are immediately available for use without any manual intervention.

## Acceptance Criteria

1. **INITIAL_PURCHASE / NON_SUBSCRIPTION_PURCHASE credited** — RevenueCat sends `POST /revenuecat-webhook` with an `INITIAL_PURCHASE` or `NON_SUBSCRIPTION_PURCHASE` event; Worker validates the signature, maps the product_id to a credit count, and atomically UPSERTs `scan_credits` for that user via the Supabase service-role key; returns HTTP 200.

2. **Other event types acknowledged without action** — Any RevenueCat event type that is not a purchase (e.g. `CANCELLATION`, `EXPIRATION`, `BILLING_ISSUE`) returns HTTP 200 with `{ ok: true, action: "ignored" }` — RevenueCat must not be given a non-2xx response for events we don't handle.

3. **Credit mapping is correct:**
   - `gravestory_5_scans` → 5 credits inserted
   - `gravestory_20_scans` → 20 credits inserted
   - `gravestory_60_scans` → 60 credits inserted

4. **Invalid signature rejected** — A request with a missing or incorrect `Authorization` header returns HTTP 401; no database write occurs.

5. **Atomic UPSERT — no race condition** — The credit increment is performed via a PostgreSQL function `add_scan_credits(p_user_id, p_amount)` that uses `INSERT ... ON CONFLICT ... DO UPDATE SET purchased = scan_credits.purchased + EXCLUDED.purchased`. This is the only correct way to safely increment without TOCTOU risk.

6. **Webhook route bypasses Origin/CLIENT_KEY auth** — The `/revenuecat-webhook` route is handled before the existing auth block (lines 76–88 of `worker.js`). RevenueCat sends no `Origin` header and no `X-Client-Key`; the existing auth check would 403 it if not bypassed.

7. **New Wrangler secrets deployed** — `REVENUECAT_WEBHOOK_SECRET`, `SUPABASE_SERVICE_KEY` added via `wrangler secret put`; `SUPABASE_URL` added as a var in `wrangler.toml`; Worker redeploys without errors.

8. **RevenueCat dashboard configured** — Webhook URL set to `https://gravestory-proxy.james-gravestory.workers.dev/revenuecat-webhook`; Authorization header set to the same value as `REVENUECAT_WEBHOOK_SECRET`.

9. **curl smoke-test passes** — A test POST with a valid Authorization header, a valid `NON_SUBSCRIPTION_PURCHASE` event body, and a real Supabase user UUID returns HTTP 200; the `scan_credits` row for that user is created/updated with the correct credit count; `checkScanLimit` / `checkWebScanLimit` reflect the new total.

## Tasks / Subtasks

- [x] **Task 1 — Write and run Supabase migration `006_add_increment_credits_fn.sql`** (AC: 5)
  - [x] Create `supabase-migrations/006_add_increment_credits_fn.sql` (content in Dev Notes below)
  - [ ] Paste into Supabase SQL editor → execute; confirm "Success. No rows returned."
  - [ ] Verify function exists: `SELECT routine_name FROM information_schema.routines WHERE routine_name = 'add_scan_credits';`
  - [ ] Verify constraint exists: `SELECT constraint_name FROM information_schema.table_constraints WHERE table_name = 'scan_credits' AND constraint_type = 'CHECK';`

- [x] **Task 2 — Add webhook handler to `worker/worker.js`** (AC: 1, 2, 3, 4, 6)
  - [x] Add the `/revenuecat-webhook` route dispatch **before** the auth check — between the `OPTIONS` preflight handler and the `if (allowed !== '*')` block (see exact insertion point in Dev Notes)
  - [x] Implement `handleRevenueCatWebhook(request, env, origin, allowed)` function (full implementation in Dev Notes)
  - [x] Update the comment header at the top of `worker.js` to document the new endpoint, new secrets, and new var

- [x] **Task 3 — Update `worker/wrangler.toml`** (AC: 7)
  - [x] Add `SUPABASE_URL = "https://idbrjonofqrsykqsqpwo.supabase.co"` to the `[vars]` block
  - [x] Add comments for `REVENUECAT_WEBHOOK_SECRET` and `SUPABASE_SERVICE_KEY` (same pattern as existing secret comments)

- [x] **Task 4 — Set Wrangler secrets** (AC: 7)
  - [x] `cd worker && wrangler secret put REVENUECAT_WEBHOOK_SECRET` — set 2026-06-06
  - [x] `cd worker && wrangler secret put SUPABASE_SERVICE_KEY` — set 2026-06-06

- [x] **Task 5 — Configure RevenueCat dashboard** (AC: 8)
  - [x] Webhook active 2026-06-06 — events: INITIAL_PURCHASE + NON_RENEWING_PURCHASE (dashboard label for NON_SUBSCRIPTION_PURCHASE)

- [x] **Task 6 — Deploy Worker** (AC: 7)
  - [x] `cd worker && wrangler deploy` — deployed 2026-06-06, Version ID: 1ba5c69a-5b25-4cef-a005-09c96bec9a67

- [ ] **Task 7 — Smoke-test with curl** (AC: 9)
  - [ ] Send a test event (exact command in Dev Notes below)
  - [ ] Confirm HTTP 200 response
  - [ ] Check Supabase Table Editor → `scan_credits` → row created/updated for the test user_id
  - [ ] Check that `checkWebScanLimit()` (web DevTools console) or `checkScanLimit(userId)` (mobile log) now reflects the new credit total
  - [ ] Test invalid signature: `Authorization: Bearer wrong` → confirm HTTP 401
  - [ ] Test unknown product: `product_id: "unknown_sku"` → confirm HTTP 200 with `action: "ignored"`
  - [ ] Test ignored event type: `type: "CANCELLATION"` → confirm HTTP 200 with `action: "ignored"`
  - [ ] **Clean up:** delete the test `scan_credits` row: `DELETE FROM scan_credits WHERE user_id = '<test-user-id>';`

## Dev Notes

### Critical architectural constraint: route placement

The existing auth block (lines 76–88 in `worker.js`) blocks any request with no `Origin` header and no matching `X-Client-Key`. RevenueCat is a server-to-server caller — it sends neither. If `/revenuecat-webhook` goes inside the normal route block, RevenueCat's POST will always get HTTP 403.

**The route dispatch for `/revenuecat-webhook` must be inserted BEFORE the `if (allowed !== '*')` block.**

Current code structure (worker.js):
```
OPTIONS preflight → return 204          (line 58–62)
Auth check → if (allowed !== '*') ...   (line 76–88)   ← webhook must go BEFORE this
Routes block → try { if (/gemini) ...   (line 91–111)
```

The webhook has its own auth mechanism (the `REVENUECAT_WEBHOOK_SECRET` bearer token), so it is safe to bypass the Origin/CLIENT_KEY check entirely.

### Exact insertion point in worker.js

Insert this block after line 63 (end of the `OPTIONS` handler) and before line 65 (the auth comment):

```javascript
    // ── RevenueCat webhook: bypass Origin/CLIENT_KEY auth — has its own auth ──
    if (url.pathname === '/revenuecat-webhook') {
      return await handleRevenueCatWebhook(request, env, origin, allowed);
    }
```

### Migration file: `supabase-migrations/006_add_increment_credits_fn.sql`

```sql
-- 006_add_increment_credits_fn.sql
-- Atomic UPSERT increment for scan_credits.
-- Called by the Cloudflare Worker RevenueCat webhook via Supabase REST RPC.
-- SECURITY DEFINER ensures it runs with table-owner privileges regardless of caller role.

CREATE OR REPLACE FUNCTION public.add_scan_credits(p_user_id UUID, p_amount INTEGER)
RETURNS void AS $$
BEGIN
  INSERT INTO public.scan_credits (user_id, purchased, updated_at)
  VALUES (p_user_id, p_amount, now())
  ON CONFLICT (user_id)
  DO UPDATE SET
    purchased  = public.scan_credits.purchased + EXCLUDED.purchased,
    updated_at = now();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Non-negative constraint deferred from Story 1.1 review
ALTER TABLE public.scan_credits
  ADD CONSTRAINT IF NOT EXISTS scan_credits_purchased_non_negative
  CHECK (purchased >= 0);
```

Run this in the Supabase SQL editor. Use plain ASCII quotes only — no curly/typographic quotes.

### handleRevenueCatWebhook implementation

Add this function at the bottom of `worker.js`, before the `// ── helpers ───` section:

```javascript
// ── RevenueCat webhook: POST /revenuecat-webhook ──────────────────
// Server-to-server — no Origin or CLIENT_KEY. Auth is REVENUECAT_WEBHOOK_SECRET.
// RevenueCat sets this value in the Authorization header of every webhook request.
async function handleRevenueCatWebhook(request, env, origin, allowed) {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405, origin, allowed);
  }

  // Validate RevenueCat webhook secret
  const authHeader = request.headers.get('Authorization') || '';
  if (!env.REVENUECAT_WEBHOOK_SECRET || authHeader !== `Bearer ${env.REVENUECAT_WEBHOOK_SECRET}`) {
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

  // Only process purchase events; acknowledge all others without action.
  // RevenueCat retries on non-2xx — always return 2xx for events we ignore.
  const PURCHASE_TYPES = new Set(['NON_SUBSCRIPTION_PURCHASE', 'INITIAL_PURCHASE']);
  if (!PURCHASE_TYPES.has(event.type)) {
    return json({ ok: true, action: 'ignored', type: event.type }, 200, origin, allowed);
  }

  const userId   = event.app_user_id;
  const productId = event.product_id;

  if (!userId || !productId) {
    return json({ error: 'Missing app_user_id or product_id' }, 400, origin, allowed);
  }

  const CREDIT_MAP = {
    gravestory_5_scans:  5,
    gravestory_20_scans: 20,
    gravestory_60_scans: 60,
  };

  const credits = CREDIT_MAP[productId];
  if (credits == null) {
    // Unknown product — may be a test SKU or from another app in the same RC project
    return json({ ok: true, action: 'ignored', reason: 'unknown product', product_id: productId }, 200, origin, allowed);
  }

  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) {
    return json({ error: 'Supabase not configured' }, 500, origin, allowed);
  }

  const rpcRes = await fetch(`${env.SUPABASE_URL}/rest/v1/rpc/add_scan_credits`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': env.SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
    },
    body: JSON.stringify({ p_user_id: userId, p_amount: credits }),
  });

  if (!rpcRes.ok) {
    const detail = await rpcRes.text().catch(() => '');
    return json({ error: 'Supabase RPC failed', status: rpcRes.status, detail }, 500, origin, allowed);
  }

  return json({ ok: true, user_id: userId, credits_added: credits }, 200, origin, allowed);
}
```

### Updated wrangler.toml `[vars]` block

```toml
[vars]
# Set to your production domain — NEVER "*" in production.
ALLOWED_ORIGIN = "https://j3k420.github.io"
R2_PUBLIC_URL = "https://pub-0550b9a48a574a0b812771f0ea4c9377.r2.dev"
SUPABASE_URL  = "https://idbrjonofqrsykqsqpwo.supabase.co"
```

### Updated worker.js header comment (secrets section)

```javascript
// Secrets (set via `wrangler secret put`):
//   GEMINI_KEY
//   TAVILY_KEY
//   CLIENT_KEY              — shared secret for web + mobile (X-Client-Key header)
//   REVENUECAT_WEBHOOK_SECRET — must match the Authorization Bearer value in RevenueCat dashboard
//   SUPABASE_SERVICE_KEY    — Supabase service-role key (bypasses RLS; never expose to clients)
//
// Vars (set in wrangler.toml [vars]):
//   ALLOWED_ORIGIN   comma-separated origins
//   R2_PUBLIC_URL    public base URL for R2 bucket
//   SUPABASE_URL     Supabase project URL (not sensitive)
```

### curl smoke-test commands

Replace `<YOUR_WEBHOOK_SECRET>` with your chosen secret and `<REAL_SUPABASE_USER_UUID>` with a real user ID from the Supabase auth.users table (e.g. your own tester account UUID).

```bash
# Test 1 — valid purchase (should return 200 and upsert credits)
curl -X POST https://gravestory-proxy.james-gravestory.workers.dev/revenuecat-webhook \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <YOUR_WEBHOOK_SECRET>" \
  -d '{
    "event": {
      "type": "NON_SUBSCRIPTION_PURCHASE",
      "app_user_id": "<REAL_SUPABASE_USER_UUID>",
      "product_id": "gravestory_20_scans",
      "transaction_id": "test-txn-001"
    }
  }'
# Expected: {"ok":true,"user_id":"...","credits_added":20}

# Test 2 — invalid signature (should return 401)
curl -X POST https://gravestory-proxy.james-gravestory.workers.dev/revenuecat-webhook \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer wrongsecret" \
  -d '{"event":{"type":"NON_SUBSCRIPTION_PURCHASE","app_user_id":"<UUID>","product_id":"gravestory_5_scans"}}'
# Expected: {"error":"Unauthorized"} HTTP 401

# Test 3 — ignored event type (should return 200 with action:ignored)
curl -X POST https://gravestory-proxy.james-gravestory.workers.dev/revenuecat-webhook \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <YOUR_WEBHOOK_SECRET>" \
  -d '{"event":{"type":"CANCELLATION","app_user_id":"<UUID>","product_id":"gravestory_5_scans"}}'
# Expected: {"ok":true,"action":"ignored","type":"CANCELLATION"}
```

### RevenueCat event types for consumables

The `product_id` values (`gravestory_5_scans`, etc.) are configured as **consumable one-time products** in Google Play Console and RevenueCat. RevenueCat fires `NON_SUBSCRIPTION_PURCHASE` for consumable one-time purchases, not `INITIAL_PURCHASE` (which is for subscriptions). Both are handled in the implementation; the primary expected type is `NON_SUBSCRIPTION_PURCHASE`.

### Dependency note: app_user_id and Story 1.4

For the webhook to credit the correct Supabase user, RevenueCat's `app_user_id` must equal the Supabase user UUID. This is configured in Story 1.4 by calling `Purchases.logIn(userId)` after Supabase authentication. **Without Story 1.4, real in-app purchases will fire with RevenueCat's anonymous UUID** (not the Supabase UUID), and credits will not be attributed to the correct user.

The smoke-test in Task 7 uses a manually constructed event body where you hardcode a real Supabase user UUID — this works regardless of Story 1.4's status.

### Schema used by the RPC

`add_scan_credits(p_user_id UUID, p_amount INTEGER)` performs an atomic UPSERT:
- If no row for `user_id` → inserts `purchased = p_amount`
- If row exists → increments: `purchased = purchased + p_amount`

The client (`scan-limit.js` on web and mobile) reads `SELECT purchased FROM scan_credits WHERE user_id = ...`. After a successful webhook call, the `purchased` column increases by the credit pack amount.

### What this story does NOT change

- `mobile/src/lib/scan-limit.js` — already queries `scan_credits.purchased` correctly
- `js/scan-limit.js` — already queries `scan_credits.purchased` correctly
- `PaywallScreen.js` — no purchase logic yet (awaits Story 1.4)
- `App.js` — RevenueCat still disabled (awaits Story 1.4)
- Any client files — this is purely Worker + DB migration

### Files touched

| File | Action | Purpose |
|---|---|---|
| `supabase-migrations/006_add_increment_credits_fn.sql` | CREATE | Atomic increment RPC + CHECK constraint |
| `worker/worker.js` | UPDATE | Add `/revenuecat-webhook` route before auth block; add `handleRevenueCatWebhook()` function; update header comment |
| `worker/wrangler.toml` | UPDATE | Add `SUPABASE_URL` to `[vars]`; update secrets comments |

Run `cd worker && wrangler deploy` after code changes.

### Project Structure Notes

- Worker lives in `worker/worker.js` — Cloudflare Worker ESM (`export default`). No npm, no bundler, no TypeScript.
- `wrangler.toml` is in `worker/` — run wrangler commands from that directory.
- Wrangler secrets are stored outside the repo (Wrangler Secrets Store) — never committed.
- `SUPABASE_SERVICE_KEY` is the **service-role** key from Supabase Project Settings → API. It is NOT the `anon` key. The service role bypasses all RLS policies. Do not expose it to client code. Store only as a Wrangler secret.
- The `add_scan_credits` function uses `SECURITY DEFINER` so it runs with table-owner privilege regardless of caller role — this is the correct pattern for service-role RPC calls on Supabase.
- The migration file follows the same naming convention as prior migrations (`NNN_description.sql`).
- Run migrations manually in the Supabase SQL editor — never via CLI or CI. Use plain ASCII quotes only.

### References

- Current `worker/worker.js` auth block: [worker/worker.js:76-88](worker/worker.js#L76-L88)
- `scan_credits` schema: [supabase-migrations/005_scan_credits.sql](supabase-migrations/005_scan_credits.sql)
- Client `scan_credits` query (web): [js/scan-limit.js:33-38](js/scan-limit.js#L33-L38)
- Client `scan_credits` query (mobile): [mobile/src/lib/scan-limit.js:39-44](mobile/src/lib/scan-limit.js#L39-L44)
- Credit product IDs: [mobile/src/screens/PaywallScreen.js:10-16](mobile/src/screens/PaywallScreen.js#L10-L16)
- Deferred items from Story 1.1 review (TOCTOU, CHECK constraint, updated_at): [_bmad-output/implementation-artifacts/1-1-run-scan-credits-database-migration.md](../implementation-artifacts/1-1-run-scan-credits-database-migration.md#review-findings)
- NFR-S6: `scan_credits` service-role write-only: [_bmad-output/planning-artifacts/epics.md](_bmad-output/planning-artifacts/epics.md)
- CLAUDE.md — Phase 9 remaining: "Build RevenueCat webhook endpoint in Worker"
- CLAUDE.md — Cloudflare Worker security note (secrets, ALLOWED_ORIGIN, CLIENT_KEY)

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

### Completion Notes List

- Tasks 1–3 complete (code changes): migration file created, webhook handler added to worker.js before auth block, wrangler.toml updated with SUPABASE_URL and secrets comments.
- Tasks 4–7 pending user action: set `REVENUECAT_WEBHOOK_SECRET` + `SUPABASE_SERVICE_KEY` via `wrangler secret put`, configure RevenueCat dashboard, deploy with `wrangler deploy`, run smoke-test curl commands.
- Migration subtasks (run in Supabase SQL editor) and smoke-test verification subtasks also pending user action.

### File List

- `supabase-migrations/006_add_increment_credits_fn.sql` — created
- `worker/worker.js` — updated: added `/revenuecat-webhook` route dispatch before auth block; added `handleRevenueCatWebhook()` function; updated header comment with new endpoint, secrets, and vars
- `worker/wrangler.toml` — updated: added `SUPABASE_URL` to `[vars]`; added secrets comments

## Change Log

| Date | Change |
|---|---|
| 2026-06-08 | Tasks 1–3: created migration 006, added webhook handler to worker.js, updated wrangler.toml. Tasks 4–7 pending user action (secrets, RC dashboard, deploy, smoke-test). |
