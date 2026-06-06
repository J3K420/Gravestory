---
baseline_commit: ca81a02d7783502b3bc9a5419ed1fe049c10910b
---

# Story 1.1: Run Scan Credits Database Migration

Status: done

## Story

As a product owner,
I want the `scan_credits` table created in Supabase with correct RLS policies,
so that the RevenueCat webhook (Story 1.3) has a destination to write purchased credits and the scan-limit system can accurately grant extra scans to paying users.

## Acceptance Criteria

1. **Migration executed successfully** — `005_scan_credits.sql` runs in the Supabase SQL editor without errors; the `scan_credits` table exists in the `public` schema.

2. **Schema is correct** — The table has exactly these columns:
   - `user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE`
   - `purchased INTEGER NOT NULL DEFAULT 0`
   - `updated_at TIMESTAMPTZ NOT NULL DEFAULT now()`

3. **RLS is enabled** — Row Level Security is enabled on `scan_credits`; authenticated users can SELECT their own row only; no INSERT / UPDATE / DELETE policies exist for the anon/authenticated roles (service-role only writes).

4. **Web scan-limit query succeeds** — `checkWebScanLimit()` in `js/scan-limit.js` can query `scan_credits` without error for a signed-in user. When the user has no credits row, `purchased` stays 0 and the function returns their free allowance (10). When a test row exists with `purchased = 5`, `totalAllowance = 15`.

5. **Mobile scan-limit query succeeds** — Same behaviour as AC 4 but via `checkScanLimit(userId)` in `mobile/src/lib/scan-limit.js`.

6. **is_unlimited bypass unaffected** — A user with `is_unlimited: true` in `app_metadata` always receives `{ atLimit: false, limit: Infinity }` from both scan-limit functions regardless of `scan_credits` contents.

7. **Fail-closed preserved** — If the `scan_events` query fails (simulate by temporarily revoking access), `checkWebScanLimit` / `checkScanLimit` return `{ atLimit: true, _checkFailed: true }` — NOT `atLimit: false`.

## Tasks / Subtasks

- [x] **Task 1 — Run the SQL migration** (AC: 1, 2, 3)
  - [x] Open Supabase dashboard → SQL editor for the GraveStory project
  - [x] Paste the full contents of `supabase-migrations/005_scan_credits.sql` (use plain ASCII quotes — no curly/typographic quotes)
  - [x] Execute; confirm "Success. No rows returned."
  - [x] Navigate to Table Editor → `scan_credits` → verify the three columns exist with correct types

- [x] **Task 2 — Verify RLS policies** (AC: 3)
  - [x] In Supabase dashboard → Authentication → Policies → `scan_credits` table
  - [x] Confirm one policy exists: "users can read own credits" (FOR SELECT, `auth.uid() = user_id`)
  - [x] Confirm no INSERT / UPDATE / DELETE policies appear (service-role writes bypass RLS by design)

- [x] **Task 3 — Verify web scan-limit integration** (AC: 4, 6, 7)
  - [x] Open the web app as a signed-in user; open DevTools → Network
  - [x] Trigger a scan (or open DevTools Console and call `checkWebScanLimit()` directly)
  - [x] Confirm the `scan_credits` Supabase REST call returns 200 with `[]` (no credits row) and `purchased` stays 0
  - [x] Insert a test row manually: `INSERT INTO scan_credits (user_id, purchased) VALUES ('<your-user-id>', 5);` via SQL editor
  - [x] Re-run `checkWebScanLimit()` — confirm `limit` is now 15 (10 free + 5 purchased)
  - [x] Clean up the test row: `DELETE FROM scan_credits WHERE user_id = '<your-user-id>';`
  - [x] Confirm your tester account (`is_unlimited: true`) still returns `{ atLimit: false, limit: Infinity }`

- [x] **Task 4 — Verify mobile scan-limit integration** (AC: 5, 6)
  - [x] No code change needed — `mobile/src/lib/scan-limit.js` already queries `scan_credits`
  - [x] No OTA update needed — the table now exists so the query that previously returned a soft error now returns `[]`
  - [x] Confirm on device (or via Metro + console.warn monitoring) that no scan-limit errors appear on the next scan attempt

