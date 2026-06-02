import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet, ActivityIndicator, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import MapView, { Marker, Callout } from 'react-native-maps';
import { supabase } from '../lib/supabase';
import { colors, fonts, radius } from '../lib/theme';
import { Globe } from '../components/Icons';

const DEFAULT_REGION = { latitude: 30, longitude: -20, latitudeDelta: 110, longitudeDelta: 130 };
const CACHE_TTL_MS = 5 * 60 * 1000;

let _cache = null;
let _cacheTime = 0;
let _cacheUserId = null;

export default function GlobalMapScreen({ navigation }) {
  const mapRef = useRef(null);
  const [user, setUser]         = useState(null);
  const [stories, setStories]   = useState([]);
  const [loading, setLoading]   = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      const u = session?.user ?? null;
      setUser(u);
      fetchStories(u);
    });
  }, []);

  async function fetchStories(currentUser) {
    const cacheKey = currentUser ? currentUser.id : 'guest';
    if (_cache && _cacheUserId === cacheKey && Date.now() - _cacheTime < CACHE_TTL_MS) {
      setStories(_cache);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const limit = currentUser ? 500 : 50;
      const { data, error } = await supabase.rpc('global_public_stories', { p_limit: limit });
      if (error) throw error;
      const mapped = (data || [])
        .filter(row => row.latitude != null && row.longitude != null)
        .map(row => ({
          id: row.id,
          timestamp: row.client_timestamp || new Date(row.created_at).getTime(),
          name: row.name, dates: row.dates, biography: row.biography,
          location: row.location, inscription: row.inscription, symbols: row.symbols,
          family_name: row.family_name, notes: row.notes,
          sources: row.sources, source_urls: row.source_urls,
          gps: { lat: row.latitude, lng: row.longitude },
          userCorrected: row.user_corrected, _lowConfidence: row.low_confidence,
          is_public: true,
          image_url: row.image_url || null,
          portrait_left_url: row.portrait_left_url || null,
          portrait_right_url: row.portrait_right_url || null,
          _contributor: row.contributor_name || 'Anonymous',
          _isGlobal: true,
        }));
      _cache = mapped;
      _cacheTime = Date.now();
      _cacheUserId = cacheKey;
      setStories(mapped);
      setLoading(false);
      if (mapped.length > 0) {
        setTimeout(() => {
          if (mapped.length === 1) {
            mapRef.current?.animateToRegion(
              { latitude: mapped[0].gps.lat, longitude: mapped[0].gps.lng, latitudeDelta: 0.05, longitudeDelta: 0.05 },
              800
            );
          } else {
            mapRef.current?.fitToCoordinates(
              mapped.map(s => ({ latitude: s.gps.lat, longitude: s.gps.lng })),
              { edgePadding: { top: 60, right: 40, bottom: 280, left: 40 }, animated: true }
            );
          }
        }, 600);
      }
    } catch (e) {
      console.warn('GlobalMapScreen fetch failed:', e.message);
      setLoading(false);
    }
  }

  async function onRefresh() {
    setRefreshing(true);
    _cache = null;
    const { data: { session } } = await supabase.auth.getSession();
    await fetchStories(session?.user ?? null);
    setRefreshing(false);
  }

  function flyTo(story) {
    if (!story.gps) return;
    mapRef.current?.animateToRegion(
      { latitude: story.gps.lat, longitude: story.gps.lng, latitudeDelta: 0.0006, longitudeDelta: 0.0006 },
      700
    );
  }

  const panelTitle = loading
    ? 'Loading shared stories…'
    : stories.length === 0
      ? 'No shared stories yet'
      : `${stories.length} shared ${stories.length === 1 ? 'story' : 'stories'}`;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.headerSide}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Globe size={16} color={colors.flame} />
          <Text style={styles.headerTitle}>Community Map</Text>
        </View>
        <View style={styles.headerSide} />
      </View>

      {/* Guest banner */}
      {!user && (
        <TouchableOpacity style={styles.guestBanner} onPress={() => navigation.navigate('Auth')}>
          <Text style={styles.guestBannerText}>
            Guest view · 50 most recent · Sign in for 500
          </Text>
        </TouchableOpacity>
      )}

      {/* Map */}
      <View style={styles.mapContainer}>
        <MapView ref={mapRef} style={styles.map} initialRegion={DEFAULT_REGION}>
          {stories.filter(s => s.gps).map((story, i) => (
            <Marker key={story.id ?? i} coordinate={{ latitude: story.gps.lat, longitude: story.gps.lng }}>
              <View style={styles.markerOuter}>
                <View style={[styles.markerInner, story._lowConfidence && styles.markerLowConf]}>
                  <Text style={styles.markerCross}>✝</Text>
                </View>
              </View>
              <Callout onPress={() => navigation.navigate('Result', { story })}>
                <View style={styles.callout}>
                  <Text style={styles.calloutName}>{story.name || 'Unknown'}</Text>
                  {!!story.dates && <Text style={styles.calloutDates}>{story.dates}</Text>}
                  {!!story.location && <Text style={styles.calloutLocation}>{story.location}</Text>}
                  <Text style={styles.calloutContrib}>Shared by {story._contributor}</Text>
                  <Text style={styles.calloutAction}>Tap to view story →</Text>
                </View>
              </Callout>
            </Marker>
          ))}
        </MapView>

        {loading && (
          <View style={styles.loadingBadge}>
            <ActivityIndicator size="small" color={colors.flame} style={{ marginRight: 8 }} />
            <Text style={styles.loadingText}>Loading…</Text>
          </View>
        )}
      </View>

      {/* Bottom panel */}
      <View style={styles.panel}>
        <Text style={styles.panelTitle}>{panelTitle}</Text>
        <View style={styles.panelDivider} />
        <ScrollView
          style={styles.graveList}
          showsVerticalScrollIndicator={false}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.flame} colors={[colors.flame]} />}
        >
          {stories.length === 0 && !loading ? (
            <Text style={styles.emptyText}>
              No public stories yet.{'\n'}Share one of yours from its bio page to be first on the map.
            </Text>
          ) : (
            stories.map((story, i) => (
              <View key={story.id ?? i} style={styles.graveItem}>
                <TouchableOpacity style={styles.graveItemMain} onPress={() => flyTo(story)}>
                  <Text style={styles.graveName} numberOfLines={1}>{story.name || 'Unknown'}</Text>
                  {!!story.dates && <Text style={styles.graveDates}>{story.dates}</Text>}
                </TouchableOpacity>
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
  container: { flex: 1, backgroundColor: colors.ink },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: colors.line,
    backgroundColor: colors.stone,
  },
  headerSide: { width: 80 },
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

  markerOuter: { alignItems: 'center' },
  markerInner: {
    backgroundColor: 'rgba(30,40,55,0.92)',
    borderWidth: 1.5, borderColor: colors.silver,
    borderRadius: 4, paddingHorizontal: 7, paddingVertical: 4,
  },
  markerLowConf: { borderColor: '#7a8a9a', opacity: 0.75 },
  markerCross: { color: colors.silver, fontSize: 15 },

  callout: { minWidth: 160, maxWidth: 260, padding: 10 },
  calloutName: { fontWeight: '700', fontSize: 15, marginBottom: 2, color: '#1a1410' },
  calloutDates: { fontSize: 13, color: '#666', fontStyle: 'italic', marginBottom: 2 },
  calloutLocation: { fontSize: 12, color: '#888', marginBottom: 2 },
  calloutContrib: { fontSize: 11, color: '#7a8a9a', fontStyle: 'italic', marginBottom: 4 },
  calloutAction: { fontSize: 12, color: '#3d5a85', fontWeight: '600' },

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
});
