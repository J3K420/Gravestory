import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView,
  StyleSheet, StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../lib/supabase';
import { syncOnSignIn, syncDelta } from '../lib/sync';
import { useRefresh } from '../lib/use-refresh';
import { colors, fonts, radius } from '../lib/theme';
import GravestoneLogo from '../components/GravestoneLogo';
import { MapStack, Globe } from '../components/Icons';

export default function HomeScreen({ navigation }) {
  const [user, setUser] = useState(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
      const newUser = session?.user ?? null;
      setUser(newUser);
      if (event === 'SIGNED_IN' && newUser) {
        syncOnSignIn(newUser);
      }
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      async function refresh() {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user && active) syncDelta(session.user);
      }
      refresh();
      return () => { active = false; };
    }, [])
  );

  const { refreshControl } = useRefresh(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user) await syncDelta(session.user);
  });

  const displayName = user?.user_metadata?.full_name
    || user?.email?.split('@')[0]
    || null;

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={colors.ink} />

      <TouchableOpacity
        style={styles.userBtn}
        onPress={() => navigation.navigate(user ? 'Settings' : 'Auth')}
      >
        <Text style={styles.userBtnText}>{displayName ?? 'Sign in'}</Text>
      </TouchableOpacity>

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={refreshControl}
      >

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

        <Text style={styles.tagline}>
          Other apps show you the grave. GraveStory discovers the life that was.
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

        {/* Remembered stories nav button */}
        <TouchableOpacity
          style={styles.savedBtn}
          onPress={() => navigation.navigate('RememberedStories')}
        >
          <Text style={styles.savedBtnText}>✦ Remembered Stories</Text>
        </TouchableOpacity>
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
  tagline: {
    color: colors.flame, fontFamily: fonts.serifItalic, fontSize: 13,
    textAlign: 'center', marginTop: 12, opacity: 0.45, maxWidth: 280, lineHeight: 20,
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

});
