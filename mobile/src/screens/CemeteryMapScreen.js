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
import { cloudUpdateStory, updateGraveLocation, findOrCreateGrave } from '../lib/sync';
import { resetGlobalMapCache } from '../lib/global-map-cache';
import { supabase } from '../lib/supabase';
import { forwardGeocode } from '../lib/api-nominatim';
import { spreadOverlappingPins } from '../lib/map-utils';
import { useRefresh } from '../lib/use-refresh';
import { logEvent, EVENTS } from '../lib/analytics';
import { colors, fonts, radius } from '../lib/theme';

// Wrapper that owns tracksViewChanges.
//
// We keep it TRUE for the marker's whole lifetime. The old code flipped it false
// (originally onLayout, then on a timer) to save per-frame rasterizing — but
// onLayout/timer fire before the SVG has reliably PAINTED on a slow device, so
// the native side snapshotted a blank marker and, because the flag latched false
// forever, the pin stayed invisible until an app restart (the intermittent "pins
// gone on reopen" bug, worst on cheap Androids). Any fixed delay is a guess that
// a slower device can still lose. The cemetery map only has a handful-to-low-tens
// of pins and each is a tiny static gold glyph, so continuous re-rasterizing is
// negligible — and keeping it true makes a blank snapshot IMPOSSIBLE (the native
// view always reflects the painted SVG). This is react-native-maps' own guidance
// for content that must always render. (The 500-pin GLOBAL map can't afford this,
// so it uses a cheap rAF-confirmed single snapshot instead.)
function GraveMarker({ story, onPress, onDragEnd }) {
  return (
    <Marker
      coordinate={{ latitude: story.gps.lat, longitude: story.gps.lng }}
      draggable
      tracksViewChanges={true}
      onDragEnd={onDragEnd}
      onPress={onPress}
    >
      <View>
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
  // SYMMETRIC PADDING is load-bearing: react-native-maps rasterizes this whole View
  // into a fixed-size bitmap (tracksViewChanges flips false after first layout), and
  // anything outside the View's bounds is clipped by that snapshot. The badge used to
  // sit at top:-4/right:-4 — i.e. OUTSIDE this container — so the snapshot cut off its
  // top, and enlarging the circle just enlarged the clipped slice (same ratio, the bug
  // the user saw). Padding the container so the badge lives fully INSIDE the bounds is
  // the real fix. The padding is SYMMETRIC (all sides) on purpose: the Marker has no
  // explicit anchor, so react-native-maps centers the view on the coordinate — uneven
  // padding would shift the SVG off-center and drift the pin off its true point. With
  // equal padding the SVG stays centered = on the coordinate; the badge sits at the
  // top-right of the padded box, fully inside the snapshot.
  shadow: {
    padding: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.6,
    shadowRadius: 2,
    elevation: 4,
  },
  badge: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: 'rgba(60,40,20,0.95)',
    borderWidth: 1,
    borderColor: '#c9a84c',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Metrics kept loose so the glyph isn't clipped by its own line box on Android
  // (lineHeight≈fontSize clips ascenders — the established GraveStory text lesson).
  badgeText: {
    color: '#e8d4a0',
    fontSize: 10,
    fontWeight: 'bold',
    textAlign: 'center',
    textAlignVertical: 'center',
    includeFontPadding: false,
  },
});

