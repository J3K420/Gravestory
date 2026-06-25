// ── GRAVE LOCATION CACHE ────────────────────────────────────────
// Cache the precise grave coords returned by Overpass when we're highly confident
// (most/all name tokens matched a named OSM node inside the cemetery). This avoids
// re-querying flaky Overpass for the same well-known graves, and gives users the
// correct pin even when OSM is temporarily down.
const GRAVE_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function graveCacheKey(personName, cemeteryName, dates, geoContext = '') {
  // Normalize to lowercase alphanumeric+underscore for a stable key
  const norm = s => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  const yearMatch = (dates || '').match(/\d{4}/g) || [];
  const yearKey = yearMatch.slice(0, 2).join('-') || 'na';
  // geoContext (city/state tokens) is part of the key so two same-named people in
  // same-named cemeteries in DIFFERENT cities/states don't collide onto one cached
  // coordinate (serving a precise pin in the wrong place). v3 — bumped from v2, which
  // omitted geoContext; stale v2 entries are never read and expire on their own TTL.
  return `grave_v3:${norm(personName)}:${norm(cemeteryName)}:${norm(geoContext)}:${yearKey}`;
}

function readGraveCache(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const entry = JSON.parse(raw);
    if (!entry || !entry.ts || !entry.coords) return null;
    if (Date.now() - entry.ts > GRAVE_CACHE_TTL_MS) {
      localStorage.removeItem(key);
      return null;
    }
    return entry.coords;
  } catch {
    return null;
  }
}

function writeGraveCache(key, coords, sourceName, score) {
  try {
    localStorage.setItem(key, JSON.stringify({
      ts: Date.now(),
      coords,
      sourceName,
      score
    }));
    console.log('💾 Cached grave coords for', key, '→', sourceName, '(score', score + ')');
  } catch(e) {
    // localStorage full or disabled — non-fatal
    console.log('Cache write failed:', e);
  }
}
