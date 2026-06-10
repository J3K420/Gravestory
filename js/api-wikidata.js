// js/api-wikidata.js
// Wikidata queries for structured biographical data.
// CORS-open — callable directly from the browser (no proxy needed).
// Provides: person birth/death dates for corroboration, burial place label
// for namesake guard confirmation, precise grave coordinates for pin placement,
// and the linked English Wikipedia article title (sitelink) so a stone whose
// engraved name differs from the article title (e.g. "Erik Weisz" → "Harry
// Houdini") can still bridge to the right Wikipedia article downstream.
// Only useful for notable figures (ordinary people have no Wikidata entry — returns null).
// Only fires when name_confidence === 'high' to avoid false matches on uncertain OCR.
//
// Matching strategy (changed from exact rdfs:label): uses the wbsearchentities
// action, which matches on labels AND aliases AND near-spellings — so maiden
// names, birth names, and stage names all resolve. Candidates are then scored
// by death-year proximity rather than blindly taking the first hit, which
// prevents namesake collisions (e.g. a different person of the same name).

async function _wikidataSparql(sparql) {
  const url = `https://query.wikidata.org/sparql?query=${encodeURIComponent(sparql)}&format=json`;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'GraveStory/1.0 (gravestory app)' }
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.results?.bindings || [];
  } catch {
    return null;
  }
}

// Alias-aware entity search. Returns up to `limit` candidate entity IDs (Q-numbers)
// whose label OR alias matches the name — catches maiden/birth/stage names that an
// exact label query would miss. Returns [] on failure.
async function _wbSearchEntities(name, limit = 7) {
  const url = `https://www.wikidata.org/w/api.php?action=wbsearchentities` +
    `&search=${encodeURIComponent(name)}&language=en&type=item&limit=${limit}&format=json&origin=*`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'GraveStory/1.0 (gravestory app)' } });
    if (!res.ok) return [];
    const data = await res.json();
    return (data?.search || []).map(s => s.id).filter(Boolean);
  } catch {
    return [];
  }
}

// Fetch structured facts (P31 human guard, birth/death dates, burial place +
// coords, and the en.wikipedia sitelink) for a set of entity IDs in one query.
async function _fetchEntityFacts(entityIds) {
  if (!entityIds.length) return [];
  const values = entityIds.map(id => `wd:${id}`).join(' ');
  const sparql = `
    SELECT ?person ?birthDate ?deathDate
           ?burialPlace ?burialPlaceLabel ?coord ?article
    WHERE {
      VALUES ?person { ${values} }
      ?person wdt:P31 wd:Q5.
      OPTIONAL { ?person wdt:P569 ?birthDate. }
      OPTIONAL { ?person wdt:P570 ?deathDate. }
      OPTIONAL {
        ?person wdt:P119 ?burialPlace.
        OPTIONAL { ?burialPlace wdt:P625 ?coord. }
      }
      OPTIONAL {
        ?article schema:about ?person;
                 schema:isPartOf <https://en.wikipedia.org/>.
      }
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    }
  `;
  return (await _wikidataSparql(sparql)) || [];
}

// Fetch P625 coordinates for a Wikidata burial-place entity.
async function _fetchBurialCoords(entityId) {
  if (!entityId) return null;
  const sparql = `SELECT ?coord WHERE { wd:${entityId} wdt:P625 ?coord. }`;
  const bindings = await _wikidataSparql(sparql);
  if (!bindings?.length) return null;
  const coord = bindings[0]?.coord?.value;
  if (!coord) return null;
  const match = coord.match(/Point\(([-\d.]+)\s+([-\d.]+)\)/);
  return match ? { lng: parseFloat(match[1]), lat: parseFloat(match[2]) } : null;
}

