import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  Animated, ScrollView, Alert, Easing, AppState,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient, RadialGradient, Stop, Rect, Path, Line, Circle, Ellipse, ClipPath, G } from 'react-native-svg';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as Location from 'expo-location';
import { supabase } from '../lib/supabase';
import { useRefresh } from '../lib/use-refresh';
import { colors, fonts, radius, space } from '../lib/theme';
import { verifyIsGravestone, readGravestone, resolveSymbolMeanings, buildMentionHits, resolveMentions } from '../lib/api-gemini';
import { searchForPerson, extractFindAGraveDetail } from '../lib/api-tavily';
import { searchWikiTree } from '../lib/api-wikitree';
import { queryWikidata, queryWikidataByBurialPlace } from '../lib/api-wikidata';
import { searchChroniclingAmerica } from '../lib/api-chroniclingamerica';
import { searchInternetArchive } from '../lib/api-internetarchive';
import { fetchWikipediaPortraits, fetchWikipediaArticleSummary } from '../lib/api-wikipedia';
import { generateBiography } from '../lib/biography';
import { forwardGeocode, reverseGeocode, reverseGeocodeCemetery } from '../lib/api-nominatim';
import { checkScanLimit } from '../lib/scan-limit';
import { beginScan, endScan, commitScan } from '../lib/scan-token';
import { loadStories, saveStories } from '../lib/storage';
import { savePendingPhoto, readPendingPhoto, deletePendingPhoto } from '../lib/pending';
import { logEvent, EVENTS } from '../lib/analytics';
import { ORIGINATE_RELATIVES } from '../lib/config';
import { requestNotificationPermission, notifyStoryReady, setLastReadyStory } from '../lib/notify';

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

