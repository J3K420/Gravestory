# GraveStory Code Review — Pre-Launch Findings Report

**Reviewer:** Multi-agent adversarial review (93 agents, 14 subsystems, find → refute → blast-radius → synthesize)
**Date:** 2026-06-20
**Branch:** `feat/mobile-bio-tts`
**Context:** Solo dev, Play Store Closed Testing → production rollout
**Mode:** Report only — nothing in the codebase was changed.

---

## Executive Summary

**Counts by severity (after dedup/merge):** 6 High · 7 Medium · 13 Low → **26 distinct findings** (36 raw, deduped across web/mobile parity).

No Critical findings. The High cluster directly threatens launch: two are monetization/cost-control bypasses, one is a privacy/defamation guard bypass (the S62 living-relative redaction), one is a stored-XSS hole reachable cross-user via the global map, and two are data-integrity issues around cloud writes.

### Fix these first (in order)

1. **`add_scan_credits` RPC is callable by any client** (`supabase-migrations/006`) — one-line `REVOKE` migration. Any signed-in (likely even anon) user can grant themselves unlimited scan credits via PostgREST, defeating monetization. Cheapest, highest-impact fix.
2. **RevenueCat webhook is not idempotent** (`worker/worker.js:429-481`) — retried/redelivered events double-grant credits. At-least-once delivery means this *will* happen in production. Needs a dedupe table + migration + worker change.
3. **Marker-pick on an unsaved auto-public story pushes the UN-redacted bio to the global map** (`mobile/.../ResultScreen.js:600-633`) — bypasses S62 privacy redaction. Living relatives' names leak publicly. Play/legal sensitive.
4. **`graves_make_public` UPDATE policy is over-permissive** (`supabase-migrations/001:27-30`) — any authenticated user can overwrite any grave's name/coords/marker. One-migration fix (drop the policy).
5. **Stored XSS via `story.location` and image `src` in `render-result.js`** — reachable through shared/global bios. Escaping fix touches multiple sinks in one file.

Four of the five top items are SQL/worker-side (no OTA, no native build, no `sw.js` bump) and several are one-liners.

---

## CRITICAL
*None.*

---

## HIGH

### H1. `add_scan_credits` SECURITY DEFINER RPC is callable by any client — self-serve unlimited credits
- **File:** `supabase-migrations/006_add_increment_credits_fn.sql:6-16`
- **Consequence:** `SECURITY DEFINER`, takes arbitrary `p_user_id`, no `auth.uid()` check, writes `scan_credits` with owner privileges (bypassing migration 005 no-client-write RLS). Postgres grants `EXECUTE` to `PUBLIC` by default and no migration revokes it. Any client can `supabase.rpc('add_scan_credits', { p_user_id: <self>, p_amount: 99999 })` → unlimited scans.
- **Blast radius:** New manual migration `016`: `REVOKE EXECUTE ON FUNCTION public.add_scan_credits(uuid, integer) FROM PUBLIC, anon, authenticated;` (keep `service_role`). Must be run by hand in the SQL editor. **High collateral risk if mis-scoped:** do NOT blanket-revoke the class — `global_public_stories`, `find_grave`, `find_or_create_grave`, `set_grave_marker`, `update_grave_location` share the default-grant pattern and MUST stay callable. Scope strictly to the `(uuid, integer)` signature. Sole legit caller is `worker.js:465` via service-role (unaffected). No JS/sw.js/OTA.

### H2. `graves_make_public` UPDATE policy lets any authenticated user overwrite any grave
- **File:** `supabase-migrations/001_graves_tributes.sql:27-30`
- **Consequence:** `FOR UPDATE TO authenticated USING (TRUE) WITH CHECK (is_public = TRUE)` — `USING (TRUE)` targets any row; `WITH CHECK` doesn't pin `name`/`lat`/`lng`/`marker_style`. A malicious client can PATCH `public.graves` directly and rewrite another grave's location/name/marker, bypassing the first-wins guards inside the RPCs.
- **Blast radius:** New manual migration `016` — DROP the policy entirely. Grep shows zero direct `.from('graves').update(...)`; all writes go through SECURITY DEFINER RPCs that bypass RLS. Table has no owner column so a scoped policy isn't expressible. Verify RPC definer role retains table UPDATE after the drop (it will — policies and GRANTs are independent). No JS/sw.js/OTA.