// spreadOverlappingPins moved to ../lib/map-utils so the GLOBAL map fans coincident
// pins identically — otherwise the same grave drew at different spots on the two maps
// (a corrected pin looked "right here, wrong there"). See map-utils for the
// determinism note (stable per-grave ring slot).

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

  // Home shortcut for the header. This screen is reached from the result/bio
  // page (single-grave focus) where the focused story can be UNSAVED — and
  // navigate('Home') pops the whole stack, unmounting the underlying Result and
  // discarding that in-memory story. So when the focused story is unsaved, gate
  // the jump behind the same "Discard this story?" confirmation the result page
  // uses, so a one-tap Home can't silently drop it. navigate('Home') pops to the
  // existing root Home rather than pushing a duplicate.
  function handleHome() {
    if (focusStory?._unsaved) {
      Alert.alert(
        'Discard this story?',
        "You haven't saved this story yet. Leaving now will discard it.",
        [
          { text: 'Keep editing', style: 'cancel' },
          { text: 'Discard', style: 'destructive', onPress: () => navigation.navigate('Home') },
        ]
      );
      return;
    }
    navigation.navigate('Home');
  }

  const mapRef = useRef(null);
  // Session-local cache of geocoded coords, keyed by story.timestamp. Stops a
  // pull-to-refresh from re-rolling a GPS-less story's coordinate (and so the pin
  // jumping). Lives only for this screen visit — never persisted (a geocoded
  // centroid must not reach storage / grave-linking / the global map).
  const geocodeMemo = useRef({});
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
    //
    // A story that has a location string but geocodes to nothing (forwardGeocode
    // returns null for a too-vague location, or a transient Nominatim/Photon miss)
    // is NOT dropped — it's kept as an `_unmapped` story so it stays visible in the
    // bottom list (with the count split) and the user can still open it. Previously
    // such a story silently vanished from BOTH the map and the list.
    //
    // We never persist a geocode into story.gps: a cemetery-CENTROID coordinate set
    // as gps would feed findOrCreateGrave + the global map (gps-set is the trigger),
    // polluting them with an approximate point. Instead a session-local memo
    // (geocodeMemo) caches the first successful resolution per story for THIS screen
    // visit, so a pull-to-refresh doesn't re-roll the coordinate (different best-match
    // node, or centroid-vs-node after the grave-cache TTL) and make the pin jump.
    // A story is EITHER mapped (has a coordinate) or _unmapped — never both. We clear
    // any stale `_unmapped` on the placeable branches so a row that was unmappable on a
    // prior visit (or a pre-fix poisoned save) can't be double-counted once it places.
    const resolved = [];
    for (const story of stories) {
      if (story.gps) {
        resolved.push(story._unmapped ? { ...story, _unmapped: undefined } : story);
      } else if (story.location) {
        const memoKey = story.timestamp;
        let coords = memoKey != null ? geocodeMemo.current[memoKey] : null;
        if (!coords) {
          const searchName = story.graveData?.primary_name || story.name || null;
          coords = await forwardGeocode(story.location, searchName, story.dates);
          if (coords && memoKey != null) geocodeMemo.current[memoKey] = coords;
        }
        if (coords) {
          resolved.push({
            ...story,
            _unmapped: undefined,
            gps: { lat: coords.lat, lng: coords.lng },
            _lowConfidence: story._lowConfidence || coords.lowConfidence || coords.approximate === true || undefined,
          });
        } else {
          // Couldn't place it — keep it visible (list-only), no marker.
          resolved.push({ ...story, _unmapped: true });
        }
      }
      // A story with neither gps nor location can't be placed or even labelled by
      // cemetery; it's intentionally omitted (nothing to show on a cemetery map).
    }

    // Markers need a coordinate; the list shows everything (mapped + unmapped).
    const placeable = resolved.filter(s => s.gps);
    setMappedStories([...spreadOverlappingPins(placeable), ...resolved.filter(s => s._unmapped)]);
    setGeocoding(false);

    if (placeable.length === 0) return;

    // Animate map to the appropriate position after geocoding. Only PLACEABLE stories
    // (those with a coordinate) can frame the map — unmapped ones have no gps. A focus
    // story that itself ended up unmapped falls through to no-op (nothing to frame).
    setTimeout(() => {
      if (!mapRef.current) return;
      const focusMapped = focusStory
        ? placeable.find(s => s.timestamp === focusStory.timestamp)
        : null;

      if (placeable.length === 1 || focusMapped) {
        const target = focusMapped || placeable[0];
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
          placeable.map(s => ({ latitude: s.gps.lat, longitude: s.gps.lng })),
          { edgePadding: { top: 60, right: 40, bottom: 260, left: 40 }, animated: true }
        );
      }
    }, 300);
  }

  // Strip the DISPLAY-ONLY enrichment this screen adds before handing a story to
  // navigation. resolveStories attaches `gps` (often a cemetery centroid) and
  // `_lowConfidence` to GPS-less stories just to draw a marker, and `_unmapped` to
  // ones that couldn't be placed. For an UNSAVED story those must NOT ride along to
  // ResultScreen.handleSave — a centroid `gps` there would stake the canonical grave +
  // global-map pin at the centroid (the exact pollution we avoid by not persisting
  // geocodes). For a SAVED story the centroid gps is harmless (handleSave early-returns
  // on !_unsaved) but `_unmapped` must never reach storage, so always drop it.
  function storyForNav(story) {
    if (!story) return story;
    const { _unmapped, ...rest } = story;
    // Did WE synthesize this story's gps? It was gps-less on load and we geocoded it,
    // so a memo entry exists for its timestamp. (A story that arrived with REAL gps has
    // no memo entry — it never entered the geocode branch.) For an UNSAVED such story,
    // drop the synthesized gps/_lowConfidence so handleSave can't persist the centroid
    // into grave-linking / the global map.
    const synthesized = story.timestamp != null && !!geocodeMemo.current[story.timestamp];
    if (story._unsaved && synthesized) {
      return { ...rest, gps: undefined, _lowConfidence: undefined };
    }
    return rest;
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

  // Zoom out to a cemetery-overview level (~0.008° ≈ the grounds + nearby
  // streets), centred on the pin. Useful once a user has graves in more than one
  // cemetery and this map opens zoomed out — one tap reframes to the cemetery
  // this pin sits in. Leaves the callout open so the user keeps their place.
  // Every mapped story has gps (markers are placed by coordinate), but guard anyway.
  function flyToCemetery(story) {
    if (!story?.gps) return;
    mapRef.current?.animateToRegion(
      {
        latitude: story.gps.lat,
        longitude: story.gps.lng,
        latitudeDelta: 0.008,
        longitudeDelta: 0.008,
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
            // NOTE: these three fields (gps, userCorrected, _lowConfidence) are the
            // complete set this drag persists. ResultScreen.handlePickMarker re-seeds
            // EXACTLY these from the local row so a later marker pick doesn't revert
            // the correction — keep the two lists in sync if you add a field here.
            const updated = { ...story, gps: newGps, userCorrected: true, _lowConfidence: false };
            setMappedStories(prev =>
              prev.map(s => s.timestamp === story.timestamp ? updated : s)
            );
            const { data: { session } } = await supabase.auth.getSession();
            const uid = session?.user?.id ?? null;
            const allStories = await loadStories(uid);
            const idx = allStories.findIndex(s => s.timestamp === story.timestamp);

            // Backfill a missing grave link BEFORE persisting. Without a grave_id the
            // correction never reaches the canonical graves row, so the global map's
            // RPC (which serves the corrected coordinate FROM that row) keeps showing
            // the stale per-story coordinate — the "right on my map, wrong on global"
            // bug. Mirrors ResultScreen.handlePickMarker's self-heal.
            //
            // CRITICAL: search at the story's ORIGINAL coordinate, not the DRAGGED one.
            // find_or_create_grave dedups within a ~20 m box; if we searched at newGps
            // after a long drag (common in a big cemetery), the existing grave could sit
            // outside that box and we'd MINT A DUPLICATE at the dragged spot. Searching
            // at story.gps (where the grave actually is) relinks the existing row, and
            // updateGraveLocation below then moves it to newGps.
            let graveId = story.grave_id || null;
            if (!graveId && session?.user) {
              const primaryName = story.graveData?.primary_name || story._primaryName || story.name || '';
              const lookupGps = story.gps || newGps; // original position; newGps only if somehow absent
              if (primaryName) {
                graveId = await findOrCreateGrave(
                  primaryName, lookupGps.lat, lookupGps.lng, story.is_public, story.marker_style,
                );
              }
            }
            // Never downgrade an existing link: keep whatever grave_id the story had if
            // the backfill produced nothing.
            updated.grave_id = graveId || story.grave_id || undefined;

            if (idx >= 0) {
              allStories[idx] = {
                ...allStories[idx],
                gps: newGps, userCorrected: true, _lowConfidence: false,
                grave_id: graveId || allStories[idx].grave_id,
              };
              await saveStories(allStories, uid);
            }
            if (session?.user) {
              await cloudUpdateStory(updated, session.user);
            }
            // Propagate the correction to the canonical grave row so the global map's
            // RPC serves it. updateGraveLocation moves graves.lat/lng + sets
            // user_corrected. (Migration 024 lets the SAME user re-correct an already-
            // corrected grave — refinement drags used to silently no-op at the DB.)
            if (graveId) {
              await updateGraveLocation(graveId, newGps.lat, newGps.lng);
            }
            // Drop the community-map cache so a return there refetches the corrected
            // pin immediately instead of waiting out the 5-min TTL.
            resetGlobalMapCache();
          },
        },
      ]
    );
  }

  const mappedCount = mappedStories.filter(s => s.gps).length;
  const unmappedCount = mappedStories.filter(s => s._unmapped).length;
  const panelTitle = geocoding
    ? 'Locating graves…'
    : mappedStories.length === 0
      ? 'No location data yet'
      : mappedCount === 0
        // Everything had a location string but nothing could be placed.
        ? `${unmappedCount} grave${unmappedCount !== 1 ? 's' : ''} without a map location`
        : `${mappedCount} grave${mappedCount !== 1 ? 's' : ''} mapped` +
          (unmappedCount > 0 ? ` · ${unmappedCount} without location` : '');

  // Any pin the user hasn't yet placed exactly. GPS drops pins near the grave but
  // rarely on it (often 10–30 m off, worse under tree cover), so dragging each pin
  // onto its real grave is the EXPECTED step — surfaced as an obvious prompt the
  // moment the map opens, not buried in a per-pin callout.
  // Only PLACED-but-unconfirmed pins count — an unmapped story has no marker to drag.
  const unplacedCount = mappedStories.filter(s => s.gps && !s.userCorrected).length;
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
        <TouchableOpacity
          onPress={handleHome}
          style={[styles.headerSide, styles.headerSideRight]}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Go to home screen"
        >
          <Text style={styles.backText}>Home</Text>
        </TouchableOpacity>
      </View>

      {/* Map */}
      <View style={styles.mapContainer}>
        <MapView
          ref={mapRef}
          style={styles.map}
          initialRegion={DEFAULT_REGION}
          onPress={() => { setSelectedStory(null); setBioExpanded(false); }}
        >
          {mappedStories.filter(s => s.gps).map((story, i) => (
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
                  accessibilityRole="button"
                  accessibilityLabel={bioExpanded ? 'Hide biography' : 'Read biography'}
                >
                  <Text style={styles.calloutBtnText}>
                    {bioExpanded ? '▲ Bio' : '▼ Bio'}
                  </Text>
                </TouchableOpacity>
              )}
              {!!selectedStory.gps && (
                <TouchableOpacity
                  style={styles.calloutBtn}
                  onPress={() => flyToCemetery(selectedStory)}
                  activeOpacity={0.7}
                  accessibilityRole="button"
                  accessibilityLabel="Frame the cemetery"
                >
                  <Text style={styles.calloutBtnText}>⤢ Cemetery</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={[styles.calloutBtn, styles.calloutBtnPrimary]}
                onPress={() => { setSelectedStory(null); setBioExpanded(false); navigation.navigate('Result', { story: storyForNav(selectedStory) }); }}
                activeOpacity={0.7}
                accessibilityRole="button"
                accessibilityLabel="Open full biography"
              >
                <Text style={styles.calloutBtnText}>→ Open</Text>
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
                {/* Tap row → fly to marker (mapped) or open the story (unmapped, no marker) */}
                <TouchableOpacity
                  style={styles.graveItemMain}
                  onPress={() => story._unmapped ? navigation.navigate('Result', { story: storyForNav(story) }) : flyToGrave(story)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.graveName} numberOfLines={1}>
                    {story.name || 'Unknown'}
                  </Text>
                  {story._unmapped ? (
                    <Text style={styles.graveNoLocation}>⚠ No map location — open to view</Text>
                  ) : (
                    !!story.dates && <Text style={styles.graveDates}>{story.dates}</Text>
                  )}
                </TouchableOpacity>
                {/* Story button → open result screen */}
                <TouchableOpacity
                  style={styles.storyBtn}
                  onPress={() => navigation.navigate('Result', { story: storyForNav(story) })}
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
  // Right-align the Home label in its fixed 80px slot so the header reads
  // Back (left) · title (center) · Home (right) symmetrically.
  headerSideRight: { alignItems: 'flex-end' },
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
  calloutButtons: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
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
  graveNoLocation: { color: colors.ashDim, fontSize: 11.5, fontFamily: fonts.body, marginTop: 2 },

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
