---
project_name: 'GraveStory'
user_name: 'James'
date: '2026-06-05'
sections_completed:
  ['technology_stack', 'language_rules', 'framework_rules', 'testing_rules', 'quality_rules', 'workflow_rules', 'anti_patterns']
status: 'complete'
optimized_for_llm: true
---

# GraveStory — Project Context for AI Agents

> Critical rules and patterns AI agents must follow. Unobvious details only — not general knowledge.
> Full technical spec: `CLAUDE.md`. Authoritative conventions: this file.

---

## What this is

Mobile-first PWA + React Native app for cemetery visitors. Photo a gravestone → Gemini AI OCRs it → searches genealogy databases → generates a biographical story. Users save, share, and view stories on per-cemetery maps. Signed-in users can publish to a community global map.

**Platform:** Web (GitHub Pages, static deploy) + Android/iOS (Expo managed workflow, EAS build).

---

## Technology Stack & Versions

### Web (static, no build)
- Vanilla HTML/CSS/JS — no framework, no TypeScript, no npm, no bundler
- Leaflet 1.9.4 + Turf.js 7 (CDN)
- Supabase JS v2 (CDN)

### Mobile (Expo managed workflow)
- Expo SDK ~54.0.0
- React 19.1.0 / React Native 0.81.5
- React Navigation v7 (native-stack)
- react-native-maps 1.20.1
- react-native-svg 15.12.1
- react-native-safe-area-context ~5.6.0
- @supabase/supabase-js ^2.106.2
- @react-native-async-storage/async-storage 2.2.0
- expo-crypto ~15.0.9 (polyfill — must be first import)
- expo-file-system ~19.0.23 (portrait persistence)
- expo-image-manipulator ~14.0.8
- expo-image-picker ~17.0.11
- expo-location ~19.0.8
- expo-updates ~29.0.18 (OTA)
- react-native-purchases ^10.2.2 (RevenueCat — currently disabled)

### Backend / External
- Cloudflare Worker (proxy for Gemini, Tavily, WikiTree, R2)
- Supabase PostgreSQL (auth + DB + storage)
- Cloudflare R2 (gravestone image storage)
- Google Gemini (primary: `gemini-3.1-flash-lite`, fallback: `gemini-2.5-flash`)
- Tavily search API (6 queries/scan cap, max_results:2)
- Wikidata SPARQL, Chronicling America (direct — CORS-open, no proxy needed)
- Nominatim + Overpass (web geocoding), Nominatim + Photon (mobile)

---

## Repository Layout

```
index.html          — Web SPA: ALL screen markup + core state + pipeline orchestration
js/                 — Web JS modules (classic scripts, leaf-first load order in index.html)
css/                — One CSS file per screen/component
mobile/             — Expo React Native app (separate codebase — do NOT mix with web)
  src/lib/          — Shared utilities and API clients (ES modules)
  src/screens/      — Screen components
  src/components/   — Reusable UI components
worker/             — Cloudflare Worker proxy (worker.js + wrangler.toml)
_bmad/              — BMAD-METHOD install
_bmad-output/       — BMAD artifacts (this file lives here)
supabase-migrations/— SQL migration files (run manually in Supabase SQL editor)
```

---

## Language-Specific Rules

### Web JS — classic scripts, NOT ES modules
- All web JS files load as `<script src>` — **no `import`/`export` ever**
- Use `function` declarations (not `const fn = ...`) for anything called from HTML `onclick` or other modules — they auto-attach to `window`
- Load order in `index.html` IS the dependency graph: `config.js` first, leaf utilities before callers, `auth.js` after the Supabase CDN tag
- Pipeline state (`currentStory`, `savedStories`, `currentImage`, etc.) and orchestration (`startAnalysis`, `showScreen`, `handleImageUpload`) live in the inline `<script>` block in `index.html` — extracted modules share that lexical scope; they do NOT receive these as arguments

