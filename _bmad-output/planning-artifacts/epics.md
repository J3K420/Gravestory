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

- **Epic 1:** Phase 9 Completion — Enable Monetization & Reach Launch Readiness
- **Epic 2:** Play Store Launch
- **Epic 3:** Post-Launch Enhancements

---

## Epic 1: Phase 9 Completion — Enable Monetization & Reach Launch Readiness

Complete all remaining Phase 9 tasks to activate RevenueCat monetization, protect API costs via Worker origin enforcement, and satisfy the Play Store submission prerequisites (privacy policy, listing assets).

### Story 1.1: Run Scan Credits Database Migration

As a product owner,
I want the `scan_credits` table created in Supabase with correct RLS policies,
So that the RevenueCat webhook has a destination to write purchased credits and the system can accurately track available scans per user.

**Acceptance Criteria:**

**Given** access to the Supabase SQL editor and the file `supabase-migrations/005_scan_credits.sql`
**When** the migration script is executed using plain ASCII quotes (no curly/typographic quotes)
**Then** the `scan_credits` table exists with columns `user_id`, `credits`, `product_id`, `purchased_at`
**And** RLS policies allow authenticated users to SELECT their own rows only
**And** INSERT/UPDATE/DELETE are restricted to the service role (no client writes)
**And** `checkWebScanLimit` and mobile `checkScanLimit` correctly sum `scan_events` count against free limit + total `scan_credits` for the user

**Given** a user with `is_unlimited: true` in `app_metadata`
**When** any scan limit check runs
**Then** the check returns `atLimit: false` regardless of `scan_events` count or `scan_credits` balance

### Story 1.2: Add Cloudflare Worker Origin Validation

As a product owner,
I want the Cloudflare Worker to reject requests from unauthorised origins,
So that third parties cannot consume GraveStory's Gemini and Tavily API quotas.

**Acceptance Criteria:**

**Given** a browser request with `Origin: https://j3k420.github.io`
**When** the Worker receives the request
**Then** the request is processed normally

**Given** a browser request with any other `Origin` header value
**When** the Worker receives the request
**Then** the Worker returns HTTP 403 and no upstream API call is made

**Given** a mobile/direct request with no `Origin` header but a valid `X-Client-Key` header
**When** the Worker receives the request
**Then** the request is processed normally (CLIENT_KEY path is unaffected)

**Given** the Worker is deployed via `cd worker && wrangler deploy`
**When** `ALLOWED_ORIGIN` env var is set to `"https://j3k420.github.io"`
**Then** the env var value is used for the origin check (not hardcoded)

### Story 1.3: Build RevenueCat Purchase Webhook Endpoint

As a product owner,
I want the Cloudflare Worker to receive RevenueCat purchase events and credit the buyer's account,
So that purchased scan credit packs are immediately available for use.

**Acceptance Criteria:**

**Given** RevenueCat sends a `POST /revenuecat-webhook` with a valid `INITIAL_PURCHASE` or `RENEWAL` event payload
**When** the Worker receives the request
**Then** the Worker validates the RevenueCat webhook signature using the shared secret
**And** INSERTs a row into `scan_credits` via the Supabase service-role key with `user_id`, `credits` (mapped from product_id), `product_id`, and `purchased_at`
**And** returns HTTP 200

**Given** the product ID `gravestory_5_scans`
**When** credits are mapped
**Then** 5 credits are inserted

**Given** the product ID `gravestory_20_scans`
**When** credits are mapped
**Then** 20 credits are inserted

**Given** the product ID `gravestory_60_scans`
**When** credits are mapped
**Then** 60 credits are inserted

**Given** an invalid or missing webhook signature
**When** the Worker receives the request
**Then** the Worker returns HTTP 401 and does not write to the database

### Story 1.4: Re-enable RevenueCat SDK in Mobile App

As a user,
I want to purchase scan credit packs from within the app,
So that I can continue scanning gravestones after my free trial runs out without leaving the app.

**Acceptance Criteria:**

**Given** a user has reached their scan limit and the Paywall screen is shown
**When** the user taps a credit pack (Starter, Explorer, or Historian)
**Then** the RevenueCat purchase sheet opens
**And** on successful purchase, the app confirms the transaction and increments the user's available scans

**Given** the RevenueCat SDK is initialised in `App.js` with the production API key from EAS Secrets
**When** the app starts
**Then** no native crash occurs on release builds

**Given** `is_unlimited: true` in the user's `app_metadata`
**When** the Paywall screen would normally be shown
**Then** the Paywall screen is never shown and scanning proceeds

**Out of Scope:** Web in-browser purchase flow (v1 web users directed to mobile app).

### Story 1.5: Publish Privacy Policy Page

As a prospective user,
I want to read GraveStory's privacy policy before installing the app,
So that I understand how my photos and GPS data are handled.

**Acceptance Criteria:**

**Given** the privacy policy draft exists in the repository
**When** it is deployed to GitHub Pages at `https://j3k420.github.io/gravestory-privacy`
**Then** the page is publicly accessible without authentication

**Given** the user is on the Settings screen (web or mobile)
**When** they tap "Privacy Policy"
**Then** the browser/in-app browser opens `https://j3k420.github.io/gravestory-privacy`

**Given** the Play Store listing submission form
**When** a Privacy Policy URL is required
**Then** `https://j3k420.github.io/gravestory-privacy` is used and the URL resolves correctly

### Story 1.6: Create Play Store Listing Assets

As a product owner,
I want complete Play Store listing assets ready for submission,
So that the internal track submission can be completed without delay.

