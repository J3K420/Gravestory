import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet,
  ActivityIndicator, Alert,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import MapView, { Marker } from 'react-native-maps';
import { GraveMarkerSvg } from '../components/GraveMarkers';
import { MapStack } from '../components/Icons';
import { loadStories, saveStories } from '../lib/storage';
import { cloudUpdateStory, updateGraveLocation } from '../lib/sync';
import { supabase } from '../lib/supabase';
import { forwardGeocode } from '../lib/api-nominatim';
import { useRefresh } from '../lib/use-refresh';
import { logEvent, EVENTS } from '../lib/analytics';
import { colors, fonts, radius } from '../lib/theme';

// Wrapper that owns tracksViewChanges: starts true so the SVG is captured,
// flips to false after the first layout so map updates don't re-snapshot.
// Re-snapshots when the chosen marker style changes (key includes marker_style).
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
        {/* Until the user has dragged the pin to the exact grave, it's UNCONFIRMED —
            even a real-GPS camera pin, because consumer GPS is routinely ~10–30 m off
            (worse under tree cover). So the "needs placing" state keys off
            !userCorrected, NOT _lowConfidence (which only meant "geocoded fallback").
            Once corrected, the pin is exact and shows clean. */}
        <GravestoneMarker styleId={story.marker_style} needsPlacing={!story.userCorrected} />
      </View>
    </Marker>
  );
}

