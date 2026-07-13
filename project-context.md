# GraveStory — Project Context

> This file is loaded by all BMAD agents. It is the authoritative source for conventions,
> patterns, and constraints. The full technical spec lives in `CLAUDE.md`.

---

## What this is

A mobile app for cemetery visitors plus a thin public web landing/map/bio surface. In the app, you photograph a gravestone; Gemini OCR and genealogy searches generate a biographical story. Users can save, share, map, and optionally publish stories to the community global map.

**Platform:** Web landing/map/bio surface (Cloudflare Pages Direct Upload) + Android/iOS (Expo managed workflow, EAS build).

---

## Tech stack — hard constraints

| Layer | Technology | Constraint |
|---|---|---|
| Web UI | Vanilla HTML/CSS/JS | **No framework. No build step. No TypeScript. No npm.** Static files only. |
| Web scripts | Classic `<script src>` tags | **No ES modules on web.** Use `function` declarations, not `const fn =`. |
| Mobile | Expo SDK 54, React Navigation v7 | Managed workflow — no bare ejection. |
| Mobile scripts | ES modules (`import`/`export`) | Opposite of web — always use ES modules in `mobile/src/`. |
| AI | Google Gemini via Cloudflare Worker | All Gemini calls go through `PROXY_BASE`. Never call Gemini directly from the client. |
| Search | Tavily via Cloudflare Worker | Same proxy. 6 query cap per scan, max_results:2. |
| Genealogy | WikiTree, Wikidata SPARQL, Chronicling America | WikiTree via proxy; Wikidata + Chronicling America are direct (CORS-open, free). |
| Auth | Supabase (Google OAuth + email) | Supabase anon key is public by design. Security enforced by RLS policies. |
| DB | Supabase PostgreSQL | Soft-delete only (`deleted_at`). Never hard-delete stories rows. |
| Storage | Cloudflare R2 via Worker proxy | Worker code lives at `worker/worker.js`. Deploy with `cd worker && wrangler deploy`. |
| Maps | Leaflet 1.9.4 (web), react-native-maps (mobile) | Web: Leaflet + Turf.js via CDN. Mobile: Apple Maps iOS, Google Maps Android. |

---

## Repository layout

```
index.html          — Web landing page, community global map, and read-only public-bio shell
js/                 — Surviving read-only web/map/reporting scripts (classic scripts)
css/                — One CSS file per screen/component
mobile/             — Expo React Native app (separate codebase, do NOT mix with web)
  src/lib/          — Shared utilities and API clients (ES modules)
  src/screens/      — Screen components
  src/components/   — Reusable UI components
worker/             — Cloudflare Worker proxy (worker.js + wrangler.toml)
_bmad/              — BMAD-METHOD install (agents, skills, config)
_bmad-output/       — BMAD artifacts (PRDs, architecture docs, stories)
supabase-migrations/— SQL migration files (run manually in Supabase SQL editor)
```

---

## Product pipeline boundary

The scan, OCR, research, biography, save, and account-write pipeline lives only in `mobile/src/`, orchestrated by `CameraScreen.js`. The former web pipeline was deleted during the landing-page conversion; do not restore it or port mobile pipeline changes to web. Coordinate changes across platforms only when they affect the surviving community global-map or read-only public-bio behavior.

---

## Critical conventions

### HTML escaping (XSS prevention)
**ALL AI-generated or user-sourced data injected into `innerHTML` MUST pass through `escapeHtml()` first.** This includes: name, dates, location, biography text, source descriptions, source URLs, image URLs, contributor names.

- `escapeHtml()` is in `js/util-html.js` (web) — globally available to all classic scripts
- Map popups especially: both `buildGlobalPopup()` (map-global.js) and `buildPopupBio()` (map-cemetery.js) escape all fields
- **Never embed story objects as JSON in `onclick` attributes** — use a module-level lookup keyed by a safe primitive, resolve at click time via a named function (see `_cemeteryStoryCache` + `viewCemeteryStory()` in map-cemetery.js as the established pattern)

### Cloudflare Worker auth (two layers)
1. **ALLOWED_ORIGIN** env var (`"https://gravestory.pages.dev,https://j3k420.github.io"` during cutover) — blocks cross-origin browser requests; remove the legacy origin only after explicit retirement approval
2. **CLIENT_KEY** Wrangler secret (`gs-client-2025`) — all proxy fetch calls include `X-Client-Key: CLIENT_KEY` header; blocks direct API calls without Origin header (mobile app, curl, scrapers)
   - Web: `CLIENT_KEY` constant in `js/config.js`
   - Mobile: `CLIENT_KEY` export from `mobile/src/lib/config.js`

### Supabase on mobile
**Do NOT use `.catch()` on Supabase query builder results on mobile.** Hermes JS engine doesn't support it. Always use `try { await supabase... } catch (e) {}`.

