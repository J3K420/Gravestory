import { graveCacheKey, readGraveCache, writeGraveCache } from './grave-cache';

const NOMINATIM = 'https://nominatim.openstreetmap.org';
const HEADERS   = { 'User-Agent': 'GraveStory/1.0 (mobile)' };

const US_STATE_LOOKUP = {
  'alabama':'alabama','al':'alabama','alaska':'alaska','ak':'alaska','arizona':'arizona','az':'arizona',
  'arkansas':'arkansas','ar':'arkansas','california':'california','ca':'california','colorado':'colorado','co':'colorado',
  'connecticut':'connecticut','ct':'connecticut','delaware':'delaware','de':'delaware','florida':'florida','fl':'florida',
  'georgia':'georgia','ga':'georgia','hawaii':'hawaii','hi':'hawaii','idaho':'idaho','id':'idaho',
  'illinois':'illinois','il':'illinois','indiana':'indiana','in':'indiana','iowa':'iowa','ia':'iowa',
  'kansas':'kansas','ks':'kansas','kentucky':'kentucky','ky':'kentucky','louisiana':'louisiana','la':'louisiana',
  'maine':'maine','me':'maine','maryland':'maryland','md':'maryland','massachusetts':'massachusetts','ma':'massachusetts',
  'michigan':'michigan','mi':'michigan','minnesota':'minnesota','mn':'minnesota','mississippi':'mississippi','ms':'mississippi',
  'missouri':'missouri','mo':'missouri','montana':'montana','mt':'montana','nebraska':'nebraska','ne':'nebraska',
  'nevada':'nevada','nv':'nevada','new hampshire':'new hampshire','nh':'new hampshire','new jersey':'new jersey','nj':'new jersey',
  'new mexico':'new mexico','nm':'new mexico','new york':'new york','ny':'new york','north carolina':'north carolina','nc':'north carolina',
  'north dakota':'north dakota','nd':'north dakota','ohio':'ohio','oh':'ohio','oklahoma':'oklahoma','ok':'oklahoma',
  'oregon':'oregon','or':'oregon','pennsylvania':'pennsylvania','pa':'pennsylvania','rhode island':'rhode island','ri':'rhode island',
  'south carolina':'south carolina','sc':'south carolina','south dakota':'south dakota','sd':'south dakota','tennessee':'tennessee','tn':'tennessee',
  'texas':'texas','tx':'texas','utah':'utah','ut':'utah','vermont':'vermont','vt':'vermont',
  'virginia':'virginia','va':'virginia','washington':'washington','wa':'washington','west virginia':'west virginia','wv':'west virginia',
  'wisconsin':'wisconsin','wi':'wisconsin','wyoming':'wyoming','wy':'wyoming','district of columbia':'district of columbia','dc':'district of columbia',
};

