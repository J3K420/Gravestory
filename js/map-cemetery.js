// ── MAP: CEMETERY SCREEN ─────────────────────────────────
//
// Cemetery map screen + drag-to-correct + nearby cemeteries.
// Extracted from inline <script> in index.html during Stage 11 (= Stage 10b).
//
// Module surface (all top-level function declarations auto-attach to window):
//   handleMarkerDragEnd    — drag-to-correct grave location
//   buildPopupBio          — expandable bio HTML for cemetery-map popups
//   leaveCemeteryMap       — back-button handler
//   openCemeteryMap        — entry point (called from home, result, onclick)
//   initCemeteryMap        — populate map + sidebar + nearby section
//   constrainToCemetery    — Turf-based snap-inside-polygon utility
//   fetchOSMCemeteryBoundary — Overpass query for cemetery/estate polygon
//   renderLeafletMap       — instantiate Leaflet map with markers
//   loadAndDrawBoundary    — fetch + draw boundary polygon
//   drawBoundary, fitMapToBoundary — boundary drawing helpers
//   flyToGrave             — cemetery-map list click handler
//   tryShowNearbyCemeteries, fetchNearbyCemeteries, renderNearbyCemeteryList
//                          — Overpass-driven nearby-cemetery overlay
//
// Module state (let-bound at top level; readable as window.<name>):
//   leafletMap, mapMarkers          — Leaflet instance + grave markers
//   mapPreviousScreen, mapFocusStory — back-nav + single-cemetery focus
//   currentBoundaryLayer            — current OSM polygon overlay
//   nearbyCemeteryMarkers           — Overpass-result markers
//
// External dependencies (loaded via earlier <script> tags or inline state):
//   Leaflet (L)                       — third-party CDN, must load first
//   Turf.js (turf)                    — third-party CDN, must load first
//   groupGravesByCemetery, getDistanceMeters — map-utils.js
//   forwardGeocode                    — api-nominatim.js (resolves text → coords)
//   graveCacheKey, writeGraveCache    — grave-cache.js
//   persistUpdate                     — persistence.js
//   renderResult                      — render-result.js
//   showScreen                        — inline (with camera-reset override)
//   showToast                         — optional, guarded by typeof check
//   viewStoryFromMap                  — inline (in global-map block)
//   currentUser, currentStory, savedStories — inline state vars
//
// External callers (must resolve to window.<name> at call time):
//   openCemeteryMap   — HTML onclick (home button, result button), inline
//   leaveCemeteryMap  — HTML onclick (cemetery-map back button)
//   constrainToCemetery, fetchOSMCemeteryBoundary — inline startAnalysis
//                                                    (GPS pin pipeline)
//


// ─── A_handleMarkerDragEnd (originally lines 1012–1076 of index.html — drag-to-correct) ───────────────────

// ── DRAG-TO-CORRECT GRAVE LOCATION ───────────────────────────────
async function handleMarkerDragEnd(marker, story) {
  const newPos = marker.getLatLng();
  let newLat = +newPos.lat.toFixed(6);
  let newLng = +newPos.lng.toFixed(6);

  // Hard boundary on drags: a corrected pin must stay INSIDE the cemetery
  // polygon (zero tolerance — refine within, never drag onto a neighbour's lawn).
  // Fetch the boundary fresh for the drop point so the constraint is reliable
  // regardless of which boundary (if any) is currently drawn.
  try {
    const boundary = await fetchOSMCemeteryBoundary(newLat, newLng, false);
    if (boundary) {
      const c = constrainToCemetery({ lat: newLat, lng: newLng }, boundary, 0);
      if (c.snapped || c.snapped_to_centroid) {
        newLat = +c.lat.toFixed(6);
        newLng = +c.lng.toFixed(6);
        marker.setLatLng([newLat, newLng]);
        if (typeof showToast === 'function') {
          showToast('Pin must stay within the cemetery boundary');
        } else {
          console.log('📍 Drag constrained back inside cemetery boundary');
        }
      }
    }
  } catch (e) {
    console.log('📍 Drag constraint boundary fetch failed — accepting drop as-is:', e);
  }

  const personLabel = story.name || 'this grave';
  const ok = confirm(`Save corrected location for ${personLabel}?\n\nNew coords: ${newLat}, ${newLng}\n\nThis will be remembered for next time.`);
  if (!ok) {
    // User cancelled — snap marker back to original
    marker.setLatLng([story.gps.lat, story.gps.lng]);
    return;
  }
  // 1. Update the story in savedStories
  const idx = savedStories.findIndex(s =>
    s.name === story.name && s.dates === story.dates && s.location === story.location
  );
  if (idx >= 0) {
    savedStories[idx].gps = { lat: newLat, lng: newLng };
    savedStories[idx].userCorrected = true;
    await persistUpdate(savedStories[idx]);
  }
  // 2. Write to the verified-grave cache with max score so it beats future Overpass results
  if (story.name && story.location) {
    const cemeteryNameForKey = story.location.split(',')[0].trim();
    const key = graveCacheKey(story.name, cemeteryNameForKey, story.dates);
    writeGraveCache(key, { lat: newLat, lng: newLng }, 'user-corrected', 999);
  }
  // 3. Update the marker's popup to show the corrected badge
  marker.setPopupContent(`
    <div style="font-family:'Playfair Display',serif;min-width:150px;max-width:300px;">
      <strong>${story.name || 'Unknown'}</strong><br>
      <em style="font-size:0.85rem;color:#666">${story.dates || ''}</em><br>
      <small style="color:#888">${story.location || ''}</small>
      <br><span style="font-size:0.75rem;color:#2a7a2a">✓ location corrected</span>
      ${buildPopupBio(story)}
    </div>
  `);
  marker.openPopup();
  console.log('📍 User-corrected coords saved for', story.name, '→', newLat, newLng);
}