// The roaming flashlight pool animates its cx/cy, so it needs an animatable Circle.
const AnimatedCircle = Animated.createAnimatedComponent(Circle);
// The header candle flame flickers its luminance (SVG opacity), so its body and
// tip need animatable Ellipse/Path wrappers.
const AnimatedEllipse = Animated.createAnimatedComponent(Ellipse);
const AnimatedPath = Animated.createAnimatedComponent(Path);

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

  // True while the OS picker (camera/library) is open. The picker backgrounds
  // the app; when it closes the app returns to 'active'. We use that resume
  // signal — not a setLoading before/after the picker — to show the loading
  // screen at exactly the right moment: the instant the camera CLOSES, so it
  // never blips before the camera opens and never lets the camera screen flash
  // back on return. Cleared once the picker promise resolves.
  const pickInProgressRef = useRef(false);

  // True only AFTER the app has actually left 'active' for the picker activity
  // (gone 'background'/'inactive'). Android emits a transient 'active' event as
  // the camera activity is being launched — BEFORE the app has truly
  // backgrounded — and without this guard that spurious 'active' flipped the
  // loader on for a frame before the camera covered it (the pre-camera flash).
  // We only treat a return-to-'active' as "picker closed" once we've first seen
  // the app leave 'active'. Reset alongside pickInProgressRef.
  const pickHasBackgroundedRef = useRef(false);

  // Re-entrancy lock for pickAndAnalyze, armed SYNCHRONOUSLY at the top of the
  // function (before any await) and released in its finally. Distinct from
  // pickInProgressRef, which is scoped to the picker launch only and is read by
  // the AppState handler / useFocusEffect — arming THAT early would mislabel the
  // permission-prompt background as a picker return and flash the loader. This
  // ref is read ONLY by the re-entrancy guard, so arming it across the whole
  // function (including the pre-picker scan-limit + permission awaits) is safe
  // and actually closes the double-tap window those awaits open.
  const pickArmedRef = useRef(false);

  // Pipeline-duration + abandonment tracking (S67). `pipelineActiveRef` is true
  // ONLY while research is genuinely in flight — distinct from the `loading` UI
  // flag, which deliberately lingers through the Result-screen slide. It's set
  // true at the top of runPipeline and flipped false at EVERY exit (success,
  // error, rejection), so leaving the screen on the success path does NOT count
  // as abandonment. `pipelineStartRef` stamps the start for dur_ms; `stepRef`
  // mirrors stepIndex so the blur/background handlers read the live stage
  // without re-subscribing on every step change.
  const pipelineActiveRef = useRef(false);
  const pipelineStartRef  = useRef(0);
  const stepRef           = useRef(0);

  // Fire scan_abandoned at most once per pipeline run, and only while a pipeline
  // is genuinely active. Clears the active flag so a follow-on blur/background
  // (e.g. background → kill) can't double-log the same abandonment.
  const reportAbandonIfActive = useCallback(() => {
    if (!pipelineActiveRef.current) return;
    pipelineActiveRef.current = false;
    logEvent(EVENTS.SCAN_ABANDONED, {
      dur_ms: Date.now() - pipelineStartRef.current,
      stepIndex: stepRef.current,
    });
  }, []);

  // On the success path runPipeline navigates to Result WITHOUT clearing `loading`,
  // so the loading screen — not the viewfinder — stays underneath while Result
  // slides in over it (clearing it on navigate flashed the viewfinder beside the
  // sliding Result screen — the bug). We reset to the default state here when
  // CameraScreen regains focus, i.e. the user navigated back from Result, so the
  // viewfinder is ready for them. The picker guard prevents wiping the loader if a
  // focus event fires while the OS picker round-trip is mid-flight.
  useFocusEffect(
    useCallback(() => {
      if (!pickInProgressRef.current) {
        setLoading(false);
        setStepIndex(0);
      }
    }, [])
  );

  // Mirror stepIndex into a ref so the abandonment handlers report the live
  // stage without re-subscribing the navigation/AppState listeners on each step.
  useEffect(() => { stepRef.current = stepIndex; }, [stepIndex]);

  // Count a navigation-away (back button, or system back) during an active
  // pipeline as abandonment. The success path flips pipelineActiveRef false
  // before navigating to Result, so this only fires when the user actually
  // bails out mid-research. Unmount cleanup is the catch-all if the screen is
  // torn down some other way while still active.
  useEffect(() => {
    const unsub = navigation.addListener('blur', reportAbandonIfActive);
    return () => { unsub(); reportAbandonIfActive(); };
  }, [navigation, reportAbandonIfActive]);

  // The headstone inside the viewfinder slowly "breathes" — a reverent ~5.6s
  // opacity swell, NOT the old harsh candle-flicker (which read as a rendering
  // glitch). Only the stone illustration animates; the gold viewfinder brackets
  // stay crisp — "the structure is fixed, the memory breathes".
  const breathe = useRef(new Animated.Value(1)).current;
  // A soft halo behind the stone that swells and fades on its own slow cycle —
  // the "haunting glow" (cousin of the home logo's catch-light), out of phase
  // with the breathe so the two never beat in lockstep.
  const glow = useRef(new Animated.Value(0.28)).current;
  // A roaming flashlight — a soft pool of light that wanders over the stone in
  // the dark, like someone searching the inscription with a torch. Wherever it
  // falls the carved detail is lit; elsewhere the stone stays dim. The 2D wander
  // comes from two X/Y loops on different (coprime-ish) periods, so the path
  // never repeats on a tight cycle and reads as a hand-held drift, not a line.
  // Both are layout-driven (useNativeDriver:false) — they animate SVG transforms.
  // IMPORTANT: each loop below is a closed A→B→A cycle and the initial value
  // here MUST equal that cycle's A, or the first loop boundary snaps the beam
  // from its resting value back to A (the "jump/reset" bug).
  const beamX = useRef(new Animated.Value(120)).current;  // viewBox x of the pool centre (= A)
  const beamY = useRef(new Animated.Value(124)).current;  // viewBox y of the pool centre (= A)
  // The beam also gently pulses brightness so the torch feels alive. This drives
  // an SVG element's `opacity` prop (not a View style), so it must be JS-driven —
  // the native driver only animates View transform/opacity, not SVG props.
  const beamPulse = useRef(new Animated.Value(0.78)).current;
  useEffect(() => {
    // Every loop is a CLOSED cycle: it ends on the same value it began, so the
    // Animated.loop restart is seamless (no snap-back at the loop boundary).
    // breathe starts at 1.0 → dips → returns to 1.0.
    const breatheLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(breathe, { toValue: 0.62, duration: 2800, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(breathe, { toValue: 1.0,  duration: 2800, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    );
    // Aura is dimmer now — the torch is the star; the aura is just residual dark-glow.
    // Starts at 0.28 (its initial value) → up → back to 0.28.
    const glowLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(glow, { toValue: 0.7,  duration: 2300, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(glow, { toValue: 0.28, duration: 3100, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    );
    // Horizontal wander, closed cycle 120 → 208 → 120 (initial value = 120).
    const beamXLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(beamX, { toValue: 208, duration: 4000, easing: Easing.inOut(Easing.sin), useNativeDriver: false }),
        Animated.timing(beamX, { toValue: 120, duration: 4000, easing: Easing.inOut(Easing.sin), useNativeDriver: false }),
      ])
    );
    // Vertical wander on a DIFFERENT period (so X/Y don't sync into a straight
    // diagonal), closed cycle 124 → 230 → 124 (initial value = 124).
    const beamYLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(beamY, { toValue: 230, duration: 5400, easing: Easing.inOut(Easing.sin), useNativeDriver: false }),
        Animated.timing(beamY, { toValue: 124, duration: 5400, easing: Easing.inOut(Easing.sin), useNativeDriver: false }),
      ])
    );
    // Brightness pulse, closed cycle 0.78 → 1.0 → 0.78 (initial value = 0.78).
    const beamPulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(beamPulse, { toValue: 1.0,  duration: 1500, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
        Animated.timing(beamPulse, { toValue: 0.78, duration: 1500, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
      ])
    );
    breatheLoop.start();
    glowLoop.start();
    beamXLoop.start();
    beamYLoop.start();
    beamPulseLoop.start();
    return () => { breatheLoop.stop(); glowLoop.stop(); beamXLoop.stop(); beamYLoop.stop(); beamPulseLoop.stop(); };
  }, []);

  // Show the loading screen the moment the camera/library picker CLOSES. The
  // picker is a fullscreen OS activity that backgrounds the app; closing it
  // (after the user confirms a photo) brings the app back to 'active'. Flipping
  // loading here — rather than before the picker (blips a fake spinner before
  // the camera opens) or after it resolves (lets the camera screen flash back
  // for the ~1-2s of GPS/compression) — puts the spinner up exactly on return.
  // Gated on pickInProgressRef so unrelated app resumes don't trigger it.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      // Record the picker activity actually taking over (app left 'active').
      // Android fires a spurious 'active' DURING the camera launch handshake,
      // before this background event — gating the loader on having seen this
      // first is what stops that transient 'active' painting the loading screen
      // for a frame before the camera opens (the pre-camera flash).
      if (state !== 'active' && pickInProgressRef.current) {
        pickHasBackgroundedRef.current = true;
      }
      // Treat a return-to-'active' as "picker closed" ONLY after we've seen the
      // app leave 'active' for the picker — i.e. this is a genuine resume, not
      // the transient 'active' Android emits while the camera is still opening.
      if (state === 'active' && pickInProgressRef.current && pickHasBackgroundedRef.current) {
        setLoading(true);
      }
      // Backgrounding the app mid-scan is NO LONGER treated as abandonment. The
      // common case is a quick swipe-away (answer a text, glance at another app)
      // and return — the OS keeps our JS running through a short grace window, so
      // the scan often finishes and Result is ready on the way back. Eagerly
      // logging scan_abandoned here mislabeled those recoverable backgrounds, so
      // we no longer fire it on 'background'. Instead, when the scan completes
      // while the app is still backgrounded, runPipeline's success tail fires a
      // local "story ready" notification (it reads AppState.currentState directly).
      //
      // Telemetry trade-off (intentional): a deliberate back-out still fires the
      // navigation 'blur' handler and a still-mounted teardown still fires the
      // unmount handler — both call reportAbandonIfActive. The one cohort we no
      // longer capture is "backgrounded, then the OS suspends/kills the process
      // mid-scan" (no blur, no React cleanup runs). That's an accepted blind spot:
      // counting every background as abandoned was the worse distortion now that
      // backgrounding is a supported, recoverable state.
    });
    return () => sub.remove();
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
    // Re-entrancy guard. The Take Photo / Choose from Library buttons have no
    // built-in debounce, so a rapid double-tap (or tapping both) could launch two
    // overlapping picks that share ONE pair of refs (pickInProgressRef /
    // pickHasBackgroundedRef) — when the first resolves it clears the refs out
    // from under the second, blinding the AppState handler and either flashing the
    // viewfinder back or stranding the spinner. A single ref pair can't represent
    // two concurrent picks, so we refuse to start a second while one is in flight.
    // We gate on pickArmedRef (NOT pickInProgressRef): pickInProgressRef isn't set
    // until the picker launch, AFTER several awaits (scan-limit + permission), so a
    // second tap landing during those awaits would slip past a pickInProgressRef
    // check. pickArmedRef is armed SYNCHRONOUSLY just below — before any await — so
    // the guard is atomic. (The offline re-entry from offerOfflineScan is safe: that
    // path RETURNS first, releasing the lock in finally, before the user can tap
    // "Scan Offline".)
    if (pickArmedRef.current) return;
    pickArmedRef.current = true;
    try {

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

    // Request notification permission in-context, now that a scan is actually
    // proceeding ("you're about to wait on a scan"), not at cold boot. This is the
    // ONLY place we may prompt — it runs in the foreground; the background
    // completion path only CHECKS permission, never requests. Fire-and-forget — it
    // must not delay the picker, and it's fail-soft: a denied/failed permission
    // just means a backgrounded scan won't notify on completion. Only prompts the
    // first time; later scans see the resolved status and no-op.
    requestNotificationPermission();

    // exif: true so we can read GPS coords before compression strips them. On iOS
    // (and the web app) the picker hands back unredacted EXIF, so library picks can
    // still carry their original GPS; on Android the OS redacts it (see the GPS note
    // below). We leave legacy unset so the modern system Photo Picker is used — it
    // needs no broad media permission, which is the whole point of dropping
    // expo-media-library for Play Store compliance.
    const opts = { mediaTypes: ['images'], quality: 0.85, base64: false, exif: true };

    if (fromCamera) {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) { Alert.alert('Permission needed', 'Camera access is required.'); return; }
      // Pre-warm the GPS chip NOW, the instant before the camera opens, so it's
      // acquiring satellites while the user frames and takes the photo — turning the
      // later getDeviceGps() read from a cold lock into a warm, fast, precise one.
      // NOTE: this is a no-op on the FIRST-EVER scan (warmGps only CHECKS permission,
      // never prompts, and the permission is still undetermined then) — that scan
      // reads from a cold chip and leans on getDeviceGps's instant cache fallback for
      // a coordinate. Every subsequent scan (permission resolved) gets the warm-up.
      // Camera-only (a library photo isn't taken where the user stands now).
      // Fire-and-forget + permission-checked — see warmGps.
      warmGps();
    }

    // Wrap from the picker launch through the GPS/compression prep. We do NOT
    // setLoading here — the AppState 'active' handler flips loading the instant
    // the picker closes (see the effect above), gated on pickInProgressRef. That
    // shows the spinner exactly on return: no fake blip before the camera opens,
    // no camera-screen flash on the way back. The try ensures any failure
    // (picker throw, compression throw) clears the ref + loading and surfaces
    // via the pipelineError panel instead of stranding the spinner.
    try {
      pickInProgressRef.current = true;
      // Fresh launch: we have NOT backgrounded yet. Reset so a leftover true from
      // a prior pick can't make the next launch's transient 'active' flash the loader.
      pickHasBackgroundedRef.current = false;
      const result = fromCamera
        ? await ImagePicker.launchCameraAsync(opts)
        : await ImagePicker.launchImageLibraryAsync(opts);
      // Picker closed; the resume handler has already shown the spinner (on
      // confirm) or it'll be cleared just below (on cancel).
      pickInProgressRef.current = false;
      pickHasBackgroundedRef.current = false;

      if (result.canceled) {
        // User backed out — clear the spinner the resume handler may have set.
        setLoading(false);
        return;
      }

      // Belt-and-suspenders: the resume handler normally shows the spinner the
      // instant the picker closes, but if the picker promise resolves BEFORE the
      // AppState 'active' event fires, the ref is already false by then. Setting
      // it here (only after a confirmed, non-canceled photo) guarantees the
      // spinner is up for the GPS/compression prep regardless of event ordering.
      // This never blips before the camera because it's after the picker.
      setLoading(true);

      const asset = result.assets[0];

      // Pull GPS from the photo's own EXIF before ImageManipulator strips it.
      // Only fall back to device GPS for camera shots — for library photos the device
      // is not physically at the grave, so device location would be wrong.
      //
      // NOTE: On Android the OS redacts GPS tags from any photo read through the
      // system picker, so asset.exif has no location for library picks there. We
      // used to recover it via expo-media-library's getAssetInfoAsync, but that
      // required READ_MEDIA_IMAGES, which Google Play disallows for our "infrequent"
      // photo use. So an Android library pick now yields no EXIF GPS — the pin
      // resolves downstream from Wikidata burial coords (famous graves) or by
      // geocoding the AI-derived burial location. If the bio also has no location
      // string (an obscure stone with no sources), the story has no map pin at all —
      // an accepted gap for that narrow cohort. Camera shots are unaffected: they
      // fall back to live device GPS below.
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

      if (!gps && deviceGps) {
        gps = deviceGps;
      }

      // A library pick with no GPS is expected — on Android the OS redacts EXIF
      // location from picker reads, and elsewhere many photos (screenshots, cloud
      // copies, edited images) simply carry none. Degrade silently and let the
      // pin resolve downstream (Wikidata burial coords / geocode) or let the user
      // correct it on the map.
      if (offline) {
        // Offline path navigates to Result (or alerts on failure and stays here);
        // clear the loading screen we showed at confirmation so the Camera screen
        // isn't stranded in the loading state if the user comes back.
        setLoading(false);
        await createPendingStory(manipResult.base64, gps, fromCamera);
        return;
      }

      await runPipeline(manipResult.base64, false, gps, fromCamera);
    } catch (err) {
      pickInProgressRef.current = false;
      pickHasBackgroundedRef.current = false;
      setLoading(false);
      console.warn('Photo prep failed:', err?.message || err);
      setPipelineError({
        message: err?.message || 'Could not process that photo. Please try again.',
        base64: null,
        gps: null,
        fromCamera,
      });
    }

    } finally {
      // Release the re-entrancy lock on EVERY exit (early returns, picker cancel,
      // success → runPipeline, and the photo-prep catch). runPipeline has already
      // run by the time the success path reaches here, but that's fine: the lock
      // only needs to span THIS function's picker launch, and a fresh tap on the
      // Camera screen after navigation is a new, legitimate pick.
      pickArmedRef.current = false;
    }
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
    // Mark a pipeline genuinely in flight + stamp the start for dur_ms. Cleared
    // at every exit below so a screen-leave only logs scan_abandoned when the
    // user actually bails mid-research.
    pipelineActiveRef.current = true;
    pipelineStartRef.current = Date.now();
    stepRef.current = 0;

    try {
      // Device-GPS RETRY for the "Use it anyway" verification bypass (S72). On that
      // path pickAndAnalyze captured one device-GPS reading; on a COLD chip it can
      // time out, and the rejection screen reuses that single null reading
      // (rejected.gps). By the time the user reads the rejection and taps through,
      // the chip has had seconds to warm up, so a second attempt here usually
      // succeeds — and without it an unmarked / no-name stone (no bio location to
      // fall back on) gets no coordinate at all and the Result-screen Map chip never
      // appears.
      //
      // Tightly gated, because a broader retry caused two regressions (both caught in
      // adversarial review):
      //   • `skipVerify` ONLY — i.e. the bypass. The NORMAL camera path is already
      //     fixed by getDeviceGps itself (last-known fast path + longer timeout) in
      //     pickAndAnalyze; retrying again here would just chain a SECOND cold-GPS
      //     wait before OCR (up to ~30s of black screen). The bypass is the one path
      //     whose pre-call genuinely predates the chip warming up.
      //   • `!pending` — a RESUMED offline camera scan is researched later from a
      //     DIFFERENT place (home, wifi). Its only trustworthy coordinate is the one
      //     captured at the grave (pending.gps); if that's null the right degrade is
      //     "no pin, drag to correct", NEVER the user's current location. Retrying
      //     here would silently pin the grave at the user's house and push that wrong
      //     coordinate to find_grave / findOrCreateGrave / grave_photos / the public map.
      // Camera-only (device location is meaningless for a library photo). Non-fatal:
      // still null → degrade as before. Done BEFORE the reverse-geo / cemetery-name
      // promises below so a recovered coordinate also feeds Tavily disambiguation.
      if (!gps && fromCamera && skipVerify && !pending) {
        const retried = await getDeviceGps();
        if (retried) gps = retried;
      }

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
            pipelineActiveRef.current = false; // resolved into the rejection screen, not abandoned
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
              .select('name,dates,biography,public_biography,has_originated_relatives,location,inscription,symbols,symbol_meanings,sources,source_urls,portrait_left_url,portrait_right_url,portraits,grave_id')
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

      // ── SERVER-SIDE SCAN GATE (S78 / audit 2026-06-26) ──────────────
      // The authoritative cost control. beginScan() calls the Worker /begin-scan,
      // which verifies the JWT, CHECKS the user's allowance (read-only — records
      // NOTHING), and mints the short-lived scan token that proxyHeaders() attaches to
      // every subsequent paid call (symbol-resolution, research, biography). Placed
      // HERE — after OCR + the bio-cache decision, before any scan-token-gated call
      // (resolveSymbolMeanings below is the first) — so that a verify-REJECTED photo
      // never reaches here (verify + OCR ran on the JWT route). The scan is RECORDED
      // later by commitScan() — only AFTER the biography is successfully produced — so
      // a mid-pipeline failure costs nothing, with no client-triggerable delete to
      // abuse (the old client incrementScanCount was removed in S78; a refund route
      // was tried and rejected as an allowance-reset vector). A bio-CACHE hit still
      // commits one scan (parity with web), because the cache branch also reaches the
      // commit below. [re-review 2026-06-26]
      const scanGate = await beginScan();
      if (!scanGate.allowed) {
        // Clear the in-flight markers so leaving doesn't log scan_abandoned, and
        // route to the right surface. We're past the picker (photo taken, loader up).
        // (endScan() runs in the finally below.)
        pipelineActiveRef.current = false;
        setLoading(false);
        if (scanGate.code === 'AT_LIMIT') {
          logEvent(EVENTS.SCAN_LIMIT_HIT, { count: scanGate.used, limit: scanGate.allowance, isGuest: false });
          navigation.navigate('Paywall', { count: scanGate.used, limit: scanGate.allowance, type: 'scan', isGuest: false });
        } else if (scanGate.code === 'NO_AUTH') {
          // Signed out (session expired between picker and here) — send to sign-in.
          navigation.navigate('Auth');
        } else {
          // CHECK_FAILED / network — begin-scan failed CLOSED server-side, so NO scan
          // was consumed. Surface the error screen with the offline-queue option (the
          // photo is preserved so the user can research it once back online). Mirrors
          // the existing _checkFailed → offerOfflineScan path. Object shape so the
          // renderer's pipelineError.message / .base64 (Save & Research Later) work.
          setPipelineError({
            message: scanGate.error || 'Could not start the scan. Please check your connection and try again.',
            base64: pending ? null : base64,
            fromCamera,
            gps,
          });
        }
        return;
      }

      let bioResult;
      let resolvedPortraits;
      // AI-resolved meanings for symbols the static SYMBOL_CONTEXT table can't
      // explain; reused from a cached story when available, else resolved below.
      let symbolMeanings = cachedBio?.symbol_meanings || null;
      // [latency #3] Kick off symbol-meaning resolution NOW (it depends only on
      // graveData.symbols, already known from OCR) so this Gemini call overlaps the
      // entire research fan-out + biography generation instead of running serially
      // after them. Awaited at the existing merge point below — same inputs, same
      // merge, same non-fatal behavior; only the wall-clock placement changes.
      // resolveSymbolMeanings returns {} instantly with no network when every symbol
      // is table-covered, so this costs nothing on clean stones.
      const symbolMeaningsPromise = resolveSymbolMeanings(graveData.symbols)
        .catch(e => { console.warn('Symbol-meaning resolution failed (non-fatal):', e?.message || e); return null; });
      // Inc2: app-originated spouse names for THIS scan; [] on a cache hit.
      // Hoisted so the story-build literal can read it (wikiData is block-scoped).
      let _origUnique = [];
      // Mentions: name-safe one-line source pointers from this scan's raw research.
      // Resolves to [] on a cache hit (no fresh research). Hoisted like _origUnique.
      let mentionsPromise = Promise.resolve([]);
      if (cachedBio) {
        bioResult = {
          name: cachedBio.name,
          dates: cachedBio.dates,
          // Reuse the living-name-REDACTED public copy when present — the cached
          // story belongs to a DIFFERENT user, so handing them the raw bio would
          // re-expose living relatives' names that redaction hid on the public
          // map. Unflagged rows fall back to the raw bio for public stories that
          // predate redaction (public_biography NULL), matching the global-map RPC.
          // A row carrying APP-ORIGINATED relative names must NEVER fall back to
          // the raw bio (it would leak originated names to this other user); serve
          // a safe placeholder instead — mirrors migration 019's flag-guarded RPC.
          biography: cachedBio.has_originated_relatives
            ? (cachedBio.public_biography || 'This public biography is being prepared.')
            : (cachedBio.public_biography || cachedBio.biography),
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
        // When the isMulti path falls back to graveData.names (multiple_subjects===true
        // but a thin subjects[] array), those entries are RAW role-tagged OCR strings —
        // "George (deceased)", "Lizzie Knuver (wife)". Passing them unstripped into
        // WikiTree/Wikipedia issues a polluted query (LastName "(wife)") AND researches a
        // LIVING relative as if deceased. searchForPerson (api-tavily.js) already strips
        // these; do the same here: drop entries whose role tag marks a living relation,
        // and strip the parenthetical from the rest. [search-audit #3]
        const LIVING_ROLE = /\((?:[^)]*\b(?:wife|husband|spouse|son|daughter|mother|father|child|children|sister|brother|survived|living)\b[^)]*)\)/i;
        const cleanResearchName = n => (n || '').replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
        const _cleanedMultiNames = (Array.isArray(graveData.names) ? graveData.names : [])
          .filter(n => n && !LIVING_ROLE.test(n))
          .map(cleanResearchName)
          .filter(Boolean);
        // If filtering left nothing (every name was a living relative, or names was
        // malformed), fall back to the deceased's own name so the real subject is still
        // researched — never research zero people on an isMulti stone. [search-audit #3]
        const namesForResearch = _cleanedMultiNames.length > 0 ? _cleanedMultiNames : [primaryOcrName];
        const researchTargets = deceasedSubjects.length > 1
          ? deceasedSubjects.slice(0, 3).map(s => ({ name: s.name, dates: [s.birth_date, s.death_date].filter(Boolean).join(' ') }))
          : (isMulti ? namesForResearch.slice(0, 3) : [primaryOcrName]).map(n => ({ name: n, dates: datesStr }));
        const wikiNames = researchTargets.map(t => t.name);

        // For multi-person stones, search WikiTree for each of the first 2 deceased people.
        // Each target carries its OWN dates: top-level graveData.birth_date/death_date
        // reflect only the PRIMARY person, so spreading them onto every WikiTree search
        // (below) would filter+score+floor-check a secondary subject against the wrong
        // years — a namesake with the primary's years would beat the real person and
        // pass the credibility floor. Thread per-subject dates the way researchTargets
        // already does for the Wikipedia path. [search-audit #1]
        const wikiTreeTargets = deceasedSubjects.length > 1
          ? deceasedSubjects.slice(0, 2).map(s => ({ name: s.name, birth_date: s.birth_date, death_date: s.death_date }))
          : (isMulti ? namesForResearch.slice(0, 2) : [primaryOcrName]).map(n => ({ name: n }));

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
          // Override primary_name AND (when the subject carries its own) birth/death
          // dates, so a secondary subject is searched against THEIR years, not the
          // primary's. undefined per-subject dates leave the spread graveData value
          // intact (single-subject / isMulti-via-names path is unchanged). [search-audit #1]
          ...wikiTreeTargets.map(t => searchWikiTree({
            ...graveData,
            primary_name: t.name,
            ...(t.birth_date != null ? { birth_date: t.birth_date } : {}),
            ...(t.death_date != null ? { death_date: t.death_date } : {}),
          }, locationHint)),
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

        // INCREMENT 2: surface app-ORIGINATED spouse names as a numbered, citable
        // [WikiTree] source (see web index.html for the full rationale).
        const _origRaw = (typeof ORIGINATE_RELATIVES !== 'undefined' && ORIGINATE_RELATIVES)
          ? (Array.isArray(wikiData) ? wikiData : [wikiData])
              .filter(Boolean)
              .flatMap(wd => Array.isArray(wd.originatedRelatives) ? wd.originatedRelatives : [])
          : [];
        const _seenOrig = new Set();
        _origUnique = _origRaw.filter(r => {
          const k = (r && r.name || '').toLowerCase().trim();
          if (!k || _seenOrig.has(k)) return false;
          _seenOrig.add(k); return true;
        });
        if (_origUnique.length) {
          // The citable source must NOT contain the relative's NAME: a cited [N]
          // copies its description into `sources`, which the public map renders
          // UNSTRIPPED. So the source carries only relationship(s); the actual
          // names reach the model via the originatedBlock prompt instruction
          // (context, never persisted) and are removed from the public bio by the
          // deterministic strip. (C1 fix.)
          mergedSearchResults.push({
            source_type: 'wikitree',
            title: 'WikiTree family record',
            content: 'Genealogical family record naming the deceased’s ' +
              [...new Set(_origUnique.map(r => r.relation))].join(' and ') +
              ' (from genealogical records, not the gravestone).',
            url: 'https://www.wikitree.com/',
          });
        }

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

        // ── Famous-interment recovery (gate A) ──────────────────────────────
        // A bare surname banner (e.g. "BOOTH") with no first name and no dates is
        // unresolvable by the name-first paths: WikiTree needs two tokens, and
        // Wikidata-by-name has no death year to pick the right namesake. When we
        // have a resolved cemetery name AND the whole name-first fan-out came back
        // empty, ask Wikidata the reverse question — "who notable of this surname
        // is buried at this cemetery?" — which recovers Booth at Green Mount.
        // Strictly a rescue: only fires when nothing else found the person, so it
        // can never override a confident identification. The query itself aborts
        // on >1 same-surname interment (no guessing between family-plot Booths).
        let burialCandidate = null;
        // Gate against the MERGED set the bio actually sees (Tavily + FindAGrave
        // extract + Chronicling America + Internet Archive) — chron/archive are
        // part of the name-first fan-out, so a pre-1928 ordinary person CA already
        // documented must NOT trigger the famous-grave rescue. [review M2]
        const _nameFirstEmpty =
          mergedSearchResults.length === 0 &&
          (Array.isArray(wikiData) ? wikiData.length === 0 : !wikiData) &&
          !wikidataResult &&
          (Array.isArray(wikipediaSummary) ? !wikipediaSummary.some(Boolean) : !wikipediaSummary);
        // ONLY a real surname keys the lookup. graveData.family_name is left empty
        // by OCR for a first-name-only stone ("GEORGE") — falling back to
        // primary_name there would pass a GIVEN name as the surname and match any
        // notable whose first name collides. No surname → no rescue. [review H2]
        const _surnameForLookup = graveData.family_name || '';
        if (_nameFirstEmpty && cemeteryName && _surnameForLookup) {
          try {
            burialCandidate = await queryWikidataByBurialPlace(cemeteryName, _surnameForLookup, {
              deathYear: effectiveDeath || null,
              userGps: gps || null,   // rejects a same-named distant cemetery [review M6]
            });
            // Corroborate against an INDEPENDENT source (Wikipedia) before the
            // candidate may be named. Confirmation must be a real identity check,
            // not just "a sitelink exists" — the returned article must actually
            // mention the surname (knownTitle bypasses the title-match guard, so
            // without this _wikiConfirmed would be near-vacuous). [review M4]
            // Only AFTER confirmation do we let the candidate flow into the main
            // prompt / portrait / map-pin path via wikidataResult. [review H1]
            if (burialCandidate) {
              const confirm = await fetchWikipediaArticleSummary(
                burialCandidate.name, '', burialCandidate.wikipediaTitle);
              const _lcSurname = _surnameForLookup.toLowerCase();
              const _confirmsIdentity = confirm &&
                (((confirm.title || '') + ' ' + (confirm.extract || '')).toLowerCase().includes(_lcSurname));
              if (_confirmsIdentity) {
                if (Array.isArray(wikipediaSummary)) wikipediaSummary[0] = confirm;
                else wikipediaSummary = confirm;
                burialCandidate._wikiConfirmed = true;
                wikidataResult = wikidataResult || burialCandidate;
              }
            }
          } catch (e) {
            console.warn('Burial-place recovery failed (non-fatal):', e?.message || e);
          }
        }

        setStepIndex(3);
        bioResult = await generateBiography(graveData, mergedSearchResults, wikiData, locationHint, wikipediaSummary, wikidataResult, burialCandidate);

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

        // Mentions: turn the raw research hits (otherwise discarded after the bio)
        // into name-safe one-line source pointers. Built HERE while the per-source
        // arrays + the bridged wikipediaSummary are in scope. Non-fatal ([] on fail).
        const mentionHits = buildMentionHits({
          searchResults: [...(searchResults || []), ...(fgDetail ? [fgDetail] : [])],
          chronResults,
          archiveResults,
          wikiSummary: wikipediaSummary,
        });
        mentionsPromise = resolveMentions(mentionHits, graveData.subjects)
          .catch(e => { console.warn('resolveMentions failed (non-fatal):', e?.message || e); return []; });

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
          const nameParts = bioResult.name.split(/\s+(?:and|&)\s+/i).map(n => n.trim()).filter(Boolean)
            .filter(namePart => {
              const tokens = namePart.toLowerCase().replace(/[.,'"()]/g, '').split(/\s+/).filter(w => w.length > 1 && !SKIP.has(w));
              return tokens.length >= 2;
            });
          // [latency #4] Fetch every name part's portraits CONCURRENTLY instead of a
          // sequential await-per-part loop (each part does a Wikipedia search +
          // image download + resize + persist — serial was up to N× that). Still
          // pick the FIRST name part (in order) that returned portraits, so the
          // selection is identical to the old loop — only the wall-clock changes.
          if (nameParts.length > 0) {
            const fetchedPerPart = await Promise.all(
              nameParts.map(namePart => fetchWikipediaPortraits(namePart, bioResult.dates))
            );
            const firstHit = fetchedPerPart.find(f => f.length > 0);
            if (firstHit) resolvedPortraits = firstHit;
          }
        }
      }

      // Merge in the symbol meanings resolved concurrently (started right after OCR,
      // [latency #3]) so every recognised symbol on the Result screen is a tappable
      // chip. The Gemini call already ran in parallel with research + bio, so this
      // await is usually instant here. Merged onto any meanings a cached story
      // carried. Non-fatal — the promise already swallowed its own errors to null.
      const aiMeanings = await symbolMeaningsPromise;
      if (aiMeanings && Object.keys(aiMeanings).length > 0) {
        symbolMeanings = { ...(symbolMeanings || {}), ...aiMeanings };
      }

      // Await the mentions resolved concurrently (started in the research branch).
      // [] on a cache hit or any failure — the Result-screen sheet is simply omitted.
      const mentions = await mentionsPromise;

      setStepIndex(4);

      // forwardGeocode resolves the cemetery and, if the grave is tagged in OSM,
      // the precise node. But camera EXIF / device GPS is always more accurate for
      // pin placement — the user was physically standing at the grave. Prefer real
      // GPS over Nominatim coords; only fall back to Nominatim when GPS is absent.
      // NOTE: even when on-site GPS exists, this geocode is kept — its lowConfidence
      // signal (a US-state mismatch between the AI bio-location and its named state)
      // still flags the pin. Skipping it on GPS scans would be a ~1–4 s win but would
      // drop that flag for a class of scans (state-mismatch GPS pins), a behavior
      // change; an adversarial review flagged it, so we keep the call. [latency #2 reverted]
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
      // Both low-confidence sources require the ABSENCE of real GPS. A real EXIF/device
      // fix places the pin at the user's actual position (refinedGps = gps wins above),
      // so the AI bio-location's state guess can't make that pin "approximate" — gating
      // the state-mismatch flag on !gps stops an accurate on-site pin being mislabelled.
      const lowConfidence = (!gps && (geoResult?.lowConfidence || (geoIsApproximate && !usedWikidataCoords))) || undefined;

      // Read default visibility from user metadata
      const { data: { session } } = await supabase.auth.getSession();
      const defaultPublic = session?.user?.user_metadata?.default_public ?? false;

      // RECORD THE SCAN (S78 / re-review 2026-06-26). The biography is now produced
      // (full pipeline OR cache hit — both paths converge here), so commit the scan
      // server-side: commitScan() → /commit-scan → commit_reservation() flips the
      // pending reservation to a permanent scan_event. /begin-scan only RESERVED an
      // allowance slot + armed the token earlier, so a mid-pipeline failure before this
      // point never recorded anything — the pending hold ages out via its TTL (failure
      // costs nothing, with no client-triggerable delete). Awaited but non-fatal: a
      // failed commit (offline / already-expired) leaves the scan uncounted — the safe
      // direction — and we still show the bio the user already paid compute for.
      // This is the SOLE client scan recorder (old incrementScanCount removed in S78).
      try {
        const c = await commitScan();
        if (!c.committed) console.warn('commitScan: scan not recorded (offline or raced past limit)');
      } catch (e) {
        console.warn('commitScan failed (non-fatal):', e?.message || e);
      }

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
        // KINSHIP KERNEL (migration 021) — structured family data lifted out of
        // graveData (which is NOT persisted) so it survives save + cloud sync and
        // can drive GEDCOM export from a story reloaded in a later session. Also
        // feeds the public-share living-name redactor. `...bioResult` is spread
        // first and never carries these, so the literals win (cf. originatedRelatives).
        // Deceased subjects: name + own birth/death dates, one per person on the stone.
        subjects: Array.isArray(graveData.subjects)
          ? graveData.subjects.filter(s => s && s.name)
          : undefined,
        // Relationship links (spouse/parent/child/sibling → GEDCOM FAM records).
        relationships: Array.isArray(graveData.relationships) && graveData.relationships.length
          ? graveData.relationships : undefined,
        // Née/birth surname.
        maiden_name: graveData.maiden_name || undefined,
        // family_name HAS a column but was never populated (the build step never
        // lifted it out of graveData) — fix it here so it round-trips.
        family_name: bioResult.family_name || graveData.family_name || undefined,
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
        // INCREMENT 2: attach originated names + serve-side flag at BUILD time
        // (see web). On a cache hit _origUnique is [] — correct. Mobile spreads
        // ...bioResult first, which never carries these fields, so the literal wins.
        originatedRelatives: _origUnique,
        has_originated_relatives: _origUnique.length > 0,
        // Mentions (migration 022) — name-safe one-line source pointers; undefined
        // when empty so the spread `...bioResult` leaves it out. Survives handleSave
        // (plain key, not `_`-prefixed) and round-trips via storyToRow/rowToStory.
        mentions: Array.isArray(mentions) && mentions.length ? mentions : undefined,
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
        dur_ms: Date.now() - pipelineStartRef.current,
      });

      // Pipeline reached the bio — NOT abandoned. Must clear BEFORE navigating:
      // navigation.navigate fires CameraScreen's 'blur' listener, so leaving the
      // flag set would mislabel every successful scan as abandonment.
      pipelineActiveRef.current = false;

      // The scan finished. If the user stepped away while it ran, fire a local
      // "story ready" notification so they can tap back in — otherwise they'd have
      // to remember to reopen. Gate on `=== 'background'` specifically, NOT
      // `!== 'active'`: on iOS the transient 'inactive' state (Control Center,
      // notification shade, incoming call) means the user is effectively still in
      // the app, and we don't want to pop a banner over it. Stash the finished
      // story first (keyed by timestamp) so a matching tap can route to its Result
      // (it's in-memory only; unsaved scans have no DB row yet). We still navigate
      // to Result below regardless, so the screen is already mounted underneath
      // when they return. notifyStoryReady is fail-soft and only fires if
      // permission was already granted (it never prompts from the background).
      setLastReadyStory(story);
      if (AppState.currentState === 'background') {
        notifyStoryReady({ name: primaryName || story.name, storyTimestamp: story.timestamp });
      }

      // Navigate and DELIBERATELY leave `loading` true. With the native-stack push
      // animation, Result slides in over ~300ms while CameraScreen stays mounted
      // underneath. If we cleared loading here, CameraScreen would re-render as the
      // "Photograph the Stone" viewfinder for that whole slide — visible beside the
      // incoming Result screen — which is the flash. Keeping the loader up means the
      // thing showing underneath stays the loading screen until Result fully covers
      // it. Loading is reset to false on the next focus (back-navigation) via the
      // useFocusEffect below, so the viewfinder is ready when the user returns.
      navigation.navigate('Result', { story });
    } catch (err) {
      setLoading(false);
      pipelineActiveRef.current = false; // resolved into the error screen, not abandoned
      logEvent(EVENTS.PIPELINE_ERROR, { stage: 'pipeline', message: err?.message, dur_ms: Date.now() - pipelineStartRef.current });
      console.warn('Pipeline error:', String(err), 'message:', err?.message, 'stack:', err?.stack);
      // No scan refund needed: the scan is only RECORDED by commitScan() AFTER the bio
      // succeeds, so a failure here (before commit) never recorded one — it already
      // costs nothing. [re-review 2026-06-26: replaced the refund mechanism]
      // For fresh scans, offer to queue the photo for later — the common cause
      // here is the signal dropping mid-pipeline. Resumed pending scans are
      // already queued, so they just get the error.
      setPipelineError({
        message: err.message || 'Something went wrong. Please try again.',
        base64: pending ? null : base64,
        fromCamera,
        gps,
      });
    } finally {
      // Clear the per-scan token at the end of EVERY scan (success, error, or the
      // gate's early return above) so a stale token is never reused across scans.
      // Non-essential (tokens expire in minutes) but tidy + defensive. [S78]
      endScan();
    }
  }

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingBox}>
          <IlluminatedLedger stepIndex={stepIndex} />
        </View>
      </SafeAreaView>
    );
  }

  if (pipelineError) {
    return (
      <SafeAreaView style={styles.container}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.back}
          activeOpacity={0.7}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <View style={styles.rejectedBox}>
          <Text style={styles.rejectedTitle}>Analysis Failed</Text>
          <Text style={styles.rejectedReason}>{pipelineError.message}</Text>
          {!!pipelineError.base64 && (
            <TouchableOpacity
              style={styles.tryAnyway}
              activeOpacity={0.85}
              onPress={() => {
                const { base64, gps, fromCamera } = pipelineError;
                setPipelineError(null);
                createPendingStory(base64, gps, fromCamera);
              }}
            >
              <Text style={styles.tryAnywayText}>Save & Research Later</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={styles.retryBtn} onPress={() => setPipelineError(null)} activeOpacity={0.85}>
            <Text style={styles.retryText}>Try Again</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  if (rejected) {
    return (
      <SafeAreaView style={styles.container}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.back}
          activeOpacity={0.7}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <View style={styles.rejectedBox}>
          <Text style={styles.rejectedTitle}>Not a Gravestone</Text>
          <Text style={styles.rejectedReason}>{rejected.reason}</Text>
          <TouchableOpacity style={styles.tryAnyway} activeOpacity={0.85} onPress={() => runPipeline(rejected.base64, true, rejected.gps, rejected.fromCamera, rejected.pending)}>
            <Text style={styles.tryAnywayText}>Use it anyway</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.retryBtn} onPress={() => setRejected(null)} activeOpacity={0.85}>
            <Text style={styles.retryText}>Try a different photo</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <TouchableOpacity
        onPress={() => navigation.goBack()}
        style={styles.back}
        activeOpacity={0.7}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        accessibilityRole="button"
        accessibilityLabel="Go back"
      >
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
            <Rect x={0}     y={0}     width={30}  height={2.2} fill={colors.flame} opacity={0.9} />
            <Rect x={0}     y={0}     width={2.2} height={30}  fill={colors.flame} opacity={0.9} />
            {/* top-right */}
            <Rect x={290}   y={0}     width={30}  height={2.2} fill={colors.flame} opacity={0.9} />
            <Rect x={317.8} y={0}     width={2.2} height={30}  fill={colors.flame} opacity={0.9} />
            {/* bottom-left */}
            <Rect x={0}     y={337.8} width={30}  height={2.2} fill={colors.flame} opacity={0.9} />
            <Rect x={0}     y={310}   width={2.2} height={30}  fill={colors.flame} opacity={0.9} />
            {/* bottom-right */}
            <Rect x={290}   y={337.8} width={30}  height={2.2} fill={colors.flame} opacity={0.9} />
            <Rect x={317.8} y={310}   width={2.2} height={30}  fill={colors.flame} opacity={0.9} />
            {/* edge ticks (HUD detail) */}
            <Rect x={155}   y={0}     width={10}  height={1.4} fill={colors.flame} opacity={0.3} />
            <Rect x={155}   y={338.6} width={10}  height={1.4} fill={colors.flame} opacity={0.3} />
            <Rect x={0}     y={165}   width={1.4} height={10}  fill={colors.flame} opacity={0.3} />
            <Rect x={318.6} y={165}   width={1.4} height={10}  fill={colors.flame} opacity={0.3} />
          </Svg>

          {/* Aura — a soft haunting halo BEHIND the stone, pulsing on its own
              slow cycle (the home page's catch-light, reinterpreted as a glow).
              Sits under the headstone layer so the light reads as coming from
              the stone, not painted on top of it. */}
          <Animated.View style={[StyleSheet.absoluteFill, { opacity: glow }]}>
            <Svg width={320} height={340} viewBox="0 0 320 340">
              <Defs>
                <RadialGradient id="vfAura" cx="0.5" cy="0.5" r="0.5">
                  <Stop offset="0"    stopColor="#f2d79a" stopOpacity="0.34" />
                  <Stop offset="0.45" stopColor="#f2b65c" stopOpacity="0.16" />
                  <Stop offset="1"    stopColor="#f2b65c" stopOpacity="0" />
                </RadialGradient>
              </Defs>
              {/* tall halo hugging the stone silhouette */}
              <Ellipse cx={160} cy={172} rx={118} ry={140} fill="url(#vfAura)" />
            </Svg>
          </Animated.View>

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
                {/* The flashlight pool — a warm, soft-edged torch beam. Bright
                    core, gentle falloff (the "blur" is the gradient, since
                    RN-SVG can't render a real blur filter). */}
                <RadialGradient id="vfBeam" cx="0.5" cy="0.5" r="0.5">
                  <Stop offset="0"    stopColor="#fff4d2" stopOpacity="0.9" />
                  <Stop offset="0.35" stopColor="#ffe7ad" stopOpacity="0.55" />
                  <Stop offset="0.7"  stopColor="#f2b65c" stopOpacity="0.18" />
                  <Stop offset="1"    stopColor="#f2b65c" stopOpacity="0" />
                </RadialGradient>
                {/* Clip every light to the stone face so the beam never bleeds out */}
                <ClipPath id="vfStoneClip">
                  <Path d="M92 272 L92 150 Q92 78 160 78 Q228 78 228 150 L228 272 Z" />
                </ClipPath>
              </Defs>

              {/* ambient ground glow */}
              <Ellipse cx={160} cy={278} rx={112} ry={10} fill="url(#vfGlow)" />

              {/* inner face panel — stone reads as solid, not hollow */}
              <Path d="M100 270 L100 150 Q100 86 160 86 Q220 86 220 150 L220 270 Z"
                    fill="rgba(42,32,23,0.7)" />

              {/* Base carved detail — kept DIM so the stone sits in shadow; the
                  roaming torch is what brings each part to light as it passes. */}
              {/* headstone outline */}
              <Path d="M92 272 L92 150 Q92 78 160 78 Q228 78 228 150 L228 272 Z"
                    fill="none" stroke="url(#vfStone)" strokeWidth={1.9} strokeLinejoin="round" strokeOpacity={0.5} />
              {/* inner chamfer */}
              <Path d="M102 270 L102 152 Q102 88 160 88 Q218 88 218 152 L218 270"
                    fill="none" stroke="url(#vfStone)" strokeWidth={0.8} strokeOpacity={0.18} />
              {/* ornament + inscription, dim */}
              <Circle cx={160} cy={124} r={11} fill="none" stroke="#efe4d2" strokeOpacity={0.10} strokeWidth={1.0} />
              <Line x1={124} y1={166} x2={196} y2={166} stroke="#efe4d2" strokeOpacity={0.12} strokeWidth={1.0} strokeLinecap="round" />
              <Line x1={130} y1={188} x2={190} y2={188} stroke="#efe4d2" strokeOpacity={0.10} strokeWidth={0.9} strokeLinecap="round" />
              <Line x1={136} y1={210} x2={184} y2={210} stroke="#efe4d2" strokeOpacity={0.08} strokeWidth={0.8} strokeLinecap="round" />

              {/* ===== THE FLASHLIGHT ===== */}
              {/* A warm pool of torchlight that roams over the stone. Clipped to
                  the stone face so the light falls ON the carving, never in the
                  dark around it. RN-SVG has no blur filter — the soft edge IS the
                  radial gradient. The bright additive core visibly lifts whatever
                  dim carved detail it passes over, so the inscription and edges
                  "light up" under the beam and fall back to shadow behind it.
                  cx/cy are driven by the two wander loops; opacity gently pulses. */}
              <G clipPath="url(#vfStoneClip)">
                <AnimatedCircle cx={beamX} cy={beamY} r={66} fill="url(#vfBeam)" opacity={beamPulse} />
              </G>

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

// ── The Illuminated Ledger — the loading screen ──────────────────────────────
// A candlelit vellum page. Five provenance lines map 1:1 to the pipeline's
// stepIndex; each row's visual state is DERIVED (not animation-gated) from
// (rowIndex vs stepIndex): pending hollow ring → active breathing gold ring →
// struck gold wax seal. Because progress is a pure function of those two
// numbers, every awkward pipeline path renders a correct final state for free:
// the cache-hit 1→3 jump stamps two seals at once ("found in the archive"),
// verify-bypass / sub-second completion show whatever final state is rendered,
// and the 30s research dwell stays alive on four continuous, period-mismatched
// motions with NO determinate bar to freeze at a fixed %.
//
// This is a self-contained child rendered ONLY inside `if (loading)`, so its
// Animated.Values, loops, and cleanup live and die with the loading state
// (and reset per-mount on a second scan) — it deliberately does NOT share the
// parent's viewfinder effect.

// Fixed row pitch — see geometry below; the traveling-light Svg's viewBox-y
// coords are authored from this constant so they provably track the rendered
// rows (FIXED height, not minHeight, is what makes that mapping exact).
const LEDGER_ROW_H = 56;
const LEDGER_PAD_V = 8;                                    // ledgerCard paddingVertical
const CARD_H = LEDGER_PAD_V + 5 * LEDGER_ROW_H + LEDGER_PAD_V;  // 8 + 280 + 8 = 296
// Row i center in viewBox-y: padTop + i*rowH + rowH/2 = 8 + i*56 + 28 = 36 + i*56.
const TOP_Y = LEDGER_PAD_V + LEDGER_ROW_H / 2;            // 36  (row 0 center = lampY's A)
const BOTTOM_Y = LEDGER_PAD_V + 4 * LEDGER_ROW_H + LEDGER_ROW_H / 2;  // 260 (row 4 center)
// Bigger candle-pool: r=56 (was 40) so the light reads as a generous candle glow,
// not a tight spot. The pool also WANDERS horizontally (lampX) on its own period
// instead of riding the centerline — `cx` swings within ±LAMP_X_SWING of card
// center, kept inset so the larger pool's bright heart never parks hard against
// the rounded page edge. The X period (8300ms half) is deliberately non-integer-
// ratio with the Y round-trip (6000ms half) so the combined cx/cy motion traces
// an ever-shifting wandering path and never relocks into a straight up/down line.
const LAMP_R = 56;
const LAMP_X_SWING_FRAC = 0.16;   // fraction of card width the pool drifts each side

// Editorial rewrites of STEPS (index-aligned 0–4). These are display-only; the
// module-level STEPS array and the setStepIndex(0..4) call sites are untouched.
const LEDGER_STAGES = [
  'Verifying the stone',
  'Reading the inscription',
  'Searching the records',
  'Composing the life',
  'Sealing the page',
];
const LEDGER_REASSURE = [
  'Confirming this is a memorial stone…',
  'Transcribing the engraved names and dates…',
  'Searching archives, newspapers and genealogies…',
  'Drawing the threads into one account…',
  'Setting the final details in place…',
];

// A single seal glyph (22×22). Pure function of `state` — no animation here; the
// active variant is wrapped by its row in an Animated.View (opacity=sealBreathe).
function Seal({ state }) {
  if (state === 'done') {
    // Struck gold wax seal with a stamped check. Steady — a sealed line is done.
    return (
      <Svg width={22} height={22} viewBox="0 0 22 22">
        <Circle cx={11} cy={11} r={8} fill={colors.flame} />
        <Path
          d="M7 11 L10 14 L15 8"
          fill="none"
          stroke={colors.onFlame}
          strokeWidth={1.7}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </Svg>
    );
  }
  if (state === 'active') {
    // The "you are here" line: a softly lit gold ring over a gold haze. The ring
    // uses a STROKE gradient — it MUST be userSpaceOnUse (objectBoundingBox
    // stroke gradients silently paint nothing on Android RN-SVG), authored to
    // span the 22×22 box vertically.
    return (
      <Svg width={22} height={22} viewBox="0 0 22 22">
        <Defs>
          <LinearGradient id="ldgStone" x1={11} y1={4} x2={11} y2={18} gradientUnits="userSpaceOnUse">
            <Stop offset="0" stopColor="#e8d4a0" stopOpacity={0.95} />
            <Stop offset="0.55" stopColor="#c9a84c" stopOpacity={0.9} />
            <Stop offset="1" stopColor="#6b4f1e" stopOpacity={0.7} />
          </LinearGradient>
        </Defs>
        <Circle cx={11} cy={11} r={4} fill={colors.glow} />
        <Circle cx={11} cy={11} r={7} fill="none" stroke="url(#ldgStone)" strokeWidth={1.6} />
      </Svg>
    );
  }
  // pending — a faint hollow ring, the line not yet reached.
  return (
    <Svg width={22} height={22} viewBox="0 0 22 22">
      <Circle cx={11} cy={11} r={7} fill="none" stroke={colors.line} strokeWidth={1.4} />
    </Svg>
  );
}

function IlluminatedLedger({ stepIndex }) {
  // SIX Animated.Values. Each looped value's INITIAL EQUALS its cycle's first
  // toValue, and every loop is a CLOSED A→B→A cycle — so the Animated.loop
  // restart is seamless (the project's documented snap-back gotcha).
  const headerGlow  = useRef(new Animated.Value(0.45)).current; // header aura View opacity (native)
  const sealBreathe = useRef(new Animated.Value(1)).current;    // active seal + label View opacity (native)
  const flameFlick  = useRef(new Animated.Value(0.86)).current; // header flame body opacity (JS — SVG opacity)
  const lampPulse   = useRef(new Animated.Value(0.7)).current;  // traveling pool SVG opacity (JS)
  const lampX       = useRef(new Animated.Value(0)).current;    // traveling pool SVG cx offset, -1..1 (JS)
  const lampY       = useRef(new Animated.Value(TOP_Y)).current; // traveling pool SVG cy (JS)

  // The card width must be measured so the absolute-fill light Svg's viewBox
  // maps 1:1 to pixels (cy in viewBox units → row centers). Card height is
  // deterministic (CARD_H) because rows are FIXED height; only width is unknown.
  const [cardW, setCardW] = useState(0);

  // Background-resume reassurance: a calm note that fades in only AFTER a few
  // seconds, so fast scans never show it. It reframes the freeze-on-background
  // behaviour as expected — "stay on this page; if you switch away the scan
  // resumes when you return" — killing the "frozen = broken" read on long scans.
  // (Honest framing: a backgrounded scan really does pause + resume; it does not
  // run server-side. See the shelved Option B brief for the full server fix.)
  const resumeFade = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const t = setTimeout(() => {
      Animated.timing(resumeFade, {
        toValue: 1, duration: 600, easing: Easing.inOut(Easing.ease), useNativeDriver: true,
      }).start();
    }, 5000);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    // headerGlow: 0.45 → 0.72 → 0.45 (init == A). View opacity → native driver.
    const headerGlowLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(headerGlow, { toValue: 0.72, duration: 2300, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(headerGlow, { toValue: 0.45, duration: 3100, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    );
    // sealBreathe: 1 → 0.78 → 1 (init == A). Trough is 0.78 (NOT 0.55) so the
    // 22px active glyph reads as steady-alive, never a rendering glitch. Native.
    const sealBreatheLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(sealBreathe, { toValue: 0.78, duration: 1500, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(sealBreathe, { toValue: 1,    duration: 1500, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ])
    );
    // flameFlick: 0.86 → 1 → 0.86 (init == A). A live candle flame never holds a
    // fixed brightness; this is a gentle, fast-ish luminance flicker on the header
    // flame body (SVG opacity → JS driver). Short 620/780ms legs read as a living
    // flame without strobing. Period is small & non-integer-ratio to everything
    // else so it never locks to the pool or aura.
    const flameFlickLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(flameFlick, { toValue: 1,    duration: 620, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
        Animated.timing(flameFlick, { toValue: 0.86, duration: 780, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
      ])
    );
    // lampPulse: 0.7 → 1 → 0.7 (init == A). Drives an SVG opacity prop → JS driver.
    const lampPulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(lampPulse, { toValue: 1,   duration: 1500, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
        Animated.timing(lampPulse, { toValue: 0.7, duration: 1500, easing: Easing.inOut(Easing.ease), useNativeDriver: false }),
      ])
    );
    // lampX: 0 → 1 → -1 → 0 (init == A). A normalized -1..1 horizontal offset the
    // render maps to ±LAMP_X_SWING px. A FULL closed cycle (centre → right → left
    // → centre) keeps the loop seamless. 8300ms legs give a ~33s full sweep that
    // is non-integer-ratio with lampY's 12s round-trip, so the pool's (cx,cy) path
    // wanders — diagonals, gentle arcs — instead of tracking one vertical line.
    const lampXLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(lampX, { toValue: 1,  duration: 4200, easing: Easing.inOut(Easing.sin), useNativeDriver: false }),
        Animated.timing(lampX, { toValue: -1, duration: 8300, easing: Easing.inOut(Easing.sin), useNativeDriver: false }),
        Animated.timing(lampX, { toValue: 0,  duration: 4200, easing: Easing.inOut(Easing.sin), useNativeDriver: false }),
      ])
    );
    // lampY: 36 → 260 → 36 (init == A). 12s round-trip — slow, contemplative;
    // the pool drifts down the column like a reading finger. Drives an SVG cy
    // prop → JS driver. Easing.sin gives the eased dwell at top/bottom. Its 12s
    // period is non-integer-ratio with the 3s/~5.4s loops so nothing locks into
    // a visible synchronized throb (same anti-sync rationale as the viewfinder).
    const lampYLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(lampY, { toValue: BOTTOM_Y, duration: 6000, easing: Easing.inOut(Easing.sin), useNativeDriver: false }),
        Animated.timing(lampY, { toValue: TOP_Y,    duration: 6000, easing: Easing.inOut(Easing.sin), useNativeDriver: false }),
      ])
    );
    headerGlowLoop.start();
    sealBreatheLoop.start();
    flameFlickLoop.start();
    lampPulseLoop.start();
    lampXLoop.start();
    lampYLoop.start();
    return () => {
      headerGlowLoop.stop(); sealBreatheLoop.stop(); flameFlickLoop.stop();
      lampPulseLoop.stop(); lampXLoop.stop(); lampYLoop.stop();
    };
  }, []);

  const CARD_CX = cardW / 2;
  // Map the normalized -1..1 lampX onto a horizontal pixel offset around centre.
  // Computed from measured cardW (so it's 0 until layout, matching the pool's own
  // cardW>0 gate). The pool's bright heart stays well inside the rounded edge.
  const lampSwing = cardW * LAMP_X_SWING_FRAC;
  const lampCx = lampX.interpolate({
    inputRange: [-1, 1],
    outputRange: [CARD_CX - lampSwing, CARD_CX + lampSwing],
  });
  // Rounded-rect clip authored in the same `0 0 cardW 296` viewBox (Q corners
  // radius 18 = radius.lg) so the traveling pool never bleeds past the page edge.
  const clipPath =
    `M18 0 H${cardW - 18} Q${cardW} 0 ${cardW} 18 V${CARD_H - 18} ` +
    `Q${cardW} ${CARD_H} ${cardW - 18} ${CARD_H} H18 Q0 ${CARD_H} 0 ${CARD_H - 18} V18 Q0 0 18 0 Z`;

  // Inscription-reveal opacity for engraved line `k` on the hero stone, derived
  // PURELY from stepIndex (no animation) — same philosophy as the seals, so the
  // cache-hit 1→3 jump and verify-bypass render a correct partial/full reveal for
  // free: a line is invisible until the scan reaches it, faint while that stage is
  // active ("being read"), and fully carved once the stage has passed.
  const lineOp = (k) => (stepIndex > k ? 0.9 : stepIndex === k ? 0.32 : 0);

  return (
    <>
      {/* (A) PAGE HEADER — the scan, told as an image: a single HERO gravestone
          (the stone being scanned) stands centre, brightly lit; a candle in the
          FOREGROUND examines it, casting a soft shadow up its face and onto the
          ground, while the rest of the graveyard fans out faintly in the spill and
          recedes into haze. The hero's inscription CARVES ITSELF IN line-by-line as
          the scan progresses (lineOp = pure fn of stepIndex). Breathing aura on its
          own native layer below; both Svgs are 280×320 and aligned. */}
      <View style={styles.ledgerHeader}>
        {/* Header aura: a View-opacity breath (native driver), low/centred on the
            foreground flame so the breath reads as the candle's glow. */}
        <Animated.View style={[StyleSheet.absoluteFill, { opacity: headerGlow }]}>
          <Svg width={280} height={320} viewBox="0 0 280 320">
            <Defs>
              <RadialGradient id="ldgAura" cx="0.5" cy="0.5" r="0.5">
                <Stop offset="0" stopColor="#f2d79a" stopOpacity={0.40} />
                <Stop offset="0.45" stopColor="#f2b65c" stopOpacity={0.18} />
                <Stop offset="1" stopColor="#f2b65c" stopOpacity={0} />
              </RadialGradient>
            </Defs>
            {/* rx kept ≤138 so the round glow fades to nothing INSIDE the 280-wide
                viewBox — at rx=160 it was clipped flat at x=0/280 and read as a
                square edge. ry bumped to keep the vertical spread generous. */}
            <Ellipse cx={140} cy={210} rx={138} ry={108} fill="url(#ldgAura)" />
          </Svg>
        </Animated.View>
        {/* The hero-stone scene + foreground candle. Flame body/tip flicker on
            `flameFlick`; the aura breathes underneath. */}
        <Svg width={280} height={320} viewBox="0 0 280 320">
          <Defs>
            {/* Warm halo bloom around the foreground flame. */}
            <RadialGradient id="ldgFlameHalo" cx="0.5" cy="0.5" r="0.5">
              <Stop offset="0" stopColor="#fff1c8" stopOpacity={0.72} />
              <Stop offset="0.5" stopColor="#f2b65c" stopOpacity={0.27} />
              <Stop offset="1" stopColor="#f2b65c" stopOpacity={0} />
            </RadialGradient>
            {/* Flame body — bright, hot ramp. */}
            <RadialGradient id="ldgFlame" cx="0.5" cy="0.5" r="0.5">
              <Stop offset="0" stopColor="#fffaf0" stopOpacity={1} />
              <Stop offset="0.4" stopColor="#ffe39a" stopOpacity={0.95} />
              <Stop offset="0.72" stopColor="#f2b65c" stopOpacity={0.55} />
              <Stop offset="1" stopColor="#cf7a3a" stopOpacity={0} />
            </RadialGradient>
            {/* Incandescent white-hot heart. */}
            <RadialGradient id="ldgCore" cx="0.5" cy="0.5" r="0.5">
              <Stop offset="0" stopColor="#ffffff" stopOpacity={1} />
              <Stop offset="0.55" stopColor="#fff4d2" stopOpacity={0.85} />
              <Stop offset="1" stopColor="#ffe7ad" stopOpacity={0} />
            </RadialGradient>
            {/* Tight bright cone focused on the hero stone's face. */}
            <RadialGradient id="ldgSpot" cx="0.5" cy="0.46" r="0.5">
              <Stop offset="0" stopColor="#fff3d0" stopOpacity={0.82} />
              <Stop offset="0.45" stopColor="#f6c873" stopOpacity={0.36} />
              <Stop offset="1" stopColor="#f2b65c" stopOpacity={0} />
            </RadialGradient>
            {/* Hero stone face — top-lit (candlelight from above/front), darker to base. */}
            <LinearGradient id="ldgHeroFace" x1={0} y1={120} x2={0} y2={250} gradientUnits="userSpaceOnUse">
              <Stop offset="0" stopColor="#4a3b27" />
              <Stop offset="0.5" stopColor="#342a1c" />
              <Stop offset="1" stopColor="#241c14" />
            </LinearGradient>
            {/* Cast shadow of the candle thrown back up the hero face — dark, fading. */}
            <RadialGradient id="ldgCast" cx="0.5" cy="0.95" r="0.7">
              <Stop offset="0" stopColor="#0a0805" stopOpacity={0.72} />
              <Stop offset="0.55" stopColor="#0a0805" stopOpacity={0.34} />
              <Stop offset="1" stopColor="#0a0805" stopOpacity={0} />
            </RadialGradient>
            {/* Vertical atmospheric haze — far graveyard dissolves into night.
                Lifted (0.9 @ top → 0 by 0.6) so the brightened background rows
                survive instead of being swallowed. */}
            <LinearGradient id="ldgFog" x1={0} y1={0} x2={0} y2={320} gradientUnits="userSpaceOnUse">
              <Stop offset="0" stopColor="#14100b" stopOpacity={0.9} />
              <Stop offset="0.20" stopColor="#14100b" stopOpacity={0.42} />
              <Stop offset="0.42" stopColor="#14100b" stopOpacity={0.06} />
              <Stop offset="0.6" stopColor="#14100b" stopOpacity={0} />
            </LinearGradient>
            {/* Broad warm spill so the candle's light reaches the background graveyard. */}
            <RadialGradient id="ldgSpill" cx="0.5" cy="0.62" r="0.5">
              <Stop offset="0" stopColor="#f6c873" stopOpacity={0.30} />
              <Stop offset="0.6" stopColor="#f2b65c" stopOpacity={0.10} />
              <Stop offset="1" stopColor="#f2b65c" stopOpacity={0} />
            </RadialGradient>
            {/* Per-row top-lit stone gradients (lighter warm top → darker base);
                cooler/dimmer the farther back the row is. Authored in userSpaceOnUse
                across each row's y-band so every stone in the row is lit identically. */}
            <LinearGradient id="ldgRowB" x1={0} y1={142} x2={0} y2={174} gradientUnits="userSpaceOnUse">
              <Stop offset="0" stopColor="#5a4628" /><Stop offset="0.55" stopColor="#3c2e1b" /><Stop offset="1" stopColor="#2a2015" />
            </LinearGradient>
            <LinearGradient id="ldgRowC" x1={0} y1={122} x2={0} y2={146} gradientUnits="userSpaceOnUse">
              <Stop offset="0" stopColor="#4a3a22" /><Stop offset="0.55" stopColor="#332817" /><Stop offset="1" stopColor="#241b12" />
            </LinearGradient>
            <LinearGradient id="ldgRowD" x1={0} y1={106} x2={0} y2={124} gradientUnits="userSpaceOnUse">
              <Stop offset="0" stopColor="#3c301d" /><Stop offset="0.6" stopColor="#2a2114" /><Stop offset="1" stopColor="#1f1810" />
            </LinearGradient>
            <LinearGradient id="ldgRowE" x1={0} y1={90} x2={0} y2={104} gradientUnits="userSpaceOnUse">
              <Stop offset="0" stopColor="#322817" /><Stop offset="0.6" stopColor="#241c12" /><Stop offset="1" stopColor="#1b150e" />
            </LinearGradient>
          </Defs>

          {/* Broad warm spill so the candlelight reaches the background graveyard.
              rx kept ≤138 so its round falloff completes inside the 280 viewBox
              (no clipped square edge); ry generous since the box is 320 tall. */}
          <Ellipse cx={140} cy={170} rx={134} ry={135} fill="url(#ldgSpill)" />

          {/* ===== BACKGROUND GRAVEYARD — uniform rounded headstones in receding
              rows. ONE consistent silhouette (same arch as the hero), each row
              aligned to a shared baseline, shorter + dimmer + higher the farther
              back it sits. Per-row top-lit gradient (ldgRow*) makes them read as
              lit stone, not flat cutouts. Centre band (x≈96–184) left clear for the
              hero + candle column. Coords baked from the marker-preview generator. */}
          {/* ROW E — farthest: tiny, highest, dimmest */}
          <G fill="url(#ldgRowE)" opacity={0.50}>
            <Path d="M16.5 104 L16.5 95.5 Q16.5 90 22 90 Q27.5 90 27.5 95.5 L27.5 104 Z" />
            <Path d="M46.5 104 L46.5 95.5 Q46.5 90 52 90 Q57.5 90 57.5 95.5 L57.5 104 Z" />
            <Path d="M76.5 104 L76.5 95.5 Q76.5 90 82 90 Q87.5 90 87.5 95.5 L87.5 104 Z" />
            <Path d="M196.5 104 L196.5 95.5 Q196.5 90 202 90 Q207.5 90 207.5 95.5 L207.5 104 Z" />
            <Path d="M226.5 104 L226.5 95.5 Q226.5 90 232 90 Q237.5 90 237.5 95.5 L237.5 104 Z" />
          </G>
          {/* ROW D */}
          <G fill="url(#ldgRowD)" opacity={0.62}>
            <Path d="M21.5 124 L21.5 112.5 Q21.5 106 28 106 Q34.5 106 34.5 112.5 L34.5 124 Z" />
            <Path d="M54.5 124 L54.5 112.5 Q54.5 106 61 106 Q67.5 106 67.5 112.5 L67.5 124 Z" />
            <Path d="M87.5 124 L87.5 112.5 Q87.5 106 94 106 Q100.5 106 100.5 112.5 L100.5 124 Z" />
            <Path d="M186.5 124 L186.5 112.5 Q186.5 106 193 106 Q199.5 106 199.5 112.5 L199.5 124 Z" />
            <Path d="M219.5 124 L219.5 112.5 Q219.5 106 226 106 Q232.5 106 232.5 112.5 L232.5 124 Z" />
          </G>
          {/* ROW C */}
          <G fill="url(#ldgRowC)" opacity={0.74}>
            <Path d="M17 146 L17 130 Q17 122 25 122 Q33 122 33 130 L33 146 Z" />
            <Path d="M55 146 L55 130 Q55 122 63 122 Q71 122 71 130 L71 146 Z" />
            <Path d="M207 146 L207 130 Q207 122 215 122 Q223 122 223 130 L223 146 Z" />
            <Path d="M245 146 L245 130 Q245 122 253 122 Q261 122 261 130 L261 146 Z" />
          </G>
          {/* ROW B — nearest background, flanking the hero shoulders */}
          <G fill="url(#ldgRowB)" opacity={0.84}>
            <Path d="M21 174 L21 152 Q21 142 31 142 Q41 142 41 152 L41 174 Z" />
            <Path d="M67 174 L67 152 Q67 142 77 142 Q87 142 87 152 L87 174 Z" />
            <Path d="M205 174 L205 152 Q205 142 215 142 Q225 142 225 152 L225 174 Z" />
          </G>

          {/* ground */}
          <Line x1={18} y1={250} x2={262} y2={250} stroke="#c9a84c" strokeOpacity={0.22} strokeWidth={1.2} />

          {/* spotlight pooling on the hero */}
          <Ellipse cx={140} cy={205} rx={78} ry={74} fill="url(#ldgSpot)" />

          {/* ===== HERO STONE (centred, large, sharp, bright) ===== */}
          <Path d="M108 250 L108 168 Q108 150 140 150 Q172 150 172 168 L172 250 Z" fill="url(#ldgHeroFace)" stroke="#6a5636" strokeWidth={1.2} />
          {/* lit top rim catching the candlelight */}
          <Path d="M108 168 Q108 150 140 150 Q172 150 172 168" fill="none" stroke="#caa765" strokeWidth={1.4} opacity={0.85} />

          {/* ENGRAVED inscription — carves in line-by-line (lineOp of stepIndex). */}
          {/* carved cross flourish (always faintly present, brightens with line 0) */}
          <G opacity={0.55 + lineOp(0) * 0.4}>
            <Path d="M138.5 162 H141.5 V174 H138.5 Z" fill="#0f0c08" />
            <Path d="M134 166 H146 V168.6 H134 Z" fill="#0f0c08" />
          </G>
          {/* name line */}
          <Path d="M120 184 H160 V187.4 H120 Z" fill="#0f0c08" opacity={lineOp(0)} />
          {/* date line 1 */}
          <Path d="M124 198 H156 V200.6 H124 Z" fill="#0f0c08" opacity={lineOp(1)} />
          {/* date line 2 */}
          <Path d="M126 208 H154 V210.6 H126 Z" fill="#0f0c08" opacity={lineOp(2)} />
          {/* epitaph line */}
          <Path d="M122 222 H158 V224.2 H122 Z" fill="#0f0c08" opacity={lineOp(3)} />

          {/* ===== CAST SHADOW of the candle, up the hero face + on the ground.
               Drawn AFTER the stone/engraving (so it darkens them), BEFORE candle. */}
          <Ellipse cx={140} cy={250} rx={30} ry={10} fill="#0a0805" opacity={0.5} />
          <Path d="M126 250 L131 165 L149 165 L154 250 Z" fill="url(#ldgCast)" />

          {/* candlelight sheen wash across the face (over the shadow, edges still glow) */}
          <Path d="M108 250 L108 168 Q108 150 140 150 Q172 150 172 168 L172 250 Z" fill="url(#ldgSpot)" opacity={0.22} />

          {/* haze — background dissolves into night */}
          <Rect x={0} y={0} width={280} height={320} fill="url(#ldgFog)" />

          {/* ===== CANDLE IN FRONT (foreground): lower, overlapping the hero base ===== */}
          <Ellipse cx={140} cy={206} rx={50} ry={50} fill="url(#ldgFlameHalo)" />
          {/* tall foreground candle body, in front of the stone */}
          <Path d="M132 240 Q132 234 138 234 L142 234 Q148 234 148 240 L148 292 L132 292 Z" fill="#2a2017" stroke="#1a140d" strokeWidth={0.8} />
          <Path d="M132 240 Q132 234 138 234 L138 292 L132 292 Z" fill="#3a2e1d" />
          <Path d="M142 234 Q148 234 148 240 L148 292 L142 292 Z" fill="#1a140d" opacity={0.6} />
          {/* melted wax lip */}
          <Ellipse cx={140} cy={234} rx={8} ry={2.4} fill="#4a3b27" />
          {/* wick + flame rising from the foreground candle (flame flickers) */}
          <Line x1={140} y1={228} x2={140} y2={234} stroke="#6b4f1e" strokeWidth={2.4} strokeLinecap="round" />
          <AnimatedEllipse cx={140} cy={210} rx={13} ry={22} fill="url(#ldgFlame)" opacity={flameFlick} />
          <AnimatedPath
            d="M140 184 Q152 208 140 232 Q128 208 140 184"
            fill="url(#ldgFlame)"
            opacity={flameFlick}
          />
          <Circle cx={140} cy={214} r={6.5} fill="url(#ldgCore)" />
        </Svg>
      </View>

      {/* (B) TITLE */}
      <Text style={styles.ledgerTitle}>Composing this life</Text>

      {/* (C) THE LEDGER CARD — a vellum page. Rows + traveling pool share a box. */}
      <View
        style={styles.ledgerCard}
        onLayout={e => {
          const w = e.nativeEvent.layout.width;
          if (w && w !== cardW) setCardW(w);
        }}
      >
        {LEDGER_STAGES.map((label, i) => {
          const state = i < stepIndex ? 'done' : i === stepIndex ? 'active' : 'pending';
          return (
            <View key={i} style={styles.ledgerRow}>
              {state === 'active' ? (
                // Active seal + label breathe together on one shared value (only
                // one row is active at a time, so no per-row Animated churn).
                <Animated.View style={[styles.sealSlot, { opacity: sealBreathe }]}>
                  <Seal state="active" />
                </Animated.View>
              ) : (
                <View style={styles.sealSlot}>
                  <Seal state={state} />
                </View>
              )}
              {state === 'active' ? (
                <Animated.Text style={[styles.labelActive, { opacity: sealBreathe }]}>{label}</Animated.Text>
              ) : (
                <Text style={state === 'done' ? styles.labelDone : styles.labelPending}>{label}</Text>
              )}
              {/* Bottom hairline divider on rows 0–3 (not the last row). */}
              {i < LEDGER_STAGES.length - 1 && <View style={styles.ledgerDivider} />}
            </View>
          );
        })}

        {/* TRAVELING CANDLE-POOL — one absolute-fill Svg over the rows. Authored
            with a measured-width viewBox so the AnimatedCircle's cy (viewBox
            units) maps 1:1 to row centers. Hidden until cardW is measured. */}
        {cardW > 0 && (
          <Svg
            style={StyleSheet.absoluteFill}
            width={cardW}
            height={CARD_H}
            viewBox={`0 0 ${cardW} ${CARD_H}`}
            pointerEvents="none"
          >
            <Defs>
              {/* byte-identical to vfBeam */}
              <RadialGradient id="ldgBeam" cx="0.5" cy="0.5" r="0.5">
                <Stop offset="0" stopColor="#fff4d2" stopOpacity={0.9} />
                <Stop offset="0.35" stopColor="#ffe7ad" stopOpacity={0.55} />
                <Stop offset="0.7" stopColor="#f2b65c" stopOpacity={0.18} />
                <Stop offset="1" stopColor="#f2b65c" stopOpacity={0} />
              </RadialGradient>
              <ClipPath id="ldgClip">
                <Path d={clipPath} />
              </ClipPath>
            </Defs>
            <G clipPath="url(#ldgClip)">
              {/* Bigger candle-pool (r=LAMP_R) that WANDERS — cx rides lampCx,
                  cy rides lampY on a different period, so the light traces an
                  ever-shifting path across the page, not a straight column. */}
              <AnimatedCircle cx={lampCx} cy={lampY} r={LAMP_R} fill="url(#ldgBeam)" opacity={lampPulse} />
            </G>
          </Svg>
        )}
      </View>

      {/* (D) REASSURANCE LINE — one honest per-step line; minHeight so swaps
          never reflow. No animated ellipsis, no rotating patter. */}
      <Text style={styles.ledgerReassure}>{LEDGER_REASSURE[stepIndex] || LEDGER_REASSURE[0]}</Text>

      {/* (E) BACKGROUND-RESUME NOTE — fades in after ~5s on long scans only.
          Reserves its space from the start (the Animated.View is always laid out;
          only its opacity animates) so the fade-in never reflows the screen. */}
      <Animated.View style={[styles.resumeNote, { opacity: resumeFade }]}>
        <Text style={styles.resumeNoteText}>
          Keep this page open while we work. If you switch apps, your scan pauses
          and picks up right where it left off when you return.
        </Text>
      </Animated.View>
    </>
  );
}

