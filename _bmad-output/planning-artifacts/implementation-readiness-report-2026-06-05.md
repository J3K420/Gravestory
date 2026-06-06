---
stepsCompleted: [1, 2, 3, 4, 5, 6]
inputDocuments:
  - _bmad-output/planning-artifacts/prd.md
  - _bmad-output/planning-artifacts/architecture.md
  - _bmad-output/planning-artifacts/epics.md
---

# Implementation Readiness Assessment Report

**Date:** 2026-06-05
**Project:** GraveStory

## Document Inventory

| Type | File | Status |
|------|------|--------|
| PRD | `_bmad-output/planning-artifacts/prd.md` | ✅ Canonical — use this |
| PRD (run folder copy) | `_bmad-output/planning-artifacts/prds/prd-GraveStory-2026-06-05/prd.md` | ℹ️ Intentional mirror — same content |
| Architecture | `_bmad-output/planning-artifacts/architecture.md` | ⚠️ Skeleton only — no decisions populated |
| Epics & Stories | `_bmad-output/planning-artifacts/epics.md` | ⚠️ Requirements extracted; epics not yet designed |
| UX Design | None found | ℹ️ Not applicable — patterns in codebase |

---

## PRD Analysis

### Functional Requirements (47 total)

FR-1: User can initiate a Scan from device camera or photo library; source tracked as 'camera' or 'library'
FR-2: System extracts GPS from photograph EXIF metadata before image compression
FR-3: System verifies photograph shows a gravestone before OCR; rejection screen with "Use it anyway" bypass
FR-4: System reads gravestone inscription via Gemini OCR → structured JSON (primary_name, dates, inscription, symbols, name_confidence, alternate_names, multiple_subjects)
FR-5: System compresses photograph to 1024px JPEG before AI calls; EXIF extracted first
FR-6: System generates source-grounded biographical narrative with numbered inline citations
FR-7: System produces stone-only paragraph (without Gemini) when all research returns empty
FR-8: System generates combined biography for multiple subjects; user warned to photograph each stone separately
FR-9: System generates extended biography (up to 2,500 words) for confirmed notable historical figures — requires dates ±5yr AND Wikipedia source present AND every claim has [N] marker
FR-10: Biography length scales automatically: 1 weak source → 1–2 para; 2 → 2–4 para; 3+ → 1,500 words; historical figure → 2,500 words
FR-11: System cross-checks name/date agreement across all sources; discrepancies surfaced in biography text
FR-12: System runs up to 6 Tavily queries per Scan in priority order; session-level cache prevents duplicate queries on family plots
FR-13: System searches WikiTree with 3-pass strategy; nickname-aware; geographic scoring ±30/−20 by burial state
FR-14: System queries Wikidata SPARQL for birth/death dates and burial-place coords; fires only when name_confidence === 'high'; burialCoords used as GPS fallback
FR-15: System queries Chronicling America for pre-1924 obituaries; fires only when deathYear ≤ 1924; up to 3 results with source_type 'public_domain'
FR-16: System fetches Wikipedia article lead paragraph (as numbered source) and up to 5 portrait images per subject; portrait retry after biography if initial fetch empty
FR-17: System maps ~30 detected gravestone symbols to targeted Tavily query strategies (GAR, Masonic, military, VFW, etc.)
FR-18: System expands ~60 period abbreviations and nicknames in all Tavily queries and WikiTree name matching
FR-19: System converts EXIF/device GPS to "City, State" string via reverse geocoding before OCR; threaded into all research queries
FR-20: System resolves AI-returned location string to GPS via Nominatim; 2-pass grave node search (web: Overpass; mobile: Nominatim+Photon); 30-day local cache; camera/EXIF GPS takes priority
FR-21: User can view per-cemetery map of saved Stories with custom gravestone markers and floating overlay callout
FR-22: Web cemetery map draws OSM polygon boundary via Overpass (not available on mobile)
FR-23: System surfaces nearby cemeteries within 5km (named landuse=cemetery / amenity=grave_yard only)
FR-24: User can drag story map pin to correct its position; correction saved locally and synced via update_grave_location RPC
FR-25: System visually flags Low-Confidence Pins where geocoding resolved to a different US state than expected
FR-26: User can save Story to local storage and cloud (if signed in); subject to save limit
FR-27: User can share a Story via device native share mechanism
FR-28: System deduplicates physical gravestone records via find_or_create_grave RPC (~20m + name match); non-fatal on failure
FR-29: System incrementally syncs story changes across devices via updated_at watermark; soft-delete propagates via deleted_at; syncOnSignIn does full cloud pull
FR-30: System uploads gravestone photograph to Cloudflare R2; URL stored on Story; grave_photos table records photo per story per grave_id
FR-31: User can create an account and sign in with email/password; mobile sign-up attaches device fingerprint to user_metadata
FR-32: User can sign in with Google account (Supabase OAuth; mobile PKCE via expo-web-browser with gravestory://login-callback)
FR-33: Signed-in user can set display name and default story visibility (stored in Supabase user_metadata)
FR-34: Guest users can scan and view biographies up to the guest scan limit (3 lifetime); no cloud sync; cannot access Global Map
FR-35: Signed-in user can mark a Story as public, making it visible on the Global Map
FR-36: System deduplicates Global Map pins (first pass: by grave_id; second pass: by ~20m GPS cell); Low-Confidence pins flagged visually
FR-37: Guest users see sign-up prompt instead of biography text on the Global Map
FR-38: Global Map story carousel shows all grave_photos for that grave_id (up to 10 newest first) then Wikipedia portraits; mobile live-fetches portraits on mount
FR-39: Signed-in user who scanned a grave with camera can leave a candle or flower tribute; one tribute per user per grave; toggle same type removes; toggle different type switches
FR-40: Tribute counts always visible when grave_id present; toggle buttons only shown for signed-in + camera-sourced + non-global stories
FR-41: Guest users limited to 3 lifetime Scans; scan_events table; fails closed on Supabase error
FR-42: Free signed-in users limited to 10 lifetime Scans + purchased credits; is_unlimited flag bypasses; fails closed on error
FR-43: User can purchase scan credits (5/$0.99, 20/$2.99, 60/$6.99) via RevenueCat; stored in scan_credits (service-role write only); never expire
FR-44: Free signed-in users limited to 10 saved Stories (3 for guests); checkWebSaveLimit / save-limit check gates save flow
FR-45: Designated testers/VIP bypass all limits via is_unlimited: true in app_metadata (SQL editor only, not client-settable)
FR-46: Web app installable as PWA; beforeinstallprompt banner on Android; manual iOS hint; service worker caches app shell and map tiles
FR-47: Mobile JS-layer changes delivered OTA via expo-updates without new store submission

**Total FRs: 47**

### Non-Functional Requirements (16 total)

NFR-P1: Total pipeline < 30 seconds on standard LTE for a typical stone with 2–3 research sources
NFR-P2: All Gemini calls include 30-second fetchWithTimeout; hangs surface as errors, not infinite loading
NFR-P3: Research integrations run in parallel; overhead must not exceed slowest source by more than 200ms
NFR-P4: Map tile caching via service worker ensures offline usability after first cemetery visit (web)
NFR-S1: No API keys in client-side code; all sensitive calls route through Cloudflare Worker proxy
NFR-S2: Worker enforces ALLOWED_ORIGIN env var (browser) + CLIENT_KEY secret header (mobile/direct)
NFR-S3: ALL AI-generated or user-sourced data injected into innerHTML must pass through escapeHtml() — no exceptions
NFR-S4: Story objects must never be serialized into HTML onclick attributes; use module-level lookup tables
NFR-S5: Scan limit checks fail closed on Supabase errors (block scan, never allow silently)
NFR-S6: scan_credits table is write-only via service-role; clients SELECT only
NFR-R1: Gemini auto-fallback to gemini-2.5-flash on HTTP 503, 429, network errors, or overload response bodies
NFR-R2: Failure in any single research integration does not block the pipeline; biography generates from available results
NFR-R3: Stone-only fallback ensures user always receives output even when all research fails
NFR-R4: findOrCreateGrave failure is non-fatal; story saves without grave_id
NFR-R5: No .catch() on Supabase query builders (Hermes JS engine incompatibility); always use try/await/catch
NFR-O1: console.warn only for genuine failures; no debug data dumps

**Total NFRs: 16**

### PRD Completeness Assessment

The PRD is comprehensive and well-formed:
- All 47 FRs are clearly stated, testable, and consequence-driven
- NFRs cover performance, security, reliability, and observability
- Non-Goals are explicit
- Open Questions are numbered and actionable
- Assumptions are indexed
- Platform constraints are documented
- Monetization model is fully specified

**Gap:** architecture.md is a skeleton with no decisions populated. The PRD references architectural constraints (Cloudflare Worker, Supabase RLS, Expo managed, etc.) but these are not yet formally documented in the architecture artifact.

---

## Epic Coverage Validation

### Coverage Matrix

| FR | Short Description | Epic Coverage | Status |
|----|-------------------|--------------|--------|
| FR-1 | Photo source selection | NOT IN EPICS | ❌ MISSING |
| FR-2 | EXIF GPS extraction | NOT IN EPICS | ❌ MISSING |
| FR-3 | Gravestone verification preflight | NOT IN EPICS | ❌ MISSING |
| FR-4 | Gravestone OCR → structured JSON | NOT IN EPICS | ❌ MISSING |
| FR-5 | Image compression | NOT IN EPICS | ❌ MISSING |
| FR-6 | Source-grounded biography generation | NOT IN EPICS | ❌ MISSING |
| FR-7 | Stone-only fallback | NOT IN EPICS | ❌ MISSING |
| FR-8 | Multi-person biography | NOT IN EPICS | ❌ MISSING |
| FR-9 | Historical figure extended biography | NOT IN EPICS | ❌ MISSING |
| FR-10 | Evidence-scaled biography length | NOT IN EPICS | ❌ MISSING |
| FR-11 | Cross-source corroboration | NOT IN EPICS | ❌ MISSING |
| FR-12 | Tavily web search | NOT IN EPICS | ❌ MISSING |
| FR-13 | WikiTree genealogy search | NOT IN EPICS | ❌ MISSING |
| FR-14 | Wikidata SPARQL | NOT IN EPICS | ❌ MISSING |
| FR-15 | Chronicling America | NOT IN EPICS | ❌ MISSING |
| FR-16 | Wikipedia portrait + article | NOT IN EPICS | ❌ MISSING |
| FR-17 | Symbol-guided research | NOT IN EPICS | ❌ MISSING |
| FR-18 | Nickname/abbreviation expansion | NOT IN EPICS | ❌ MISSING |
| FR-19 | Reverse geocoding | NOT IN EPICS | ❌ MISSING |
| FR-20 | Forward geocoding + grave node search | NOT IN EPICS | ❌ MISSING |
| FR-21 | Per-cemetery map | NOT IN EPICS | ❌ MISSING |
| FR-22 | Cemetery boundary polygon (web only) | NOT IN EPICS | ❌ MISSING |
| FR-23 | Nearby cemeteries | NOT IN EPICS | ❌ MISSING |
| FR-24 | Drag-to-correct pin | NOT IN EPICS | ❌ MISSING |
| FR-25 | Low-Confidence Pin flag | NOT IN EPICS | ❌ MISSING |
| FR-26 | Save story | NOT IN EPICS | ❌ MISSING |
| FR-27 | Share story | NOT IN EPICS | ❌ MISSING |
| FR-28 | Canonical grave deduplication | NOT IN EPICS | ❌ MISSING |
| FR-29 | Delta sync | NOT IN EPICS | ❌ MISSING |
| FR-30 | Gravestone photo upload to R2 | NOT IN EPICS | ❌ MISSING |
| FR-31 | Email/password auth | NOT IN EPICS | ❌ MISSING |
| FR-32 | Google OAuth | NOT IN EPICS | ❌ MISSING |
| FR-33 | User preferences | NOT IN EPICS | ❌ MISSING |
| FR-34 | Guest usage | NOT IN EPICS | ❌ MISSING |
| FR-35 | Public story submission | NOT IN EPICS | ❌ MISSING |
| FR-36 | Global map pin deduplication | NOT IN EPICS | ❌ MISSING |
| FR-37 | Guest gate on global map | NOT IN EPICS | ❌ MISSING |
| FR-38 | Global map portrait gallery | NOT IN EPICS | ❌ MISSING |
| FR-39 | Leave a tribute | NOT IN EPICS | ❌ MISSING |
| FR-40 | Tribute visibility | NOT IN EPICS | ❌ MISSING |
| FR-41 | Guest scan limit | NOT IN EPICS | ❌ MISSING |
| FR-42 | Free signed-in scan limit | NOT IN EPICS | ❌ MISSING |
| FR-43 | Purchased scan credits (RevenueCat) | NOT IN EPICS | ❌ MISSING |
| FR-44 | Save limit | NOT IN EPICS | ❌ MISSING |
| FR-45 | Unlimited tier (admin-set) | NOT IN EPICS | ❌ MISSING |
| FR-46 | Web PWA installability | NOT IN EPICS | ❌ MISSING |
| FR-47 | Mobile OTA updates | NOT IN EPICS | ❌ MISSING |

### Coverage Statistics

- **Total PRD FRs:** 47
- **FRs covered in epics:** 0 — epics workflow was started but not completed (requirements extracted; no stories written)
- **Coverage percentage: 0%**

> **Context:** This is a brownfield project — all 47 FRs are already **implemented** in the codebase. The 0% figure reflects incomplete BMAD documentation, not missing features. The epics.md contains the requirements inventory but the `[CE]` workflow was interrupted before stories were written. The real implementation gap is Phase 9 remaining work (6 tasks) and future roadmap items.

---

## UX Alignment Assessment

### UX Document Status

**Not found.** No `ux*.md` document exists in planning artifacts.

### Applicability

GraveStory is a heavily UI-facing consumer product (mobile-first PWA + React Native app with 8+ distinct screens on mobile alone). A formal UX specification would normally be required.

### Assessment

| Concern | Finding | Severity |
|---------|---------|---------|
| UX spec missing | No standalone UX document | ⚠️ Warning |
| UX patterns established? | Yes — fully implemented in codebase: `theme.js` (design tokens), `css/` files (one per screen/component), `src/components/` | ✅ OK |
| Design system documented? | Yes — `theme.js` is the single source of truth for colors, fonts, radius on mobile; `base.css` CSS variables on web | ✅ OK |
| Architecture supports UI performance? | Yes — service worker caches app shell and tiles; NFR-P1 (30s pipeline); Gemini 30s timeout | ✅ OK |
| Missing UX-to-PRD traceability? | User journeys UJ-1, UJ-2, UJ-3 are in PRD but no formal UX flow document | ⚠️ Warning |

### Warnings

- **No formal UX spec:** For a brownfield product with a shipped design system, this is acceptable. For future feature development (RevenueCat paywall screens, privacy policy page, web payment flow), a UX spec should precede implementation to avoid rework.
- **No accessibility audit documented:** No WCAG/a11y requirements appear in PRD or epics. GraveStory targets elderly users (visiting graves of relatives) who may have accessibility needs. This is an unaddressed gap.
- **No alignment issues found:** The implemented codebase is internally consistent with the PRD's feature set and aesthetic requirements.

---

## Epic Quality Review

### Epic Structure Validation

**Finding: No epics or stories exist.** The `epics.md` file contains a complete requirements inventory (47 FRs, 16 NFRs, additional constraints) but the `[CE]` bmad-create-epics-and-stories workflow was stopped at Step 1. No epics were designed; no stories were written.

There is nothing to validate against best practices because there is no content to validate.

### Brownfield Context Assessment

Since GraveStory is a **brownfield project with all Phase 1–8f features shipped**, the upcoming epics will be narrow in scope. Based on CLAUDE.md and the PRD open questions, the expected epic structure is:

**Expected Epic 1 — Phase 9 Completion** (6 tasks, all implementation work):
- Story: Run `005_scan_credits.sql` in Supabase
- Story: Add Origin header validation to Cloudflare Worker
- Story: Build RevenueCat webhook endpoint in Worker
- Story: Re-enable RevenueCat SDK in App.js + PaywallScreen.js
- Story: Host privacy policy at GitHub Pages + link from Settings
- Story: Create Play Store listing assets (screenshots, feature graphic, descriptions)

**Expected Epic 2 — Play Store Launch** (prerequisite: $25 Google Play account):
- Story: Generate Android keystore via `npx eas credentials`
- Story: Production AAB build + internal track submission

**Expected Epic 3 — Post-Launch Enhancements** (future roadmap):
- FamilySearch integration (requires live Play Store listing)
- Web payment flow (Stripe or RevenueCat web SDK)
- iOS App Store launch ($99/yr Apple Developer account)
- Biography accuracy feedback mechanism
- 3-person stone Tavily slot restructuring
- Accessibility audit and remediation

### Best Practices Pre-Check (for when epics ARE written)

| Check | Expected Concern | Recommendation |
|-------|-----------------|----------------|
| User value focus | Phase 9 stories are mostly DevOps/infra tasks (run SQL, deploy Worker, submit to store) — these are technical milestones, not user-value stories | Frame each as the user outcome it enables: "As a user, I can purchase scan credits" rather than "Run 005_scan_credits.sql" |
| Story independence | RevenueCat stories have a hard dependency chain (SQL migration → webhook → SDK enable) | Document the dependency explicitly in story order; don't claim independence |
| Acceptance criteria | No ACs written yet | When written, must use Given/When/Then format and include failure paths (Supabase down, RevenueCat webhook 500, etc.) |
| Greenfield vs brownfield | This is brownfield — no project setup or CI/CD stories needed | First story in Epic 1 should be the Supabase migration (already has a migration file ready to run) |

### Quality Violations Found

**🔴 Critical:**
- No epics or stories exist — the CE workflow must be completed before implementation readiness can be achieved.

**🟠 Major:**
- No acceptance criteria for any story — when epics are written, all stories need proper Given/When/Then ACs, especially for the RevenueCat payment flow (high complexity, high failure surface).
- RevenueCat dependency chain is not sequenced — the 3 RevenueCat stories (SQL, webhook, SDK) must be ordered and marked dependent, not treated as parallel work.

**🟡 Minor:**
- No accessibility requirements in PRD or epics — should be added as NFRs before post-launch epic is written.
- Privacy policy story has no GDPR/legal review acceptance criterion — should flag that legal review is a gate, not just hosting.

---

## Summary and Recommendations

### Overall Readiness Status: **NEEDS WORK** (documentation) / **SHIPPED** (product)

> This verdict requires careful interpretation. GraveStory at Phase 9 is a **functioning, tested product** with all 47 PRD features implemented and a tester APK in circulation. The BMAD artifact suite is incomplete — architecture decisions are undocumented in artifact form, and no epics or stories have been written. The readiness verdict applies to the **documentation**, not the **product**.

### Critical Issues Requiring Immediate Action

| # | Issue | Impact | Blocker? |
|---|-------|--------|---------|
| 1 | **No epics or stories written** — CE workflow stopped at requirements extraction | Cannot use BMAD dev agent workflow without stories | Yes — for BMAD-driven development |
| 2 | **architecture.md is a skeleton** — no architectural decisions documented in artifact form | Downstream BMAD workflows (dev agent) lack architectural context | Yes — for BMAD-driven development |
| 3 | **005_scan_credits.sql not run** — RevenueCat credits table doesn't exist in Supabase | RevenueCat webhook will fail with a DB error on first purchase | Yes — for monetization activation |
| 4 | **RevenueCat SDK disabled** — requires Play Store account + production API key | No monetization until unblocked | Yes — for revenue |
| 5 | **Privacy policy not hosted** — Play Store listing requires a public privacy policy URL | Blocks public Play Store submission | Yes — for launch |
| 6 | **Cloudflare Worker origin check not implemented** — third parties can use GraveStory's API quota | API cost abuse risk | High |

### Recommended Next Steps

1. **Complete `[CA]` bmad-create-architecture** — populate `architecture.md` with the 18 decisions already in `.decision-log.md`. This is mostly a transcription task from existing source material.

2. **Complete `[CE]` bmad-create-epics-and-stories** — design the Phase 9 completion epic with properly structured stories and Given/When/Then acceptance criteria. Estimated 6 stories.

3. **Run `005_scan_credits.sql`** in Supabase SQL editor immediately — this is a one-minute task that unblocks all RevenueCat work. Use plain ASCII quotes (no curly/typographic quotes per CLAUDE.md warning).

4. **Add Origin check to Cloudflare Worker** — edit `worker/worker.js` to validate the `Origin` header, then `cd worker && wrangler deploy`.

5. **Build RevenueCat webhook endpoint** — `POST /revenuecat-webhook` in the Worker; receives purchase events and INSERTs into `scan_credits` via service-role key.

6. **Register Google Play developer account ($25)** and obtain production RevenueCat API key — then re-enable SDK in `App.js` and `PaywallScreen.js`.

7. **Host privacy policy** at `https://j3k420.github.io/gravestory-privacy`; add link from Settings screen.

8. **Add accessibility NFRs to PRD** — GraveStory targets outdoor use by users of all ages; WCAG 2.1 AA should be a named target before post-launch feature development begins.

### Final Note

This assessment identified **8 issues** across **4 categories** (epic coverage, architecture documentation, UX documentation, product launch blockers). Issues 1 and 2 are BMAD process gaps with no user impact — the product ships fine without them. Issues 3–7 are **real product launch blockers** that must be resolved before the Play Store submission can proceed. Issue 8 (accessibility) is a recommendation for the post-launch roadmap.

The GraveStory product is well-architected, security-hardened (Phase 9 Session 3), and feature-complete for v1. The BMAD documentation gaps are a consequence of the retroactive documentation approach taken this session — they are easily resolved by completing the `[CA]` and `[CE]` workflows.

---

*Assessment completed: 2026-06-05 | Assessor: bmad-check-implementation-readiness*