**Acceptance Criteria:**

**Given** the Play Store listing submission form
**When** assets are uploaded
**Then** the following are provided: short description (≤80 chars), full description (≤4000 chars), at least 2 phone screenshots (16:9 or 9:16, min 320px), 1 feature graphic (1024×500px), and an app icon (512×512px, already in `app.config.js`)

**Given** the short description
**When** reviewed
**Then** it accurately describes the core value proposition: photographing a gravestone to receive an AI-generated biography

---

## Epic 2: Play Store Launch

Generate production Android credentials, build the release AAB, and submit GraveStory to the Play Store internal track. All Epic 1 stories must be complete before Epic 2 begins.

### Story 2.1: Generate Android Production Credentials

As a developer,
I want a signed Android keystore registered with EAS,
So that production release builds can be signed for Play Store submission.

**Acceptance Criteria:**

**Given** a Google Play developer account is active ($25 registration fee paid)
**When** `npx eas credentials` is run
**Then** an Android keystore is generated and uploaded to EAS Credentials
**And** the keystore fingerprint matches what EAS Build uses for the production profile

**Given** the keystore is generated
**When** it is stored
**Then** a secure backup copy of the keystore file and credentials is kept outside the repository

### Story 2.2: Build and Submit Production AAB to Play Store

As a product owner,
I want a signed AAB uploaded to the Play Store internal track,
So that GraveStory can be tested by internal reviewers before public release.

**Acceptance Criteria:**

**Given** Story 2.1 is complete and all Epic 1 stories are done
**When** `npx eas build --platform android --profile production` is run
**Then** the build completes successfully and produces a signed `.aab` file

**Given** the AAB is ready
**When** it is submitted to the Play Store via the console or `npx eas submit`
**Then** the app appears in the internal track with status "Published to internal testers"

**Given** the store listing
**When** reviewed
**Then** all Epic 1 Story 1.6 assets are present, the privacy policy URL resolves, the content rating questionnaire is complete, and no policy violations are flagged

---

## Epic 3: Post-Launch Enhancements

Deepen research quality, expand platform reach, and improve user trust and accessibility. All stories in this epic are independent of each other and can be sequenced based on priority after public launch.

### Story 3.1: FamilySearch Genealogy Integration

As a cemetery visitor,
I want GraveStory to search FamilySearch records in addition to WikiTree,
So that I get richer genealogy data, particularly for LDS community members whose records are primarily in FamilySearch.

**Acceptance Criteria:**

**Given** a gravestone with a legible name and dates
**When** the pipeline runs and a FamilySearch developer key is configured in the Worker
**Then** `api-familysearch.js` (web) and `mobile/src/lib/api-familysearch.js` (mobile) fire in parallel with WikiTree
**And** results are merged into `searchResults` before biography generation with source label `[FamilySearch]`

**Given** the FamilySearch API returns no results
**When** results are merged
**Then** the pipeline proceeds normally with the results from other sources

**Out of Scope:** FamilySearch OAuth (use unauthenticated session token caching only for v1).

### Story 3.2: Web Payment Flow

As a web user who has reached their scan limit,
I want to purchase additional scan credits directly in the browser,
So that I don't have to download the mobile app to continue using GraveStory.

**Acceptance Criteria:**

**Given** a web user hits the scan limit
**When** the paywall prompt appears
**Then** a "Buy Credits" button opens a payment flow (Stripe or RevenueCat web SDK)
**And** on successful purchase, `scan_credits` is updated via the existing RevenueCat webhook and the user can scan immediately

### Story 3.3: iOS App Store Launch

As an iPhone user,
I want to install GraveStory from the App Store,
So that I can use it with a native experience on iOS.

**Acceptance Criteria:**

**Given** an Apple Developer account is active ($99/yr)
**When** `npx eas build --platform ios --profile production` is run
**Then** the build succeeds and produces a signed IPA

**Given** the IPA is submitted
**When** App Store review completes
**Then** GraveStory appears on the App Store with the same feature set as the Android version

### Story 3.4: Biography Accuracy Feedback Mechanism

As a user who has received a biography that contains an error,
I want to flag it as inaccurate,
So that the community is warned and the owner can investigate or correct it.

**Acceptance Criteria:**

**Given** a user is viewing any biography
**When** they tap "Flag inaccuracy"
**Then** a brief form collects the specific claim they believe is wrong and an optional note
**And** the flag is stored in Supabase linked to the story/grave_id
**And** the story owner (if public) is notified

**Given** a story has been flagged
**When** viewed on the result screen
**Then** a small "⚑ Flagged as potentially inaccurate" notice appears below the biography

### Story 3.5: Accessibility Audit and Remediation

As a user with visual or motor impairments,
I want GraveStory's core scan and biography flow to be usable with assistive technology,
So that I can benefit from the app regardless of my physical abilities.

**Acceptance Criteria:**

**Given** the web app is tested with a screen reader (NVDA or VoiceOver)
**When** the user navigates the scan → biography flow
**Then** all interactive elements have descriptive ARIA labels and the biography text is readable in reading order

**Given** the mobile app is tested with TalkBack (Android) and VoiceOver (iOS)
**When** the user navigates the camera → result flow
**Then** the gravestone tap zone, all buttons, and biography paragraphs are announced correctly

**Given** the colour contrast of the dark gothic theme
**When** measured against WCAG 2.1 AA standards
**Then** all text/background combinations meet a minimum 4.5:1 contrast ratio (or 3:1 for large text)