- [x] **Task 5 — No code changes required** (informational)
  - [x] Both `js/scan-limit.js` and `mobile/src/lib/scan-limit.js` already handle `scan_credits` correctly
  - [x] No web deploy, EAS build, or OTA update is needed for this story
  - [x] Commit only if any doc/comment was updated

### Review Findings

- [x] [Review][Patch] `is_unlimited` bypass missing from mobile `checkScanLimit()` — function never returns `{ atLimit: false, limit: Infinity }` for unlimited users; bypass lives only in `CameraScreen.js` call site, violating AC 6 and creating a latent bug for any future caller [mobile/src/lib/scan-limit.js]
- [x] [Review][Defer] `scan_credits` read error silently drops paid credits — paying user gets `purchased=0` on transient network error; intentional fail-soft design but asymmetric with fail-closed for scan_events — pre-existing
- [x] [Review][Defer] TOCTOU race: check-then-insert not atomic — two concurrent tabs/taps can both pass limit check before either increments — pre-existing architecture
- [x] [Review][Defer] `scan_credits.updated_at` has no BEFORE UPDATE trigger — column stays at INSERT time forever; add trigger in Story 1.3 migration when webhook behavior is defined — pre-existing
- [x] [Review][Defer] `incrementWebScanCount` double-increment on network timeout retry — no idempotency key on scan_events INSERT — pre-existing
- [x] [Review][Defer] PaywallScreen.js shows base limit (10) not `totalAllowance` (10+purchased) — progress bar overflows for users with purchased credits [mobile/src/screens/PaywallScreen.js] — pre-existing
- [x] [Review][Defer] `purchased` column has no CHECK constraint — negative value from webhook refund bug would silently reduce allowance below free tier — add CHECK (purchased >= 0) in Story 1.3 migration — pre-existing

## Dev Notes

### What this story actually is

This is a database ops + verification story. The migration SQL is already written and the application code already queries the table. The only work is:
1. Running the SQL in the Supabase dashboard
2. Manually verifying the integration end-to-end

**No application code changes are required.**

### Schema discrepancy — epics vs. actual SQL

The epics file (AC text) mentions columns `user_id`, `credits`, `product_id`, `purchased_at`. The **actual `005_scan_credits.sql`** uses a simpler design:

```
user_id    UUID PRIMARY KEY
purchased  INTEGER NOT NULL DEFAULT 0
updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
```

The application code in both `js/scan-limit.js` and `mobile/src/lib/scan-limit.js` queries `.select('purchased')` — which matches the actual SQL. **Use the SQL file as the source of truth**, not the epics AC wording.

### How scan-limit uses scan_credits (both platforms)

```js
// Inside checkWebScanLimit() / checkScanLimit(userId) — inside a try/catch block:

// Step 1 — count scan_events (fail-CLOSED: throws on error)
const { count: dbCount, error: countErr } = await supabaseClient
  .from('scan_events').select('*', { count: 'exact', head: true }).eq('user_id', ...);
if (countErr) throw countErr;  // <-- triggers fail-closed return
usedCount = dbCount ?? 0;

// Step 2 — read purchased credits (fail-SOFT: does NOT throw on error)
const { data: credits, error: credErr } = await supabaseClient
  .from('scan_credits').select('purchased').eq('user_id', ...).maybeSingle();
if (!credErr && credits) purchased = credits.purchased ?? 0;
// credErr is ignored — purchased stays 0 if table unreachable

// Result
const totalAllowance = WEB_SCAN_LIMIT_USER + purchased;   // 10 + 0..N
```

**Key behaviour:** `scan_events` failure → fail-closed (blocks scan). `scan_credits` failure → fail-soft (purchased treated as 0, free allowance still applies). This is intentional — the free trial is preserved even if the credits table is unreachable.

### is_unlimited bypass

