// js/api-tavily.js
// Tavily web search for biographical sources.
// POSTs to ${PROXY_BASE}/tavily via the Cloudflare proxy.
// Builds burial-first targeted queries (FindAGrave, BillionGraves,
// Chronicling America, Legacy.com, Newspapers.com, Atlas Obscura),
// runs the top 6, dedupes by URL, and tags each result with a source_type.
// Depends on: PROXY_BASE (from js/config.js).

// ── TAVILY: WEB SEARCH ───────────────────────────────────────────
async function searchForPerson(graveData, location) {
  // Collect ALL names from the stone
  const allNames = [];
  if (graveData.names && graveData.names.length > 0) {
    graveData.names.forEach(n => { if (n && n !== 'Unknown') allNames.push(n); });
  } else if (graveData.primary_name && graveData.primary_name !== 'Unknown') {
    allNames.push(graveData.primary_name);
  }
  if (allNames.length === 0 && graveData.family_name) allNames.push(graveData.family_name);
  if (allNames.length === 0) return [];

  // Strip parenthetical role tags the OCR prompt may attach for disambiguation,
  // e.g. "George (deceased)" → "George", "Lizzie Knuver (wife)" → "Lizzie Knuver".
  // Without this, the literal "(deceased)" text leaks into every Tavily query
  // and poisons the result set. Also collapse any whitespace that leaves behind.
  for (let i = 0; i < allNames.length; i++) {
    allNames[i] = allNames[i].replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
  }
  // De-dupe in case stripping made two entries identical (e.g. two "George"s with different tags)
  const _seenNames = new Set();
  const _cleanNames = [];
  for (const n of allNames) { if (n && !_seenNames.has(n)) { _seenNames.add(n); _cleanNames.push(n); } }
  allNames.length = 0;
  allNames.push(..._cleanNames);
  if (allNames.length === 0) return [];

  const deathYear = graveData.death_date?.match(/\d{4}/)?.[0] || '';
  const birthYear = graveData.birth_date?.match(/\d{4}/)?.[0] || '';
  const loc = location ? location.split(',').slice(0,2).map(s=>s.trim()).join(' ') : '';

  // Build targeted queries for each person + targeted site searches
  const queries = [];
  // BURIAL-FIRST: explicit burial queries run first so they survive the slice(0,4) cap.
  // Without this, generic obituary queries dominate and the model conflates death-place with burial-place.
  allNames.slice(0, 3).forEach(name => {
    queries.push(`"${name}" buried cemetery grave location`.trim());
    queries.push(`site:findagrave.com "${name}" buried`.trim());
    // BillionGraves: GPS-verified, volunteer-transcribed headstones — closest
    // thing to a citable primary source.
    queries.push(`site:billiongraves.com "${name}"`.trim());
    // Chronicling America (Library of Congress): public-domain newspaper
    // archive, mostly pre-1929 US obituaries — free, fully licensed for embed.
    if (deathYear) {
      queries.push(`site:chroniclingamerica.loc.gov "${name}" ${deathYear} obituary`.trim());
    }
  });
  allNames.slice(0, 3).forEach(name => {
    const yr = deathYear || birthYear;
    queries.push(`site:findagrave.com "${name}" ${yr}`.trim());
    queries.push(`site:legacy.com "${name}" obituary ${loc}`.trim());
    queries.push(`"${name}" obituary ${yr} ${loc}`.trim());
  });
  // Add family history search
  if (graveData.family_name) {
    queries.push(`site:newspapers.com "${graveData.family_name}" ${loc} ${deathYear}`.trim());
  }
  // Add Atlas Obscura search for cemetery/location historical context
  if (loc) {
    queries.push(`site:atlasobscura.com ${loc} cemetery history`.trim());
    queries.push(`historic cemetery ${loc} history abandoned`.trim());
  }

  const results = [];
  const seen = new Set();

  // Cap raised 4 → 6: the burial-first block now also emits BillionGraves and
  // Chronicling America queries; at 4 the new sources would never run for
  // multi-name stones. Marginal Tavily cost at basic tier is ~$0.003/query.
  console.log('🔎 TAVILY queries planned:', queries.slice(0, 6));

  for (const query of queries.slice(0, 6)) {
    try {
      const res = await fetch(`${PROXY_BASE}/tavily`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          query,
          search_depth: 'basic',
          max_results: 3,
          include_answer: false
        })
      });
      const data = await res.json();
      console.log(`🔎 TAVILY "${query}" →`, data.results?.length || 0, 'results', data.results?.map(r => r.title));
      if (data.results) {
        data.results.forEach(r => {
          if (!seen.has(r.url)) {
            seen.add(r.url);
            const u = (r.url || '').toLowerCase();
            results.push({
              title: r.title,
              url: r.url,
              content: r.content?.slice(0, 1000),
              source_type:
                u.includes('billiongraves.com')        ? 'verified_transcription' :
                u.includes('findagrave.com')           ? 'memorial' :
                u.includes('chroniclingamerica.loc.gov') ? 'public_domain' :
                u.includes('legacy.com') || u.includes('newspapers.com') ? 'obituary' :
                'web'
            });
          }
        });
      }
    } catch (e) { console.log('🔎 TAVILY query failed:', query, e); }
  }

  console.log('🔎 TAVILY final aggregated results:', results);
  return results;
}
