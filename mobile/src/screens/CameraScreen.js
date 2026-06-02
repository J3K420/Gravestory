import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  Animated, ScrollView, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient, Stop, Rect, Path, Line, Circle } from 'react-native-svg';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as Location from 'expo-location';
import { supabase } from '../lib/supabase';
import { verifyIsGravestone, readGravestone } from '../lib/api-gemini';
import { searchForPerson } from '../lib/api-tavily';
import { searchWikiTree } from '../lib/api-wikitree';
import { fetchWikipediaPortraits } from '../lib/api-wikipedia';
import { generateBiography } from '../lib/biography';
import { saveStories, loadStories } from '../lib/storage';
import { cloudSaveStory, cloudUpdateStory } from '../lib/sync';
import { uploadGravestoneImage } from '../lib/api-r2';

const STEPS = [
  'Verifying gravestone…',
  'Reading inscription…',
  'Searching records…',
  'Building biography…',
  'Finishing up…',
];

export default function CameraScreen({ navigation }) {
  const [loading, setLoading] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const [rejected, setRejected] = useState(null);
  const [pipelineError, setPipelineError] = useState(null);

  async function pickAndAnalyze(fromCamera) {
    setRejected(null);
    setPipelineError(null);

    // exif: true so we can read GPS coords before compression strips them
    const opts = { mediaTypes: ['images'], quality: 0.85, base64: false, exif: true };

    let result;
    if (fromCamera) {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) { Alert.alert('Permission needed', 'Camera access is required.'); return; }
      result = await ImagePicker.launchCameraAsync(opts);
    } else {
      result = await ImagePicker.launchImageLibraryAsync(opts);
    }

    if (result.canceled) return;

    const asset = result.assets[0];

    // Pull GPS from the photo's own EXIF before ImageManipulator strips it.
    // Only fall back to device GPS for camera shots — for library photos the device
    // is not physically at the grave, so device location would be wrong.
    let gps = extractExifGps(asset.exif);
    const needsDeviceGps = !gps && fromCamera;

    const [manipResult, deviceGps] = await Promise.all([
      ImageManipulator.manipulateAsync(
        asset.uri,
        [{ resize: { width: 1024 } }],
        { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG, base64: true }
      ),
      needsDeviceGps ? getDeviceGps() : Promise.resolve(null),
    ]);

    if (!gps) gps = deviceGps;

    await runPipeline(manipResult.base64, false, gps);
  }

  async function runPipeline(base64, skipVerify = false, gps = null) {
    setLoading(true);
    setStepIndex(0);

    try {
      if (!skipVerify) {
        setStepIndex(0);
        try {
          await verifyIsGravestone(base64);
        } catch (err) {
          if (err.__verificationRejection) {
            setRejected({ reason: err.reason, base64, gps });
            setLoading(false);
            return;
          }
          throw err;
        }
      }

      setStepIndex(1);
      const graveData = await readGravestone(base64, null);

      setStepIndex(2);
      const [searchResults, wikiData, portraits] = await Promise.all([
        searchForPerson(graveData, null),
        searchWikiTree(graveData),
        fetchWikipediaPortraits(
          graveData.primary_name || graveData.names?.[0] || '',
          [graveData.birth_date, graveData.death_date].filter(Boolean).join(' ')
        ),
      ]);

      setStepIndex(3);
      const bioResult = await generateBiography(graveData, searchResults, wikiData, null);

      setStepIndex(4);

      // Read default visibility from user metadata
      const { data: { session } } = await supabase.auth.getSession();
      const defaultPublic = session?.user?.user_metadata?.default_public ?? false;

      let story = {
        ...bioResult,
        graveData,
        portraits,
        gps,
        timestamp: Date.now(),
        is_public: defaultPublic,
      };

      // Save locally first so the story is always accessible offline
      const existing = await loadStories();
      await saveStories([story, ...existing]);

      // Attempt cloud save, then R2 image upload, if signed in
      if (session?.user) {
        story = await cloudSaveStory(story, session.user);

        // Upload image to R2 non-blocking — failure is safe to ignore
        const imageUrl = await uploadGravestoneImage(base64);
        if (imageUrl) {
          story = await cloudUpdateStory({ ...story, image_url: imageUrl }, session.user);
        }
      }

      setLoading(false);
      navigation.navigate('Result', { story });
    } catch (err) {
      setLoading(false);
      setPipelineError(err.message || 'Something went wrong. Please try again.');
    }
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingBox}>
          <CandleFlicker />
          <Text style={styles.loadingTitle}>Researching this life…</Text>
          <Text style={styles.loadingStep}>{STEPS[stepIndex]}</Text>
          <View style={styles.dotsRow}>
            {STEPS.map((_, i) => (
              <View key={i} style={[styles.dot, i <= stepIndex && styles.dotActive]} />
            ))}
          </View>
        </View>
      </SafeAreaView>
    );
  }

  if (pipelineError) {
    return (
      <SafeAreaView style={styles.container}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.back}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <View style={styles.rejectedBox}>
          <Text style={styles.rejectedTitle}>Analysis Failed</Text>
          <Text style={styles.rejectedReason}>{pipelineError}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={() => setPipelineError(null)}>
            <Text style={styles.retryText}>Try Again</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (rejected) {
    return (
      <SafeAreaView style={styles.container}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.back}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <View style={styles.rejectedBox}>
          <Text style={styles.rejectedTitle}>Not a Gravestone</Text>
          <Text style={styles.rejectedReason}>{rejected.reason}</Text>
          <TouchableOpacity style={styles.tryAnyway} onPress={() => runPipeline(rejected.base64, true, rejected.gps)}>
            <Text style={styles.tryAnywayText}>Use it anyway</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.retryBtn} onPress={() => setRejected(null)}>
            <Text style={styles.retryText}>Try a different photo</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  function showSourcePicker() {
    Alert.alert(
      'Choose Photo Source',
      null,
      [
        { text: 'Take Photo', onPress: () => pickAndAnalyze(true) },
        { text: 'Choose from Library', onPress: () => pickAndAnalyze(false) },
        { text: 'Cancel', style: 'cancel' },
      ]
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <TouchableOpacity onPress={() => navigation.goBack()} style={styles.back}>
        <Text style={styles.backText}>← Back</Text>
      </TouchableOpacity>

      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.title}>Photograph the Stone</Text>
        <Text style={styles.subtitle}>Frame the gravestone clearly for best results</Text>

        <TouchableOpacity style={styles.stoneZone} onPress={showSourcePicker} activeOpacity={0.8}>
          <Svg width={220} height={240} viewBox="0 0 100 100" fill="none" strokeWidth={1.5}>
            <Defs>
              <LinearGradient id="camStoneGrad" x1="0%" y1="0%" x2="0%" y2="100%">
                <Stop offset="0%" stopColor="#e8d4a0" />
                <Stop offset="100%" stopColor="#8a6f3a" />
              </LinearGradient>
            </Defs>
            <Rect x="22" y="84" width="56" height="6" stroke="url(#camStoneGrad)" fill="none" />
            <Path d="M30 84 L30 35 Q30 18 50 18 Q70 18 70 35 L70 84 Z" stroke="url(#camStoneGrad)" fill="none" />
            <Path d="M36 80 L36 38 Q36 24 50 24 Q64 24 64 38 L64 80" stroke="url(#camStoneGrad)" strokeOpacity={0.4} fill="none" />
            <Line x1="40" y1="58" x2="60" y2="58" stroke="url(#camStoneGrad)" strokeOpacity={0.45} strokeWidth={0.7} />
            <Line x1="42" y1="64" x2="58" y2="64" stroke="url(#camStoneGrad)" strokeOpacity={0.4} strokeWidth={0.7} />
            <Line x1="44" y1="70" x2="56" y2="70" stroke="url(#camStoneGrad)" strokeOpacity={0.35} strokeWidth={0.7} />
            <Line x1="18" y1="92" x2="82" y2="92" stroke="url(#camStoneGrad)" strokeOpacity={0.5} />
          </Svg>

          <View style={styles.stoneInner}>
            <Svg width={34} height={34} viewBox="0 0 24 24" fill="none" stroke="#c9a84c" strokeWidth={1.2} strokeLinecap="round" strokeLinejoin="round">
              <Path d="M3 7.5h3l1.5-2h9L18 7.5h3a1 1 0 0 1 1 1V18a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V8.5a1 1 0 0 1 1-1z" />
              <Circle cx="12" cy="13" r="3.5" />
            </Svg>
            <Text style={styles.stoneText}>Tap to take or{'\n'}choose photo</Text>
          </View>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

function CandleFlicker() {
  const opacity = useRef(new Animated.Value(1)).current;
  const scale   = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const anim = Animated.loop(
      Animated.sequence([
        Animated.delay(200),
        Animated.timing(opacity, { toValue: 0.15, duration: 40, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1,    duration: 40, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.4,  duration: 40, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1,    duration: 40, useNativeDriver: true }),
        Animated.delay(500),
        Animated.parallel([
          Animated.timing(opacity, { toValue: 0.5, duration: 350, useNativeDriver: true }),
          Animated.timing(scale,   { toValue: 1.05, duration: 350, useNativeDriver: true }),
        ]),
        Animated.parallel([
          Animated.timing(opacity, { toValue: 1,  duration: 250, useNativeDriver: true }),
          Animated.timing(scale,   { toValue: 1,  duration: 250, useNativeDriver: true }),
        ]),
        Animated.delay(400),
        Animated.timing(opacity, { toValue: 0.1, duration: 30, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1,   duration: 30, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.05, duration: 30, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1,   duration: 30, useNativeDriver: true }),
        Animated.delay(600),
        Animated.parallel([
          Animated.timing(opacity, { toValue: 0.45, duration: 400, useNativeDriver: true }),
          Animated.timing(scale,   { toValue: 0.97, duration: 400, useNativeDriver: true }),
        ]),
        Animated.parallel([
          Animated.timing(opacity, { toValue: 1,  duration: 300, useNativeDriver: true }),
          Animated.timing(scale,   { toValue: 1,  duration: 300, useNativeDriver: true }),
        ]),
        Animated.delay(300),
      ])
    );
    anim.start();
    return () => anim.stop();
  }, []);

  return (
    <Animated.Text style={{ fontSize: 64, opacity, transform: [{ scale }] }}>
      🕯️
    </Animated.Text>
  );
}