// ─── B_cemetery_main (originally lines 1106–1595 of index.html — main cemetery screen) ───────────────────

// ── CEMETERY MAP ─────────────────────────────────────────────────


let leafletMap = null;

let mapMarkers = [];

// Open cemetery map screen
let mapPreviousScreen = 'home';
let mapFocusStory = null;

// Build the expandable bio section for map popups
function buildPopupBio(story) {
  if (!story.biography) return '';
  const paragraphs = story.biography.split('\n\n').filter(p => p.trim()).slice(0, 2);
  if (paragraphs.length === 0) return '';
  const bioHtml = paragraphs.map(p => `<p style="margin:0.4rem 0;font-size:0.85rem;line-height:1.4;color:#333;">${p}</p>`).join('');
  const bioId = 'bio-' + (story.timestamp || Math.random().toString(36).slice(2));
  const savedIndex = story.timestamp ? savedStories.findIndex(s => s.timestamp === story.timestamp) : -1;
  const goToBioOnclick = savedIndex >= 0
    ? `viewStoryFromMap(${savedIndex})`
    : `currentStory = ${JSON.stringify(story).replace(/"/g, '&quot;')}; renderResult(currentStory); showScreen('result');`;
  return `
    <div style="margin-top:0.5rem;display:flex;gap:0.4rem;flex-wrap:wrap;">
      <button onclick="(function(b){var c=document.getElementById('${bioId}');if(c.style.display==='none'){c.style.display='block';b.textContent='▲ Hide bio';}else{c.style.display='none';b.textContent='▼ Read bio';}})(this)"
        style="background:none;border:1px solid rgba(201,168,76,0.5);color:#8a6f3a;font-family:'Crimson Pro',serif;font-size:0.8rem;padding:0.25rem 0.6rem;cursor:pointer;border-radius:3px;">
        ▼ Read bio
      </button>
      <button onclick="${goToBioOnclick}"
        style="background:rgba(201,168,76,0.15);border:1px solid rgba(201,168,76,0.5);color:#8a6f3a;font-family:'Crimson Pro',serif;font-size:0.8rem;padding:0.25rem 0.6rem;cursor:pointer;border-radius:3px;">
        → Go to bio
      </button>
    </div>
    <div id="${bioId}" style="display:none;margin-top:0.4rem;width:260px;height:160px;overflow-y:auto;overflow-x:hidden;padding:0.3rem 0.5rem;border:1px solid rgba(201,168,76,0.3);background:rgba(250,245,235,0.6);border-radius:3px;">${bioHtml}</div>
  `;
}

function leaveCemeteryMap() {
  // Clear persisted focus so a later open-from-home doesn't accidentally
  // rehydrate the old single-cemetery view on reload.
  try { localStorage.removeItem('gs_map_focus'); } catch {}
  mapFocusStory = null;
  showScreen(mapPreviousScreen || 'home');
}

