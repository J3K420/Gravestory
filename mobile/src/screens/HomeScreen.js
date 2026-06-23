import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView,
  StyleSheet, StatusBar,
} from 'react-native';
import Svg, { Defs, RadialGradient, Stop, Ellipse } from 'react-native-svg';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../lib/supabase';
import { syncOnSignIn, syncDelta } from '../lib/sync';
import { useRefresh } from '../lib/use-refresh';
import { hasOnboarded, setOnboarded } from '../lib/storage';
import { SAMPLE_STORY } from '../lib/sample-story';
import { logEvent, EVENTS } from '../lib/analytics';
import { colors, fonts, radius } from '../lib/theme';
import GravestoneLogo from '../components/GravestoneLogo';
import { MapStack, Globe } from '../components/Icons';

// Static candlelit aura that sits BEHIND the gravestone logo so the hero feels
// lit from within — the same warm radial technique as the loading/viewfinder
// glow (RN-SVG has no real blur, so the soft edge is the gradient falloff).
// Deliberately static: the logo carries its own candle-flicker animation, and a
// second moving light would fight it. Sized to bloom past the 240px logo.
function LogoHalo({ size = 300 }) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      // Centre the bloom on the stage: pull up/left by half the size so the
      // halo radiates symmetrically around the logo rather than from a corner.
      style={[styles.haloAbs, { marginLeft: -size / 2, marginTop: -size / 2 }]}
      pointerEvents="none"
    >
      <Defs>
        <RadialGradient id="homeHalo" cx="0.5" cy="0.5" r="0.5">
          <Stop offset="0"    stopColor="#f2d79a" stopOpacity="0.30" />
          <Stop offset="0.42" stopColor="#f2b65c" stopOpacity="0.14" />
          <Stop offset="1"    stopColor="#f2b65c" stopOpacity="0" />
        </RadialGradient>
      </Defs>
      {/* Slightly tall so the warmth pools around the tablet, not a flat disc. */}
      <Ellipse cx="50" cy="50" rx="46" ry="50" fill="url(#homeHalo)" />
    </Svg>
  );
}