### Mobile JS — ES modules
- All `mobile/src/` files use `import`/`export` — opposite convention from web
- `polyfills.js` MUST be the first import in `index.js` — patches `globalThis.crypto` for Hermes before any Supabase/PKCE code runs
- **Do NOT use `.catch()` on Supabase query builder chains** — Hermes doesn't support it. Always `try { await supabase... } catch (e) {}`

### Both platforms
- No TypeScript anywhere — web or mobile
- `safeParseJSON` is the only safe way to parse Gemini responses — never bare `JSON.parse`
- `console.warn` only on genuine failure paths — no data-dump debug logs

---

## Framework-Specific Rules

### React Native / Expo (mobile)

**SafeAreaView**
- Always import from `react-native-safe-area-context`, NOT `react-native`
- Map screens (`CemeteryMapScreen`, `GlobalMapScreen`) use `edges={['top']}` — bottom inset is NOT handled by SafeAreaView. Both must import `useSafeAreaInsets` and apply `paddingBottom: insets.bottom + 8` to the bottom panel View manually.

**Maps — never use `<Callout>` for custom content**
- `react-native-maps` `<Callout onPress>` with custom Views silently swallows touch events on Android. Both map screens use a state-driven `View` overlay: tapping a marker sets `selectedStory` state; tapping the map or ✕ dismisses. Do not replace with `<Callout>`.

**Custom map markers — `tracksViewChanges`**
- `GraveMarker` starts with `tracksViewChanges={true}`, flips to `false` via `onLayout`. Do NOT set `tracksViewChanges={false}` unconditionally — SVG won't render on the native map.

**Pull-to-refresh**
- All 8 screens use `useRefresh(callback)` from `mobile/src/lib/use-refresh.js`
- Returns `{ refreshControl }` — pass directly to `ScrollView`/`FlatList`
- Never add inline `[refreshing, setRefreshing]` state

**Design system**
- All screens import colors, fonts, radius from `mobile/src/lib/theme.js` only
- Never hardcode color hex values or font family strings in screen files
- `SafeAreaView` background must use `colors.ink` (`#14100b`)

**Storage isolation**
- `loadStories(userId)` / `saveStories(stories, userId)` always require userId
- Signed-in key: `gs_stories_{userId}`; guest key: `gs_stories_guest`
- Never call without userId — silently reads the wrong bucket

### Web (Vanilla JS patterns)

**Screen routing**
- `showScreen(name)` is the only way to switch screens — never manipulate `display` CSS directly
- `VALID_SCREENS` array gates hash routing — new screens must be added to it
- `renderSavedList()` is called by `showScreen()` when navigating to `'remembered-stories'` — do not call it on home screen init

**Map popup XSS**
- `buildGlobalPopup()` and `buildPopupBio()` must escape all story fields via `escapeHtml()` before template-literal injection
- Story objects are NEVER serialized into `onclick` attributes — use `_cemeteryStoryCache[key]` + `viewCemeteryStory(key)` pattern

**Gemini calls**
- Primary: `gemini-3.1-flash-lite`; auto-fallback to `gemini-2.5-flash` on HTTP 503/429, network errors, or overload response bodies
- All calls use `temperature: 0.1`; all prompts return JSON only — parse via `safeParseJSON` with a default object

---

## The Pipeline (web: `startAnalysis` in `index.html` / mobile: `CameraScreen.js`)

Both platforms mirror each other exactly. Changes to pipeline logic MUST be applied to BOTH.

