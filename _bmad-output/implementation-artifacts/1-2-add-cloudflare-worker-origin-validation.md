---
baseline_commit: 4d25eab
---

# Story 1.2: Add Cloudflare Worker Origin Validation

Status: done

## Story

As a product owner,
I want the Cloudflare Worker to reject requests from unauthorised origins,
so that third parties cannot consume GraveStory's Gemini and Tavily API quotas.

## Acceptance Criteria

1. **Allowed origin passes** — A browser request with `Origin: https://j3k420.github.io` is processed normally (upstream API call is made, 200 returned to client).

2. **Disallowed origin blocked** — A browser request with any other `Origin` header value receives HTTP 403 and no upstream API call is made.

3. **CLIENT_KEY path unaffected** — A mobile/direct request with no `Origin` header but a valid `X-Client-Key` header is processed normally.

4. **Env-var driven, not hardcoded** — `ALLOWED_ORIGIN` env var controls which origin is allowed; the value `"https://j3k420.github.io"` in `wrangler.toml [vars]` is used, not a hardcoded string in source.

5. **Deployed and live** — After `cd worker && wrangler deploy` the checks are active on the production Worker at `https://gravestory-proxy.<account>.workers.dev`.

## Tasks / Subtasks

- [x] **Task 1 — Code review: confirm logic already correct** (AC: 1, 2, 3, 4)
  - [x] Read `worker/worker.js` lines 65–88 — verify the auth block handles all three cases: allowed === `*` (skip), origin present and in list (allow), origin present and not in list (403), no origin + valid CLIENT_KEY (allow), no origin + missing/wrong CLIENT_KEY (403)
  - [x] Read `worker/wrangler.toml` — confirm `ALLOWED_ORIGIN = "https://j3k420.github.io"` in `[vars]` block and is NOT `"*"`
  - [x] Confirm the `corsHeaders()` helper returns the matching origin only when the origin is in the allowlist (not wildcard `*`) — prevents XSS via permissive CORS

- [x] **Task 2 — Deploy the Worker** (AC: 5)
  - [x] From the project root, run: `cd worker && wrangler deploy`
  - [x] Confirm deploy output shows "Uploaded gravestory-proxy" and the worker version URL
  - [x] Verify no wrangler errors about missing secrets (`GEMINI_KEY`, `TAVILY_KEY`, `CLIENT_KEY` are Wrangler secrets set via `wrangler secret put` — they are not in wrangler.toml and do not need re-adding unless rotated)

- [x] **Task 3 — Verify origin enforcement on deployed Worker** (AC: 1, 2, 3)
  - [x] **Test allowed origin (AC 1):** `curl` with `Origin: https://j3k420.github.io` → HTTP 200, real Tavily response returned ✓
  - [x] **Test disallowed origin (AC 2):** `curl` with `Origin: https://evil.com` → HTTP 403 ✓
  - [x] **Test no-origin + valid CLIENT_KEY (AC 3):** `curl` with `X-Client-Key: gs-client-2025`, no Origin → HTTP 200, real Tavily response ✓
  - [x] **Test no-origin + no key:** `curl` with no Origin, no key → HTTP 403 ✓

- [x] **Task 4 — Smoke-test web app end-to-end** (AC: 1, 5)
  - [x] Open `https://j3k420.github.io/Gravestory/` in browser → performed a full scan
  - [x] Network tab confirmed all Tavily Worker requests returned 200; preflight returned 204; no 403s

## Dev Notes

### What this story actually is

The origin validation logic is **already fully implemented** in `worker/worker.js` and `ALLOWED_ORIGIN` is **already set to the correct production value** in `wrangler.toml`. The code satisfies all ACs.

This story is a **deploy and verify** story. No code changes to `worker.js` are required unless the code review in Task 1 reveals a defect.

Compare with Story 1.1 (run DB migration) — the work here is confirmation + deployment, not implementation.

### Current origin check logic (worker.js lines 65–88)

```javascript
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
```

Priority: if `ALLOWED_ORIGIN === "*"` → skip all checks (local dev only). Otherwise: origin present → must be in list; no origin → must supply CLIENT_KEY.

### ALLOWED_ORIGIN configuration (wrangler.toml)

```toml
[vars]
ALLOWED_ORIGIN = "https://j3k420.github.io"
```

- `allowed` becomes `["https://j3k420.github.io"]` (single-element array from comma-split)
- `allowed.includes("https://j3k420.github.io")` → `true` → allow
- `allowed.includes("https://evil.com")` → `false` → 403
- Multiple origins can be added as a comma-separated string if needed (e.g. `"https://j3k420.github.io,http://localhost:5500"`)

