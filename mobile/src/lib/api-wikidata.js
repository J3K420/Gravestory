// mobile/src/lib/api-wikidata.js
// Wikidata queries for structured biographical data.
// CORS-open — callable directly from the app (no proxy needed).
// Provides: person birth/death dates for corroboration, burial place label
// for namesake guard confirmation, precise grave coordinates for pin placement,
// and the linked English Wikipedia article title (sitelink) so a stone whose
// engraved name differs from the article title (e.g. "Erik Weisz" → "Harry
// Houdini") can still bridge to the right Wikipedia article downstream.
// Only useful for notable figures (ordinary people have no Wikidata entry — returns null).
// Gated by the caller: fires on high confidence always, and on medium confidence
// when a death year is present (the death-year proximity filter below rejects
// namesakes >5yr off, so a known year makes medium-confidence safe).
//
// Matching strategy (changed from exact rdfs:label): uses the wbsearchentities
// action, which matches on labels AND aliases AND near-spellings — so maiden
// names, birth names, and stage names all resolve. Candidates are then scored
// by death-year proximity rather than blindly taking the first hit, which
// prevents namesake collisions (e.g. a different person of the same name).

const USER_AGENT = 'GraveStory/1.0 (gravestory app)';

async function sparqlQuery(sparql) {
  const url = `https://query.wikidata.org/sparql?query=${encodeURIComponent(sparql)}&format=json`;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' },
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
async function wbSearchEntities(name, limit = 7) {
  const url = `https://www.wikidata.org/w/api.php?action=wbsearchentities` +
    `&search=${encodeURIComponent(name)}&language=en&type=item&limit=${limit}&format=json&origin=*`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': USER_AGENT, 'Accept': 'application/json' } });
    if (!res.ok) return [];
    const data = await res.json();
    return (data?.search || []).map(s => s.id).filter(Boolean);
  } catch {
    return [];
  }
}

// Fetch structured facts (P31 human guard, birth/death dates, burial place +
// coords, and the en.wikipedia sitelink) for a set of entity IDs in one query.
async function fetchEntityFacts(entityIds) {
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
  return (await sparqlQuery(sparql)) || [];
}

// Fetch P625 coordinates for a Wikidata burial-place entity.
async function fetchBurialCoords(entityId) {
  if (!entityId) return null;
  const sparql = `SELECT ?coord WHERE { wd:${entityId} wdt:P625 ?coord. }`;
  const bindings = await sparqlQuery(sparql);
  if (!bindings?.length) return null;
  const coord = bindings[0]?.coord?.value;
  if (!coord) return null;
  const match = coord.match(/Point\(([-\d.]+)\s+([-\d.]+)\)/);
  return match ? { lng: parseFloat(match[1]), lat: parseFloat(match[2]) } : null;
}

