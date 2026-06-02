import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet,
  ActivityIndicator, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import MapView, { Marker, Callout, Polygon } from 'react-native-maps';
import { loadStories, saveStories } from '../lib/storage';
import { cloudUpdateStory } from '../lib/sync';
import { supabase } from '../lib/supabase';
import { forwardGeocode } from '../lib/api-nominatim';
import { colors, fonts, radius } from '../lib/theme';

const GOLD      = colors.flame;
const INK       = colors.ink;
const PARCHMENT = colors.parchment;
const STONE     = colors.ash;

// ── BOUNDARY HELPERS ─────────────────────────────────────────────

function stitchOuterRing(ways) {
  if (ways.length === 0) return [];
  if (ways.length === 1) return ways[0];
  const EPS = 1e-6;
  const close = (a, b) => Math.abs(a[0] - b[0]) < EPS && Math.abs(a[1] - b[1]) < EPS;
  const remaining = ways.map(w => w.slice());
  const ring = remaining.shift();
  while (remaining.length > 0) {
    const tail = ring[ring.length - 1];
    let joined = false;
    for (let i = 0; i < remaining.length; i++) {
      const w = remaining[i];
      if (close(w[0], tail)) {
        ring.push(...w.slice(1)); remaining.splice(i, 1); joined = true; break;
      }
      if (close(w[w.length - 1], tail)) {
        ring.push(...w.slice(0, -1).reverse()); remaining.splice(i, 1); joined = true; break;
      }
    }
    if (!joined) { for (const w of remaining) ring.push(...w); break; }
  }
  return ring;
}

