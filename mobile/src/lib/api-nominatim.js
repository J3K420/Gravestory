import { graveCacheKey, readGraveCache, writeGraveCache } from './grave-cache';

const NOMINATIM = 'https://nominatim.openstreetmap.org';
const OVERPASS  = 'https://overpass-api.de/api/interpreter';
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

  // ── Two-pass Overpass grave-node search ───────────────────────────
  if (personName) {
    const nameTokens = personName.toLowerCase()
      .split(/[\s,().]+/)
      .filter(t => t.length > 2 && !['and', 'the', 'née', 'nee', 'von', 'van', 'de'].includes(t));

    let bestMatch = null;
    let bestScore = 0;
    let bestFromTagged = false;

    // Pass 1 — tagged nodes/ways within 1000m
    try {
      const { lat: lat1, lng: lng1 } = cemeteryCoords;
      const overpassQuery = `
        [out:json][timeout:20];
        (
          node[name][historic~"^(memorial|tomb|grave|monument|mausoleum)$"](around:1000,${lat1},${lng1});
          way[name][historic~"^(memorial|tomb|grave|monument|mausoleum)$"](around:1000,${lat1},${lng1});
          node[name][tourism=attraction](around:1000,${lat1},${lng1});
          way[name][tourism=attraction](around:1000,${lat1},${lng1});
          node[name][cemetery=grave](around:1000,${lat1},${lng1});
          way[name][cemetery=grave](around:1000,${lat1},${lng1});
          node[name][memorial](around:1000,${lat1},${lng1});
          way[name][memorial](around:1000,${lat1},${lng1});
          node[name][building~"^(tomb|mausoleum|chapel)$"](around:1000,${lat1},${lng1});
          way[name][building~"^(tomb|mausoleum|chapel)$"](around:1000,${lat1},${lng1});
        );
        out center;
      `;
      const res1 = await fetch(OVERPASS, { method: 'POST', body: 'data=' + encodeURIComponent(overpassQuery) });
      if (res1.ok) {
        const d1 = await res1.json();
        for (const el of (d1.elements || [])) {
          if (!el.tags?.name) continue;
          const score = nameTokens.filter(t => el.tags.name.toLowerCase().includes(t)).length;
          if (score > bestScore) { bestScore = score; bestMatch = el; bestFromTagged = true; }
        }
      }
    } catch (e) { console.warn('Overpass pass 1 failed:', e.message); }

    const minTagged = Math.max(nameTokens.length === 1 ? 1 : 2, Math.ceil(nameTokens.length * 0.75));

    // Pass 2 — any named node within Nominatim bounding box (100% match required)
    if (bestScore < minTagged && cemeteryCoords.bbox) {
      try {
        const [s, n, w, e] = cemeteryCoords.bbox.map(Number);
        const bboxQuery = `
          [out:json][timeout:15];
          (
            node[name](${s},${w},${n},${e});
            way[name](${s},${w},${n},${e});
          );
          out center;
        `;
        const res2 = await fetch(OVERPASS, { method: 'POST', body: 'data=' + encodeURIComponent(bboxQuery) });
        if (res2.ok) {
          const d2 = await res2.json();
          for (const el of (d2.elements || [])) {
            if (!el.tags?.name) continue;
            const score = nameTokens.filter(t => el.tags.name.toLowerCase().includes(t)).length;
            if (score > bestScore) { bestScore = score; bestMatch = el; bestFromTagged = false; }
          }
        }
      } catch (e) { console.warn('Overpass pass 2 failed:', e.message); }
    }

    const threshold = bestFromTagged ? minTagged : nameTokens.length;
    if (bestMatch && bestScore >= threshold) {
      const lat = bestMatch.lat ?? bestMatch.center?.lat;
      const lng = bestMatch.lon ?? bestMatch.center?.lon;
      if (lat && lng) {
        const coords = { lat, lng };
        if (cacheKey) await writeGraveCache(cacheKey, coords, bestMatch.tags.name, bestScore);
        return { ...coords, isCemetery: true, lowConfidence };
      }
    }
  }

  // ── Step 3: fall back to cemetery center ─────────────────────────
  return { lat: cemeteryCoords.lat, lng: cemeteryCoords.lng, isCemetery: true, lowConfidence };
}
