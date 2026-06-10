# GraveStory — Search Pipeline Improvement Recommendations

**Scope:** Free-only additions and changes to the mobile/web search pipeline.  
**Date:** June 2026

---

## Current Pipeline Summary

| Step | API | Cost | Purpose |
|---|---|---|---|
| Tavily | Paid web search | ~1,000 free/mo | FindAGrave, BillionGraves, Legacy.com, Chronicling America, Newspapers.com (6 queries per scan) |
| WikiTree | Free (via proxy) | Free | Collaborative family tree – name/date/location matching |
| Wikipedia | Free (direct) | Free | Article summary for grounding + portrait images |
| Nominatim + Photon | Free (direct) | Free | Cemetery geocoding + grave-node coordinate search |

---

## Recommendation 1: Add Wikidata SPARQL — grave coordinates + structured date verification

**Priority: High. Zero cost. No key required. No proxy needed.**

Wikidata is Wikipedia's structured sibling. Its SPARQL endpoint (`https://query.wikidata.org/sparql`) returns JSON for any query and is CORS-open — callable directly from the app without a proxy.

**What it provides for GraveStory:**

- `P119` — place of burial (cemetery name + Wikidata entity, often with coordinates via `P625`)
- `P569` / `P570` — birth and death dates as structured ISO values
- `P19` / `P20` — place of birth / death
- Links back to Wikipedia article title (for confirming the namesake guard)

**Where to integrate:** Run in parallel alongside the existing WikiTree + Tavily parallel step, right after OCR.

**Example query for `api-wikidata.js`:**
```js
// Search by exact label (person name) and optional death year filter.
// Returns: burial place label, burial place coords, birth/death dates.
async function queryWikidata(name, deathYear) {
  const yearFilter = deathYear
    ? `FILTER(YEAR(?deathDate) >= ${deathYear - 2} && YEAR(?deathDate) <= ${deathYear + 2})`
    : '';

  const sparql = `
    SELECT ?person ?personLabel ?birthDate ?deathDate
           ?burialPlace ?burialPlaceLabel ?coord
    WHERE {
      ?person wdt:P31 wd:Q5;
              rdfs:label "${name}"@en.
      OPTIONAL { ?person wdt:P569 ?birthDate. }
      OPTIONAL { ?person wdt:P570 ?deathDate. }
      OPTIONAL {
        ?person wdt:P119 ?burialPlace.
        OPTIONAL { ?burialPlace wdt:P625 ?coord. }
      }
      ${yearFilter}
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    }
    LIMIT 5
  `;

  const url = `https://query.wikidata.org/sparql?query=${encodeURIComponent(sparql)}&format=json`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'GraveStory/1.0 (gravestory app)' }
  });
  if (!res.ok) return null;
  const data = await res.json();
  return data?.results?.bindings || [];
}
```

**How to use the result:**

1. **Grave coordinates:** If a Wikidata binding returns `?coord` (format: `Point(lon lat)`), parse it and use it directly as the grave pin — this is far more precise than geocoding a cemetery name. Set `_wikidataVerified: true` on the pin so the UI can show a gold (not silver) confidence indicator.

2. **Namesake guard (biography.js):** Currently requires a Wikipedia article in numbered sources AND ±5yr date match. Add a third signal: if Wikidata `?burialPlaceLabel` matches the Nominatim-resolved cemetery name, that's strong confirmation the stone refers to the famous figure. You can pass a `wikidataMatch` flag into `generateBiography`.

3. **Cross-source corroboration (`buildCorroborationSummary`):** Add Wikidata birth/death to the date-conflict check alongside WikiTree — if all three (stone, WikiTree, Wikidata) agree on a death year, that's a strong signal; if Wikidata disagrees, flag it.

**Limitations:**
- Only famous/notable people have Wikidata entries. For an ordinary 1880s farmer, this will return zero results — that's fine, just fall through to existing sources.
- Rate limit: `query.wikidata.org` asks for no more than one request per second. With one scan per user action, this is not an issue.
- Name matching requires an exact rdfs:label match. For weathered or OCR-uncertain names, only attempt this when `name_confidence === 'high'`. When confidence is lower, the SPARQL match would return nothing (or wrong person), so skip it.
- The SPARQL endpoint can be slow (1–3s). Run it in the parallel step alongside Tavily, not sequentially.

---

## Recommendation 2: Add FamilySearch Person Search API — large collaborative tree, different coverage than WikiTree

**Priority: Medium-High. Free. Requires a registered app key (one-time setup).**

FamilySearch (operated by the Church of Jesus Christ of Latter-day Saints) has 8+ billion records and a free REST API. The **Person Matches by Example** endpoint requires only an `unauthenticated_session` access token — no user login, no OAuth dance. It searches the FamilySearch Family Tree and public user tree collections.

**Registration:** Create a free developer account at `https://www.familysearch.org/developers/` and register an app to get a `client_id`. The access token endpoint returns a 24-hour token.