### H3. RevenueCat webhook is not idempotent — duplicate/retried events double-grant credits
- **File:** `worker/worker.js:429-481`
- **Consequence:** RevenueCat is at-least-once, retries on non-2xx, can redeliver after 200. Handler never reads `event.id`/`event.transaction_id`; `add_scan_credits` is additive. A redelivered $1.99 purchase grants 5, 10, 15+ credits; a transient Supabase 500 + retry also double-grants. Happens in normal operation, not just under attack.
- **Blast radius:** Cross-cutting, server-side only. (1) New manual migration: `revenuecat_events(event_id PK, …)` table with service-role-only RLS, plus a dedupe-gated RPC or `p_event_id` param. (2) Worker changes to consume `event.id`/`transaction_id` and return 200 on already-processed (else infinite-retry). Run migration BEFORE `wrangler deploy` or every purchase 500s. *(Related: `scan_events` INSERT has the same non-idempotent retry flaw — fix coherently.)*

### H4. Failed `persistUpdate` flags `_needsCloudSync` but `pushLocalOnly` only INSERTs — failed updates silently lost
- **File:** `js/persistence.js:153-157, 179-234` · parity `mobile/src/lib/sync.js:113-116, 148-189` — **web + mobile**
- **Consequence:** When a cloud UPDATE fails (visibility toggle, drag-to-correct, marker change) on an id-bearing story, `_needsCloudSync` is set, but `pushLocalOnly` is insert-only and skips rows whose `client_timestamp` exists in the cloud, and the id-adoption branch doesn't run for id'd rows → flag never cleared, edit never re-pushed. Silently dropped from cloud while UI shows it applied; surfaces on other devices / future pulls.
- **Blast radius:** Parity mandatory (byte-identical). Add an UPDATE branch to `pushLocalOnly` for id-bearing `_needsCloudSync` candidates: `.update(storyToRow(story)).eq('id', story.id)` then clear the flag. Three interacting spots in the same function change together. **Medium collateral risk:** no DB unique constraint on `stories.client_timestamp` — dedupe is app-level only, so a naive fix creates duplicate rows. Route id-bearing candidates to UPDATE, never INSERT. Don't advance the watermark or force a re-pull (`syncDelta` would clobber the good local copy). Web → bump `sw.js`; mobile → OTA.

### H5. Marker-pick on an unsaved auto-public story pushes the UN-redacted biography to the global map
- **File:** `mobile/src/screens/ResultScreen.js:600-633`
- **Consequence:** `handleSave` and `_doTogglePublic` run `redactLivingNamesForPublic` before any cloud write; `handlePickMarker` does not. With `default_public=true`, an unsaved story carries `is_public:true` with no `public_biography`. Picking a marker → `cloudSaveStory` writes `is_public:true` while `public_biography` stays null → global-map RPC (`coalesce(public_biography, biography)`, migration 015) serves the raw bio with living relatives' names. S62 guard bypassed.
- **Blast radius:** Mobile-only, isolated. Add the same redaction block (already at lines 458, 569) before the `cloudSaveStory`/`cloudUpdateStory` at 628-630; function already imported. **Do NOT blindly mirror to web** — `js/render-result.js` is NOT vulnerable today (web sets `is_public` only inside `saveStory()` where redaction follows). Verify the asymmetry. No migration/RLS/CREDIT_MAP/sw.js. Mobile JS → OTA.

