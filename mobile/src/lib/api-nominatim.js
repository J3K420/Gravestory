const NOMINATIM = 'https://nominatim.openstreetmap.org';

// Forward-geocode a location string → { lat, lng } or null.
// Prefers cemetery-typed results; gracefully returns null on any failure.
export async function forwardGeocode(locationText) {
  if (!locationText) return null;
  try {
    const q = encodeURIComponent(locationText.trim());
    const url = `${NOMINATIM}/search?q=${q}&format=json&limit=5&addressdetails=1`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'GraveStory/1.0 (mobile)' },
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data?.length) return null;

    // Rank cemetery-typed results first
    const ranked = [...data].sort((a, b) => {
      const isCem = r => ['grave_yard', 'cemetery'].includes(r.type) || r.class === 'landuse';
      return isCem(b) - isCem(a);
    });
    const r = ranked[0];
    return { lat: parseFloat(r.lat), lng: parseFloat(r.lon) };
  } catch {
    return null;
  }
}
