# GraveStory — CLAUDE.md

## Working conventions

- **Review every substantive change before committing.** Run the `bmad-code-review` skill (adversarial: Blind Hunter + Edge Case Hunter, triaged) on any non-trivial code/SQL/logic change, fix what it surfaces, THEN commit. Skip only truly trivial edits (typo, copy tweak, version bump). For correctness-critical or unrunnable-here artifacts (e.g. raw SQL pasted into Supabase), also spawn a targeted validation subagent. This is a hard gate, not optional — it exists because review has caught real bugs that slipped self-review (e.g. the dashboard `group by` ordinal shift).
- **Always commit and push at the end of every session.** Do not leave work uncommitted.
- **Stake a FourThought prediction at the start of substantive work, reflect on it after.** Before building, run `node tools/fourthought.js predict "<what this session should achieve>" --valence N(1-10) --uncertainty F(0-1) [--branch B] [--tag X]` (alias `4t predict ...`). After it ships, `4t reflect <id> --outcome shipped|partial|failed|abandoned --worth N` — the tool auto-joins token spend + git activity and computes ROI/calibration. This is the ROI-tracking ledger (FourThought dialectic by speakerjohnash); the discipline of staking BEFORE the outcome is the whole point. Reports: `4t report calibration|roi|forecast|levers`. Skip for trivial one-off edits.
- **Mobile JS changes ship via OTA to the `production` channel** (where live testers are): `npx eas update --branch production --environment production`. Verify with `eas channel:list` before publishing. Native-module changes need a new build, not an OTA.
- **Any web change must bump the `CACHE` version in `sw.js`** (increment the `gravestory-vN` number at the top of `sw.js`) or users keep the old cached shell.
- **Mobile is the product; web is becoming a landing page. DO NOT maintain web/mobile parity for the scan/research pipeline.** Historically `js/` and `mobile/src/lib/` were parallel codebases kept in sync. That rule is RETIRED (decided 2026-06-27): the owner is turning the web app into a **thin pointer to the native apps** (see "Planned direction" below), so the web scan/research pipeline (`js/` OCR, Tavily/WikiTree/Wikidata/Wikipedia research, biography, save/sync) is a **deletion candidate, not a parity target**. Apply mobile changes to mobile only. Do NOT port pipeline logic to `js/`. The **community global map + public-bio serving** paths are the exception — they survive the pivot as the SEO/landing surface, so changes THERE still apply to both. When unsure whether a web path survives, treat it as not-surviving (don't invest) and confirm with the owner.

## What this app does

GraveStory is a mobile-first PWA (+ Expo Android app) for cemetery visitors. The user photographs a gravestone; the app produces a biographical story about the person buried there.

**Core flow:** photo → EXIF/device GPS → Gemini gravestone verification → Gemini OCR (structured JSON) → parallel research (Tavily, WikiTree, Wikidata, Chronicling America, Internet Archive, Wikipedia) → Nominatim/Overpass geocoding → Gemini biography → save / share / per-cemetery Leaflet map → optional public sharing on community global map.

## Planned direction: web → app landing page (DECIDED — direction is settled)

The owner is taking the web app from a co-equal product surface to a **thin landing page** whose job is to point visitors to the native apps on the **Google Play Store (Android)** and the **Apple App Store (iOS)**. The interactive scan/research pipeline is **mobile-only going forward**. The web PWA scan pipeline (`js/`) is a **deletion candidate** — do not extend it or keep it at parity with mobile.

- **Retained on web:** a public **community global map**, kept both as a real feature and as an **SEO surface** (indexable cemetery/biography pages to drive organic discovery + app installs). Exact scope (which bio content is indexable, how pages are generated) is still TBD, but the global-map + public-bio-serving paths are the parts that SURVIVE — changes there still apply to web.
- **Decided 2026-06-27:** the parity rule is RETIRED (see the "DO NOT maintain web/mobile parity" bullet under Working conventions). Mobile changes go to mobile only; don't port pipeline logic to `js/`.
- **Status:** the DIRECTION is settled. The execution (when web is actually stripped, what the landing page looks like) is not yet scheduled/designed — but no longer "confirm before acting on the direction." When building, default to mobile-only for pipeline work without re-asking.

---

## Web stack

| Layer | Technology |
|---|---|
| UI | Vanilla HTML/CSS/JS — no framework, no build step, no npm |
| AI (OCR + bio) | Google Gemini via Cloudflare Worker proxy |
| Web search | Tavily API via proxy |
| Genealogy | WikiTree API via proxy |
| Free sources | Wikidata SPARQL, Chronicling America, Internet Archive, Wikipedia (all direct, no proxy) |
| Geocoding | Nominatim (OSM) + Overpass API (direct) |
| Maps | Leaflet 1.9.4 + OpenStreetMap + Turf.js 7 |
| Auth + DB | Supabase (Google OAuth + email/password; PostgreSQL) |
| Image storage | Cloudflare R2 via Worker proxy |
| PWA | `sw.js` service worker + beforeinstallprompt banner |
| Fonts | Playfair Display + Crimson Pro (dark gothic: bg `#1a1410`, gold `#c9a84c`, cream `#e8d4a0`) |

## Web file structure

```
index.html               — SPA shell: all screen markup, shared state, pipeline orchestration
sw.js                    — Service worker (bump CACHE on every web change)
css/                     — One file per screen: base, home, camera, loading, result, maps, modals, install-banner
js/
  config.js              — PROXY_BASE + CLIENT_KEY (only client config)
  util-json/image/html/dom.js, exif.js — helpers (safeParseJSON, resize, escapeHtml, EXIF GPS)
  grave-cache.js         — localStorage cache for geocoded grave coords (30-day TTL)
  api-gemini.js          — verifyIsGravestone, readGravestone (OCR schema: see Research pipeline)
  api-tavily.js          — searchForPerson: parallel slot queries (see Research pipeline)
  api-wikitree.js        — searchWikiTree: multi-pass genealogy search + scoring
  api-wikidata.js        — queryWikidata: alias-aware SPARQL lookup
  api-chroniclingamerica.js — pre-1929 newspaper OCR-text search
  api-internetarchive.js — county-history full-text search (pre-1925, source_type 'archive')
  api-wikipedia.js       — fetchWikipediaPortraits ({ left, right }), fetchWikipediaArticleSummary
  api-nominatim.js       — forwardGeocode, reverseGeocode, reverseGeocodeCemetery
  biography.js           — generateBiography + corroboration + citation validation + SYMBOL_CONTEXT table
  auth.js                — Supabase client + sign-in/up/out (must load after Supabase CDN tag)
  user-prefs.js          — Display name + default visibility (user_metadata)
  persistence.js         — storyToRow/rowToStory (grave_id, source, marker_style), cloud upsert/delete
  sync.js                — Incremental delta sync (updated_at watermark) + pushLocalOnly
  scan-limit.js          — checkWebScanLimit (guest 3 / free signed-in 3 lifetime, fail-closed); save limits are no-ops
  api-tributes.js        — getTributes/setTribute (candle/flower per grave)
  save-actions.js        — saveStory, shareStory, exportCemeteryData
  render-result.js       — Result screen renderer + renderTributeSection + marker-style picker
  grave-markers.js       — 20 SVG map-pin styles (per-grave marker_style, My-Cemetery map only)
  home-screen.js         — Remembered Stories list: sort bar (Recent/Name/Cemetery), collapsible groups, actions keyed by timestamp
  map-cemetery.js        — Per-user Leaflet map: drag-to-correct, OSM boundary, _cemeteryStoryCache
  map-global.js          — Community map: guest gate, dedup by grave_id then ~20 m cell
  map-utils.js           — groupGravesByCemetery, getDistanceMeters
  error-render.js, loading-ui.js, photo-modal.js, location-permission.js, pwa.js, misc-handlers.js
```

## Web architecture conventions

- **Classic scripts, no ES modules.** All JS loads as `<script src>` tags; top-level `function` declarations attach to `window` (inline `onclick` resolves there). Use `function` declarations, not `const fn = ...`, for anything called from HTML or other files.
- **Load order matters** — leaf-first: `config.js` first, utilities/API modules before callers, `auth.js` after the Supabase CDN tag.
- **`index.html` owns orchestration**: the pipeline (`startAnalysis`, `handleImageUpload`, `showScreen`, …) and shared state (`currentStory`, `savedStories`, `currentImage`, `currentExifLocation`, `currentPhotoSource`, `_bypassVerification`) live in its inline `<script>`; extracted modules share that lexical scope.
- **Extraction pattern**: modules extracted from the monolith carry a header block documenting public API, consumed symbols, load-order needs, and parse-time vs call-time timing. Follow it when extracting more.
- **HTML escaping**: any AI-generated or user-sourced value injected into `innerHTML` goes through `escapeHtml()` (`js/util-html.js`) — names, dates, locations, bio text, inscriptions, source URLs/descriptions, contributor names, image URLs, map popups. Never embed story objects as JSON in `onclick` — use a module-level lookup keyed by timestamp/UUID and a named function.
- **Secrets stay server-side**: only client config is `PROXY_BASE` + `CLIENT_KEY`. Worker source: `worker/worker.js` (`cd worker && wrangler deploy`). Worker enforces (1) `ALLOWED_ORIGIN` env var for browser requests — never `"*"`; (2) `CLIENT_KEY` secret matched against the `X-Client-Key` header for originless (mobile) requests. **Every file that fetches `PROXY_BASE` must send `X-Client-Key`** — missing header = Forbidden. Worker also hosts the RevenueCat webhook (`POST /revenuecat-webhook` → Supabase credits).
- **Gemini pattern**: primary `gemini-3.1-flash-lite`, auto-fallback `gemini-2.5-flash` on 503/429/network/overload, `temperature: 0.1`, JSON-only prompts parsed via `safeParseJSON` (biography uses structured output — `responseMimeType` + `responseSchema`).

## Supabase data model

- `stories` — soft-delete (`deleted_at`), `is_public`, `updated_at` (delta sync watermark), `grave_id` FK, `source` ('camera'|'library'), `marker_style`.
- `graves` — one row per physical stone, deduped ~20 m + name match via `find_or_create_grave` RPC; `find_grave` is the read-only companion (bio cache); `update_grave_location` RPC (first user-correction wins).
- `tributes` — one candle or flower per user per grave (`UNIQUE(grave_id, user_id)`).
- `grave_photos` — one row per photo per story; powers the global-map photo gallery.
- `scan_events` — immutable lifetime scan counter (INSERT/SELECT only via RLS); `scan_credits` — purchased credits, service-role write only.
- Migrations live in `supabase-migrations/` (001–010, all run; 008 on 2026-06-13, 010 `symbol_meanings` jsonb on 2026-06-13; 009 was a confirmed no-op). New migrations must be run manually in the Supabase SQL editor.

---

## Research pipeline (web + mobile — keep in sync)

**OCR (`readGravestone`)** emits: `primary_name`, `names`, `name_confidence` (high/medium/low), `alternate_names` (1-2 spellings when weathered), `maiden_name` (from "née …"), `relationships` ([{relation, name}] spouse/parents), specific symbol names, `subjects` array (one entry per EVERY deceased person visible anywhere in the photo, with their own dates; aliases merge; living relatives excluded), and `multiple_subjects` (true ONLY for physically separate freestanding markers — NOT a shared family stone; if uncertain, false). The wording of these prompt descriptions is load-bearing — it was tuned across several regressions; don't loosen it.

**Tavily (`searchForPerson(graveData, location, cemeteryName)`)** — up to 6 query slots fired **in parallel** (`Promise.allSettled`, order-preserving dedup), `max_results: 2`, advanced depth, session-level `_searchCache`. Domain restriction uses the API-level `include_domains` param (not `site:` in the query string). Features: inscription-phrase disambiguation for bare surnames (e.g. "TOMB OF WASHINGTON"); `_EXPAND` nickname table (~60 entries, Wm→William etc.); `_parseAgeAtDeath()` (derives year from "aged N yrs"); `_SYMBOL_QUERIES` (~30 emblems → targeted record repos); `cemeteryName` (from `reverseGeocodeCemetery`) injected as exact-phrase disambiguator into FindAGrave/obituary slots; slots 5/6 historical-obituary boundary is **1928** (keep in sync with Chronicling America cutoff); two-stage FindAGrave `/extract` (1 extra credit, confirmed hits only, retried once — FindAGrave blocks `/extract` intermittently, treat empty as flaky not blocked).

**WikiTree (`searchWikiTree(graveData, location)`)** — passes: date-filtered → maiden-name (married women are indexed under birth surname) → unfiltered → expanded-first-name. Nickname-aware first-name matching; last name accepts married surname, birth surname, or stone `maiden_name`. Scoring: burial-state match/mismatch ±30/−20; relationship token-match against `graveData.relationships` (spouse +40, parent +25, additive only). On multi-subject stones, called per person (first 2) in parallel → `wikiData` array.

**Wikidata (`queryWikidata(name, deathYear)`)** — free SPARQL, no proxy. Fires when `name_confidence === 'high'` OR (`'medium'` AND a death year exists). Alias-aware: `wbsearchentities` → P31=human candidates in one VALUES query → scored by death-year proximity (rejects >5 yr off — namesake guard). Returns birth/death dates, burial place + coords, `wikipediaTitle` (the en.wikipedia sitelink — consumed by the Wikipedia-title bridge: when the engraved name ≠ article title, e.g. "Erik Weisz" → "Harry Houdini", and the name-keyed Wikipedia summary/portrait fetch came back empty, orchestration retries via `fetchWikipediaArticleSummary`/`fetchWikipediaPortraits`' optional `knownTitle` arg, which bypasses the title-match guard). `burialCoords` is the GPS fallback when no EXIF/device GPS was captured.

**Chronicling America** — `chroniclingamerica.loc.gov/search/pages/results` (searches OCR'd page TEXT; snippets windowed around the surname), deathYear ± 1 window, cutoff **1928** (`source_type: 'public_domain'` stays honest under the US rolling PD wall). Corroboration uses CA content only for name-presence, never date parsing (noisy OCR must not fabricate date conflicts).

**Internet Archive** — county-history full-text search, pre-1925, `source_type: 'archive'`. Additive: never degrades existing results.

**Wikipedia** — `fetchWikipediaArticleSummary(name, dates)` (lead text, no image) fired per subject; the article is the grounding source for famous-figure bios. `fetchWikipediaPortraits`: web returns `{ left, right }`; mobile returns `string[]` of persisted local file URIs (see mobile notes).

**Biography (`generateBiography(graveData, searchResults, wikiData, location, wikipediaSummary, wikidataResult)`)**:
- **Stone-only fallback**: if no sources found, returns a short inscription-based paragraph WITHOUT calling Gemini (no hallucination); names every deceased subject.
- **Corroboration**: `_buildCorroborationSummary()` cross-checks names/dates across WikiTree, FindAGrave, BillionGraves, obituaries, and Wikidata (incl. burial place); conflicts flagged explicitly in the prompt.
- **Citation integrity**: `_validateCitations()` remaps `citations [{n, description, url}]` to sequential numbers, strips orphan [N] markers, converts to `sources`/`source_urls`.
- **Evidence ladder**: 1 weak source → 1-2 para; 2 sources → 2-4 para; 3+ → up to 1500 words; confirmed historical figure → up to 2500 words.
- **Historical-figure exception** (evaluated PER PERSON against that subject's OWN dates from `subjects`): requires (1) stone dates within ±5 yr of the figure's, (2) a [Wikipedia] article confirming the person in the numbered sources, (3) every claim carries [N]. On pass, the model is explicitly AUTHORISED to use its knowledge with the Wikipedia article as citation anchor (not limited to the extract text). On fail, "memory is not a source" applies. Prevents "John Adams d.1931" inheriting the Founding Father's biography.
- **Multi-subject**: `isMultiSubject = subjects.length > 1` (OR legacy `multiple_subjects`), so shared family stones qualify. Wikipedia article — not source count — determines who is "well-documented"; the famous subject is written first with the full allowance, others get a respectful paragraph. Single-subject `name` field uses `primary_name` (or best-known alias), never an " & "-joined alias string.
- **SYMBOL_CONTEXT** (~142 entries, exported, web+mobile byte-identical) injects conventional symbol meanings into the prompt; both result screens show tappable gold symbol chips with a bottom-sheet explanation. Symbols the table misses are resolved at scan time by one batched `resolveSymbolMeanings` (`api-gemini.js`) Gemini call (null-for-unknown guard, drops nulls, non-fatal, NOT scan-limit-gated) and stored on `story.symbol_meanings` (jsonb column, migration 010). Chip lookup is table-first then the per-story AI map (`lookupSymbolMeaning` web / `symbolMeaning` mobile); `symbols` is promoted to the story top-level so it round-trips/syncs (mobile previously read `graveData.symbols`, which didn't persist).
- Back-compat: all `subjects` reads guard with `Array.isArray` so old cached graveData behaves as before.

**Bio cache**: after OCR, signed-in users with GPS call `find_grave` → reuse the most recent public story on that grave within 90 days, skipping all search + Gemini steps. Guests and GPS-less scans always run the full pipeline.

---

## Key behaviors to preserve

- **Verification before OCR** — `verifyIsGravestone` throws `{ __verificationRejection: true, reason }` → rejection screen with "Use it anyway" escape hatch (`_bypassVerification = true`).
- **Geocoding accuracy** — `forwardGeocode(locationStr, personName, dates)` requires city/state tokens from the AI location in Nominatim results (no cross-city matches); flags `_lowConfidence` on US-state mismatch; returns `approximate: true` on cemetery-centroid fallback (those pins are also `_lowConfidence` — every GPS-less stone in a cemetery shares that coordinate). `spreadOverlappingPins()` (web + mobile) fans out ~1 m-coincident markers in a ~7 m display-only ring. Grave-node hits are cached (`grave-cache.js`).
- **Grave-node search uses `graveData.primary_name`** (not the bio `name`, which may be a combined string that breaks token-match thresholds).
- **Web vs mobile grave-node search** — Web: two-pass Overpass (tagged nodes within 1000 m, then any named node in the bbox; famous graves are often `tourism=attraction`). Mobile: Overpass is blocked (403/406 to Worker IPs and RN), so it uses Nominatim viewbox WITHOUT `bounded=1` (bounded applies an importance cutoff that drops grave nodes) → Photon (`photon.komoot.io`) bbox fallback. For camera photos, real GPS (EXIF/device) ALWAYS beats geocoded coords.
- **Cemetery boundary polygon is web-only** (`fetchOSMCemeteryBoundary`, relations stitched via `stitchOuterRing()`, >2000-point relations skipped). Do not re-add boundary drawing on mobile — Nominatim polygons excluded actual grave nodes.
- **Nearby cemeteries**: 5 km radius, `landuse=cemetery`/`amenity=grave_yard` only, unnamed elements filtered out.
- **Soft-delete sync** — deletes propagate via `deleted_at` in delta sync, not missing rows.
- **Canonical grave linking** — after biography, signed-in + GPS → `findOrCreateGrave` sets `story.grave_id` (non-fatal on RPC failure). Tribute UI: counts always shown when `grave_id` present; candle/flower buttons only for signed-in, `source === 'camera'`, non-global stories; tap toggles/switches.
- **Global map** — dedup by `grave_id` then ~20 m GPS cell; low-confidence pins get faded icon + "⚠ approximate location" in the callout (web `makeGlobalIcon`, mobile `markerLowConf`). Global bios (`_isGlobal`) show a gallery of all `grave_photos` for the grave (≤10, newest first); own stories show only the user's photo.
- **Remembered Stories** — dedicated screen (web `#remembered-stories` in `VALID_SCREENS`; mobile `RememberedStoriesScreen`), not the home screen. Sort bar: Recent / Name / Cemetery (grouped, >5 stories collapsed). Web action handlers keyed by story timestamp, never array index.
- **Portrait retry** — if the initial portrait fetch returns empty (surname-only OCR) or the bio name contains " and "/" & ", retry per name part after the bio resolves.
- **Photo source tracking** — `currentPhotoSource`/`story.source` ('camera'|'library') set on upload; gates tributes and GPS trust.

---

## Mobile app (Expo, `mobile/`)

ES modules (opposite of web). Expo SDK 54 managed workflow, React Navigation v7, Supabase (same project, PKCE + AsyncStorage), react-native-maps, expo-location, expo-image-picker/-manipulator/-media-library, react-native-svg, expo-updates (OTA), react-native-purchases (RevenueCat).

### Design system — `src/lib/theme.js` (never hardcode colors/fonts in screens)

- **Colors**: `ink #14100b` bg · `stone #1f1812` panels · `stone2 #2a2017` cards · `line #3a2e22` borders · `flame #f2b65c` gold CTAs · `ember #cf7a3a` secondary · `parchment #efe4d2` text · `ash #b7a892` muted · `ashDim #8a7d6c` labels · `silver #aabedc` global-map accent · `moss #7c8a68` success · `onFlame #2a1808` text-on-gold
- **Fonts**: `title` Fraunces_700Bold · `serif` Fraunces_400Regular (bio body) · `serifItalic`/`bodyItalic` Fraunces_400Regular_Italic · `name` Fraunces_500Medium · `body` HankenGrotesk_400Regular · `bodyMedium` _500Medium · `sansBold` _600SemiBold
- **Radius**: sm=13, md=15, lg=18

### Mobile file structure

```
mobile/
  index.js / polyfills.js     — polyfills.js (expo-crypto patch for getRandomValues + subtle.digest) MUST be first import
  App.js                      — Navigation + SafeAreaProvider + fonts + ErrorBoundary + cold-start deep link + RevenueCat init
  app.config.js               — slug "mobile" (EAS registration — don't rename), owner "j3k420", scheme "gravestory", userInterfaceStyle "dark"
  src/lib/
    config.js, theme.js, supabase.js, util-json.js, map-utils.js
    storage.js                — user-scoped AsyncStorage: loadStories/saveStories(…, userId); keys gs_stories_{userId} / gs_stories_guest
    sync.js                   — storyToRow/rowToStory, cloudSave/Update/Delete, syncDelta, syncOnSignIn, pushLocalOnly
    abbreviations.js          — shared EXPAND table (single source of truth — api-tavily imports directly, api-wikitree derives lowercase)
    device-id.js              — SHA-256 hardware fingerprint → user_metadata.device_id on sign-up (soft anti-abuse)
    use-refresh.js            — useRefresh(callback) → { refreshControl }; ALL screens use this for pull-to-refresh, no inline state
    api-gemini/tavily/wikitree/wikidata/chroniclingamerica/internetarchive/wikipedia/nominatim/r2/tributes.js, biography.js, grave-cache.js
                              — ES-module ports of the web modules (same behavior; Gemini calls add 30s fetchWithTimeout)
    media-gps.js              — getLibraryAssetGps(assetId): Android GPS EXIF recovery via expo-media-library (OS redacts GPS from picker EXIF)
    scan-limit.js             — lifetime scan caps + credits, fail-closed (`_checkFailed` → connection-error Alert)
    save-limit.js             — no-op (save limits removed; scans are the sole cost control)
  src/screens/
    HomeScreen.js             — logo, scan/map/Remembered Stories nav; syncDelta on focus, syncOnSignIn on SIGNED_IN
    RememberedStoriesScreen.js — sort bar + collapsible cemetery groups
    AuthScreen.js             — email/password + Google OAuth; "use Google" hint
    CameraScreen.js           — picker + full pipeline (below)
    ResultScreen.js           — image carousel (stone photo + portraits via normalizePortraits), bio, sources, symbol chips, marker-style picker, explicit Save/Discard
    SettingsScreen.js         — display name, visibility, scans-used graph (opens paywall), privacy link, confirmed sign-out
    PaywallScreen.js          — RevenueCat credit packs
    CemeteryMapScreen.js      — SVG grave markers, floating overlay callout, long-press drag-to-correct (drag hint shown), bottom list
    GlobalMapScreen.js        — public stories, silver markers, 5-min cache, errors surfaced (not empty state)
  src/components/
    GravestoneLogo.js         — animated SVG logo (flicker + shimmer loops); animate={false} for static
    GraveMarkers.js           — 20 hand-built SVG pin styles (marker_style; unknown/legacy values fall back to book)
    Icons.js                  — SVG icon set (size + color props)
```

### Mobile pipeline (CameraScreen)

1. Picker (`exif: true`) → EXIF GPS read before compression → 1024px JPEG base64. **Do NOT pass `legacy: true` to the picker** — it nulls `assetId` and breaks GPS recovery; the modern Photo Picker keeps it.
2. GPS: EXIF if present; Android library picks recover redacted GPS via `getLibraryAssetGps(asset.assetId)`; device-GPS fallback for **camera shots only** (device location is wrong for historical library photos).
3. `reverseGeocode` (→ locationHint) fires in parallel with `verifyIsGravestone`.
4. `readGravestone(base64, locationHint)` → graveData; multi-stone Alert only when `multiple_subjects === true && subjects.length <= 1`.
5. Parallel research per subject (Tavily + WikiTree + Wikidata + CA + IA + Wikipedia portraits/summary) → `generateBiography`.
6. Portrait retry → `forwardGeocode` refinement (Wikidata burial coords as last GPS fallback) → `incrementScanCount` (fires whether or not the user saves).
7. **No auto-save**: story navigates to Result with `_unsaved: true` (+ `_base64`, `_primaryName`). `ResultScreen.handleSave()` does everything on tap: `findOrCreateGrave`, strip transient fields, local save, cloud save, R2 upload → `cloudUpdateStory`, `grave_photos` row. While unsaved: public toggle + tributes hidden, gold **Save Story** button, bottom button = **Discard**, back-button confirms.

### Mobile gotchas (do not regress)

- `SafeAreaView` from `react-native-safe-area-context`, never `react-native`. Map screens use `edges={['top']}` + manual `paddingBottom: insets.bottom + 8` on the bottom panel (Android nav bar).
- Map callouts are state-driven floating overlay Views, NOT `<Callout>` (Android swallows touches). Both map screens.
- `GraveMarker` wrapper starts `tracksViewChanges={true}` and flips false via `onLayout` — unconditional `false` snapshots before the SVG paints and the marker disappears.
- No `.catch()` on Supabase query builders (Hermes) — use try/catch.
- `console.warn` for failure paths only; no debug data-dumps.
- Portraits: mobile persists resized portrait JPEGs to `documentDirectory/portraits/` (temp URIs die); global bios live-fetch portraits on mount (file:// URIs are device-local, can't be synced).
- Storage isolation: every `loadStories`/`saveStories` call passes the userId from the session — omitting it silently reads the guest bucket. `syncOnSignIn` always does a FULL cloud pull (cloud authoritative; local kept only if never pushed).

### Google OAuth (mobile)

- PKCE via `expo-web-browser`; redirect `gravestory://login-callback` (registered in Supabase Auth URL config). Doesn't work in Expo Go — needs a real build.
- `exchangeCodeForSession(code)` takes ONLY the extracted code UUID — passing the full callback URL causes "invalid flow state". Applies to both `AuthScreen` and the cold-start handler in `App.js`.
- `polyfills.js` must run first or PKCE silently fails (Hermes lacks `crypto.getRandomValues`/`subtle`).
- Gotcha: signing up with an email that already exists via Google silently no-ops ("check your email", nothing sent).

### EAS build + OTA

- Profiles: `preview` (tester APK), `production` (AAB, internal track), `phase9` (isolated personal channel), `development` (Metro via `adb reverse tcp:8081 tcp:8081`).
- EAS env vars: the Google Maps key exists only in the `production` environment (preview/dev get white maps). Secret-visibility vars don't reach OTA bundles — use Sensitive visibility and pass `--environment production` on `eas update`, or the app falls back to broken defaults.
- Adding a direct dependency that was previously only transitive requires a full `npm install` (lockfile sync) or EAS `npm ci` fails fast.

## Freemium / monetization

- **Scans are the sole cost control** (Tavily/Gemini cost): guest 3, free signed-in 3 lifetime (lowered from 10 in S66 — the pipeline has no warm-up, so a strong first bio sells the app and lands the paywall at peak WTP; signing in no longer adds free scans, it adds cloud save/sync + the ability to buy credits), + purchased credits. Save limits were removed entirely (no-ops kept for API compat). Limits fail closed on Supabase errors. (Tavily degrades gracefully when its ~4000-credit pool is exhausted — slots return empty and bios thin out, but Gemini still writes from the stone + free sources; no outage.)
- Credits-only model (no subscriptions): `gravestory_5_scans` $1.99 · `gravestory_20_scans` $5.99 · `gravestory_60_scans` $12.99 · `gravestory_150_scans` $24.99 (Legacy/gift tier, added 2026-06-13 per pricing research — captures high-WTP gift buyers, anchors the $12.99 pack as the middle); never expire. Prices are set in Google Play Console and surfaced live via RevenueCat (`pkg.product.priceString`) — a price change is a STORE-side action, no code/OTA needed; the `PACK_INFO` strings in `PaywallScreen.js` are only an offline-preview fallback to keep in sync. **New product IDs must be added in THREE places: Play Console + RevenueCat (store-side), the worker `CREDIT_MAP` (else the webhook grants 0 credits — `unknown product`), and `PaywallScreen.js` PRODUCT_IDS+PACK_INFO.** Pack render order on the paywall follows the RevenueCat offering order, not the code. Premium pricing was chosen to pre-fund the planned AR ghost-narrator feature (`docs/ar-ghost-narrator-design.md`). RevenueCat SDK live (production `goog_` key via EAS Secret, Sensitive visibility); `Purchases.logIn(userId)` after auth; purchases land as credits via the Worker webhook.
- Tester bypass: `is_unlimited: true` in `app_metadata` via SQL editor: `UPDATE auth.users SET raw_app_meta_data = raw_app_meta_data || '{"is_unlimited": true}'::jsonb WHERE id = '<user-id>';` (current: j3k420@gmail.com, james.edmonds26@gmail.com).

## Current status (2026-06)

- Phase 9 complete; web + mobile at feature parity. Play Store Closed Testing underway: versionCode 5 (GPS-EXIF native fix) uploaded and in review; recruiting ~12 testers for the 14-day requirement.
- Remaining: store-listing screenshots (`store-listing/`), Play review completion, production rollout. iOS needs a $99/yr Apple Developer account (not purchased).

## Known limitations

- **3-person stones**: only the first two people get dedicated Tavily slots; the third relies on inscription + Wikipedia. Wikipedia summaries/portraits ARE fetched for all 3. Not worth restructuring until 3-person stones prove common; a user-facing disclaimer line for ≥3 names is the cheap mitigation.
- **FamilySearch** — shelved until the app is a launched product (their registration requires one). Plan: Worker-held `client_id`, `unauthenticated_session` token caching, map to WikiTree result shape.
- **FindAGrave `/extract`** blocks intermittently (works for some pages, 403s others) — treat empty extracts as flaky, retry once, never escalate to a hard failure.
