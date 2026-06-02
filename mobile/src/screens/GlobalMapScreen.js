import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView, StyleSheet, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import MapView, { Marker, Callout } from 'react-native-maps';
import { supabase } from '../lib/supabase';

const GOLD     = '#c9a84c';
const INK      = '#0d0b08';
const PARCHMENT = '#e8d4a0';
const STONE    = 'rgba(138,126,110,0.7)';
const SILVER   = '#aabedc';

// World view — map will fit to markers after load
const DEFAULT_REGION = {
  latitude: 30,
  longitude: -20,
  latitudeDelta: 110,
  longitudeDelta: 130,
};

const CACHE_TTL_MS = 5 * 60 * 1000;

// Module-level cache (survives screen unmount within the same app session)
let _cache = null;
let _cacheTime = 0;
let _cacheUserId = null; // 'guest' or the user's id

export default function GlobalMapScreen({ navigation }) {
  const mapRef = useRef(null);
  const [user, setUser] = useState(null);
  const [stories, setStories] = useState([]);
  const [loading, setLoading] = useState(true);

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
          name: row.name,
          dates: row.dates,
          biography: row.biography,
          location: row.location,
          inscription: row.inscription,
          symbols: row.symbols,
          family_name: row.family_name,
          notes: row.notes,
          sources: row.sources,
          source_urls: row.source_urls,
          gps: { lat: row.latitude, lng: row.longitude },
          userCorrected: row.user_corrected,
          _lowConfidence: row.low_confidence,
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

  function flyTo(story) {
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
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backSide}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Community Map</Text>
        <View style={styles.backSide} />
      </View>

      {/* Guest banner */}
      {!user && (
        <TouchableOpacity style={styles.guestBanner} onPress={() => navigation.navigate('Auth')}>
          <Text style={styles.guestBannerText}>
            Guest view · showing 50 most recent · tap to sign in for 500
          </Text>
        </TouchableOpacity>
      )}

      {/* Map */}
      <View style={styles.mapContainer}>
        <MapView ref={mapRef} style={styles.map} initialRegion={DEFAULT_REGION}>
          {stories.map((story, i) => (
            <Marker
              key={story.id ?? i}
              coordinate={{ latitude: story.gps.lat, longitude: story.gps.lng }}
            >
              {/* Silver marker — visually distinct from the gold personal pins */}
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
            <ActivityIndicator size="small" color={GOLD} style={{ marginRight: 8 }} />
            <Text style={styles.loadingText}>Loading…</Text>
          </View>
        )}
      </View>

      {/* Bottom panel */}
      <View style={styles.panel}>
        <Text style={styles.panelTitle}>✦ {panelTitle}</Text>
        <View style={styles.panelDivider} />
        <ScrollView style={styles.graveList} showsVerticalScrollIndicator={false}>
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
  container: { flex: 1, backgroundColor: INK },

  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: 'rgba(201,168,76,0.15)',
  },
  backSide: { width: 80 },
  backText: { color: 'rgba(201,168,76,0.7)', fontSize: 15 },
  headerTitle: { color: PARCHMENT, fontSize: 16, letterSpacing: 1, fontWeight: '600' },

  guestBanner: {
    backgroundColor: 'rgba(170,190,220,0.1)',
    borderBottomWidth: 1, borderBottomColor: 'rgba(170,190,220,0.2)',
    paddingHorizontal: 16, paddingVertical: 8,
  },
  guestBannerText: { color: SILVER, fontSize: 12, textAlign: 'center', letterSpacing: 0.5 },

  mapContainer: { flex: 1, position: 'relative' },
  map: { flex: 1 },

  loadingBadge: {
    position: 'absolute', top: 12, right: 12,
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(13,11,8,0.88)',
    borderWidth: 1, borderColor: 'rgba(170,190,220,0.35)',
    paddingHorizontal: 12, paddingVertical: 6, borderRadius: 4,
  },
  loadingText: { color: PARCHMENT, fontSize: 12, letterSpacing: 0.5 },

  // Silver-tinted markers for community stories
  markerOuter: { alignItems: 'center' },
  markerInner: {
    backgroundColor: 'rgba(30,40,55,0.92)',
    borderWidth: 1.5, borderColor: SILVER,
    borderRadius: 4, paddingHorizontal: 7, paddingVertical: 4,
  },
  markerLowConf: { borderColor: '#7a8a9a', opacity: 0.75 },
  markerCross: { color: SILVER, fontSize: 15 },

  callout: { minWidth: 160, maxWidth: 260, padding: 10 },
  calloutName: { fontWeight: '700', fontSize: 15, marginBottom: 2, color: '#1a1410' },
  calloutDates: { fontSize: 13, color: '#666', fontStyle: 'italic', marginBottom: 2 },
  calloutLocation: { fontSize: 12, color: '#888', marginBottom: 2 },
  calloutContrib: { fontSize: 11, color: '#7a8a9a', fontStyle: 'italic', marginBottom: 4 },
  calloutAction: { fontSize: 12, color: '#3d5a85', fontWeight: '600' },

  panel: {
    height: 220,
    backgroundColor: 'rgba(13,11,8,0.97)',
    borderTopWidth: 1, borderTopColor: 'rgba(170,190,220,0.2)',
    paddingHorizontal: 16, paddingTop: 14, paddingBottom: 8,
  },
  panelTitle: {
    color: STONE, fontSize: 11, letterSpacing: 2,
    textTransform: 'uppercase', marginBottom: 8,
  },
  panelDivider: { height: 1, backgroundColor: 'rgba(170,190,220,0.15)', marginBottom: 10 },
  graveList: { flex: 1 },

  graveItem: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: 'rgba(170,190,220,0.08)',
    gap: 8,
  },
  graveItemMain: { flex: 1 },
  graveName: { color: PARCHMENT, fontSize: 14, fontWeight: '600' },
  graveDates: { color: STONE, fontSize: 12, fontStyle: 'italic', marginTop: 1 },

  storyBtn: {
    borderWidth: 1, borderColor: 'rgba(170,190,220,0.35)',
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 3,
  },
  storyBtnText: { color: SILVER, fontSize: 12 },

  emptyText: {
    color: STONE, fontStyle: 'italic', textAlign: 'center', lineHeight: 22, marginTop: 8,
  },
});
