# GraveStory — CLAUDE.md

## Working conventions

- **Always commit and push at the end of every session.** After completing any meaningful change, run `git add`, `git commit`, and `git push`. Do not leave work uncommitted.

## What this app does

GraveStory is a mobile-first PWA for cemetery visitors. The user photographs a gravestone; the app runs it through AI to produce a biographical story about the person buried there.

**Core flow:**
1. User taps "Scan a Gravestone" → camera or photo library
2. App extracts EXIF GPS from the photo (with permission)
3. Gemini pre-flight: verifies the photo actually shows a gravestone
4. Gemini OCR: reads names, dates, inscription, symbols → structured JSON
5. Parallel research: Tavily web search + WikiTree genealogy + Wikidata SPARQL + Chronicling America + Wikipedia
6. Nominatim/Overpass: geocodes the cemetery (text → lat/lng → named grave node if in OSM)
7. Gemini biography: generates a compassionate narrative from all sources
8. User can save, share, and view the story on a per-cemetery Leaflet map
9. Signed-in users can make stories public → community global map

---

## Stack

| Layer | Technology |
|---|---|
| UI | Vanilla HTML/CSS/JS — no framework, no build step |
| AI (OCR + bio) | Google Gemini via Cloudflare Worker proxy |
| Web search | Tavily API via proxy |
| Genealogy | WikiTree API via proxy |
| Geocoding | Nominatim (OSM) + Overpass API (direct) |
| Maps | Leaflet 1.9.4 + OpenStreetMap + Turf.js 7 |
| Auth | Supabase Auth (Google OAuth + email/password) |
| Cloud DB | Supabase (PostgreSQL) — `stories` table |
| Image storage | Cloudflare R2 via Worker proxy |
| PWA | Inline service worker (cache v13), beforeinstallprompt banner |
| Fonts | Google Fonts: Playfair Display + Crimson Pro |

**No npm. No bundler. No TypeScript. The repo is deployed as static files.**

---

## File structure

```
index.html               — SPA shell: all screen markup + core state + orchestration
css/
  base.css               — Reset, CSS variables, shared layout
  home.css               — Home screen
  camera.css             — Camera/upload screen
  loading.css            — Loading screen
  result.css             — Biography result screen
  maps.css               — Cemetery + global map screens
  modals.css             — All modal overlays
  install-banner.css     — PWA install banner
js/
  config.js              — PROXY_BASE constant (only client config)
  util-json.js           — safeParseJSON helper
  util-image.js          — Image resize/compress
  util-html.js           — HTML escape helpers
  util-dom.js            — DOM utility functions
  exif.js                — EXIF GPS extraction from photo files
  grave-cache.js         — localStorage cache for geocoded grave coords
  api-gemini.js          — geminiCallWithFallback, verifyIsGravestone, readGravestone. readGravestone emits name_confidence (high/medium/low), alternate_names (1-2 alternate spellings when weathered), multiple_subjects (true ONLY when the photo contains physically separate freestanding grave markers at distinct locations — NOT a single shared family stone listing multiple people; if uncertain, false), specific symbol names, and a `subjects` array (one entry per EVERY DECEASED person visible anywhere in the photo regardless of multiple_subjects — "on this stone" was the old wording and caused regressions; aliases of one person merge to a single entry; living relatives excluded). This subjects array drives the per-person multi-subject biography path.
  api-nominatim.js       — reverseGeocode (GPS coords → "City, State") + forwardGeocode (Nominatim + Overpass named-grave search). reverseGeocode is already called in the pipeline before readGravestone.
  api-tavily.js          — searchForPerson. Slot 5 pre-1924 now fires a general historical obituary (no site: restriction) — Chronicling America moved to its own module. All other slots unchanged. Contains: _EXPAND nickname table (~60 entries), _expandName(), _parseAgeAtDeath() (derives missing year from "aged N yrs" inscription), _SYMBOL_QUERIES map (GAR/Masonic/Odd Fellows/military/VFW → targeted record repos). Capped at 6 queries, max_results: 2, session-level _searchCache.
  api-wikidata.js        — queryWikidata(name, deathYear). Free Wikidata SPARQL endpoint (no proxy, CORS-open). Returns { birthDate, deathDate, burialPlaceLabel, burialEntityId, burialCoords } or null. Only fires when name_confidence === 'high'. burialCoords (lat/lng) used as GPS fallback in the pipeline when no EXIF/device GPS was captured. Internal _fetchBurialCoords(entityId) fetches P625 coordinates for the burial-place entity.
  api-chroniclingamerica.js — searchChroniclingAmerica(name, deathYear). Direct loc.gov JSON API for pre-1924 US newspaper obituaries. Free, no key, no proxy. Returns up to 3 results with source_type: 'public_domain'. Returns [] for deathYear > 1924. Runs in parallel with Tavily; results merged into searchResults before generateBiography.
  api-wikitree.js        — searchWikiTree(graveData, location). Three-pass search: date-filtered → unfiltered → expanded-first-name fallback. Nickname-aware _wtFirstNamesMatch(). Geographic alignment scoring: _wtExtractUSState() + ±30/−20 on burial-state match/mismatch.
  api-wikipedia.js       — fetchWikipediaPortraits (returns { left, right }), fetchWikipediaArticleSummary (article lead text → { title, extract, url } for bio grounding; no image download)
  biography.js           — generateBiography(graveData, searchResults, wikiData, location, wikipediaSummary, wikidataResult). wikiData may be a single object or array (multi-person stones get one WikiTree result per person). wikidataResult optional 6th param from queryWikidata(). _buildCorroborationSummary() now accepts wikidataResult and cross-checks stone dates against Wikidata birth/death/burial-place. TYPE_LABELS includes [Wikidata] and [WikiTree]. Uses Gemini structured output — JSON guaranteed at decoder level. Evidence ladder: 1 weak source → 1-2 para; 2 sources → 2-4 para; 3+ sources → up to 1500 words; well-documented historical figure (Wikipedia confirmed + 3+ sources) → up to 2500 words covering early life, career, personal life, cultural impact, and legacy. Name field: when a single deceased subject, model uses primary_name only (or most-recognised alias) — not a combined " & " string even if names array has aliases/pen names. isMultiSubject is driven by `subjects.length > 1` (OR the legacy multiple_subjects flag), so a shared family stone counts as multi-subject. Namesake guard is evaluated PER PERSON: each famous candidate is validated against THEIR OWN dates (from the `subjects` array / inscription), not the single top-level birth_date/death_date — so a famous person buried with a relative (e.g. Amy Winehouse + grandmother) is no longer blocked by the relative's dates. Still requires ±5yr date alignment AND a [Wikipedia] article confirming that person. Stone-only fallback names every deceased subject.
  auth.js                — Supabase client, sign-in/up/out, user-menu
  user-prefs.js          — Display name + default visibility (Supabase user_metadata)
  persistence.js         — storyToRow/rowToStory (includes grave_id + source), cloud upsert/delete, localStorage
  sync.js                — Incremental delta sync (updated_at watermark) + pushLocalOnly
  api-tributes.js        — getTributes(graveId), setTribute(graveId, type) — candle/flower tributes via supabaseClient
  save-actions.js        — saveStory, shareStory, exportCemeteryData
  render-result.js       — Paints the biography result screen. renderTributeSection() shows tribute counts when grave_id present; candle/flower buttons for camera-sourced non-global stories.
  error-render.js        — Gravestone rejection + generic error screens
  loading-ui.js          — setLoadingStep: updates loading text during pipeline
  photo-modal.js         — Photo source modal (camera vs library)
  location-permission.js — Location permission modal + privacy info modal
  home-screen.js         — renderSavedList, loadSaved, deleteSaved. Saved list now lives on the #remembered-stories screen; renderSavedList() is called by showScreen() when navigating there.
  home-screen.append.js  — updateHomeMapButton
  map-utils.js           — groupGravesByCemetery, getDistanceMeters
  scan-limit.js          — Web freemium limits: checkWebScanLimit (guest 3 / free-user 10 lifetime, fail-closed on Supabase error), incrementWebScanCount, checkWebSaveLimit. Mirrors mobile scan-limit.js/save-limit.js. Loaded after auth.js; depends on supabaseClient + currentUser + savedStories.
  map-cemetery.js        — Per-user cemetery map (Leaflet, drag-to-correct, OSM boundary). `_cemeteryStoryCache` (module-level object) stores stories keyed by timestamp so popup "Go to bio" buttons call `viewCemeteryStory(key)` instead of embedding JSON in onclick attributes.
  map-global.js          — Community global map (public stories, guest gate). Deduplicates pins by grave_id then ~20 m GPS cell before placing markers. `_globalStoryLookup` is reset to `{}` at the start of every `initGlobalMap` call to prevent unbounded memory growth.
  pwa.js                 — Service worker registration + install banner
  misc-handlers.js       — Miscellaneous event handlers
```

---

## Architecture conventions

### Classic scripts — no ES modules

All JS files load as `<script src>` tags in `index.html`. No `import`/`export`. Every top-level `function` declaration auto-attaches to `window`. Inline `onclick` attributes in HTML resolve against `window` at click time.

**Rule:** use `function` declarations (not `const fn = ...`) for anything callable from HTML or other modules.

### Load order matters

Scripts are ordered leaf-first in `index.html`:
- `config.js` always first (provides `PROXY_BASE`)
- Utility and API modules before their callers
- `auth.js` must come after the Supabase CDN `<script>` tag (constructs `supabaseClient` at parse time)