function openCemeteryMap(focusStory = null) {
  const activeScreen = document.querySelector('.screen.active');
  mapPreviousScreen = activeScreen ? activeScreen.id : 'home';
  mapFocusStory = focusStory;
  // Persist focus state so a reload on #cemetery-map-screen rehydrates the
  // single-cemetery view instead of falling back to the global map.
  try {
    if (focusStory) {
      const { image, _pendingImageBase64, ...persistable } = focusStory;
      localStorage.setItem('gs_map_focus', JSON.stringify(persistable));
    } else {
      localStorage.removeItem('gs_map_focus');
    }
  } catch (e) {
    console.warn('Could not persist map focus for reload:', e);
  }
  showScreen('cemetery-map-screen');
  // Give the screen time to fully paint before Leaflet calculates dimensions
  setTimeout(async () => {
    await initCemeteryMap();
    // Force Leaflet to recalculate size after tiles render
    if (leafletMap) {
      setTimeout(() => leafletMap.invalidateSize(), 200);
    }
    // After everything's laid out, fly to the focused grave if there is one.
    if (mapFocusStory && leafletMap) {
      const focusName = mapFocusStory.name;
      const focusTimestamp = mapFocusStory.timestamp;
      console.log('🎯 Map focus requested for:', focusName, '(timestamp', focusTimestamp + ')');

      // Strategy: wait for the map to settle (no zoom/pan for 600ms), THEN find
      // the marker matching the focus story by identity and fly to it.
      // We can't rely on mapFocusStory.gps because geocoded coords are only
      // attached to the map's working copy of the stories, not the bio's currentStory.
      let settleTimer = null;
      let hasFlown = false;
      const scheduleFly = () => {
        if (hasFlown) return;
        clearTimeout(settleTimer);
        settleTimer = setTimeout(() => {
          if (hasFlown) return;
          const target = mapMarkers.find(m =>
            m.options.story && (
              (focusTimestamp && m.options.story.timestamp === focusTimestamp) ||
              (focusName && m.options.story.name === focusName)
            )
          );
          if (!target) {
            console.log('🎯 No marker found for', focusName, '— may still be geocoding');
            return;
          }
          hasFlown = true;
          leafletMap.off('moveend', scheduleFly);
          leafletMap.off('zoomend', scheduleFly);
          const pos = target.getLatLng();
          console.log('🎯 Map settled — flying to marker at', pos.lat, pos.lng);
          leafletMap.flyTo([pos.lat, pos.lng], 19, { duration: 1.2 });
          setTimeout(() => target.openPopup(), 1300);
        }, 600);
      };
      leafletMap.on('moveend', scheduleFly);
      leafletMap.on('zoomend', scheduleFly);
      scheduleFly();
    }
  }, 150);
}

// Initialize or refresh the Leaflet map
async function initCemeteryMap() {
  // Also include current unsaved story
  let allStories = [...savedStories];
  if (currentStory && !savedStories.find(s => s.timestamp === currentStory.timestamp)) {
    allStories.unshift(currentStory);
  }

  // If opened with a focus story (from a bio page), narrow to that cemetery only.
  // Filter by matching location string — stories at the same cemetery share it.
  if (mapFocusStory && mapFocusStory.location) {
    const focusLocation = mapFocusStory.location.trim().toLowerCase();
    allStories = allStories.filter(s =>
      s.location && s.location.trim().toLowerCase() === focusLocation
    );
    // Safety net: if the filter accidentally removed the focus story (e.g. case mismatch
    // or whitespace difference), put it back so we have at least one grave to show.
    if (!allStories.find(s => s.timestamp === mapFocusStory.timestamp)) {
      allStories.unshift(mapFocusStory);
    }
    console.log('🎯 Focus mode — narrowed to', allStories.length, 'grave(s) at', mapFocusStory.location);
  }

  // Stories with real GPS coords
  let mapped = allStories.filter(s => s.gps);

  // Stories with only text location — geocode them to get coords
  const textOnly = allStories.filter(s => !s.gps && s.location);
  if (textOnly.length > 0) {
    document.getElementById('map-cemetery-name').textContent = '📍 Locating…';
    for (const story of textOnly) {
      const coords = await forwardGeocode(story.location, story.name, story.dates);
      if (coords) {
        // Write coords back to the canonical saved story so they persist
        story.gps = { lat: coords.lat, lng: coords.lng };
        story._isCemetery = coords.isCemetery === true;
        story._lowConfidence = coords.lowConfidence === true;
        // Persist to localStorage + cloud so the global map can use them
        await persistUpdate(story);
        mapped.push({ ...story, _isCemetery: story._isCemetery, _lowConfidence: story._lowConfidence });
      }
    }
  }

  if (mapped.length === 0) {
    document.getElementById('map-cemetery-name').textContent = '📍 No location data yet';
    document.getElementById('map-grave-count').textContent = 'Scan gravestones on-site to build your map';
    renderLeafletMap(39.5, -98.35, 4, []);
    tryShowNearbyCemeteries(null);
    return;
  }

  // Group into cemeteries
  const cemeteries = groupGravesByCemetery(mapped);
  const largest = cemeteries.sort((a,b) => b.graves.length - a.graves.length)[0];

  // Update footer
  const locationName = largest.graves[0].location || 'Unknown Location';
  document.getElementById('map-cemetery-name').textContent = '📍 ' + locationName;
  document.getElementById('map-grave-count').textContent =
    mapped.length + ' grave' + (mapped.length !== 1 ? 's' : '') + ' mapped across ' +
    cemeteries.length + ' location' + (cemeteries.length !== 1 ? 's' : '');

  // Render graves list — with fly-to and view story buttons
  const list = document.getElementById('map-graves-list');
  list.innerHTML = mapped.map((s) => {
    // Find index in savedStories so we can navigate to it
    const savedIdx = savedStories.findIndex(saved => saved.timestamp === s.timestamp);
    const viewBtn = savedIdx >= 0
      ? `<button onclick="viewStoryFromMap(${savedIdx})" title="Read story"
           style="background:none;border:1px solid rgba(201,168,76,0.4);color:var(--gold);font-size:0.72rem;padding:0.2rem 0.5rem;cursor:pointer;border-radius:3px;white-space:nowrap;font-family:'Crimson Pro',serif;">
           📖 Story
         </button>`
      : '';
    return `
      <div class="map-grave-item" style="display:flex;align-items:center;gap:0.5rem;">
        <div style="flex:1;min-width:0;cursor:pointer;" onclick="flyToGrave(${s.gps.lat}, ${s.gps.lng})">
          <div class="map-grave-item-name">${s.name || 'Unknown'}</div>
          <div class="map-grave-item-dates">${s.dates || ''}</div>
        </div>
        ${viewBtn}
      </div>
    `;
  }).join('');

  renderLeafletMap(largest.centerLat, largest.centerLng, 18, mapped);

  // After map loads, fetch nearby cemeteries from OpenStreetMap
  tryShowNearbyCemeteries({ lat: largest.centerLat, lng: largest.centerLng });
}

