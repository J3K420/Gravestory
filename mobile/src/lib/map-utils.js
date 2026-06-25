// Haversine distance in meters between two GPS points
export function getDistanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Stories that all fell back to the same cemetery-center coordinate render as one
// stacked, untappable marker. Fan exact-overlap groups out in a small ring (~7 m per
// step) so every grave stays visible. Display-only: the saved gps is untouched, and
// drag-to-correct still persists wherever the user drops the pin.
//
// DETERMINISTIC per grave: within a coincident group the ring slot is assigned by a
// STABLE sort (grave_id, else id, else timestamp), NOT by array position — so the slot
// doesn't depend on feed order. NOTE this gives cross-screen agreement only when the
// SAME grave has the SAME coordinate AND the SAME coincidence-group MEMBERS on both
// screens. That holds for a grave THIS device corrected (both maps then see the same
// corrected coordinate). It does NOT fully hold for unconfirmed centroid clusters: the
// cemetery map's centroid comes from a live geocode and the global map's from each
// contributor's saved coordinate, which can differ past the 5th decimal and pull a pin
// into a different group. That cross-screen residual is display-only (~7 m) and is the
// tail of the original stacking problem, not a regression — the stable slot just stops
// the SAME feed from reshuffling pins between renders.
export function spreadOverlappingPins(stories) {
  const stableKey = s => String(s.grave_id ?? s.id ?? s.timestamp ?? '');
  // Bucket by ~1.1 m-coincident coordinate.
  const groups = {};
  for (const story of stories) {
    if (!story.gps) continue;
    const key = `${story.gps.lat.toFixed(5)},${story.gps.lng.toFixed(5)}`;
    (groups[key] = groups[key] || []).push(story);
  }
  // Within each group, sort by the stable key so slot N is the same story everywhere.
  const slotOf = new Map();
  for (const key of Object.keys(groups)) {
    const members = groups[key].slice().sort((a, b) => stableKey(a).localeCompare(stableKey(b)));
    members.forEach((s, n) => slotOf.set(s, n));
  }
  return stories.map(story => {
    if (!story.gps) return story;
    const n = slotOf.get(story) ?? 0;
    if (n === 0) return story;            // the anchor of its group stays put
    const angle = n * (Math.PI / 4);
    const ring = 0.00006 * Math.ceil(n / 8); // ~6.7 m of latitude per ring
    return {
      ...story,
      gps: { lat: story.gps.lat + ring * Math.cos(angle), lng: story.gps.lng + ring * Math.sin(angle) },
    };
  });
}

// Cluster stories by GPS proximity (~500 m radius)
export function groupGravesByCemetery(stories) {
  const cemeteries = [];
  for (const story of stories.filter(s => s.gps)) {
    let added = false;
    for (const cem of cemeteries) {
      if (getDistanceMeters(story.gps.lat, story.gps.lng, cem.centerLat, cem.centerLng) < 500) {
        cem.graves.push(story);
        cem.centerLat = cem.graves.reduce((s, g) => s + g.gps.lat, 0) / cem.graves.length;
        cem.centerLng = cem.graves.reduce((s, g) => s + g.gps.lng, 0) / cem.graves.length;
        added = true;
        break;
      }
    }
    if (!added) {
      cemeteries.push({
        id: Date.now() + Math.random(),
        centerLat: story.gps.lat,
        centerLng: story.gps.lng,
        graves: [story],
      });
    }
  }
  return cemeteries;
}