### `index.html` owns the orchestration core

The main pipeline (`startAnalysis`, `handleImageUpload`, `showScreen`, `uploadImageToR2`, `getDeviceLocation`, `forwardGeocode`) and all shared state (`currentStory`, `savedStories`, `currentImage`, `currentExifLocation`, `currentPhotoSource`, `locationPermission`, `_bypassVerification`) live in the inline `<script>` block inside `index.html`. Extracted modules read and write these via plain identifier references (shared lexical scope).

### Stage-based extraction refactor

The codebase has been systematically extracted from a monolithic `index.html` into separate files across numbered stages (currently **Stage 13**). Each extracted module has a header block documenting:
- Public API surface
- External symbols consumed
- Load-order requirements
- Timing-safety audit (what runs at parse time vs DOMContentLoaded vs call time)

Follow this pattern when extracting more code.

### HTML escaping rule

**Any AI-generated or user-sourced data injected into `innerHTML` must pass through `escapeHtml()` first.** This includes: story name, dates, location, biography text, inscription, source descriptions, source URLs, contributor names, and image URLs. The `escapeHtml()` helper is in `js/util-html.js` (web) and is globally available to all classic scripts.

- Map popup HTML (both cemetery and global) must escape all story fields before template-literal injection.
- Never embed story objects as JSON in `onclick` attributes — use a module-level lookup table keyed by a safe primitive (timestamp, UUID) and resolve at click time via a named function.
- The `render-result.js` biography renderer uses `escapeHtml()` on each paragraph before `innerHTML` assignment and on all citation URLs/descriptions.

### All API secrets stay server-side

No API keys in client JS. Every sensitive call routes through `PROXY_BASE` (Cloudflare Worker). The only client-side config is `PROXY_BASE` in `config.js`.

**Cloudflare Worker security note:** Worker source lives at `worker/worker.js` in this repo. To deploy: `cd worker && wrangler deploy`. The Worker enforces two layers:
1. **Origin check** (browser requests): `ALLOWED_ORIGIN` env var — must be set to `"https://j3k420.github.io"` (or your actual domain) in production, never `"*"`.
2. **CLIENT_KEY** (mobile/direct requests without Origin): `wrangler secret put CLIENT_KEY` — set to the value in `js/config.js` and `mobile/src/lib/config.js`. All proxy calls send this as `X-Client-Key` header. Rotate by changing the value in both config files and re-running `wrangler secret put CLIENT_KEY`.

### Gemini call pattern

- Primary model: `gemini-3.1-flash-lite`
- Auto-fallback to `gemini-2.5-flash` on HTTP 503, 429, network errors, or overload response bodies
- All Gemini calls use `temperature: 0.1` for deterministic output
- All prompts instruct the model to return **only valid JSON** — parsed via `safeParseJSON` with a sensible default object

### Supabase data model

Stories table uses:
- Soft-delete (`deleted_at` timestamp, not hard DELETE)
- `is_public` flag for community sharing
- `updated_at` for incremental sync (`syncDelta` pulls only rows newer than the last high-water mark)
- `pushLocalOnly` heals stranded guest saves on sign-in
- `grave_id` (UUID FK → `graves` table) links a story to its canonical grave record
- `source` (`'camera'` | `'library'`) tracks how the photo was captured

`graves` table — one row per physical stone, deduped by ~20 m name-match via `find_or_create_grave` RPC. Populated when a signed-in user saves a story with GPS coordinates.

`tributes` table — one candle or flower per user per grave (`UNIQUE(grave_id, user_id)`). `getTributes`/`setTribute` in `js/api-tributes.js` (web) and `mobile/src/lib/api-tributes.js` (mobile).

### CSS approach

One CSS file per screen/component. CSS custom properties in `base.css`. No preprocessor.

**Design language — dark gothic:**
- Background: `#1a1410` (near-black warm brown)
- Gold accent: `#c9a84c`
- Warm cream text: `#e8d4a0`
- Headings: Playfair Display (serif)
- Body/UI: Crimson Pro (serif)

### Mobile-first PWA