1. `verifyIsGravestone(base64)` — throws `{ __verificationRejection: true }` on failure
2. `reverseGeocode(lat, lng)` — GPS → "City, State" (runs in parallel with step 1)
3. `readGravestone(base64, locationHint)` — Gemini OCR → structured JSON with `name_confidence`, `alternate_names`, `multiple_subjects`
4. `incrementWebScanCount()` / `incrementScanCount()` — counts the scan
5. Parallel: `searchForPerson` + `searchWikiTree` + `queryWikidata` + `searchChroniclingAmerica` + `fetchWikipediaArticleSummary` + `fetchWikipediaPortraits`
6. `generateBiography(graveData, searchResults, wikiData, location, wikipediaSummary, wikidataResult)`
7. Portrait retry if step 5 returned empty (single-token OCR names)
8. `forwardGeocode(location, primary_name, dates)` — refines GPS to cemetery/grave node
9. `findOrCreateGrave(primaryName, lat, lng, isPublic)` — Supabase RPC, ~20m dedup (signed-in + GPS only)
10. Save flow

---

## Supabase Tables

| Table | Purpose |
|---|---|
| `stories` | Core: one row per saved biography. Soft-delete via `deleted_at`. |
| `graves` | One row per physical stone, deduped ~20m. `find_or_create_grave` RPC. |
| `tributes` | Candle/flower per user per grave. `UNIQUE(grave_id, user_id)`. |
| `grave_photos` | Multiple photos per grave. FK to `grave_id`. |
| `scan_events` | Immutable INSERT-only rows counting lifetime scans. RLS: INSERT/SELECT only. |
| `scan_credits` | Purchased scan credits. Service-role write only. |

**Pending migration:** `005_scan_credits.sql` — must be run in Supabase SQL editor before credits purchase flow works.

---

## Testing Rules

**No automated test suite.** No Jest, Vitest, or test runner configured. Do not generate test files unless explicitly asked.

### Manual verification paths
1. Full scan pipeline: photo → verify → OCR → search → bio → save
2. Freemium gate: guest 3-scan limit, signed-in 10-scan limit, fail-closed on Supabase error
3. Map screens: cemetery map pin placement, global map dedup by `grave_id`
4. Auth flows: email sign-up/in, Google OAuth (**requires real EAS build — not Expo Go**)
5. Sync: sign-in pulls all cloud stories; delta sync on HomeScreen focus

### Deployment for testing
- Web: push to `main` → GitHub Pages auto-deploys
- Mobile: `npx eas update --branch preview` for OTA JS-only changes to testers with APK installed
- New native modules require a full `npx eas build --platform android --profile preview`

---

## Code Quality & Style Rules

**No linter or formatter configured** — style enforced by convention.

### Naming
- Web JS files: `kebab-case.js` (e.g. `api-gemini.js`, `util-html.js`)
- Mobile screens: `PascalCase.js` (e.g. `CameraScreen.js`)
- Mobile lib files: `kebab-case.js` (e.g. `use-refresh.js`, `api-gemini.js`)
- CSS files: `kebab-case.css`, one per screen/component
- Functions: camelCase; Constants: UPPER_SNAKE_CASE

### Comments
- Default: no comments. Only add when the WHY is non-obvious (hidden constraint, workaround, subtle invariant). Never explain WHAT the code does. No multi-line comment blocks.
- Each new extracted web JS module needs a header block: public API, external symbols consumed, load-order requirements, timing-safety audit.

### CSS (web)
- One file per screen/component; global custom properties in `base.css` only
- No preprocessor; design language: `#1a1410` bg, `#c9a84c` gold, `#e8d4a0` cream

### Dual-platform rule
Any change to pipeline logic, API modules, or biography generation MUST be applied to BOTH `js/` (web) and `mobile/src/lib/` (mobile).

---

## Development Workflow Rules

### Git
- Commit and push at the end of every session — no uncommitted work
- Branch naming: `phase-N` (current: `phase-9`); main branch: `main`
- Conventional commits: `feat:`, `fix:`, `docs:`, `chore:`, `security:`, `refactor:`

### Deployment

| Target | Command |
|---|---|
| Web | Push to `main` → GitHub Pages auto-deploys |
| Worker | `cd worker && wrangler deploy` |
| Mobile dev | `npx expo start` + `adb reverse tcp:8081 tcp:8081` |
| Mobile tester APK | `npx eas build --platform android --profile preview` |
| Mobile OTA update | `npx eas update --branch preview` |
| Mobile production AAB | `npx eas build --platform android --profile production` |

