// Module-level cache for the global (community) map's RPC result, shared so the
// cemetery map can INVALIDATE it after a drag-correct (otherwise a just-corrected pin
// wouldn't show on the community map until the 5-min TTL expired). Kept in lib/ rather
// than inside GlobalMapScreen so the cemetery screen doesn't have to import another
// screen (the only screen-to-screen import in the app) to reset it.
export const GLOBAL_MAP_CACHE_TTL_MS = 5 * 60 * 1000;

let _cache = null;
let _cacheTime = 0;
let _cacheUserId = null;

// Returns the cached stories array if still fresh for this user, else null.
export function readGlobalMapCache(cacheKey) {
  if (_cache && _cacheUserId === cacheKey && Date.now() - _cacheTime < GLOBAL_MAP_CACHE_TTL_MS) {
    return _cache;
  }
  return null;
}

export function writeGlobalMapCache(cacheKey, stories) {
  _cache = stories;
  _cacheTime = Date.now();
  _cacheUserId = cacheKey;
}

// Drop the cache so the next global-map fetch re-queries the RPC. Called after a
// drag-correct so the community map reflects the new pin immediately.
export function resetGlobalMapCache() {
  _cache = null;
  _cacheTime = 0;
  _cacheUserId = null;
}