### CORS preflight behaviour for disallowed origins

For a `OPTIONS` preflight from `https://evil.com`, the Worker returns 204 with `Access-Control-Allow-Origin: https://j3k420.github.io`. The browser sees the ACAO doesn't match its own origin and blocks the actual POST request. The actual POST then gets a 403 from the auth block. Both layers independently prevent the cross-origin request — this is correct.

### Wrangler secrets

The following secrets are stored in Wrangler (NOT in wrangler.toml) and do not need to be changed for this story:

| Secret | Purpose |
|---|---|
| `GEMINI_KEY` | Google Gemini API key |
| `TAVILY_KEY` | Tavily search API key |
| `CLIENT_KEY` | Shared key for mobile/direct requests (`X-Client-Key` header) |

If any of these are missing, the relevant handler returns 500 with a descriptive error. This is a pre-existing configuration concern, not a Story 1.2 issue.

### Why the Worker subdomain URL matters for testing

The deployed Worker is accessible at `https://gravestory-proxy.<account-subdomain>.workers.dev`. The `CLIENT_KEY` is in `js/config.js` (web) and `mobile/src/lib/config.js` (mobile) — use its value for the curl test in Task 3.

### Files touched

| File | Action | Purpose |
|---|---|---|
| `worker/worker.js` | READ-ONLY (verify) | Origin check logic already present |
| `worker/wrangler.toml` | READ-ONLY (verify) | ALLOWED_ORIGIN already set |

**No application files need modification.** No web deploy, EAS build, or OTA update is needed for this story — it only affects the Cloudflare Worker layer.

### Testing approach

No automated test suite. Manual verification via:
1. `curl` for negative cases (disallowed origin → 403, no key → 403)
2. Browser DevTools Network tab for positive cases (j3k420.github.io origin → 200)
3. Full scan smoke-test on production web app

### Deployment command

```sh
cd worker
wrangler deploy
```

Must be run from `worker/` (where `wrangler.toml` is). Requires `wrangler` CLI installed and authenticated (`wrangler login`).

### Project Structure Notes

- `worker/worker.js` — Cloudflare Worker source; classic ESM (`export default`); deployed by wrangler
- `worker/wrangler.toml` — Worker config: name, vars, R2 binding, compatibility date
- Worker secrets stored outside the repo (Wrangler secrets store) — do not commit secrets
- Web client config: `js/config.js` (PROXY_BASE URL only)
- Mobile client config: `mobile/src/lib/config.js` (same PROXY_BASE)

### References

- Origin check implementation: [`worker/worker.js` lines 65–88](worker/worker.js#L65-L88)
- ALLOWED_ORIGIN config: [`worker/wrangler.toml` lines 7–10](worker/wrangler.toml#L7-L10)
- CORS headers helper: [`worker/worker.js` lines 354–370](worker/worker.js#L354-L370)
- NFR-S2 (Worker origin + CLIENT_KEY enforcement): [CLAUDE.md — Cloudflare Worker security note]
- CLAUDE.md Phase 9 remaining: "Cloudflare Worker origin check — add Origin header validation..."

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6

### Debug Log References

_None_

### Completion Notes List

- ✅ Task 1 — Code review: `worker/worker.js` auth block confirmed correct; `ALLOWED_ORIGIN = "https://j3k420.github.io"` in `wrangler.toml` (not `*`); `corsHeaders()` never returns wildcard when allowlist is configured
- ✅ Task 2 — Worker deployed: `wrangler deploy` succeeded; version `b8059eeb-5c70-4707-ac76-b157a26a4dab` live at `https://gravestory-proxy.james-gravestory.workers.dev`
- ✅ Task 3 — All four curl cases confirmed on deployed Worker:
  - `Origin: https://j3k420.github.io` → 200 (real Tavily response)
  - `Origin: https://evil.com` → 403 `{"error":"Forbidden origin"}`
  - No Origin + `X-Client-Key: gs-client-2025` → 200 (real Tavily response)
  - No Origin + no key → 403 `{"error":"Forbidden"}`
- ✅ Task 4 — Browser smoke-test at `https://j3k420.github.io/Gravestory/`: full scan pipeline ran, all Tavily Worker requests returned 200, preflight 204, no 403s in Network tab

### File List

No application files modified. Worker redeployed with existing origin check active.