// Forward-geocode a location string → { lat, lng, isCemetery, lowConfidence } or null.
// Full parity with the web forwardGeocode: multi-query fallback, geographic context
// filter, low-confidence state mismatch flag, two-pass Overpass grave-node search,
// and AsyncStorage grave cache.
export async function forwardGeocode(locationStr, personName = null, dates = null) {
  if (!locationStr) return null;
  const lower = locationStr.toLowerCase();

  // ── Step 1: build query list ──────────────────────────────────────
  const queries = [locationStr];

  const nearMatch = locationStr.match(/^Cemetery (?:near|in or near) (.+)$/i);
  if (nearMatch) {
    queries.push(nearMatch[1] + ' cemetery');
    queries.push(nearMatch[1]);
  }
  if (!lower.includes('tomb') && !lower.includes('grave') && !lower.includes('cemetery')) {
    queries.push(locationStr + ' cemetery');
  }
  const parts = locationStr.split(',');
  if (parts.length > 1) {
    queries.push(parts.slice(1).join(',').trim() + ' cemetery');
    queries.push(parts.slice(1).join(',').trim());
  }
  if (parts.length > 1) {
    const cemeteryName = parts[0].trim();
    const cn = cemeteryName.toLowerCase();
    if (cn.includes('cemetery') || cn.includes('memorial park') ||
        cn.includes('graveyard') || cn.includes('burial') ||
        cn.includes('tomb') || cn.includes('mausoleum')) {
      queries.push(cemeteryName);
    }
  }
  if (parts.length >= 2) {
    queries.push(parts.slice(-2).join(',').trim() + ' cemetery');
    queries.push(parts.slice(-2).join(',').trim());
  }
  if (parts.length >= 1) {
    queries.push(parts[parts.length - 1].trim() + ' cemetery');
  }

  // ── Geographic context tokens (city/state/country after cemetery name) ──
  const allParts = locationStr.split(',').map(p => p.trim()).filter(Boolean);
  const geoTokens = [];
  for (const part of allParts.slice(1)) {
    const lc = part.toLowerCase();
    if (lc.length < 3 || ['usa', 'us', 'united states'].includes(lc)) continue;
    geoTokens.push(lc);
  }
  const requireGeo = geoTokens.length > 0;
  const passesGeoCheck = r => {
    if (!requireGeo) return true;
    const dn = (r.display_name || '').toLowerCase();
    return geoTokens.some(t => dn.includes(t));
  };

  // ── Detect US state for low-confidence flagging ───────────────────
  let queryStateName = null;
  for (const part of allParts.slice(1)) {
    const lc = part.toLowerCase();
    if (US_STATE_LOOKUP[lc]) { queryStateName = US_STATE_LOOKUP[lc]; break; }
  }

  // ── Run queries until a cemetery result passes geographic check ───
  let cemeteryCoords = null;
  let lowConfidence = false;

  for (const q of queries) {
    try {
      const url = `${NOMINATIM}/search?q=${encodeURIComponent(q)}&format=json&limit=5&addressdetails=1`;
      const res = await fetch(url, { headers: HEADERS });
      if (!res.ok) continue;
      const data = await res.json();
      if (!data?.length) continue;

      const strictCemetery = data.find(r =>
        ((r.class === 'landuse' && r.type === 'cemetery') ||
         (r.class === 'amenity' && r.type === 'grave_yard') ||
         r.type === 'cemetery' || r.type === 'grave_yard') &&
        passesGeoCheck(r)
      );
      const fuzzyCemetery = !strictCemetery ? data.find(r => {
        if (r.class === 'place' || r.class === 'boundary') return false;
        if (!passesGeoCheck(r)) return false;
        const dn = (r.display_name || '').toLowerCase();
        return dn.includes('cemetery') || dn.includes('memorial park') ||
               dn.includes('graveyard') || dn.includes('burial') || dn.includes('tomb');
      }) : null;

      const result = strictCemetery || fuzzyCemetery;
      if (!result) continue;

      cemeteryCoords = {
        lat: parseFloat(result.lat),
        lng: parseFloat(result.lon),
        bbox: result.boundingbox,
      };

      if (queryStateName) {
        const addrState = (result.address?.state || '').toLowerCase();
        const resolvedAddrState = US_STATE_LOOKUP[addrState];
        if (resolvedAddrState && resolvedAddrState !== queryStateName) {
          lowConfidence = true;
        }
      }
      break;
    } catch { continue; }
  }

  if (!cemeteryCoords) return null;

  // ── Grave cache lookup ────────────────────────────────────────────
  const cemeteryNameForKey = locationStr.split(',')[0].trim();
  const cacheKey = personName ? graveCacheKey(personName, cemeteryNameForKey, dates) : null;
  if (cacheKey) {
    const cached = await readGraveCache(cacheKey);
    if (cached) return { ...cached, isCemetery: true, lowConfidence };
  }

  // ── Nominatim name search within cemetery bbox ───────────────────
  // Overpass is blocked on mobile (all mirrors return 403/406 to Cloudflare
  // Worker IPs and to React Native's HTTP stack). Use Nominatim /search with
  // viewbox+bounded=1 instead — finds OSM-tagged grave/memorial nodes by name.
  if (personName && cemeteryCoords.bbox) {
    const nameTokens = personName.toLowerCase()
      .split(/[\s,().]+/)
      .filter(t => t.length > 2 && !['and', 'the', 'née', 'nee', 'von', 'van', 'de'].includes(t));

    if (nameTokens.length > 0) {
      try {
        // Expand bbox by ~100m so graves near the edge aren't clipped.
        const [s, n, w, e] = cemeteryCoords.bbox.map(Number);
        const pad = 0.001;
        const viewbox = `${w - pad},${s - pad},${e + pad},${n + pad}`;
        const url = `${NOMINATIM}/search?q=${encodeURIComponent(personName)}&format=json&viewbox=${viewbox}&bounded=1&limit=10`;
        const res = await fetch(url, { headers: HEADERS });
        if (res.ok) {
          const data = await res.json();
          let bestMatch = null;
          let bestScore = 0;
          for (const r of (data || [])) {
            const dn = (r.display_name || '').toLowerCase();
            const score = nameTokens.filter(t => dn.includes(t)).length;
            if (score > bestScore) { bestScore = score; bestMatch = r; }
          }
          const threshold = Math.max(nameTokens.length === 1 ? 1 : 2, Math.ceil(nameTokens.length * 0.75));
          if (bestMatch && bestScore >= threshold) {
            const coords = { lat: parseFloat(bestMatch.lat), lng: parseFloat(bestMatch.lon) };
            if (cacheKey) await writeGraveCache(cacheKey, coords, bestMatch.display_name, bestScore);
            return { ...coords, isCemetery: true, lowConfidence };
          }
        }
      } catch (e) { console.warn('Nominatim name search failed:', e.message); }
    }
  }

  // ── Step 3: fall back to cemetery center ─────────────────────────
  return { lat: cemeteryCoords.lat, lng: cemeteryCoords.lng, isCemetery: true, lowConfidence };
}

// Reverse-geocode a GPS coordinate to a human-readable "City, State" string.
// Used to enrich search context before Tavily/WikiTree queries fire.
export async function reverseGeocode(lat, lng) {
  try {
    const url = `${NOMINATIM}/reverse?format=json&lat=${lat}&lon=${lng}&zoom=10&addressdetails=1`;
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) return null;
    const data = await res.json();
    const addr = data.address || {};
    const city  = addr.city || addr.town || addr.village || addr.hamlet || addr.suburb || '';
    const state = addr.state || '';
    const country = (addr.country_code || '').toLowerCase() !== 'us' ? (addr.country || '') : '';
    return [city, state || country].filter(Boolean).join(', ') || null;
  } catch (e) {
    console.warn('reverseGeocode failed:', e?.message);
    return null;
  }
}
