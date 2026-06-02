import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet,
  ActivityIndicator, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import MapView, { Marker, Callout } from 'react-native-maps';
import { loadStories, saveStories } from '../lib/storage';
import { cloudUpdateStory } from '../lib/sync';
import { supabase } from '../lib/supabase';
import { forwardGeocode } from '../lib/api-nominatim';

const GOLD     = '#c9a84c';
const INK      = '#0d0b08';
const PARCHMENT = '#e8d4a0';
const STONE    = 'rgba(138,126,110,0.7)';

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
  backText: { color: 'rgba(201,168,76,0.7)', fontSize: 15 },
  headerTitle: { color: PARCHMENT, fontSize: 16, letterSpacing: 1, fontWeight: '600' },

  mapContainer: { flex: 1, position: 'relative' },
  map: { flex: 1 },

  geocodingBadge: {
    position: 'absolute',
    top: 12,
    right: 12,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(13,11,8,0.88)',
    borderWidth: 1,
    borderColor: 'rgba(201,168,76,0.35)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 4,
  },
  geocodingText: { color: PARCHMENT, fontSize: 12, letterSpacing: 0.5 },

  markerOuter: { alignItems: 'center' },
  markerInner: {
    backgroundColor: 'rgba(13,11,8,0.92)',
    borderWidth: 1.5,
    borderColor: GOLD,
    borderRadius: 4,
    paddingHorizontal: 7,
    paddingVertical: 4,
  },
  markerLowConf: { borderColor: '#a87a2a', opacity: 0.8 },
  markerCross: { color: GOLD, fontSize: 15 },

  callout: { minWidth: 160, maxWidth: 260, padding: 10 },
  calloutName: { fontWeight: '700', fontSize: 15, marginBottom: 2, color: '#1a1410' },
  calloutDates: { fontSize: 13, color: '#666', fontStyle: 'italic', marginBottom: 2 },
  calloutLocation: { fontSize: 12, color: '#888', marginBottom: 4 },
  calloutWarn: { fontSize: 11, color: '#a87a2a', marginBottom: 4 },
  calloutAction: { fontSize: 12, color: '#8a6f3a', fontWeight: '600' },

  panel: {
    height: 220,
    backgroundColor: 'rgba(13,11,8,0.97)',
    borderTopWidth: 1,
    borderTopColor: 'rgba(201,168,76,0.2)',
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 8,
  },
  panelTitle: {
    color: STONE, fontSize: 11, letterSpacing: 2,
    textTransform: 'uppercase', marginBottom: 8,
  },
  panelDivider: { height: 1, backgroundColor: 'rgba(201,168,76,0.15)', marginBottom: 10 },
  graveList: { flex: 1 },

  graveItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(201,168,76,0.08)',
    gap: 8,
  },
  graveItemMain: { flex: 1 },
  graveName: { color: PARCHMENT, fontSize: 14, fontWeight: '600' },
  graveDates: { color: STONE, fontSize: 12, fontStyle: 'italic', marginTop: 1 },

  storyBtn: {
    borderWidth: 1,
    borderColor: 'rgba(201,168,76,0.35)',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 3,
  },
  storyBtnText: { color: GOLD, fontSize: 12 },

  emptyText: {
    color: STONE,
    fontStyle: 'italic',
    textAlign: 'center',
    lineHeight: 22,
    marginTop: 8,
  },
});
