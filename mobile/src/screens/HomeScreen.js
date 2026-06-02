import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView,
  StyleSheet, StatusBar, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../lib/supabase';
import { loadStories, saveStories } from '../lib/storage';
import { syncOnSignIn, syncDelta, cloudDeleteStory } from '../lib/sync';
import { colors, fonts, radius } from '../lib/theme';
import GravestoneLogo from '../components/GravestoneLogo';
import { Headstone, MapStack, Globe } from '../components/Icons';

export default function HomeScreen({ navigation }) {
  const [user, setUser] = useState(null);
  const [stories, setStories] = useState([]);
  const [storiesLoaded, setStoriesLoaded] = useState(false);
  const scrollRef = useRef(null);
  const [savedSectionY, setSavedSectionY] = useState(0);

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
      if (event === 'SIGNED_OUT') {
        loadStories(null).then(guestStories => setStories(guestStories));
      }
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      async function refresh() {
        const { data: { session } } = await supabase.auth.getSession();
        const uid = session?.user?.id ?? null;
        const local = await loadStories(uid);
        if (active) { setStories(local); setStoriesLoaded(true); }
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
            const { data: { session } } = await supabase.auth.getSession();
            await saveStories(updated, session?.user?.id ?? null);
            if (session?.user) await cloudDeleteStory(story, session.user);
          },
        },
      ]
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={colors.ink} />

      <TouchableOpacity
        style={styles.userBtn}
        onPress={() => navigation.navigate(user ? 'Settings' : 'Auth')}
      >
        <Text style={styles.userBtnText}>{displayName ?? 'Sign in'}</Text>
      </TouchableOpacity>

      <ScrollView ref={scrollRef} contentContainerStyle={styles.scroll}>

        {/* Logo */}
        <View style={styles.logoArea}>
          <GravestoneLogo size={240} />
          <Text style={styles.logoTitle}>GraveStory</Text>
          <Text style={styles.logoSubtitle}>every life deserves to be remembered</Text>
        </View>

        <View style={styles.divider} />

        {/* Primary scan CTA */}
        <TouchableOpacity onPress={() => navigation.navigate('Camera')} activeOpacity={0.88} style={styles.scanBtn}>
          <Text style={styles.scanBtnText}>✦ Scan a Gravestone ✦</Text>
        </TouchableOpacity>

        <Text style={styles.desc}>
          Photograph a gravestone. We'll uncover the story of the life it marks.
        </Text>

        {/* Map buttons */}
        <View style={styles.mapRow}>
          <TouchableOpacity style={styles.mapBtn} onPress={() => navigation.navigate('CemeteryMap')}>
            <MapStack size={15} color={colors.ash} />
            <Text style={styles.mapBtnText}>My Map</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.mapBtn, styles.mapBtnCommunity]} onPress={() => navigation.navigate('GlobalMap')}>
            <Globe size={15} color={colors.silver} />
            <Text style={[styles.mapBtnText, { color: colors.silver }]}>Community Map</Text>
          </TouchableOpacity>
        </View>

        {/* Saved stories scroll button */}
        <TouchableOpacity
          style={styles.savedBtn}
          onPress={() => scrollRef.current?.scrollTo({ y: savedSectionY, animated: true })}
        >
          <Text style={styles.savedBtnText}>✦ Remembered Stories</Text>
        </TouchableOpacity>

        {/* Saved stories section */}
        <View style={styles.savedSection} onLayout={e => setSavedSectionY(e.nativeEvent.layout.y)}>
          <Text style={styles.savedLabel}>Remembered Stories</Text>

          {storiesLoaded && stories.length === 0 ? (
            <View style={styles.emptyState}>
              <GravestoneLogo size={80} animate={false} />
              <Text style={styles.emptyTitle}>No stories yet</Text>
              <Text style={styles.emptySaved}>Tap Scan above to photograph your first gravestone</Text>
            </View>
          ) : (
            stories.map((story, i) => (
              <View key={story.timestamp ?? i} style={styles.savedCard}>
                <View style={styles.savedAvatar}>
                  <Headstone size={17} color={colors.ash} />
                </View>
                <TouchableOpacity
                  style={styles.savedCardMain}
                  onPress={() => navigation.navigate('Result', { story })}
                >
                  <Text style={styles.savedName}>{story.name || 'Unknown'}</Text>
                  <Text style={styles.savedDates}>{story.dates || ''}</Text>
                </TouchableOpacity>
                {story.is_public && <Text style={styles.publicBadge}>public</Text>}
                <Text style={styles.savedArrow}>›</Text>
                <TouchableOpacity
                  style={styles.deleteBtn}
                  onPress={() => confirmDelete(story)}
                  hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
                >
                  <Text style={styles.deleteBtnText}>✕</Text>
                </TouchableOpacity>
              </View>
            ))
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.ink },
  scroll: { alignItems: 'center', padding: 24, paddingBottom: 48 },

  userBtn: {
    position: 'absolute', top: 56, right: 16, zIndex: 10,
    borderWidth: 1, borderColor: colors.line,
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: radius.sm,
    backgroundColor: colors.stone,
  },
  userBtnText: { color: colors.flame, fontSize: 13, fontFamily: fonts.body },

  logoArea: { marginTop: 80, marginBottom: 32, alignItems: 'center' },
  logoTitle: {
    fontSize: 42, color: colors.parchment, letterSpacing: 1, marginBottom: 8,
    fontFamily: fonts.title,
  },
  logoSubtitle: {
    fontSize: 13, color: colors.ash, fontFamily: fonts.bodyItalic, letterSpacing: 0.5,
  },

  divider: { width: 120, height: 1, marginVertical: 24, backgroundColor: colors.flame, opacity: 0.4 },

  scanBtn: {
    width: '100%', paddingVertical: 16, paddingHorizontal: 32, borderRadius: radius.md,
    alignItems: 'center', justifyContent: 'center', backgroundColor: colors.flame,
  },
  scanBtnText: {
    color: colors.onFlame, fontSize: 16, letterSpacing: 1.5, fontFamily: fonts.sansBold,
  },

  desc: {
    color: colors.ash, fontFamily: fonts.bodyItalic, marginTop: 20,
    textAlign: 'center', lineHeight: 22, maxWidth: 280,
  },

  mapRow: { flexDirection: 'row', gap: 10, marginTop: 16, width: '100%' },
  mapBtn: {
    flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6,
    borderWidth: 1, borderColor: colors.line,
    backgroundColor: colors.stone2,
    paddingVertical: 13, borderRadius: radius.sm,
  },
  mapBtnCommunity: { borderColor: 'rgba(170,190,220,0.2)' },
  mapBtnText: { color: colors.ash, fontSize: 13, fontFamily: fonts.body },

  savedBtn: {
    marginTop: 16, width: '100%',
    borderWidth: 1, borderColor: colors.line,
    backgroundColor: colors.stone2,
    paddingVertical: 14, borderRadius: radius.sm,
  },
  savedBtnText: { color: colors.flame, fontSize: 13, letterSpacing: 2, textAlign: 'center', fontFamily: fonts.body },

  savedSection: { marginTop: 40, width: '100%' },
  savedLabel: {
    color: colors.ashDim, fontSize: 10, letterSpacing: 3, fontFamily: fonts.body,
    textTransform: 'uppercase', marginBottom: 12, textAlign: 'center',
  },

  emptyState: { alignItems: 'center', paddingVertical: 32 },
  emptyTitle: { color: colors.parchment, fontSize: 18, marginTop: 16, marginBottom: 8, fontFamily: fonts.title },
  emptySaved: { color: colors.ash, fontFamily: fonts.bodyItalic, textAlign: 'center', opacity: 0.6, maxWidth: 260 },

  savedCard: {
    flexDirection: 'row', alignItems: 'center',
    borderWidth: 1, borderColor: colors.line,
    padding: 11, marginBottom: 10, borderRadius: radius.sm,
    backgroundColor: colors.stone2, gap: 11,
  },
  savedAvatar: {
    width: 34, height: 34, borderRadius: 9,
    backgroundColor: colors.stone,
    alignItems: 'center', justifyContent: 'center',
  },
  savedCardMain: { flex: 1, paddingVertical: 2 },
  savedName: { color: colors.parchment, fontSize: 15, marginBottom: 2, fontFamily: fonts.name },
  savedDates: { color: colors.ashDim, fontSize: 12, fontFamily: fonts.bodyItalic },
  publicBadge: {
    color: colors.silver, fontSize: 10, letterSpacing: 1, fontFamily: fonts.body,
    textTransform: 'uppercase', marginRight: 4,
  },
  savedArrow: { color: colors.flame, fontSize: 20 },
  deleteBtn: { paddingLeft: 12 },
  deleteBtnText: { color: colors.dangerDim, fontSize: 15, fontFamily: fonts.body },
});