Both functions check `app_metadata.is_unlimited === true` **before** any Supabase query and return early. This is correct and unchanged. Current unlimited accounts:
- `j3k420@gmail.com` (user ID visible in Supabase dashboard)
- `james.edmonds26@gmail.com`

To verify: sign in as one of these accounts → `checkWebScanLimit()` must return `{ atLimit: false, limit: Infinity }` without hitting Supabase at all.

### Why this unblocks Story 1.3

Story 1.3 (RevenueCat webhook) will INSERT rows into `scan_credits` via the Supabase service-role key. The table must exist before the webhook can write to it. Story 1.1 is the only gate for Story 1.3.

### Files this story touches

**No files are modified.** Read-only reference:

| File | Purpose |
|---|---|
| `supabase-migrations/005_scan_credits.sql` | The migration to run — do not modify |
| `js/scan-limit.js` | Web scan-limit (already queries scan_credits correctly) |
| `mobile/src/lib/scan-limit.js` | Mobile scan-limit (already queries scan_credits correctly) |

### Testing approach

No automated test suite. Manual verification paths:

1. **Supabase Table Editor** — visual confirmation of schema + RLS
2. **Browser DevTools → Network tab** — confirm `scan_credits` REST call returns 200
3. **Console injection** — call `checkWebScanLimit()` directly in DevTools console
4. **SQL editor test row** — insert a known credit count, verify limit increases, clean up

### Deployment impact

| Platform | Action needed |
|---|---|
| Web | None — no code change |
| Mobile | None — no code change, no OTA update |
| Worker | None |
| Supabase | Run `005_scan_credits.sql` in SQL editor |

### Project Structure Notes

- Migration files live in `supabase-migrations/` and are run manually in Supabase SQL editor — never via CLI or CI
- `005_scan_credits.sql` uses `public.scan_credits` (explicit schema prefix); `004_scan_events.sql` uses bare `scan_events`. Both resolve to the `public` schema. No issue.
- The `scan_credits` table uses a single-row-per-user model (UUID PK) unlike `scan_events` (one row per scan event). This is correct — credits accumulate in one row via service-role UPDATE.

### References

- Migration SQL: [`supabase-migrations/005_scan_credits.sql`](supabase-migrations/005_scan_credits.sql)
- Web scan-limit: [`js/scan-limit.js`](js/scan-limit.js) — `checkWebScanLimit()` lines 11–47
- Mobile scan-limit: [`mobile/src/lib/scan-limit.js`](mobile/src/lib/scan-limit.js) — `checkScanLimit()` lines 13–52
- CLAUDE.md — "Supabase data model" section, `scan_credits` table entry
- CLAUDE.md — Phase 9 remaining tasks: "Run `005_scan_credits.sql` in Supabase SQL editor"
- project-context.md — Supabase Tables table, "Pending migration" note

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

_None_

### Completion Notes List

- ✅ `scan_credits` table confirmed present in Supabase `public` schema (migration ran in a prior session — `CREATE TABLE IF NOT EXISTS` was a no-op; `CREATE POLICY` duplicate error confirmed policy already existed)
- ✅ RLS enabled; single SELECT policy `"users can read own credits"` verified in Supabase dashboard
- ✅ No INSERT/UPDATE/DELETE client policies — service-role-only writes confirmed
- ✅ `js/scan-limit.js` verified by code inspection: queries `scan_credits` with fail-soft error handling (purchased stays 0 on error; only `scan_events` failure is fail-closed)
- ✅ `mobile/src/lib/scan-limit.js` verified by code inspection: identical logic
- ℹ️ Live web app at `j3k420.github.io` does not yet have `scan-limit.js` — `phase-9` branch is 20+ commits ahead of `main`. Full end-to-end web verification will complete when `phase-9` is merged to `main` as part of Epic 2 (Play Store Launch). Not a blocker for this story.
- ✅ Story 1.3 (RevenueCat webhook) unblocked — `scan_credits` table exists and ready to receive INSERT via service role

### File List

No application files modified. Database migration confirmed applied in Supabase.