// ── SNAP-TO-CEMETERY CONSTRAINT (Turf.js) ───────────────────────
// Converts the app's [[lat,lng],...] boundary format into a Turf polygon and
// constrains a point to it. Used ONLY at GPS-capture time and admin-drag time —
// never as a batch pass over existing stories (that would downgrade pins like
// Bruce Lee / George Washington whose Wikipedia-derived coords are MORE precise
// than "somewhere inside the polygon").
//
// Returns one of:
//   { lat, lng, snapped:false }                    — already inside, untouched
//   { lat, lng, snapped:true, original_distance }  — was near, nudged inward
//   { lat, lng, snapped_to_centroid:true, ... }    — was far, fell back to centroid
function constrainToCemetery(point, boundaryPts, toleranceMeters = 100) {
  // boundaryPts is [[lat,lng],...]; Turf wants [lng,lat] and a closed ring.
  if (!boundaryPts || boundaryPts.length < 3 || typeof turf === 'undefined') {
    return { lat: point.lat, lng: point.lng, snapped: false };
  }
  const ring = boundaryPts.map(p => [p[1], p[0]]);
  const first = ring[0], last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) ring.push([first[0], first[1]]);

  let polygon, turfPoint;
  try {
    polygon = turf.polygon([ring]);
    turfPoint = turf.point([point.lng, point.lat]);
  } catch (e) {
    console.log('constrainToCemetery: bad polygon, passing point through:', e);
    return { lat: point.lat, lng: point.lng, snapped: false };
  }

  if (turf.booleanPointInPolygon(turfPoint, polygon)) {
    return { lat: point.lat, lng: point.lng, snapped: false };
  }

  const polygonLine = turf.polygonToLine(polygon);
  const nearest = turf.nearestPointOnLine(polygonLine, turfPoint, { units: 'meters' });
  const distance = nearest.properties.dist;

  if (distance <= toleranceMeters) {
    // Nudge ~2m inward along the bearing toward the centroid so the pin sits
    // visibly inside the boundary line, not exactly on it.
    const centroid = turf.centroid(polygon);
    const bearing = turf.bearing(nearest, centroid);
    const inward = turf.destination(nearest, 2 / 1000, bearing, { units: 'kilometers' });
    return {
      lat: inward.geometry.coordinates[1],
      lng: inward.geometry.coordinates[0],
      snapped: true,
      original_distance: distance
    };
  }

  const centroid = turf.centroid(polygon);
  return {
    lat: centroid.geometry.coordinates[1],
    lng: centroid.geometry.coordinates[0],
    snapped_to_centroid: true,
    original_distance: distance
  };
}