function extractExifGps(exif) {
  // Guard against a MISSING component, not a falsy-zero one: latitude 0 (equator)
  // or longitude 0 (prime meridian) is a valid coordinate, so `!value` would wrongly
  // discard a real fix. Require both present and reject only the exact (0,0)
  // null-island fix some cameras write when no GPS lock was acquired.
  if (exif?.GPSLatitude == null || exif?.GPSLongitude == null) return null;
  const lat = exif.GPSLatitudeRef === 'S' ? -Math.abs(exif.GPSLatitude) : Math.abs(exif.GPSLatitude);
  const lng = exif.GPSLongitudeRef === 'W' ? -Math.abs(exif.GPSLongitude) : Math.abs(exif.GPSLongitude);
  // Reject anything that didn't coerce to a real number (malformed/partial EXIF: ''
  // → 0, NaN, etc.) so a bogus 0/NaN coordinate never reaches the pin.
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat === 0 && lng === 0) return null;
  return { lat, lng };
}

// Acceptable horizontal accuracy (metres) for a fix we'll attach to the map pin.
// A coords.accuracy WORSE than this (a coarse cell/wifi fix) is rejected — it would
// both misplace the draggable pin and, worse, feed a wrong cemetery name into the
// reverseGeocodeCemetery → Tavily research disambiguator (which the user can't see
// or correct). Applied to BOTH the fresh read and the cached fix, so the preferred
// path is no laxer than the fallback. A null/absent accuracy field (some devices
// omit it) is treated as acceptable rather than discarding an otherwise-good fix.
const GPS_ACCEPTABLE_ACCURACY_M = 100;
function isAcceptableFix(coords) {
  return !!coords
    && Number.isFinite(coords.latitude) && Number.isFinite(coords.longitude)
    && (coords.accuracy == null || coords.accuracy <= GPS_ACCEPTABLE_ACCURACY_M);
}