**Key endpoint:**
```
POST https://api.familysearch.org/platform/tree/matches
Content-Type: application/x-fs-v1+json
Accept: application/x-fs-v1+json
Authorization: Bearer {token}
```

Request body (GEDCOM X format):
```json
{
  "persons": [{
    "names": [{ "nameForms": [{ "fullText": "Harry Houdini" }] }],
    "facts": [
      { "type": "http://gedcomx.org/Death", "date": { "original": "1926" } }
    ]
  }]
}
```

**How to integrate:**

- Add `api-familysearch.js` (mobile: `mobile/src/lib/`; web: `js/`).
- Token management: fetch once per app session, cache in module-level variable (valid 24 hrs), refresh on 401.
- Run in parallel with WikiTree in `CameraScreen.js` (parallel step).
- Map the response to the same shape as `searchWikiTree`: `{ name, birth, death, birthLocation, deathLocation, fsPersonId, bioSnippet }`.
- Apply the same geographic scoring logic already in `api-wikitree.js`.
- In `buildCorroborationSummary`, treat FamilySearch as a third independent source alongside WikiTree.

**Why it complements WikiTree:**
- WikiTree has stronger UK/Europe coverage for 19th–20th century educated families.
- FamilySearch has better coverage of 18th–19th century US, religious communities, and Scandinavian/German immigrant families.
- They draw from different contributor pools, so a match in both is a very strong corroboration signal.
- When both WikiTree and FamilySearch return aligned results, it is reasonable to skip lower-priority Tavily slots (4 and 6), saving 1–2 credits per scan on those queries (see credit projection below).

**Limitations:**
- The `unauthenticated_session` grant can only search the Family Tree and public user collections — NOT the 8-billion-record Historical Records Archive. For the archive (census, vital records, etc.), a user must authenticate with their own FamilySearch account, which is impractical for a scanning app.
- Token refresh adds a small latency on first use per session. Cache it.
- Rate throttling: per the docs, FamilySearch allows ~18 seconds of execution time per minute. One query per scan won't approach this.
- Requires storing `client_id` in the Cloudflare Worker (like other API secrets) — do NOT put it in client JS.

---

## Recommendation 3: Replace Tavily's Chronicling America slot with direct loc.gov API calls

**Priority: Medium. Frees up a Tavily query slot. Zero cost. No key required.**

Currently Tavily slot 5 (for pre-1922 deaths) queries `site:chroniclingamerica.loc.gov`. Since 2025, Chronicling America is accessed exclusively through the loc.gov JSON API, which is free, key-free, and directly queryable.

**Direct API endpoint:**
```
GET https://www.loc.gov/collections/chronicling-america/?q={name}+{year}&fo=json
```

Returns structured JSON with newspaper article snippets, titles, dates, and URLs — better than a Tavily snippet and costs zero query credits.

**Implementation in `api-tavily.js`:**

Replace the Chronicling America Tavily slot with a separate `searchChroniclingAmerica(name, year, location)` function in a new `api-chroniclingamerica.js` module:

```js
export async function searchChroniclingAmerica(name, deathYear) {
  if (!name || !deathYear || parseInt(deathYear) > 1924) return [];
  const q = encodeURIComponent(`"${name}" ${deathYear}`);
  const url = `https://www.loc.gov/collections/chronicling-america/?q=${q}&fo=json&c=5`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'GraveStory/1.0' }
  });
  if (!res.ok) return [];
  const data = await res.json();
  return (data.results || []).slice(0, 3).map(r => ({
    title: r.title || 'Chronicling America',
    url: r.url || r.id,
    content: (r.description || []).join(' ').slice(0, 800),
    source_type: 'public_domain',
  }));
}
```

Call this in parallel alongside Tavily. The freed Tavily slot 5 can then become a general historical obituary search (`"${name}" obituary ${year} death`) or a second alternate-name FindAGrave query.

**Limitations:**
- Coverage ends at 1924 (the program's newspaper cutoff). For deaths 1925+, stick with Tavily targeting Legacy.com/Newspapers.com.
- Full-text newspaper search is noisy — the function should cap results at 3 and let the biography model assess quality.
- The API has no documented rate limit but apply the same courtesy delay as Nominatim (1 req/s is safe).

---

## Recommendation 4: Add a Wikidata-based cemetery coordinate lookup for notable graves

**Priority: Medium. Zero cost. Complements the existing Nominatim/Photon grave-node search.**

For famous people, Wikidata frequently has precise GPS coordinates for the grave node itself (P119 entity → P625 coordinates). This is more reliable than Overpass/Photon which relies on OSM contributors having tagged the node.

**Integrate into `api-nominatim.js` (or a separate step in CameraScreen):**

After biography resolves and you have a confirmed notable figure (determined by the `wikidataMatch` flag from Rec. 1), query the Wikidata entity for `P625` on the burial place:

```js
// If Wikidata returned a burial place entity ID (e.g. "Q311" for Père-Lachaise)
// fetch its coordinates directly:
async function fetchBurialCoords(wikidataEntityId) {
  const sparql = `SELECT ?coord WHERE {
    wd:${wikidataEntityId} wdt:P625 ?coord.
  }`;
  const url = `https://query.wikidata.org/sparql?query=${encodeURIComponent(sparql)}&format=json`;
  const res = await fetch(url, { headers: { 'User-Agent': 'GraveStory/1.0' } });
  if (!res.ok) return null;
  const data = await res.json();
  const coord = data?.results?.bindings?.[0]?.coord?.value;
  if (!coord) return null;
  // Wikidata coords format: "Point(lon lat)"
  const match = coord.match(/Point\(([-\d.]+)\s+([-\d.]+)\)/);
  return match ? { lng: parseFloat(match[1]), lat: parseFloat(match[2]) } : null;
}
```

For ordinary (non-famous) people, this returns nothing and the existing Nominatim/Photon pipeline handles it.

---

## Recommendation 5: Improve WikiTree's multi-person stone handling

**Priority: Low-Medium. No new API needed — code change only.**

Currently when `multiple_subjects === true`, `searchWikiTree` is called only with `graveData.primary_name` (the first person). For a two-person stone (e.g., husband and wife), the spouse gets no WikiTree lookup.

**Fix:** In `CameraScreen.js`, map `graveData.names.slice(0, 2)` to two parallel `searchWikiTree` calls, then pass both results to `generateBiography`. This mirrors how Wikipedia article summaries are already fetched for multiple subjects.

```js
// In the parallel step:
const wikiTreeResults = await Promise.all(
  (graveData.names?.slice(0, 2) || [graveData.primary_name]).map(name =>
    searchWikiTree({ ...graveData, primary_name: name }, locationHint)
  )
);
// Pass wikiTreeResults[0] as wikiData to generateBiography
// Inject wikiTreeResults[1] into searchContext if present
```

The biography prompt already supports multiple subjects — this just ensures the second person has a WikiTree check.

---

## Recommendation 6: Extend the grave cache to cover full biography results

**Priority: Medium. No new API. Zero quality tradeoff. Meaningful cost reduction at scale.**

The existing `grave-cache.js` / `api-nominatim.js` module caches geocoded grave coordinates keyed by `name + cemetery + dates`. The same caching pattern should be extended to cover **complete biography pipeline results** — the full output of `searchForPerson` + `searchWikiTree` + `generateBiography` for a given stone.

Popular cemeteries (Arlington, Gettysburg, major city cemeteries) are scanned by many users over time. Every repeat scan of Harry Houdini's grave currently fires 6 fresh Tavily queries. A biography result cache would serve subsequent scans instantly with zero API cost.

**Key design decisions:**

- **Cache key:** `name (normalised) + deathYear + cemeteryName`. Do not include birth year — it's often missing from stones and would prevent cache hits. Example: `"harry houdini|1926|machpelah cemetery"`.
- **Cache store:** Supabase `stories` table already holds the full biography. The simplest implementation is a server-side lookup by `grave_id` — if a canonical grave already has a saved public story, return it directly instead of re-running the pipeline. No new table needed.
- **Staleness:** Biography content rarely changes once the stone is correctly read. A 90-day TTL is appropriate for the research/biography fields; coordinate data can be cached indefinitely.
- **Cache scope:** Server-side via Supabase is better than device-local (AsyncStorage/localStorage) because it benefits all users, not just repeat users on the same device. The `grave_id` FK already provides the deduplication key.
- **What gets cached:** `searchResults` (Tavily output), `wikiData` (WikiTree output), and the final `biography` object. The raw base64 image and OCR pass (`readGravestone`) are intentionally excluded — the OCR is cheap and the image changes per photograph.

**Implementation sketch (server path):**

```js
// In CameraScreen.js / startAnalysis(), after forwardGeocode resolves:
// 1. findOrCreateGrave() already returns a grave_id.
// 2. Before firing Tavily + WikiTree, check if a cached result exists:
const cached = await fetchCachedBiography(grave_id); // new function in persistence.js
if (cached) {
  // Skip Tavily + WikiTree + Gemini entirely — use cached result
  return cached;
}
// Otherwise run full pipeline, then store result keyed to grave_id after save.
```

**Limitations:**
- Cache hits require a `grave_id`, which requires GPS coordinates and a signed-in user (the `findOrCreateGrave` RPC only runs for signed-in users). Guest users always run the full pipeline.
- The first scan of any given grave pays the full cost; only subsequent scans benefit.
- For stones where OCR confidence is low or the name varies between scans, the cache key may not match. The normalisation step (lowercase, strip punctuation, trim) needs to be consistent between write and read.

---

## Can Tavily Be Removed Entirely?

**Short answer: No.**

The table below assesses each of the 6 Tavily query slots individually. The verdict holds even before considering content quality — the broader landscape for free general web search APIs has collapsed in 2025–2026: Bing Web Search API was retired in August 2025, Google Custom Search API is closed to new customers and shutting down January 2027, and Brave Search API removed its free tier in early 2026. SerpAPI's free tier (100 queries/month) is the only remaining option, and at 6 slots per scan it supports roughly 16 full scans per month — inadequate for any real-world usage.

Beyond the API availability problem, there is a content depth problem. Tavily is not a search router — it is a content extractor. Its `content` field for a FindAGrave memorial contains 500–800 words of extracted page text: the full name, dates, cemetery, all listed relatives, and sometimes tribute text. A standard search snippet from any SERP API returns roughly 160 characters: `"John Smith (1845–1912) — Find A Grave Memorial. View burial details…"`. That is nearly useless for biography generation. Replacing Tavily with a SERP API would degrade the quality of every non-famous biography, not just the coverage.

### Slot-by-slot assessment

| Slot | Query target | Free replacement | What is lost if removed |
|---|---|---|---|
| **1** | `site:findagrave.com` (primary name) | ❌ None | Family relationships (spouse, parents, children), cemetery name confirmation. For ordinary people this is often the only structured biographical source. Highest-value slot. |
| **2** | `site:billiongraves.com` | ❌ None | Verified transcription corroboration. BillionGraves is narrower coverage than FindAGrave but provides the `verified_transcription` source tag and date cross-check. |
| **3** | `"${name}" obituary ${year} ${location}` (general) | ⚠️ Partial | FamilySearch (Rec. 2) covers pre-1990 GenealogyBank obituaries. loc.gov covers pre-1924 newspapers. Modern obituaries (Legacy.com, funeral home sites, 1990–present) have no free replacement. |
| **4** | Symbol-guided query OR alternate-name FindAGrave | ❌ None | Fraternal/military record precision (GAR pension rolls, Masonic lodge records, regimental rosters). No free API covers these. NARA's API covers finding aids only, not searchable person records. |
| **5 (pre-1922)** | `site:chroniclingamerica.loc.gov` | ✅ loc.gov API — better quality, zero cost | Nothing. This slot should already be replaced (see Rec. 3). |
| **5 (post-1922)** | `site:legacy.com` | ❌ None | Modern US obituaries. Legacy.com has no public API. |
| **6** | `site:newspapers.com` OR Legacy.com fallback | ❌ None | Broad surname + location newspaper fallback. Newspapers.com has no public API. |

**The one genuinely replaceable slot** is Slot 5 pre-1922 (Chronicling America), which the loc.gov API handles better and for free. Every other slot that hits a specific database (FindAGrave, BillionGraves, Legacy.com, Newspapers.com) has no public API and no viable free web-search substitute at meaningful volume.

The realistic goal is not Tavily removal but **reducing Tavily consumption per scan**, which is addressed in the next section.

---

## Realistic Tavily Credit Consumption Projection

With all optimisations from this document applied, average per-scan Tavily consumption drops from ~6 credits to ~4, roughly tripling the effective free-tier capacity.

| Optimisation | Credit saving per scan | Condition |
|---|---|---|
| Replace Slot 5 pre-1922 with loc.gov API (Rec. 3) | −1 credit | Death year ≤ 1924 |
| Early-exit: skip Slots 4 + 6 when WikiTree + FamilySearch both return aligned matches (Recs. 2, 5) | −2 credits | Both tree sources return a strong date+location match |
| Biography result cache: skip entire Tavily pipeline on cache hit (Rec. 6) | −6 credits | Repeat scan of a known grave by any signed-in user |

**Net effect without cache hits:** Average ~4 Tavily queries per scan (down from 6), giving ~250 effective scans/month on the 1,000-credit free tier (up from ~167).

**Net effect with cache hits:** Popular graves (scanned repeatedly across the user base) cost zero Tavily credits after the first scan. The free tier effectively scales with the size of the `graves` table rather than with scan volume.

The 1,000 free credits/month Tavily tier is likely sufficient for early-stage usage with these optimisations applied. If the app reaches a volume where Tavily costs become meaningful, the cache (Rec. 6) is the highest-leverage cost control because it benefits from network effects — every new scan of a known grave reinforces the cache for all future users.

---

## What NOT to add (free tier either doesn't exist or is too limited)

| Service | Reason to Skip |
|---|---|
| **Exa.ai** | Only $10 free credits, then paid. Not sustainable. |
| **Brave Search API** | Free tier removed early 2026, now metered billing only. |
| **Bing Web Search API** | Retired August 2025. Fully dead. |
| **Google Custom Search API** | Closed to new customers. Shutting down January 1, 2027. |
| **SerpAPI** | 100 free searches/month. Supports ~16 full scans/month — inadequate. |
| **GenealogyBank** | No public API. Paid subscription only. |
| **Findmypast** | No public API. Paid subscription only. |
| **FindAGrave API** | No public API (Ancestry property). Tavily is the right approach. |
| **BillionGraves API** | No public API. Tavily is the right approach. |
| **Newspapers.com API** | No public API (Ancestry property). Paid subscription only. |
| **Ancestry API** | No public API. Paid subscription only. |
| **FamilySearch Historical Records Archive** | Requires user-level OAuth (user must have a FamilySearch account). Not suitable for a scan-and-go app. The Family Tree endpoint (Rec. 2) is the right scope. |

---

## Implementation Order (by value/effort ratio)

1. **Replace Chronicling America with loc.gov API (Rec. 3)** — lowest effort, immediate credit saving, better result quality. Should be done first regardless of other changes.

2. **Wikidata SPARQL (Rec. 1)** — highest quality gain, zero cost, no registration. Add `api-wikidata.js`, call in the parallel step, pipe results to `buildCorroborationSummary` and the namesake guard.

3. **Biography result cache (Rec. 6)** — zero quality tradeoff, meaningful long-term cost control. Leverage the existing `grave_id` FK and `stories` table; no new infrastructure needed.

4. **FamilySearch Person Search (Rec. 2)** — meaningful genealogy coverage gain, moderate effort. Requires app registration + token management + Cloudflare Worker secret. Enables the early-exit optimisation once both tree sources agree.

5. **Multi-person WikiTree (Rec. 5)** — small code change in `CameraScreen.js`, marginal improvement for two-subject stones.

6. **Wikidata grave coordinates (Rec. 4)** — good precision improvement for famous graves; trivial effort once Wikidata is integrated from step 2.

---

## Summary Table

| Change | New API? | Cost | Implementation Effort | Benefit |
|---|---|---|---|---|
| Direct Chronicling America API (Rec. 3) | Yes — `loc.gov` | Free, no key | Low | Frees 1 Tavily slot for pre-1924 scans; better snippet quality |
| Wikidata SPARQL dates + burial (Rec. 1) | Yes — `query.wikidata.org` | Free, no key | Low | Exact coordinates + structured date verification for notable figures |
| Biography result cache (Rec. 6) | No — Supabase | Free | Medium | Zero credits on repeat scans; scales with `graves` table size |
| FamilySearch Person Search (Rec. 2) | Yes — `api.familysearch.org` | Free, key required | Medium | 18th–20th c. US/immigrant family trees; enables early-exit credit saving |
| Multi-person WikiTree (Rec. 5) | No | — | Very Low | WikiTree lookup for second person on two-subject stones |
| Wikidata grave coordinates (Rec. 4) | Part of Wikidata | Free | Very Low | Precise pin placement for notable figures |
| **Full Tavily removal** | — | — | — | **Not feasible.** FindAGrave, BillionGraves, Legacy.com, Newspapers.com, and symbol-guided queries have no free replacements. General web search APIs have all been retired or gone paid-only as of 2025–2026. |