// ── FETCH OSM CEMETERY OR ESTATE BOUNDARY POLYGON ───────────────
async function fetchOSMCemeteryBoundary(lat, lng, skipEstateFallback = false) {
  // Pass 1 — look for a cemetery boundary at/around this location.
  // Radius widened to 1000m because pinpoint grave coords sit well inside large cemeteries
  // (e.g. Lake View Cemetery in Seattle is ~600m across; 200m would miss the boundary).
  const cemeteryQuery = `
    [out:json][timeout:15];
    (
      way[landuse=cemetery](around:1000,${lat},${lng});
      way[amenity=grave_yard](around:1000,${lat},${lng});
      relation[landuse=cemetery](around:1000,${lat},${lng});
      relation[amenity=grave_yard](around:1000,${lat},${lng});
    );
    out geom;
  `;
  try {
    const res = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: 'data=' + encodeURIComponent(cemeteryQuery)
    });
    if (!res.ok) throw new Error('Overpass HTTP ' + res.status);
    const data = await res.json();

    // Build candidates from both ways (el.geometry) and relations (el.members[].geometry).
    // Overpass `out geom` puts geometry on the element for ways but inside members for
    // relations — large cemeteries like Inglewood Park Cemetery are mapped as relations,
    // so skipping them caused a tiny sub-way to be drawn as the boundary instead.
    const candidates = [];
    for (const el of (data.elements || [])) {
      if (el.geometry && el.geometry.length > 2) {
        candidates.push({ pts: el.geometry.map(pt => [pt.lat, pt.lon]), isRelation: false });
      } else if (el.type === 'relation' && el.members) {
        const outerPts = el.members
          .filter(m => m.role === 'outer' && m.geometry?.length)
          .flatMap(m => m.geometry.map(pt => [pt.lat, pt.lon]));
        if (outerPts.length > 2) candidates.push({ pts: outerPts, isRelation: true });
      }
    }

    if (candidates.length > 0) {
      const scored = candidates.map(({ pts, isRelation }) => {
        const lats = pts.map(p => p[0]);
        const lngs = pts.map(p => p[1]);
        const area = (Math.max(...lats) - Math.min(...lats)) * (Math.max(...lngs) - Math.min(...lngs));
        const containsGrave = lat >= Math.min(...lats) && lat <= Math.max(...lats) &&
                              lng >= Math.min(...lngs) && lng <= Math.max(...lngs);
        return { pts, area, containsGrave, isRelation };
      });
      const containing = scored.filter(s => s.containsGrave);
      const pool = containing.length > 0 ? containing : scored;
      // Relations are the full cemetery outline; prefer them over tiny sub-ways,
      // then pick smallest within each type to avoid huge district polygons.
      pool.sort((a, b) => {
        if (a.isRelation !== b.isRelation) return a.isRelation ? -1 : 1;
        return a.area - b.area;
      });
      return pool[0].pts;
    }
  } catch(e) {
    console.log('OSM cemetery boundary fetch failed:', e);
  }

  // Pass 2 — estate / historic site fallback.
  // Only run when we DON'T already know this is a cemetery. Otherwise an Overpass timeout
  // in Pass 1 would wrongly fall through and grab an adjacent park/grass polygon.
  if (skipEstateFallback) {
    console.log('📐 Skipping estate fallback — location is a known cemetery');
    return null;
  }

  const estateQuery = `
    [out:json][timeout:15];
    (
      way[historic=estate](around:500,${lat},${lng});
      way[historic=manor](around:500,${lat},${lng});
      way[historic=farm](around:500,${lat},${lng});
      way[boundary=historic](around:500,${lat},${lng});
      way[tourism=attraction][boundary](around:500,${lat},${lng});
      way[leisure=park][name](around:500,${lat},${lng});
      way[landuse=grass][name](around:500,${lat},${lng});
      relation[historic=estate](around:500,${lat},${lng});
      relation[boundary=historic](around:500,${lat},${lng});
      relation[tourism=attraction](around:500,${lat},${lng});
      relation[leisure=park](around:500,${lat},${lng});
    );
    out geom;
  `;
  try {
    const res2 = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: 'data=' + encodeURIComponent(estateQuery)
    });
    if (!res2.ok) throw new Error('Overpass HTTP ' + res2.status);
    const data2 = await res2.json();
    if (!data2.elements || data2.elements.length === 0) return null;

    // Pick the smallest enclosing polygon — avoids huge park boundaries swallowing the grave
    const candidates = data2.elements.filter(el => el.geometry && el.geometry.length > 2);
    if (candidates.length === 0) return null;

    // Score by how well the polygon contains the grave point and how compact it is
    const scored = candidates.map(el => {
      const pts = el.geometry.map(pt => [pt.lat, pt.lon]);
      const lats = pts.map(p => p[0]);
      const lngs = pts.map(p => p[1]);
      const area = (Math.max(...lats) - Math.min(...lats)) * (Math.max(...lngs) - Math.min(...lngs));
      const containsGrave = lat >= Math.min(...lats) && lat <= Math.max(...lats) &&
                            lng >= Math.min(...lngs) && lng <= Math.max(...lngs);
      return { el, pts, area, containsGrave };
    });

    // Prefer polygons that actually contain the grave point, then smallest area
    const containing = scored.filter(s => s.containsGrave);
    const pool = containing.length > 0 ? containing : scored;
    pool.sort((a, b) => a.area - b.area);

    return pool[0].pts;
  } catch(e) {
    console.log('OSM estate boundary fetch failed:', e);
    return null;
  }
}

