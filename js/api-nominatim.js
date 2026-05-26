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
