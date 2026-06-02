import AsyncStorage from '@react-native-async-storage/async-storage';

const TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export function graveCacheKey(personName, cemeteryName, dates) {
  const norm = s => (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  const yearMatch = (dates || '').match(/\d{4}/g) || [];
  const yearKey = yearMatch.slice(0, 2).join('-') || 'na';
  return `grave_v2:${norm(personName)}:${norm(cemeteryName)}:${yearKey}`;
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