// ── RENDER MAP WITH BOUNDARY ─────────────────────────────────────
async function renderLeafletMap(centerLat, centerLng, zoom, graves) {
  // Destroy existing map if present
  if (leafletMap) {
    leafletMap.remove();
    leafletMap = null;
    mapMarkers = [];
  }

  leafletMap = L.map('leaflet-map').setView([centerLat, centerLng], zoom);

  // OpenStreetMap tiles — free, no API key
  // Performance tuning:
  // - subdomains a/b/c lets the browser fetch tiles in parallel from 3 hosts instead of 1
  // - keepBuffer:4 keeps adjacent off-screen tiles cached in DOM so pan/zoom doesn't refetch
  // - updateWhenZooming:false defers tile rendering until zoom animation completes (no flicker)
  // - updateWhenIdle:true batches updates for smoother feel
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors',
    maxZoom: 19,
    subdomains: 'abc',
    keepBuffer: 4,
    updateWhenZooming: false,
    updateWhenIdle: true,
    crossOrigin: true
  }).addTo(leafletMap);

  // Custom grave marker icon — generator function so low-confidence pins can show a "?" badge
  const makeGraveIcon = (lowConfidence) => L.divIcon({
    html: `<div style="filter:drop-shadow(0 1px 2px rgba(0,0,0,0.6));line-height:0;position:relative;"><svg viewBox="0 0 100 100" fill="none" stroke-width="2" xmlns="http://www.w3.org/2000/svg" style="width:32px;height:32px;display:block;"><defs><linearGradient id="pinGrad${'$'}{Math.random().toString(36).slice(2,8)}" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" stop-color="#f0dca8"/><stop offset="100%" stop-color="#8a6f3a"/></linearGradient></defs><rect x="22" y="84" width="56" height="6" stroke="#c9a84c" fill="rgba(20,15,8,0.85)"/><path d="M30 84 L30 35 Q30 18 50 18 Q70 18 70 35 L70 84 Z" stroke="#c9a84c" fill="rgba(20,15,8,0.85)"/><path d="M38 40 L38 56 Q44 54 49 56 L49 42 Q44 40 38 40 Z" stroke="#e8d4a0" stroke-width="2" fill="rgba(232,212,160,0.25)"/><path d="M51 42 Q56 40 62 40 L62 56 Q56 54 51 56 Z" stroke="#e8d4a0" stroke-width="2" fill="rgba(232,212,160,0.25)"/><line x1="50" y1="41" x2="50" y2="56" stroke="#e8d4a0" stroke-width="1.5"/><line x1="50" y1="63" x2="50" y2="76" stroke="#e8d4a0" stroke-width="1.5"/><line x1="44" y1="68" x2="56" y2="68" stroke="#e8d4a0" stroke-width="1.5"/></svg>${lowConfidence ? '<div style="position:absolute;top:-4px;right:-6px;width:14px;height:14px;border-radius:50%;background:rgba(60,40,20,0.95);border:1px solid #c9a84c;color:#e8d4a0;font-family:serif;font-size:10px;font-weight:bold;line-height:12px;text-align:center;">?</div>' : ''}</div>`,
    className: '',
    iconSize: [24, 24],
    iconAnchor: [12, 24],
    popupAnchor: [0, -24]
  });

  // Add a marker for each grave. Drag-to-correct is open to any signed-in
  // user now that GPS pins are hard-constrained to the cemetery polygon
  // (handleMarkerDragEnd enforces the boundary on every drop, so a user
  // can refine within the polygon but can't drag onto a neighbour's lawn).
  // Global-map markers stay non-draggable — users never edit others' pins.
  const canDrag = !!currentUser;
  graves.forEach(story => {
    const marker = L.marker([story.gps.lat, story.gps.lng], { icon: makeGraveIcon(story._lowConfidence), draggable: canDrag, story: story })
      .addTo(leafletMap)
      .bindPopup(`
        <div style="font-family:'Playfair Display',serif;min-width:150px;max-width:300px;">
          <strong>${story.name || 'Unknown'}</strong><br>
          <em style="font-size:0.85rem;color:#666">${story.dates || ''}</em><br>
          <small style="color:#888">${story.location || ''}</small>
          ${story.userCorrected ? '<br><span style="font-size:0.75rem;color:#2a7a2a">✓ location corrected</span>' : ''}
          ${story._lowConfidence && !story.userCorrected ? '<br><span style="font-size:0.75rem;color:#a87a2a">⚠ approximate — state may not match</span>' : ''}
          ${canDrag ? '<br><small style="color:#aaa;font-size:0.7rem;font-style:italic">Drag pin to correct location</small>' : ''}
          ${buildPopupBio(story)}
        </div>
      `, { maxWidth: 320 });
    // Personal map only ever holds the signed-in user's own stories
    // (syncOnSignIn/syncDelta fetch with .eq('user_id', currentUser.id)),
    // so "owns this story" is guaranteed by what data reaches this screen,
    // not by a per-marker check. Drag is hard-constrained to the cemetery
    // polygon inside handleMarkerDragEnd, so opening it to all signed-in
    // users is safe. Global-map markers remain non-draggable elsewhere.
    if (canDrag) marker.on('dragend', () => handleMarkerDragEnd(marker, story));
    mapMarkers.push(marker);
  });

  // Try to show a boundary for this cemetery location
  if (graves.length > 0) {
    // If any grave was confirmed as cemetery by the geocoder, skip estate fallback.
    // For camera-GPS stories (no geocoder call), assume unknown and allow estate search.
    const knownCemetery = graves.some(g => g._isCemetery === true);
    await loadAndDrawBoundary(centerLat, centerLng, knownCemetery);
  }

  // If multiple graves with no boundary yet, fit to grave markers
  if (graves.length > 1) {
    const group = L.featureGroup(mapMarkers);
    const bounds = group.getBounds().pad(0.2);
    leafletMap.fitBounds(bounds);
  }
}

