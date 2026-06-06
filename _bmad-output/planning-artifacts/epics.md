---
stepsCompleted: [1]
inputDocuments:
  - _bmad-output/planning-artifacts/prd.md
  - project-context.md
---

# GraveStory - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for GraveStory, decomposing the requirements from the PRD and project-context.md into implementable stories.

> **Context:** GraveStory is a brownfield project at Phase 9. The core product (Phases 1–8f) is fully built and shipping to testers via EAS. These epics focus on (a) completing Phase 9 remaining work, (b) Play Store launch, and (c) post-launch enhancements.

---

## Requirements Inventory

### Functional Requirements

FR-1: User can initiate a Scan from device camera or photo library; source is tracked as 'camera' or 'library'
FR-2: System extracts GPS coordinates from photograph EXIF metadata before image compression
FR-3: System verifies photograph shows a gravestone before OCR; rejection screen with "Use it anyway" escape hatch
FR-4: System reads gravestone inscription via Gemini OCR → structured JSON (primary_name, dates, inscription, symbols, name_confidence, alternate_names, multiple_subjects)
FR-5: System compresses photograph to 1024px JPEG before AI calls; EXIF extracted first
FR-6: System generates a source-grounded biographical narrative with numbered inline citations; every factual claim backed by a retrieved source
FR-7: System produces a stone-only short paragraph (without calling Gemini) when all research returns empty
FR-8: System generates a combined biography for multiple subjects when multiple_subjects is true; user warned to photograph each stone separately
FR-9: System generates extended biography (up to 2,500 words) for confirmed notable historical figures when dates align ±5yr AND Wikipedia source present AND every claim has [N] marker
FR-10: Biography length scales automatically: 1 weak source → 1–2 para; 2 sources → 2–4 para; 3+ → up to 1,500 words; historical figure → up to 2,500 words
FR-11: System cross-checks name/date agreement across all sources; discrepancies surfaced in biography text
FR-12: System runs up to 6 Tavily queries per Scan in priority order (symbol-guided first, then FindAGrave, then obituary, then general pre-1924); session-level cache prevents duplicate queries
FR-13: System searches WikiTree with 3-pass strategy (date-filtered → unfiltered → expanded-first-name); nickname-aware matching; geographic scoring ±30/−20
FR-14: System queries Wikidata SPARQL for structured birth/death dates and burial-place coordinates; fires only when name_confidence === 'high'; burialCoords used as GPS fallback
FR-15: System queries Chronicling America for pre-1924 obituaries; fires only when deathYear ≤ 1924; returns up to 3 results with source_type 'public_domain'
FR-16: System fetches Wikipedia article lead paragraph (as numbered source) and up to 5 portrait images per subject; portrait retry after biography if initial fetch empty
FR-17: System maps ~30 detected gravestone symbols to targeted Tavily query strategies (GAR, Masonic, military branches, VFW, etc.)
FR-18: System expands ~60 period abbreviations and nicknames (Wm→William, Geo→George, etc.) in all Tavily queries and WikiTree name matching
FR-19: System converts EXIF/device GPS to "City, State" string via reverse geocoding before OCR; threaded into all research queries
FR-20: System resolves AI-returned location string to GPS via Nominatim; 2-pass grave node search (web: Overpass; mobile: Nominatim+Photon); 30-day local cache for successful matches; camera/EXIF GPS takes priority
FR-21: User can view a map of their saved Stories grouped by cemetery with custom gravestone-silhouette markers and floating overlay callout
FR-22: Web cemetery map draws OSM polygon boundary fetched via Overpass (not available on mobile)
FR-23: System surfaces nearby cemeteries within 5km (landuse=cemetery / amenity=grave_yard, named only)
FR-24: User can drag a story's map pin to correct its position; correction saved locally and synced to Supabase with update_grave_location RPC
FR-25: System visually flags map pins where geocoding resolved to a different US state than expected (Low-Confidence Pin badge)
FR-26: User can save a completed Story to local storage and, if signed in, to cloud (Supabase); subject to save limit
FR-27: User can share a Story via the device native share mechanism
FR-28: System deduplicates physical gravestone records via find_or_create_grave RPC (~20m + name match); returns grave_id linked to Story; non-fatal on failure
FR-29: System incrementally syncs story changes across devices via updated_at watermark; soft-delete propagates via deleted_at; syncOnSignIn does a full cloud pull
FR-30: System uploads gravestone photograph to Cloudflare R2; URL stored on Story; grave_photos table records photo per story per grave_id
FR-31: User can create an account and sign in with email and password; mobile sign-up attaches device fingerprint to user_metadata
FR-32: User can sign in with a Google account (Supabase OAuth; mobile uses expo-web-browser PKCE flow with gravestory://login-callback)
FR-33: Signed-in user can set display name and default story visibility (stored in Supabase user_metadata)
FR-34: Guest users can scan and view biographies without an account up to the guest scan limit (3 lifetime); no cloud sync; cannot access Global Map
FR-35: Signed-in user can mark a Story as public, making it visible on the Global Map
FR-36: System deduplicates Global Map pins (first pass: by grave_id; second pass: by ~20m GPS cell); Low-Confidence pins flagged visually
FR-37: Guest users see a sign-up prompt instead of biography text on the Global Map
FR-38: Global Map story carousel shows all grave_photos for that grave_id (up to 10, newest first) then Wikipedia portraits; mobile live-fetches portraits on mount
FR-39: Signed-in user who scanned a grave with camera can leave a candle or flower tribute; one tribute per user per grave; toggling same type removes it; toggling different type switches it
FR-40: Tribute counts (candles and flowers) always visible when grave_id present; toggle buttons only shown for signed-in + camera-sourced + non-global stories
FR-41: Guest users limited to 3 lifetime Scans; scan count in Supabase scan_events table; fails closed on Supabase error
FR-42: Free signed-in users limited to 10 lifetime Scans + purchased credits; fails closed on Supabase error; is_unlimited flag in app_metadata bypasses check
FR-43: User can purchase scan credits in three packs (5/$0.99, 20/$2.99, 60/$6.99) via RevenueCat; credits stored in scan_credits table (service-role write only); credits never expire
FR-44: Free signed-in users limited to 10 saved Stories (3 for guests); checkWebSaveLimit / save-limit check gates save flow
FR-45: Designated testers and VIP users bypass all limits via is_unlimited: true in Supabase app_metadata (SQL editor only)
FR-46: Web app installable as PWA; beforeinstallprompt banner on Android; manual iOS hint; service worker caches app shell and map tiles
FR-47: Mobile JS-layer changes delivered OTA via expo-updates without new store submission; preview channel for testers; phase-9 channel for personal testing

### Non-Functional Requirements

NFR-P1: Total pipeline time (photo to biography rendered) must be under 30 seconds on standard LTE for a typical stone with 2–3 research sources
NFR-P2: All Gemini API calls include a 30-second fetchWithTimeout; hanging requests surface as errors, not infinite loading
NFR-P3: All research integrations run in parallel; total research latency must not exceed the slowest source by more than 200ms of orchestration overhead
NFR-P4: Map tile caching via service worker (web) ensures the map is usable offline after first cemetery visit
NFR-S1: No API keys in client-side code; all sensitive calls route through the Cloudflare Worker proxy
NFR-S2: Worker enforces ALLOWED_ORIGIN env var (browser request validation) and CLIENT_KEY secret header (mobile/direct request validation)
NFR-S3: ALL AI-generated or user-sourced data injected into innerHTML must pass through escapeHtml() — no exceptions
NFR-S4: Story objects must never be serialized into HTML onclick attributes; use module-level lookup tables keyed by safe primitives
NFR-S5: Scan limit checks fail closed on Supabase errors (block scan, not allow)
NFR-S6: scan_credits table is write-only via service-role (RevenueCat webhook); clients SELECT only
NFR-R1: Gemini calls auto-fallback to gemini-2.5-flash on HTTP 503, 429, network errors, or overload response bodies
NFR-R2: A failure in any single research integration does not block the pipeline; biography generates from available results
NFR-R3: Stone-only fallback ensures user always receives output even when all research fails
NFR-R4: findOrCreateGrave failure is non-fatal; story saves without grave_id
NFR-R5: No .catch() on Supabase query builders (Hermes JS engine incompatibility); always use try/await/catch
NFR-O1: console.warn only for genuine failures; no debug data dumps

### Additional Requirements

**From project-context.md (architectural constraints affecting implementation):**

- Web: Vanilla HTML/CSS/JS only — no npm, no bundler, no TypeScript, no ES modules, no framework; classic `<script src>` tags; `function` declarations only (not `const fn =`); static files on GitHub Pages
- Mobile: Expo managed workflow only — no bare ejection; ES modules throughout `mobile/src/`
- Pipeline parity: any change to pipeline logic must be applied to BOTH web (`index.html` + `js/`) AND mobile (`mobile/src/`) — they are parallel codebases with no shared code
- Supabase RLS enforces data isolation; anon key is public by design; security enforced by row-level security policies
- All Gemini, Tavily, WikiTree, R2 calls must route through PROXY_BASE (Cloudflare Worker)
- Wikidata SPARQL and Chronicling America are direct (CORS-open, free) — no proxy required
- Soft-delete only: never hard-delete stories rows; deleted_at propagates via sync
- Per-user storage isolation: always pass userId to loadStories/saveStories on mobile
- Worker auth: ALLOWED_ORIGIN must be set to production domain (not "*"); CLIENT_KEY rotated via wrangler secret put

**Remaining Phase 9 tasks (from CLAUDE.md):**

- Run `005_scan_credits.sql` in Supabase SQL editor (creates scan_credits table with RLS)
- Add Origin header validation to Cloudflare Worker (third-party quota abuse prevention)
- Build RevenueCat webhook endpoint in Worker (receives purchase events, INSERTs into scan_credits)
- Re-enable RevenueCat SDK in App.js and PaywallScreen.js (currently disabled; requires Play Store account + production API key)
- Host privacy policy at `https://j3k420.github.io/gravestory-privacy`; link from Settings screen
- Produce store listing assets (screenshots, feature graphic, short/full description)

### UX Design Requirements

_No UX design document found. All UX patterns are established in the existing codebase (dark gothic theme, Fraunces/Hanken Grotesk typography, component conventions). No UX-DR items to extract._

---

### FR Coverage Map

_To be populated in Step 2 as epics are designed._

---

## Epic List

_To be populated in Step 2._