async function fetchOSMCemeteryBoundary(lat, lng, cemeteryName = null) {
  const query = `
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
      body: 'data=' + encodeURIComponent(query),
    });
    if (!res.ok) return null;
    const data = await res.json();

    const nameKey = cemeteryName ? cemeteryName.toLowerCase() : null;
    const candidates = [];

    for (const el of (data.elements || [])) {
      const elName = (el.tags?.name || '').toLowerCase();
      const nameMatch = nameKey ? elName.includes(nameKey) : false;
      if (el.geometry && el.geometry.length > 2) {
        candidates.push({ pts: el.geometry.map(pt => [pt.lat, pt.lon]), isRelation: false, nameMatch });
      } else if (el.type === 'relation' && el.members) {
        try {
          const outerWays = el.members
            .filter(m => m.role === 'outer' && m.geometry?.length > 1)
            .map(m => m.geometry.map(pt => [pt.lat, pt.lon]));
          if (outerWays.length > 0) {
            const stitched = stitchOuterRing(outerWays);
            if (stitched.length > 2 && stitched.length <= 2000) {
              candidates.push({ pts: stitched, isRelation: true, nameMatch });
            }
          }
        } catch { /* skip bad relation */ }
      }
    }

    if (candidates.length === 0) return null;

    const scored = candidates.map(({ pts, isRelation, nameMatch }) => {
      const lats = pts.map(p => p[0]);
      const lngs = pts.map(p => p[1]);
      const area = (Math.max(...lats) - Math.min(...lats)) * (Math.max(...lngs) - Math.min(...lngs));
      const containsGrave = lat >= Math.min(...lats) && lat <= Math.max(...lats) &&
                            lng >= Math.min(...lngs) && lng <= Math.max(...lngs);
      return { pts, area, containsGrave, isRelation, nameMatch };
    });

    const containing = scored.filter(s => s.containsGrave);
    const pool = containing.length > 0 ? containing : scored;
    pool.sort((a, b) => {
      if (a.nameMatch !== b.nameMatch) return a.nameMatch ? -1 : 1;
      if (a.isRelation !== b.isRelation) return a.isRelation ? -1 : 1;
      return a.area - b.area;
    });

    // Convert [lat, lon] → react-native-maps {latitude, longitude}
    return pool[0].pts.map(([latitude, longitude]) => ({ latitude, longitude }));
  } catch {
    return null;
  }
}

// Geographic center of the contiguous US — used before any graves are located
const DEFAULT_REGION = {
  latitude: 39.5,
  longitude: -98.35,
  latitudeDelta: 30,
  longitudeDelta: 50,
};

export default function CemeteryMapScreen({ navigation, route }) {
  const { focusStory = null } = route.params || {};

  const mapRef = useRef(null);
  const [mappedStories, setMappedStories] = useState([]);
  const [geocoding, setGeocoding] = useState(true);
  const [boundaryCoords, setBoundaryCoords] = useState([]);

  useEffect(() => {
    resolveStories();
  }, []);

  async function resolveStories() {
    setGeocoding(true);

    let stories = await loadStories();

    // When opened from a story result, narrow to the same cemetery
    if (focusStory?.location) {
      const focusLoc = focusStory.location.trim().toLowerCase();
      stories = stories.filter(s => s.location?.trim().toLowerCase() === focusLoc);
      // Safety net: ensure the focus story is always present
      if (!stories.find(s => s.timestamp === focusStory.timestamp)) {
        stories = [focusStory, ...stories];
      }
    }

    // Geocode stories that have a location string but no GPS coords
    const resolved = [];
    for (const story of stories) {
      if (story.gps) {
        resolved.push(story);
      } else if (story.location) {
        const coords = await forwardGeocode(story.location);
        if (coords) {
          resolved.push({ ...story, gps: coords });
        }
      }
    }

    setMappedStories(resolved);
    setGeocoding(false);

    if (resolved.length === 0) return;

    // Fetch the cemetery boundary polygon from OSM
    const primaryStory = focusStory
      ? resolved.find(s => s.timestamp === focusStory.timestamp) || resolved[0]
      : resolved[0];
    if (primaryStory?.gps) {
      const cemeteryName = (primaryStory.location || '').split(',')[0].trim();
      fetchOSMCemeteryBoundary(primaryStory.gps.lat, primaryStory.gps.lng, cemeteryName)
        .then(coords => { if (coords) setBoundaryCoords(coords); })
        .catch(() => {});
    }

    // Animate map to the appropriate position after geocoding
    setTimeout(() => {
      if (!mapRef.current) return;
      const focusMapped = focusStory
        ? resolved.find(s => s.timestamp === focusStory.timestamp)
        : null;

      if (resolved.length === 1 || focusMapped) {
        const target = focusMapped || resolved[0];
        mapRef.current.animateToRegion(
          {
            latitude: target.gps.lat,
            longitude: target.gps.lng,
            latitudeDelta: 0.002,
            longitudeDelta: 0.002,
          },
          800
        );
      } else {
        mapRef.current.fitToCoordinates(
          resolved.map(s => ({ latitude: s.gps.lat, longitude: s.gps.lng })),
          { edgePadding: { top: 60, right: 40, bottom: 260, left: 40 }, animated: true }
        );
      }
    }, 300);
  }

  function flyToGrave(story) {
    mapRef.current?.animateToRegion(
      {
        latitude: story.gps.lat,
        longitude: story.gps.lng,
        latitudeDelta: 0.0006,
        longitudeDelta: 0.0006,
      },
      700
    );
  }

  async function handleDragEnd(story, coordinate) {
    const newGps = { lat: coordinate.latitude, lng: coordinate.longitude };
    Alert.alert(
      'Save corrected position?',
      `Move ${story.name || 'this grave'} to the dragged location?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Save',
          onPress: async () => {
            const updated = { ...story, gps: newGps, userCorrected: true };
            setMappedStories(prev =>
              prev.map(s => s.timestamp === story.timestamp ? updated : s)
            );
            const allStories = await loadStories();
            const idx = allStories.findIndex(s => s.timestamp === story.timestamp);
            if (idx >= 0) {
              allStories[idx] = { ...allStories[idx], gps: newGps, userCorrected: true };
              await saveStories(allStories);
            }
            const { data: { session } } = await supabase.auth.getSession();
            if (session?.user) {
              await cloudUpdateStory(updated, session.user);
            }
          },
        },
      ]
    );
  }

  const panelTitle = geocoding
    ? '📍 Locating graves…'
    : mappedStories.length === 0
      ? '📍 No location data yet'
      : `✦ ${mappedStories.length} grave${mappedStories.length !== 1 ? 's' : ''} mapped`;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backSide}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Cemetery Map</Text>
        <View style={styles.backSide} />
      </View>

      {/* Map */}
      <View style={styles.mapContainer}>
        <MapView
          ref={mapRef}
          style={styles.map}
          initialRegion={DEFAULT_REGION}
        >
          {boundaryCoords.length > 0 && (
            <Polygon
              coordinates={boundaryCoords}
              strokeColor="rgba(160,120,48,0.8)"
              fillColor="rgba(160,120,48,0.06)"
              strokeWidth={2}
            />
          )}

          {mappedStories.map((story, i) => (
            <Marker
              key={story.timestamp ?? i}
              coordinate={{ latitude: story.gps.lat, longitude: story.gps.lng }}
              draggable
              onDragEnd={e => handleDragEnd(story, e.nativeEvent.coordinate)}
            >
              {/* Custom dark-gothic marker */}
              <View style={styles.markerOuter}>
                <View style={[styles.markerInner, story._lowConfidence && styles.markerLowConf]}>
                  <Text style={styles.markerCross}>✝</Text>
                </View>
              </View>

              {/* Tap callout → navigate to story */}
              <Callout onPress={() => navigation.navigate('Result', { story })}>
                <View style={styles.callout}>
                  <Text style={styles.calloutName}>{story.name || 'Unknown'}</Text>
                  {!!story.dates && (
                    <Text style={styles.calloutDates}>{story.dates}</Text>
                  )}
                  {!!story.location && (
                    <Text style={styles.calloutLocation}>{story.location}</Text>
                  )}
                  {story._lowConfidence && (
                    <Text style={styles.calloutWarn}>⚠ approximate location</Text>
                  )}
                  <Text style={styles.calloutAction}>Tap to view story →</Text>
                </View>
              </Callout>
            </Marker>
          ))}
        </MapView>

        {geocoding && (
          <View style={styles.geocodingBadge}>
            <ActivityIndicator size="small" color={GOLD} style={{ marginRight: 8 }} />
            <Text style={styles.geocodingText}>Locating…</Text>
          </View>
        )}
      </View>

      {/* Bottom panel — scrollable grave list */}
      <View style={styles.panel}>
        <Text style={styles.panelTitle}>{panelTitle}</Text>
        <View style={styles.panelDivider} />
        <ScrollView style={styles.graveList} showsVerticalScrollIndicator={false}>
          {mappedStories.length === 0 && !geocoding ? (
            <Text style={styles.emptyText}>
              Scan gravestones on-site to build your map.{'\n'}
              Saved stories with location data will appear here.
            </Text>
          ) : (
            mappedStories.map((story, i) => (
              <View key={story.timestamp ?? i} style={styles.graveItem}>
                {/* Tap row → fly to marker on map */}
                <TouchableOpacity style={styles.graveItemMain} onPress={() => flyToGrave(story)}>
                  <Text style={styles.graveName} numberOfLines={1}>
                    {story.name || 'Unknown'}
                  </Text>
                  {!!story.dates && (
                    <Text style={styles.graveDates}>{story.dates}</Text>
                  )}
                </TouchableOpacity>
                {/* Story button → open result screen */}
                <TouchableOpacity
                  style={styles.storyBtn}
                  onPress={() => navigation.navigate('Result', { story })}
                >
                  <Text style={styles.storyBtnText}>Story →</Text>
                </TouchableOpacity>
              </View>
            ))
          )}
        </ScrollView>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: INK },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(201,168,76,0.15)',
  },
  backSide: { width: 80 },
  backText: { color: colors.ashDim, fontSize: 15, fontFamily: fonts.body },
  headerTitle: { color: PARCHMENT, fontSize: 16, fontFamily: fonts.name, letterSpacing: 0.3 },

  mapContainer: { flex: 1, position: 'relative' },
  map: { flex: 1 },

  geocodingBadge: {
    position: 'absolute', top: 12, right: 12,
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(20,16,11,0.9)',
    borderWidth: 1, borderColor: colors.line,
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.sm,
  },
  geocodingText: { color: PARCHMENT, fontSize: 12, fontFamily: fonts.body, letterSpacing: 0.5 },

  markerOuter: { alignItems: 'center' },
  markerInner: {
    backgroundColor: 'rgba(20,16,11,0.92)',
    borderWidth: 1.5, borderColor: GOLD,
    borderRadius: 4, paddingHorizontal: 7, paddingVertical: 4,
  },
  markerLowConf: { borderColor: colors.ember, opacity: 0.8 },
  markerCross: { color: GOLD, fontSize: 15 },

  callout: { minWidth: 160, maxWidth: 260, padding: 10 },
  calloutName: { fontWeight: '700', fontSize: 15, marginBottom: 2, color: '#1a1410' },
  calloutDates: { fontSize: 13, color: '#666', fontStyle: 'italic', marginBottom: 2 },
  calloutLocation: { fontSize: 12, color: '#888', marginBottom: 4 },
  calloutWarn: { fontSize: 11, color: '#a87a2a', marginBottom: 4 },
  calloutAction: { fontSize: 12, color: '#8a6f3a', fontWeight: '600' },

  panel: {
    height: 220, backgroundColor: colors.stone,
    borderTopWidth: 1, borderTopColor: colors.line,
    paddingHorizontal: 16, paddingTop: 14, paddingBottom: 8,
  },
  panelTitle: {
    color: colors.ashDim, fontSize: 10, letterSpacing: 3,
    textTransform: 'uppercase', fontFamily: fonts.body, marginBottom: 10,
  },
  panelDivider: { height: 1, backgroundColor: colors.line, marginBottom: 10 },
  graveList: { flex: 1 },

  graveItem: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: colors.line, gap: 8,
  },
  graveItemMain: { flex: 1 },
  graveName: { color: PARCHMENT, fontSize: 14, fontFamily: fonts.name },
  graveDates: { color: STONE, fontSize: 12, fontFamily: fonts.bodyItalic, marginTop: 1 },

  storyBtn: {
    borderWidth: 1, borderColor: colors.line,
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.sm,
  },
  storyBtnText: { color: GOLD, fontSize: 12, fontFamily: fonts.body },

  emptyText: {
    color: STONE, fontFamily: fonts.bodyItalic,
    textAlign: 'center', lineHeight: 22, marginTop: 8,
  },
});
