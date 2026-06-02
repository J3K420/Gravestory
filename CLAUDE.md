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
5. Parallel research: Tavily web search + WikiTree genealogy + Wikipedia
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
| PWA | Inline service worker (cache v12), beforeinstallprompt banner |
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
  api-gemini.js          — geminiCallWithFallback, verifyIsGravestone, readGravestone. readGravestone emits name_confidence (high/medium/low), alternate_names (1-2 alternate spellings when weathered), multiple_subjects (true when photo shows separate distinct stones), and specific symbol names.
  api-nominatim.js       — reverseGeocode (GPS coords → "City, State") + forwardGeocode (Nominatim + Overpass named-grave search). reverseGeocode is already called in the pipeline before readGravestone.
  api-tavily.js          — searchForPerson. Contains: _EXPAND nickname table (~60 entries), _expandName(), _parseAgeAtDeath() (derives missing year from "aged N yrs" inscription), _SYMBOL_QUERIES map (GAR/Masonic/Odd Fellows/military/VFW → targeted record repos). Uses graveData.alternate_names as extra variants when name_confidence ≠ high.
  api-wikitree.js        — searchWikiTree(graveData, location). Three-pass search: date-filtered → unfiltered → expanded-first-name fallback. Nickname-aware _wtFirstNamesMatch(). Geographic alignment scoring: _wtExtractUSState() + ±30/−20 on burial-state match/mismatch.
  api-wikipedia.js       — fetchWikipediaPortraits (returns { left, right }), fetchWikipediaArticleSummary (article lead text → { title, extract, url } for bio grounding; no image download)
  biography.js           — generateBiography(graveData, searchResults, wikiData, location, wikipediaSummary). _buildCorroborationSummary() surfaces name/date agreement and conflicts across sources in the prompt. _validateCitations() strips orphan [N] markers post-generation. Namesake guard requires ±5yr date alignment before invoking historical-figure mode. Optional wikipediaSummary param adds a Wikipedia article as a numbered source.
  auth.js                — Supabase client, sign-in/up/out, user-menu
  user-prefs.js          — Display name + default visibility (Supabase user_metadata)
  persistence.js         — storyToRow/rowToStory, cloud upsert/delete, localStorage
  sync.js                — Incremental delta sync (updated_at watermark) + pushLocalOnly
  save-actions.js        — saveStory, shareStory, exportCemeteryData
  render-result.js       — Paints the biography result screen
  error-render.js        — Gravestone rejection + generic error screens
  loading-ui.js          — setLoadingStep: updates loading text during pipeline
  photo-modal.js         — Photo source modal (camera vs library)
  location-permission.js — Location permission modal + privacy info modal
  home-screen.js         — renderSavedList, loadSaved, deleteSaved. Saved list now lives on the #remembered-stories screen; renderSavedList() is called by showScreen() when navigating there.
  home-screen.append.js  — updateHomeMapButton
  map-utils.js           — groupGravesByCemetery, getDistanceMeters
  map-cemetery.js        — Per-user cemetery map (Leaflet, drag-to-correct, OSM boundary)
  map-global.js          — Community global map (public stories, guest gate)
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

The main pipeline (`startAnalysis`, `handleImageUpload`, `showScreen`, `uploadImageToR2`, `getDeviceLocation`, `forwardGeocode`) and all shared state (`currentStory`, `savedStories`, `currentImage`, `currentExifLocation`, `locationPermission`, `_bypassVerification`) live in the inline `<script>` block inside `index.html`. Extracted modules read and write these via plain identifier references (shared lexical scope).

### Stage-based extraction refactor

The codebase has been systematically extracted from a monolithic `index.html` into separate files across numbered stages (currently **Stage 13**). Each extracted module has a header block documenting:
- Public API surface
- External symbols consumed
- Load-order requirements
- Timing-safety audit (what runs at parse time vs DOMContentLoaded vs call time)

Follow this pattern when extracting more code.

### All API secrets stay server-side

No API keys in client JS. Every sensitive call routes through `PROXY_BASE` (Cloudflare Worker). The only client-side config is `PROXY_BASE` in `config.js`.

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

### CSS approach

One CSS file per screen/component. CSS custom properties in `base.css`. No preprocessor.

**Design language — dark gothic:**
- Background: `#1a1410` (near-black warm brown)
- Gold accent: `#c9a84c`
- Warm cream text: `#e8d4a0`
- Headings: Playfair Display (serif)
- Body/UI: Crimson Pro (serif)

### Mobile-first PWA

