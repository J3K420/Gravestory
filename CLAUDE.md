# GraveStory — CLAUDE.md

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
  api-gemini.js          — geminiCallWithFallback, verifyIsGravestone, readGravestone
  api-nominatim.js       — forwardGeocode (Nominatim + Overpass named-grave search)
  api-tavily.js          — Tavily web search (burial-focused targeted queries)
  api-wikitree.js        — WikiTree genealogy (two-pass, credibility floor)
  api-wikipedia.js       — Wikipedia summary fetch
  biography.js           — generateBiography (Gemini narrative + stone-only fallback)
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
  home-screen.js         — renderSavedList, loadSaved, deleteSaved
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

- **Soft-delete sync** — deletes propagate to other devices via `deleted_at` in the delta sync, not through missing rows.

---

## React Native mobile app (Expo)

Parallel codebase in `mobile/`. Do not touch web files when working on mobile and vice versa.

### Mobile stack

| Layer | Technology |
|---|---|
| Framework | Expo SDK 54 (managed workflow) |
| Navigation | React Navigation v7 native stack |
| Auth | Supabase (same project as web) + AsyncStorage session |
| Storage | AsyncStorage (local) + Supabase delta sync |
| Camera/picker | expo-image-picker + expo-image-manipulator |
| SVG | react-native-svg |
| Maps | react-native-maps (Apple Maps on iOS, Google Maps on Android) |
| Location | expo-location (foreground GPS on scan) |

### Mobile file structure

```
mobile/
  App.js                        — NavigationContainer + SafeAreaProvider + cold-start deep link handler
  index.js                      — Entry point; imports polyfills.js first, then registerRootComponent
  polyfills.js                  — crypto.getRandomValues + crypto.subtle.digest polyfill (expo-crypto); MUST be first import in index.js
  app.json                      — scheme: "gravestory" (required for OAuth deep links)
  src/
    lib/
      config.js                 — PROXY_BASE (same Cloudflare Worker as web)
      supabase.js               — Supabase client, AsyncStorage, flowType: 'pkce'
      storage.js                — AsyncStorage: loadStories, saveStories, getLastSync
      util-json.js              — safeParseJSON (ES module port of web version)
      api-gemini.js             — verifyIsGravestone, readGravestone (ES module)
      api-tavily.js             — searchForPerson (ES module)
      api-wikitree.js           — searchWikiTree (ES module)
      api-wikipedia.js          — fetchWikipediaPortraits (ES module, adds User-Agent header)
      biography.js              — generateBiography (ES module)
      api-nominatim.js          — forwardGeocode: text → { lat, lng } via Nominatim
      api-r2.js                 — uploadGravestoneImage(base64): POST to /upload-image, returns URL or null
      map-utils.js              — getDistanceMeters, groupGravesByCemetery (ES module)
      sync.js                   — storyToRow/rowToStory, cloudSaveStory/Update/Delete, syncDelta, syncOnSignIn, pushLocalOnly
    screens/
      HomeScreen.js             — Home: logo, scan button, map buttons, saved list; delta sync on focus; long-press delete
      AuthScreen.js             — Email/password + Google OAuth (expo-web-browser)
      CameraScreen.js           — Photo picker → GPS capture → full pipeline → R2 upload → cloud save → Result
      ResultScreen.js           — Biography, gravestone photo, portraits, inscription, sources, share, map, public toggle, delete
      SettingsScreen.js         — Display name, default visibility toggle, account info, sign out
      CemeteryMapScreen.js      — react-native-maps: grave markers, callouts, draggable pin correction, bottom list
      GlobalMapScreen.js        — Community map: public stories from Supabase RPC, silver markers, guest banner
    components/
      GravestoneLogo.js         — Animated SVG gravestone logo (flicker effect); accepts animate={false} for static rendering
```

### Mobile conventions

- ES modules (`import`/`export`) — opposite of web's classic scripts
- `SafeAreaView` from `react-native-safe-area-context`, NOT from `react-native`
- `SafeAreaProvider` wraps the entire app in `App.js`
- All API calls use same `PROXY_BASE` as web — same Cloudflare Worker handles both
- `console.warn` (not `console.log`) for pipeline debug output — New Architecture (bridgeless) only forwards warns to DevTools

### Mobile pipeline (CameraScreen.js)

1. expo-image-picker → compress to 1024px JPEG → base64 via expo-image-manipulator
2. `verifyIsGravestone(base64)` — throws `{ __verificationRejection: true }` → rejection UI
3. `readGravestone(base64)` — Gemini OCR → structured JSON
4. Parallel: `searchForPerson` + `searchWikiTree` + `fetchWikipediaPortraits`
5. `generateBiography` — Gemini narrative or stone-only fallback
6. Read `user.user_metadata.default_public` → set `story.is_public`
7. Save to AsyncStorage → `cloudSaveStory` (if signed in) → `uploadGravestoneImage` → `cloudUpdateStory` with `image_url`
8. Navigate to ResultScreen

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
- **Phase 8** 🔲 — Bug fixes from real-device testing, Play Store submission prep, OTA updates (EAS Update), payments (RevenueCat + Google Play Billing)

---

### EAS build config

- `app.config.js` slug: `"mobile"` (matches the EAS project registration — do not change back to "gravestory")
- `app.config.js` owner: `"j3k420"`
- `scheme: "gravestory"` controls deep links — independent of slug
- Google Maps Android API key stored as an EAS Secret (already created, scope: project, all environments)
- Preview build (installable APK for testers): `npx eas build --platform android --profile preview`
- Production build (AAB for Play Store): `npx eas build --platform android --profile production`
- Testers install via direct `.apk` link; subsequent updates install over the top automatically

### Phase 8 — Planned scope

- Bug fixes from real-device tester feedback
- Play Store submission: $25 Google Play Developer account, store listing, privacy policy URL, content rating, AAB production build
- EAS Update (OTA): add `expo-updates` so JS-only fixes ship in seconds without a full rebuild
- Payments: RevenueCat + Google Play Billing for subscriptions / consumable credit packs (mandatory for Play Store; 15–30% Google cut)
- iOS TestFlight build (requires $99/yr Apple Developer account)
