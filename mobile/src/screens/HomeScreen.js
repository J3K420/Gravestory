import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView,
  StyleSheet, StatusBar, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../lib/supabase';
import { loadStories, saveStories } from '../lib/storage';
import { syncOnSignIn, syncDelta, cloudDeleteStory } from '../lib/sync';
import GravestoneLogo from '../components/GravestoneLogo';

export default function HomeScreen({ navigation }) {
  const [user, setUser] = useState(null);
  const [stories, setStories] = useState([]);
  const [storiesLoaded, setStoriesLoaded] = useState(false);

  // Auth listener: sync from cloud when the user signs in
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      const newUser = session?.user ?? null;
      setUser(newUser);
      if (event === 'SIGNED_IN' && newUser) {
        syncOnSignIn(newUser).then(updated => {
          if (updated) setStories(updated);
        });
      }
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  // On every focus: reload local stories, then pull cloud delta if signed in
  useFocusEffect(
    useCallback(() => {
      let active = true;
      async function refresh() {
        const local = await loadStories();
        if (active) {
          setStories(local);
          setStoriesLoaded(true);
        }

        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user && active) {
          const synced = await syncDelta(session.user);
          if (synced && active) setStories(synced);
        }
      }
      refresh();
      return () => { active = false; };
    }, [])
  );

  const displayName = user?.user_metadata?.full_name
    || user?.email?.split('@')[0]
    || null;

  function confirmDelete(story) {
    Alert.alert(
      'Delete story?',
      `Remove "${story.name || 'this story'}" permanently?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive',
          onPress: async () => {
            const updated = stories.filter(s => s.timestamp !== story.timestamp);
            setStories(updated);
            await saveStories(updated);
            const { data: { session } } = await supabase.auth.getSession();
            if (session?.user) {
              await cloudDeleteStory(story, session.user);
            }
          },
        },
      ]
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0d0b08" />

      {/* User menu */}
      <TouchableOpacity
        style={styles.userBtn}
        onPress={() => navigation.navigate(user ? 'Settings' : 'Auth')}
      >
        <Text style={styles.userBtnText}>{displayName ?? 'Sign in'}</Text>
      </TouchableOpacity>

      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Logo */}
        <View style={styles.logoArea}>
          <GravestoneLogo size={180} />
          <Text style={styles.logoTitle}>GraveStory</Text>
          <Text style={styles.logoSubtitle}>every life deserves to be remembered</Text>
        </View>

        <View style={styles.divider} />

        {/* Scan button */}
        <TouchableOpacity
          style={styles.scanBtn}
          onPress={() => navigation.navigate('Camera')}
        >
          <Text style={styles.scanBtnText}>✦ Scan a Gravestone ✦</Text>
        </TouchableOpacity>

        <Text style={styles.desc}>
          Photograph a gravestone. We'll uncover the story of the life it marks.
        </Text>

        {/* Map buttons */}
        <View style={styles.mapRow}>
          <TouchableOpacity
            style={styles.mapBtn}
            onPress={() => navigation.navigate('CemeteryMap')}
          >
            <Text style={styles.mapBtnText}>My Map</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.mapBtn, styles.mapBtnCommunity]}
            onPress={() => navigation.navigate('GlobalMap')}
          >
            <Text style={styles.mapBtnText}>Community Map</Text>
          </TouchableOpacity>
        </View>

        {/* Saved stories */}
        <View style={styles.savedSection}>
          <Text style={styles.savedLabel}>✦ Remembered Stories</Text>
          {storiesLoaded && stories.length === 0 ? (
            <View style={styles.emptyState}>
              <GravestoneLogo size={80} animate={false} />
              <Text style={styles.emptyTitle}>No stories yet</Text>
              <Text style={styles.emptySaved}>Tap Scan above to photograph your first gravestone</Text>
            </View>
          ) : (
            stories.map((story, i) => (
              <TouchableOpacity
                key={story.timestamp ?? i}
                style={styles.savedCard}
                onPress={() => navigation.navigate('Result', { story })}
                onLongPress={() => confirmDelete(story)}
                delayLongPress={500}
              >
                <View style={styles.savedCardMain}>
                  <Text style={styles.savedName}>{story.name || 'Unknown'}</Text>
                  <Text style={styles.savedDates}>{story.dates || ''}</Text>
                </View>
                {story.is_public && <Text style={styles.publicBadge}>public</Text>}
                <Text style={styles.savedArrow}>›</Text>
              </TouchableOpacity>
            ))
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const GOLD     = '#c9a84c';
const INK      = '#0d0b08';
const PARCHMENT = '#e8d4a0';
const STONE    = 'rgba(138,126,110,0.7)';

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: INK },
  scroll: { alignItems: 'center', padding: 24, paddingBottom: 48 },
  userBtn: {
    position: 'absolute', top: 56, right: 16, zIndex: 10,
    borderWidth: 1, borderColor: 'rgba(201,168,76,0.4)',
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 4,
    backgroundColor: 'rgba(20,15,10,0.6)',
  },
  userBtnText: { color: GOLD, fontSize: 14 },
  logoArea: { marginTop: 80, marginBottom: 32, alignItems: 'center' },
  logoTitle: {
    fontSize: 42, color: PARCHMENT, letterSpacing: 2, marginBottom: 8,
    fontWeight: '700',
  },
  logoSubtitle: { fontSize: 14, color: STONE, fontStyle: 'italic', letterSpacing: 2 },
  divider: {
    width: 120, height: 1, marginVertical: 24,
    backgroundColor: GOLD, opacity: 0.5,
  },
  scanBtn: {
    borderWidth: 1, borderColor: GOLD,
    paddingHorizontal: 32, paddingVertical: 16, borderRadius: 2,
  },
  scanBtnText: { color: GOLD, fontSize: 16, letterSpacing: 2 },
  desc: {
    color: STONE, fontStyle: 'italic', marginTop: 20,
    textAlign: 'center', lineHeight: 22, maxWidth: 280,
  },
  mapRow: {
    flexDirection: 'row', gap: 10, marginTop: 16, width: '100%',
  },
  mapBtn: {
    flex: 1,
    borderWidth: 1, borderColor: 'rgba(201,168,76,0.3)',
    paddingVertical: 14, borderRadius: 2,
  },
  mapBtnCommunity: {
    borderColor: 'rgba(170,190,220,0.3)',
  },
  mapBtnText: { color: STONE, fontSize: 14, letterSpacing: 1, textAlign: 'center' },
  savedSection: { marginTop: 40, width: '100%' },
  savedLabel: {
    color: STONE, fontSize: 11, letterSpacing: 3,
    textTransform: 'uppercase', marginBottom: 12, textAlign: 'center',
  },
  emptyState: { alignItems: 'center', paddingVertical: 32 },
  emptyTitle: { color: PARCHMENT, fontSize: 18, marginTop: 16, marginBottom: 8 },
  emptySaved: { color: STONE, fontStyle: 'italic', textAlign: 'center', opacity: 0.6, maxWidth: 260 },
  savedCard: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    borderWidth: 1, borderColor: 'rgba(201,168,76,0.15)',
    padding: 14, marginBottom: 8,
    backgroundColor: 'rgba(245,240,232,0.04)',
  },
  savedCardMain: { flex: 1 },
  savedName: { color: PARCHMENT, fontSize: 15, marginBottom: 2 },
  savedDates: { color: STONE, fontSize: 13, fontStyle: 'italic' },
  publicBadge: {
    color: 'rgba(170,190,220,0.7)', fontSize: 10, letterSpacing: 1,
    textTransform: 'uppercase', marginRight: 8,
  },
  savedArrow: { color: GOLD, fontSize: 22 },
});