// Resolve the device's current location for a camera shot whose photo carried no
// GPS EXIF. The user is physically AT the grave, so we want the most PRECISE on-site
// fix we can get WITHOUT stranding the pipeline (S72c — restructured after review).
// Strategy: read the INSTANT cache and the FRESH high-accuracy fix CONCURRENTLY, then
// prefer fresh-if-precise, else the cached fix, else null. This keeps precision (a
// good fresh fix wins) without the regression an earlier draft had — making the slow,
// cover-sensitive High read a BLOCKING first step with a long sole timeout meant that
// under tree canopy / beside mausoleums (the literal environment of an old cemetery)
// the loading screen could freeze for the whole cap before any coordinate appeared,
// even when a perfectly good recent cached fix existed.
//   • Cache (getLastKnownPositionAsync): instant, doesn't power the radio. Bounded
//     maxAge 60s (never reuse a fix from a place just left) + the accuracy floor.
//   • Fresh (getCurrentPositionAsync High ≈10m target): the precise on-site fix.
//     warmGps() pre-warms the chip at camera-open so this usually lands fast; capped
//     at 8s (a pre-warmed High read that hasn't locked by 8s won't by 15s either, and
//     8s of frozen loading is already a lot). Accepted only if it meets the accuracy
//     floor — a coarse High fix (High is a target, not a guarantee) is NOT preferred
//     over a precise cached one.
// Returns null only when neither source yields an acceptable fix → the pipeline
// degrades to no-pin + drag-to-correct, exactly as before (the no-Map-button safety
// net survives: a cached fix alone is enough to light the Result Map chip).
async function getDeviceGps() {
  try {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') return null;

    // Both reads run concurrently; each swallows its own failure to null so one
    // failing never rejects the pair. The fresh read is capped so a cold/wedged
    // chip can't hang the pipeline.
    const cachedPromise = Location.getLastKnownPositionAsync({ maxAge: 60000, requiredAccuracy: GPS_ACCEPTABLE_ACCURACY_M })
      .catch(() => null);
    const freshPromise = Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 8000)),
    ]).catch(() => null);

    const [fresh, cached] = await Promise.all([freshPromise, cachedPromise]);

    // Prefer the fresh on-site fix when it's precise; else the cached fix; else null.
    if (isAcceptableFix(fresh?.coords)) {
      return { lat: fresh.coords.latitude, lng: fresh.coords.longitude };
    }
    if (isAcceptableFix(cached?.coords)) {
      return { lat: cached.coords.latitude, lng: cached.coords.longitude };
    }
    return null;
  } catch {
    return null;
  }
}

