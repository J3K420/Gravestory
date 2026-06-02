import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet, RefreshControl,
  ActivityIndicator, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import MapView, { Marker } from 'react-native-maps';
import Svg, { Rect, Path, Line } from 'react-native-svg';
import { loadStories, saveStories } from '../lib/storage';
import { cloudUpdateStory } from '../lib/sync';
import { supabase } from '../lib/supabase';
import { forwardGeocode } from '../lib/api-nominatim';
import { colors, fonts, radius } from '../lib/theme';

const GOLD      = colors.flame;
const INK       = colors.ink;
const PARCHMENT = colors.parchment;
const STONE     = colors.ash;

// Wrapper that owns tracksViewChanges: starts true so the SVG is captured,
// flips to false after the first layout so map updates don't re-snapshot.
function GraveMarker({ story, onPress, onDragEnd }) {
  const [tracksViewChanges, setTracksViewChanges] = useState(true);
  return (
    <Marker
      coordinate={{ latitude: story.gps.lat, longitude: story.gps.lng }}
      draggable
      tracksViewChanges={tracksViewChanges}
      onDragEnd={onDragEnd}
      onPress={onPress}
    >
      <View onLayout={() => setTracksViewChanges(false)}>
        <GravestoneMarker lowConfidence={story._lowConfidence} />
      </View>
    </Marker>
  );
}

// SVG gravestone marker — matches the web Leaflet divIcon design
function GravestoneMarker({ lowConfidence }) {
  return (
    <View style={markerStyles.shadow}>
      <Svg width={32} height={32} viewBox="0 0 100 100" fill="none">
        {/* Base step */}
        <Rect x="22" y="84" width="56" height="6" stroke="#c9a84c" strokeWidth="2" fill="rgba(20,15,8,0.85)" />
        {/* Stone body with arched top */}
        <Path d="M30 84 L30 35 Q30 18 50 18 Q70 18 70 35 L70 84 Z" stroke="#c9a84c" strokeWidth="2" fill="rgba(20,15,8,0.85)" />
        {/* Open book — left page */}
        <Path d="M38 40 L38 56 Q44 54 49 56 L49 42 Q44 40 38 40 Z" stroke="#e8d4a0" strokeWidth="2" fill="rgba(232,212,160,0.25)" />
        {/* Open book — right page */}
        <Path d="M51 42 Q56 40 62 40 L62 56 Q56 54 51 56 Z" stroke="#e8d4a0" strokeWidth="2" fill="rgba(232,212,160,0.25)" />
        {/* Book spine */}
        <Line x1="50" y1="41" x2="50" y2="56" stroke="#e8d4a0" strokeWidth="1.5" />
        {/* Cross vertical */}
        <Line x1="50" y1="63" x2="50" y2="76" stroke="#e8d4a0" strokeWidth="1.5" />
        {/* Cross horizontal */}
        <Line x1="44" y1="68" x2="56" y2="68" stroke="#e8d4a0" strokeWidth="1.5" />
      </Svg>
      {lowConfidence && (
        <View style={markerStyles.badge}>
          <Text style={markerStyles.badgeText}>?</Text>
        </View>
      )}
    </View>
  );
}