export default function HomeScreen({ navigation }) {
  const [user, setUser] = useState(null);
  // First-run tip card: shown once until dismissed. Starts false so it never
  // flashes for returning users before the async flag check resolves.
  const [showTip, setShowTip] = useState(false);

  useEffect(() => {
    hasOnboarded().then(seen => { if (!seen) setShowTip(true); });
  }, []);

  function openSample() {
    logEvent(EVENTS.SAMPLE_VIEWED, {});
    navigation.navigate('Result', { story: SAMPLE_STORY });
  }

  function dismissTip() {
    setShowTip(false);
    setOnboarded();
  }

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
        activeOpacity={0.7}
      >
        <Text style={styles.userBtnText}>{displayName ?? 'Sign in'}</Text>
      </TouchableOpacity>

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={refreshControl}
      >

        {/* Hero — candlelit aura behind the (untouched) flickering gravestone logo */}
        <View style={styles.logoArea}>
          <View style={styles.logoStage}>
            <LogoHalo size={300} />
            <GravestoneLogo size={240} />
          </View>
          <Text style={styles.logoTitle}>GraveStory</Text>
          <Text style={styles.logoSubtitle}>every life deserves to be remembered</Text>
        </View>

        <View style={styles.divider} />

        {/* First-run tip card — shown once. Sets expectations (good photo) and
            surfaces two otherwise-hidden features: the example story and the
            offline-scan queue (cemeteries often have no signal). */}
        {showTip && (
          <View style={styles.tipCard}>
            <Text style={styles.tipTitle}>Welcome — here's how it works</Text>
            <Text style={styles.tipBody}>
              Photograph a gravestone with the inscription filling the frame, and GraveStory
              uncovers the life behind it. Taking the photo at the cemetery pins the grave on
              your map. No signal out there? Scan anyway — it saves the photo and researches
              once you're back online.
            </Text>
            <View style={styles.tipBtnRow}>
              <TouchableOpacity style={styles.tipPrimaryBtn} onPress={openSample} activeOpacity={0.85}>
                <Text style={styles.tipPrimaryBtnText}>See an Example</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.tipDismissBtn} onPress={dismissTip} activeOpacity={0.85}>
                <Text style={styles.tipDismissBtnText}>Got it</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Primary scan CTA */}
        <TouchableOpacity onPress={() => navigation.navigate('Camera')} activeOpacity={0.88} style={styles.scanBtn}>
          <Text style={styles.scanBtnText}>Scan a Gravestone</Text>
        </TouchableOpacity>

        <Text style={styles.desc}>
          Photograph a gravestone — we'll uncover the story of the life it marks.
        </Text>

        {/* Persistent example link (always available, not just first run) */}
        <TouchableOpacity onPress={openSample} activeOpacity={0.7}>
          <Text style={styles.exampleLink}>See an example story ›</Text>
        </TouchableOpacity>

        <Text style={styles.tagline}>
          Other apps show you the grave. GraveStory discovers the life that was.
        </Text>

        {/* Map buttons */}
        <View style={styles.mapRow}>
          <TouchableOpacity style={styles.mapBtn} onPress={() => navigation.navigate('CemeteryMap')} activeOpacity={0.85}>
            <MapStack size={15} color={colors.ash} />
            <Text style={styles.mapBtnText}>My Map</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.mapBtn, styles.mapBtnCommunity]} onPress={() => navigation.navigate('GlobalMap')} activeOpacity={0.85}>
            <Globe size={15} color={colors.silver} />
            <Text style={[styles.mapBtnText, { color: colors.silver }]}>Community Map</Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.mapHint}>
          My Map gathers the graves you've scanned. The Community Map shows stories shared by explorers everywhere.
        </Text>

        {/* Remembered stories nav button */}
        <TouchableOpacity
          style={styles.savedBtn}
          onPress={() => navigation.navigate('RememberedStories')}
          activeOpacity={0.85}
        >
          <Text style={styles.savedBtnText}>Remembered Stories</Text>
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

  logoArea: { marginTop: 24, marginBottom: 20, alignItems: 'center' },
  // Stage holds the static halo (absolute fill) behind the flickering logo.
  // Sized to the logo so the aura centres on the stone, not the title below.
  logoStage: {
    width: 240, height: 269, // 240 * 1.12 — matches GravestoneLogo's aspect
    alignItems: 'center', justifyContent: 'center', marginBottom: 4,
  },
  // Halo anchored to the stage centre (top/left 50%); the SVG's negative
  // half-size margins then pull its own centre onto that point.
  haloAbs: { position: 'absolute', top: '50%', left: '50%' },
  logoTitle: {
    fontSize: 42, color: colors.parchment, letterSpacing: 1, marginBottom: 8,
    fontFamily: fonts.title,
  },
  logoSubtitle: {
    fontSize: 13, color: colors.ash, fontFamily: fonts.bodyItalic, letterSpacing: 0.5,
  },

  divider: { width: 120, height: 1, marginVertical: 22, backgroundColor: colors.flame, opacity: 0.4 },

  // Hero CTA — solid gold with a warm cast beneath it so it reads as lit, not a
  // flat slab. Elevation on Android, soft shadow on iOS.
  scanBtn: {
    width: '100%', paddingVertical: 17, paddingHorizontal: 32, borderRadius: radius.md,
    alignItems: 'center', justifyContent: 'center', backgroundColor: colors.flame,
    shadowColor: colors.flame, shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.35, shadowRadius: 14, elevation: 6,
  },
  scanBtnText: {
    color: colors.onFlame, fontSize: 16, letterSpacing: 1.2, fontFamily: fonts.sansBold,
  },

  tipCard: {
    width: '100%', marginBottom: 20,
    backgroundColor: colors.stone2,
    borderWidth: 1, borderColor: colors.line,
    borderLeftWidth: 2, borderLeftColor: colors.flame,
    borderRadius: radius.sm, padding: 16,
  },
  tipTitle: {
    color: colors.flame, fontFamily: fonts.title, fontSize: 16,
    marginBottom: 8, letterSpacing: 0.3,
  },
  tipBody: {
    color: colors.parchment, fontFamily: fonts.body, fontSize: 13,
    lineHeight: 20, marginBottom: 14,
  },
  tipBtnRow: { flexDirection: 'row', gap: 10 },
  tipPrimaryBtn: {
    flex: 1, paddingVertical: 11, alignItems: 'center',
    borderWidth: 1, borderColor: colors.flame, borderRadius: radius.sm,
    backgroundColor: 'rgba(242,182,92,0.1)',
  },
  tipPrimaryBtnText: { color: colors.flame, fontFamily: fonts.body, fontSize: 13, letterSpacing: 0.3 },
  tipDismissBtn: {
    flex: 1, paddingVertical: 11, alignItems: 'center',
    borderWidth: 1, borderColor: colors.line, borderRadius: radius.sm,
  },
  tipDismissBtnText: { color: colors.ash, fontFamily: fonts.body, fontSize: 13, letterSpacing: 0.3 },

  exampleLink: {
    color: colors.flame, fontFamily: fonts.bodyItalic, fontSize: 13,
    textAlign: 'center', marginTop: 12, opacity: 0.85,
  },

  desc: {
    color: colors.ash, fontFamily: fonts.bodyItalic, marginTop: 18,
    textAlign: 'center', lineHeight: 22, maxWidth: 280,
  },
  // Positioning line — relocated to bridge the scan CTA and the map/explore
  // section (was a third restatement directly under the CTA). Quiet by design.
  tagline: {
    color: colors.flame, fontFamily: fonts.serifItalic, fontSize: 13,
    textAlign: 'center', marginTop: 28, opacity: 0.5, maxWidth: 280, lineHeight: 20,
  },

  mapRow: { flexDirection: 'row', gap: 10, marginTop: 18, width: '100%' },
  mapHint: {
    color: colors.ashDim, fontFamily: fonts.bodyItalic, fontSize: 12,
    textAlign: 'center', marginTop: 10, lineHeight: 18, maxWidth: 300,
  },
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
