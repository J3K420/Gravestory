import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  ActivityIndicator, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
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
          <ActivityIndicator size="large" color={GOLD} style={{ marginBottom: 24 }} />
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

  return (
    <SafeAreaView style={styles.container}>
      <TouchableOpacity onPress={() => navigation.goBack()} style={styles.back}>
        <Text style={styles.backText}>← Back</Text>
      </TouchableOpacity>

      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.title}>Scan a Gravestone</Text>
        <Text style={styles.subtitle}>
          Take a photo or choose one from your library.{'\n'}
          Make sure the stone is clearly visible.
        </Text>

        <TouchableOpacity style={styles.primaryBtn} onPress={() => pickAndAnalyze(true)}>
          <Text style={styles.primaryBtnText}>✦ Open Camera</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.secondaryBtn} onPress={() => pickAndAnalyze(false)}>
          <Text style={styles.secondaryBtnText}>Choose from Library</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
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
  title: { color: PARCHMENT, fontSize: 28, fontWeight: '700', letterSpacing: 1, marginBottom: 12 },
  subtitle: { color: STONE, fontStyle: 'italic', textAlign: 'center', lineHeight: 22, marginBottom: 48 },
  primaryBtn: {
    borderWidth: 1, borderColor: GOLD,
    paddingHorizontal: 40, paddingVertical: 18, borderRadius: 2, marginBottom: 16, width: '100%',
  },
  primaryBtnText: { color: GOLD, fontSize: 16, letterSpacing: 2, textAlign: 'center' },
  secondaryBtn: {
    borderWidth: 1, borderColor: 'rgba(201,168,76,0.3)',
    paddingHorizontal: 40, paddingVertical: 16, borderRadius: 2, width: '100%',
  },
  secondaryBtnText: { color: STONE, fontSize: 15, letterSpacing: 1, textAlign: 'center' },

  loadingBox: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  loadingStep: { color: PARCHMENT, fontSize: 16, letterSpacing: 1, marginBottom: 24, textAlign: 'center' },
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