// Fire-and-forget GPS pre-warm. Called when the camera/picker opens (pickAndAnalyze)
// so the chip starts acquiring satellites WHILE the user frames and takes the photo —
// turning the later getDeviceGps() read from a cold 10–30s lock into a warm 1–2s one.
// We deliberately DON'T await it or use its result: its only job is to power the chip
// on early. Fully fail-soft — a denied permission or any error is ignored here (the
// real read in getDeviceGps re-checks permission and handles failure). No timeout
// needed; nothing waits on this promise.
function warmGps() {
  (async () => {
    try {
      const { status } = await Location.getForegroundPermissionsAsync();
      if (status !== 'granted') return; // don't trigger a permission prompt from here
      await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
    } catch { /* pre-warm is best-effort */ }
  })();
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

  // loadingBox is the outer wrapper for the IlluminatedLedger loading screen.
  loadingBox: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },

  // ── The Illuminated Ledger loading screen ──────────────────────────────────
  // A candlelit vellum page; rows are FIXED height (56 = LEDGER_ROW_H) so the
  // traveling-pool SVG's viewBox-y coords provably track the rendered rows.
  ledgerHeader: { alignSelf: 'center', marginBottom: space.lg },
  ledgerTitle: {
    color: colors.parchment, fontFamily: fonts.title, fontSize: 22,
    letterSpacing: 0.5, textAlign: 'center', marginBottom: space.md,
  },
  ledgerCard: {
    width: '100%', alignSelf: 'stretch', backgroundColor: colors.stone,
    borderWidth: 1, borderColor: colors.line, borderRadius: radius.lg,
    paddingVertical: 8, paddingHorizontal: 16, overflow: 'hidden', position: 'relative',
  },
  ledgerRow: { flexDirection: 'row', alignItems: 'center', height: 56, gap: 12 },
  ledgerDivider: {
    height: StyleSheet.hairlineWidth, backgroundColor: colors.line, opacity: 0.4,
    position: 'absolute', left: 16, right: 16, bottom: 0,
  },
  sealSlot: { width: 22, height: 22, alignItems: 'center', justifyContent: 'center' },
  labelPending: { color: colors.ashDim, fontFamily: fonts.serif, fontSize: 16, flex: 1 },
  labelActive:  { color: colors.parchment, fontFamily: fonts.name, fontSize: 16, flex: 1 },
  labelDone:    { color: colors.ash, fontFamily: fonts.serif, fontSize: 16, flex: 1 },
  ledgerReassure: {
    color: colors.ash, fontFamily: fonts.bodyItalic, fontSize: 14,
    letterSpacing: 0.5, textAlign: 'center', marginTop: space.lg, minHeight: 22,
  },
  resumeNote: {
    marginTop: space.md, paddingHorizontal: space.lg,
    // Reserve height so the fade-in never reflows: two lines of 18px line-height.
    minHeight: 36,
  },
  resumeNoteText: {
    color: colors.ashDim, fontFamily: fonts.body, fontSize: 12.5,
    lineHeight: 18, textAlign: 'center',
  },

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