### H6. Pre-save marker pick mints a premature/duplicate cloud `stories` row
- **File:** `mobile/src/screens/ResultScreen.js:472-474, 627-633` · web parity `js/render-result.js:574` + `js/save-actions.js` — **web + mobile**
- **Consequence (two coupled defects, one root cause):** (a) **Premature save** — picking a marker on an unsaved story runs `cloudSaveStory` (INSERT) before Save/Discard; a user who picks then Discards still has the story in the cloud. (b) **Duplicate row** — `handlePickMarker` never clears `_unsaved`, so the later `handleSave` does a second INSERT → duplicate in Remembered Stories. Global-map cell-dedup masks it; test against Remembered Stories.
- **Blast radius:** Parity required (web's `renderMarkerSection`→`bindCell`→`persistSave` has the same latent dup; `saveStory`'s guard misses the `persistSave`'d row). Make the INSERT idempotent: gate on `saved.id` → route to `cloudUpdateStory`/`persistUpdate`. **Discriminator differs:** mobile has `story._unsaved`; web has none (use `alreadySaved` threaded into `bindCell`, or `savedStories.some(timestamp)`). Don't re-open the `else cloudSave` case (marker reverting to "book" on fresh-device rebuild). Preserve `markerStyleRef`/`findOrCreateGrave` and the H5 redaction. Prefer the code fix over a DB UNIQUE index. Already-shipped dups need a one-off cleanup. Web → sw.js bump; mobile → OTA.

### H7. `story.location` injected into `innerHTML` without `escapeHtml()` (stored XSS)
- **File:** `js/render-result.js:62-74` (web-only)
- **Consequence:** `story.location` is AI/external-sourced (Nominatim/Gemini) and persisted to/from `stories`. Interpolated raw into `innerHTML` (`📍 ${story.location}`). A location with markup executes in the viewer's DOM. Reachable cross-user via shared/global bios. CLAUDE.md mandates `escapeHtml()` for locations; sibling `map-global.js` already escapes it.
- **Blast radius:** Web-only, one-liner — wrap both `story.location` interpolations at 71-73 in `escapeHtml()`. Only unescaped `story.location` sink on web. No mobile parity (RN `<Text>` auto-escapes). Must bump `sw.js` CACHE. No migration.

---

## MEDIUM

### M1. Portrait / gravestone / grave-photo gallery `src` URLs into `innerHTML` without escaping
- **File:** `js/render-result.js:28-34` **and** `:808-829` (`_loadGravePhotoGallery`) — same root cause, merged
- **Consequence:** `leftSrc`/`rightSrc`/`graveSrc` and the gallery `src` (from `grave_photos.image_url`, DB round-tripped) placed raw inside `src="..."`. A URL with `"` breaks out and injects `onerror`. Cross-user: the gallery runs for `_isGlobal` bios pulling other users' rows, and RLS permits direct INSERT into `grave_photos` with arbitrary `image_url`.
- **Blast radius:** Web-only, local-cluster. Wrap all four `src` interpolations (30/31/32, 817/823) in `escapeHtml()`. No mobile parity. Bump `sw.js`. `escapeHtml` turns `&`→`&amp;` which browsers decode in attributes — valid URLs keep loading.

### M2. Mobile `getTributes`/`setTribute` lack try/catch — a network rejection wedges the tribute UI
- **File:** `mobile/src/lib/api-tributes.js:4-44`
- **Consequence:** Web wraps the query in try/catch and returns a safe default; mobile has none around `Promise.all`. A network rejection throws; mount has no `.catch`, `handleTribute` no try/finally → `tributeLoading` stuck `true`, permanently disabling the candle/flower button. Violates the Hermes no-`.catch()` rule.
- **Blast radius:** Mobile-only, closes drift (web is reference — don't touch it). Copy web error-handling via try/catch. Match fallbacks exactly. Also wrap `handleTribute` in try/finally. Mobile JS → OTA.

### M3. Mobile biography Gemini call has no 30s timeout, unlike every other mobile Gemini call
- **File:** `mobile/src/lib/biography.js:305-318`
- **Consequence:** Uses bare `fetch` for primary + fallback while every other mobile Gemini call uses `fetchWithTimeout(30000)`. The bio call has the largest payload/longest generation — most likely to hang on flaky cellular — yet has no timeout. A stall hangs the whole scan pipeline. (Hang is before `incrementScanCount`, so no scan-billing regression.)
- **Blast radius:** Mobile-only, isolated. Duplicate the ~8-line `fetchWithTimeout` helper locally (don't export from `api-gemini.js` — circular-import risk). No web parity (web delegates to untimed shared helper by design). Throw is already caught (CameraScreen → "Analysis Failed" + queue). Mobile JS → OTA.

### M4. `queryWikidata` namesake guard fully bypassed on high-confidence stones with no death year
- **File:** `js/api-wikidata.js:138-159` · parity `mobile/src/lib/api-wikidata.js:139-159` — **web + mobile**
- **Consequence:** Orchestrator fires `queryWikidata` whenever `name_confidence === 'high'` regardless of death year. No year → `targetYear` null → the >5yr namesake-rejection block is skipped and `candidates[0]` returned blind. A famous namesake's dates/coords/Wikipedia title can graft onto an unrelated person.
- **Blast radius:** Parity mandatory. Affects three downstream consumers a fixer must re-verify: (1) the Wikipedia-title bridge (Erik Weisz → Harry Houdini) — biggest regression surface; don't blanket-null on no-year (accept `candidates[0]` only on single human result or exact label/alias match); (2) `burialCoords` GPS fallback; (3) corroboration + funnel metric. All consumers use `?.` so no crash risk. Not persisted. Web → sw.js; mobile → OTA.

### M5. Multi-subject stone with all-failed WikiTree lookups defeats the stone-only hallucination guard
- **File:** `js/biography.js:308-310` · parity `mobile/src/lib/biography.js:322-323` — **web + mobile**
- **Consequence:** Multi-subject caller passes `wikiData = wikiTreeResults.filter(Boolean)` = `[]` when all fail. `[] != null` is true → `hasRealSources` true even with Tavily/CA/IA/Wikipedia all empty → stone-only no-LLM fallback skipped, Gemini called with zero real sources. (Severity medium: prompt constraints + short stone-only budget limit realistic output to a slightly-elaborated paragraph.)
- **Blast radius:** Parity mandatory, isolated — change `(wikiData != null)` to `(Array.isArray(wikiData) ? wikiData.length > 0 : wikiData != null)` in both files. Keep single-subject path intact. Web → sw.js; mobile → OTA.

### M6. Drag-to-correct identifies the saved story by name+dates+location instead of timestamp
- **File:** `js/map-cemetery.js:87-97` (web-only)
- **Consequence:** Match predicate uses `name && dates && location` — not unique (family plots, two scans of one stone). Dragging pin B can write B's coords onto story A; `persistUpdate` pushes the wrong row. If no match, local+cloud update skipped while cache write happens → inconsistency. The bound `story` carries a unique `timestamp`.
- **Blast radius:** Web-only, one-line — match on `story.timestamp`. No parity (mobile already matches by timestamp). Cloud write already row-safe (`.eq('id', story.id)`). Bump `sw.js`.

---

## LOW

### L1. WikiTree relationship scoring token-match can false-positive on common name fragments — *worth a look, not certain*
- **File:** `js/api-wikitree.js:243-250` · parity `mobile/src/lib/api-wikitree.js:192-197` — **web + mobile**
- **Consequence:** +40 on unanchored substring match of any token >2 chars (`relText.includes(tok)`) — "Ann Lee" fires against "Leeson"/"Bagley". Medium confidence: spurious hit only re-ranks candidates already past the name+date floor and ±10yr cap; exact-year tiers (+100) usually dominate. Real but narrow.
- **Blast radius:** Parity (byte-identical). Self-contained in scoring loop. Web → sw.js; mobile → OTA.

### L2. Wikipedia title-match guard loosened from all-tokens to first+last only (drift)
- **File:** `mobile/src/lib/api-wikipedia.js:117-133` · parity `js/api-wikipedia.js:94, 184` — **web + mobile**
- **Consequence:** Web requires every significant token in the title; mobile relaxed to first+last. "John Quincy Adams" vs article "John Adams" → mobile latches the wrong person. Intentional (for "Amy Jade Winehouse") but a genuine wrong-person-guard weakening.
- **Blast radius:** Decision, not copy-paste — the two tunings have opposing failure modes. Pick a canonical guard, apply to all four call sites. Preserve the web portraits single-token early-return. Web → sw.js; mobile → OTA.

### L3. Mobile portrait filename-sanity guard uses substring containment, not exact token match (drift)
- **File:** `mobile/src/lib/api-wikipedia.js:77-82` · parity `js/api-wikipedia.js:45-47` — **web + mobile**
- **Consequence:** Web exact token membership; mobile adds bidirectional substring overlap — "lee" passes "leesburg"/"gallery", letting wrong-person infobox images through.
- **Blast radius:** Decision, not paste — mobile has a load-bearing `NNNpx-` thumbnail-prefix strip web lacks; preserve it, change only the match condition. True parity may mean making both sides handle concatenated tokens. Regression-test Houdini-via-knownTitle + Bruce Lee rejection. Web → sw.js; mobile → OTA.

### L4. Gemini calls crash on a candidate-less 200 (SAFETY block) instead of failing open/closed cleanly
- **File:** `js/api-gemini.js:104-122` (+`:191-193`) · `js/biography.js:506` · parity `mobile/src/lib/api-gemini.js:101, 176`, `mobile/src/lib/biography.js:522` — **web + mobile**
- **Consequence:** Contract only handles `data.error`; a 200 with `promptFeedback.blockReason`/`finishReason:'SAFETY'` and no candidates makes `data.candidates[0]...text` throw. `verifyIsGravestone` then carries no `__verificationRejection` → generic error box instead of fail-open → legitimate scan blocked.
- **Blast radius:** Parity mandatory (three call sites each). Copy the guard from `resolveSymbolMeanings`/`redactLivingNamesForPublic` (`!data.candidates?.[0]?.content?.parts?.[0]?.text`). **Fail direction:** `verifyIsGravestone` fails OPEN (proceed); `readGravestone` + biography fail CLOSED (throw clean Error, not default) — else the pipeline burns a lifetime scan on garbage. Web → sw.js; mobile → OTA.

### L5. Scan-limit check and increment are non-atomic (TOCTOU) — concurrent scans bypass the lifetime cap
- **File:** `index.html:1009-1068` · `js/scan-limit.js` · parity `mobile/src/lib/scan-limit.js`, `CameraScreen.js:188/312/690` — **web + mobile**, two findings merged
- **Consequence:** `checkWebScanLimit()` reads, `incrementWebScanCount()` writes, separated by seconds of awaits; Analyze button not re-disabled. Two near-simultaneous runs both observe the same below-limit count → a user at limit-1 runs 2 scans. Bounded by concurrency, deliberate misuse, hence Low.
- **Blast radius:** Cross-cutting; only correct fix is server-side atomic count-and-insert RPC (model on `add_scan_credits`), new manual migration run FIRST or RPC 404s and blocks all signed-in scans. Parity across both `scan-limit.js`. Keep `checkScanLimit` a pure read for the Settings graph/Paywall/offline gate; atomic consume only at post-OCR increment. `scan_events` has no DELETE policy → reserve-then-refund blocked; prefer atomic-consume-after-OCR-success. Preserve return shape. Scope to signed-in (guest is localStorage, bypassable anyway). Reconcile with the deferred `scan_events` double-INSERT over-count. Web → sw.js; mobile → OTA.

### L6. Corrupted guest scan counter (NaN) disables the guest cap entirely
- **File:** `js/scan-limit.js:16-19` (+`:53`) · parity `mobile/src/lib/scan-limit.js:17, 62` — **web + mobile**
- **Consequence:** `parseInt(non-numeric)` → `NaN`; `NaN >= 3` is false → unlimited guest scans. `|| '0'` only handles missing/empty. `increment` compounds: `NaN + 1 = NaN`, stored `"NaN"` forever.
- **Blast radius:** Parity; harden all 4 sites (read AND increment in each file). `Number.isFinite` guard. Web → sw.js; mobile → OTA. No migration (guest counting is local).

### L7. `SIGNED_IN` handler dereferences `currentUser.email` after it may be null — *worth a look, not certain*
- **File:** `js/auth.js:74-77` (web-only)
- **Consequence:** Line 74 allows `currentUser = null`; line 77 unconditionally reads `currentUser.email`. A `SIGNED_IN` with null/partial session throws inside the async callback, aborting `loadUserPrefs`/`syncOnSignIn`/`showScreen('home')` — user looks signed in but stories never sync. Low confidence (no concrete null-session evidence).
- **Blast radius:** Web-only — mobile (`HomeScreen.js:75`) already guards. Gate the whole `SIGNED_IN` branch on a non-null user. Bump `sw.js`.

### L8. EXIF GPS at exactly 0° lat or lng silently discarded (truthiness rejects 0)
- **File:** `js/exif.js:16-19` (web-only)
- **Consequence:** `if (latDec && lngDec)` treats a legitimate `0` (equator/prime meridian, or computed-0 axis) as falsy → discards a valid fix → GPS-less path. Rare for a US app but real silent data-loss.
- **Blast radius:** Web-only numeric check, but mirror mobile (`media-gps.js:59-60` accepts a single 0-axis while rejecting the `(0,0)` null-island sentinel) so you don't accept `(0,0)`. Bump `sw.js`.

### L9. `flyToGrave` matches markers by coordinate proximity, but `spreadOverlappingPins` moved them — list clicks open the wrong popup
- **File:** `js/map-cemetery.js:744-754` (web-only)
- **Consequence:** List `onclick` uses the unspread centroid; markers are at spread coords (~6.7m offset > 0.0001°≈11m tolerance once n≥2). Clicking a coincident grave opens a different grave's popup.
- **Blast radius:** Web-only — match by `story.timestamp` (pattern exists at 224-240). Keep a raw-coord fly path for `renderNearbyCemeteryList:923` (OSM results, no timestamp). Keep top-level `function` (inline onclick). Bump `sw.js`. No parity.

### L10. Delta/first-sync overwrite local stories with cloud copies, discarding unsynced local edits
- **File:** `js/sync.js:43-52, 95-103` · parity `mobile/src/lib/sync.js` — **web + mobile**
- **Consequence:** A row with a pending local edit (`_needsCloudSync`) later returned by a delta is replaced wholesale with `rowToStory(row)` (no flag) → edit overwritten by stale cloud data, no retry. Last-writer-wins. Confidence medium: first-sync scenario (95-103) is a false positive; delta scenario (43-46) is valid but only a multi-device race.
- **Blast radius:** Parity (the two first-sync branches already differ). Guard: don't overwrite a `_needsCloudSync` local row; use `_updatedAt` for precedence. Interacts with H4 (`pushLocalOnly` insert-only). Preserve mobile `_pending` offline rows. Web → sw.js; mobile → OTA.

### L11. Grave-coords localStorage cache evicts only lazily on exact-key read — abandoned keys accumulate
- **File:** `js/grave-cache.js:16-30, 32-45` · parity `mobile/src/lib/grave-cache.js` — **web + mobile**
- **Consequence:** TTL only fires on same-key re-read; no sweep. Orphaned `grave_v2:` keys persist, growing toward the ~5MB localStorage quota shared with `gravestories`; quota-exceeded then silently fails `persistLocal()`. Very low likelihood.
- **Blast radius:** Parity, distinct mechanism per platform (web sync loop vs mobile `getAllKeys`→`multiRemove`). **Sweep MUST be strictly prefix-scoped to `grave_v2:`** — same store holds `gravestories`/`gs_last_sync_*`/`gs_stories_*`; loose filter = data-loss. Special-case `score===999` corrected entries. Web → sw.js; mobile → OTA.

### L12. Service worker caches every non-tile GET unconditionally (cross-origin/API, no size cap, no `r.ok` guard)
- **File:** `sw.js:39-48` (web-only)
- **Consequence:** No origin filter — Supabase REST, Wikidata, Nominatim, Overpass, Wikipedia, Archive, CA all cached, and stale copies served on failure. Caching Supabase GETs is the real hazard (stale story/grave/tribute data vs delta-sync watermark + soft-delete). Cache only grows.
- **Blast radius:** Web-only, isolated to the fetch handler. Add `r.ok` guard + scope caching to same-origin app-shell, after the tile early-return. Worker proxy not at risk (POST-gated). Bumping CACHE auto-evicts the polluted store. No parity.

### L13. Internet Archive OCR size guard bypassed when archive.org omits Content-Length — buffers whole file
- **File:** `mobile/src/lib/api-internetarchive.js:79-85` (mobile-only)
- **Consequence:** Guard only fires when Content-Length present and >4MB. `_djvu.txt` often chunked/gzip with no length → guard skipped → `res.text()` buffers a multi-MB OCR string on a phone. Web counterpart streams via `getReader()`.
- **Blast radius:** Mobile-only. Do NOT port the web `getReader()` loop (RN/Hermes `fetch` has no streamable body). Use HEAD/Range pre-check or post-read `text.length` truncation. Preserve the additive contract. Mobile JS → OTA.

### L14. `save-limit.js` filters on `deleted_at` (non-existent field) instead of `_deletedAt`
- **File:** `mobile/src/lib/save-limit.js:13-15` (mobile-only)
- **Consequence:** In-memory stories use `_deletedAt`; `!s.deleted_at` is always true → excludes nothing → Settings "saves used" can over-count soft-deleted rows. Display-only.
- **Blast radius:** Mobile-only, one-char fix (`s.deleted_at` → `s._deletedAt`). Web already correct. Mobile JS → OTA.

### L15. Paywall (from Settings) shows wrong denominator/progress bar for users with purchased credits
- **File:** `mobile/src/screens/PaywallScreen.js:27-30, 98, 113-115`
- **Consequence:** Settings passes lifetime `usedCount` (can exceed 10 with credits); Paywall hardcodes `limit = SCAN_LIMIT_USER` (10), ignores `purchased` and the passed `limit`. A paying user sees "23 of 10 free scans used" with a full bar. Cosmetic.
- **Blast radius:** Mobile-only. Honor `route.params.limit`; pass `limit: scanLimit` from `SettingsScreen.js:215-219`. Fix "free scans" copy. Guard `Infinity` (unlimited tester). Mobile JS → OTA.

### L16. `handlePickMarker` leaves `_unsaved`/`_base64` transient fields on the in-memory story after cloud save
- **File:** `mobile/src/screens/ResultScreen.js:600-631` (mobile-only)
- **Consequence:** Unlike `handleSave`, `handlePickMarker` spreads the whole story → retains `_base64` (full JPEG base64, bloats AsyncStorage writes) and `_unsaved:true` (UI keeps showing "Save Story"). `_base64` does NOT reach the cloud (`storyToRow` whitelists). Tightly coupled to H6.
- **Blast radius:** Mobile-only. Do NOT strip `_unsaved` here (would flip to saved, bypassing Save/Discard + R2 + `grave_photos` + telemetry). Do NOT strip `_base64` before `handleSave` consumes it for R2. Best fix: don't mint a cloud row in the pick path for unsaved stories — let `handleSave` own the single insert (resolves H6 + this). Mobile JS → OTA.

### L17. Unreachable dead branch in `PaywallScreen` (`isScan` is constant `true`)
- **File:** `mobile/src/screens/PaywallScreen.js:29, 130, 192-196`
- **Consequence:** `isScan = true` hardcoded → the trailing else ("Delete old stories…" save-limit leftover) never renders. Harmless.
- **Blast radius:** Mobile-only. Delete `const isScan = true;`, collapse to `isGuest ? (...) : (...)`. Leave callers' unused params alone. Mobile JS → OTA.

### L18. Dead write-only global: `userLocation` assigned but never read
- **File:** `index.html:540, 1058` (web-only)
- **Consequence:** Two hits repo-wide — declaration and one assignment, zero reads. Leftover dead state; misleading.
- **Blast radius:** Web-only, delete both lines together (deleting only the declaration makes the assignment an implicit global). Re-grep before deleting. Bump `sw.js` (the one mandatory ripple even for dead-code removal). No parity.

### L19. Account-deletion image collection has no pagination — high-volume users orphan R2 blobs — *worth a look, not certain*
- **File:** `worker/worker.js:555-562`
- **Consequence:** Two SELECTs collecting R2 keys are unpaginated; PostgREST's ~1000-row cap leaves overflow images undeleted after account deletion. For a Play data-removal path, a real residual-data gap. Confidence medium (depends on hosted PGRST max-rows).
- **Blast radius:** Worker-only. Paginate only the two collection SELECTs (do NOT add a global Range to `sb()` — reused for row DELETEs which must delete all). Keep image-collection failures non-fatal. `wrangler deploy`.

### L20. Webhook returns 500 on FK-violation for unattributable `app_user_id` → RevenueCat retries over an extended window
- **File:** `worker/worker.js:465-478`
- **Consequence:** `scan_credits.user_id` is FK→`auth.users(id)`. A RevenueCat anonymous UUID (purchased before signing in) or deleted user → FK violation → 500 → RC retries an unrecoverable event.
- **Blast radius:** Worker-only. **The trap:** the 500 path is hit by both FK violation (unrecoverable) and transient Supabase outages (recoverable). Branch on the Postgres error code — treat `23503`/FK as acknowledged-2xx (log it), keep other RPC errors 5xx so real paid credits still retry. Root cause is `App.js` `Purchases.logIn` only firing with a session. Coordinate with H3 (same handler). `wrangler deploy`.

---

## Verified Clean / No Findings

Reviewed and came back with no surviving findings (genuinely checked, not skipped):

- **web-search-pipeline** — beyond M4/L1/L2; Tavily slot orchestration, Chronicling America, Internet Archive web paths clean.
- **mobile-lib-pipeline** — beyond M3/L13; core Tavily/WikiTree/Wikidata/Gemini ports clean.
- **mobile-lib-data** — beyond L14/L11; storage isolation, device-id, abbreviations clean.
- **mobile-components** — `GraveMarkers.js`, `Icons.js`, `GravestoneLogo.js` clean.
- **web-render-xss** — NOT fully clean (H7 + M1). Other render/map injection sites (`map-global.js`, `map-cemetery.js`, `home-screen.js`) verified already escaping correctly.
- **web-biography** — beyond M5; `_validateCitations`, historical-figure per-person date guard, corroboration, single-subject stone-only fallback clean.

Subsystems with findings (explicitly not clean): web-pipeline-orchestration, web-persistence-sync, web-limits-auth-reports, web-maps-markers, mobile-screens-pipeline, mobile-screens-ui, worker-backend, supabase-rls.

---

## Cross-cutting deployment reminders

- **`sw.js` CACHE bump** required for every web JS change (H4, H6-web, H7, M1, M4-web, M5-web, M6, L1-web, L2-web, L3-web, L4-web, L5-web, L6-web, L7, L8, L9, L10-web, L11-web, L12, L18). One bump covers a batch shipped together.
- **Mobile JS changes ship OTA** to `production` (`npx eas update --branch production --environment production`) — no finding touches a native module, so no new EAS build. Verify with `eas channel:list`.
- **Manual Supabase migrations** (run by hand, next number `016`): H1 (REVOKE), H2 (DROP policy), H3 (dedupe table + RLS + RPC), L5 (atomic-consume RPC). H3/L5 callers 404 if not run first.
- **Worker deploys** (`cd worker && wrangler deploy`): H3, L19, L20. For H3, run the migration before deploy.
- **Order the High batch:** H1 + H2 (migrations, instant wins) → H3 + L20 (same handler) → H5 (privacy) → H6 + L16 (same code path) → H7 + M1 (same file) → H4 + L10 (same sync subsystem).