// Query Wikidata for a person by name (alias-aware) + optional death-year scoring.
// Returns { birthDate, deathDate, burialPlaceLabel, burialEntityId, burialCoords,
// wikipediaTitle } or null.
export async function queryWikidata(name, deathYear) {
  if (!name || name.trim().length < 3) return null;

  const safeName = name.trim();

  // 1. Alias-aware candidate search (matches maiden/birth/stage names).
  const entityIds = await wbSearchEntities(safeName, 7);
  if (!entityIds.length) return null;

  // 2. Fetch facts for all candidates and keep only those that are humans.
  const bindings = await fetchEntityFacts(entityIds);
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
        // No death date on the candidate: weak fallback, ranked below date-aligned.
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
    burialCoords = await fetchBurialCoords(burialEntityId);
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

// ── Famous-interment recovery (cemetery → person reverse lookup) ─────────────
// Resolve a cemetery NAME to its Wikidata Q-id. Uses wbsearchentities then keeps
// only candidates that are a cemetery/burial-ground (P31 within a small allow-set),
// to avoid matching an unrelated entity that happens to share the name. Returns
// the first matching Q-id, or null. (One Q-id is enough — the burial query below
// is itself surname-gated and aborts on ambiguity, so a slightly wrong cemetery
// resolution just yields no person, never a wrong person.)
const CEMETERY_TYPE_QIDS = new Set([
  'Q39614',   // cemetery
  'Q19844914', // burial ground / churchyard-adjacent (graveyard)
  'Q1187592',  // memorial park
  // NOTE: 'Q5043' (church) was deliberately NOT included — a famous person buried
  // at a famous church (e.g. Westminster Abbey) would match by surname and could be
  // attached to an unrelated grave. Keep this list to true burial grounds; the
  // GPS distance check below is the second guard. [review edge: church too permissive]
]);

// Great-circle distance in metres (small inline haversine — avoids importing
// map-utils into this leaf module). Used only for the cemetery proximity guard.
function _coordDistanceMeters(a, b) {
  const R = 6371000;
  const toRad = d => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Resolve a cemetery NAME to its Wikidata Q-id. When userGps is supplied and the
// candidate cemetery carries P625 coordinates, any candidate more than ~3 km from
// the user is rejected — this closes the same-named-different-cemetery hole that
// the surname/person gates downstream cannot see (e.g. one of the dozens of "Oak
// Hill Cemetery"s resolving to the wrong one). [review M6]
async function resolveCemeteryEntity(cemeteryName, userGps) {
  if (!cemeteryName || cemeteryName.trim().length < 3) return null;
  // Take the first comma-delimited token if a full "Name, City, State" string was
  // passed — the cemetery's own name is the searchable label.
  const label = cemeteryName.split(',')[0].trim();
  const ids = await wbSearchEntities(label, 5);
  if (!ids.length) return null;
  const values = ids.map(id => `wd:${id}`).join(' ');
  const sparql = `
    SELECT ?place ?type ?coord WHERE {
      VALUES ?place { ${values} }
      ?place wdt:P31 ?type.
      OPTIONAL { ?place wdt:P625 ?coord. }
    }
  `;
  const bindings = (await sparqlQuery(sparql)) || [];
  for (const id of ids) {
    const uri = `http://www.wikidata.org/entity/${id}`;
    const rows = bindings.filter(b => b.place?.value === uri);
    const types = rows.map(b => (b.type?.value || '').replace('http://www.wikidata.org/entity/', ''));
    if (!types.some(t => CEMETERY_TYPE_QIDS.has(t))) continue;
    // Proximity guard: if we have the user's GPS and this cemetery's coords, reject
    // a same-named cemetery that is nowhere near the user.
    if (userGps && userGps.lat != null && userGps.lng != null) {
      const coordRow = rows.find(b => b.coord?.value);
      if (coordRow) {
        const m = coordRow.coord.value.match(/Point\(([-\d.]+)\s+([-\d.]+)\)/);
        if (m) {
          const cem = { lng: parseFloat(m[1]), lat: parseFloat(m[2]) };
          if (_coordDistanceMeters(userGps, cem) > 3000) continue;
        }
      }
    }
    return id;
  }
  return null;
}

// Reverse lookup: given a resolved cemetery NAME and a SURNAME (and optional
// first name / death year), return the single notable person buried there whose
// name matches — or null. This recovers famous graves identified by a bare
// surname banner (e.g. "BOOTH" at Green Mount Cemetery → John Wilkes Booth) that
// the name-first paths (WikiTree needs two tokens, Wikidata-by-name has no death
// year to disambiguate) cannot resolve.
//
// SAFETY (anti-mis-attribution) — this is a CANDIDATE, never an asserted fact:
//   - Surname must match a name/alias token of the buried person.
//   - If MORE THAN ONE distinct notable person of that surname is buried there,
//     return null (abort) — a family plot with several same-surname interments
//     (Green Mount has several Booths) must not be guessed. A first name, when
//     supplied, narrows before this count is taken.
//   - The caller must still corroborate the returned candidate against an
//     independent source (Wikipedia) before naming them in a biography.
//
// Returns { name, birthDate, deathDate, burialPlaceLabel, burialEntityId,
//   burialCoords, wikipediaTitle, entityId } or null.
export async function queryWikidataByBurialPlace(cemeteryName, surname, opts) {
  // opts ({ firstName, deathYear }) is accepted for caller symmetry but no longer
  // used for narrowing — the un-narrowed same-surname count is the ambiguity guard.
  // opts.userGps ({ lat, lng }) is used only to reject a same-named distant cemetery.
  const _userGps = (opts && opts.userGps) || null;
  if (!surname || surname.trim().length < 2) return null;

  const cemeteryQ = await resolveCemeteryEntity(cemeteryName, _userGps);
  if (!cemeteryQ) return null;

  const lcSurname = surname.trim().toLowerCase();
  // (firstName / deathYear narrowing was removed — the un-narrowed surname count
  // is the ambiguity guard; see the >1 abort below. [review L1])
  // Surname-fold for SPARQL: match the surname against the person's label OR any
  // English alias, INSIDE the query, so (a) the ambiguity count is accurate even
  // for interments with no English rdfs:label (which the label service would
  // otherwise return as a bare "Qxxxx" that never matches), and (b) the LIMIT
  // bounds same-surname rows only, so a second match can't be truncated away at a
  // huge cemetery — both defeat the >1 abort otherwise. [review M5, L4]
  const sparqlSurname = lcSurname.replace(/["\\]/g, '');
  const sparql = `
    SELECT ?person ?personLabel ?birthDate ?deathDate
           ?coord ?burialPlaceLabel ?article
    WHERE {
      ?person wdt:P119 wd:${cemeteryQ};
              wdt:P31 wd:Q5;
              rdfs:label ?anyLabel.
      OPTIONAL { ?person skos:altLabel ?altLabel. FILTER(LANG(?altLabel) = "en") }
      FILTER(
        CONTAINS(LCASE(STR(?anyLabel)), "${sparqlSurname}") ||
        CONTAINS(LCASE(STR(?altLabel)), "${sparqlSurname}")
      )
      OPTIONAL { ?person wdt:P569 ?birthDate. }
      OPTIONAL { ?person wdt:P570 ?deathDate. }
      OPTIONAL { wd:${cemeteryQ} wdt:P625 ?coord. }
      OPTIONAL {
        ?article schema:about ?person;
                 schema:isPartOf <https://en.wikipedia.org/>.
      }
      BIND(wd:${cemeteryQ} AS ?burialPlace)
      SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    }
    LIMIT 200
  `;
  const bindings = await sparqlQuery(sparql);
  if (!bindings?.length) return null;

  // Collapse to one record per person (OPTIONAL joins fan out rows).
  const byPerson = new Map();
  for (const b of bindings) {
    const id = b.person?.value || '';
    if (!id) continue;
    const label = b.personLabel?.value || '';
    if (!byPerson.has(id)) {
      byPerson.set(id, {
        entityUri: id,
        name: label,
        birthDate: b.birthDate?.value?.slice(0, 10) || null,
        deathDate: b.deathDate?.value?.slice(0, 10) || null,
        burialPlaceLabel: b.burialPlaceLabel?.value || null,
        coord: b.coord?.value || null,
        article: b.article?.value || null,
      });
    } else {
      const e = byPerson.get(id);
      e.birthDate = e.birthDate || (b.birthDate?.value?.slice(0, 10) || null);
      e.deathDate = e.deathDate || (b.deathDate?.value?.slice(0, 10) || null);
      e.coord = e.coord || (b.coord?.value || null);
      e.article = e.article || (b.article?.value || null);
    }
  }

  // The SPARQL already surname-filtered against label OR alias, so every person
  // here is a same-surname candidate. A person whose English label is a bare Q-id
  // (matched via a non-English alias) cannot be ruled out and is kept in the count.
  const sameSurname = Array.from(byPerson.values());
  if (sameSurname.length === 0) return null;
  // ANTI-MIS-ATTRIBUTION: more than one same-surname interment is ambiguous — do
  // not guess which one this stone belongs to. Take this abort against the
  // UN-narrowed count, so a first-name/death-year narrowing can never collapse a
  // genuinely ambiguous family plot down to one and bypass the guard. [review L1]
  if (sameSurname.length > 1) return null;

  const best = sameSurname[0];
  let wikipediaTitle = null;
  if (best.article) {
    try {
      wikipediaTitle = decodeURIComponent(
        best.article.replace('https://en.wikipedia.org/wiki/', '')).replace(/_/g, ' ');
    } catch {
      // Malformed %-sequence — fall back to the raw underscored title rather than
      // discarding an otherwise valid candidate. [review L5]
      wikipediaTitle = best.article.replace('https://en.wikipedia.org/wiki/', '').replace(/_/g, ' ');
    }
  }
  let burialCoords = null;
  if (best.coord) {
    const m = best.coord.match(/Point\(([-\d.]+)\s+([-\d.]+)\)/);
    if (m) burialCoords = { lng: parseFloat(m[1]), lat: parseFloat(m[2]) };
  }

  return {
    name: best.name,
    birthDate: best.birthDate,
    deathDate: best.deathDate,
    burialPlaceLabel: best.burialPlaceLabel,
    burialEntityId: cemeteryQ,
    burialCoords,
    wikipediaTitle,
    entityId: best.entityUri.replace('http://www.wikidata.org/entity/', ''),
    _viaBurialPlace: true,
  };
}