Built for one-handed use in a cemetery. Service worker caches the app shell (`gravestory-v14`) and Leaflet map tiles separately. iOS users get a manual "Add to Home Screen" hint (Safari doesn't support `beforeinstallprompt`).

---

## Key behaviors to preserve

- **Gravestone verification before OCR** — `verifyIsGravestone` runs first; throws `{ __verificationRejection: true, reason }` if the photo isn't a gravestone. `startAnalysis` catches this and renders a rejection screen with a "Use it anyway" escape hatch (sets `_bypassVerification = true`).

- **Stone-only biography fallback** — if Tavily and WikiTree both return nothing, `generateBiography` returns a short paragraph from the inscription alone *without* calling Gemini, preventing hallucination.

- **Geographic context filter in geocoding** — `forwardGeocode` extracts city/state tokens from the AI-returned location string and requires them in Nominatim results, preventing cross-city false matches.

- **Low-confidence pin flag** — if Nominatim resolves a cemetery to a different US state than the query specified, the map pin gets a `_lowConfidence` badge instead of silently showing a wrong location.

- **Grave-node cache** — `grave-cache.js` caches successful Overpass name-match results so the same person's grave isn't re-queried on subsequent map opens.

- **Grave-node search uses primary_name** — `forwardGeocode` is called with `story.graveData?.primary_name || story.name`. The biography `name` field is a combined string (e.g. "Harry Houdini and Bess Houdini") that inflates the token count and threshold; `graveData.primary_name` is the single OCR-extracted name and produces a reliable match threshold.

- **Grave-node search — web vs mobile** — Web uses a two-pass Overpass query: Pass 1 searches tagged nodes (historic=memorial/tomb/grave/monument/mausoleum, tourism=attraction, cemetery=grave, memorial=*, building=tomb/mausoleum) within 1000m; Pass 2, if pass 1 misses, searches any named node within the Nominatim bounding box (100% token match required). Famous graves often use `tourism=attraction`, not `historic=grave`. Mobile cannot use Overpass (all mirrors return 403/406 to Cloudflare Worker IPs and to React Native's HTTP stack directly). Mobile uses a **two-pass Nominatim + Photon search** instead: Pass 1 — Nominatim `/search?q={personName}&viewbox={bbox}&limit=10` WITHOUT `bounded=1` (bounded=1 applies an importance-score threshold that silently drops grave nodes); results are proximity-filtered to the cemetery bbox. Pass 2 — Photon (`photon.komoot.io`, Elasticsearch-backed) which indexes low-importance named nodes like graves better than Nominatim; restricted via `bbox=` param. Both passes use the same name-token scoring and threshold. Falls back to cemetery-center when no match is found. For camera-taken photos, real GPS (EXIF or device) always takes priority over any geocoded coordinates — the user was physically at the grave.

- **Cemetery boundary polygon (web only)** — `fetchOSMCemeteryBoundary` in `map-cemetery.js` queries Overpass for ways and relations within 1000m. Relations need `stitchOuterRing()` to order member ways correctly. Scoring: name-match first, then relation over way, then smallest area. Relations stitching to >2000 points are skipped. The `cemeteryName` is threaded from `initCemeteryMap` → `renderLeafletMap` → `loadAndDrawBoundary` → `fetchOSMCemeteryBoundary`. **Mobile does not draw a boundary polygon** — Nominatim's `polygon_geojson=1` approach was tried but produced incorrect boundaries (e.g. Machpelah Cemetery's polygon didn't contain Houdini's actual grave node). Removed entirely from `CemeteryMapScreen.js`. Do not attempt to re-add boundary drawing on mobile.

- **Nearby cemeteries** — `fetchNearbyCemeteries` uses a 5km radius and only `landuse=cemetery` / `amenity=grave_yard` on ways and relations. Unnamed elements (no `name` tag) are filtered out — they clutter the map with useless "Unnamed Cemetery" entries.

- **Soft-delete sync** — deletes propagate to other devices via `deleted_at` in the delta sync, not through missing rows.

- **Remembered Stories screen (web)** — saved stories no longer render inline on the home screen. The home screen has a "Remembered Stories" nav button that calls `showScreen('remembered-stories')`. The `#remembered-stories` div contains the `#saved-list` element; `renderSavedList()` is called by `showScreen()` when that screen becomes active. `'remembered-stories'` is in `VALID_SCREENS` so `#remembered-stories` is a valid hash-routable destination.

- **Web canonical grave linking** — `startAnalysis()` calls `findOrCreateGrave(primaryName, lat, lng, isPublic)` after biography resolves, but only when the user is signed in and `resolvedGps` is non-null. Sets `currentStory.grave_id` with the returned UUID. Non-fatal: if the RPC fails, `grave_id` is null and the story saves normally without a canonical link.

- **Web photo source tracking** — `currentPhotoSource` ('camera' or 'library') is set in `handleImageUpload` based on `isLiveCamera` and reset to 'library' in `resetCamera`. Written onto `currentStory.source` so `render-result.js` and `persistence.js` can use it.

- **Web tribute section** — `renderTributeSection(story)` in `render-result.js` appends a tribute block below the visibility controls whenever `story.grave_id` is present. Tribute counts (candles · flowers) always visible. Candle/flower toggle buttons only shown when `currentUser` is signed in, `story.source === 'camera'`, and `!story._isGlobal`. Tapping a button that matches the user's existing tribute removes it (toggle off); tapping a different type switches. Counts refresh from Supabase after each toggle.

- **Web global map dedup** — `fetchGlobalStories()` in `map-global.js` deduplicates the raw Supabase rows before placing markers: first pass drops duplicate `grave_id`s (keeps the first/most-recent row per canonical grave); second pass drops stories whose GPS rounds to the same ~20 m cell (`Math.round(lat * 5000),Math.round(lng * 5000)`) as an already-kept pin. This matches the mobile `GlobalMapScreen` behaviour exactly.

- **Grave photo gallery (global map bios only)** — `grave_photos` table (`supabase-migrations/003_grave_photos.sql`) holds one row per photo per story, FK to `grave_id`. Written by both web (`save-actions.js` after R2 upload) and mobile (`CameraScreen.js` after `cloudUpdateStory`) whenever `grave_id` and `image_url` are both present. **Own Remembered Stories show only the user's own photo.** Global map bios (`story._isGlobal === true`) fetch all `grave_photos` for that `grave_id` (up to 10, newest first) and replace the image area with a horizontal scrollable gallery — web uses `.grave-gallery-strip` CSS (scroll-snap, `result.css`); mobile extends the `FlatList` carousel via `gravePhotos` state loaded in a `useEffect`. Portraits append after the grave photos in both. **To activate: run `supabase-migrations/003_grave_photos.sql` in the Supabase SQL editor.**

- **Android map screen bottom inset** — `CemeteryMapScreen` and `GlobalMapScreen` both use `edges={['top']}` on `SafeAreaView` so the map fills edge-to-edge. This means the bottom inset (Android 3-button nav bar / gesture bar) is NOT applied by SafeAreaView. Both screens import `useSafeAreaInsets` and apply `paddingBottom: insets.bottom + 8` directly to the `panel` View. Do not remove this or the bottom panel content will be hidden behind the nav bar.

- **Global map low-confidence pins** — both web and mobile global maps indicate approximate locations visually and in the callout. Web: `makeGlobalIcon(lowConfidence)` renders a silver `?` badge and `opacity:0.75` on the icon; popup shows `⚠ approximate location` below the contributor line. Mobile: `markerLowConf` style fades the pin; floating overlay shows `⚠ approximate location` in `colors.ember`.

- **Mobile per-user storage isolation** — `loadStories(userId)` / `saveStories(stories, userId)` in `mobile/src/lib/storage.js` use key `gs_stories_${userId}` for signed-in users and `gs_stories_guest` for guests. Every call site (HomeScreen, CameraScreen, CemeteryMapScreen, ResultScreen, sync.js) must pass the userId from `supabase.auth.getSession()`. Never call these functions without a userId argument — that silently reads the guest bucket.

- **Mobile syncOnSignIn always does a full pull** — `syncOnSignIn` in `mobile/src/lib/sync.js` always pulls all cloud stories (not just delta) on sign-in. Cloud is authoritative; local stories are only kept if they have no `id` field (never been pushed). This prevents contaminated/stale local data from persisting across account switches. `syncDelta` (called on every HomeScreen focus) handles incremental updates after sign-in.

- **Tavily inscription-phrase disambiguation** — when the OCR returns a bare surname with no dates (e.g. "TOMB OF WASHINGTON"), `searchForPerson` prepends two high-priority queries that search the inscription text verbatim before falling back to name-only queries. Prevents generic surname searches returning cemetery-name results instead of the actual person. Applies to both `js/api-tavily.js` and `mobile/src/lib/api-tavily.js`.

- **Wikidata + Chronicling America parallel search (Session 10)** — two new free sources run in parallel with the existing Tavily/WikiTree/Wikipedia step:
  - *Wikidata SPARQL* — `queryWikidata(name, deathYear)` in `js/api-wikidata.js` / `mobile/src/lib/api-wikidata.js`. Fires only when `name_confidence === 'high'`. Returns structured birth/death dates (used in `buildCorroborationSummary` alongside WikiTree) and precise burial-place GPS coordinates. Wikidata coords are used as a GPS fallback for famous figures when no EXIF/device GPS was captured — slotted in after `forwardGeocode` in both pipelines: web `index.html` after the boundary-snapping block; mobile `CameraScreen.js` in the `refinedGps` chain (`gps ?? geoResult ?? wikidataCoords`).
  - *Chronicling America direct API* — `searchChroniclingAmerica(name, deathYear)` in `js/api-chroniclingamerica.js` / `mobile/src/lib/api-chroniclingamerica.js`. Queries `https://www.loc.gov/collections/chronicling-america/?q=...&fo=json` directly; returns up to 3 results with `source_type: 'public_domain'`. Only fires for `deathYear <= 1924`. Results merged into `searchResults` before `generateBiography`. The freed Tavily slot 5 (pre-1924) now fires a general historical obituary search with no `site:` restriction, giving broader pre-modern fallback coverage.
  - *Multi-person WikiTree* — when `multiple_subjects === true`, `searchWikiTree` is called for each of the first 2 people in `graveData.names` in parallel. Results passed to `generateBiography` as an array (wikiData now accepts single object or array). `buildCorroborationSummary` uses the first array element for the primary-person date check.
  - *Wikidata in biography* — `generateBiography` accepts an optional 6th param `wikidataResult`. `buildCorroborationSummary` cross-checks Wikidata birth/death dates against the stone and adds a burial-place confirmation line. A `wikidataContext` block in the Gemini prompt exposes the Wikidata record to the model. `TYPE_LABELS` in biography.js now includes `[Wikidata]` and `[WikiTree]`.

- **Search accuracy improvements (Session 9)** — layered improvements now live in both `js/` (web) and `mobile/src/lib/` (mobile):
  - *GPS-derived location hint* — `reverseGeocode(lat, lng)` converts GPS coords to "City, State" before OCR and all search calls. Web: already in the pipeline via `currentExifLocation`; mobile: fires in parallel with `verifyIsGravestone`. The location string is threaded into `readGravestone`, `searchForPerson`, `searchWikiTree`, and `generateBiography`.
  - *Nickname/abbreviation expansion* — `EXPAND` table (~60 entries) lives in `mobile/src/lib/abbreviations.js` (shared) and `js/api-tavily.js` (web). Maps period abbreviations and informal names (Wm→William, Geo→George, Lizzie→Elizabeth, etc.) to formal forms. `api-tavily.js` imports the title-case version directly; `api-wikitree.js` derives a lowercase variant. Tavily fires queries for both forms; WikiTree's `firstNamesMatch()` is nickname-aware and adds a third search pass with the expanded first name when the abbreviated form returns nothing.
  - *Age-at-death parsing* — `parseAgeAtDeath()` in `api-tavily.js` extracts approximate birth or death year from inscription phrases like "aged 72 yrs" or "aet. 45", unlocking date-filtered queries for stones with no explicit dates.
  - *WikiTree geographic scoring* — `searchWikiTree` accepts a `location` param; `extractUSState()` parses a state and adds ±30/−20 to candidate scores based on burial-state match/mismatch.
  - *Symbol-guided Tavily queries* — `SYMBOL_QUERIES` map (~30 entries) routes recognised emblems to targeted record repositories: GAR → Civil War veteran queries, Masonic/Odd Fellows/Elks/KofC/VFW/military branch symbols each fire their own precision query.
  - *OCR alternate readings* — `readGravestone` emits `name_confidence` (high/medium/low), `alternate_names` (1-2 plausible alternate spellings), and `multiple_subjects` (true when photo clearly shows multiple separate distinct stones). Alternate readings feed into Tavily query variants when confidence is not high.
  - *Multi-stone detection* — when `graveData.multiple_subjects === true`, the pipeline shows a warning (web: loading-step text; mobile: Alert) and generates a **combined biography covering all people** on the stone. The prompt injects a MULTIPLE PEOPLE block naming all subjects and requiring proportional coverage. `fetchWikipediaArticleSummary` is called for each person in parallel; results passed as an array to `generateBiography`. `name` field uses " & " separator; `dates` field uses " · " separator. The user is still advised to photograph each stone separately for a dedicated bio.
  - *Cross-source corroboration* — `_buildCorroborationSummary()` in `biography.js` checks name/date agreement across WikiTree, FindAGrave, BillionGraves, and obituaries and injects a structured corroboration block into the bio prompt. Date conflicts are flagged explicitly so the model doesn't silently blend conflicting claims.
  - *Wikipedia article grounding* — `fetchWikipediaArticleSummary(name, dates)` (in both `js/api-wikipedia.js` and `mobile/src/lib/api-wikipedia.js`) does a lightweight Wikipedia search + summary fetch (no image download) and returns the article lead text as a numbered source. Fired in parallel with Tavily + WikiTree; threaded into `generateBiography` as the 5th `wikipediaSummary` param. Historical-figure bios must cite this source with `[N]` markers rather than relying on recalled knowledge.
  - *Citation integrity* — `_validateCitations()` in `biography.js` processes the structured `citations [{n, description, url}]` array returned by Gemini, sorts by n, remaps non-sequential numbers to 1,2,3…, strips orphan [N] markers, and converts to `sources`/`source_urls` arrays for backwards-compat with storage and display code.
  - *Namesake collision guard* — the historical-figure exception in `biography.js` now requires BOTH date alignment (±5 years) AND a [Wikipedia] article confirming the same person present in the numbered sources. If no Wikipedia article was fetched, the rich-bio path does not fire. Prevents "John Adams d.1931" inheriting the Founding Father's biography.

- **Historical figures biography exception** — `generateBiography` allows a fuller biography for major historical figures only when ALL three conditions hold: (1) the stone shows dates for THAT SPECIFIC PERSON within ±5yr of the famous figure's actual dates, (2) a [Wikipedia] article confirming the same person is present in the numbered sources, and (3) every claim carries an [N] marker. Conditions are evaluated **per person** — on a shared stone one subject can qualify for the full ~2500-word treatment while another gets a dignified sourced paragraph. If a person fails any condition — including no Wikipedia article being fetched — the standard short source-grounded biography is written. **Passing path**: once all three conditions are met the model is explicitly AUTHORISED to draw on its knowledge of that historically documented figure — the [Wikipedia] article is the authoritative citation anchor (all claims carry `[N]` markers) but the model is NOT restricted to paraphrasing only the extract text. **Failure path**: "Memory is not a source" applies only here. Applies to both `js/biography.js` and `mobile/src/lib/biography.js`.

- **Multi-subject per-person biography (Session 7 + Session 8)** — shared family stones (e.g. Amy Winehouse buried with her grandmother) were demoting the famous subject to a one-line mention. Root cause: the namesake date-guard validated the famous figure against the single top-level `birth_date`/`death_date`, which on a shared stone belongs only to the primary/first-listed person. Fix (Session 7): OCR (`api-gemini.js` web+mobile) now emits a `subjects` array — one entry per DECEASED person with their OWN dates. `biography.js` derives `isMultiSubject` from `subjects.length > 1` (so a shared family stone qualifies even though `multiple_subjects` is narrowly "separate physical stones"), injects a per-person date block, and validates the historical-figure guard against each subject's own dates. The pipeline (`index.html` + `CameraScreen.js`) builds `researchTargets`/`wikiTreeTargets` from `subjects`, passing each person their own dates to the Wikipedia lookup so the famous secondary subject is always researched and matched. Back-compat: all reads guard with `Array.isArray(graveData.subjects)`, so old cached `graveData` without `subjects` behaves exactly as before. **Session 8 follow-up fixes** (three OTAs to `production`): (1) OCR `multiple_subjects` description tightened — "true ONLY when physically separate freestanding markers at distinct locations; if uncertain, return false" — prevents false-positive on shared stones. `subjects` description changed from "on this stone" to "every deceased person visible anywhere in this photo" so all subjects are captured even when `multiple_subjects` is true. Warning in CameraScreen/index.html now only fires when `multiple_subjects === true && subjects.length <= 1`. (2) `multiSubjectBlock` in biography prompt now explicitly identifies the [Wikipedia article] source as the qualification signal — model must NOT judge significance by FindAGrave/WikiTree/Tavily record counts; Wikipedia outweighs all. Famous subject is written FIRST with full ~2500-word treatment, other person(s) get a respectful paragraph. (3) "Do not use facts from memory" was acting as a hard ceiling even for the passing namesake-guard path — model paraphrased only the Wikipedia REST extract (~300 words) and stopped. Fixed by adding explicit authorisation bullet: once the guard passes, the model IS authorised to use its knowledge with the Wikipedia article as the citation anchor.

- **Mobile Wikipedia portraits return an array** — `fetchWikipediaPortraits` in `mobile/src/lib/api-wikipedia.js` returns `string[]` (up to 5 local file URIs), not the `{ left, right }` object used by the web version. Each URL is downloaded and resized to an 800px JPEG via `expo-image-manipulator` so React Native always gets a local `file://` URI it can decode. `ResultScreen` uses `normalizePortraits()` to handle both the old `{ left, right }` format (stored in older saved stories) and the new array format.

- **Mobile map callout is a floating overlay, not `<Callout>`** — `react-native-maps` `<Callout onPress>` with custom child Views silently swallows touch events on Android. `CemeteryMapScreen` uses a state-driven `View` overlaid on the map instead. Tapping a marker sets `selectedStory` state; tapping the map or the ✕ button dismisses it. The overlay includes a "▼ Read bio" toggle that expands the first two biography paragraphs inline. Do not replace this with `<Callout>`.

- **Mobile gravestone map marker** — `CemeteryMapScreen` uses a custom SVG gravestone icon (`GravestoneMarker` component, rendered by `GraveMarker` wrapper) that matches the web Leaflet `divIcon` design: arched stone body, open book, cross. The `GraveMarker` wrapper manages `tracksViewChanges` state — starts `true` so react-native-maps captures the SVG on first layout, then flips to `false` via `onLayout` to stop re-snapshotting. Do not use `tracksViewChanges={false}` unconditionally — the native map takes its bitmap snapshot before SVG finishes painting and the marker disappears.

- **Portrait persistence (mobile)** — `fetchWikipediaPortraits` in `mobile/src/lib/api-wikipedia.js` copies each ImageManipulator temp `file://` URI into `FileSystem.documentDirectory + 'portraits/'` via `persistPortrait()` before returning. The persistent URI is stored in `story.portraits` in AsyncStorage and survives app restarts and OS temp-dir clears. For global map bios (stories from other users), `ResultScreen` live-fetches portraits on mount via `fetchWikipediaPortraits` because file:// URIs are device-local and cannot be shared via Supabase — portraits appear in the carousel a moment after the bio renders.

- **Portrait retry after bio resolves full name** — Two cases handled on both web and mobile:
  1. *Surname-only OCR*: stone shows only "HOUDINI" → single-token guard skips initial fetch → after bio resolves full name, retry splits `bioResult.name` / `story.name` on `" and "` / `" & "` and calls `fetchWikipediaPortraits` for each part.
  2. *Alias/pen-name combined name*: if bio name contains `" & "` (e.g. a stone listing both birth name and pen name when `multiple_subjects` is false) the portrait fetch fails because the combined string doesn't match any Wikipedia title. Web pipeline (`index.html` step 5.5) retries by splitting on `" & "` and trying each part individually. Mobile `CameraScreen` handles this via the same retry loop. The biography prompt also now instructs the model to use `primary_name` (or most-recognised alias) instead of joining with `" & "` when `multiple_subjects` is false, which prevents the issue at the source.

---

## React Native mobile app (Expo)

Parallel codebase in `mobile/`. Do not touch web files when working on mobile and vice versa.

### Mobile stack

| Layer | Technology |
|---|---|
| Framework | Expo SDK 54 (managed workflow) |
| Navigation | React Navigation v7 native stack |
| Auth | Supabase (same project as web) + AsyncStorage session |
| Storage | AsyncStorage (local, user-scoped keys) + Supabase delta sync |
| Camera/picker | expo-image-picker + expo-image-manipulator |
| SVG | react-native-svg |
| Maps | react-native-maps (Apple Maps on iOS, Google Maps on Android) |
| Location | expo-location (foreground GPS on scan) |
| Fonts | Fraunces (300/400/400-italic/500/700) + Hanken Grotesk (400/500/600) via @expo-google-fonts |

### Mobile design system

All screens import from `src/lib/theme.js`. Do not hardcode colors or font names in screen files.

**Color tokens:**
- `colors.ink` `#14100b` — background
- `colors.stone` `#1f1812` — panel/header backgrounds
- `colors.stone2` `#2a2017` — card/input backgrounds
- `colors.line` `#3a2e22` — borders and dividers
- `colors.flame` `#f2b65c` — gold accent, primary CTAs
- `colors.ember` `#cf7a3a` — warm orange, secondary accent
- `colors.parchment` `#efe4d2` — primary text
- `colors.ash` `#b7a892` — secondary/muted text
- `colors.ashDim` `#8a7d6c` — labels, placeholders
- `colors.silver` `#aabedc` — community/global map accents
- `colors.moss` `#7c8a68` — success states
- `colors.onFlame` `#2a1808` — text on flame-colored buttons

**Font tokens:**
- `fonts.title` `Fraunces_700Bold` — screen headings, "GraveStory" logo
- `fonts.serif` `Fraunces_400Regular` — biography body text
- `fonts.serifItalic` `Fraunces_400Regular_Italic` — inscriptions, italic body
- `fonts.name` `Fraunces_500Medium` — story names in cards, sub-headings
- `fonts.body` `HankenGrotesk_400Regular` — UI labels, descriptions
- `fonts.bodyMedium` `HankenGrotesk_500Medium` — medium UI elements
- `fonts.sansBold` `HankenGrotesk_600SemiBold` — button text
- `fonts.bodyItalic` `Fraunces_400Regular_Italic` — alias used by older screens

**Radius tokens:** `radius.sm=13`, `radius.md=15`, `radius.lg=18`

### Mobile file structure

```
mobile/
  App.js                        — NavigationContainer + SafeAreaProvider + font loading (useFonts) + cold-start deep link handler
  index.js                      — Entry point; imports polyfills.js first, then registerRootComponent
  polyfills.js                  — crypto.getRandomValues + crypto.subtle.digest polyfill (expo-crypto); MUST be first import in index.js
  app.config.js                 — Expo config: slug "mobile", owner "j3k420", scheme "gravestory" (replaces app.json)
  src/
    lib/
      config.js                 — PROXY_BASE (same Cloudflare Worker as web)
      theme.js                  — Design tokens: colors, fonts, radius, space. Single source of truth for all screens.
      supabase.js               — Supabase client, AsyncStorage, flowType: 'pkce'
      storage.js                — User-scoped AsyncStorage: loadStories(userId), saveStories(stories, userId). Keys: gs_stories_{userId} or gs_stories_guest. getLastSync/setLastSync per userId.
      util-json.js              — safeParseJSON (ES module port of web version)
      abbreviations.js          — Shared EXPAND nickname/abbreviation table (~60 entries, title-case values). Single source of truth imported by api-tavily.js (directly) and api-wikitree.js (derives lowercase variant via Object.fromEntries). Do not duplicate this table in individual modules.
      device-id.js              — getDeviceId(): SHA-256 hash of expo-device properties (brand, modelName, osName, osVersion, totalMemory) via expo-crypto. Cached in AsyncStorage (gs_device_id). Called by AuthScreen.signUp() to attach device_id to user_metadata for soft anti-abuse.
      use-refresh.js            — useRefresh(callback) hook. Manages refreshing state, wraps callback in try/finally, returns { refreshing, onRefresh, refreshControl }. The refreshControl prop is a pre-styled RefreshControl (tintColor=colors.flame) ready to pass to any ScrollView/FlatList. All 8 screens use this hook — do not add inline pull-to-refresh boilerplate.
      api-gemini.js             — verifyIsGravestone, readGravestone (ES module). Both calls go through geminiCallWithFallback which wraps each fetch in a 30s fetchWithTimeout — hangs surface as an error instead of infinite loading. readGravestone returns name_confidence (high/medium/low), alternate_names (1-2 alternate spellings when stone is weathered/ambiguous), multiple_subjects (true ONLY when physically separate freestanding markers at distinct locations — NOT a shared family stone; if uncertain, false), and a `subjects` array (every deceased person visible anywhere in the photo, regardless of multiple_subjects — includes people from all stones in the frame) in addition to standard fields.
      api-tavily.js             — searchForPerson (ES module). Slot 5 pre-1924 now fires a general historical obituary (no site: restriction) — Chronicling America moved to its own module. All other slots unchanged. Contains: EXPAND nickname table (~60 entries), expandName(), parseAgeAtDeath(), SYMBOL_QUERIES map. Capped at 6 queries, max_results: 2, session-level _searchCache.
      api-wikidata.js           — queryWikidata(name, deathYear) (ES module). Free Wikidata SPARQL endpoint (no proxy, CORS-open). Returns { birthDate, deathDate, burialPlaceLabel, burialEntityId, burialCoords } or null. Only fires when name_confidence === 'high'. burialCoords used as GPS fallback in runPipeline after forwardGeocode when no EXIF/device GPS was captured.
      api-chroniclingamerica.js — searchChroniclingAmerica(name, deathYear) (ES module). Direct loc.gov JSON API for pre-1924 US newspaper obituaries. Free, no key, no proxy. Returns up to 3 results with source_type: 'public_domain'. Runs in parallel with Tavily; results merged into searchResults before generateBiography.
      api-wikitree.js           — searchWikiTree(graveData, location) (ES module). Signature accepts location string for geographic scoring. Contains: EXPAND table (subset), formalFirst(), firstNamesMatch() (nickname-aware), extractUSState(), STATE_ABBREVS. Three search passes: date-filtered → unfiltered → expanded-first-name fallback. Geographic alignment adds ±30/−20 to candidate scores.
      api-wikipedia.js          — fetchWikipediaPortraits (ES module, adds User-Agent header). Returns array of up to 5 local JPEG URIs (resized via expo-image-manipulator). imageFilenameMatchesPerson uses substring containment + strips Wikimedia "NNNpx-" thumbnail prefix so CamelCase and thumbnail filenames match correctly. fetchWikipediaArticleSummary(name, dates): lightweight search + summary fetch (no image download), returns { title, extract, url } or null for bio grounding. normalizePortraits(portraits): exported helper that normalises both old { left, right } and new array portrait formats — import from here, do not redefine inline.
      biography.js              — generateBiography(graveData, searchResults, wikiData, location, wikipediaSummary, wikidataResult) (ES module). wikiData may be a single object or array (multi-person WikiTree results). wikidataResult optional 6th param from queryWikidata(). buildCorroborationSummary() accepts wikidataResult and cross-checks Wikidata birth/death/burial-place against stone. TYPE_LABELS includes [Wikidata] and [WikiTree]. Uses Gemini structured output — JSON guaranteed at decoder level. Evidence ladder: 1 weak source → 1-2 para; 2 sources → 2-4 para; 3+ sources → up to 1500 words; well-documented historical figure (Wikipedia confirmed + 3+ sources) → up to 2500 words. Name field: single deceased subject → uses primary_name / most-recognised alias only — not a combined " & " string. isMultiSubject driven by `subjects.length > 1` (OR legacy multiple_subjects). Namesake guard is PER PERSON — validates each famous candidate against THEIR OWN dates (subjects array / inscription), not the top-level pair, so a famous secondary subject on a shared stone is no longer blocked by the primary's dates. Still requires ±5yr alignment AND a [Wikipedia] article for that person. Stone-only fallback names every deceased subject.
      api-nominatim.js          — forwardGeocode + reverseGeocode (ES module). forwardGeocode: multi-query fallback, geographic context filter, strict/fuzzy cemetery matching, US state low-confidence flag, two-pass grave-name search (Pass 1: Nominatim viewbox bias without bounded=1 + proximity filter; Pass 2: Photon bbox search), AsyncStorage grave cache. Signature: forwardGeocode(locationStr, personName, dates). reverseGeocode(lat, lng): converts GPS coords to "City, State" string via Nominatim /reverse; used by CameraScreen to build locationHint before search queries fire.
      grave-cache.js            — AsyncStorage-backed grave coordinate cache (30-day TTL). graveCacheKey, readGraveCache, writeGraveCache. Port of web grave-cache.js (localStorage → AsyncStorage).
      api-r2.js                 — uploadGravestoneImage(base64): POST to /upload-image with { data, contentType } body, returns URL or null
      map-utils.js              — getDistanceMeters, groupGravesByCemetery (ES module)
      sync.js                   — storyToRow/rowToStory, cloudSaveStory/Update/Delete, syncDelta, syncOnSignIn, pushLocalOnly. syncOnSignIn always does a full cloud pull (not delta) — cloud is authoritative, local stories only kept if no cloud id (unsynced).
    screens/
      HomeScreen.js             — Home: GravestoneLogo (size=240), scan button, map buttons with SVG icons, "Remembered Stories" nav button (navigates to RememberedStoriesScreen). No saved list inline — list lives on RememberedStoriesScreen. Runs syncDelta on every focus; syncOnSignIn on SIGNED_IN auth event. Pull-to-refresh triggers syncDelta.
      RememberedStoriesScreen.js — Dedicated saved-stories screen. Sort bar with three pill options: Recent (newest-first by timestamp), Name (A→Z), Cemetery (A→Z grouped by first location segment). In Cemetery mode stories are grouped under collapsible cemetery headers: cemeteries with ≤5 stories always expanded; >5 stories collapsed by default with a count badge and ▸/▾ chevron — tap header to expand inline. Pull-to-refresh reloads from AsyncStorage.
      AuthScreen.js             — Email/password + Google OAuth (expo-web-browser). GravestoneLogo header, Fraunces title, HankenGrotesk inputs/buttons. Pull-to-refresh clears form fields and status message.
      CameraScreen.js           — Photo picker → GPS capture → full pipeline → forwardGeocode refinement → R2 upload → cloud save → Result. Flickering gravestone SVG tap zone (375×410); tapping opens bottom-sheet picker. Candle flicker loading animation. reverseGeocode fires in parallel with verifyIsGravestone to build locationHint from EXIF/device GPS; locationHint is threaded into readGravestone, searchForPerson, searchWikiTree, and generateBiography. Shows Alert if graveData.multiple_subjects === true. Parallel step fires searchForPerson + searchWikiTree + fetchWikipediaPortraits + fetchWikipediaArticleSummary; all four results threaded into generateBiography. forwardGeocode called after biography to refine GPS using graveData.primary_name. Portrait retry: if fetchWikipediaPortraits returns empty (single-token OCR name), retries after bio resolves full name; splits bioResult.name on " and " and tries each person individually so combined names like "Harry Houdini and Bess Houdini" don't break the Wikipedia title-match guard. Pull-to-refresh clears rejected/error state back to idle.
      ResultScreen.js           — Biography (Fraunces serif), full-width paging FlatList image carousel at top (gravestone photo first, then Wikipedia portraits), inscription, sources. Imports normalizePortraits from api-wikipedia.js (handles both old { left, right } and new array portrait formats for backward compat). Action chip row: Map / Share / Public toggle. Scan Again + Delete buttons. Pull-to-refresh re-reads the story from AsyncStorage to pick up synced changes.
      SettingsScreen.js         — Display name, default visibility toggle, account info, sign out. Sign-out shows a confirmation Alert before proceeding. Grouped sections, gradient save button. Pull-to-refresh re-fetches the session to reload profile metadata.
      CemeteryMapScreen.js      — react-native-maps: grave markers (custom SVG GravestoneMarker via GraveMarker wrapper), floating overlay callout (NOT <Callout> — Android unreliable), "Read bio" pull-down (first 2 bio paragraphs), draggable pin correction (long-press drag → Alert → saves to AsyncStorage + cloud with userCorrected:true), bottom list. No boundary polygon (removed — Nominatim polygon_geojson produced boundaries that excluded the actual grave markers). loadStories/saveStories always called with userId from session. Pull-to-refresh on the bottom grave list re-runs resolveStories.
      GlobalMapScreen.js        — Community map: public stories from Supabase RPC, silver markers, guest banner. Globe icon header. 5-minute module-level cache (_cache/_cacheTime/_cacheUserId). Pull-to-refresh busts the cache and re-fetches. Fetch errors are surfaced to the user in the bottom panel (not silently swallowed as empty state). Uses the same state-driven floating overlay as CemeteryMapScreen (NOT <Callout> — Android unreliable): tapping a marker sets selectedStory; overlay shows name/dates/location/contributor, ⚠ approximate location warning when _lowConfidence, ▼ Read bio toggle (first 2 paragraphs), → Go to bio button; tapping the map or ✕ dismisses.
    components/
      GravestoneLogo.js         — Animated SVG gravestone logo; accepts animate={false} for static rendering. Two independent animation loops: (1) flicker — alternates slow candle-waver phases (400–600ms), burst of rapid blinks, and long near-out dims; (2) sweeping shimmer — AnimatedG translates a tilted gradient Rect left→right every ~4s, clipped to the stone silhouette via ClipPath.
      Icons.js                  — SVG icon set: CandleMark, Headstone, MapStack, Globe, ShareIcon, Pin. All accept size + color props.
```

### Mobile conventions

- ES modules (`import`/`export`) — opposite of web's classic scripts
- `SafeAreaView` from `react-native-safe-area-context`, NOT from `react-native`
- `SafeAreaProvider` wraps the entire app in `App.js`
- All API calls use same `PROXY_BASE` as web — same Cloudflare Worker handles both
- `console.warn` (not `console.log`) for genuine error/failure logging only — debug data-dump warns (raw OCR text, result counts, etc.) have been removed. Keep only failure-path logs.
- **Pull-to-refresh** — all 8 screens use `useRefresh(callback)` from `use-refresh.js`. The hook returns `{ refreshControl }` which is passed directly to the `ScrollView`. Do not add inline `[refreshing, setRefreshing]` state — use the hook instead.

### Mobile pipeline (CameraScreen.js)

1. expo-image-picker (`exif: true`) → read EXIF GPS before compression strips it → compress to 1024px JPEG → base64 via expo-image-manipulator
2. GPS source: EXIF coords from the photo if present; device GPS fallback only for **camera shots** (not library picks — device location would be wrong for historical photos)
3. `reverseGeocode(gps.lat, gps.lng)` fires **in parallel** with `verifyIsGravestone` — converts GPS coords to "City, State" string (`locationHint`) before any search queries execute. If no GPS, locationHint is null.
4. `verifyIsGravestone(base64)` — throws `{ __verificationRejection: true }` → rejection UI
5. `readGravestone(base64, locationHint)` — Gemini OCR → structured JSON including `name_confidence`, `alternate_names`, and specific symbol names
6. Parallel: `searchForPerson(graveData, locationHint)` + `searchWikiTree(graveData, locationHint)` + `fetchWikipediaPortraits` (using `graveData.primary_name`; may return empty if stone shows only a surname) + `fetchWikipediaArticleSummary` for each person in `graveData.names` when `multiple_subjects === true`, or just the primary name otherwise. Results passed to `generateBiography` as a single object or array. locationHint feeds nickname-expanded Tavily queries, symbol-guided queries, WikiTree geographic scoring, and alternate-reading variants.
7. `generateBiography(graveData, searchResults, wikiData, locationHint, wikipediaSummary, wikidataResult)` — Gemini narrative or stone-only fallback. Wikipedia article injected as a numbered source; corroboration summary (including Wikidata dates) and citation validation applied. Length scales to evidence: up to 2500 words for confirmed notable figures.
8. **Portrait retry** — if step 6 returned no portraits, split `bioResult.name` on `" and "` and call `fetchWikipediaPortraits` for each part until one succeeds. This handles stones where the OCR returns only a surname (e.g. "HOUDINI") but the bio resolves "Harry Houdini".
9. `forwardGeocode(bioResult.location, graveData.primary_name, bioResult.dates)` — refines GPS to cemetery center or precise grave node via Nominatim + Overpass. Falls back to EXIF/device GPS if null. Sets `_lowConfidence` on state mismatch.
10. Read `user.user_metadata.default_public` → set `story.is_public`
11. Save to user-scoped AsyncStorage key → `cloudSaveStory` (if signed in) → `uploadGravestoneImage` → `cloudUpdateStory` with `image_url`
12. Navigate to ResultScreen

### Google OAuth (mobile)

- Uses `expo-web-browser` + `expo-linking` + Supabase PKCE flow
- Redirect URI: `gravestory://login-callback` — must be added to Supabase Dashboard → Auth → URL Configuration → Redirect URLs
- **Does not work in Expo Go** — requires a real build (`npx eas build --profile development`)
- Cold-start deep link handler in `App.js` calls `supabase.auth.exchangeCodeForSession(code)` — passes only the extracted code UUID, NOT the full URL
- `AuthScreen.js` handles the normal in-app OAuth flow via `WebBrowser.openAuthSessionAsync`; extracts `code` from `result.url` with `URLSearchParams` before calling `exchangeCodeForSession`
- **Do NOT pass the full callback URL to `exchangeCodeForSession`** — it expects just the UUID code string; passing the full URL causes "invalid flow state" server error
- **Crypto polyfill is required** — Hermes on Android has no `crypto.getRandomValues` or `crypto.subtle`; without `polyfills.js`, Supabase PKCE can't generate the code verifier or challenge, and OAuth silently fails with "invalid flow state"
- `polyfills.js` must be the first import in `index.js` — it runs before any Supabase code and patches `globalThis.crypto` using `expo-crypto`

### Phase completion status

- **Phase 1** ✅ — Scaffold, navigation, HomeScreen, AuthScreen (email/password), GravestoneLogo, AsyncStorage
- **Phase 2** ✅ — Full camera pipeline, all API modules ported, ResultScreen, SettingsScreen, Google OAuth wired
- **Phase 3** ✅ — Maps: react-native-maps, per-cemetery map, GPS capture via expo-location
- **Phase 4** ✅ — Global community map (public stories from Supabase, port of web map-global.js), Supabase sync wired to mobile
- **Phase 5** ✅ — R2 image upload, story deletion (HomeScreen long-press), Settings screen (display name, visibility toggle, account info)
- **Phase 6** ✅ — Gravestone photo in ResultScreen, delete from ResultScreen, draggable pin correction in CemeteryMapScreen, app icon + splash screen
- **Phase 7** ✅ — Polish pass + tester APK: rejection bypass, pipeline error screen, first-run empty state, loading step labels, EAS preview build config
- **Phase 7b** ✅ — UI/UX polish: gravestone SVG camera screen (flicker animation, "Tap" text, bottom-sheet picker), candle loading animation, story card delete button
- **Phase 8** ✅ — Full visual design overhaul: theme.js design system (Fraunces + Hanken Grotesk, new palette), Icons.js SVG set, all screens redesigned. Per-user storage isolation (user-scoped AsyncStorage keys). forwardGeocode multi-query, geographic context filter, grave-cache.js. Custom SVG gravestone map marker. Pull-to-refresh on all screens. Bug fixes: CemeteryMapScreen userId, syncOnSignIn full-pull-on-empty.
- **Phase 8b** ✅ — Mobile pin accuracy: replaced non-functional Overpass grave-node search with two-pass Nominatim+Photon approach. Nominatim uses viewbox bias without `bounded=1` (avoids importance-score cutoff) + bbox proximity filter. Photon (Elasticsearch-backed) as fallback for low-importance grave nodes. Camera/EXIF GPS always takes priority over geocoded coords. Removed mobile boundary polygon — Nominatim polygon_geojson produced incorrect boundaries that excluded the actual grave markers.
- **Phase 8c** ✅ — Mobile codebase cleanup (no behaviour changes): removed debug console data-dumps from all API modules; extracted StoryCard to module level + React.memo in RememberedStoriesScreen; added GPS guard to GlobalMapScreen; moved normalizePortraits to api-wikipedia.js; extracted shared EXPAND abbreviation table to abbreviations.js; created useRefresh hook applied to all 8 screens; GlobalMapScreen now uses rowToStory from sync.js instead of its own duplicate mapping.
- **Phase 8d** ✅ — Play Store readiness audit + bug fixes: fixed cold-start Google OAuth bug (App.js was passing full callback URL to exchangeCodeForSession instead of extracting the code param — same pattern as AuthScreen.js); added ErrorBoundary class component in App.js wrapping the entire navigator; set userInterfaceStyle to 'dark'; added eas.json production profile (buildType: 'aab') + Android submit track config; added 30s fetchWithTimeout on all Gemini API calls; GlobalMapScreen surfaces fetch errors to the user instead of showing empty state; SettingsScreen sign-out now requires confirmation Alert. Supabase email provider re-enabled.
- **Phase 8e** ✅ — Canonical graves + candle/flower tributes + EAS Update: `graves` table deduplicates multiple scans of the same physical stone; `tributes` table (one candle or flower per user per grave, UNIQUE constraint); `find_or_create_grave` RPC (atomic ~20 m name-match dedup); `update_grave_location` RPC (first user-correction wins, propagated from CemeteryMapScreen pin drag); `api-tributes.js` (getTributes/setTribute); `source` field on stories tracks camera vs library; GlobalMapScreen client-side dedup by grave_id then ~20 m GPS cell; ResultScreen shows tribute counts always + candle/flower buttons only for own camera-sourced stories; EAS Update configured (expo-updates installed, updates.url + runtimeVersion in app.config.js, channel on preview + production profiles) — testers install one new APK then all future JS changes push OTA via `npx eas update --branch preview`.
- **Phase 8f** ✅ — Web parity for Phase 8e features: (1) `js/persistence.js` — added `grave_id` + `source` to `storyToRow`/`rowToStory`; (2) `index.html` pipeline — `currentPhotoSource` ('camera'/'library') tracked on upload, `findOrCreateGrave` RPC called after biography when signed-in user has GPS; (3) `js/map-global.js` — client-side dedup by `grave_id` then ~20 m GPS cell (same logic as mobile `GlobalMapScreen`); (4) new `js/api-tributes.js` — vanilla JS port of `getTributes`/`setTribute` using `supabaseClient`; (5) `js/render-result.js` — `renderTributeSection` shows tribute counts always when `grave_id` present, candle/flower buttons for camera-sourced non-global stories only.
- **Phase 8g** ✅ — Search + biography quality pass: (1) Android nav bar fix — `CemeteryMapScreen` and `GlobalMapScreen` use `useSafeAreaInsets` to add `paddingBottom: insets.bottom + 8` to bottom panel (both screens use `edges={['top']}` so SafeAreaView doesn't handle the bottom); (2) Tavily query priority overhaul — queries now built in priority order so symbol-guided and general obituary queries actually fire (previously always cut off), duplicate FindAGrave merged into one, ChroniclingAmerica only for ≤1922 deaths, session-level `_searchCache` prevents re-querying same person on family plots; (3) Multi-person combined biography — when `multiple_subjects === true`, pipeline fetches Wikipedia for each person in parallel, `generateBiography` accepts `wikipediaSummary` as array, prompt explicitly names all subjects and requires proportional coverage, `name` uses " & " and `dates` uses " · " separators; (4) Biography prompt overhaul (Opus review) — Gemini structured output (`responseMimeType` + `responseSchema`), `citations [{n,description,url}]` schema converted to `sources`/`source_urls` for compat, evidence ladder for length (up to 1000 words), symbol rule describes conventional meaning not individual assertion, conflict resolution surfaces discrepancies in text, historical-figure exception requires Wikipedia in sources (memory not a source), `name_confidence: "low"` triggers identity hedging, TYPE_LABELS simplified to short tags.
- **Phase 9** 🔄 — All stories complete except Story 1.4 (Re-enable RevenueCat SDK — Play Store account activated 2026-06-06; waiting on real RevenueCat production key). `phase-9` merged to `main`. Epic 2 (Play Store Launch) in-progress: production AAB in Play Console internal testing. Two post-submission quality bugs fixed via OTA to the `production` channel — the X-Client-Key 403 scan bug (Session 6) and the multi-subject biography demotion bug (Session 7).

---

### EAS build config

- `app.config.js` slug: `"mobile"` (matches the EAS project registration — do not change back to "gravestory")
- `app.config.js` owner: `"j3k420"`
- `scheme: "gravestory"` controls deep links — independent of slug
- `userInterfaceStyle: "dark"` — required for correct status bar on the dark-themed app; do not change back to "light"
- Google Maps Android API key stored as an EAS Secret (already created, scope: project, all environments)
- Preview build (installable APK for testers): `npx eas build --platform android --profile preview`
- Phase-9 personal test build (isolated channel): `npx eas build --platform android --profile phase9`
- Production build (AAB for Play Store): `npx eas build --platform android --profile production` — produces an AAB; submit track set to "internal" in eas.json
- Development build (live Metro reload): `npx eas build --platform android --profile development` — connect phone via `adb reverse tcp:8081 tcp:8081` then `npx expo start`
- Before first production build run `npx eas credentials` to generate/upload the Android keystore
- Testers install via direct `.apk` link; subsequent updates install over the top automatically
- **Do NOT use `.catch()` on Supabase query builder results** — Hermes JS engine does not support it. Use `try { await supabase... } catch (e) {}` instead. Applies to all mobile code.

### Phase 9 — Scope

**Completed:**
- ~~Grave photo gallery~~ ✅ `grave_photos` table + global map gallery (web + mobile). Run `003_grave_photos.sql`.
- ~~Biography result cache~~ ✅ `find_grave` RPC + pipeline cache. Run `002_find_grave.sql`.
- ~~Freemium save limit~~ ✅ Guest cap 3, free signed-in cap 5. `mobile/src/lib/save-limit.js`, `PaywallScreen.js`, `SettingsScreen` progress bar. `is_unlimited: true` in Supabase `app_metadata` bypasses all limits for testers (set via SQL editor, read-only by clients).
- ~~Freemium scan limit~~ ✅ Monthly reset, same caps as save limit (guest 3, free 5). `mobile/src/lib/scan-limit.js`, `scan_events` table (immutable rows — INSERT/SELECT only via RLS, no UPDATE/DELETE so clients cannot reset their own count). Run `004_scan_events.sql`. Counts stored server-side in Supabase, not in `user_metadata`.
- ~~phase9 EAS build profile~~ ✅ Isolated `phase-9` OTA channel so tester `preview` builds are never affected. Personal test build: `npx eas build --platform android --profile phase9`.
- ~~Device fingerprinting~~ ✅ `mobile/src/lib/device-id.js` — SHA-256 hash of `expo-device` properties (brand, model, OS name, OS version, total RAM) via `expo-crypto`, cached in AsyncStorage. Survives reinstall (same hardware → same hash). Attached to `user_metadata.device_id` on email sign-up in `AuthScreen.js`. `expo-device` is a native module — requires a build to activate.
- ~~Portrait persistence~~ ✅ `expo-file-system` installed. `persistPortrait()` helper in `api-wikipedia.js` copies ImageManipulator temp `file://` URIs into `FileSystem.documentDirectory + 'portraits/'` before they are stored on the story. Portraits now survive app restarts. `expo-file-system` is a native module — requires a build to activate.
- ~~Global map portraits~~ ✅ `ResultScreen.js` live-fetches `fetchWikipediaPortraits` on mount for global stories that have no locally-persisted portraits (file:// URIs are device-local and cannot be stored in Supabase). Portraits appear in the carousel a moment after the bio renders.

**Also completed (Phase 9 Session 2):**
- ~~Freemium save limit~~ ✅ Bumped `FREE_LIMIT_USER` from 5 → 10 for launch. Guest cap stays at 3.
- ~~Freemium scan limit~~ ✅ Bumped `SCAN_LIMIT_FREE_USER` from 5 → 10. Changed from monthly-reset to lifetime one-time trial (no reset) — controls Tavily API costs. `scan_events` table counts lifetime scans; `scan_credits` table holds purchased credits (service-role write only). Migration `005_scan_credits.sql` run ✅.
- ~~Monetization model~~ ✅ Credits-only (no subscriptions). Three packs: Starter (5 scans/$0.99 · `gravestory_5_scans`), Explorer (20 scans/$2.99 · `gravestory_20_scans`), Historian (60 scans/$6.99 · `gravestory_60_scans`). Credits never expire.
- ~~RevenueCat SDK~~ ✅ `react-native-purchases` installed. Products and offerings configured in RevenueCat dashboard (`gravestory_5_scans`, `gravestory_20_scans`, `gravestory_60_scans`). RevenueCat init currently **disabled** in `App.js` (test key caused native crash in release builds). `REVENUECAT_API_KEY` exported from `config.js`. Re-enable once Play Store account obtained and real production key issued.
- ~~hasFamousSubject shared stone fix~~ ✅ When `multiple_subjects === true` and any Wikipedia summary was found for a subject, `hasFamousSubject = true` — unlocks full 2500-word bio for the notable person while still giving the lesser-documented person a dignified paragraph. Condition requires only `wikiSummaries.length > 0` (not a source-count threshold). Applied to both `js/biography.js` and `mobile/src/lib/biography.js`.
- ~~Settings screen cleanup~~ ✅ Removed "coming soon" hints; renamed "Scans This Month" → "Free Scans Used"; removed monthly-reset copy.

**Also completed (Phase 9 Session 3 — security hardening):**
- ~~Stored XSS in map popups~~ ✅ All AI-generated content (biography, name, dates, location, contributor, image URLs) now escaped via `escapeHtml()` before `innerHTML` injection in `map-global.js` and `map-cemetery.js`.
- ~~JSON-in-onclick in cemetery map~~ ✅ Replaced with `_cemeteryStoryCache` lookup + `viewCemeteryStory(key)` function. Story objects are never serialized into HTML attributes.
- ~~XSS in home-screen cards~~ ✅ `renderSavedList()` escapes name and dates.
- ~~Unescaped source links in render-result.js~~ ✅ Source URL and description escaped; `rel="noopener noreferrer"` added to all external links.
- ~~Web had zero scan/save limits~~ ✅ New `js/scan-limit.js`: guest (3 lifetime), free signed-in (10 + purchased), fail-closed on Supabase error. `checkWebScanLimit` gates `startAnalysis`; `checkWebSaveLimit` gates `saveStory`.
- ~~Mobile scan limit fail-open on Supabase error~~ ✅ `checkScanLimit` now returns `{ atLimit: true, _checkFailed: true }` on error instead of `{ atLimit: false }`. `CameraScreen` shows a connection-error Alert on `_checkFailed`.
- ~~`_globalStoryLookup` memory leak~~ ✅ Cleared in `initGlobalMap` on every map open.
- ~~RevenueCat test key committed bare~~ ✅ Warning comment added; production key must be an EAS Secret.
- ~~BMAD-METHOD install~~ ✅ `_bmad/` folder committed. 44 skills available in `.claude/skills/` for Claude Code sessions.

**Also completed (Phase 9 Session 4):**
- ~~Run `005_scan_credits.sql`~~ ✅ Story 1.1 — run in Supabase SQL editor 2026-06-05.
- ~~Cloudflare Worker origin check~~ ✅ Story 1.2 — `ALLOWED_ORIGIN` enforced; `CLIENT_KEY` path unaffected. Deployed.
- ~~RevenueCat webhook~~ ✅ Story 1.3 — `POST /revenuecat-webhook` handler in Worker; `REVENUECAT_WEBHOOK_SECRET` + `SUPABASE_SERVICE_KEY` set via wrangler; `NON_RENEWING_PURCHASE` + `INITIAL_PURCHASE` handled; smoke-tested. Migration `006_add_increment_credits_fn.sql` run. RevenueCat dashboard webhook active.
- ~~Privacy policy page~~ ✅ Story 1.5 — live at `https://j3k420.github.io/gravestory-privacy/` (separate `J3K420/gravestory-privacy` GitHub Pages repo). Privacy Policy link added to mobile `SettingsScreen` (Linking.openURL) and web Settings screen (anchor tag).
- ~~Store listing assets~~ ✅ Story 1.6 — `store-listing/description.md` (short 77 chars + full ~1450 chars) and `store-listing/feature-graphic.svg` (1024×500 dark gothic SVG). Screenshots pending user capture on device → `store-listing/screenshots/`.
- ~~Dead code removal~~ ✅ Deleted orphaned `js/home-screen.append.js` (never loaded); removed redundant local `escapeHtml` in `js/render-result.js`.
- ~~Home screen tagline~~ ✅ Added *"Other apps show you the grave. GraveStory discovers the life that was."* below desc on web + mobile home screens.
- ~~Service worker bumped to v14~~ ✅ Forces cache refresh for users on old cached version.
- ~~phase-9 merged to main~~ ✅ All Phase 9 work live on GitHub Pages.

**Also completed (Phase 9 Session 5):**
- ~~Google Play developer account~~ ✅ Activated 2026-06-06. Individual account, developer display name TBD. Unblocks Epic 2 (Play Store Launch).

**Also completed (Phase 9 Session 7 — 2026-06-07):**
- ~~Multi-subject biography demotion bug~~ ✅ Shared family stones (Amy Winehouse + grandmother) produced a short bio that demoted the famous person to a one-line mention. Root cause: namesake date-guard validated the famous figure against the primary person's top-level dates. Fix: OCR emits a per-person `subjects` array; `biography.js` validates the guard per-person against each subject's own dates and treats `subjects.length > 1` as multi-subject; pipeline fans research out per subject with each person's own dates. Web + mobile parity. See the **Multi-subject per-person biography** key-behavior note above.
- ~~bmad-code-review of the fix~~ ✅ Ran Blind Hunter + Edge Case Hunter (Acceptance Auditor skipped — no spec). 0 Critical/High; 4 low/medium patches applied (stone-only fallback now names every subject; dropped misleading date fallback; tightened OCR `subjects` prompt against dupes/aliases/relatives; strict `=== true` parity).
- ~~Committed + pushed + OTA~~ ✅ Commits `75179bf` (fix) + `174115b` (store screenshots, privacy-policy page, recommendation docs, gitignore `worker/.wrangler/`) pushed to `phase-9`. OTA published to the **`production`** channel (where live testers are — NOT `preview`; verify channel with `eas channel:list` before each OTA).

**Also completed (Phase 9 Session 8 — 2026-06-07):**
Three-round debug of Amy Winehouse shared-stone biography. All three rounds committed and pushed to `phase-9`; three OTAs shipped to `production` channel same session.
- ~~Round 1 — OCR false-positive + misleading warning~~ ✅ Commit `68558fb`. `multiple_subjects` description tightened to "ONLY physically separate freestanding markers — if uncertain, return false". `subjects` description changed to "every deceased person visible anywhere in this photo" (was "on this stone" — caused Amy to be dropped when model believed markers were separate). Warning condition changed to `multiple_subjects === true && subjects.length <= 1` — suppressed when OCR correctly captured all people on a shared stone. Applied to `js/api-gemini.js`, `mobile/src/lib/api-gemini.js`, `index.html`, `CameraScreen.js`.
- ~~Round 2 — Famous subject still getting one sentence~~ ✅ Commit `b1859f4`. Root cause: model counted source records to determine "well-documented" — Cynthia had 3 (FindAGrave/WikiTree/Tavily), Amy had 1 + Wikipedia. Model labeled Amy "lesser-documented" and gave her one sentence. Fix: `multiSubjectBlock` in biography prompt now explicitly states "Do NOT judge significance by source count — a Wikipedia article outweighs all of them. Write the subject whose name matches the [Wikipedia article] source FIRST." New LENGTH rule bullet: when any subject has a [Wikipedia article], that subject qualifies for ~2500-word treatment regardless of other source count. Applied to `js/biography.js` + `mobile/src/lib/biography.js`.
- ~~Round 3 — Famous subject still only one paragraph~~ ✅ Commit `84d113b`. Root cause: "Do not use facts from memory" instruction acted as a hard ceiling — model paraphrased only the Wikipedia REST extract (~300 chars) and stopped even after correctly identifying Amy. Fix: WELL-DOCUMENTED HISTORICAL FIGURES section now explicitly authorises the model to use its knowledge once all conditions pass — "The [Wikipedia] article [N] is your authoritative anchor — you are NOT restricted to paraphrasing only the extract text. Use the full ~2500-word allowance." "Memory is not a source" moved to failure path only. Applied to both `biography.js` files.

**Remaining (Epic 1):**
- **Re-enable RevenueCat SDK** (Story 1.4) — Play Store account now active ✅ → get real production API key from RevenueCat dashboard → uncomment imports in `App.js` and `PaywallScreen.js` → trigger new build.
- **Store listing screenshots** — drop into `store-listing/screenshots/` and commit. Home screen + biography result captured; better shots in progress.

**Epic 2 — Play Store Launch (now unblocked):**
- **Story 2.1 — EAS credentials**: run `npx eas credentials` once to generate/upload Android keystore. Run before first production build.
- **Story 2.2 — Production AAB + submission**: `npx eas build --platform android --profile production` → upload AAB to Play Console → content rating questionnaire → internal track → production rollout.

**Shelved:**
- ~~GEDCOM export~~ — not enough family relationship data to produce meaningful family trees. Revisit if app later tracks spouse/parent/child links.
- ~~Family/subscription tier~~ — excluded due to unbounded Tavily API cost risk with unlimited scanning. Credits-only model chosen instead.

**Requires $99/yr Apple Developer account:**
- iOS TestFlight build

**Tester admin notes:**
- Set `is_unlimited: true` in a user's `app_metadata` via Supabase SQL editor to bypass all limits: `UPDATE auth.users SET raw_app_meta_data = raw_app_meta_data || '{"is_unlimited": true}'::jsonb WHERE id = '<user-id>';`
- Current unlimited accounts: Jimmy Crackcorn (j3k420@gmail.com), James Edmonds (james.edmonds26@gmail.com)

---

## Known limitations

- **3-person stones — Tavily research gap**: `searchForPerson` fires up to 6 Tavily query slots per scan. Slot 4 is assigned to the second person on a multi-subject stone (FindAGrave only); the third person gets no dedicated Tavily slot and their biography section relies solely on the stone inscription and any Wikipedia article found. Portraits and Wikipedia article summaries ARE fetched for all 3 people (via `wikiNames.slice(0, 3)`). A fix would require restructuring the 6 slots to distribute 2 slots per person for a 3-person stone (e.g. FindAGrave + obituary for each), reducing per-person depth in exchange for breadth. Not worth the complexity until 3-person stones prove common in the wild.
  - **User-facing disclaimer**: when `graveData.multiple_subjects === true` and `graveData.names?.length >= 3`, the existing multi-person Alert/loading-step warning (web and mobile) should include an extra line: "For stones with 3 or more people, research depth is reduced for the third person and beyond. For a full biography, photograph each stone individually." This can be added to the Alert text in `CameraScreen.js` and the `setLoadingStep` call in `index.html` with a simple length check on `graveData.names`.

- **Search Rec 2 (FamilySearch) — shelved until GraveStory is a launched product**: FamilySearch does not allow registration for projects that aren't live products. Revisit when GraveStory has a public Play Store / App Store presence. At that point: register at `familysearch.org/developers`, store `client_id` in the Cloudflare Worker, implement `api-familysearch.js` (web + mobile) with `unauthenticated_session` token caching, map results to the same shape as WikiTree, and add to `buildCorroborationSummary`.

- **Search Rec 6 (biography result cache) — ✅ implemented**: `find_grave` RPC (`supabase-migrations/002_find_grave.sql`) is the read-only companion to `find_or_create_grave`. After `readGravestone`, if the user is signed in and GPS is available, the pipeline calls `find_grave(primaryName, lat, lng)` → if hit, queries `stories` for the most recent public story on that `grave_id` within 90 days → if found, skips all Tavily + WikiTree + Wikidata + Gemini steps and uses the cached biography directly. Portrait URLs stored on the cached story are reused; if absent, a fresh Wikipedia fetch still runs. `forwardGeocode`, GPS snapping, and `find_or_create_grave` (or reuse of `cachedBio.grave_id`) all run normally. Guest users and GPS-less scans always run the full pipeline. **To activate: run `supabase-migrations/002_find_grave.sql` in the Supabase SQL editor.**