- OTA updates push JS-only changes without a new build — use for all non-native changes after testers have the APK
- Native module changes require a new EAS build

### Supabase migrations
- SQL files in `supabase-migrations/` — run manually in Supabase SQL editor only
- Use plain ASCII quotes in SQL — no curly/typographic quotes

### Secrets
- `PROXY_BASE` is the only client config — `js/config.js` (web) and `mobile/src/lib/config.js` (mobile)
- All other keys are Wrangler secrets or EAS Secrets — never committed to source
- RevenueCat API key must be an EAS Secret

---

## Critical Don't-Miss Rules

### Security — non-negotiable
- **ALL** AI-generated or user-sourced data injected into `innerHTML` MUST pass through `escapeHtml()` first — name, dates, location, bio text, source URLs, image URLs, contributor names
- Never embed story objects as JSON in `onclick` attributes — use module-level lookup + named function
- Never call Gemini, Tavily, or WikiTree directly from the client — always via `PROXY_BASE`
- Never hardcode `PROXY_BASE` anywhere except the two config files

### Data integrity
- Never hard-delete from `stories` — always soft-delete via `deleted_at`
- `findOrCreateGrave` only fires when user is signed in AND `resolvedGps` is non-null — non-fatal if it fails
- Scan limit checks are **fail-closed** — on Supabase error, block the scan (never allow). `checkWebScanLimit` and mobile `checkScanLimit` both return `atLimit: true` on error.

### Platform separation
- Do NOT touch web files when working on mobile, and vice versa
- Do NOT share code between web and mobile via imports — parallel codebases, separate module systems

### Mobile traps
- Google OAuth does NOT work in Expo Go — requires a real EAS build
- `exchangeCodeForSession()` takes the UUID code string only, NOT the full callback URL
- Do NOT add boundary polygon drawing to mobile cemetery map (removed — Nominatim `polygon_geojson=1` produced incorrect boundaries)
- Do NOT replace map floating overlay with `<Callout>` (touch events broken on Android)
- Do NOT set `tracksViewChanges={false}` unconditionally on map markers
- Do NOT call `loadStories`/`saveStories` without a `userId` argument

### Web traps
- Do NOT use ES module `import`/`export` in any web JS file
- Do NOT use `const fn = ...` for functions called from HTML `onclick` or other modules
- Script load order in `index.html` is the dependency graph — insert new scripts at the correct position
- `'remembered-stories'` must remain in `VALID_SCREENS`

### Biography pipeline
- Stone-only fallback: if Tavily AND WikiTree both return nothing, `generateBiography` returns a short paragraph without Gemini — do not break this path
- Historical-figure exception requires ALL THREE: date alignment ±5yr, Wikipedia article in numbered sources, every claim with [N] marker — if any condition fails, write the standard short bio
- `name` field: when `multiple_subjects === false`, use `primary_name` only — never join with " & "
- `wikiData` param accepts single object OR array (multi-person stones)

---

## Current State (Phase 9, branch `phase-9`)

**Done:** Grave photo gallery, biography cache, freemium limits (web + mobile), device fingerprinting, portrait persistence, global map portraits, RevenueCat SDK (disabled pending Play Store), security hardening (XSS, web scan/save limits, Worker CLIENT_KEY + model allowlist).

**Remaining before Play Store launch:**
- Run `005_scan_credits.sql` in Supabase SQL editor
- Privacy policy page at `https://j3k420.github.io/gravestory-privacy` + link in Settings
- RevenueCat webhook (Cloudflare Worker endpoint) + re-enable SDK after Play Store account
- Store listing assets; Google Play account ($25); `npx eas credentials`; production build + submission

---

_Last Updated: 2026-06-05 — Update when technology stack, patterns, or phase status changes._