// Renders the grave's chosen marker style (falls back to the default 'book'). An
// UNCONFIRMED pin (never user-placed) gets a small gold "place me" badge so it reads
// as "tap to position", not as a finished, trusted location.
function GravestoneMarker({ styleId, needsPlacing }) {
  return (
    <View style={markerStyles.shadow}>
      <GraveMarkerSvg styleId={styleId} size={32} />
      {needsPlacing && (
        <View style={markerStyles.badge}>
          <Text style={markerStyles.badgeText}>✛</Text>
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
    fontSize: 10,
    fontWeight: 'bold',
    lineHeight: 12,
    textAlign: 'center',
  },
});

// Stories that all fell back to the same cemetery-center coordinate render as
// one stacked marker — the pins underneath are invisible and untappable. Fan
// exact-overlap groups out in a small ring (~7 m per step) so every grave stays
// visible. Display-only: the saved gps is untouched, and drag-to-correct still
// persists wherever the user drops the pin.
function spreadOverlappingPins(stories) {
  const seen = {};
  return stories.map(story => {
    if (!story.gps) return story;
    const key = `${story.gps.lat.toFixed(5)},${story.gps.lng.toFixed(5)}`;
    const n = seen[key] = (seen[key] === undefined ? 0 : seen[key] + 1);
    if (n === 0) return story;
    const angle = n * (Math.PI / 4);
    const ring = 0.00006 * Math.ceil(n / 8); // ~6.7 m of latitude per ring
    return {
      ...story,
      gps: { lat: story.gps.lat + ring * Math.cos(angle), lng: story.gps.lng + ring * Math.sin(angle) },
    };
  });
}

// Geographic center of the contiguous US — used before any graves are located
const DEFAULT_REGION = {
  latitude: 39.5,
  longitude: -98.35,
  latitudeDelta: 30,
  longitudeDelta: 50,
};

export default function CemeteryMapScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const { focusStory = null } = route.params || {};

  const mapRef = useRef(null);
  const [mappedStories, setMappedStories] = useState([]);
  const [geocoding, setGeocoding] = useState(true);
  const [selectedStory, setSelectedStory] = useState(null);
  const [bioExpanded, setBioExpanded] = useState(false);
  // Per-visit dismiss for the "drag your pins" prompt (see the banner below). Resets
  // each time the screen mounts so a returning user is reminded, but isn't nagged
  // within a single session once they dismiss it.
  const [placeHintDismissed, setPlaceHintDismissed] = useState(false);
  const { refreshControl } = useRefresh(resolveStories);

  useEffect(() => {
    resolveStories();
    logEvent(EVENTS.MAP_OPENED, { which: 'cemetery' });
  }, []);

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

    // Geocode stories that have a location string but no GPS coords.
    // Pass the single OCR name + dates so forwardGeocode can try the named
    // grave-node search before settling for the cemetery centroid; centroid
    // fallbacks are flagged approximate so the pin shows the drag-to-correct hint.
    const resolved = [];
    for (const story of stories) {
      if (story.gps) {
        resolved.push(story);
      } else if (story.location) {
        const searchName = story.graveData?.primary_name || story.name || null;
        const coords = await forwardGeocode(story.location, searchName, story.dates);
        if (coords) {
          resolved.push({
            ...story,
            gps: { lat: coords.lat, lng: coords.lng },
            _lowConfidence: story._lowConfidence || coords.lowConfidence || coords.approximate === true || undefined,
          });
        }
      }
    }

    setMappedStories(spreadOverlappingPins(resolved));
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
    // An UNSAVED focus story (opened from a fresh scan's Map chip before tapping Save)
    // has no local-storage row and no cloud row yet, so a drag here would update the
    // on-screen copy but persist NOTHING — handleSave later writes the ORIGINAL gps and
    // the placement is silently lost. Don't fake it: tell the user to save first. The
    // marker visually snaps back to its anchor on the next render (we don't setMappedStories).
    if (story._unsaved) {
      // Snap the marker back to its bound coordinate (a fresh array → re-render; the
      // Marker's coordinate prop is story.gps, so it returns to the anchor).
      setMappedStories(prev => [...prev]);
      Alert.alert(
        'Save the story first',
        'Save this story, then come back to the map to place its pin exactly. (Pin positions are only kept for saved stories.)',
        [{ text: 'OK' }]
      );
      return;
    }
    Alert.alert(
      'Save corrected position?',
      `Move ${story.name || 'this grave'} to the dragged location?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Save',
          onPress: async () => {
            // A user-placed pin is exact — clear the approximate flag so the "?"
            // badge and "approximate location" warning disappear (local + global).
            const updated = { ...story, gps: newGps, userCorrected: true, _lowConfidence: false };
            setMappedStories(prev =>
              prev.map(s => s.timestamp === story.timestamp ? updated : s)
            );
            const { data: { session } } = await supabase.auth.getSession();
            const uid = session?.user?.id ?? null;
            const allStories = await loadStories(uid);
            const idx = allStories.findIndex(s => s.timestamp === story.timestamp);
            if (idx >= 0) {
              allStories[idx] = { ...allStories[idx], gps: newGps, userCorrected: true, _lowConfidence: false };
              await saveStories(allStories, uid);
            }
            if (session?.user) {
              await cloudUpdateStory(updated, session.user);
            }
            // Propagate correction to the canonical grave pin (first correction wins)
            if (story.grave_id) {
              await updateGraveLocation(story.grave_id, newGps.lat, newGps.lng);
            }
          },
        },
      ]
    );
  }

  const panelTitle = geocoding
    ? 'Locating graves…'
    : mappedStories.length === 0
      ? 'No location data yet'
      : `${mappedStories.length} grave${mappedStories.length !== 1 ? 's' : ''} mapped`;

  // Any pin the user hasn't yet placed exactly. GPS drops pins near the grave but
  // rarely on it (often 10–30 m off, worse under tree cover), so dragging each pin
  // onto its real grave is the EXPECTED step — surfaced as an obvious prompt the
  // moment the map opens, not buried in a per-pin callout.
  const unplacedCount = mappedStories.filter(s => !s.userCorrected).length;
  // Hidden while a callout is open (selectedStory) — they share the top of the map,
  // and the open callout already carries its own per-pin "place this pin" block.
  const showPlaceHint = !geocoding && unplacedCount > 0 && !placeHintDismissed && !selectedStory;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.headerSide}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <MapStack size={16} color={colors.flame} />
          <Text style={styles.headerTitle}>Cemetery Map</Text>
        </View>
        <View style={styles.headerSide} />
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
              // `userCorrected` is in the key so placing a pin REMOUNTS the marker:
              // react-native-maps only re-rasterizes a custom marker while
              // tracksViewChanges is true, and GraveMarker flips that false after first
              // layout and never back. Without the key change the ✛ "needs placing"
              // badge would stay frozen on the old snapshot even after the drag clears
              // userCorrected — the marker reconciles in place and never re-snapshots.
              key={`${story.timestamp ?? i}-${story.marker_style || 'book'}-${story.userCorrected ? 'p' : 'u'}`}
              story={story}
              onPress={() => { setSelectedStory(story); setBioExpanded(false); }}
              onDragEnd={e => handleDragEnd(story, e.nativeEvent.coordinate)}
            />
          ))}
        </MapView>

        {geocoding && (
          <View style={styles.geocodingBadge}>
            <ActivityIndicator size="small" color={colors.flame} style={{ marginRight: 8 }} />
            <Text style={styles.geocodingText}>Locating…</Text>
          </View>
        )}

        {/* Drag-your-pins prompt — appears on map open whenever there are pins the
            user hasn't placed yet. This is the primary teaching moment for the drag
            gesture: obvious, at the top of the map, dismissible. */}
        {showPlaceHint && (
          <View style={styles.placeHint}>
            <View style={styles.placeHintTextCol}>
              <Text style={styles.placeHintTitle}>
                ✛ {unplacedCount === 1 ? 'Place your pin' : `Place your ${unplacedCount} pins`}
              </Text>
              <Text style={styles.placeHintBody}>
                GPS is approximate. Press and hold a marker, then drag it onto the exact grave.
              </Text>
            </View>
            <TouchableOpacity
              style={styles.placeHintClose}
              onPress={() => setPlaceHintDismissed(true)}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
              activeOpacity={0.6}
              accessibilityRole="button"
              accessibilityLabel="Dismiss pin-placement tip"
            >
              <Text style={styles.placeHintCloseText}>✕</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Floating callout — replaces <Callout> which is unreliable on Android */}
        {selectedStory && (
          <View style={styles.floatingCallout}>
            <TouchableOpacity
              style={styles.calloutDismiss}
              onPress={() => { setSelectedStory(null); setBioExpanded(false); }}
              hitSlop={{ top: 14, bottom: 14, left: 14, right: 14 }}
              activeOpacity={0.6}
              accessibilityRole="button"
              accessibilityLabel="Close"
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
            {selectedStory.userCorrected ? (
              <Text style={styles.calloutCorrected}>✓ location placed by you</Text>
            ) : (
              // Unconfirmed pin (any pin not yet user-placed). GPS drops it close but
              // rarely exact — under tree cover it can be 20–30 m off — so placing it
              // is the EXPECTED step, not error recovery. Make that prominent.
              <View style={styles.placeCallout}>
                <Text style={styles.placeCalloutTitle}>📍 Place this pin exactly</Text>
                <Text style={styles.placeCalloutBody}>
                  GPS is approximate. Press and hold the marker, then drag it onto the real grave.
                </Text>
              </View>
            )}

            {/* Inline bio preview — first two paragraphs */}
            {bioExpanded && !!selectedStory.biography && (
              <ScrollView
                style={styles.calloutBioScroll}
                contentContainerStyle={styles.calloutBioContent}
                showsVerticalScrollIndicator={false}
              >
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
                  activeOpacity={0.7}
                >
                  <Text style={styles.calloutBtnText}>
                    {bioExpanded ? '▲ Hide bio' : '▼ Read bio'}
                  </Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={[styles.calloutBtn, styles.calloutBtnPrimary]}
                onPress={() => { setSelectedStory(null); setBioExpanded(false); navigation.navigate('Result', { story: selectedStory }); }}
                activeOpacity={0.7}
              >
                <Text style={styles.calloutBtnText}>→ Go to bio</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </View>

      {/* Bottom panel — scrollable grave list */}
      <View style={[styles.panel, { paddingBottom: insets.bottom + 8 }]}>
        <Text style={styles.panelTitle}>{panelTitle}</Text>
        <View style={styles.panelDivider} />
        <ScrollView
          style={styles.graveList}
          showsVerticalScrollIndicator={false}
          refreshControl={refreshControl}
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
                <TouchableOpacity style={styles.graveItemMain} onPress={() => flyToGrave(story)} activeOpacity={0.7}>
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
                  activeOpacity={0.7}
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
  container: { flex: 1, backgroundColor: colors.ink },

  // Header mirrors the Community map (GlobalMapScreen) for cross-screen parity.
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
    backgroundColor: colors.stone,
  },
  headerSide: { width: 80 },
  headerCenter: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  backText: { color: colors.ashDim, fontSize: 15, fontFamily: fonts.body },
  headerTitle: { color: colors.parchment, fontSize: 16, fontFamily: fonts.name, letterSpacing: 0.3 },

  mapContainer: { flex: 1, position: 'relative' },
  map: { flex: 1 },

  geocodingBadge: {
    position: 'absolute', top: 12, right: 12,
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(20,16,11,0.9)',
    borderWidth: 1, borderColor: colors.line,
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.sm,
  },
  geocodingText: { color: colors.parchment, fontSize: 12, fontFamily: fonts.body, letterSpacing: 0.5 },

  // Drag-your-pins prompt banner. Anchored to the BOTTOM of the map (not the top):
  // the top strip is where auto-framed pins land (a single focus pin is centered and
  // fitToCoordinates pads only 60px), and a full-width opaque banner there would
  // physically occlude the press-and-hold on the very marker it tells you to drag.
  // Tinted gold to read as a teaching prompt, not a warning.
  placeHint: {
    position: 'absolute', bottom: 12, left: 12, right: 12,
    flexDirection: 'row', alignItems: 'flex-start',
    backgroundColor: 'rgba(34,26,16,0.97)',
    borderWidth: 1, borderColor: 'rgba(242,182,92,0.5)',
    borderRadius: radius.md,
    paddingHorizontal: 14, paddingVertical: 12,
  },
  placeHintTextCol: { flex: 1, paddingRight: 10 },
  placeHintTitle: {
    color: colors.flame, fontSize: 14, fontFamily: fonts.sansBold,
    marginBottom: 3, letterSpacing: 0.2,
  },
  placeHintBody: {
    color: colors.parchment, fontSize: 12.5, fontFamily: fonts.body, lineHeight: 18,
  },
  placeHintClose: {
    width: 28, height: 28, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
    marginTop: -2, marginRight: -4,
  },
  placeHintCloseText: { color: colors.ash, fontSize: 16, lineHeight: 16 },

  floatingCallout: {
    position: 'absolute', top: 12, left: 12, right: 12,
    backgroundColor: 'rgba(20,16,11,0.96)',
    borderWidth: 1, borderColor: colors.line,
    borderRadius: radius.md,
    padding: 14,
  },
  calloutDismiss: {
    position: 'absolute', top: 2, right: 4, zIndex: 2,
    width: 40, height: 40, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center',
  },
  calloutDismissText: { color: colors.ash, fontSize: 18, lineHeight: 18 },
  calloutName: { color: colors.parchment, fontSize: 16, fontFamily: fonts.name, marginBottom: 3, paddingRight: 36 },
  calloutDates: { color: colors.ash, fontSize: 13, fontFamily: fonts.serifItalic, marginBottom: 2 },
  calloutLocation: { color: colors.ashDim, fontSize: 12, fontFamily: fonts.body, marginBottom: 6 },
  calloutCorrected: { color: colors.moss, fontSize: 11, fontFamily: fonts.body, marginBottom: 6 },
  // Prominent "place this pin" block for an unconfirmed pin — a bordered, tinted
  // panel rather than a one-line italic footnote, because placing the pin is the
  // expected step (GPS is rarely exact at the grave).
  placeCallout: {
    borderWidth: 1, borderColor: 'rgba(242,182,92,0.45)',
    backgroundColor: 'rgba(242,182,92,0.08)',
    borderRadius: radius.sm,
    paddingHorizontal: 10, paddingVertical: 8,
    marginBottom: 8,
  },
  placeCalloutTitle: {
    color: colors.flame, fontSize: 12.5, fontFamily: fonts.sansBold,
    marginBottom: 2, letterSpacing: 0.2,
  },
  placeCalloutBody: {
    color: colors.ash, fontSize: 11.5, fontFamily: fonts.body, lineHeight: 16,
  },
  calloutBioScroll: { maxHeight: 140, marginBottom: 8 },
  // Vertical padding on the scroll CONTENT (not the Text) so the serif font's
  // first-line ascenders and last-line descenders aren't clipped by the
  // ScrollView's clip rect on Android — the established fix for this is to give
  // the content breathing room rather than fight font metrics with lineHeight.
  calloutBioContent: { paddingTop: 3, paddingBottom: 6 },
  calloutBioText: {
    color: colors.ash, fontSize: 13, fontFamily: fonts.serif, lineHeight: 21,
  },
  calloutButtons: { flexDirection: 'row', gap: 8, marginTop: 4 },
  calloutBtn: {
    borderWidth: 1, borderColor: colors.flame,
    paddingHorizontal: 14, paddingVertical: 6, borderRadius: radius.sm,
  },
  calloutBtnPrimary: { backgroundColor: 'rgba(242,182,92,0.1)' },
  calloutBtnText: { color: colors.flame, fontSize: 13, fontFamily: fonts.sansBold },

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
  graveName: { color: colors.parchment, fontSize: 14, fontFamily: fonts.name },
  graveDates: { color: colors.ash, fontSize: 12, fontFamily: fonts.bodyItalic, marginTop: 1 },

  storyBtn: {
    borderWidth: 1, borderColor: colors.line,
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.sm,
  },
  storyBtnText: { color: colors.flame, fontSize: 12, fontFamily: fonts.body },

  emptyText: {
    color: colors.ash, fontFamily: fonts.bodyItalic,
    textAlign: 'center', lineHeight: 22, marginTop: 8,
  },
});