### Scan/save limits (freemium)
- **Web**: `js/scan-limit.js` — `checkWebScanLimit()` (fail-closed on Supabase error) gates `startAnalysis()`; `checkWebSaveLimit()` gates `saveStory()`
- **Mobile**: `mobile/src/lib/scan-limit.js` — same logic; `checkScanLimit()` fail-closed; `CameraScreen` checks before opening picker
- Guest: **0 scans** (must sign in to scan; can browse the app + community global map and read public bios without an account). Free signed-in: **3 lifetime scans** (lowered from 10, S66). `is_unlimited: true` in `app_metadata` bypasses all limits (testers only, set via Supabase SQL).
- Credits model: `scan_credits` table (Supabase). Starter 5/$1.99, Explorer 20/$5.99, Historian 60/$12.99, Legacy 150/$24.99 (premium set + Legacy gift tier, 2026-06-13; prices live from Play Console via RevenueCat, no code change; new product IDs also need a worker `CREDIT_MAP` entry).

### Pull-to-refresh (mobile)
All 8 mobile screens use `useRefresh(callback)` from `mobile/src/lib/use-refresh.js`. **Never add inline `[refreshing, setRefreshing]` state** — use the hook.

### Mobile storage isolation
`loadStories(userId)` / `saveStories(stories, userId)` in `mobile/src/lib/storage.js` use per-user AsyncStorage keys. **Always pass userId.** Never call without a userId argument.

### Log discipline
`console.warn` only for genuine failure paths. No data-dump debug logs in production code.

### `_isGlobal` flag
Stories fetched from the community global map have `_isGlobal: true`. This controls tribute button visibility (own camera-sourced stories only), portrait fetch behavior (live fetch vs stored URI), and gallery rendering.

---

## Supabase tables

| Table | Purpose |
|---|---|
| `stories` | Core: one row per saved biography. Soft-delete via `deleted_at`. |
| `graves` | One row per physical stone, deduped by ~20m name-match. `find_or_create_grave` RPC. |
| `tributes` | Candle/flower per user per grave. `UNIQUE(grave_id, user_id)`. |
| `grave_photos` | Multiple photos per grave. FK to `grave_id`. |
| `scan_events` | Immutable INSERT-only rows counting lifetime scans. RLS: INSERT/SELECT only. |
| `scan_credits` | Purchased scan credits. Service-role write only. |

**Pending migration:** `005_scan_credits.sql` — must be run in Supabase SQL editor before credits purchase flow works.

---

## What NOT to do

- Do not add TypeScript, bundlers, or npm to the web codebase
- Do not use ES module `import`/`export` in web JS files
- Do not call Gemini, Tavily, or WikiTree directly from the client (all go through the Worker proxy)
- Do not add the Cloudflare Worker URL as a hardcoded string anywhere except `js/config.js` and `mobile/src/lib/config.js` — use `PROXY_BASE`
- Do not add boundary polygon drawing to the mobile cemetery map (was removed — Nominatim polygon_geojson produced wrong boundaries)
- Do not use `<Callout>` from react-native-maps for custom content (touch events silently broken on Android — use state-driven floating overlay instead)
- Do not use `tracksViewChanges={false}` unconditionally on mobile map markers (SVG won't render)
- Do not hard-delete from the `stories` table — always use soft-delete (`deleted_at`)
- Do not inject AI-generated text into innerHTML without `escapeHtml()`

---

## Deployment

| Target | Command |
|---|---|
| Web | Stage the 22-file allowlisted bundle, then `npx wrangler pages deploy <staging-dir> --project-name gravestory` (manual Direct Upload; see `docs/cloudflare-pages-cutover.md`) |
| Worker | `cd worker && wrangler deploy` |
| Mobile preview APK | `npx eas build --platform android --profile preview` |
| Mobile phase-9 test build | `npx eas build --platform android --profile phase9` |
| Mobile OTA update | From `mobile/`: verify clean source + `production` channel, then `npx eas update --branch production --environment production --platform android` |

---

## Current state (Cloudflare URL cutover, 2026-07-13)

**Done:** The Android app is live, the web scan pipeline has been retired, and the landing page/global map/read-only bio surface is live at `https://gravestory.pages.dev/`. Source cache is `gravestory-v69`; Pages remains v68 until the reviewed bundle is redeployed.

**Cutover still gated:**
- Publish and verify the URL-only mobile Settings OTA from the latest baseline.
- Update Google Play's privacy-policy URL, account-deletion URL, full description, and store-listing website; then verify the public listing.
- Keep GitHub Pages enabled and the repository public until those checks pass.
- Keep both Cloudflare Pages and GitHub Pages in the Worker origin allowlist during the overlap.
- Follow `docs/cloudflare-pages-cutover.md`; disabling the old site, privatizing the repository, or removing the legacy Worker origin requires explicit owner approval.
