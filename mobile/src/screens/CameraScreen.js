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
import { verifyIsGravestone, readGravestone, resolveSymbolMeanings } from '../lib/api-gemini';
import { searchForPerson, extractFindAGraveDetail } from '../lib/api-tavily';
import { searchWikiTree } from '../lib/api-wikitree';
import { queryWikidata } from '../lib/api-wikidata';
import { searchChroniclingAmerica } from '../lib/api-chroniclingamerica';
import { searchInternetArchive } from '../lib/api-internetarchive';
import { fetchWikipediaPortraits, fetchWikipediaArticleSummary } from '../lib/api-wikipedia';
import { generateBiography } from '../lib/biography';
import { forwardGeocode, reverseGeocode, reverseGeocodeCemetery } from '../lib/api-nominatim';
import { checkScanLimit, incrementScanCount } from '../lib/scan-limit';
import { getLibraryAssetGps } from '../lib/media-gps';
import { loadStories, saveStories } from '../lib/storage';
import { savePendingPhoto, readPendingPhoto, deletePendingPhoto } from '../lib/pending';
import { logEvent, EVENTS } from '../lib/analytics';

// Overall ceiling for the parallel research fan-out. The individual research
// legs (Tavily, WikiTree, Wikidata, Chronicling America, Internet Archive,
// Wikipedia) have NO per-request timeout of their own, so one hung leg would
// otherwise block the whole Promise.all and freeze the user on "Searching
// records…" forever. We wrap the block in Promise.race against this cap; on
// timeout the pipeline proceeds with whatever the stone + free sources yield
// (a thinner bio) instead of hanging.
const RESEARCH_TIMEOUT_MS = 30000;

// Sentinel returned by the race when the research fan-out exceeds the cap, so
// the caller can tell "timed out" apart from a legitimately empty result.
const RESEARCH_TIMEOUT = Symbol('research-timeout');

// Resolves to RESEARCH_TIMEOUT if `promise` hasn't settled within ms. Never
// rejects — research is best-effort, so a timeout degrades gracefully.
function raceResearchTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise(resolve => setTimeout(() => resolve(RESEARCH_TIMEOUT), ms)),
  ]);
}

const STEPS = [
  'Verifying gravestone…',
  'Reading inscription…',
  'Searching records…',
  'Building biography…',
  'Finishing up…',
];

