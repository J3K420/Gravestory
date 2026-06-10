// js/api-nominatim.js
// Nominatim reverse-geocode helper.
// Direct call to nominatim.openstreetmap.org (no proxy).
// Used by runAnalysis to turn GPS coords into a human-readable location string.

async function reverseGeocode(lat, lng) {
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json`);
    const data = await res.json();
    const a = data.address;
    const parts = [a.city || a.town || a.village || a.county, a.state, a.country].filter(Boolean);
    return parts.join(', ');
  } catch { return null; }
}

// Resolve the name of the cemetery the GPS point sits inside, if any.
// FindAGrave memorial pages and obituaries almost always name the cemetery, so
// adding "Green-Wood Cemetery" to the Tavily queries is a powerful disambiguator
// for common names. The user is physically standing in the cemetery, so a
// high-zoom reverse lookup usually returns the enclosing burial-ground feature.
// Returns the cemetery name string or null.
async function reverseGeocodeCemetery(lat, lng) {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&zoom=18&extratags=1&namedetails=1`
    );
    if (!res.ok) return null;
    const data = await res.json();
    const a = data.address || {};
    // The cemetery name surfaces in different address keys depending on how OSM
    // tagged it. Prefer an explicit cemetery/grave_yard, then the named feature.
    const candidate = a.cemetery || a.grave_yard || a.amenity || null;
    const looksLikeCemetery = (s) => /cemetery|graveyard|grave yard|memorial park|burial|mausoleum/i.test(s || '');
    if (candidate && looksLikeCemetery(candidate)) return candidate;
    // Fall back to the top-level name if the matched feature itself is a cemetery.
    const cls = data.class, typ = data.type;
    if ((cls === 'landuse' && typ === 'cemetery') || (cls === 'amenity' && typ === 'grave_yard')) {
      const name = data.namedetails?.name || data.name || candidate;
      if (name && looksLikeCemetery(name)) return name;
      if (name) return name; // a cemetery feature with a non-obvious name (e.g. "Machpelah")
    }
    if (candidate && looksLikeCemetery(candidate)) return candidate;
    return null;
  } catch { return null; }
}
