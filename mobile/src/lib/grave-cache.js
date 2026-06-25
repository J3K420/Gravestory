import AsyncStorage from '@react-native-async-storage/async-storage';

const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// geoContext (city/state tokens after the cemetery name) is part of the key so two
// same-named people in same-named cemeteries in DIFFERENT cities/states don't collide
// onto one cached coordinate (which would serve a precise pin in the wrong place).
// v3 key — bumped from v2, which omitted geoContext; old v2 entries (possibly poisoned
// by a cross-city collision) are simply never read and expire on their own TTL.
export function graveCacheKey(personName, cemeteryName, dates, geoContext = '') {
  const norm = s => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  const yearMatch = (dates || '').match(/\d{4}/g) || [];
  const yearKey = yearMatch.slice(0, 2).join('-') || 'na';
  return `grave_v3:${norm(personName)}:${norm(cemeteryName)}:${norm(geoContext)}:${yearKey}`;
}

export async function readGraveCache(key) {
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return null;
    const entry = JSON.parse(raw);
    if (!entry?.ts || !entry?.coords) return null;
    if (Date.now() - entry.ts > TTL_MS) {
      await AsyncStorage.removeItem(key);
      return null;
    }
    return entry.coords;
  } catch {
    return null;
  }
}

export async function writeGraveCache(key, coords, sourceName, score) {
  try {
    await AsyncStorage.setItem(key, JSON.stringify({ ts: Date.now(), coords, sourceName, score }));
  } catch {
    // non-fatal — storage full or unavailable
  }
}
