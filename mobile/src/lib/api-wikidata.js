// mobile/src/lib/api-wikidata.js
// Wikidata SPARQL queries for structured biographical data.
// CORS-open — callable directly from the app (no proxy needed).
// Provides: person birth/death dates for corroboration, burial place label
// for namesake guard confirmation, and precise grave coordinates for pin placement.
// Only useful for notable figures (ordinary people have no Wikidata entry — returns null).
// Only fires when name_confidence === 'high' to avoid false matches on uncertain OCR.

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

// Query Wikidata for a person by exact English label + optional death-year window.
// Returns { birthDate, deathDate, burialPlaceLabel, burialEntityId, burialCoords } or null.
export async function queryWikidata(name, deathYear) {
  if (!name || name.trim().length < 3) return null;

  const safeName = name.trim().replace(/"/g, '');
  const yearFilter = deathYear
    ? `FILTER(YEAR(?deathDate) >= ${parseInt(deathYear, 10) - 2} && YEAR(?deathDate) <= ${parseInt(deathYear, 10) + 2})`
    : '';

  const sparql = `
    SELECT ?person ?personLabel ?birthDate ?deathDate
           ?burialPlace ?burialPlaceLabel ?coord
    WHERE {
      ?person wdt:P31 wd:Q5;
              rdfs:label "${safeName}"@en.
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

  const bindings = await sparqlQuery(sparql);
  if (!bindings?.length) return null;

  const best = bindings[0];
  const birthDate = best.birthDate?.value?.slice(0, 10) || null;
  const deathDate = best.deathDate?.value?.slice(0, 10) || null;
  const burialPlaceLabel = best.burialPlaceLabel?.value || null;
  const burialEntityId = best.burialPlace?.value?.replace('http://www.wikidata.org/entity/', '') || null;

  // Burial coords: try inline P625 on the burial place first, then a targeted query.
  let burialCoords = null;
  if (best.coord?.value) {
    const match = best.coord.value.match(/Point\(([-\d.]+)\s+([-\d.]+)\)/);
    if (match) burialCoords = { lng: parseFloat(match[1]), lat: parseFloat(match[2]) };
  }
  if (!burialCoords && burialEntityId) {
    burialCoords = await fetchBurialCoords(burialEntityId);
  }

  return { birthDate, deathDate, burialPlaceLabel, burialEntityId, burialCoords };
}