export default function CameraScreen({ navigation, route }) {
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

  // Resume a pending (offline-scanned) story: Result screen's "Run Research"
  // navigates here with the pending story so the full pipeline UI (loading
  // steps, rejection, error screens) is reused as-is.
  useEffect(() => {
    const pending = route.params?.pending;
    if (pending) {
      navigation.setParams({ pending: null });
      resumePending(pending);
    }
  }, [route.params?.pending]);

  // Offers the offline-queue path when the scan-limit check can't reach the
  // server (fail-closed limit = the user is almost certainly offline).
  function offerOfflineScan(fromCamera) {
    Alert.alert(
      'No Connection',
      "Could not reach the server. You can photograph the stone now — it will be saved with its location, and you can run the research once you're back online.",
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Scan Offline', onPress: () => pickAndAnalyze(fromCamera, true) },
      ]
    );
  }

  async function pickAndAnalyze(fromCamera, offline = false) {
    setRejected(null);
    setPipelineError(null);

    // Check the scan limit before opening the picker — no API credits burned.
    // Saved-story limits were removed; scans are the cost control (they drive all paid AI work).
    // app_metadata.is_unlimited bypasses the limit (set via Supabase dashboard, read-only by clients).
    // Offline scans skip the check — no AI work happens until research runs,
    // and the limit is enforced then (resumePending re-checks).
    if (!offline) {
      try {
        const { data: { session: initSession } } = await supabase.auth.getSession();
        const uid = initSession?.user?.id ?? null;
        const isUnlimited = initSession?.user?.app_metadata?.is_unlimited === true;
        if (!isUnlimited) {
          const scanCheck = await checkScanLimit(uid, initSession?.user);
          if (scanCheck.atLimit) {
            if (scanCheck._checkFailed) {
              offerOfflineScan(fromCamera);
              return;
            }
            logEvent(EVENTS.SCAN_LIMIT_HIT, { count: scanCheck.count, limit: scanCheck.limit, isGuest: scanCheck.isGuest });
            navigation.navigate('Paywall', { count: scanCheck.count, limit: scanCheck.limit, type: 'scan', isGuest: scanCheck.isGuest });
            return;
          }
        }
      } catch (e) {
        console.warn('Limit check error:', e.message);
        offerOfflineScan(fromCamera);
        return;
      }
    }

    // exif: true so we can read GPS coords before compression strips them.
    //
    // IMPORTANT — do NOT set legacy: true on Android. The modern system Photo
    // Picker (the default) returns a MediaStore-backed asset WITH an assetId,
    // which getLibraryAssetGps needs to recover the OS-redacted GPS EXIF via
    // expo-media-library. legacy: true routes through ACTION_GET_CONTENT (the
    // file browser), and per the SDK 54 docs an Android asset picked "by
    // directly browsing the file system" has a NULL assetId — so GPS recovery
    // is impossible. (Earlier code had this inverted, which broke EXIF mapping.)
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

    // Android redacts GPS tags from picker-read EXIF (asset.exif never has them).
    // For library picks, recover the location via expo-media-library, which can
    // read the unredacted original. No-op on iOS / camera shots / missing assetId.
    // A miss here is non-fatal (getLibraryAssetGps logs the reason); the user can
    // correct the pin on the map.
    if (!gps && !fromCamera) {
      const media = await getLibraryAssetGps(asset.assetId);
      if (media.gps) gps = media.gps;
    }

    const needsDeviceGps = !gps && fromCamera;

    const [manipResult, deviceGps] = await Promise.all([
      ImageManipulator.manipulateAsync(
        asset.uri,
        [{ resize: { width: 1024 } }],
        { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG, base64: true }
      ),
      needsDeviceGps ? getDeviceGps() : Promise.resolve(null),
    ]);

    if (!gps && deviceGps) {
      gps = deviceGps;
    }

    // A library pick with no recoverable GPS is expected for cloud-only photos,
    // screenshots, and denied photo-location permission — degrade silently and let
    // the user correct the pin on the map. (The legacy:true/assetId root cause that
    // once broke this for ALL library photos was fixed; getLibraryAssetGps still
    // logs the failure reason to the console, but it's no longer surfaced as an Alert.)
    if (offline) {
      await createPendingStory(manipResult.base64, gps, fromCamera);
      return;
    }

    await runPipeline(manipResult.base64, false, gps, fromCamera);
  }

  // Saves an offline scan as a local-only placeholder story. The photo goes to
  // documentDirectory/pending/ (AsyncStorage can't hold base64 images); the
  // story carries _pending so ResultScreen shows the "Run Research" template
  // and sync.js keeps it out of the cloud.
  async function createPendingStory(base64, gps, fromCamera) {
    try {
      const timestamp = Date.now();
      const photoUri = await savePendingPhoto(base64, timestamp);
      const story = {
        _pending: true,
        name: 'Awaiting Research',
        photoUri,
        gps: gps || null,
        timestamp,
        is_public: false,
        source: fromCamera ? 'camera' : 'library',
      };
      // getSession reads the locally cached session — works offline.
      const { data: { session } } = await supabase.auth.getSession();
      const uid = session?.user?.id ?? null;
      const existing = await loadStories(uid);
      await saveStories([story, ...existing], uid);
      navigation.navigate('Result', { story });
    } catch (e) {
      console.warn('Pending save failed:', e.message);
      Alert.alert('Could Not Save', 'Failed to save this scan for later. Please try again.');
    }
  }

  // Runs the full pipeline for a previously offline-scanned story. Re-checks
  // the scan limit (skipped at offline capture time), then feeds the persisted
  // photo through the normal flow. On success runPipeline removes the
  // placeholder and its photo file.
  async function resumePending(pending) {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const uid = session?.user?.id ?? null;
      const isUnlimited = session?.user?.app_metadata?.is_unlimited === true;
      if (!isUnlimited) {
        const scanCheck = await checkScanLimit(uid, session?.user);
        if (scanCheck.atLimit) {
          if (scanCheck._checkFailed) {
            Alert.alert('Still Offline', 'Could not reach the server. Your scan is saved — try again once you have a connection.');
            navigation.goBack();
            return;
          }
          navigation.navigate('Paywall', { count: scanCheck.count, limit: scanCheck.limit, type: 'scan', isGuest: scanCheck.isGuest });
          return;
        }
      }
    } catch (e) {
      console.warn('Limit check error:', e.message);
      Alert.alert('Still Offline', 'Could not reach the server. Your scan is saved — try again once you have a connection.');
      navigation.goBack();
      return;
    }

    const base64 = await readPendingPhoto(pending.photoUri);
    if (!base64) {
      Alert.alert('Photo Missing', 'The saved photo for this scan could not be read. Please discard it and scan again.');
      navigation.goBack();
      return;
    }

    await runPipeline(base64, false, pending.gps, pending.source === 'camera', pending);
  }

  async function runPipeline(base64, skipVerify = false, gps = null, fromCamera = false, pending = null) {
    setLoading(true);
    setStepIndex(0);

    try {
      // Fire reverseGeocode in parallel with verify so we have a location hint
      // ready before OCR and search queries execute. Also resolve the enclosing
      // cemetery name (if the GPS sits inside one) to disambiguate Tavily queries.
      const reverseGeoPromise = gps ? reverseGeocode(gps.lat, gps.lng) : Promise.resolve(null);
      const cemeteryNamePromise = gps ? reverseGeocodeCemetery(gps.lat, gps.lng) : Promise.resolve(null);

      logEvent(EVENTS.SCAN_STARTED, { fromCamera, hasGps: !!gps, resumed: !!pending });

      if (!skipVerify) {
        setStepIndex(0);
        try {
          await verifyIsGravestone(base64);
        } catch (err) {
          if (err.__verificationRejection) {
            logEvent(EVENTS.VERIFICATION_REJECTED, { reason: err.reason });
            setRejected({ reason: err.reason, base64, gps, fromCamera, pending });
            setLoading(false);
            return;
          }
          throw err;
        }
      } else {
        logEvent(EVENTS.VERIFICATION_BYPASSED, {});
      }

      const locationHint = await reverseGeoPromise;
      const cemeteryName = await cemeteryNamePromise;

      setStepIndex(1);
      const graveData = await readGravestone(base64, locationHint);
      logEvent(EVENTS.OCR_DONE, {
        confidence: graveData.name_confidence,
        subjects: Array.isArray(graveData.subjects) ? graveData.subjects.filter(s => s && s.name).length : 0,
      });

      // Warn about separate physical stones only when subjects didn't capture all people.
      // When subjects has multiple entries the pipeline already handles each person — no warning.
      const _multiSubjectsInArray = Array.isArray(graveData.subjects) && graveData.subjects.filter(s => s && s.name).length > 1;
      if (graveData.multiple_subjects === true && !_multiSubjectsInArray) {
        Alert.alert(
          'Multiple Gravestones Detected',
          'This photo appears to show more than one separate gravestone. For best results, photograph each stone individually.',
          [{ text: 'OK' }]
        );
      }

      // 3+ people on one stone: Tavily only has a dedicated research slot for the first
      // two people, so the third person onward leans on the inscription + any Wikipedia
      // article. Advise photographing each stone individually for a full per-person bio.
      const _deceasedCount = (Array.isArray(graveData.subjects) ? graveData.subjects.filter(s => s && s.name).length : 0)
        || (graveData.names?.length || 0);
      if (_deceasedCount >= 3) {
        Alert.alert(
          'Several People on This Stone',
          'This stone lists three or more people. Research depth is reduced for the third person and beyond — for a full biography of each, photograph each stone individually.',
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
              .select('name,dates,biography,location,inscription,symbols,symbol_meanings,sources,source_urls,portrait_left_url,portrait_right_url,portraits,grave_id')
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
              logEvent(EVENTS.BIO_CACHE_HIT, {});
            }
          }
        } catch (e) {
          console.warn('🏛️ Cache lookup failed (non-fatal):', e.message);
        }
      }

      let bioResult;
      let resolvedPortraits;
      // AI-resolved meanings for symbols the static SYMBOL_CONTEXT table can't
      // explain; reused from a cached story when available, else resolved below.
      let symbolMeanings = cachedBio?.symbol_meanings || null;
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
        setStepIndex(2);
        const datesStr = [graveData.birth_date, graveData.death_date].filter(Boolean).join(' ');
        const effectiveDeath = graveData.death_date?.match(/\d{4}/)?.[0] || '';
        const deathYrNum = effectiveDeath ? parseInt(effectiveDeath, 10) : 0;
        // Per-person deceased subjects (with their OWN dates) drive the research fan-out.
        // A shared family stone (grandmother + granddaughter) is not "multiple_subjects"
        // by the OCR's narrow definition, so key off the subjects array too — otherwise a
        // famous secondary subject (e.g. Amy Winehouse beside her grandmother) is never
        // researched and gets no Wikipedia article. Each target carries its own dates so
        // the Wikipedia lookup matches the right person, not the primary's dates.
        const deceasedSubjects = Array.isArray(graveData.subjects) ? graveData.subjects.filter(s => s && s.name) : [];
        const isMulti = deceasedSubjects.length > 1 || (graveData.multiple_subjects === true && graveData.names?.length > 1);
        const researchTargets = deceasedSubjects.length > 1
          ? deceasedSubjects.slice(0, 3).map(s => ({ name: s.name, dates: [s.birth_date, s.death_date].filter(Boolean).join(' ') }))
          : (isMulti ? graveData.names.slice(0, 3) : [primaryOcrName]).map(n => ({ name: n, dates: datesStr }));
        const wikiNames = researchTargets.map(t => t.name);

        // For multi-person stones, search WikiTree for each of the first 2 deceased people.
        const wikiTreeTargets = deceasedSubjects.length > 1
          ? deceasedSubjects.slice(0, 2).map(s => s.name)
          : (isMulti ? graveData.names.slice(0, 2) : [primaryOcrName]);

        // Fetch portraits for every person on the stone (wikiNames), not just the
        // primary name — on multi-person stones the primary subject (e.g. Cynthia Levy)
        // may have no Wikipedia article while a second person (Amy Winehouse) does.
        //
        // Each leg is paired with a fallback value of its natural "empty" shape so
        // that if the whole fan-out times out (raceResearchTimeout below), the
        // index de-structuring still lines up and the pipeline degrades to a
        // stone-only / free-source bio instead of hanging.
        const legs = [
          searchForPerson(graveData, locationHint, cemeteryName),
          ...wikiTreeTargets.map(name => searchWikiTree({ ...graveData, primary_name: name }, locationHint)),
          // Wikidata: high confidence always; medium confidence only when a death
          // year is present. queryWikidata's death-year proximity filter (rejects
          // candidates >5yr off, returns null if all rejected) guards against
          // namesakes, so medium-confidence weathered stones — where structured
          // corroboration helps most — can fire safely. Low confidence or no year
          // skips (no year = no namesake guard).
          (graveData.name_confidence === 'high' ||
           (graveData.name_confidence === 'medium' && effectiveDeath))
            ? queryWikidata(primaryOcrName, effectiveDeath)
            : Promise.resolve(null),
          // Chronicling America: direct OCR-text API for pre-1928 deaths (module
          // guards the same cutoff internally; gate matches so 1925–1928 still fire)
          (effectiveDeath && deathYrNum <= 1928)
            ? searchChroniclingAmerica(primaryOcrName, effectiveDeath)
            : Promise.resolve([]),
          // Internet Archive: county/local-history full text for pre-1925 ordinary
          // people. Free (not Tavily); gated on the IA cutoff.
          (effectiveDeath && deathYrNum <= 1925)
            ? searchInternetArchive(primaryOcrName, effectiveDeath, locationHint)
            : Promise.resolve([]),
          ...researchTargets.map(t => fetchWikipediaPortraits(t.name, t.dates)),
          ...researchTargets.map(t => fetchWikipediaArticleSummary(t.name, t.dates)),
        ];
        // Per-leg empty shapes, in the same order: searchForPerson []→, wikiTree null×N,
        // wikidata null, chron [], archive [], portraits []×N, summaries null×N.
        const legFallbacks = [
          [],
          ...wikiTreeTargets.map(() => null),
          null,
          [],
          [],
          ...researchTargets.map(() => []),
          ...researchTargets.map(() => null),
        ];

        const raced = await raceResearchTimeout(Promise.all(legs), RESEARCH_TIMEOUT_MS);
        const allParallel = raced === RESEARCH_TIMEOUT ? legFallbacks : raced;
        if (raced === RESEARCH_TIMEOUT) {
          console.warn('Research fan-out timed out — degrading to stone + free sources');
          logEvent(EVENTS.PIPELINE_ERROR, { stage: 'research', reason: 'timeout' });
        }

        let idx = 0;
        const searchResults      = allParallel[idx++];
        const wikiTreeResults    = allParallel.slice(idx, idx += wikiTreeTargets.length);
        wikidataResult           = allParallel[idx++];
        const chronResults       = allParallel[idx++];
        const archiveResults     = allParallel[idx++];
        const portraitArrays     = allParallel.slice(idx, idx += wikiNames.length);
        const wikiSummaryResults = allParallel.slice(idx);

        // Primary WikiTree result; pass all as array when multiple subjects
        const wikiData = wikiTreeTargets.length > 1 ? wikiTreeResults.filter(Boolean) : wikiTreeResults[0];

        // Two-stage Tavily: if round one matched a FindAGrave memorial for the
        // right person, /extract the full page (family links, plot, contributor
        // bio the snippet misses). One extra Tavily credit, confirmed hits only.
        const fgDetail = await extractFindAGraveDetail(searchResults, effectiveDeath);

        // Merge extra sources into searchResults (all additive — never replacing).
        const mergedSearchResults = [
          ...searchResults,
          ...(fgDetail ? [fgDetail] : []),
          ...(chronResults || []),
          ...(archiveResults || []),
        ];

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

      // Resolve meanings for symbols the static SYMBOL_CONTEXT table can't explain,
      // so every recognised symbol on the Result screen is a tappable chip. One small
      // Gemini call, only when uncovered symbols exist (often a no-op). Merged onto any
      // meanings a cached story already carried. Non-fatal — never blocks the scan.
      try {
        const aiMeanings = await resolveSymbolMeanings(graveData.symbols);
        if (aiMeanings && Object.keys(aiMeanings).length > 0) {
          symbolMeanings = { ...(symbolMeanings || {}), ...aiMeanings };
        }
      } catch (e) {
        console.warn('Symbol-meaning resolution failed (non-fatal):', e?.message || e);
      }

      setStepIndex(4);

      // forwardGeocode resolves the cemetery and, if the grave is tagged in OSM,
      // the precise node. But camera EXIF / device GPS is always more accurate for
      // pin placement — the user was physically standing at the grave. Prefer real
      // GPS over Nominatim coords; only fall back to Nominatim when GPS is absent.
      const primaryName = primaryOcrName || bioResult.name || '';
      const geoResult = await forwardGeocode(bioResult.location, primaryName, bioResult.dates);
      // Wikidata burial coords (P119 place of burial → P625) are a documented,
      // confident location for famous figures when no GPS was captured. They beat
      // a Nominatim cemetery-centroid fallback (geoResult.approximate), but a PRECISE
      // geoResult — an actual tagged grave node — still wins.
      const wikidataCoords = wikidataResult?.burialCoords || null;
      const geoIsApproximate = geoResult?.approximate === true;
      // Resolution priority when no on-site GPS:
      //   1. real GPS (always best)
      //   2. a precise geocode (grave node)
      //   3. Wikidata burial coords (documented, treated as confident)
      //   4. an approximate cemetery-centroid geocode (last resort)
      const preciseGeo = geoResult && !geoIsApproximate ? { lat: geoResult.lat, lng: geoResult.lng } : null;
      const approxGeo = geoResult && geoIsApproximate ? { lat: geoResult.lat, lng: geoResult.lng } : null;
      const usedWikidataCoords = !gps && !preciseGeo && !!wikidataCoords;
      const refinedGps = gps ?? preciseGeo ?? wikidataCoords ?? approxGeo;
      // Flag the pin when it isn't the grave's real position: state-mismatch
      // geocodes, and cemetery-centroid fallbacks used in place of missing GPS
      // (those share one coordinate, so the user needs the drag-to-correct hint).
      // Wikidata burial coords are documented/confident, so a pin sourced from them
      // is NOT flagged — that's why famous library scans (e.g. Amy Winehouse) no
      // longer show the "approximate location" disclaimer.
      const lowConfidence = (geoResult?.lowConfidence || (!gps && geoIsApproximate && !usedWikidataCoords)) || undefined;

      // Read default visibility from user metadata
      const { data: { session } } = await supabase.auth.getSession();
      const defaultPublic = session?.user?.user_metadata?.default_public ?? false;

      // Biography resolved successfully — count this as a used scan.
      // (This is the cost gate — the paid AI work is done regardless of whether
      // the user chooses to save, so the scan is counted at scan time, not save time.)
      await incrementScanCount(session?.user?.id ?? null);

      // Build the story but DO NOT persist it yet. Persistence (local save, cloud
      // save, R2 upload, canonical-grave linking, grave_photos contribution) now
      // happens only when the user taps "Save" on the Result screen. We carry the
      // raw base64 and a few resolution hints so the save handler has what it needs.
      // A cache-hit grave_id (read-only find_grave result) is safe to keep here.
      const story = {
        ...bioResult,
        graveData,
        // Promote symbols to the top level so they round-trip to the cloud
        // (storyToRow writes story.symbols) and survive sync to other devices /
        // global bios — graveData itself is not a persisted column. Mirrors web.
        symbols: Array.isArray(graveData.symbols) && graveData.symbols.length ? graveData.symbols : null,
        symbol_meanings: symbolMeanings || null,
        portraits: resolvedPortraits,
        gps: refinedGps,
        _lowConfidence: lowConfidence,
        timestamp: Date.now(),
        is_public: defaultPublic,
        source: fromCamera ? 'camera' : 'library',
        grave_id: cachedBio?.grave_id || null,
        _unsaved: true,        // ResultScreen shows the Save button for this
        _base64: base64,       // needed for R2 upload at save time
        _primaryName: primaryName,
      };

      // Research succeeded for a previously offline-scanned story — remove the
      // placeholder and its persisted photo; the fresh story replaces it.
      if (pending) {
        const uid = session?.user?.id ?? null;
        const all = await loadStories(uid);
        await saveStories(all.filter(s => s.timestamp !== pending.timestamp), uid);
        deletePendingPhoto(pending.photoUri);
      }

      logEvent(EVENTS.BIO_SHOWN, {
        cached: !!cachedBio,
        hasGps: !!refinedGps,
        sources: Array.isArray(bioResult.sources) ? bioResult.sources.length : 0,
      });

      setLoading(false);
      navigation.navigate('Result', { story });
    } catch (err) {
      setLoading(false);
      logEvent(EVENTS.PIPELINE_ERROR, { stage: 'pipeline', message: err?.message });
      console.warn('Pipeline error:', String(err), 'message:', err?.message, 'stack:', err?.stack);
      // For fresh scans, offer to queue the photo for later — the common cause
      // here is the signal dropping mid-pipeline. Resumed pending scans are
      // already queued, so they just get the error.
      setPipelineError({
        message: err.message || 'Something went wrong. Please try again.',
        base64: pending ? null : base64,
        gps,
        fromCamera,
      });
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
          <Text style={styles.rejectedReason}>{pipelineError.message}</Text>
          {!!pipelineError.base64 && (
            <TouchableOpacity
              style={styles.tryAnyway}
              onPress={() => {
                const { base64, gps, fromCamera } = pipelineError;
                setPipelineError(null);
                createPendingStory(base64, gps, fromCamera);
              }}
            >
              <Text style={styles.tryAnywayText}>Save & Research Later</Text>
            </TouchableOpacity>
          )}
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
          <TouchableOpacity style={styles.tryAnyway} onPress={() => runPipeline(rejected.base64, true, rejected.gps, rejected.fromCamera, rejected.pending)}>
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
            <Text style={styles.sheetOptionHint}>Best at the graveside — your location pins the grave on your map</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.sheetOption}
            onPress={() => { setShowPicker(false); pickAndAnalyze(false); }}
          >
            <Text style={styles.sheetOptionText}>Choose from Library</Text>
            <Text style={styles.sheetOptionHint}>Use a gravestone photo you took earlier</Text>
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
        <Text style={styles.tip}>
          Tip: fill the frame with the inscription, and photograph at the cemetery when you can — the photo's location places the grave on your map.
        </Text>

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
  tip: {
    color: colors.ashDim, fontFamily: fonts.bodyItalic, textAlign: 'center',
    fontSize: 12, lineHeight: 18, maxWidth: 300,
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
  sheetOptionHint: {
    color: colors.ashDim, fontSize: 12, fontFamily: fonts.bodyItalic,
    textAlign: 'center', marginTop: 4, lineHeight: 17,
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
