# Deferred Work

## Deferred from: code review of 1-1-run-scan-credits-database-migration (2026-06-05)

- **scan_credits read error silently drops paid credits** — paying user gets `purchased=0` on transient network error; intentional fail-soft design but asymmetric with fail-closed behaviour for scan_events. Revisit when credits are live and user-reported failures surface.
- **TOCTOU race on check-then-insert** — two concurrent browser tabs or rapid taps can both pass the scan limit check before either increments the counter. Fix requires an atomic DB function (INSERT INTO scan_events RETURNING count > limit). Track for post-launch hardening.
- **scan_credits.updated_at has no BEFORE UPDATE trigger** — column stays at INSERT time forever. Add `CREATE OR REPLACE FUNCTION update_scan_credits_updated_at()...` trigger in Story 1.3's migration when the webhook behavior is defined.
- **incrementWebScanCount double-increment on retry** — network timeout after server write causes a second INSERT, over-counting one scan. Fix: pass a client-generated UUID as the scan_events primary key so retries are idempotent.
- **PaywallScreen.js shows base limit (10) not totalAllowance** — progress bar and count text overflow for users with purchased credits. Fix: use `route.params.limit` (already passed by CameraScreen as `scanCheck.limit`) instead of re-deriving from the SCAN_LIMIT_USER constant. [mobile/src/screens/PaywallScreen.js]
- **purchased column has no CHECK constraint** — a negative value from a webhook refund bug would silently reduce allowance below the free tier. Add `CHECK (purchased >= 0)` in Story 1.3's migration DDL or a separate follow-up migration.