let currentBoundaryLayer = null;

async function loadAndDrawBoundary(lat, lng, knownCemetery = false) {
  // Try OSM boundary (skipEstateFallback=true when we already know it's a cemetery)
  const osmBoundary = await fetchOSMCemeteryBoundary(lat, lng, knownCemetery);
  if (osmBoundary) {
    drawBoundary(osmBoundary, 'osm');
    fitMapToBoundary(osmBoundary);
    return;
  }

  // No OSM boundary — just tight zoom on the cemetery location
  leafletMap.setView([lat, lng], 18);
}

function drawBoundary(points, type) {
  if (currentBoundaryLayer) {
    leafletMap.removeLayer(currentBoundaryLayer);
    currentBoundaryLayer = null;
  }
  // dark gold for OSM-sourced, bright yellow for user-drawn
  const color = type === 'user' ? '#ffee00' : '#a07830';
  const weight = type === 'user' ? 2.5 : 2;
  currentBoundaryLayer = L.polygon(points, {
    color: color,
    weight: weight,
    fillColor: color,
    fillOpacity: 0.06,
    dashArray: type === 'user' ? '6,4' : null
  }).addTo(leafletMap);
}

function fitMapToBoundary(points) {
  if (!leafletMap || !points || points.length === 0) return;
  const bounds = L.latLngBounds(points);
  leafletMap.fitBounds(bounds, { padding: [20, 20] });
}

// Navigate from map to a saved story
// ─── C_flyToGrave (originally lines 1798–1810 of index.html — flyToGrave helper) ───────────────────


// Fly to a specific grave when clicked in the list
function flyToGrave(lat, lng) {
  if (!leafletMap) return;
  leafletMap.flyTo([lat, lng], 20, { duration: 1.5 });
  // Open popup for this marker
  mapMarkers.forEach(m => {
    const pos = m.getLatLng();
    if (Math.abs(pos.lat - lat) < 0.0001 && Math.abs(pos.lng - lng) < 0.0001) {
      m.openPopup();
    }
  });
}
// ─── D_nearby_cemeteries (originally lines 1819–1995 of index.html — nearby-cemetery overlay) ───────────────────


// ── NEARBY CEMETERIES (OpenStreetMap Overpass API) ───────────────

let nearbyCemeteryMarkers = [];

async function tryShowNearbyCemeteries(coords) {
  // If no coords provided, try device location
  if (!coords) {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        pos => fetchNearbyCemeteries(pos.coords.latitude, pos.coords.longitude),
        () => console.log('📍 No location for nearby cemetery search')
      );
    }
    return;
  }
  fetchNearbyCemeteries(coords.lat, coords.lng);
}

