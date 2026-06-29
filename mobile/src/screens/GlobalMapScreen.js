import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet, ActivityIndicator,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import MapView, { Marker } from 'react-native-maps';
import { supabase } from '../lib/supabase';
import { rowToStory } from '../lib/sync';
import { spreadOverlappingPins } from '../lib/map-utils';
import { readGlobalMapCache, writeGlobalMapCache, resetGlobalMapCache } from '../lib/global-map-cache';
import { useRefresh } from '../lib/use-refresh';
import { logEvent, EVENTS } from '../lib/analytics';
import { colors, fonts, radius } from '../lib/theme';
import { Globe } from '../components/Icons';
import { GraveMarkerSvg } from '../components/GraveMarkers';

const DEFAULT_REGION = { latitude: 30, longitude: -20, latitudeDelta: 110, longitudeDelta: 130 };

// Renders a grave's first-wins chosen marker on the global map (the same 20 gold
// glyphs as the cemetery map). Not draggable.
//
// tracksViewChanges starts true so the SVG is captured, then flips false after a
// COMMITTED FRAME (double requestAnimationFrame), not on onLayout/a fixed timer.
// Why this differs from the cemetery map (which keeps it true for life): the
// global map renders up to 500 pins at once, and holding tracksViewChanges true
// across all of them continuously re-rasterizes every marker — real CPU cost on a
// weak device. But flipping false too early (onLayout, or a blind timer) on a slow
// device snapshots a BLANK marker and latches invisible until restart (the "pins
// gone on reopen" bug). The double-rAF waits for one fully committed frame — far
// cheaper than holding true, and reliably after the SVG paints in practice — then
// flips false once. Cancelled on unmount. The key (below) includes marker_style so
// a re-staked grave remounts and re-snapshots.
function GlobalGraveMarker({ story, onPress }) {
  const [tracksViewChanges, setTracksViewChanges] = useState(true);
  useEffect(() => {
    let raf2 = 0;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setTracksViewChanges(false));
    });
    return () => { cancelAnimationFrame(raf1); if (raf2) cancelAnimationFrame(raf2); };
  }, []);
  // A grave anyone has corrected is exact — no "?" badge regardless of the flag.
  const lowConf = story._lowConfidence && !story.userCorrected;
  return (
    <Marker
      coordinate={{ latitude: story.gps.lat, longitude: story.gps.lng }}
      tracksViewChanges={tracksViewChanges}
      onPress={onPress}
    >
      <View
        style={[styles.markerShadow, lowConf && styles.markerLowConf]}
      >
        <GraveMarkerSvg styleId={story.marker_style} size={32} />
        {lowConf && (
          <View style={styles.markerBadge}><Text style={styles.markerBadgeText}>?</Text></View>
        )}
      </View>
    </Marker>
  );
}

