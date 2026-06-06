---
title: GraveStory
status: draft
created: 2026-06-05
updated: 2026-06-05
source: retroactive — derived from CLAUDE.md and project-context.md
---

# PRD: GraveStory

## 0. Document Purpose

This is a retroactive PRD for GraveStory, a shipped product currently in Phase 9 (freemium hardening, approaching Play Store submission). It is written for the product owner, any future collaborators or investors, and as a canonical reference for downstream BMAD workflows (architecture, epics, stories). The PRD is organized around the [Essential Spine](#), with Adapt-In sections for Aesthetic & Tone, Monetization, Platform, Cross-Cutting NFRs, and Constraints & Guardrails — all of which carry real weight for this product. Technical implementation details (exact API shapes, module names, load order) live in `CLAUDE.md`; this document captures the *what* and *why*.

---

## 1. Vision

GraveStory transforms a smartphone photograph of a gravestone into a compassionate biographical story about the person buried there. In the time it takes to walk between markers, a cemetery visitor learns who that person was — not just the dates carved in stone, but their era, their community, their possible occupations and affiliations, the wars they may have lived through. The app bridges the gap between a name on a stone and a life actually lived.

The core insight is that every grave represents a person whose story is partially recoverable. Public genealogy records, digitized newspapers, Wikipedia, and community databases hold fragments of that story — but assembling them requires hours of research most visitors will never do. GraveStory does the assembly in under 30 seconds, surfacing a grounded narrative built from real sources with inline citations. AI is the engine, not the author: every claim traces back to a primary or secondary source.

The product serves two simultaneous needs. For individual visitors — a grandchild at a family plot, a history enthusiast on a cemetery tour, a grieving spouse — it provides an immediate, personal connection to the deceased. For the broader community, public stories accumulate into a growing map of documented lives: a crowd-sourced biographical record of cemeteries that no institution is maintaining.

---

## 2. Target User

### 2.1 Jobs To Be Done

- **Functional:** Discover who a specific buried person was, quickly, without leaving the cemetery.
- **Functional:** Find and save biographical information for family members across multiple cemetery visits.
- **Functional:** Locate graves by name within a cemetery and navigate to them on a map.
- **Social:** Share a relative's story with family members who couldn't attend a visit.
- **Social:** Contribute a story to the community record so others visiting the same grave benefit.
- **Emotional:** Feel connected to an ancestor or historical figure rather than reading a bare inscription.
- **Emotional:** Mark a visit with a symbolic tribute (candle, flower) that persists for others to see.
- **Contextual:** Use the app hands-free or one-handed while physically standing at a grave.

### 2.2 Non-Users (v1)

- Professional genealogists conducting deep multi-generation research (the app provides a starting point, not a full genealogy workspace).
- Funeral industry professionals managing burial records (no record-management or funeral workflow features).
- Cemetery administrators (no content-management, grave registration, or cemetery database tools).
- Users expecting the app to locate a specific grave they haven't photographed yet (discovery-before-scan is out of scope for v1). [ASSUMPTION: a future "search by name within a cemetery" feature is desirable but not built.]

### 2.3 Key User Journeys

**UJ-1. Maria visits her grandmother's grave for the first time.**
- **Persona + context:** Maria, mid-30s, second-generation immigrant. Her grandmother emigrated before Maria was born; Maria knows almost nothing about her life in the old country.
- **Entry state:** Unauthenticated (guest). Downloaded the PWA from a QR code on the cemetery gate. Standing at the grave.
- **Path:** (1) Taps "Scan a Gravestone" → camera opens. (2) Photographs the stone. (3) App verifies it's a gravestone, reads the inscription, runs parallel research. (4) Loading screen shows progress ("Reading inscription… Searching records…"). (5) Biography renders: two paragraphs citing a digitized immigration record and a local newspaper mention.
- **Climax:** Maria reads details about her grandmother's village of origin and arrival year — information her family had lost. She screenshots the story.
- **Resolution:** App prompts her to save. She taps Save — hits the guest 3-scan limit prompt and creates an account. Story saves. She shares it via the native share sheet to a family group chat.
- **Edge case:** The stone is heavily weathered. Gemini OCR returns low-confidence name. Biography opens with "The inscription on this stone is difficult to read with certainty…" and hedges claims appropriately.

**UJ-2. David explores a Civil War section of a historic cemetery.**
- **Persona + context:** David, 60s, history enthusiast, visiting a cemetery on a deliberate historical tour. Signed-in user, has scanned several graves before.
- **Entry state:** Authenticated, on the Home screen, free scan credits remaining.
- **Path:** (1) Opens GraveStory, taps Scan. (2) Photographs a GAR-marked stone (Grand Army of the Republic emblem). (3) App detects the GAR symbol; Tavily fires symbol-guided Civil War veteran queries. (4) WikiTree returns a record; Chronicling America surfaces an 1887 obituary. (5) Biography is 1,000+ words: regiment, battles, postwar life, death notice.
- **Climax:** David reads a detailed biography that cites the soldier's regiment and an obituary from a newspaper published the week he died. He marks the story public.
- **Resolution:** Story appears on the community global map. Other visitors to this cemetery will now see David's contribution pinned to the grave's location.

**UJ-3. Priya uses the cemetery map to orient herself.**
- **Persona + context:** Priya, 40s, visiting a large unfamiliar cemetery to find a great-uncle's grave from a story she saved last year.
- **Entry state:** Authenticated, on the Home screen, viewing Remembered Stories.
- **Path:** (1) Opens Remembered Stories, finds the story. (2) Taps Map. (3) Cemetery map opens with the grave pinned. (4) Priya walks toward the pin. (5) She finds the grave and scans it again to get an updated biography (more sources may have indexed since her last visit).
- **Climax:** The second scan hits the biography cache (same grave_id, recent public story exists) and returns instantly. The biography is richer than the one she saved.
- **Resolution:** She merges the new story with her saved one. Leaves a candle tribute.

---

## 3. Glossary

- **Scan** — a single end-to-end pipeline execution: one photograph processed through verification, OCR, research, and biography generation. Counted against the user's scan limit.
- **Biography** — the AI-generated narrative produced by a Scan. Includes a name, dates, inscription, and one or more paragraphs with inline citation markers.
- **Story** — a saved Scan result: biography + gravestone photo + GPS coordinates + metadata. The unit of data the user owns and can share.
- **Grave** — the canonical record for a physical gravestone, deduped by approximate GPS (~20 m) and primary name. One Grave can have many Stories from different users.
- **Cemetery** — a named burial ground. Inferred from GPS and Nominatim geocoding; not a first-class editable entity.
- **Primary Name** — the single person's name extracted by OCR from the stone inscription. Distinct from the biography `name` field, which may be a combined " & " string for multi-person stones.
- **Multiple Subjects** — when a single photograph shows two or more separate, distinct gravestones. Triggers a combined biography and a user warning.
- **Source** — a research result cited in the biography (Tavily web result, WikiTree profile, Wikidata record, Chronicling America article, Wikipedia article). Displayed as a numbered list below the biography.
- **Tribute** — a symbolic gesture (candle or flower) a signed-in user attaches to a Grave. Persists in the community record.
- **Public Story** — a Story the user has made visible to the community; appears on the Global Map.
- **Scan Credit** — a purchased unit entitling the holder to one additional Scan beyond the free lifetime limit.
- **Guest** — an unauthenticated user. Limited to 3 lifetime Scans; cannot save stories persistently or access the Global Map.
- **Low-Confidence Pin** — a map marker where geocoding resolved a cemetery to a different US state than the OCR location string implied. Shown with a visual warning badge.
- **Pipeline** — the ordered sequence of AI and research steps executed per Scan. Identical on web and mobile.
- **EXIF GPS** — latitude/longitude embedded in the photograph's metadata by the camera. Used as the primary GPS source for scans taken with the device camera; not available for library imports of older photos.
- **Proxy** — the Cloudflare Worker that mediates all calls to Gemini, Tavily, WikiTree, and R2. No API keys are exposed to the client.

---

## 4. Features

### 4.1 Gravestone Scanning & Verification

**Description:** The user initiates a Scan by tapping the central action button and choosing to photograph the gravestone live with the device camera or select an existing image from the photo library. Before OCR runs, a Gemini preflight call confirms the image actually shows a gravestone — preventing the pipeline from generating a biography for a random photograph of a fence post or a person. If verification fails, the user sees a rejection screen with the reason and an escape hatch to proceed anyway ("Use it anyway") for unusual cases (e.g., a very weathered stone that the model misclassifies). The photo is compressed and held in memory; it is not stored permanently until the user explicitly saves the resulting Story. EXIF GPS is extracted before compression, since compression strips that metadata.

**Functional Requirements:**

#### FR-1: Photo Source Selection
The User can initiate a Scan from the device camera (live capture) or the photo library. Realizes UJ-1, UJ-2.

**Consequences:**
- Camera-sourced scans have `source: 'camera'`; library-sourced scans have `source: 'library'`.
- Device GPS is only requested for camera-sourced scans (library photos may be historical images taken elsewhere).

#### FR-2: EXIF GPS Extraction
The system extracts GPS coordinates from the photograph's EXIF metadata before image compression. Realizes UJ-1.

**Consequences:**
- If EXIF GPS is present, it is used as the primary location signal for the Scan.
- EXIF extraction runs before compression because compression strips EXIF metadata.

#### FR-3: Gravestone Verification Preflight
The system verifies that the photograph shows a gravestone before running OCR. Realizes UJ-1, UJ-2.

**Consequences:**
- If verification fails, the user sees a rejection screen with the model's stated reason (e.g., "This appears to be a photograph of a person, not a gravestone").
- A "Use it anyway" button sets a bypass flag and allows the pipeline to proceed on user consent.
- Verification runs in parallel with reverse geocoding when GPS is available, to minimize total pipeline latency.

#### FR-4: Gravestone OCR → Structured Data
The system reads the gravestone inscription and returns structured JSON: primary name, dates (birth/death), inscription text, detected symbols, name confidence (high/medium/low), alternate name readings (1–2), and a multiple-subjects flag. Realizes UJ-1, UJ-2.

**Consequences:**
- `name_confidence` drives downstream behavior: low → biography hedges identity; high → Wikidata query fires.
- `alternate_names` generates additional Tavily query variants when confidence is not high.
- `multiple_subjects: true` triggers the multi-person biography path and surfaces a user warning.
- `primary_name` (single OCR-extracted name) is used for all geocoding and grave-matching calls; the biography `name` field may differ for multi-person stones.

#### FR-5: Image Compression
The system compresses the photograph to a standard size (1024 px longest side, JPEG) before all AI calls. Realizes UJ-1.

**Consequences:**
- Compression reduces latency and cost of Gemini calls.
- EXIF metadata is preserved separately before compression runs.

---

### 4.2 AI Biography Generation

**Description:** After research completes, Gemini generates a biographical narrative grounded in the retrieved sources. The biography uses a structured JSON output schema guaranteed at the decoder level, so parse failures cannot produce malformed output. Length scales with the quantity and quality of evidence: one weak source yields one or two paragraphs; two sources yield two to four; three or more yield up to 1,500 words; a confirmed notable historical figure (Wikipedia article present, dates aligned within ±5 years) yields up to 2,500 words. If all research returns empty, a short stone-only paragraph is generated without calling Gemini, preventing hallucination entirely. Citations are validated and renumbered sequentially; inline `[N]` markers in the biography text map to the numbered sources list.

**Functional Requirements:**

#### FR-6: Source-Grounded Biography
The system generates a biographical narrative from aggregated research results, with every factual claim backed by a numbered citation. Realizes UJ-1, UJ-2, UJ-3.

**Consequences:**
- The biography prompt instructs the model that recalled training-data knowledge is not a source; only retrieved search results count.
- Every non-trivial claim carries an `[N]` inline marker.
- The generated `citations` array is validated: non-sequential numbers are remapped to 1, 2, 3…; orphan markers are stripped.

#### FR-7: Stone-Only Fallback
When all research integrations return empty results, the system produces a short narrative from the inscription alone without calling Gemini. Realizes UJ-1.

**Consequences:**
- No Gemini call is made in this path, preventing AI hallucination about unknown individuals.
- The output is clearly scoped to "what the stone tells us."

#### FR-8: Multi-Person Biography
When `multiple_subjects` is true, the system generates a combined biography covering all detected individuals proportionally. Realizes UJ-2.

**Consequences:**
- The biography prompt names all subjects explicitly and requires proportional coverage.
- The biography `name` field uses " & " separator; `dates` uses " · " separator.
- The user is warned (loading screen text / mobile Alert) that photographing each stone individually produces a fuller biography.
- If ≥ 3 people are detected, the warning notes that research depth is reduced for the third person onward.

#### FR-9: Historical Figure Extended Biography
For confirmed notable historical figures, the system generates an extended biography (up to 2,500 words) covering early life, career, personal life, cultural impact, and legacy. Realizes UJ-2.

**Consequences:**
- Three conditions must ALL hold: (1) stone dates within ±5 years of the known figure's dates, (2) a Wikipedia article confirming the same person is present in the numbered sources, and (3) every claim carries an `[N]` marker.
- If any condition fails, the standard evidence-scaled biography is generated.
- This prevents "John Adams d.1931" from inheriting the Founding Father's biography (namesake guard).

#### FR-10: Evidence-Scaled Length
Biography length scales automatically with the number and quality of sources available. Realizes UJ-1, UJ-2.

**Consequences:**
- 1 weak source → 1–2 paragraphs.
- 2 sources → 2–4 paragraphs.
- 3+ sources → up to 1,500 words.
- Confirmed Wikipedia-backed historical figure → up to 2,500 words.

#### FR-11: Cross-Source Corroboration
The system cross-checks name and date agreement across all retrieved sources and surfaces discrepancies in the biography prompt so the model acknowledges conflicts rather than blending them silently. Realizes UJ-1, UJ-2.

**Consequences:**
- `_buildCorroborationSummary()` compares WikiTree, Wikidata, FindAGrave, BillionGraves, and obituary dates against the stone.
- Date conflicts appear explicitly in the bio text ("WikiTree records 1847, but the stone reads 1849").
- Wikidata burial-place is cross-checked and, if confirmed, adds a corroboration line.

---

### 4.3 Research Integrations

**Description:** Immediately after OCR, the system runs parallel research queries across six sources: Tavily web search, WikiTree genealogy, Wikidata SPARQL, Chronicling America digitized newspapers, Wikipedia article summary, and Wikipedia portrait images. Each integration has distinct triggering conditions, query strategies, and output shapes; all results are merged into a single `searchResults` object before biography generation. The parallel execution keeps total research latency roughly equal to the slowest individual source rather than the sum. All sources except Wikidata and Chronicling America route through the Cloudflare Worker Proxy.

**Functional Requirements:**

#### FR-12: Tavily Web Search
The system runs up to 6 Tavily queries per Scan, in priority order, to find genealogy records, obituaries, and biographical mentions. Realizes UJ-1, UJ-2.

**Consequences:**
- Queries are built in priority order: symbol-guided queries first (if symbols detected), then FindAGrave, then name-based obituary, then general historical (pre-1924 stones).
- Nickname and abbreviation expansion (e.g., Wm → William, Geo → George, ~60 entries) generates query variants for weathered or abbreviated inscriptions.
- A session-level cache prevents re-querying the same person on family plots with multiple stones.
- When the OCR returns only a bare surname (e.g., "TOMB OF WASHINGTON"), two high-priority queries search the full inscription verbatim before falling back to name-only queries.
- `max_results: 2` per query; 6-query cap per Scan.

#### FR-13: WikiTree Genealogy Search
The system searches WikiTree for genealogy profiles matching the OCR name and dates, using a three-pass strategy: date-filtered → unfiltered → expanded-first-name fallback. Realizes UJ-1, UJ-2.

**Consequences:**
- Nickname-aware matching: "Lizzie" matches "Elizabeth"; "Wm" matches "William".
- Geographic scoring: known burial state from GPS adds ±30/−20 to candidate scores.
- When `multiple_subjects` is true, WikiTree is called in parallel for each of the first 2 subjects; results passed to biography as an array.

#### FR-14: Wikidata SPARQL
The system queries the free Wikidata SPARQL endpoint for structured birth/death dates and burial-place coordinates. Fires only when `name_confidence === 'high'`. Realizes UJ-2, UJ-3.

**Consequences:**
- No API key or proxy required (CORS-open, free endpoint).
- Returns `{ birthDate, deathDate, burialPlaceLabel, burialCoords }` or null.
- `burialCoords` is used as a GPS fallback for famous figures when no EXIF or device GPS was captured.
- Wikidata dates feed into `_buildCorroborationSummary()`.

#### FR-15: Chronicling America Newspaper Search
The system queries the Library of Congress Chronicling America API for pre-1924 obituaries and newspaper mentions. Fires only when `deathYear <= 1924`. Realizes UJ-2.

**Consequences:**
- No API key or proxy required (free, CORS-open).
- Returns up to 3 results with `source_type: 'public_domain'`.
- Runs in parallel with Tavily; results merged before biography generation.
- For death years > 1924, this step is skipped entirely.

#### FR-16: Wikipedia Article Summary & Portrait Images
The system fetches the Wikipedia article lead paragraph (for biography grounding) and up to 5 portrait images for each subject. Realizes UJ-2, UJ-3.

**Consequences:**
- `fetchWikipediaArticleSummary` returns `{ title, extract, url }` — the extract is injected as a numbered source in the bio prompt; the model must cite it with `[N]` markers rather than recalling training knowledge.
- `fetchWikipediaPortraits` returns up to 5 images shown in the biography result carousel.
- For multi-person stones, Wikipedia is called in parallel for each subject.
- Portrait retry: if the initial fetch returns empty (single-token OCR name), the system retries after biography generation using the resolved full name from the biography output.

#### FR-17: Symbol-Guided Research
The system maps detected gravestone symbols to targeted genealogy query strategies. Realizes UJ-2.

**Consequences:**
- ~30 symbol-to-query mappings: GAR emblem → Civil War veteran records; Masonic square & compass → Masonic lodge records; Odd Fellows three-link chain → IOOF records; military branch insignia → branch-specific records; VFW emblem → VFW records.
- Symbol-guided queries occupy the highest-priority Tavily slots.
- Symbol names are extracted by Gemini OCR and passed through to Tavily query construction.

#### FR-18: Nickname & Abbreviation Expansion
The system expands period abbreviations and informal given names into formal equivalents for all query variants. Realizes UJ-1.

**Consequences:**
- ~60-entry expansion table (Wm→William, Geo→George, Lizzie→Elizabeth, Jas→James, etc.).
- Expansion applied to Tavily queries and WikiTree name-matching.
- Single shared table (web: in `api-tavily.js`; mobile: in `abbreviations.js`) — no duplication.

**Feature-specific NFRs:**
- All research steps run in parallel; total research latency must not exceed the slowest individual source by more than 200 ms of overhead.
- Session-level caching prevents duplicate Tavily queries within a single session.

---

### 4.4 Maps & Location

**Description:** GraveStory uses location in two ways: (1) to understand where a grave is, and (2) to display saved stories on a map. Location understanding involves reverse geocoding GPS coordinates to a city/state string (for research queries), forward geocoding an AI-returned location string to a cemetery marker (for the map pin), and a two-pass search for the specific grave node within the cemetery. Map display provides a per-cemetery map (showing the user's own stories) and a community global map (public stories from all users). Web and mobile use different mapping libraries but identical geocoding logic.

**Functional Requirements:**

#### FR-19: Reverse Geocoding (GPS → City, State)
Before OCR, the system converts EXIF or device GPS coordinates to a human-readable "City, State" string used to disambiguate search queries. Realizes UJ-1.

**Consequences:**
- Runs in parallel with Gravestone Verification to minimize latency.
- The location string is threaded into OCR, Tavily, WikiTree, and biography generation.
- If no GPS is available, location hint is null and queries proceed without geographic disambiguation.

#### FR-20: Forward Geocoding (Cemetery & Grave Node)
After biography generation, the system resolves the AI-returned location string to GPS coordinates via Nominatim, then searches for the specific named grave node within the cemetery. Realizes UJ-3.

**Consequences:**
- Geographic context filter: city/state tokens from the AI location string must appear in Nominatim results, preventing cross-city false matches.
- If Nominatim resolves the cemetery to a different US state than the query specified, the map pin receives a Low-Confidence Pin flag.
- Web: two-pass Overpass query for grave nodes (Pass 1: tagged nodes within 1000 m; Pass 2: any named node within the bounding box at 100% token match).
- Mobile: two-pass Nominatim + Photon search (no Overpass — mirrors return 403 to Cloudflare Worker IPs).
- Successful grave-node matches are cached in a 30-day local cache (web: localStorage; mobile: AsyncStorage) to avoid re-querying.
- Camera-sourced EXIF/device GPS always takes priority over geocoded coordinates.

#### FR-21: Per-Cemetery Map
The User can view a map of their saved Stories grouped by cemetery. Realizes UJ-3.

**Consequences:**
- Web: Leaflet 1.9.4 + OpenStreetMap tiles. Mobile: react-native-maps (Apple Maps iOS, Google Maps Android).
- Each story is represented by a custom gravestone-silhouette marker at its GPS coordinates.
- Tapping a marker opens a floating overlay (not a `<Callout>` — Android touch events are unreliable) with the name, dates, location, and a "Read bio" toggle.
- Stories without GPS are not shown on the map.

#### FR-22: Cemetery Boundary Polygon (Web Only)
On web, the cemetery map draws the OSM polygon boundary of the cemetery. Realizes UJ-3.

**Consequences:**
- Fetches OSM ways and relations within 1000 m via Overpass; scores by name match, relation over way, smallest area.
- Relations are stitched from member ways; relations stitching to > 2000 points are skipped.
- **Not implemented on mobile** — Nominatim `polygon_geojson=1` produced incorrect boundaries on tested cemeteries; removed entirely from mobile.

#### FR-23: Nearby Cemeteries
The system surfaces other cemeteries within 5 km of the current cemetery. Realizes UJ-2.

**Consequences:**
- Uses Overpass `landuse=cemetery` and `amenity=grave_yard` within a 5 km radius.
- Unnamed results (no `name` tag) are filtered out.

#### FR-24: Drag-to-Correct Pin
The User can drag a story's map pin to correct its position. Realizes UJ-3.

**Consequences:**
- Long-press on a marker initiates drag mode; release prompts the user to confirm the correction.
- Confirmed correction is saved locally and synced to Supabase with `userCorrected: true`.
- The `update_grave_location` RPC is called; first user-correction wins and propagates.

#### FR-25: Low-Confidence Pin Flag
The system visually flags map pins where geocoding resolved to a different US state than expected. Realizes UJ-3.

**Consequences:**
- Web: silver `?` badge on the marker icon; `opacity: 0.75`; popup shows "⚠ approximate location".
- Mobile: faded pin style; floating overlay shows "⚠ approximate location" in warning color.
- Flag appears on both per-cemetery and global maps.

---

### 4.5 Save, Share & Export

**Description:** A completed Story can be saved to the user's local device storage and cloud account, shared via the native share sheet, and (on web) exported as cemetery data. The save flow includes uploading the gravestone photograph to Cloudflare R2, associating the story with a canonical Grave record, and syncing across the user's devices via an incremental delta sync. Soft-delete is used throughout — stories are never hard-deleted from the database, so deletions sync to other devices via a `deleted_at` timestamp.

**Functional Requirements:**

#### FR-26: Save Story
The User can save a completed Story to local storage and, if signed in, to their cloud account. Realizes UJ-1, UJ-3.

**Consequences:**
- Guest users: stories saved to localStorage (web) or AsyncStorage (mobile) with a 3-story cap [ASSUMPTION: guests are expected to sign up to retain more than 3 stories].
- Signed-in users: stories saved to user-scoped local storage and synced to Supabase.
- Save is subject to the web/mobile save limit check (10 stories for free users).

#### FR-27: Share Story
The User can share a Story via the device's native share mechanism. Realizes UJ-1.

**Consequences:**
- Web: Web Share API with story title and URL (if public).
- Mobile: React Native Share sheet.

#### FR-28: Canonical Grave Deduplication
The system deduplicates physical gravestone records so multiple users scanning the same stone share a single canonical Grave record. Realizes UJ-3.

**Consequences:**
- `find_or_create_grave` RPC performs an atomic ~20 m + name-match dedup in Supabase.
- Called after biography generation, only for signed-in users with resolved GPS.
- Returns a `grave_id` UUID attached to the Story.
- Non-fatal: if the RPC fails, the story saves normally without a canonical link.

#### FR-29: Delta Sync
The system incrementally syncs story changes across the user's devices using an `updated_at` watermark. Realizes UJ-3.

**Consequences:**
- `syncDelta` pulls only rows newer than the last high-water mark, minimizing bandwidth.
- Soft-delete: `deleted_at` timestamp propagates deletions to other devices.
- On sign-in, `syncOnSignIn` always performs a full cloud pull (not delta) — cloud is authoritative; local-only stories without a cloud `id` are the only ones preserved.
- Guest stories made before sign-in are pushed to cloud by `pushLocalOnly` on sign-in.

#### FR-30: Gravestone Photo Upload
The system uploads the gravestone photograph to Cloudflare R2 and stores the URL on the Story. Realizes UJ-1.

**Consequences:**
- Upload happens after cloud story creation; `image_url` is written to the story record via a second update call.
- If upload fails, the story is saved without an image URL (non-fatal).
- The `grave_photos` table records one row per photo per story (FK to `grave_id`), enabling the grave photo gallery on the global map.

---

### 4.6 Auth & Accounts

**Description:** GraveStory supports unauthenticated (Guest) use up to the scan limit, then prompts for sign-in. Auth is provided by Supabase with two methods: email/password and Google OAuth. Users can set a display name and a default story visibility (public/private). The mobile app requires a native development build for Google OAuth (Expo Go is not supported).

**Functional Requirements:**

#### FR-31: Email / Password Auth
The User can create an account and sign in with email and password. Realizes UJ-1.

**Consequences:**
- Supabase email provider. Standard confirm-email flow.
- Mobile sign-up attaches a device fingerprint (`device_id` SHA-256 hash of hardware properties) to `user_metadata` as a soft anti-abuse signal.

#### FR-32: Google OAuth
The User can sign in with a Google account. Realizes UJ-1.

**Consequences:**
- Web: Supabase OAuth redirect.
- Mobile: `expo-web-browser` PKCE flow; redirect URI `gravestory://login-callback`.
- Requires a native development build (not Expo Go).
- `polyfills.js` must load before any Supabase code on mobile — Hermes lacks `crypto.getRandomValues` and `crypto.subtle`, which PKCE requires.

#### FR-33: User Preferences
The signed-in User can set a display name and a default story visibility (public/private). Realizes UJ-1.

**Consequences:**
- Stored in Supabase `user_metadata`.
- Default visibility is applied to new Stories automatically.

#### FR-34: Guest Usage
Unauthenticated users can scan and view biographies without an account, up to the guest scan limit. Realizes UJ-1.

**Consequences:**
- Guest scan limit: 3 lifetime scans.
- Guest story storage: localStorage (web) or AsyncStorage (mobile) with no cloud sync.
- Guest users cannot access the Global Map.
- Scan count stored server-side in the `scan_events` table (web and mobile); fails closed on Supabase error (i.e., if the count cannot be read, access is denied rather than granted).

---

### 4.7 Community Global Map

**Description:** Signed-in users can make their Stories public. Public Stories from all users appear on the Global Map — a community map of documented lives. The Global Map is read-only for all users (no editing others' stories); Guests see a prompt to sign up before viewing individual biographies. The map deduplicates pins so the same grave appears only once even if multiple users have scanned it.

**Functional Requirements:**

#### FR-35: Public Story Submission
The signed-in User can mark a Story as public, making it visible on the Global Map. Realizes UJ-2.

**Consequences:**
- `is_public` flag toggled from the Result screen or Story card.
- Public stories are stored in the shared `stories` table; read by all authenticated users.

#### FR-36: Global Map Pin Deduplication
The system deduplicates Global Map pins so the same physical grave appears as a single marker. Realizes UJ-2.

**Consequences:**
- First pass: drop duplicate `grave_id`s (keeps the most-recent row per canonical grave).
- Second pass: drop stories whose GPS rounds to the same ~20 m cell as an already-kept pin.
- Low-confidence pins are flagged visually; story popup notes "⚠ approximate location".

#### FR-37: Guest Gate
Guest users see a sign-up prompt instead of individual biographies on the Global Map. Realizes UJ-1.

**Consequences:**
- The Global Map is visible to guests (they can see markers) but biography text is gated.

#### FR-38: Global Map Portrait Gallery
When viewing a public Story on the Global Map, the biography carousel shows all grave photos contributed by other users (up to 10, newest first) followed by Wikipedia portraits. Realizes UJ-2.

**Consequences:**
- `grave_photos` table holds one row per photo per story with FK to `grave_id`.
- Web: horizontal scroll-snap gallery strip.
- Mobile: FlatList carousel; portraits live-fetched on mount since file:// URIs are device-local.

---

### 4.8 Tributes

**Description:** A signed-in user who photographed a grave with their camera can leave a symbolic tribute: a candle or a flower. Tributes are per-user per-grave (one tribute type at a time), persistent in the database, and visible to all users viewing the story. The tribute count is always visible; the toggle buttons appear only for camera-sourced stories where the user is signed in.

**Functional Requirements:**

#### FR-39: Leave a Tribute
The signed-in User can leave a candle or flower tribute on a Grave they scanned with their camera. Realizes UJ-1.

**Consequences:**
- `UNIQUE(grave_id, user_id)` constraint — one tribute per user per grave.
- Tapping a button matching the user's existing tribute removes it (toggle off).
- Tapping a different type switches the tribute type.
- Counts refresh from Supabase after each toggle.

#### FR-40: Tribute Visibility
Tribute counts (candles and flowers) are visible to all users who view a Story linked to a canonical Grave. Realizes UJ-2.

**Consequences:**
- Tribute counts are shown whenever `grave_id` is present on the story, regardless of the viewer's account status.
- Toggle buttons are only shown when: signed in + `source === 'camera'` + story is not a Global Map bio from another user.

---

### 4.9 Freemium & Monetization

**Description:** GraveStory uses a credit-based freemium model with no subscriptions. New users (guest and free signed-in) receive a fixed lifetime allotment of free scans. Additional scans are purchased in one-time credit packs through the in-app payment flow (RevenueCat on mobile; [ASSUMPTION: web payment integration not yet built]). Credits never expire. An `is_unlimited` flag in Supabase `app_metadata` bypasses all limits for designated testers and VIP users (set via SQL editor; clients cannot self-elevate).

**Functional Requirements:**

#### FR-41: Guest Scan Limit
Guest users are limited to 3 lifetime Scans. Realizes UJ-1.

**Consequences:**
- Enforced by `checkWebScanLimit` (web) / `checkScanLimit` (mobile) before the pipeline starts.
- Scan count stored server-side in the `scan_events` table.
- On limit reached, the user is prompted to create an account.
- Fails closed on Supabase error: if the count cannot be read, the scan is blocked (not silently allowed).

#### FR-42: Free Signed-In Scan Limit
Free signed-in users are limited to 10 lifetime Scans (plus any purchased credits). Realizes UJ-1.

**Consequences:**
- Same enforcement mechanism as FR-41.
- On limit reached, the Paywall screen is shown with credit pack options.
- `is_unlimited: true` in `app_metadata` bypasses this check.

#### FR-43: Purchased Scan Credits
The User can purchase additional scan credits in three packs. Realizes UJ-1.

**Consequences:**
- Starter: 5 scans / $0.99 (`gravestory_5_scans`).
- Explorer: 20 scans / $2.99 (`gravestory_20_scans`).
- Historian: 60 scans / $6.99 (`gravestory_60_scans`).
- Credits stored in the `scan_credits` table (service-role write only via RevenueCat webhook; clients cannot write directly).
- Credits never expire.
- RevenueCat SDK (`react-native-purchases`) is installed but currently disabled pending Play Store account and production API key.

#### FR-44: Save Limit
Free signed-in users are limited to 10 saved Stories. Realizes UJ-1.

**Consequences:**
- `checkWebSaveLimit` (web) / save-limit check (mobile) gates the save flow.
- Guest save limit: 3 stories.
- On limit reached, the user is prompted to purchase credits or upgrade. [ASSUMPTION: save limit and scan limit share the same paywall screen on mobile.]

#### FR-45: Unlimited Tier (Admin-Set)
Designated testers and VIP users can bypass all scan and save limits. Realizes UJ-1 (tester path).

**Consequences:**
- `is_unlimited: true` set in Supabase `app_metadata` via SQL editor (not via any client API).
- Checked at the start of every scan and save flow.

---

### 4.10 PWA & Native App Installability

**Description:** The web app is a Progressive Web App: it installs to the home screen on Android and iOS, caches the app shell and map tiles for offline use, and shows a custom install prompt. The mobile app is a React Native app built with Expo managed workflow, distributed via EAS Build. OTA (Over-The-Air) updates push JS-layer changes to installed mobile apps without requiring a new Play Store / App Store submission.

**Functional Requirements:**

#### FR-46: Web PWA Install
The web app can be installed to the device home screen as a PWA. Realizes UJ-1.

**Consequences:**
- `beforeinstallprompt` captured and surfaced as a custom install banner (Android Chrome).
- iOS: manual "Add to Home Screen" hint displayed (Safari does not support `beforeinstallprompt`).
- Service worker caches the app shell (`gravestory-v13`) and Leaflet map tiles separately.

#### FR-47: Mobile OTA Updates
Mobile JS-layer changes are delivered to installed apps without a new store submission. Realizes UJ-3.

**Consequences:**
- `expo-updates` configured with `updates.url` and `runtimeVersion`.
- Preview builds receive updates on the `preview` channel; personal test builds on the `phase-9` channel.
- Native module changes (new Expo SDK version, new native dependency) still require a full build.

---

## 5. Non-Goals (Explicit)

- **Grave discovery before scanning** — the app cannot help a user find a specific grave they have not yet photographed. No "search by name in this cemetery" feature.
- **Family tree / genealogy workspace** — GraveStory provides a starting point, not a full genealogy tool. No parent/spouse/child relationship tracking, no GEDCOM export (shelved: insufficient relationship data to produce meaningful family trees).
- **Cemetery administration tools** — no content management, grave registration, or burial record management for cemetery operators.
- **Subscription model** — intentionally excluded due to unbounded Tavily API cost risk with unlimited scanning. Credits-only model chosen.
- **FamilySearch integration** — FamilySearch does not permit registration for projects that are not live products. Revisit after public Play Store / App Store launch.
- **iOS-first** — iOS development requires a $99/yr Apple Developer account not yet obtained. Android is the v1 native target; web PWA serves iOS users.
- **Offline biography generation** — requires on-device AI models not available in the Expo managed workflow. All AI calls require network connectivity.
- **Real-time collaboration** — stories are per-user with optional public sharing; no co-editing or real-time comment threads.

---

## 6. MVP Scope

### 6.1 In Scope (Current State — Phase 9)

- Gravestone photo capture (camera + library), EXIF GPS extraction, compression
- Gemini gravestone verification + OCR with structured output
- Parallel research: Tavily, WikiTree, Wikidata, Chronicling America, Wikipedia (portrait + article)
- Symbol-guided queries, nickname expansion, age-at-death parsing
- Multi-person detection and combined biography
- Historical figure extended biography with namesake guard
- Cross-source corroboration and citation integrity
- Evidence-scaled biography length
- Stone-only fallback
- Portrait retry for single-token names
- Reverse + forward geocoding; grave node search; low-confidence pin flag
- Drag-to-correct pin
- Per-cemetery Leaflet/react-native-maps map with cemetery boundary (web only)
- Global community map with deduplication and guest gate
- Save / share / cloud sync (delta sync + soft-delete)
- Canonical grave deduplication (`find_or_create_grave`)
- Gravestone photo gallery on global map bios
- Biography result cache (`find_grave` RPC)
- Supabase auth (email + Google OAuth)
- User preferences (display name, default visibility)
- Tributes (candle / flower)
- Freemium model: guest 3 / free 10 lifetime scans; 3 credit packs; save limit 10
- Paywall screen (mobile)
- Web scan/save limits (`js/scan-limit.js`)
- PWA (service worker, install banner)
- OTA updates (EAS Update)
- Cloudflare Worker proxy with CLIENT_KEY + origin check
- XSS prevention (escapeHtml on all AI content)
- Portrait persistence (mobile)

### 6.2 Out of Scope for MVP

- **RevenueCat payment flow** — SDK installed but disabled; requires Play Store account and production RevenueCat key. [NOTE FOR PM: blocking for monetization activation; unblocked by $25 Play Store registration.]
- **Privacy policy hosted page** — draft written; needs hosting at `https://j3k420.github.io/gravestory-privacy` and link from Settings.
- **iOS native app** — requires $99/yr Apple Developer account.
- **FamilySearch integration** — shelved until public app store presence established.
- **GEDCOM export** — shelved; insufficient relationship data.
- **Web payment flow** — no in-browser purchase UI; web users hit the limit and see instructions to use the mobile app.
- **3-person stone full research** — third and beyond subjects get no dedicated Tavily slots; portraits and Wikipedia articles are fetched (up to 3 subjects) but research depth is reduced.

---

## 7. Cross-Cutting NFRs

### Performance
- **NFR-P1:** Total pipeline time (photo to biography rendered) must be under 30 seconds on a standard LTE connection for a typical stone with 2–3 research sources returning results. [ASSUMPTION: 30 s is an acceptable UX ceiling for a cemetery visitor standing at a grave.]
- **NFR-P2:** Gemini API calls include a 30-second `fetchWithTimeout` so hanging requests surface as errors rather than infinite loading.
- **NFR-P3:** All research integrations run in parallel; total research latency must not exceed the slowest source by more than 200 ms of orchestration overhead.
- **NFR-P4:** Map tile caching via service worker (web) ensures the map is usable offline after first visit to a cemetery.

### Security
- **NFR-S1:** No API keys in client-side code. All sensitive calls (Gemini, Tavily, WikiTree, R2) route through the Cloudflare Worker proxy.
- **NFR-S2:** The Worker enforces two auth layers: `ALLOWED_ORIGIN` env var (browser request validation) and `CLIENT_KEY` secret header (mobile/direct request validation).
- **NFR-S3:** All AI-generated or user-sourced data injected into `innerHTML` must pass through `escapeHtml()`. This is a hard invariant — no exceptions.
- **NFR-S4:** Story objects must never be serialized into HTML `onclick` attributes. Popup interactions use module-level lookup tables keyed by safe primitives.
- **NFR-S5:** Scan limit checks fail closed on Supabase errors — a failed check blocks the scan rather than allowing it.
- **NFR-S6:** `scan_credits` table is write-only via service-role (RevenueCat webhook); clients can SELECT but not INSERT/UPDATE/DELETE.

### Reliability
- **NFR-R1:** Gemini calls auto-fallback to `gemini-2.5-flash` on HTTP 503, 429, network errors, or overload response bodies.
- **NFR-R2:** All research integrations degrade gracefully — a failure in one source does not block the pipeline; biography generates from available results.
- **NFR-R3:** The stone-only fallback ensures the user always receives output, even when all research fails.
- **NFR-R4:** `findOrCreateGrave` failure is non-fatal — the story saves without a `grave_id` rather than blocking save.
- **NFR-R5:** Mobile: `.catch()` must not be used on Supabase query builders (Hermes JS engine incompatibility); use `try/await/catch` instead.

### Observability
- **NFR-O1:** `console.warn` only for genuine failures (not debug data dumps). [ASSUMPTION: no structured logging pipeline exists; warn-only approach is appropriate for current scale.]

---

## 8. Constraints & Guardrails

### Privacy
- GPS coordinates are only captured with user permission (location permission modal before first use).
- EXIF GPS from library photos is used silently [ASSUMPTION: library photo GPS is considered part of the file the user selected; explicit disclosure in the privacy policy is required].
- Gravestone photographs are uploaded to Cloudflare R2 only when the user explicitly saves a story.
- A privacy policy is drafted but not yet published. Must be live before public Play Store launch.
- Stories are scoped to the user's account. Public stories share biography text and photo, not user identity beyond display name. [ASSUMPTION: GDPR compliance review has not been formally conducted.]

### Cost
- Tavily API cost is the primary operating expense per scan. The 6-query cap and `max_results: 2` are cost controls chosen to keep per-scan cost manageable.
- The credits-only monetization model (no unlimited subscriptions) is a direct response to unbounded Tavily cost risk.
- Wikidata and Chronicling America are free direct APIs; their use adds zero marginal cost.
- Gemini billing is per-token; the evidence-scaled biography length ceiling (2,500 words max) bounds output token cost.

### Content Safety
- Biographies are generated about historical figures and private individuals. The prompts instruct the model to be compassionate and factual — not to speculate about cause of death, mental health, or family conflicts beyond what sources state.
- The namesake guard prevents the model from writing a famous person's biography for an unrelated individual who shares a name and approximate dates.
- Low-confidence OCR triggers identity hedging in the biography ("the inscription is difficult to read with certainty…").

### Technical Constraints
- **Web:** Vanilla HTML/CSS/JS only. No npm, no bundler, no TypeScript, no framework, no ES modules. Classic `<script src>` load order; `function` declarations only (not `const fn =`). Static files deployed to GitHub Pages.
- **Mobile:** Expo managed workflow only. No bare ejection. ES modules throughout `mobile/src/`.
- **Both platforms:** Changes to pipeline logic must be applied to BOTH web (`index.html` + `js/`) and mobile (`mobile/src/`) — they are parallel codebases, not shared code.

---

## 9. Aesthetic & Tone

### Visual Design Language
- **Dark gothic:** backgrounds near-black warm brown (`#1a1410` web / `#14100b` mobile), gold accent (`#c9a84c` web / `#f2b65c` mobile), warm cream text (`#e8d4a0` web / `#efe4d2` mobile).
- **Typography (web):** Playfair Display (serif) for headings; Crimson Pro (serif) for body and UI.
- **Typography (mobile):** Fraunces (300/400/italic/500/700) for headings and biography; Hanken Grotesk (400/500/600) for UI labels and buttons.
- The visual tone references cemetery monument aesthetics: carved stone, candlelight, aged parchment. Anti-reference: sterile white genealogy database UIs.

### Voice & Tone (AI-Generated Biography)
- **Compassionate and respectful.** Every person on a stone deserves a dignified account, regardless of how little evidence exists.
- **Factual and grounded.** All claims cite a source. Speculation is labeled as such.
- **Contextual.** A biography situates the person in their era: the wars they may have lived through, the economic conditions, the community structures — without asserting more than the sources support.
- **Honest about uncertainty.** Low-confidence OCR, conflicting dates, and sparse sources are acknowledged in the text, not hidden.
- Anti-reference: AI-generated obituary voice that asserts definite facts without sources; genealogy boilerplate ("was born to… and died at the age of…").

---

## 10. Monetization

**Model:** Credits-only. No subscriptions.

| Tier | Scans | Price | Product ID |
|------|-------|-------|-----------|
| Free (Guest) | 3 lifetime | $0 | — |
| Free (Signed-In) | 10 lifetime | $0 | — |
| Starter Pack | +5 scans | $0.99 | `gravestory_5_scans` |
| Explorer Pack | +20 scans | $2.99 | `gravestory_20_scans` |
| Historian Pack | +60 scans | $6.99 | `gravestory_60_scans` |

**Rationale:** Unlimited subscriptions create unbounded Tavily API cost. A per-scan credit model aligns revenue to direct cost; occasional visitors (most users) pay nothing or buy a small pack; dedicated genealogy enthusiasts buy the Historian pack.

**Infrastructure:** RevenueCat SDK (`react-native-purchases`) on mobile. Products registered in RevenueCat dashboard. A RevenueCat webhook will call the Cloudflare Worker to INSERT into `scan_credits` (service-role only). RevenueCat is currently disabled pending Play Store account.

**Web:** No in-browser purchase flow in v1. Web users who exhaust free scans are directed to the mobile app to purchase credits.

---

## 11. Platform

| Surface | v1 Target | Status |
|---------|-----------|--------|
| Web PWA (Android Chrome) | Full feature set | Deployed — GitHub Pages |
| Web PWA (iOS Safari) | Full feature set; manual "Add to Home Screen" | Deployed |
| Android native (Expo/EAS) | Full feature set + RevenueCat | Phase 9 — tester APK distributed |
| iOS native (Expo/EAS) | Full feature set | Blocked — requires $99/yr Apple Developer account |

**Web:** Static files on GitHub Pages. No CI/CD; deploy by pushing to the `main` branch (GitHub Pages auto-deploys). Cloudflare Worker deployed separately via `wrangler deploy`.

**Mobile:** EAS managed builds. OTA JS updates via `expo-updates`. Preview builds (`npx eas build --profile preview`) for testers; production AAB (`--profile production`) for Play Store. Development builds (`--profile development`) for live Metro reload during development.

---

## 12. Success Metrics

**Primary**

- **SM-1: Scan-to-bio completion rate** — percentage of scans that produce a biography (not a verification rejection or pipeline error). Target: > 85%. Validates FR-3, FR-4, FR-6, FR-7.
- **SM-2: Research hit rate** — percentage of biographies backed by ≥ 2 external sources. Target: > 60% of scans on pre-1980 stones. Validates FR-12 through FR-17.
- **SM-3: Return scan rate** — percentage of users who complete ≥ 2 scans. Target: > 40% within 30 days. Validates overall product value and discovery loop.

**Secondary**

- **SM-4: Save rate** — percentage of completed biographies that the user saves. Target: > 50%. Validates FR-26.
- **SM-5: Public story rate** — percentage of saved stories marked public. Target: > 20%. Validates FR-35 and community growth.
- **SM-6: Credit pack conversion** — percentage of free-limit-reached users who purchase a credit pack. Target: > 5% at launch. Validates FR-43.
- **SM-7: Tribute rate** — percentage of camera-sourced stories where the user leaves a tribute. Validates FR-39 (engagement signal, not a growth metric).

**Counter-Metrics (Do Not Optimize)**

- **SM-C1: API cost per scan** — must not grow as scan volume grows. Counterbalances SM-2 (adding more research sources increases hit rate but also cost).
- **SM-C2: Scan-limit complaint rate** — excessive user frustration with the free limit signals the limit is too aggressive. Counterbalances SM-6 (higher credit conversion achieved via an artificially low free limit is not a win).
- **SM-C3: Biography hallucination rate** — rate at which users report factual errors. Must not increase as biography length ceiling rises. Counterbalances SM-1 (a biography always being generated is not success if it's fiction).

---

## 13. Open Questions

1. **Privacy policy hosting** — draft is written; needs to be hosted at `https://j3k420.github.io/gravestory-privacy` and linked from Settings. Blocking for public Play Store listing.
2. **RevenueCat production key** — requires a Google Play Store developer account ($25) and RevenueCat project setup with real product IDs. Blocks monetization activation.
3. **Web payment flow** — currently no in-browser purchase path; web users must use the mobile app. Is a Stripe or web-based RevenueCat integration planned for v2?
4. **GDPR / privacy compliance** — no formal review has been conducted. Before public EU-facing launch, confirm: data residency (Supabase region), right-to-erasure (soft-delete propagates but rows are not physically removed), and cookie/tracking disclosures.
5. **FamilySearch integration timeline** — FamilySearch requires a live product to register. Once GraveStory is on the Play Store, what is the integration priority vs. other research sources?
6. **3-person stone research gap** — third+ subjects receive no dedicated Tavily slots. Is a per-person slot restructuring planned, or is a user-facing disclaimer sufficient?
7. **iOS launch** — what is the timeline/budget decision for the $99/yr Apple Developer account?
8. **RevenueCat webhook endpoint** — the Cloudflare Worker needs a `/revenuecat-webhook` endpoint to receive purchase events and write to `scan_credits`. Not yet built.
9. **Biography accuracy feedback** — no user feedback mechanism exists (e.g., "flag this biography as inaccurate"). Should one be added before public launch?
10. **scan_credits migration** — `005_scan_credits.sql` is written but not yet run in Supabase. Must be executed before RevenueCat goes live.

---

## 14. Assumptions Index

- **§2.2 [ASSUMPTION]** — a future "search by name within a cemetery before scanning" feature is desirable but not built.
- **§4.1 FR-3 [implicit]** — Gemini verification costs are low enough that firing it on every scan is economically acceptable; no verification-skip fast path exists.
- **§4.9 FR-44 [ASSUMPTION]** — save limit and scan limit share the same paywall screen on mobile.
- **§7 NFR-P1 [ASSUMPTION]** — 30 seconds is the acceptable UX ceiling for pipeline completion in a cemetery context; has not been formally user-tested.
- **§7 NFR-O1 [ASSUMPTION]** — no structured logging pipeline exists; warn-only approach is appropriate for current scale.
- **§8 Privacy [ASSUMPTION]** — using EXIF GPS from a library photo the user selected counts as implicit consent; this must be disclosed in the privacy policy.
- **§8 Privacy [ASSUMPTION]** — GDPR compliance review has not been formally conducted.
- **§10 Monetization [ASSUMPTION]** — web users who exhaust free scans are willing to download the mobile app to purchase credits rather than abandoning the product.