async function fetchNearbyCemeteries(lat, lng) {
  if (!leafletMap) return;

  // Show loading indicator on map
  const loadingDiv = document.getElementById('nearby-loading');
  if (loadingDiv) loadingDiv.style.display = 'block';

  try {
    // Overpass API query — find all cemeteries within 10km
    // Includes active, historic, and abandoned cemeteries
    const radius = 10000; // 10km
    const query = `
      [out:json][timeout:15];
      (
        way[landuse=cemetery](around:${radius},${lat},${lng});
        way[amenity=grave_yard](around:${radius},${lat},${lng});
        node[historic=cemetery](around:${radius},${lat},${lng});
        way[landuse=cemetery][historic](around:${radius},${lat},${lng});
        node["abandoned:landuse"=cemetery](around:${radius},${lat},${lng});
        way["abandoned:landuse"=cemetery](around:${radius},${lat},${lng});
      );
      out center tags;
    `;

    const res = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: 'data=' + encodeURIComponent(query)
    });
    if (!res.ok) throw new Error('Overpass HTTP ' + res.status);

    const data = await res.json();
    if (!data.elements || data.elements.length === 0) {
      console.log('No nearby cemeteries found in OSM');
      return;
    }

    console.log(`Found ${data.elements.length} nearby cemeteries in OSM`);

    // Remove old nearby markers
    nearbyCemeteryMarkers.forEach(m => leafletMap.removeLayer(m));
    nearbyCemeteryMarkers = [];

    // Cemetery icon - different from grave marker
    const cemIcon = L.divIcon({
      html: `<div style="
        background: rgba(74,92,62,0.9);
        border: 2px solid rgba(201,168,76,0.8);
        border-radius: 50%;
        width: 28px;
        height: 28px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 0.85rem;
        box-shadow: 0 2px 4px rgba(0,0,0,0.4);
      ">⛪</div>`,
      className: '',
      iconSize: [28, 28],
      iconAnchor: [14, 14],
      popupAnchor: [0, -14]
    });

    const historicCemIcon = L.divIcon({
      html: `<div style="
        background: rgba(139,58,42,0.9);
        border: 2px solid rgba(201,168,76,0.8);
        border-radius: 50%;
        width: 28px;
        height: 28px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 0.85rem;
        box-shadow: 0 2px 4px rgba(0,0,0,0.4);
      ">🏛️</div>`,
      className: '',
      iconSize: [28, 28],
      iconAnchor: [14, 14],
      popupAnchor: [0, -14]
    });

    data.elements.forEach(el => {
      const elLat = el.lat || el.center?.lat;
      const elLng = el.lon || el.center?.lon;
      if (!elLat || !elLng) return;

      const name = el.tags?.name || 'Unnamed Cemetery';
      const isHistoric = el.tags?.historic || el.tags?.['abandoned:landuse'];
      const religion = el.tags?.religion || '';
      const denomination = el.tags?.denomination || '';
      const icon = isHistoric ? historicCemIcon : cemIcon;
      const badge = isHistoric ? '🏛️ Historic' : '⛪ Cemetery';
      const dist = (getDistanceMeters(lat, lng, elLat, elLng) / 1000).toFixed(1);

      const marker = L.marker([elLat, elLng], { icon })
        .addTo(leafletMap)
        .bindPopup(`
          <div style="font-family:'Playfair Display',serif;min-width:160px;">
            <div style="font-size:0.75rem;color:#888;margin-bottom:0.25rem;">${badge}</div>
            <strong>${name}</strong><br>
            ${religion ? `<small style="color:#666">${denomination || religion}</small><br>` : ''}
            <small style="color:#888">${dist}km away</small><br>
            <small style="color:var(--moss,#4a5c3e);cursor:pointer;text-decoration:underline"
              onclick="window.open('https://www.openstreetmap.org/?mlat=${elLat}&mlon=${elLng}&zoom=17','_blank')">
              View on OSM ↗
            </small>
          </div>
        `);

      nearbyCemeteryMarkers.push(marker);
    });

    // Update count in footer
    const countEl = document.getElementById('map-grave-count');
    if (countEl) {
      const existing = countEl.textContent;
      countEl.textContent = existing + ' · ' + data.elements.length + ' cemeteries found nearby';
    }

    // Update nearby section
    renderNearbyCemeteryList(data.elements, lat, lng);

  } catch(e) {
    console.log('OSM nearby fetch failed:', e);
  } finally {
    if (loadingDiv) loadingDiv.style.display = 'none';
  }
}

function renderNearbyCemeteryList(elements, userLat, userLng) {
  const list = document.getElementById('nearby-cemetery-list');
  if (!list) return;

  const sorted = elements
    .filter(el => el.lat || el.center?.lat)
    .map(el => ({
      name: el.tags?.name || 'Unnamed Cemetery',
      lat: el.lat || el.center?.lat,
      lng: el.lon || el.center?.lon,
      historic: el.tags?.historic || el.tags?.['abandoned:landuse'],
      dist: getDistanceMeters(userLat, userLng, el.lat || el.center?.lat, el.lon || el.center?.lon)
    }))
    .sort((a, b) => a.dist - b.dist)
    .slice(0, 8);

  list.innerHTML = sorted.map(c => `
    <div class="map-grave-item" onclick="flyToGrave(${c.lat}, ${c.lng})" 
         style="border-left-color: ${c.historic ? '#8b3a2a' : '#4a5c3e'}">
      <div class="map-grave-item-name">
        ${c.historic ? '🏛️ ' : '⛪ '}${c.name}
      </div>
      <div class="map-grave-item-dates">${(c.dist/1000).toFixed(1)}km away${c.historic ? ' · Historic' : ''}</div>
    </div>
  `).join('');

  // Show the nearby section
  const section = document.getElementById('nearby-section');
  if (section) section.style.display = 'block';
}
