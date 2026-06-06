# GraveStory — Project Context

> This file is loaded by all BMAD agents. It is the authoritative source for conventions,
> patterns, and constraints. The full technical spec lives in `CLAUDE.md`.

---

## What this is

A mobile-first PWA and React Native app for cemetery visitors. You photograph a gravestone; the app uses Gemini AI to OCR the stone, searches genealogy databases (Tavily, WikiTree, Wikidata, Chronicling America, Wikipedia), and generates a biographical story. Users can save, share, and view stories on per-cemetery maps. Signed-in users can publish to a community global map.

**Platform:** Web (GitHub Pages static deploy) + Android/iOS (Expo managed workflow, EAS build).

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
index.html          — Web SPA shell: ALL screen markup + core state + pipeline orchestration
js/                 — Web JS modules (classic scripts, leaf-first load order in index.html)
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

## The web pipeline (`startAnalysis` in `index.html`)

1. `verifyIsGravestone(base64)` — Gemini preflight; throws `{ __verificationRejection: true }` on failure
2. `reverseGeocode(lat, lng)` — GPS → "City, State" string (runs in parallel with step 1 if GPS available)
3. `readGravestone(base64, locationHint)` — Gemini OCR → structured JSON
4. `incrementWebScanCount()` — counts the scan in Supabase (or localStorage for guests)
5. Parallel: `searchForPerson` + `searchWikiTree` + `queryWikidata` + `searchChroniclingAmerica` + `fetchWikipediaArticleSummary` + `fetchWikipediaPortraits`
6. `generateBiography(...)` — Gemini narrative (or stone-only fallback if no sources found)
7. Portrait retry if needed (single-token names)
8. `forwardGeocode(...)` — refines GPS to cemetery center or grave node
9. `findOrCreateGrave(...)` — Supabase RPC, deduplicates physical stones by ~20m
10. Save flow

The mobile pipeline in `CameraScreen.js` mirrors this exactly. **Changes to pipeline logic must be applied to BOTH platforms.**

---

## Critical conventions

### HTML escaping (XSS prevention)
**ALL AI-generated or user-sourced data injected into `innerHTML` MUST pass through `escapeHtml()` first.** This includes: name, dates, location, biography text, source descriptions, source URLs, image URLs, contributor names.

- `escapeHtml()` is in `js/util-html.js` (web) — globally available to all classic scripts
- Map popups especially: both `buildGlobalPopup()` (map-global.js) and `buildPopupBio()` (map-cemetery.js) escape all fields
- **Never embed story objects as JSON in `onclick` attributes** — use a module-level lookup keyed by a safe primitive, resolve at click time via a named function (see `_cemeteryStoryCache` + `viewCemeteryStory()` in map-cemetery.js as the established pattern)

### Cloudflare Worker auth (two layers)
1. **ALLOWED_ORIGIN** env var (`"https://j3k420.github.io"`) — blocks cross-origin browser requests
2. **CLIENT_KEY** Wrangler secret (`gs-client-2025`) — all proxy fetch calls include `X-Client-Key: CLIENT_KEY` header; blocks direct API calls without Origin header (mobile app, curl, scrapers)
   - Web: `CLIENT_KEY` constant in `js/config.js`
   - Mobile: `CLIENT_KEY` export from `mobile/src/lib/config.js`

### Supabase on mobile
**Do NOT use `.catch()` on Supabase query builder results on mobile.** Hermes JS engine doesn't support it. Always use `try { await supabase... } catch (e) {}`.

### Scan/save limits (freemium)
- **Web**: `js/scan-limit.js` — `checkWebScanLimit()` (fail-closed on Supabase error) gates `startAnalysis()`; `checkWebSaveLimit()` gates `saveStory()`
- **Mobile**: `mobile/src/lib/scan-limit.js` — same logic; `checkScanLimit()` fail-closed; `CameraScreen` checks before opening picker
- Guest: 3 lifetime scans / 3 saves. Free signed-in: 10 lifetime scans / 10 saves. `is_unlimited: true` in `app_metadata` bypasses all limits (testers only, set via Supabase SQL).
- Credits model: `scan_credits` table (Supabase). Starter 5/$0.99, Explorer 20/$2.99, Historian 60/$6.99.

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
| Web | Push to `main` → GitHub Pages auto-deploys |
| Worker | `cd worker && wrangler deploy` |
| Mobile preview APK | `npx eas build --platform android --profile preview` |
| Mobile phase-9 test build | `npx eas build --platform android --profile phase9` |
| Mobile OTA update | `npx eas update --branch preview` |

---

## Current state (Phase 9, branch `phase-9`)

**Done:** Grave photo gallery, biography cache, freemium limits (web + mobile), device fingerprinting, portrait persistence, global map portraits, RevenueCat SDK (disabled pending Play Store), security hardening (XSS fixes, web limits, Worker CLIENT_KEY + model allowlist).

**Remaining before Play Store launch:**
- Run `005_scan_credits.sql` in Supabase SQL editor
- Privacy policy page hosted at `https://j3k420.github.io/gravestory-privacy` + link in Settings
- RevenueCat webhook (Cloudflare Worker endpoint) + re-enable SDK after Play Store account
- Store listing assets (screenshots, feature graphic, descriptions)
- Google Play account ($25), EAS credentials (`npx eas credentials`), production build + submission
