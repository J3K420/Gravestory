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