Built for one-handed use in a cemetery. Service worker caches the app shell (`gravestory-v12`) and Leaflet map tiles separately. iOS users get a manual "Add to Home Screen" hint (Safari doesn't support `beforeinstallprompt`).

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

- **Mobile per-user storage isolation** — `loadStories(userId)` / `saveStories(stories, userId)` in `mobile/src/lib/storage.js` use key `gs_stories_${userId}` for signed-in users and `gs_stories_guest` for guests. Every call site (HomeScreen, CameraScreen, CemeteryMapScreen, ResultScreen, sync.js) must pass the userId from `supabase.auth.getSession()`. Never call these functions without a userId argument — that silently reads the guest bucket.

- **Mobile syncOnSignIn always does a full pull** — `syncOnSignIn` in `mobile/src/lib/sync.js` always pulls all cloud stories (not just delta) on sign-in. Cloud is authoritative; local stories are only kept if they have no `id` field (never been pushed). This prevents contaminated/stale local data from persisting across account switches. `syncDelta` (called on every HomeScreen focus) handles incremental updates after sign-in.

- **Tavily inscription-phrase disambiguation** — when the OCR returns a bare surname with no dates (e.g. "TOMB OF WASHINGTON"), `searchForPerson` prepends two high-priority queries that search the inscription text verbatim before falling back to name-only queries. Prevents generic surname searches returning cemetery-name results instead of the actual person. Applies to both `js/api-tavily.js` and `mobile/src/lib/api-tavily.js`.

- **Search accuracy improvements (Session 9)** — layered improvements now live in both `js/` (web) and `mobile/src/lib/` (mobile):
  - *GPS-derived location hint* — `reverseGeocode(lat, lng)` converts GPS coords to "City, State" before OCR and all search calls. Web: already in the pipeline via `currentExifLocation`; mobile: fires in parallel with `verifyIsGravestone`. The location string is threaded into `readGravestone`, `searchForPerson`, `searchWikiTree`, and `generateBiography`.
  - *Nickname/abbreviation expansion* — `EXPAND` table (~60 entries) in `api-tavily.js` and `api-wikitree.js` maps period abbreviations and informal names (Wm→William, Geo→George, Lizzie→Elizabeth, etc.) to formal forms. Tavily fires queries for both forms; WikiTree's `firstNamesMatch()` is nickname-aware and adds a third search pass with the expanded first name when the abbreviated form returns nothing.
  - *Age-at-death parsing* — `parseAgeAtDeath()` in `api-tavily.js` extracts approximate birth or death year from inscription phrases like "aged 72 yrs" or "aet. 45", unlocking date-filtered queries for stones with no explicit dates.
  - *WikiTree geographic scoring* — `searchWikiTree` accepts a `location` param; `extractUSState()` parses a state and adds ±30/−20 to candidate scores based on burial-state match/mismatch.
  - *Symbol-guided Tavily queries* — `SYMBOL_QUERIES` map (~30 entries) routes recognised emblems to targeted record repositories: GAR → Civil War veteran queries, Masonic/Odd Fellows/Elks/KofC/VFW/military branch symbols each fire their own precision query.
  - *OCR alternate readings* — `readGravestone` emits `name_confidence` (high/medium/low), `alternate_names` (1-2 plausible alternate spellings), and `multiple_subjects` (true when photo clearly shows multiple separate distinct stones). Alternate readings feed into Tavily query variants when confidence is not high.
  - *Multi-stone detection* — when `graveData.multiple_subjects === true`, the pipeline shows a warning (web: loading-step text; mobile: Alert) that the bio will focus on the primary inscription and the user should photograph each stone separately.
  - *Cross-source corroboration* — `_buildCorroborationSummary()` in `biography.js` checks name/date agreement across WikiTree, FindAGrave, BillionGraves, and obituaries and injects a structured corroboration block into the bio prompt. Date conflicts are flagged explicitly so the model doesn't silently blend conflicting claims.
  - *Wikipedia article grounding* — `fetchWikipediaArticleSummary(name, dates)` (in both `js/api-wikipedia.js` and `mobile/src/lib/api-wikipedia.js`) does a lightweight Wikipedia search + summary fetch (no image download) and returns the article lead text as a numbered source. Fired in parallel with Tavily + WikiTree; threaded into `generateBiography` as the 5th `wikipediaSummary` param. Historical-figure bios must cite this source with `[N]` markers rather than relying on recalled knowledge.
  - *Citation integrity* — `_validateCitations()` in `biography.js` strips any `[N]` markers whose index exceeds the sources array after generation, preventing orphan citations that appear authoritative but point to nothing.
  - *Namesake collision guard* — the historical-figure exception in `biography.js` now requires BOTH date alignment (±5 years) AND that the Wikipedia article (if found) confirms the same person before invoking full-biography mode. Prevents "John Adams d.1931" inheriting the Founding Father's biography.

- **Historical figures biography exception** — `generateBiography` explicitly instructs Gemini that the anti-fabrication rule applies to private individuals only. For clearly identified major historical figures (presidents, monarchs, generals, etc.) the model MUST write a full biography grounded in the Wikipedia article text provided as a numbered source (cite with `[N]` markers) and well-established historical facts. A two-paragraph biography for George Washington is considered a failure. The namesake guard requires BOTH ±5yr date alignment AND Wikipedia article confirmation before this exception activates. Applies to both `js/biography.js` and `mobile/src/lib/biography.js`.

- **Mobile Wikipedia portraits return an array** — `fetchWikipediaPortraits` in `mobile/src/lib/api-wikipedia.js` returns `string[]` (up to 5 local file URIs), not the `{ left, right }` object used by the web version. Each URL is downloaded and resized to an 800px JPEG via `expo-image-manipulator` so React Native always gets a local `file://` URI it can decode. `ResultScreen` uses `normalizePortraits()` to handle both the old `{ left, right }` format (stored in older saved stories) and the new array format.

- **Mobile map callout is a floating overlay, not `<Callout>`** — `react-native-maps` `<Callout onPress>` with custom child Views silently swallows touch events on Android. `CemeteryMapScreen` uses a state-driven `View` overlaid on the map instead. Tapping a marker sets `selectedStory` state; tapping the map or the ✕ button dismisses it. The overlay includes a "▼ Read bio" toggle that expands the first two biography paragraphs inline. Do not replace this with `<Callout>`.

- **Mobile gravestone map marker** — `CemeteryMapScreen` uses a custom SVG gravestone icon (`GravestoneMarker` component, rendered by `GraveMarker` wrapper) that matches the web Leaflet `divIcon` design: arched stone body, open book, cross. The `GraveMarker` wrapper manages `tracksViewChanges` state — starts `true` so react-native-maps captures the SVG on first layout, then flips to `false` via `onLayout` to stop re-snapshotting. Do not use `tracksViewChanges={false}` unconditionally — the native map takes its bitmap snapshot before SVG finishes painting and the marker disappears.

- **Portrait retry after bio resolves full name** — `CameraScreen` fetches Wikipedia portraits in the parallel step using `graveData.primary_name`. When the stone shows only a surname (e.g. "HOUDINI"), the single-token guard fires and returns empty. After `generateBiography` resolves the full name, `CameraScreen` retries by splitting `bioResult.name` on `" and "` and calling `fetchWikipediaPortraits` for each part. This is why portraits appear for stones with surname-only inscriptions.

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
      api-gemini.js             — verifyIsGravestone, readGravestone (ES module). readGravestone returns name_confidence (high/medium/low), alternate_names (1-2 alternate spellings when stone is weathered/ambiguous), and multiple_subjects (true when photo shows multiple separate distinct stones) in addition to standard fields.
      api-tavily.js             — searchForPerson (ES module). Contains: EXPAND nickname table (~60 entries), expandName(), parseAgeAtDeath() (derives missing year from "aged N yrs" inscription phrases), SYMBOL_QUERIES map (routes GAR/Masonic/Odd Fellows/military emblems to targeted record repositories). Uses graveData.alternate_names as extra query variants when name_confidence ≠ high.
      api-wikitree.js           — searchWikiTree(graveData, location) (ES module). Signature accepts location string for geographic scoring. Contains: EXPAND table (subset), formalFirst(), firstNamesMatch() (nickname-aware), extractUSState(), STATE_ABBREVS. Three search passes: date-filtered → unfiltered → expanded-first-name fallback. Geographic alignment adds ±30/−20 to candidate scores.
      api-wikipedia.js          — fetchWikipediaPortraits (ES module, adds User-Agent header). Returns array of up to 5 local JPEG URIs (resized via expo-image-manipulator). imageFilenameMatchesPerson uses substring containment + strips Wikimedia "NNNpx-" thumbnail prefix so CamelCase and thumbnail filenames match correctly. fetchWikipediaArticleSummary(name, dates): lightweight search + summary fetch (no image download), returns { title, extract, url } or null for bio grounding.
      biography.js              — generateBiography(graveData, searchResults, wikiData, location, wikipediaSummary) (ES module). buildCorroborationSummary() injects name/date agreement and conflict signals across sources into the prompt. validateCitations() strips orphan [N] markers post-generation. Namesake guard requires ±5yr date alignment AND Wikipedia article confirmation before invoking historical-figure mode. wikipediaSummary (optional 5th param) adds the article as a numbered source.
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
      ResultScreen.js           — Biography (Fraunces serif), full-width paging FlatList image carousel at top (gravestone photo first, then Wikipedia portraits), inscription, sources. normalizePortraits() handles both old { left, right } and new array portrait formats for backward compat. Action chip row: Map / Share / Public toggle. Scan Again + Delete buttons. Pull-to-refresh re-reads the story from AsyncStorage to pick up synced changes.
      SettingsScreen.js         — Display name, default visibility toggle, account info, sign out. Grouped sections, gradient save button. Pull-to-refresh re-fetches the session to reload profile metadata.
      CemeteryMapScreen.js      — react-native-maps: grave markers (custom SVG GravestoneMarker via GraveMarker wrapper), floating overlay callout (NOT <Callout> — Android unreliable), "Read bio" pull-down (first 2 bio paragraphs), draggable pin correction, bottom list. No boundary polygon — see mobile Overpass note below. loadStories/saveStories always called with userId from session. Pull-to-refresh on the bottom grave list re-runs resolveStories.
      GlobalMapScreen.js        — Community map: public stories from Supabase RPC, silver markers, guest banner. Globe icon header. 5-minute module-level cache (_cache/_cacheTime/_cacheUserId). Pull-to-refresh busts the cache and re-fetches.
    components/
      GravestoneLogo.js         — Animated SVG gravestone logo; accepts animate={false} for static rendering. Two independent animation loops: (1) flicker — alternates slow candle-waver phases (400–600ms), burst of rapid blinks, and long near-out dims; (2) sweeping shimmer — AnimatedG translates a tilted gradient Rect left→right every ~4s, clipped to the stone silhouette via ClipPath.
      Icons.js                  — SVG icon set: CandleMark, Headstone, MapStack, Globe, ShareIcon, Pin. All accept size + color props.
```

### Mobile conventions

- ES modules (`import`/`export`) — opposite of web's classic scripts
- `SafeAreaView` from `react-native-safe-area-context`, NOT from `react-native`
- `SafeAreaProvider` wraps the entire app in `App.js`
- All API calls use same `PROXY_BASE` as web — same Cloudflare Worker handles both
- `console.warn` (not `console.log`) for pipeline debug output — New Architecture (bridgeless) only forwards warns to DevTools
- **Pull-to-refresh** — every screen's primary `ScrollView` has a `RefreshControl` tinted `colors.flame`. Use `tintColor` (iOS) + `colors` array (Android). Each screen's `onRefresh` does the most meaningful action for that screen (see screen descriptions above).

### Mobile pipeline (CameraScreen.js)

1. expo-image-picker (`exif: true`) → read EXIF GPS before compression strips it → compress to 1024px JPEG → base64 via expo-image-manipulator
2. GPS source: EXIF coords from the photo if present; device GPS fallback only for **camera shots** (not library picks — device location would be wrong for historical photos)
3. `reverseGeocode(gps.lat, gps.lng)` fires **in parallel** with `verifyIsGravestone` — converts GPS coords to "City, State" string (`locationHint`) before any search queries execute. If no GPS, locationHint is null.
4. `verifyIsGravestone(base64)` — throws `{ __verificationRejection: true }` → rejection UI
5. `readGravestone(base64, locationHint)` — Gemini OCR → structured JSON including `name_confidence`, `alternate_names`, and specific symbol names
6. Parallel: `searchForPerson(graveData, locationHint)` + `searchWikiTree(graveData, locationHint)` + `fetchWikipediaPortraits` (using `graveData.primary_name`; may return empty if stone shows only a surname) + `fetchWikipediaArticleSummary` (article lead text for historical-figure grounding). locationHint feeds nickname-expanded Tavily queries, symbol-guided queries, WikiTree geographic scoring, and alternate-reading variants.
7. `generateBiography(graveData, searchResults, wikiData, locationHint, wikipediaSummary)` — Gemini narrative or stone-only fallback. Wikipedia article injected as a numbered source; corroboration summary and citation validation applied.
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
- **Phase 9** 🔲 — Play Store submission prep, OTA updates (EAS Update), payments (RevenueCat + Google Play Billing), iOS TestFlight build.

---

### EAS build config

- `app.config.js` slug: `"mobile"` (matches the EAS project registration — do not change back to "gravestory")
- `app.config.js` owner: `"j3k420"`
- `scheme: "gravestory"` controls deep links — independent of slug
- Google Maps Android API key stored as an EAS Secret (already created, scope: project, all environments)
- Preview build (installable APK for testers): `npx eas build --platform android --profile preview`
- Production build (AAB for Play Store): `npx eas build --platform android --profile production`
- Testers install via direct `.apk` link; subsequent updates install over the top automatically

### Phase 9 — Planned scope

- Bug fixes from real-device tester feedback
- Play Store submission: $25 Google Play Developer account, store listing, privacy policy URL, content rating, AAB production build
- EAS Update (OTA): add `expo-updates` so JS-only fixes ship in seconds without a full rebuild
- Payments: RevenueCat + Google Play Billing for subscriptions / consumable credit packs (mandatory for Play Store; 15–30% Google cut)
- iOS TestFlight build (requires $99/yr Apple Developer account)