// Query Wikidata for a person by name (alias-aware) + optional death-year scoring.
// Returns { birthDate, deathDate, burialPlaceLabel, burialEntityId, burialCoords,
// wikipediaTitle } or null.
async function queryWikidata(name, deathYear) {
  if (!name || name.trim().length < 3) return null;

  const safeName = name.trim();

  // 1. Alias-aware candidate search (matches maiden/birth/stage names).
  const entityIds = await _wbSearchEntities(safeName, 7);
  if (!entityIds.length) return null;

  // 2. Fetch facts for all candidates and keep only those that are humans.
  const bindings = await _fetchEntityFacts(entityIds);
  if (!bindings?.length) return null;

  // Collapse multiple bindings per entity (OPTIONAL joins can fan out rows).
  const byEntity = new Map();
  for (const b of bindings) {
    const id = b.person?.value || '';
    if (!id) continue;
    if (!byEntity.has(id)) {
      byEntity.set(id, {
        entityUri: id,
        birthDate: b.birthDate?.value?.slice(0, 10) || null,
        deathDate: b.deathDate?.value?.slice(0, 10) || null,
        burialPlaceLabel: b.burialPlaceLabel?.value || null,
        burialPlaceUri: b.burialPlace?.value || null,
        coord: b.coord?.value || null,
        article: b.article?.value || null,
      });
    } else {
      // Backfill any field this row supplies that the first row lacked.
      const e = byEntity.get(id);
      e.birthDate = e.birthDate || (b.birthDate?.value?.slice(0, 10) || null);
      e.deathDate = e.deathDate || (b.deathDate?.value?.slice(0, 10) || null);
      e.burialPlaceLabel = e.burialPlaceLabel || (b.burialPlaceLabel?.value || null);
      e.burialPlaceUri = e.burialPlaceUri || (b.burialPlace?.value || null);
      e.coord = e.coord || (b.coord?.value || null);
      e.article = e.article || (b.article?.value || null);
    }
  }

  const candidates = Array.from(byEntity.values());
  if (!candidates.length) return null;

  // 3. Score by death-year proximity — preserves wbsearchentities relevance order
  //    as the tiebreaker (Map iteration follows entityIds insertion order). This
  //    prevents picking a same-named namesake when the stone's death year is known.
  const targetYear = deathYear ? parseInt(deathYear, 10) : null;
  let best = candidates[0];
  if (targetYear) {
    let bestScore = -Infinity;
    for (const c of candidates) {
      const cYear = c.deathDate ? parseInt(c.deathDate.slice(0, 4), 10) : null;
      let score;
      if (cYear) {
        const diff = Math.abs(cYear - targetYear);
        // Reject candidates whose death year is wildly off — almost certainly a namesake.
        if (diff > 5) continue;
        score = 100 - diff * 10;
      } else {
        // No death date on the candidate: keep as a weak fallback, ranked below any
        // date-aligned candidate but above an outright rejection.
        score = -50;
      }
      if (score > bestScore) { bestScore = score; best = c; }
    }
    // If every candidate was rejected for date mismatch, don't guess — return null.
    if (bestScore === -Infinity) return null;
  }

  const wikipediaTitle = best.article
    ? decodeURIComponent(best.article.replace('https://en.wikipedia.org/wiki/', '')).replace(/_/g, ' ')
    : null;

  const burialEntityId = best.burialPlaceUri
    ? best.burialPlaceUri.replace('http://www.wikidata.org/entity/', '')
    : null;

  let burialCoords = null;
  if (best.coord) {
    const match = best.coord.match(/Point\(([-\d.]+)\s+([-\d.]+)\)/);
    if (match) burialCoords = { lng: parseFloat(match[1]), lat: parseFloat(match[2]) };
  }
  if (!burialCoords && burialEntityId) {
    burialCoords = await _fetchBurialCoords(burialEntityId);
  }

  return {
    birthDate: best.birthDate,
    deathDate: best.deathDate,
    burialPlaceLabel: best.burialPlaceLabel,
    burialEntityId,
    burialCoords,
    wikipediaTitle,
  };
}
