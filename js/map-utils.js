// js/map-utils.js
// ─────────────────────────────────────────────────────────────────
// Pure helpers for cemetery/grave map computations. No Leaflet.
//
// Exports (auto-attached to window because these are top-level function
// declarations in a classic external script):
//
//   groupGravesByCemetery(stories)
//       Cluster stories by GPS proximity (~500m radius). Returns an
//       array of { id, centerLat, centerLng, graves } objects. Uses
//       getDistanceMeters internally.
//
//   getDistanceMeters(lat1, lng1, lat2, lng2)
//       Haversine distance in meters between two GPS points. Pure math.
//
// Globals read: none.
// Globals written: none.
// External calls: none. (No Leaflet, no DOM, no network.)
//
// Callers in index.html (post-Stage 10a), 3 sites total:
//   - initCemeteryMap()            -> groupGravesByCemetery (1 site)
//   - fetchNearbyCemeteries()      -> getDistanceMeters (distance label)
//   - renderNearbyCemeteryList()   -> getDistanceMeters (sort key)
// ─────────────────────────────────────────────────────────────────

// Group graves into cemeteries by proximity (within ~500 meters)
function groupGravesByCemetery(stories) {
  const cemeteries = [];
  const storiesWithGPS = stories.filter(s => s.gps);

  storiesWithGPS.forEach(story => {
    let added = false;
    for (const cem of cemeteries) {
      const dist = getDistanceMeters(
        story.gps.lat, story.gps.lng,
        cem.centerLat, cem.centerLng
      );
      if (dist < 500) {
        cem.graves.push(story);
        // Recalculate center
        cem.centerLat = cem.graves.reduce((s,g) => s + g.gps.lat, 0) / cem.graves.length;
        cem.centerLng = cem.graves.reduce((s,g) => s + g.gps.lng, 0) / cem.graves.length;
        added = true;
        break;
      }
    }
    if (!added) {
      cemeteries.push({
        id: Date.now() + Math.random(),
        centerLat: story.gps.lat,
        centerLng: story.gps.lng,
        graves: [story]
      });
    }
  });
  return cemeteries;
}

// Haversine distance in meters between two GPS points
function getDistanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI/180) * Math.cos(lat2 * Math.PI/180) *
    Math.sin(dLng/2) * Math.sin(dLng/2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