function extractExifGps(exif) {
  if (!exif?.GPSLatitude || !exif?.GPSLongitude) return null;
  const lat = exif.GPSLatitudeRef === 'S' ? -Math.abs(exif.GPSLatitude) : Math.abs(exif.GPSLatitude);
  const lng = exif.GPSLongitudeRef === 'W' ? -Math.abs(exif.GPSLongitude) : Math.abs(exif.GPSLongitude);
  return { lat, lng };
}

async function getDeviceGps() {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return null;
    const loc = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 6000)),
    ]);
    return { lat: loc.coords.latitude, lng: loc.coords.longitude };
  } catch {
    return null;
  }
}

const GOLD     = '#c9a84c';
const INK      = '#0d0b08';
const PARCHMENT = '#e8d4a0';
const STONE    = 'rgba(138,126,110,0.7)';

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: INK },
  back: { padding: 24, paddingBottom: 0 },
  backText: { color: 'rgba(201,168,76,0.6)', fontSize: 15 },
  scroll: { alignItems: 'center', padding: 24, paddingTop: 48 },
  title: {
    color: PARCHMENT, fontSize: 26, fontWeight: '700',
    letterSpacing: 1, marginBottom: 10, textAlign: 'center',
  },
  subtitle: {
    color: STONE, fontStyle: 'italic', textAlign: 'center',
    lineHeight: 22, marginBottom: 8, fontSize: 14,
  },
  stoneZone: {
    width: 220, height: 240,
    alignSelf: 'center',
    marginTop: 24,
  },
  stoneInner: {
    position: 'absolute',
    top: 72,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  stoneText: {
    color: STONE, fontStyle: 'italic',
    fontSize: 13, textAlign: 'center',
    lineHeight: 20, marginTop: 8,
    opacity: 0.9,
  },

  loadingBox: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  loadingTitle: { color: PARCHMENT, fontSize: 22, fontWeight: '700', letterSpacing: 0.5, marginTop: 20, marginBottom: 6, textAlign: 'center' },
  loadingStep: { color: STONE, fontStyle: 'italic', fontSize: 15, letterSpacing: 0.5, marginBottom: 28, textAlign: 'center' },
  dotsRow: { flexDirection: 'row', gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: 'rgba(201,168,76,0.2)' },
  dotActive: { backgroundColor: GOLD },

  rejectedBox: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  rejectedTitle: { color: PARCHMENT, fontSize: 22, fontWeight: '700', marginBottom: 12 },
  rejectedReason: { color: STONE, fontStyle: 'italic', textAlign: 'center', lineHeight: 22, marginBottom: 36 },
  tryAnyway: {
    borderWidth: 1, borderColor: 'rgba(201,168,76,0.3)',
    paddingHorizontal: 32, paddingVertical: 14, borderRadius: 2, marginBottom: 12, width: '100%',
  },
  tryAnywayText: { color: STONE, textAlign: 'center', letterSpacing: 1 },
  retryBtn: {
    borderWidth: 1, borderColor: GOLD,
    paddingHorizontal: 32, paddingVertical: 14, borderRadius: 2, width: '100%',
  },
  retryText: { color: GOLD, textAlign: 'center', letterSpacing: 1 },
});