// Defined outside the component so it's stable across renders
const markerStyles = StyleSheet.create({
  shadow: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.6,
    shadowRadius: 2,
    elevation: 4,
  },
  badge: {
    position: 'absolute',
    top: -3,
    right: -3,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: 'rgba(60,40,20,0.95)',
    borderWidth: 1,
    borderColor: '#c9a84c',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    color: '#e8d4a0',
    fontSize: 9,
    fontWeight: 'bold',
    lineHeight: 12,
  },
});

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
  const [selectedStory, setSelectedStory] = useState(null);
  const [bioExpanded, setBioExpanded] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    resolveStories();
  }, []);

  async function onRefresh() {
    setRefreshing(true);
    await resolveStories();
    setRefreshing(false);
  }

  async function resolveStories() {
    setGeocoding(true);

    const { data: { session } } = await supabase.auth.getSession();
    const uid = session?.user?.id ?? null;
    let stories = await loadStories(uid);

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
            const { data: { session } } = await supabase.auth.getSession();
            const uid = session?.user?.id ?? null;
            const allStories = await loadStories(uid);
            const idx = allStories.findIndex(s => s.timestamp === story.timestamp);
            if (idx >= 0) {
              allStories[idx] = { ...allStories[idx], gps: newGps, userCorrected: true };
              await saveStories(allStories, uid);
            }
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
          onPress={() => { setSelectedStory(null); setBioExpanded(false); }}
        >
          {mappedStories.map((story, i) => (
            <GraveMarker
              key={story.timestamp ?? i}
              story={story}
              onPress={() => { setSelectedStory(story); setBioExpanded(false); }}
              onDragEnd={e => handleDragEnd(story, e.nativeEvent.coordinate)}
            />
          ))}
        </MapView>

        {geocoding && (
          <View style={styles.geocodingBadge}>
            <ActivityIndicator size="small" color={GOLD} style={{ marginRight: 8 }} />
            <Text style={styles.geocodingText}>Locating…</Text>
          </View>
        )}

        {/* Floating callout — replaces <Callout> which is unreliable on Android */}
        {selectedStory && (
          <View style={styles.floatingCallout}>
            <TouchableOpacity
              style={styles.calloutDismiss}
              onPress={() => { setSelectedStory(null); setBioExpanded(false); }}
            >
              <Text style={styles.calloutDismissText}>✕</Text>
            </TouchableOpacity>

            <Text style={styles.calloutName}>{selectedStory.name || 'Unknown'}</Text>
            {!!selectedStory.dates && (
              <Text style={styles.calloutDates}>{selectedStory.dates}</Text>
            )}
            {!!selectedStory.location && (
              <Text style={styles.calloutLocation}>{selectedStory.location}</Text>
            )}
            {selectedStory._lowConfidence && (
              <Text style={styles.calloutWarn}>⚠ approximate location</Text>
            )}

            {/* Inline bio preview — first two paragraphs */}
            {bioExpanded && !!selectedStory.biography && (
              <ScrollView style={styles.calloutBioScroll} showsVerticalScrollIndicator={false}>
                <Text style={styles.calloutBioText}>
                  {selectedStory.biography.split('\n\n').filter(p => p.trim()).slice(0, 2).join('\n\n')}
                </Text>
              </ScrollView>
            )}

            <View style={styles.calloutButtons}>
              {!!selectedStory.biography && (
                <TouchableOpacity
                  style={styles.calloutBtn}
                  onPress={() => setBioExpanded(e => !e)}
                >
                  <Text style={styles.calloutBtnText}>
                    {bioExpanded ? '▲ Hide bio' : '▼ Read bio'}
                  </Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={[styles.calloutBtn, styles.calloutBtnPrimary]}
                onPress={() => { setSelectedStory(null); setBioExpanded(false); navigation.navigate('Result', { story: selectedStory }); }}
              >
                <Text style={styles.calloutBtnText}>→ Go to bio</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </View>

      {/* Bottom panel — scrollable grave list */}
      <View style={styles.panel}>
        <Text style={styles.panelTitle}>{panelTitle}</Text>
        <View style={styles.panelDivider} />
        <ScrollView
          style={styles.graveList}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.flame} colors={[colors.flame]} />}
        >
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

  floatingCallout: {
    position: 'absolute', top: 12, left: 12, right: 12,
    backgroundColor: 'rgba(20,16,11,0.96)',
    borderWidth: 1, borderColor: colors.line,
    borderRadius: radius.md,
    padding: 14,
  },
  calloutDismiss: { position: 'absolute', top: 10, right: 12 },
  calloutDismissText: { color: colors.ashDim, fontSize: 16 },
  calloutName: { color: PARCHMENT, fontSize: 16, fontFamily: fonts.name, marginBottom: 3, paddingRight: 24 },
  calloutDates: { color: colors.ash, fontSize: 13, fontFamily: fonts.serifItalic, marginBottom: 2 },
  calloutLocation: { color: colors.ashDim, fontSize: 12, fontFamily: fonts.body, marginBottom: 6 },
  calloutWarn: { color: colors.ember, fontSize: 11, fontFamily: fonts.body, marginBottom: 6 },
  calloutBioScroll: { maxHeight: 140, marginBottom: 8 },
  calloutBioText: {
    color: colors.ash, fontSize: 13, fontFamily: fonts.serif, lineHeight: 20,
  },
  calloutButtons: { flexDirection: 'row', gap: 8, marginTop: 4 },
  calloutBtn: {
    borderWidth: 1, borderColor: GOLD,
    paddingHorizontal: 14, paddingVertical: 6, borderRadius: radius.sm,
  },
  calloutBtnPrimary: { backgroundColor: 'rgba(242,182,92,0.1)' },
  calloutBtnText: { color: GOLD, fontSize: 13, fontFamily: fonts.sansBold },

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
