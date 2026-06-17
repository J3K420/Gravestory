import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  Animated, ScrollView, Alert, Easing,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient, RadialGradient, Stop, Rect, Path, Line, Circle, Ellipse } from 'react-native-svg';
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

  // The headstone inside the viewfinder slowly "breathes" — a reverent ~5.6s
  // opacity swell, NOT the old harsh candle-flicker (which read as a rendering
  // glitch). Only the stone illustration animates; the gold viewfinder brackets
  // stay crisp — "the structure is fixed, the memory breathes".
  const breathe = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breathe, { toValue: 0.6, duration: 2800, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(breathe, { toValue: 1.0, duration: 2800, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
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
      // Funnel #1b: does GPS actually yield a cemetery name? Tracks the resolve
      // rate to test the "GPS improves accuracy" hypothesis in the field (the
      // cemetery name is a top-tier Tavily disambiguator; null at rural plots).
      if (gps) logEvent(EVENTS.CEMETERY_RESOLVED, { resolved: !!cemeteryName });

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
        let wikipediaSummary = wikiSummaryResults.length === 1
          ? wikiSummaryResults[0]
          : wikiSummaryResults;

        // Wikidata-title bridge: queryWikidata resolves the en.wikipedia article
        // title even when the stone's engraved name differs from it (alias/maiden/
        // stage name — "Erik Weisz" → "Harry Houdini"). The article-summary fetch
        // keys off the engraved name and its title-match guard rejects the correct
        // article in exactly that case. If Wikidata found a title for the PRIMARY
        // subject but the primary summary came back empty, retry by that title.
        // Single-subject: one object. Multi-subject: primary is index 0.
        if (wikidataResult?.wikipediaTitle) {
          const primaryEmpty = Array.isArray(wikipediaSummary)
            ? !wikipediaSummary[0]
            : !wikipediaSummary;
          if (primaryEmpty) {
            const bridged = await fetchWikipediaArticleSummary(
              primaryOcrName, datesStr, wikidataResult.wikipediaTitle);
            if (bridged) {
              if (Array.isArray(wikipediaSummary)) wikipediaSummary[0] = bridged;
              else wikipediaSummary = bridged;
            }
          }
        }

        setStepIndex(3);
        bioResult = await generateBiography(graveData, mergedSearchResults, wikiData, locationHint, wikipediaSummary, wikidataResult);

        // Funnel: which research sources actually returned hits on this scan.
        // Tavily is ~85% of variable cost — track its (and the free sources')
        // hit rate to tune the pipeline. Fired only on the research path (not the
        // bio cache hit), so zeros mean a real dry scan.
        logEvent(EVENTS.RESEARCH_YIELD, {
          tavily:      Array.isArray(searchResults) ? searchResults.length : 0,
          wikitree:    wikiTreeResults.filter(Boolean).length,
          wikidata:    wikidataResult ? 1 : 0,
          chronicling: Array.isArray(chronResults) ? chronResults.length : 0,
          archive:     Array.isArray(archiveResults) ? archiveResults.length : 0,
          wikipedia:   wikiSummaryResults.filter(Boolean).length,
          sources:     Array.isArray(bioResult?.sources) ? bioResult.sources.length : 0,
        });

        // Portrait fallback: if the stone showed only a surname (e.g. "HOUDINI"),
        // the single-token guard skipped the initial Wikipedia fetch. Now that the
        // biography has resolved the full name, retry — but split on " and " first
        // because bio.name is often a combined string ("Harry Houdini and Bess Houdini")
        // that would fail the Wikipedia title-match guard when passed as-is.
        resolvedPortraits = portraits;
        // Wikidata-title bridge for portraits: when the engraved name differs from
        // the Wikipedia article title, the name-keyed fetch finds nothing. Retry by
        // Wikidata's authoritative article title before the surname-split fallback.
        if (resolvedPortraits.length === 0 && wikidataResult?.wikipediaTitle) {
          const bridged = await fetchWikipediaPortraits(
            primaryOcrName, bioResult.dates, wikidataResult.wikipediaTitle);
          if (bridged.length > 0) resolvedPortraits = bridged;
        }
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
      <TouchableOpacity onPress={() => navigation.goBack()} style={styles.back}>
        <Text style={styles.backText}>← Back</Text>
      </TouchableOpacity>

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={refreshControl}
      >
        {/* Memorial-card hairline rules flanking a single gold mark */}
        <View style={styles.ruleRow}>
          <View style={styles.hairline} />
          <Text style={styles.ruleMark}>✦</Text>
          <View style={styles.hairline} />
        </View>

        <Text style={styles.title}>Photograph the Stone</Text>
        <Text style={styles.subtitle}>Frame the inscription, edge to edge.</Text>

        {/* Viewfinder: static gold corner brackets framing a slowly breathing
            headstone. Purely illustrative — not a touch target. */}
        <View style={styles.viewfinder}>
          {/* Layer A — static corner brackets + edge ticks */}
          <Svg width={320} height={340} viewBox="0 0 320 340">
            {/* top-left */}
            <Rect x={0}     y={0}     width={30}  height={2.2} fill="#f2b65c" opacity={0.9} />
            <Rect x={0}     y={0}     width={2.2} height={30}  fill="#f2b65c" opacity={0.9} />
            {/* top-right */}
            <Rect x={290}   y={0}     width={30}  height={2.2} fill="#f2b65c" opacity={0.9} />
            <Rect x={317.8} y={0}     width={2.2} height={30}  fill="#f2b65c" opacity={0.9} />
            {/* bottom-left */}
            <Rect x={0}     y={337.8} width={30}  height={2.2} fill="#f2b65c" opacity={0.9} />
            <Rect x={0}     y={310}   width={2.2} height={30}  fill="#f2b65c" opacity={0.9} />
            {/* bottom-right */}
            <Rect x={290}   y={337.8} width={30}  height={2.2} fill="#f2b65c" opacity={0.9} />
            <Rect x={317.8} y={310}   width={2.2} height={30}  fill="#f2b65c" opacity={0.9} />
            {/* edge ticks (HUD detail) */}
            <Rect x={155}   y={0}     width={10}  height={1.4} fill="#f2b65c" opacity={0.3} />
            <Rect x={155}   y={338.6} width={10}  height={1.4} fill="#f2b65c" opacity={0.3} />
            <Rect x={0}     y={165}   width={1.4} height={10}  fill="#f2b65c" opacity={0.3} />
            <Rect x={318.6} y={165}   width={1.4} height={10}  fill="#f2b65c" opacity={0.3} />
          </Svg>

          {/* Layer B — headstone + inscription + ground (breathes) */}
          <Animated.View style={[StyleSheet.absoluteFill, { opacity: breathe }]}>
            <Svg width={320} height={340} viewBox="0 0 320 340">
              <Defs>
                {/* Stroke gradients MUST be userSpaceOnUse — objectBoundingBox
                    stroke gradients silently paint nothing on Android RN-SVG. */}
                <LinearGradient id="vfStone" x1={160} y1={78} x2={160} y2={272} gradientUnits="userSpaceOnUse">
                  <Stop offset="0"    stopColor="#e8d4a0" stopOpacity="0.95" />
                  <Stop offset="0.55" stopColor="#c9a84c" stopOpacity="0.9" />
                  <Stop offset="1"    stopColor="#6b4f1e" stopOpacity="0.7" />
                </LinearGradient>
                <LinearGradient id="vfGround" x1={62} y1={276} x2={258} y2={276} gradientUnits="userSpaceOnUse">
                  <Stop offset="0"   stopColor="#c9a84c" stopOpacity="0" />
                  <Stop offset="0.3" stopColor="#c9a84c" stopOpacity="0.35" />
                  <Stop offset="0.7" stopColor="#c9a84c" stopOpacity="0.35" />
                  <Stop offset="1"   stopColor="#c9a84c" stopOpacity="0" />
                </LinearGradient>
                {/* Radial FILL gradient is fine in objectBoundingBox — replaces a drop shadow */}
                <RadialGradient id="vfGlow" cx="0.5" cy="0.5" r="0.5">
                  <Stop offset="0" stopColor="#f2b65c" stopOpacity="0.16" />
                  <Stop offset="1" stopColor="#f2b65c" stopOpacity="0" />
                </RadialGradient>
              </Defs>

              {/* ambient ground glow */}
              <Ellipse cx={160} cy={278} rx={112} ry={10} fill="url(#vfGlow)" />

              {/* inner face panel — stone reads as solid, not hollow */}
              <Path d="M100 270 L100 150 Q100 86 160 86 Q220 86 220 150 L220 270 Z"
                    fill="rgba(42,32,23,0.55)" />

              {/* headstone outline — the defining gold stroke */}
              <Path d="M92 272 L92 150 Q92 78 160 78 Q228 78 228 150 L228 272 Z"
                    fill="none" stroke="url(#vfStone)" strokeWidth={1.9} strokeLinejoin="round" />

              {/* inner chamfer — carved-edge illusion */}
              <Path d="M102 270 L102 152 Q102 88 160 88 Q218 88 218 152 L218 270"
                    fill="none" stroke="url(#vfStone)" strokeWidth={0.8} strokeOpacity={0.32} />

              {/* carved ornament hint near the crown */}
              <Circle cx={160} cy={124} r={11} fill="none" stroke="#efe4d2" strokeOpacity={0.16} strokeWidth={1.0} />

              {/* three worn ghost inscription lines */}
              <Line x1={124} y1={166} x2={196} y2={166} stroke="#efe4d2" strokeOpacity={0.20} strokeWidth={1.0} strokeLinecap="round" />
              <Line x1={130} y1={188} x2={190} y2={188} stroke="#efe4d2" strokeOpacity={0.16} strokeWidth={0.9} strokeLinecap="round" />
              <Line x1={136} y1={210} x2={184} y2={210} stroke="#efe4d2" strokeOpacity={0.12} strokeWidth={0.8} strokeLinecap="round" />

              {/* ground line pair (fading ends) */}
              <Line x1={80} y1={276} x2={240} y2={276} stroke="url(#vfGround)" strokeWidth={1.3} />
              <Line x1={62} y1={281} x2={258} y2={281} stroke="url(#vfGround)" strokeWidth={0.7} strokeOpacity={0.45} />
            </Svg>
          </Animated.View>
        </View>

        {/* Primary CTA — Take Photo */}
        <TouchableOpacity
          style={styles.primaryBtn}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel="Take a photo of a gravestone with your camera"
          onPress={() => pickAndAnalyze(true)}
        >
          <CameraIcon />
          <View style={styles.btnTextCol}>
            <Text style={styles.primaryLabel}>Take Photo</Text>
            <Text style={styles.primaryHint}>Best at the graveside — GPS pins the grave on your map</Text>
          </View>
        </TouchableOpacity>

        {/* Secondary CTA — Choose from Library */}
        <TouchableOpacity
          style={styles.secondaryBtn}
          activeOpacity={0.75}
          accessibilityRole="button"
          accessibilityLabel="Choose a gravestone photo from your photo library"
          onPress={() => pickAndAnalyze(false)}
        >
          <LibraryIcon />
          <View style={styles.btnTextCol}>
            <Text style={styles.secondaryLabel}>Choose from Library</Text>
            <Text style={styles.secondaryHint}>Use a gravestone photo you took before</Text>
          </View>
        </TouchableOpacity>

        <Text style={styles.tagline}>every life deserves to be remembered</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

function CameraIcon() {
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke={colors.onFlame} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M3 9h3l1.5-2.5h9L18 9h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1z" />
      <Circle cx={12} cy={14} r={3.2} />
    </Svg>
  );
}

function LibraryIcon() {
  return (
    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke={colors.flame} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      <Rect x={4} y={6} width={16} height={14} rx={2} />
      <Path d="M7 6 V4 a1 1 0 0 1 1-1 h11 a1 1 0 0 1 1 1 v11" />
      <Path d="M8 16 l3-3 l2 2 l3-4 l2 3" />
    </Svg>
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
  back: { paddingHorizontal: 24, paddingTop: 16, paddingBottom: 0 },
  backText: { color: colors.ashDim, fontFamily: fonts.body, fontSize: 15 },
  scroll: { paddingHorizontal: 24, paddingTop: 8, paddingBottom: 28, alignItems: 'center' },

  ruleRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    marginTop: 18, marginBottom: 14,
  },
  hairline: { width: 56, height: 1, backgroundColor: 'rgba(242,182,92,0.30)' },
  ruleMark: { color: colors.flame, opacity: 0.7, fontSize: 12, marginHorizontal: 12, fontFamily: fonts.title },

  title: {
    color: colors.parchment, fontFamily: fonts.title, fontSize: 24,
    letterSpacing: 0.5, textAlign: 'center', marginBottom: 4,
  },
  subtitle: {
    color: colors.ash, fontFamily: fonts.bodyItalic, fontSize: 13,
    lineHeight: 19, textAlign: 'center', marginBottom: 22,
  },

  viewfinder: { width: 320, height: 340, alignSelf: 'center', marginBottom: 26 },

  // minHeight (not height) so the two-line label+hint never clips — the
  // GraveStory Android-text lesson; the row centers and the text column flexes.
  primaryBtn: {
    flexDirection: 'row', alignItems: 'center', width: '100%', minHeight: 72,
    backgroundColor: colors.flame, borderRadius: radius.md,
    paddingVertical: 14, paddingHorizontal: 20, gap: 14, marginBottom: 12,
  },
  secondaryBtn: {
    flexDirection: 'row', alignItems: 'center', width: '100%', minHeight: 72,
    backgroundColor: colors.stone2, borderWidth: 1, borderColor: 'rgba(242,182,92,0.28)',
    borderRadius: radius.md, paddingVertical: 14, paddingHorizontal: 20, gap: 14, marginBottom: 24,
  },
  btnTextCol: { flex: 1 },
  primaryLabel: { color: colors.onFlame, fontFamily: fonts.sansBold, fontSize: 17, letterSpacing: 0.3 },
  primaryHint: { color: colors.onFlame, opacity: 0.62, fontFamily: fonts.body, fontSize: 12, lineHeight: 16, marginTop: 2 },
  secondaryLabel: { color: colors.parchment, fontFamily: fonts.bodyMedium, fontSize: 16, letterSpacing: 0.3 },
  secondaryHint: { color: colors.ashDim, fontFamily: fonts.bodyItalic, fontSize: 12, lineHeight: 16, marginTop: 2 },

  tagline: {
    color: colors.ash, opacity: 0.5, fontFamily: fonts.serifItalic, fontSize: 12,
    letterSpacing: 0.3, textAlign: 'center', marginBottom: 8,
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