export default function GlobalMapScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const mapRef = useRef(null);
  const [user, setUser]         = useState(null);
  const [stories, setStories]   = useState([]);
  const [loading, setLoading]       = useState(true);
  const [fetchError, setFetchError]   = useState(null);
  const [selectedStory, setSelectedStory] = useState(null);
  const [bioExpanded, setBioExpanded]     = useState(false);

  // Re-check on every focus (not just mount) so a long-backgrounded resume or
  // a return from another screen refreshes the community map. fetchStories
  // honours the 5-min cache, so rapid back-and-forth won't spam the RPC — but
  // once the cache is stale it refetches automatically instead of waiting for
  // a manual pull-to-refresh.
  useFocusEffect(
    useCallback(() => {
      let active = true;
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (!active) return;
        const u = session?.user ?? null;
        setUser(u);
        fetchStories(u);
        logEvent(EVENTS.MAP_OPENED, { which: 'global', isGuest: !u });
      });
      return () => { active = false; };
    }, [])
  );

  async function fetchStories(currentUser) {
    const cacheKey = currentUser ? currentUser.id : 'guest';
    const cached = readGlobalMapCache(cacheKey);
    if (cached) {
      setStories(cached);
      setLoading(false);
      return;
    }
    setLoading(true);
    setFetchError(null);
    try {
      const limit = currentUser ? 500 : 50;
      const { data, error } = await supabase.rpc('global_public_stories', { p_limit: limit });
      if (error) throw error;
      const mapped = (data || [])
        .filter(row => row.latitude != null && row.longitude != null)
        .map(row => ({
          ...rowToStory(row),
          is_public: true,
          _contributor: row.contributor_name || 'Anonymous',
          _isGlobal: true,
        }));

      // One pin per canonical grave: deduplicate by grave_id, then by ~20 m GPS cell
      const deduped = [];
      const seenGraves = new Set();
      const seenCells = new Set();
      for (const s of mapped) {
        if (s.grave_id) {
          if (seenGraves.has(s.grave_id)) continue;
          seenGraves.add(s.grave_id);
        } else if (s.gps) {
          const cell = `${Math.round(s.gps.lat * 5000)},${Math.round(s.gps.lng * 5000)}`;
          if (seenCells.has(cell)) continue;
          seenCells.add(cell);
        }
        deduped.push(s);
      }

      // Fan out exact-overlap pins (centroid clusters) the SAME way the cemetery map
      // does, so a grave renders at the same spot on both maps. Deterministic per
      // grave, so it's stable across fetches and matches the other screen.
      const spread = spreadOverlappingPins(deduped);

      writeGlobalMapCache(cacheKey, spread);
      setStories(spread);
      setLoading(false);
      if (spread.length > 0) {
        setTimeout(() => {
          if (spread.length === 1) {
            mapRef.current?.animateToRegion(
              { latitude: spread[0].gps.lat, longitude: spread[0].gps.lng, latitudeDelta: 0.05, longitudeDelta: 0.05 },
              800
            );
          } else {
            mapRef.current?.fitToCoordinates(
              spread.map(s => ({ latitude: s.gps.lat, longitude: s.gps.lng })),
              { edgePadding: { top: 60, right: 40, bottom: 280, left: 40 }, animated: true }
            );
          }
        }, 600);
      }
    } catch (e) {
      console.warn('GlobalMapScreen fetch failed:', e.message);
      setFetchError('Could not load shared stories. Pull down to retry.');
      setLoading(false);
    }
  }

  const { refreshControl } = useRefresh(async () => {
    resetGlobalMapCache();
    const { data: { session } } = await supabase.auth.getSession();
    await fetchStories(session?.user ?? null);
  });

  function flyTo(story) {
    if (!story.gps) return;
    mapRef.current?.animateToRegion(
      { latitude: story.gps.lat, longitude: story.gps.lng, latitudeDelta: 0.0006, longitudeDelta: 0.0006 },
      700
    );
  }

  // Zoom to a cemetery-overview level (~0.008° ≈ the grounds + nearby streets),
  // centred on the pin. From the world-scale community map this is how you see
  // "which cemetery is this grave in". Leaves the callout open so the user keeps
  // their place. gps is guaranteed for any rendered marker, but guard anyway.
  function flyToCemetery(story) {
    if (!story?.gps) return;
    mapRef.current?.animateToRegion(
      { latitude: story.gps.lat, longitude: story.gps.lng, latitudeDelta: 0.008, longitudeDelta: 0.008 },
      700
    );
  }

  const panelTitle = loading
    ? 'Loading shared stories…'
    : fetchError
      ? 'Failed to load'
      : stories.length === 0
        ? 'No shared stories yet'
        : `${stories.length} shared ${stories.length === 1 ? 'story' : 'stories'}`;

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
          <Globe size={16} color={colors.flame} />
          <Text style={styles.headerTitle}>Community Map</Text>
        </View>
        {/* Home shortcut. This is a top-level browse screen with no in-memory
            unsaved story to protect (it only shows public community stories),
            so Home navigates directly — no discard guard. navigate('Home') pops
            to the existing root Home rather than pushing a duplicate. */}
        <TouchableOpacity
          onPress={() => navigation.navigate('Home')}
          style={[styles.headerSide, styles.headerSideRight]}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Go to home screen"
        >
          <Text style={styles.backText}>Home</Text>
        </TouchableOpacity>
      </View>

      {/* Guest banner */}
      {!user && (
        <TouchableOpacity style={styles.guestBanner} onPress={() => navigation.navigate('Auth')} activeOpacity={0.7}>
          <Text style={styles.guestBannerText}>
            Guest view · 50 most recent · Sign in for 500
          </Text>
        </TouchableOpacity>
      )}

      {/* Map */}
      <View style={styles.mapContainer}>
        <MapView
          ref={mapRef}
          style={styles.map}
          initialRegion={DEFAULT_REGION}
          onPress={() => { setSelectedStory(null); setBioExpanded(false); }}
        >
          {stories.filter(s => s.gps).map((story, i) => (
            <GlobalGraveMarker
              key={`${story.id ?? i}-${story.marker_style || 'book'}`}
              story={story}
              onPress={() => { setSelectedStory(story); setBioExpanded(false); }}
            />
          ))}
        </MapView>

        {loading && (
          <View style={styles.loadingBadge}>
            <ActivityIndicator size="small" color={colors.flame} style={{ marginRight: 8 }} />
            <Text style={styles.loadingText}>Loading…</Text>
          </View>
        )}

        {/* Floating callout — replaces <Callout> which swallows touch events on Android */}
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
            <Text style={styles.calloutContrib}>Shared by {selectedStory._contributor}</Text>
            {(selectedStory._lowConfidence && !selectedStory.userCorrected) && (
              <Text style={styles.calloutWarn}>⚠ approximate location</Text>
            )}

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
                onPress={() => { setSelectedStory(null); setBioExpanded(false); navigation.navigate('Result', { story: selectedStory }); }}
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

      {/* Bottom panel */}
      <View style={[styles.panel, { paddingBottom: insets.bottom + 8 }]}>
        <Text style={styles.panelTitle}>{panelTitle}</Text>
        <View style={styles.panelDivider} />
        <ScrollView
          style={styles.graveList}
          showsVerticalScrollIndicator={false}
          refreshControl={refreshControl}
        >
          {fetchError ? (
            <Text style={styles.errorText}>{fetchError}</Text>
          ) : stories.length === 0 && !loading ? (
            <Text style={styles.emptyText}>
              No public stories yet.{'\n'}Share one of yours from its bio page to be first on the map.
            </Text>
          ) : (
            stories.map((story, i) => (
              <View key={story.id ?? i} style={styles.graveItem}>
                <TouchableOpacity style={styles.graveItemMain} onPress={() => flyTo(story)} activeOpacity={0.7}>
                  <Text style={styles.graveName} numberOfLines={1}>{story.name || 'Unknown'}</Text>
                  {!!story.dates && <Text style={styles.graveDates}>{story.dates}</Text>}
                </TouchableOpacity>
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

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: colors.line,
    backgroundColor: colors.stone,
  },
  headerSide: { width: 80 },
  // Right-align the Home label in its fixed 80px slot so the header reads
  // Back (left) · title (center) · Home (right) symmetrically.
  headerSideRight: { alignItems: 'flex-end' },
  headerCenter: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  backText: { color: colors.ashDim, fontSize: 15, fontFamily: fonts.body },
  headerTitle: { color: colors.parchment, fontSize: 16, fontFamily: fonts.name, letterSpacing: 0.3 },

  guestBanner: {
    backgroundColor: 'rgba(170,190,220,0.07)',
    borderBottomWidth: 1, borderBottomColor: 'rgba(170,190,220,0.15)',
    paddingHorizontal: 16, paddingVertical: 9,
  },
  guestBannerText: { color: colors.silver, fontSize: 12, fontFamily: fonts.body, textAlign: 'center', letterSpacing: 0.3 },

  mapContainer: { flex: 1, position: 'relative' },
  map: { flex: 1 },

  loadingBadge: {
    position: 'absolute', top: 12, right: 12,
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(20,16,11,0.9)',
    borderWidth: 1, borderColor: colors.line,
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: radius.sm,
  },
  loadingText: { color: colors.parchment, fontSize: 12, fontFamily: fonts.body, letterSpacing: 0.5 },

  // Symmetric padding so the corner badge stays INSIDE the snapshot bounds (rn-maps
  // rasterizes the marker view; a negative-offset badge gets clipped by the bitmap —
  // see CemeteryMapScreen for the full rationale). Equal padding keeps the SVG centered
  // on the coordinate (the Marker has no explicit anchor).
  markerShadow: {
    padding: 6,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.6, shadowRadius: 2, elevation: 4,
  },
  markerLowConf: { opacity: 0.75 },
  markerBadge: {
    position: 'absolute', top: 0, right: 0, width: 14, height: 14, borderRadius: 7,
    backgroundColor: 'rgba(60,40,20,0.95)', borderWidth: 1, borderColor: '#c9a84c',
    alignItems: 'center', justifyContent: 'center',
  },
  markerBadgeText: {
    color: '#e8d4a0', fontSize: 9, fontWeight: 'bold',
    textAlign: 'center', textAlignVertical: 'center', includeFontPadding: false,
  },

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
  calloutLocation: { color: colors.ashDim, fontSize: 12, fontFamily: fonts.body, marginBottom: 4 },
  calloutContrib: { color: colors.silver, fontSize: 11, fontFamily: fonts.body, fontStyle: 'italic', marginBottom: 4 },
  calloutWarn: { color: colors.ember, fontSize: 11, fontFamily: fonts.body, marginBottom: 6 },
  calloutBioScroll: { maxHeight: 140, marginBottom: 8 },
  // Vertical padding on the scroll CONTENT (not the Text) so the serif font's
  // first-line ascenders and last-line descenders aren't clipped by the
  // ScrollView's clip rect on Android (mirrors CemeteryMapScreen).
  calloutBioContent: { paddingTop: 3, paddingBottom: 6 },
  calloutBioText: { color: colors.ash, fontSize: 13, fontFamily: fonts.serif, lineHeight: 21 },
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
    paddingVertical: 9,
    borderBottomWidth: 1, borderBottomColor: colors.line,
    gap: 8,
  },
  graveItemMain: { flex: 1 },
  graveName: { color: colors.parchment, fontSize: 14, fontFamily: fonts.name },
  graveDates: { color: colors.ash, fontSize: 12, fontFamily: fonts.bodyItalic, marginTop: 1 },

  storyBtn: {
    borderWidth: 1, borderColor: 'rgba(170,190,220,0.25)',
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.sm,
  },
  storyBtnText: { color: colors.silver, fontSize: 12, fontFamily: fonts.body },

  emptyText: {
    color: colors.ash, fontFamily: fonts.bodyItalic,
    textAlign: 'center', lineHeight: 22, marginTop: 8,
  },
  errorText: {
    color: colors.danger, fontFamily: fonts.body,
    textAlign: 'center', lineHeight: 22, marginTop: 8,
  },
});
