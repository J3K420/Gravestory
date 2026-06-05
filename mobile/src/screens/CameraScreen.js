import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  Animated, ScrollView, Modal, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient, Stop, Rect, Path, Line, Circle } from 'react-native-svg';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as Location from 'expo-location';
import { supabase } from '../lib/supabase';
import { useRefresh } from '../lib/use-refresh';
import { colors, fonts, radius } from '../lib/theme';
import { verifyIsGravestone, readGravestone } from '../lib/api-gemini';
import { searchForPerson } from '../lib/api-tavily';
import { searchWikiTree } from '../lib/api-wikitree';
import { queryWikidata } from '../lib/api-wikidata';
import { searchChroniclingAmerica } from '../lib/api-chroniclingamerica';
import { fetchWikipediaPortraits, fetchWikipediaArticleSummary } from '../lib/api-wikipedia';
import { generateBiography } from '../lib/biography';
import { saveStories, loadStories } from '../lib/storage';
import { cloudSaveStory, cloudUpdateStory, findOrCreateGrave } from '../lib/sync';
import { uploadGravestoneImage } from '../lib/api-r2';
import { forwardGeocode, reverseGeocode } from '../lib/api-nominatim';
import { checkSaveLimit } from '../lib/save-limit';
import { checkScanLimit, incrementScanCount } from '../lib/scan-limit';

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
  const [showPicker, setShowPicker] = useState(false);

  const stoneOpacity = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const flicker = Animated.loop(
      Animated.sequence([
        Animated.delay(600),
        Animated.timing(stoneOpacity, { toValue: 0.3,  duration: 50,  useNativeDriver: true }),
        Animated.timing(stoneOpacity, { toValue: 1,    duration: 50,  useNativeDriver: true }),
        Animated.timing(stoneOpacity, { toValue: 0.5,  duration: 50,  useNativeDriver: true }),
        Animated.timing(stoneOpacity, { toValue: 1,    duration: 50,  useNativeDriver: true }),
        Animated.delay(500),
        Animated.timing(stoneOpacity, { toValue: 0.65, duration: 250, useNativeDriver: true }),
        Animated.timing(stoneOpacity, { toValue: 1,    duration: 200, useNativeDriver: true }),
        Animated.delay(400),
        Animated.timing(stoneOpacity, { toValue: 0.35, duration: 50,  useNativeDriver: true }),
        Animated.timing(stoneOpacity, { toValue: 1,    duration: 50,  useNativeDriver: true }),
        Animated.delay(400),
      ])
    );
    flicker.start();
    return () => flicker.stop();
  }, []);

  const { refreshControl } = useRefresh(() => {
    setRejected(null);
    setPipelineError(null);
  });

  async function pickAndAnalyze(fromCamera) {
    setRejected(null);
    setPipelineError(null);

    // Check both save and scan limits before opening the picker — no API credits burned.
    // app_metadata.is_unlimited bypasses all limits (set via Supabase dashboard, read-only by clients).
    try {
      const { data: { session: initSession } } = await supabase.auth.getSession();
      const uid = initSession?.user?.id ?? null;
      const isUnlimited = initSession?.user?.app_metadata?.is_unlimited === true;
      if (!isUnlimited) {
        const [saveCheck, scanCheck] = await Promise.all([checkSaveLimit(uid), checkScanLimit(uid)]);
        if (saveCheck.atLimit) {
          navigation.navigate('Paywall', { count: saveCheck.count, limit: saveCheck.limit, type: 'save', isGuest: saveCheck.isGuest });
          return;
        }
        if (scanCheck.atLimit) {
          navigation.navigate('Paywall', { count: scanCheck.count, limit: scanCheck.limit, type: 'scan', isGuest: scanCheck.isGuest });
          return;
        }
      }
    } catch (e) {
      console.warn('Limit check failed (non-fatal):', e.message);
    }

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

    await runPipeline(manipResult.base64, false, gps, fromCamera);
  }

  async function runPipeline(base64, skipVerify = false, gps = null, fromCamera = false) {
    setLoading(true);
    setStepIndex(0);

    try {
      // Fire reverseGeocode in parallel with verify so we have a location hint
      // ready before OCR and search queries execute.
      const reverseGeoPromise = gps ? reverseGeocode(gps.lat, gps.lng) : Promise.resolve(null);

      if (!skipVerify) {
        setStepIndex(0);
        try {
          await verifyIsGravestone(base64);
        } catch (err) {
          if (err.__verificationRejection) {
            setRejected({ reason: err.reason, base64, gps, fromCamera });
            setLoading(false);
            return;
          }
          throw err;
        }
      }

      const locationHint = await reverseGeoPromise;

      setStepIndex(1);
      const graveData = await readGravestone(base64, locationHint);

      // Inform the user if multiple distinct gravestones are visible — the bio
      // focuses on the primary inscription; best results come from one stone per scan.
      if (graveData.multiple_subjects === true) {
        Alert.alert(
          'Multiple Gravestones Detected',
          'This photo appears to show more than one separate gravestone. The biography will focus on the primary inscription. For best results, photograph each stone individually.',
          [{ text: 'OK' }]
        );
      }

      // Primary OCR name — used for cache lookup and grave linking
      const primaryOcrName = graveData.primary_name || graveData.names?.[0] || '';

      // 1.5 — Biography cache: skip expensive research + Gemini when a recent
      // public story already covers this stone (90-day TTL). Only fires for
      // signed-in users with GPS — guests and GPS-less scans run the full pipeline.
      let cachedBio = null;
      let wikidataResult = null;
      const { data: { session: cacheSession } } = await supabase.auth.getSession();
      if (cacheSession?.user && gps && primaryOcrName) {
        try {
          const { data: cachedGraveId } = await supabase.rpc('find_grave', {
            p_name: primaryOcrName,
            p_lat: gps.lat,
            p_lng: gps.lng,
          });
          if (cachedGraveId) {
            const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
            const { data: row } = await supabase
              .from('stories')
              .select('name,dates,biography,location,inscription,symbols,sources,source_urls,portrait_left_url,portrait_right_url,portraits,grave_id')
              .eq('grave_id', cachedGraveId)
              .eq('is_public', true)
              .is('deleted_at', null)
              .gt('updated_at', cutoff)
              .order('updated_at', { ascending: false })
              .limit(1)
              .maybeSingle();
            if (row?.biography) {
              cachedBio = row;
              setStepIndex(3); // jump to near-done visually
              console.warn('🏛️ Biography cache hit for', primaryOcrName);
            }
          }
        } catch (e) {
          console.warn('🏛️ Cache lookup failed (non-fatal):', e.message);
        }
      }

      let bioResult;
      let resolvedPortraits;
      if (cachedBio) {
        bioResult = {
          name: cachedBio.name,
          dates: cachedBio.dates,
          biography: cachedBio.biography,
          location: cachedBio.location,
          inscription: cachedBio.inscription,
          symbols: cachedBio.symbols,
          sources: cachedBio.sources,
          source_urls: cachedBio.source_urls,
        };
        // Use portrait URLs stored with the cached story if available
        resolvedPortraits = Array.isArray(cachedBio.portraits) && cachedBio.portraits.length > 0
          ? cachedBio.portraits
          : [cachedBio.portrait_left_url, cachedBio.portrait_right_url].filter(Boolean);
      } else {
        // DEBUG: identify any undefined imports before they crash Promise.all
        const _fns = {
          searchForPerson, searchWikiTree, queryWikidata,
          searchChroniclingAmerica, fetchWikipediaPortraits,
          fetchWikipediaArticleSummary, generateBiography,
          forwardGeocode, reverseGeocode, incrementScanCount,
          findOrCreateGrave, verifyIsGravestone, readGravestone,
          uploadGravestoneImage, cloudSaveStory, cloudUpdateStory,
        };
        for (const [k, v] of Object.entries(_fns)) {
          if (typeof v !== 'function') console.error(`🔴 IMPORT IS ${typeof v}: ${k}`, v);
        }

        setStepIndex(2);
        const datesStr = [graveData.birth_date, graveData.death_date].filter(Boolean).join(' ');
        const effectiveDeath = graveData.death_date?.match(/\d{4}/)?.[0] || '';
        const deathYrNum = effectiveDeath ? parseInt(effectiveDeath, 10) : 0;
        const wikiNames = (graveData.multiple_subjects && graveData.names?.length > 1)
          ? graveData.names.slice(0, 3)
          : [primaryOcrName];

        // For multi-person stones, search WikiTree for each of the first 2 people.
        const wikiTreeTargets = (graveData.multiple_subjects && graveData.names?.length > 1)
          ? graveData.names.slice(0, 2)
          : [primaryOcrName];

        // Fetch portraits for every person on the stone (wikiNames), not just the
        // primary name — on multi-person stones the primary subject (e.g. Cynthia Levy)
        // may have no Wikipedia article while a second person (Amy Winehouse) does.
        const allParallel = await Promise.all([
          searchForPerson(graveData, locationHint),
          ...wikiTreeTargets.map(name => searchWikiTree({ ...graveData, primary_name: name }, locationHint)),
          // Wikidata: only when OCR confidence is high to avoid false matches
          graveData.name_confidence === 'high'
            ? queryWikidata(primaryOcrName, effectiveDeath)
            : Promise.resolve(null),
          // Chronicling America: direct API for pre-1924 deaths (frees a Tavily slot)
          (effectiveDeath && deathYrNum <= 1924)
            ? searchChroniclingAmerica(primaryOcrName, effectiveDeath)
            : Promise.resolve([]),
          ...wikiNames.map(n => fetchWikipediaPortraits(n, datesStr)),
          ...wikiNames.map(n => fetchWikipediaArticleSummary(n, datesStr)),
        ]);

        let idx = 0;
        const searchResults      = allParallel[idx++];
        const wikiTreeResults    = allParallel.slice(idx, idx += wikiTreeTargets.length);
        wikidataResult           = allParallel[idx++];
        const chronResults       = allParallel[idx++];
        const portraitArrays     = allParallel.slice(idx, idx += wikiNames.length);
        const wikiSummaryResults = allParallel.slice(idx);

        // Primary WikiTree result; pass all as array when multiple subjects
        const wikiData = wikiTreeTargets.length > 1 ? wikiTreeResults.filter(Boolean) : wikiTreeResults[0];

        // Merge Chronicling America results into searchResults
        const mergedSearchResults = [...searchResults, ...(chronResults || [])];

        const portraits = portraitArrays.flat();
        const wikipediaSummary = wikiSummaryResults.length === 1
          ? wikiSummaryResults[0]
          : wikiSummaryResults;

        setStepIndex(3);
        bioResult = await generateBiography(graveData, mergedSearchResults, wikiData, locationHint, wikipediaSummary, wikidataResult);

        // Portrait fallback: if the stone showed only a surname (e.g. "HOUDINI"),
        // the single-token guard skipped the initial Wikipedia fetch. Now that the
        // biography has resolved the full name, retry — but split on " and " first
        // because bio.name is often a combined string ("Harry Houdini and Bess Houdini")
        // that would fail the Wikipedia title-match guard when passed as-is.
        resolvedPortraits = portraits;
        if (resolvedPortraits.length === 0 && bioResult.name) {
          const SKIP = new Set(['mr','mrs','ms','dr','rev','sr','jr','ii','iii','iv','v','the']);
          const nameParts = bioResult.name.split(/\s+(?:and|&)\s+/i).map(n => n.trim()).filter(Boolean);
          for (const namePart of nameParts) {
            const tokens = namePart.toLowerCase().replace(/[.,'"()]/g, '').split(/\s+/).filter(w => w.length > 1 && !SKIP.has(w));
            if (tokens.length >= 2) {
              const fetched = await fetchWikipediaPortraits(namePart, bioResult.dates);
              if (fetched.length > 0) { resolvedPortraits = fetched; break; }
            }
          }
        }
      }

      setStepIndex(4);

      // forwardGeocode resolves the cemetery and, if the grave is tagged in OSM,
      // the precise node. But camera EXIF / device GPS is always more accurate for
      // pin placement — the user was physically standing at the grave. Prefer real
      // GPS over Nominatim coords; only fall back to Nominatim when GPS is absent.
      const primaryName = primaryOcrName || bioResult.name || '';
      const geoResult = await forwardGeocode(bioResult.location, primaryName, bioResult.dates);
      // Wikidata burial coords are a precise fallback for famous figures when no GPS was captured
      const wikidataCoords = wikidataResult?.burialCoords || null;
      const refinedGps = gps ?? (geoResult ? { lat: geoResult.lat, lng: geoResult.lng } : null) ?? wikidataCoords;
      const lowConfidence = geoResult?.lowConfidence || undefined;

      // Read default visibility from user metadata
      const { data: { session } } = await supabase.auth.getSession();
      const defaultPublic = session?.user?.user_metadata?.default_public ?? false;

      // Biography resolved successfully — count this as a used scan
      try { await incrementScanCount(session?.user?.id ?? null); } catch (e) { console.warn('incrementScanCount failed (non-fatal):', e.message); }

      // Link to canonical grave — on a cache hit the grave_id is already known;
      // otherwise call find_or_create to dedup multiple scans of the same stone.
      let graveId = cachedBio?.grave_id || null;
      if (!graveId && session?.user && refinedGps && primaryName) {
        graveId = await findOrCreateGrave(primaryName, refinedGps.lat, refinedGps.lng, defaultPublic);
      }

      let story = {
        ...bioResult,
        graveData,
        portraits: resolvedPortraits,
        gps: refinedGps,
        _lowConfidence: lowConfidence,
        timestamp: Date.now(),
        is_public: defaultPublic,
        source: fromCamera ? 'camera' : 'library',
        grave_id: graveId,
      };

      // Save locally first so the story is always accessible offline
      const uid = session?.user?.id ?? null;
      const existing = await loadStories(uid);
      await saveStories([story, ...existing], uid);

      // Attempt cloud save, then R2 image upload, if signed in
      if (session?.user) {
        story = await cloudSaveStory(story, session.user);

        // Upload image to R2 non-blocking — failure is safe to ignore
        const imageUrl = await uploadGravestoneImage(base64);
        if (imageUrl) {
          story = await cloudUpdateStory({ ...story, image_url: imageUrl }, session.user);
          // Contribute to the grave's community photo pool (non-blocking)
          if (story.grave_id) {
            (async () => {
              try {
                await supabase.from('grave_photos').insert({
                  grave_id: story.grave_id,
                  user_id: session.user.id,
                  image_url: imageUrl,
                });
              } catch (e) {
                console.warn('grave_photos insert failed (non-fatal):', e.message);
              }
            })();
          }
        }
      }

      setLoading(false);
      navigation.navigate('Result', { story });
    } catch (err) {
      console.error('🔴 Pipeline crash stack:', err.stack || err);
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
          <TouchableOpacity style={styles.tryAnyway} onPress={() => runPipeline(rejected.base64, true, rejected.gps, rejected.fromCamera)}>
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
      {/* Bottom sheet photo source picker */}
      <Modal
        transparent
        animationType="slide"
        visible={showPicker}
        onRequestClose={() => setShowPicker(false)}
      >
        <TouchableOpacity
          style={styles.sheetBackdrop}
          activeOpacity={1}
          onPress={() => setShowPicker(false)}
        />
        <View style={styles.sheet}>
          <View style={styles.sheetHandle} />
          <Text style={styles.sheetTitle}>Choose Photo Source</Text>
          <TouchableOpacity
            style={styles.sheetOption}
            onPress={() => { setShowPicker(false); pickAndAnalyze(true); }}
          >
            <Text style={styles.sheetOptionText}>✦ Take Photo</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.sheetOption}
            onPress={() => { setShowPicker(false); pickAndAnalyze(false); }}
          >
            <Text style={styles.sheetOptionText}>Choose from Library</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.sheetCancel}
            onPress={() => setShowPicker(false)}
          >
            <Text style={styles.sheetCancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </Modal>

      <TouchableOpacity onPress={() => navigation.goBack()} style={styles.back}>
        <Text style={styles.backText}>← Back</Text>
      </TouchableOpacity>

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={refreshControl}
      >
        <Text style={styles.title}>Photograph the Stone</Text>
        <Text style={styles.subtitle}>Frame the gravestone clearly for best results</Text>

        <TouchableOpacity style={styles.stoneZone} onPress={() => setShowPicker(true)} activeOpacity={0.85}>
          <Animated.View style={{ opacity: stoneOpacity }}>
            <Svg width={375} height={410} viewBox="0 0 100 100" fill="none" strokeWidth={1.5}>
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
              <Text style={styles.stoneText}>Tap</Text>
            </View>
          </Animated.View>
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

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.ink },
  back: { padding: 24, paddingBottom: 0 },
  backText: { color: 'rgba(201,168,76,0.6)', fontSize: 15, fontFamily: fonts.body },
  scroll: { alignItems: 'center', padding: 24, paddingTop: 48 },
  title: {
    color: colors.parchment, fontSize: 26, fontFamily: fonts.title,
    letterSpacing: 1, marginBottom: 10, textAlign: 'center',
  },
  subtitle: {
    color: colors.ash, fontFamily: fonts.bodyItalic, textAlign: 'center',
    lineHeight: 22, marginBottom: 8, fontSize: 14,
  },
  stoneZone: {
    width: 375, height: 410,
    alignSelf: 'center',
    marginTop: 24,
  },
  stoneInner: {
    position: 'absolute',
    top: 122,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  stoneText: {
    color: colors.ash, fontFamily: fonts.bodyItalic,
    fontSize: 32, textAlign: 'center',
    marginTop: 26, opacity: 0.9, letterSpacing: 2,
  },

  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)' },
  sheet: {
    backgroundColor: colors.stone,
    borderTopWidth: 1, borderTopColor: 'rgba(201,168,76,0.3)',
    borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg,
    paddingBottom: 36, paddingHorizontal: 24,
  },
  sheetHandle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: 'rgba(201,168,76,0.4)',
    alignSelf: 'center', marginTop: 12, marginBottom: 20,
  },
  sheetTitle: {
    color: colors.parchment, fontSize: 13, letterSpacing: 2,
    fontFamily: fonts.body, textTransform: 'uppercase', marginBottom: 16, opacity: 0.6,
  },
  sheetOption: {
    borderWidth: 1, borderColor: 'rgba(201,168,76,0.3)',
    paddingVertical: 16, paddingHorizontal: 16,
    marginBottom: 10, borderRadius: radius.sm,
  },
  sheetOptionText: {
    color: colors.flame, fontSize: 16, letterSpacing: 1,
    textAlign: 'center', fontFamily: fonts.body,
  },
  sheetCancel: { paddingVertical: 14, marginTop: 4 },
  sheetCancelText: {
    color: colors.ash, fontSize: 15, textAlign: 'center', fontFamily: fonts.bodyItalic,
  },

  loadingBox: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  loadingTitle: {
    color: colors.parchment, fontSize: 22, fontFamily: fonts.title,
    letterSpacing: 0.5, marginTop: 20, marginBottom: 6, textAlign: 'center',
  },
  loadingStep: {
    color: colors.ash, fontFamily: fonts.bodyItalic,
    fontSize: 15, letterSpacing: 0.5, marginBottom: 28, textAlign: 'center',
  },
  dotsRow: { flexDirection: 'row', gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: 'rgba(201,168,76,0.2)' },
  dotActive: { backgroundColor: colors.flame },

  rejectedBox: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  rejectedTitle: {
    color: colors.parchment, fontSize: 22, fontFamily: fonts.title, marginBottom: 12,
  },
  rejectedReason: {
    color: colors.ash, fontFamily: fonts.bodyItalic,
    textAlign: 'center', lineHeight: 22, marginBottom: 36,
  },
  tryAnyway: {
    borderWidth: 1, borderColor: 'rgba(201,168,76,0.3)',
    paddingHorizontal: 32, paddingVertical: 14, borderRadius: radius.sm,
    marginBottom: 12, width: '100%',
  },
  tryAnywayText: { color: colors.ash, textAlign: 'center', letterSpacing: 1, fontFamily: fonts.body },
  retryBtn: {
    borderWidth: 1, borderColor: colors.flame,
    paddingHorizontal: 32, paddingVertical: 14, borderRadius: radius.sm, width: '100%',
  },
  retryText: { color: colors.flame, textAlign: 'center', letterSpacing: 1, fontFamily: fonts.body },
});
