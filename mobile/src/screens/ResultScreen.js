import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  Linking, Share, Image, Alert, FlatList, Dimensions, Modal, Pressable, TextInput,
  PanResponder, AppState,
} from 'react-native';
import * as Speech from 'expo-speech';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import { loadStories, saveStories } from '../lib/storage';
import { cloudSaveStory, cloudUpdateStory, cloudDeleteStory, findOrCreateGrave, setGraveMarker } from '../lib/sync';
import { uploadGravestoneImage } from '../lib/api-r2';
import { getTributes, setTribute } from '../lib/api-tributes';
import { submitContentReport, REPORT_REASONS, REPORT_NOTE_MAX } from '../lib/api-reports';
import { fetchWikipediaPortraits, normalizePortraits } from '../lib/api-wikipedia';
import { redactLivingNamesForPublic, stripOriginatedNamesForPublic, stripOriginatedNamesFromSources, stripOriginatedNamesFromMentions, filterMentionsForPublic } from '../lib/api-gemini';
import { useRefresh } from '../lib/use-refresh';
import { deletePendingPhoto } from '../lib/pending';
import { logEvent, EVENTS } from '../lib/analytics';
import { exportStoryGedcom } from '../lib/export-gedcom';
import { colors, fonts, radius } from '../lib/theme';
import { MapStack, ShareIcon, Globe, Pin, TreeIcon } from '../components/Icons';
import { MARKER_STYLES, MARKER_PACKS, getMarker, GraveMarkerSvg } from '../components/GraveMarkers';
import { SYMBOL_CONTEXT } from '../lib/biography';

const SCREEN_W = Dimensions.get('window').width;
const AI_DISCLAIMER_SEEN_KEY = 'gs_ai_disclaimer_seen';
const SHARE_NOTICE_SEEN_KEY = 'gs_share_notice_seen';
// "Don't show again" flag for the post-save "place your pin on the map" reminder.
// Unset = show the reminder after every save; 'true' = the user opted out forever.
const PIN_REMINDER_DISMISSED_KEY = 'gs_pin_reminder_dismissed';

// Wikimedia's upload.wikimedia.org 403s requests from the default RN/okhttp image
// loader (it blocks bare/okhttp User-Agents as anti-hotlinking) — so portrait URLs
// from Wikipedia silently fail to render unless we send a real UA on the <Image>
// request. WIKI_HEADERS is used for the JS fetch calls in api-wikipedia.js; <Image>
// needs the same UA passed via source.headers. Local/R2 images (file://, data:, our
// own R2 host) don't need it, but the header is harmless there.
const IMAGE_UA = 'GraveStory/1.0 (https://github.com/J3K420/Gravestory; gravestory mobile app)';
// Build an <Image> source, attaching the UA header only for remote http(s) URIs
// (Wikimedia portraits). file:// and data: URIs are returned bare.
function imgSource(uri) {
  if (typeof uri === 'string' && /^https?:\/\//i.test(uri)) {
    return { uri, headers: { 'User-Agent': IMAGE_UA } };
  }
  return { uri };
}

// Android caps a single Speech.speak() utterance at maxSpeechInputLength
// (4000 chars on every device; iOS reports Number.MAX_VALUE). Over the cap the
// native call throws and NO callback fires, so the button would stick on "Stop"
// with no audio. We chunk well under the cap and queue the pieces (expo-speech
// appends queued utterances), so a 2500-word famous-figure bio reads in full.
// Stay comfortably below 4000 to leave room for the intro and any voice that
// counts bytes rather than code points.
const TTS_CHUNK_LIMIT = 3500;

// Strip the on-page citation apparatus and markup that reads badly aloud, then
// collapse the whitespace that leaves behind. Handles single AND grouped
// citation forms ([1], [1, 2], [1-3]), normalises the chevron used in chips
// (›) and a bare ampersand so the voice says "and" instead of "ampersand".
function cleanBioForSpeech(text) {
  return (text || '')
    .replace(/\[[\d\s,&–-]+\]/g, '')   // [1], [1, 2], [1-3], [1–3] citation groups
    .replace(/\s*›\s*/g, ' ')           // chevron chip separator → space
    .replace(/\s*&\s*/g, ' and ')       // bare ampersand → spoken "and"
    .replace(/\s+/g, ' ')               // collapse the gaps the strips leave
    .trim();
}

// Split text into queueable utterances no longer than TTS_CHUNK_LIMIT, breaking
// on sentence boundaries so the pauses fall naturally. A single sentence longer
// than the limit (rare) is hard-split on whitespace as a fallback. Returns [] for
// empty input.
function chunkForSpeech(text) {
  if (!text) return [];
  if (text.length <= TTS_CHUNK_LIMIT) return [text];
  // Keep the delimiter with its sentence so periods/?!/ are spoken naturally.
  const sentences = text.match(/[^.!?]+[.!?]*\s*/g) || [text];
  const chunks = [];
  let buf = '';
  const flush = () => { if (buf.trim()) chunks.push(buf.trim()); buf = ''; };
  for (const sentence of sentences) {
    if (sentence.length > TTS_CHUNK_LIMIT) {
      // Pathologically long sentence: flush what we have, then hard-split it.
      flush();
      for (const word of sentence.split(/\s+/)) {
        if ((buf + ' ' + word).length > TTS_CHUNK_LIMIT) flush();
        buf = buf ? `${buf} ${word}` : word;
      }
      flush();
    } else if ((buf + sentence).length > TTS_CHUNK_LIMIT) {
      flush();
      buf = sentence;
    } else {
      buf += sentence;
    }
  }
  flush();
  return chunks;
}

// Bottom-sheet grab-bar that dismisses the sheet on a downward swipe. The bar
// was previously a decorative View with no gesture wired up, so dragging it did
// nothing. A wide tap/drag target sits behind the visible 40px pill. The capture
// threshold (downward, >6px, mostly vertical) ignores horizontal scrolls; the
// release threshold (drag past ~50px or a fast downward flick) triggers onClose.
function SwipeHandle({ onClose }) {
  const responder = React.useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => g.dy > 6 && Math.abs(g.dy) > Math.abs(g.dx),
      onPanResponderRelease: (_e, g) => {
        if (g.dy > 50 || g.vy > 0.5) onClose();
      },
    })
  ).current;
  return (
    <View {...responder.panHandlers} style={styles.sheetHandleHit}>
      <View style={styles.symbolSheetHandle} />
    </View>
  );
}

export default function ResultScreen({ navigation, route }) {
  const insets = useSafeAreaInsets();
  const [story, setStory]               = useState(route.params?.story);
  const [user, setUser]                 = useState(null);
  const [sharing, setSharing]           = useState(false);
  const [exporting, setExporting]       = useState(false);
  const [saving, setSaving]             = useState(false);
  const [togglingPublic, setTogglingPublic] = useState(false);
  const [carouselIndex, setCarouselIndex] = useState(0);
  const [tributes, setTributes]         = useState({ candles: 0, flowers: 0, userTribute: null });
  const [tributeLoading, setTributeLoading] = useState(false);
  const [gravePhotos, setGravePhotos]   = useState([]);
  const [livePortraits, setLivePortraits] = useState([]);
  const [symbolModal, setSymbolModal]   = useState(null); // { name, text }
  const [mentionsModal, setMentionsModal] = useState(false); // "Also found in…" sheet
  const [markerModal, setMarkerModal]   = useState(false);
  const [markerPack, setMarkerPack]     = useState(MARKER_PACKS[0].id); // active picker tab
  const [aiModal, setAiModal]           = useState(false); // first-view AI-disclaimer explainer
  const [reportModal, setReportModal]   = useState(false); // "report a problem" sheet
  const [reportReason, setReportReason] = useState(null);
  const [reportNote, setReportNote]     = useState('');
  const [reportSending, setReportSending] = useState(false);
  const [reportDone, setReportDone]     = useState(false);
  const [shareNoticeModal, setShareNoticeModal] = useState(false); // first-share public notice
  const [pinReminderModal, setPinReminderModal] = useState(false); // post-save "place your pin" reminder
  const [pinReminderDontShow, setPinReminderDontShow] = useState(false); // its "don't show again" checkbox
  const [savingMarker, setSavingMarker] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false); // bio read-aloud (TTS) active
  // expo-speech is a single global engine but isSpeaking is per-instance state.
  // speechGen is bumped on every start/stop so that a stale onDone/onStopped
  // from a previous (or chunked) utterance can't flip the button back — the
  // callback compares its captured generation against the current one and bails
  // if they differ. isSpeakingRef mirrors the latest value for the long-lived
  // AppState/blur/param-swap listeners, which must read "are we speaking now?"
  // without re-subscribing on every toggle (a fresh subscription each render
  // would be churn, and a stale closure would read the wrong value).
  const speechGen = useRef(0);
  const isSpeakingRef = useRef(false);
  // Holds the pending "did the engine actually start?" watchdog timer (see
  // handleListen). Cleared whenever we stop or a chunk reports onStart, so a
  // stale watchdog can never fire against a later run.
  const speechWatchdog = useRef(null);
  // Mirrors the chosen marker synchronously so handleSave reads the latest pick
  // even if the user taps Save before the setStory re-render lands (a pre-save
  // pick must reach findOrCreateGrave to stake the grave). Refs update instantly.
  const markerStyleRef = useRef(undefined);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
    });
  }, []);

  // When CameraScreen finishes researching a pending story it navigates back
  // here with the fresh story as a new param — adopt it (useState's initial
  // value only reads route.params once, on first mount).
  useEffect(() => {
    if (route.params?.story && route.params.story !== story) {
      setStory(route.params.story);
    }
  }, [route.params?.story]);

  useEffect(() => {
    if (story?.grave_id) {
      getTributes(story.grave_id).then(setTributes).catch(() => {});
    }
  }, [story?.grave_id]);

  // First-ever view of a real generated biography → show the one-time
  // AI-disclaimer explainer, then persist a flag so it never shows again
  // (the small caption beneath each bio carries the message thereafter).
  // Skipped for the read-only sample and the unresearched pending template.
  useEffect(() => {
    const hasRealBio = story && !story._isSample && !story._pending && (story.biography || '').trim();
    if (!hasRealBio) return;
    AsyncStorage.getItem(AI_DISCLAIMER_SEEN_KEY)
      .then(seen => { if (seen !== 'true') setAiModal(true); })
      .catch(() => {});
  }, [story?._isSample, story?._pending, story?.biography]);

  // Global map bios: fetch all community photos of this stone
  useEffect(() => {
    if (!story?._isGlobal || !story?.grave_id) return;
    supabase
      .from('grave_photos')
      .select('image_url')
      .eq('grave_id', story.grave_id)
      .order('created_at', { ascending: false })
      .limit(10)
      .then(({ data }) => {
        const urls = (data || []).map(r => r.image_url).filter(Boolean);
        if (urls.length > 0) setGravePhotos(urls);
      });
  }, [story?.grave_id, story?._isGlobal]);

  // Global bios have no locally-persisted portraits — fetch live from Wikipedia.
  useEffect(() => {
    if (!story?._isGlobal || !story?.name) return;
    if (normalizePortraits(story.portraits).length > 0) return;
    fetchWikipediaPortraits(story.name, story.dates)
      .then(uris => { if (uris.length > 0) setLivePortraits(uris); })
      .catch(() => {});
  }, [story?.name]);

  const { refreshControl } = useRefresh(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    const all = await loadStories(session?.user?.id ?? null);
    const fresh = all.find(s => s.timestamp === story?.timestamp);
    if (fresh) setStory(fresh);
  });

  // Keep the ref in lock-step with the state so the long-lived listeners below
  // (which capture the ref, not the state) always see the current value.
  useEffect(() => { isSpeakingRef.current = isSpeaking; }, [isSpeaking]);

  // Single stop helper: bumping the generation invalidates any in-flight
  // utterance callbacks (so a late onStopped from the engine can't re-toggle
  // the button), halts the engine, and resets the button. Safe to call when
  // nothing is speaking. Stable identity (refs + setState are stable).
  const stopSpeech = useCallback(() => {
    speechGen.current += 1;
    if (speechWatchdog.current) { clearTimeout(speechWatchdog.current); speechWatchdog.current = null; }
    Speech.stop();
    setIsSpeaking(false);
  }, []);

  // Stop read-aloud on every path that takes the user away from this content:
  //  • navigation blur (back, tab-away, a new screen pushed on top)
  //  • app backgrounded mid-listen (matches App.js's AppState pattern — RN
  //    suspends JS when backgrounded and TTS would otherwise keep playing)
  //  • unmount (returned cleanup)
  // Listeners read isSpeakingRef so they don't need to re-subscribe per toggle.
  useEffect(() => {
    const blurSub = navigation.addListener('blur', () => {
      if (isSpeakingRef.current) stopSpeech();
    });
    const appSub = AppState.addEventListener('change', (state) => {
      if (state !== 'active' && isSpeakingRef.current) stopSpeech();
    });
    return () => {
      blurSub();
      appSub.remove();
      // Cancel any pending start-watchdog so it can't fire after we're gone.
      if (speechWatchdog.current) { clearTimeout(speechWatchdog.current); speechWatchdog.current = null; }
      // Unconditional stop on unmount: the global engine outlives this screen,
      // so a half-read bio must not keep playing after we're gone.
      Speech.stop();
    };
  }, [navigation, stopSpeech]);

  // A new story can replace the current one in-place (CameraScreen navigates
  // back with a researched story → setStory on the SAME mounted instance, no
  // blur/remount). If we're mid-listen when that happens, the old narration
  // would keep reading over the new content — so stop on every story switch.
  const storyKey = story?.timestamp;
  useEffect(() => {
    return () => { if (isSpeakingRef.current) stopSpeech(); };
  }, [storyKey, stopSpeech]);

  if (!story) {
    return (
      <SafeAreaView style={styles.container}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.back}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <View style={styles.center}>
          <Text style={styles.emptyText}>No story to display.</Text>
        </View>
      </SafeAreaView>
    );
  }

  // Offline-scanned placeholder: photo was captured without connectivity and
  // research hasn't run yet. Show a template page with a "Run Research" button
  // that routes back through CameraScreen's pipeline (which replaces this
  // placeholder with the real story on success).
  if (story._pending) {
    const discardPending = () => {
      Alert.alert(
        'Discard Scan',
        'Delete this saved photo without researching it?',
        [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Discard', style: 'destructive',
            onPress: async () => {
              const { data: { session } } = await supabase.auth.getSession();
              const uid = session?.user?.id ?? null;
              const all = await loadStories(uid);
              await saveStories(all.filter(s => s.timestamp !== story.timestamp), uid);
              deletePendingPhoto(story.photoUri);
              navigation.navigate('Home');
            },
          },
        ]
      );
    };

    return (
      <SafeAreaView style={styles.container}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.back}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <ScrollView contentContainerStyle={styles.scroll}>
          {!!story.photoUri && (
            <View style={styles.carouselOuter}>
              <View style={styles.carouselSlide}>
                <Image source={imgSource(story.photoUri)} style={styles.carouselImage} resizeMode="contain" />
                <View style={styles.carouselLabelBadge}>
                  <Text style={styles.carouselLabelText}>Gravestone</Text>
                </View>
              </View>
            </View>
          )}

          <Text style={styles.name}>Awaiting Research</Text>
          <View style={styles.datesRow}>
            <Text style={styles.datesText}>
              Scanned offline · {new Date(story.timestamp).toLocaleDateString()}
            </Text>
          </View>
          {story.gps && (
            <View style={styles.locationRow}>
              <Pin size={13} color={colors.ashDim} />
              <Text style={styles.location}>Location captured with photo</Text>
            </View>
          )}

          <View style={styles.divider} />

          <Text style={styles.bio}>
            This stone was photographed without an internet connection. The photo
            {story.gps ? ' and its location were' : ' was'} saved — once you're back
            online, run the research to read the inscription and build this
            person's story.
          </Text>

          <TouchableOpacity
            style={styles.saveBtn}
            onPress={() => navigation.navigate('Camera', { pending: story })}
            activeOpacity={0.85}
          >
            <Text style={styles.saveBtnText}>Run Research</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.deleteBtn} onPress={discardPending} activeOpacity={0.7}>
            <Text style={styles.deleteBtnText}>Discard</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }

  const { name, dates, biography, sources = [], source_urls = [], location, portraits, graveData, symbol_meanings, mentions: storyMentions } = story;
  // Mentions — name-safe one-line source pointers (resolveMentions). Shown as a
  // single "Also found in…" chip opening a bottom sheet of tappable hyperlinks.
  const mentions = Array.isArray(storyMentions)
    ? storyMentions.filter(m => m && typeof m.sentence === 'string' && m.sentence.trim())
    : [];
  // Symbols round-trip as a top-level column (set at scan time, mirrors web);
  // fall back to graveData for any older in-memory story that predates that.
  const symbols = Array.isArray(story.symbols) && story.symbols.length
    ? story.symbols
    : (Array.isArray(graveData?.symbols) ? graveData.symbols : []);
  // Resolve a symbol's displayable meaning: static SYMBOL_CONTEXT table first
  // (fast, trusted), then the per-story AI-resolved meanings (filled at scan time
  // for symbols the table missed). Returns null when unknown → chip stays grey.
  // Guards non-string OCR output, and trims to match the resolver's stored key.
  const symbolMeaning = (s) => {
    if (typeof s !== 'string' || !s.trim()) return null;
    const lower = s.toLowerCase();
    const fromTable = Object.entries(SYMBOL_CONTEXT).find(([k]) => lower.includes(k))?.[1];
    if (fromTable) return fromTable;
    const fromAi = symbol_meanings && typeof symbol_meanings === 'object' ? symbol_meanings[s.trim()] : null;
    return (fromAi && typeof fromAi === 'string' && fromAi.trim()) ? fromAi.trim() : null;
  };
  const paragraphs = (biography || '').split('\n\n').filter(Boolean);

  // The text the read-aloud narrates: the person's name, their lifespan, then
  // the cleaned biography prose. Computed once per render (the render guard and
  // handleListen both read this const, so the regexes run once, not per call).
  const speakBio = cleanBioForSpeech(biography);
  const speakIntro = [name, dates].filter(Boolean).join('. ');
  const speakableText = speakBio
    ? (speakIntro ? `${speakIntro}. ${speakBio}` : speakBio)
    : '';

  // Toggle read-aloud: stop if narrating, else chunk the bio and queue the
  // pieces. Each Speech.speak captures the generation that was current when it
  // started; its onDone/onStopped/onError no-ops if the generation has since
  // moved on (a stop, a re-tap, a story/app/nav change), so stale async
  // callbacks can never flip the button back. Only the LAST chunk's onDone
  // clears the speaking state — the engine plays queued chunks in order.
  //
  // expo-speech's Speech.stop() is ASYNC (it just kicks Android's
  // TextToSpeech.stop(), which flushes the queue on a background thread). The
  // previous code fired Speech.stop() and then Speech.speak() in the SAME tick,
  // so on a SECOND bio the new chunks were QUEUE_ADD-appended onto an engine
  // still flushing the first bio's queue — Android silently DROPS them, no
  // onStart/onDone ever returns, and the button stranded on "Stop" with no
  // audio until the app was killed. Two guards fix that here:
  //   1. AWAIT Speech.stop() before queuing, so utterances are never stacked
  //      behind an unsettled flush.
  //   2. An onStart watchdog: if no chunk reports it started within ~1.2s,
  //      treat the engine as wedged, reset the button, and stop cleanly so the
  //      next tap starts fresh (the engine recovers once it finishes flushing).
  // A plain function (not useCallback): it lives after the early returns, so it
  // can't be a hook, and onPress doesn't need a stable identity.
  async function handleListen() {
    if (isSpeaking) { stopSpeech(); return; }
    const chunks = chunkForSpeech(speakableText);
    if (chunks.length === 0) return;
    // New utterance run — claim a fresh generation so any prior callbacks die,
    // and flush any queue a rapid double-tap (or a still-flushing previous bio)
    // left in the engine so we never stack two overlapping reads.
    speechGen.current += 1;
    const myGen = speechGen.current;
    if (speechWatchdog.current) { clearTimeout(speechWatchdog.current); speechWatchdog.current = null; }
    setIsSpeaking(true);
    // Wait for the engine to finish flushing before queuing — this is the line
    // that prevents the dropped-utterance wedge on the second bio.
    try { await Speech.stop(); } catch {}
    // A stop / re-tap / story-swap / blur during the await bumped the generation;
    // if so this run is stale — undo our optimistic flag (only if still ours)
    // and bail without queuing anything.
    if (speechGen.current !== myGen) { if (isSpeakingRef.current) setIsSpeaking(false); return; }
    let started = false;
    const reset = () => { if (speechGen.current === myGen) setIsSpeaking(false); };
    chunks.forEach((chunk, i) => {
      const isLast = i === chunks.length - 1;
      Speech.speak(chunk, {
        language: 'en-US',
        rate: 0.92, // a touch slower than default — these are reflective stories
        onStart:   () => {
          started = true;
          if (speechWatchdog.current) { clearTimeout(speechWatchdog.current); speechWatchdog.current = null; }
        },
        onDone:    () => { if (isLast) reset(); },
        onStopped: reset,
        onError:   reset,
      });
    });
    // If the engine never reports a start, it dropped our utterances — un-strand
    // the button and stop cleanly so the next tap can start over.
    speechWatchdog.current = setTimeout(() => {
      speechWatchdog.current = null;
      if (!started && speechGen.current === myGen) {
        speechGen.current += 1; // invalidate this run's callbacks
        Speech.stop();
        setIsSpeaking(false);
      }
    }, 1200);
  }

  // Global map bios: show all community photos of this stone when available.
  // Own stories: show only the user's own gravestone photo. For a freshly
  // scanned (still _unsaved) story there's no R2 image_url yet — the photo
  // only lives in memory as _base64 until the user taps Save — so fall back
  // to a data URI so the gravestone still appears in the carousel immediately.
  const localGraveUri = story.image_url
    || (story._base64 ? `data:image/jpeg;base64,${story._base64}` : null);
  const graveSlots = (story._isGlobal && gravePhotos.length > 0)
    ? gravePhotos.map((uri, i) => ({
        uri,
        label: gravePhotos.length > 1 ? `Photo ${i + 1} of ${gravePhotos.length}` : 'Gravestone',
      }))
    // The sample story bundles its gravestone photo as a local asset (a require()'d
    // module, not a URI) so the example leads with a real stone like a true scan.
    : (story._graveImageAsset
        ? [{ asset: story._graveImageAsset, label: 'Gravestone' }]
        : (localGraveUri ? [{ uri: localGraveUri, label: 'Gravestone' }] : []));

  const portraitUris = normalizePortraits(portraits).length > 0
    ? normalizePortraits(portraits)
    : livePortraits;

  const carouselImages = [
    ...graveSlots,
    ...portraitUris.map(uri => ({ uri, label: 'Portrait' })),
  ].filter(Boolean);

  async function handleSave() {
    if (saving || !story._unsaved) return;
    setSaving(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const sessionUser = session?.user ?? null;
      const uid = sessionUser?.id ?? null;
      const base64 = story._base64;
      const primaryName = story._primaryName || story.name || '';
      // Freshest chosen marker: the ref beats the story closure when the user
      // picked then tapped Save before the re-render landed. Undefined ref means
      // no pre-save pick → keep whatever the story already had.
      const markerStyle = markerStyleRef.current ?? story.marker_style ?? null;

      // Resolve the canonical grave at save time. On a find_grave cache hit the
      // grave_id is already set; otherwise dedup via find_or_create (~20m name match).
      let graveId = story.grave_id || null;
      if (!graveId && sessionUser && story.gps && primaryName) {
        // Stake the grave's permanent global-map pin with the user's chosen
        // marker on creation (first-wins; the user can pick before saving).
        graveId = await findOrCreateGrave(
          primaryName, story.gps.lat, story.gps.lng, story.is_public, markerStyle,
        );
      }

      // Strip transient pipeline-only fields before persisting.
      const { _unsaved, _base64, _primaryName, ...clean } = story;
      let saved = { ...clean, grave_id: graveId, marker_style: markerStyle };

      // If this story is saving straight to PUBLIC (default_visibility=public),
      // it never passes through the share toggle — so redact living-relative
      // names here, before its first cloud save reaches the global map. Same
      // guard + fail-safe as _doTogglePublic.
      if (saved.is_public && !saved.public_biography && saved.biography) {
        try {
          const subjects = Array.isArray(saved.subjects) ? saved.subjects
            : (Array.isArray(saved.graveData?.subjects) ? saved.graveData.subjects : []);
          // INCREMENT 2: strip app-originated names BEFORE the fail-open redactor;
          // desync guard -> safe placeholder if flag set but names absent.
          const _orig = Array.isArray(saved.originatedRelatives) ? saved.originatedRelatives : [];
          if (saved.has_originated_relatives && !_orig.length) {
            saved.public_biography = 'This public biography is being prepared.';
            // Desync fail-safe: blank EVERY raw-served public column, not just bio.
            saved.mentions = [];
            saved.sources = [];
            saved.source_urls = [];
          } else {
            const _stripped = stripOriginatedNamesForPublic(saved.biography, _orig, subjects);
            saved.public_biography = await redactLivingNamesForPublic(_stripped, subjects);
            // `sources` is served RAW by the public RPC — strip originated names
            // from citation descriptions too. Shared column; owner sees the name
            // in the bio prose, so dropping it here is fine.
            if (_orig.length) {
              saved.sources = stripOriginatedNamesFromSources(saved.sources, _orig, subjects);
              saved.source_urls = stripOriginatedNamesFromSources(saved.source_urls, _orig, subjects);
            }
            // Mentions public floor: (1) drop a mention naming a living non-originated
            // relative the model missed; (2) strip any app-originated name.
            saved.mentions = filterMentionsForPublic(saved.mentions, subjects);
            if (_orig.length) {
              saved.mentions = stripOriginatedNamesFromMentions(saved.mentions, _orig, subjects);
            }
          }
        } catch (e) {
          console.warn('public_biography redaction skipped on auto-public save (non-fatal):', e?.message || e);
        }
      }

      // Local save first so the story is always available offline.
      const existing = await loadStories(uid);
      await saveStories([saved, ...existing], uid);

      // Cloud save + R2 image upload if signed in.
      if (sessionUser) {
        saved = await cloudSaveStory(saved, sessionUser);
        if (base64) {
          const imageUrl = await uploadGravestoneImage(base64);
          if (imageUrl) {
            saved = await cloudUpdateStory({ ...saved, image_url: imageUrl }, sessionUser);
            // Contribute to the grave's community photo pool (non-blocking).
            if (saved.grave_id) {
              (async () => {
                try {
                  await supabase.from('grave_photos').insert({
                    grave_id: saved.grave_id,
                    user_id: sessionUser.id,
                    image_url: imageUrl,
                  });
                } catch (e) {
                  console.warn('grave_photos insert failed (non-fatal):', e.message);
                }
              })();
            }
            // Persist image_url locally too so the saved story shows the photo offline.
            const all = await loadStories(uid);
            const idx = all.findIndex(s => s.timestamp === saved.timestamp);
            if (idx >= 0) { all[idx] = saved; await saveStories(all, uid); }
          }
        }
      }

      setStory(saved);
      logEvent(EVENTS.STORY_SAVED, { signedIn: !!sessionUser, hasGrave: !!graveId });

      // Post-save reminder to place the pin precisely on the map. GPS is often
      // 10–30 m off (worse under tree cover), so as a user accumulates saved
      // stories their map fills with pins that are near-but-not-on the grave and
      // become hard to tell apart. Nudge them — after EVERY save — to open the map
      // and drag the pin, until they opt out via the modal's "don't show again".
      // Gated on:
      //   • the story actually HAVING a pin to drag (gps or a geocodable location);
      //     a no-location save has nothing to place — same gate as the Map chip.
      //   • the AI-disclaimer sheet NOT being up. It auto-opens on a first-ever real
      //     bio; if the user saved before dismissing it, two bottom sheets would
      //     stack. Suppressing here (rather than stacking) is fine — with "every
      //     save" cadence the reminder lands on their next save anyway.
      // The `.catch(() => null)` is LOAD-BEARING: it keeps a storage read failure
      // from propagating into the surrounding try's catch and firing a bogus
      // "Save Failed" alert AFTER the save already committed. Don't remove it.
      // Net fail-soft: any read miss/error → reminder shows (the safe default).
      if ((saved.gps || saved.location) && !aiModal) {
        const dismissed = await AsyncStorage.getItem(PIN_REMINDER_DISMISSED_KEY).catch(() => null);
        if (dismissed !== 'true') {
          setPinReminderDontShow(false); // reset the checkbox each time it opens
          setPinReminderModal(true);
        }
      }
    } catch (err) {
      console.warn('Save failed:', err?.message);
      Alert.alert('Save Failed', 'Could not save this story. Please check your connection and try again.');
    } finally {
      setSaving(false);
    }
  }

  // Dismiss the post-save pin reminder. If the user ticked "don't show again",
  // persist the flag so the reminder never fires again on any future save.
  function dismissPinReminder() {
    setPinReminderModal(false);
    if (pinReminderDontShow) {
      AsyncStorage.setItem(PIN_REMINDER_DISMISSED_KEY, 'true').catch(() => {});
    }
  }

  async function handleDelete() {
    if (story._isGlobal) return;
    Alert.alert(
      'Delete Story',
      `Remove "${name || 'this story'}" permanently?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive',
          onPress: async () => {
            const all = await loadStories(user?.id ?? null);
            await saveStories(all.filter(s => s.timestamp !== story.timestamp), user?.id ?? null);
            if (story.id && user) await cloudDeleteStory(story, user);
            navigation.navigate('Home');
          },
        },
      ]
    );
  }

  async function handleShare() {
    setSharing(true);
    try {
      const text = [name, dates, location, '', biography, '', 'Discovered with GraveStory']
        .filter(Boolean).join('\n');
      await Share.share({ message: text, title: `GraveStory — ${name || 'Unknown'}` });
      logEvent(EVENTS.STORY_SHARED, { isGlobal: !!story._isGlobal });
    } catch {}
    setSharing(false);
  }

  // Export the story as a GEDCOM file for a family-tree app. Owner-only (the
  // button is hidden on global/sample stories). GEDCOM is unfamiliar to most
  // users, so a one-line explainer first sets the expectation that the share
  // sheet is HOW you keep the file — then we open it. The available destinations
  // vary by device (Drive, email, cloud apps, etc.), so the copy stays generic
  // and does NOT name a specific option that may not appear. Fail-soft Alert.
  function handleExport() {
    if (exporting) return;
    Alert.alert(
      'Save your family-tree file',
      'This creates a GEDCOM (.ged) file for genealogy apps like Ancestry or FamilySearch. On the next screen, send it to Google Drive, email, or another app to keep it.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Continue', onPress: doExport },
      ],
    );
  }

  async function doExport() {
    if (exporting) return;
    setExporting(true);
    try {
      const res = await exportStoryGedcom(story);
      if (res.ok) {
        logEvent(EVENTS.STORY_SHARED, { method: 'gedcom', isGlobal: false });
      } else if (res.reason === 'sharing-unavailable') {
        Alert.alert('Export unavailable', 'Sharing is not available on this device.');
      } else if (res.reason === 'error') {
        Alert.alert('Export failed', 'Could not generate the GEDCOM file.');
      }
      // 'no-story' / 'not-owner' are unreachable (button is gated) → no Alert.
    } catch {}
    setExporting(false);
  }

  async function handleTogglePublic() {
    if (!user || story._isGlobal || togglingPublic) return;
    const goingPublic = !story.is_public;
    // First time a user shares ANY story publicly, make them read+accept a
    // one-time notice (public stories are visible to all and may name others).
    // Making a story private again never gates.
    if (goingPublic) {
      const seen = await AsyncStorage.getItem(SHARE_NOTICE_SEEN_KEY).catch(() => null);
      if (seen !== 'true') {
        setShareNoticeModal(true);
        return;
      }
    }
    await _doTogglePublic();
  }

  // The actual public/private flip — also called after the user accepts the
  // first-share notice.
  async function _doTogglePublic() {
    if (togglingPublic) return;
    setTogglingPublic(true);
    const updated = { ...story, is_public: !story.is_public };
    // Before a story reaches the public global map, strip the names of any
    // LIVING relatives from the bio prose (privacy/defamation guard). Done
    // once and cached on the row; the redacted copy is what the global RPC
    // serves. Fails safe: redactLivingNamesForPublic returns the original on
    // any error, so sharing never breaks.
    if (updated.is_public && !updated.public_biography && updated.biography) {
      try {
        const subjects = Array.isArray(updated.subjects) ? updated.subjects
          : (Array.isArray(updated.graveData?.subjects) ? updated.graveData.subjects : []);
        // INCREMENT 2: strip app-originated names BEFORE the fail-open redactor;
        // desync guard -> safe placeholder if flag set but names absent.
        const _orig = Array.isArray(updated.originatedRelatives) ? updated.originatedRelatives : [];
        if (updated.has_originated_relatives && !_orig.length) {
          updated.public_biography = 'This public biography is being prepared.';
          // Desync fail-safe: blank EVERY raw-served public column, not just bio.
          updated.mentions = [];
          updated.sources = [];
          updated.source_urls = [];
        } else {
          const _stripped = stripOriginatedNamesForPublic(updated.biography, _orig, subjects);
          updated.public_biography = await redactLivingNamesForPublic(_stripped, subjects);
          // `sources`/`source_urls` are served RAW by the public RPC — strip
          // originated names from both (model can author a name into either).
          if (_orig.length) {
            updated.sources = stripOriginatedNamesFromSources(updated.sources, _orig, subjects);
            updated.source_urls = stripOriginatedNamesFromSources(updated.source_urls, _orig, subjects);
          }
          // Mentions public floor: drop a living non-originated name, then strip
          // any app-originated name.
          updated.mentions = filterMentionsForPublic(updated.mentions, subjects);
          if (_orig.length) {
            updated.mentions = stripOriginatedNamesFromMentions(updated.mentions, _orig, subjects);
          }
        }
      } catch (e) {
        console.warn('public_biography redaction skipped (non-fatal):', e?.message || e);
      }
    }
    const all = await loadStories(user?.id ?? null);
    const idx = all.findIndex(s => s.timestamp === story.timestamp);
    if (idx >= 0) { all[idx] = updated; await saveStories(all, user?.id ?? null); }
    setStory(updated);
    if (updated.id) setStory(await cloudUpdateStory(updated, user));
    if (updated.is_public) logEvent(EVENTS.MADE_PUBLIC, {});
    setTogglingPublic(false);
  }

  async function acceptShareNotice() {
    await AsyncStorage.setItem(SHARE_NOTICE_SEEN_KEY, 'true').catch(() => {});
    setShareNoticeModal(false);
    await _doTogglePublic();
  }

  async function handlePickMarker(styleId) {
    if (savingMarker) return;
    setMarkerModal(false);
    if ((story.marker_style || 'book') === styleId) return;
    // Record the pick synchronously so a pre-save Save tap sees it (see ref note).
    markerStyleRef.current = styleId;
    setSavingMarker(true);

    const uid = user?.id ?? null;
    const all = await loadStories(uid);
    const idx = all.findIndex(s => s.timestamp === story.timestamp);

    // Seed from the freshest PERSISTED row, not the in-memory `story`. The
    // cemetery map's drag-to-correct writes the corrected pin (gps + userCorrected
    // + _lowConfidence) straight to local storage / the cloud, but THIS screen's
    // `story` state never learned about it. Spreading the stale `story` here — then
    // writing it back below — reverted the location to its original (pre-drag)
    // coordinate. So overlay the marker pick onto the saved row's location fields.
    // KEEP THIS FIELD LIST IN SYNC with CemeteryMapScreen.handleDragEnd's persisted
    // set — those are the only fields it changes today (gps, userCorrected,
    // _lowConfidence). If the drag ever persists another corrected field, copy it
    // here too, or the stale-`story` spread will start clobbering it again.
    // (Guard the spread: a fresh-scan _unsaved story has no local row yet — idx<0 —
    // so fall back to `story`, which holds the only copy that exists.)
    const base = idx >= 0 ? { ...story, gps: all[idx].gps, userCorrected: all[idx].userCorrected, _lowConfidence: all[idx]._lowConfidence } : story;
    const updated = { ...base, marker_style: styleId };
    // Self-heal a missing grave link: if find_or_create_grave failed at save
    // time (non-fatal) the saved story has no grave_id, so an explicit pick
    // would silently never stake. Create-and-stake in one shot here and
    // backfill grave_id so the pin (and tributes/photos) recover.
    if (!updated._unsaved && !updated.grave_id && user && updated.gps) {
      const primaryName = updated._primaryName || updated.name || '';
      if (primaryName) {
        const gid = await findOrCreateGrave(
          primaryName, updated.gps.lat, updated.gps.lng, updated.is_public, styleId,
        );
        if (gid) updated.grave_id = gid;
      }
    }
    if (idx >= 0) { all[idx] = updated; await saveStories(all, uid); }
    setStory(updated);

    // UNSAVED story: do NOT touch the cloud here. markerStyleRef (set above) is
    // read by handleSave, which owns the single INSERT (and the grave staking +
    // redaction). Previously this path called cloudSaveStory on an unsaved
    // story, which (a) minted a cloud row before the user tapped Save/Discard —
    // so a pick-then-Discard still left the story in the cloud — and (b) never
    // cleared _unsaved, so the later handleSave INSERTed a SECOND row (duplicate
    // in Remembered Stories). Recording the pick locally is enough; handleSave
    // does the rest. (H6 + L16: keeping _unsaved/_base64 on `updated` is correct
    // — handleSave needs _base64 for the R2 upload and _unsaved for its guard.)
    if (story._unsaved) {
      setSavingMarker(false);
      return;
    }

    // SAVED story: persist the marker to the cloud stories row so it survives a
    // device switch / reinstall (a new phone rebuilds every pin from the cloud,
    // so a pick that never reached `stories.marker_style` reverts to the book
    // default). cloudUpdate when we have an id, else cloudSave to MINT one for a
    // saved-but-not-yet-cloud-synced story (_needsCloudSync). (`graves.marker_style`
    // below is a SEPARATE table for the global pin — it never backed the per-story map.)
    if (user) {
      // Defense-in-depth: if a saved-public story still has no public_biography
      // (e.g. made public before S62 redaction shipped), redact before this
      // re-write reaches the cloud. No-op when already redacted. Same guard +
      // fail-safe as handleSave / _doTogglePublic.
      if (updated.is_public && !updated.public_biography && updated.biography) {
        try {
          const subjects = Array.isArray(updated.subjects) ? updated.subjects
            : (Array.isArray(updated.graveData?.subjects) ? updated.graveData.subjects : []);
          // INCREMENT 2: strip app-originated names BEFORE the fail-open redactor;
          // desync guard -> safe placeholder if flag set but names absent.
          const _orig = Array.isArray(updated.originatedRelatives) ? updated.originatedRelatives : [];
          if (updated.has_originated_relatives && !_orig.length) {
            updated.public_biography = 'This public biography is being prepared.';
            // Desync fail-safe: blank EVERY raw-served public column, not just bio.
            updated.mentions = [];
            updated.sources = [];
            updated.source_urls = [];
          } else {
            const _stripped = stripOriginatedNamesForPublic(updated.biography, _orig, subjects);
            updated.public_biography = await redactLivingNamesForPublic(_stripped, subjects);
            // `sources`/`source_urls` are served RAW by the public RPC — strip
            // originated names from both (model can author a name into either).
            if (_orig.length) {
              updated.sources = stripOriginatedNamesFromSources(updated.sources, _orig, subjects);
              updated.source_urls = stripOriginatedNamesFromSources(updated.source_urls, _orig, subjects);
            }
            // Mentions public floor: drop a living non-originated name, then strip
            // any app-originated name.
            updated.mentions = filterMentionsForPublic(updated.mentions, subjects);
            if (_orig.length) {
              updated.mentions = stripOriginatedNamesFromMentions(updated.mentions, _orig, subjects);
            }
          }
        } catch (e) {
          console.warn('public_biography redaction skipped on marker-pick update (non-fatal):', e?.message || e);
        }
      }
      const synced = updated.id
        ? await cloudUpdateStory(updated, user)
        : await cloudSaveStory(updated, user);
      setStory(synced);
      updated.id = synced.id; // keep the local ref's id for the stake call below
    }
    // Stake this grave's permanent global-map pin (first-wins, NULL-guarded
    // server-side). No-ops if already staked or the story has no grave_id.
    if (updated.grave_id && user) setGraveMarker(updated.grave_id, styleId);
    setSavingMarker(false);
  }

  async function handleTribute(type) {
    if (!user || !story.grave_id || tributeLoading) return;
    setTributeLoading(true);
    // try/finally so a thrown error can never leave tributeLoading stuck true
    // (which would permanently disable the candle/flower buttons until remount).
    try {
      // Tapping the same type toggles it off; tapping a different type switches
      const newType = tributes.userTribute === type ? null : type;
      await setTribute(story.grave_id, newType);
      // Log only when a tribute is added (not toggled off), so the count tracks engagement.
      if (newType) logEvent(EVENTS.TRIBUTE_LEFT, { type: newType });
      const fresh = await getTributes(story.grave_id);
      setTributes(fresh);
    } catch (e) {
      console.warn('handleTribute failed:', e?.message || e);
    } finally {
      setTributeLoading(false);
    }
  }

  const isUnsaved = !!story._unsaved;
  // The canned first-run example: read-only, never persisted, no ownership/sharing
  // affordances. Suppresses save/delete/public/marker/tributes entirely.
  const isSample = !!story._isSample;
  const showPublicToggle = user && !story._isGlobal && !isUnsaved && !isSample;
  // Marker style: the pin on the user's My-Cemetery map AND, for the first
  // public scanner of a grave, that grave's permanent global-map marker. Shown
  // BEFORE save too (with GPS) so the choice can stake the grave on creation
  // (find_or_create_grave INSERT branch). While unsaved the pick is local-only;
  // handleSave persists it. Needs a location to be meaningful.
  const showMarkerChip = !story._isGlobal && !isSample
    && (isUnsaved ? !!story.gps : (story.gps || story.location));
  const currentMarker = getMarker(story.marker_style);
  const isPublic = story.is_public;
  const hasTappableSymbol = symbols.some(s => symbolMeaning(s) !== null);
  // Real bio (not sample/template) → show the small persistent AI caption.
  const showAiCaption = !isSample && !story._pending && (biography || '').trim();

  function dismissAiModal() {
    setAiModal(false);
    AsyncStorage.setItem(AI_DISCLAIMER_SEEN_KEY, 'true').catch(() => {});
  }

  function openReportModal() {
    setReportReason(null);
    setReportNote('');
    setReportDone(false);
    setReportSending(false);
    setReportModal(true);
  }

  async function handleSubmitReport() {
    if (!reportReason || reportSending) return;
    setReportSending(true);
    const ok = await submitContentReport({
      storyTs: story.timestamp,
      graveId: story.grave_id || null,
      personName: name || story.primary_name || null,
      reason: reportReason,
      note: reportNote,
      isPublic: !!(story.is_public || story._isGlobal),
    });
    setReportSending(false);
    if (ok) {
      setReportDone(true);
    } else {
      Alert.alert('Could not send report', 'Please check your connection and try again.');
    }
  }

  function handleBack() {
    if (isUnsaved && !saving) {
      Alert.alert(
        'Discard this story?',
        'You haven\'t saved this story yet. Leaving now will discard it.',
        [
          { text: 'Keep editing', style: 'cancel' },
          { text: 'Discard', style: 'destructive', onPress: () => navigation.goBack() },
        ]
      );
      return;
    }
    navigation.goBack();
  }

  // Home shortcut. Mirrors handleBack's unsaved-discard guard so the one-tap
  // jump to Home can't silently drop an unsaved story — only the destination
  // differs (navigate to Home vs goBack one step). navigate('Home') pops back
  // to the existing Home screen in the stack rather than pushing a duplicate.
  function handleHome() {
    if (isUnsaved && !saving) {
      Alert.alert(
        'Discard this story?',
        'You haven\'t saved this story yet. Leaving now will discard it.',
        [
          { text: 'Keep editing', style: 'cancel' },
          { text: 'Discard', style: 'destructive', onPress: () => navigation.navigate('Home') },
        ]
      );
      return;
    }
    navigation.navigate('Home');
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.headerRow}>
        <TouchableOpacity
          onPress={handleBack}
          style={styles.back}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>

        {/* Home shortcut — the result page can be reached several screens deep
            (scan → result, map → result), so offer a one-tap return to Home
            alongside the single-step Back. handleHome routes to Home but goes
            through the same unsaved-discard confirmation as Back so an unsaved
            story is never silently dropped. */}
        <TouchableOpacity
          onPress={handleHome}
          style={styles.home}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Go to home screen"
        >
          <Text style={styles.backText}>Home</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={refreshControl}
      >

        {/* Image carousel — gravestone photo + portrait images */}
        {carouselImages.length > 0 && (
          <View style={styles.carouselOuter}>
            <FlatList
              data={carouselImages}
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              keyExtractor={(_, i) => String(i)}
              renderItem={({ item }) => (
                <View style={styles.carouselSlide}>
                  <Image source={item.asset ? item.asset : imgSource(item.uri)} style={styles.carouselImage} resizeMode="contain" />
                  <View style={styles.carouselLabelBadge}>
                    <Text style={styles.carouselLabelText}>{item.label}</Text>
                  </View>
                </View>
              )}
              onMomentumScrollEnd={e => {
                setCarouselIndex(Math.round(e.nativeEvent.contentOffset.x / SCREEN_W));
              }}
            />
            {carouselImages.length > 1 && (
              <View style={styles.dots}>
                {carouselImages.map((_, i) => (
                  <View key={i} style={[styles.dot, i === carouselIndex && styles.dotActive]} />
                ))}
              </View>
            )}
          </View>
        )}

        {/* Example banner — makes it unmistakable this is a demo, not a real scan */}
        {isSample && (
          <View style={styles.sampleBanner}>
            <Text style={styles.sampleBannerText}>
              ✦ Example story — this is what GraveStory creates from a single photo
            </Text>
          </View>
        )}

        {/* Header — memorial identity block */}
        <Text style={styles.name}>{name || 'Unknown'}</Text>
        {!!dates && (
          <View style={styles.datesRow}>
            <View style={styles.datesRule} />
            <Text style={styles.datesText}>{dates}</Text>
          </View>
        )}
        {!!location && (
          <View style={styles.locationRow}>
            <Pin size={13} color={colors.ashDim} />
            <Text style={styles.location}>{location}</Text>
          </View>
        )}
        {story._isGlobal && (
          <Text style={styles.contributorLine}>Shared by {story._contributor || 'Anonymous'}</Text>
        )}

        <View style={styles.divider} />

        {/* Biography */}
        {paragraphs.length > 0 && (
          <View style={styles.sectionHeading}>
            <Text style={styles.sectionHeadingText}>Life Story</Text>
            <View style={styles.sectionHeadingRule} />
          </View>
        )}
        {/* Read-aloud — narrates the name, dates, and bio via on-device TTS.
            Only shown when there's actual bio prose to read. */}
        {paragraphs.length > 0 && speakableText !== '' && (
          <TouchableOpacity
            style={[styles.listenBtn, isSpeaking && styles.listenBtnActive]}
            onPress={handleListen}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel={isSpeaking ? 'Stop reading the story aloud' : 'Read the story aloud'}
          >
            <Text style={styles.listenBtnIcon}>
              {isSpeaking ? '◼' : '▶'}
            </Text>
            <Text style={styles.listenBtnText}>
              {isSpeaking ? 'Stop' : 'Listen to this story'}
            </Text>
          </TouchableOpacity>
        )}
        {paragraphs.map((para, i) => (
          <Text key={i} style={[styles.bio, i === 0 && styles.bioFirst]}>{para}</Text>
        ))}

        {/* AI-honesty caption — small, calm note beneath every generated bio.
            Honest-research register; first view also triggers the explainer
            modal below. Suppressed for the sample / unresearched template. */}
        {showAiCaption && (
          <View style={styles.aiCaption}>
            <Text style={styles.aiCaptionText}>
              ✦ AI-generated story — researched from public records. It may contain errors and is not an official record.{' '}
              <Text style={styles.aiReportLink} onPress={openReportModal}>Report a problem</Text>
            </Text>
          </View>
        )}

        {/* Inscription */}
        {!!graveData?.inscription && (
          <View style={styles.inscriptionBox}>
            <Text style={styles.inscriptionLabel}>Inscription</Text>
            <Text style={styles.inscriptionText}>"{graveData.inscription}"</Text>
          </View>
        )}

        {/* Symbols */}
        {symbols.length > 0 && (
          <View style={styles.sectionHeading}>
            <Text style={styles.sectionHeadingText}>Symbols on the Stone</Text>
            <View style={styles.sectionHeadingRule} />
          </View>
        )}
        {hasTappableSymbol && (
          <Text style={styles.symbolsHint}>Tap a gold symbol to learn its traditional meaning.</Text>
        )}
        {symbols.length > 0 && (
          <View style={styles.tagsRow}>
            {symbols.map((s, i) => {
              const contextText = symbolMeaning(s);
              return contextText ? (
                <TouchableOpacity
                  key={i}
                  style={[styles.tag, styles.tagTappable]}
                  onPress={() => setSymbolModal({ name: s, text: contextText })}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.tagText, styles.tagTextTappable]}>{s} ›</Text>
                </TouchableOpacity>
              ) : (
                <View key={i} style={styles.tag}>
                  <Text style={styles.tagText}>{s}</Text>
                </View>
              );
            })}
          </View>
        )}

        {/* Sources */}
        {sources.length > 0 && (
          <View style={styles.sourcesSection}>
            <View style={styles.sectionHeading}>
              <Text style={styles.sectionHeadingText}>Sources & Research</Text>
              <View style={styles.sectionHeadingRule} />
            </View>
            {sources.map((src, i) => (
              <TouchableOpacity
                key={i}
                style={styles.sourceRow}
                onPress={() => source_urls[i] && Linking.openURL(source_urls[i])}
                disabled={!source_urls[i]}
                activeOpacity={0.7}
              >
                <Text style={styles.sourceNum}>{i + 1}</Text>
                <Text style={[styles.sourceItem, source_urls[i] && styles.sourceLink]}>
                  {src}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Mentions — one chip opening a sheet of name-safe source hyperlinks.
            Shows on the owner's story AND on public/global stories (outbound links). */}
        {mentions.length > 0 && (
          <View style={styles.tagsRow}>
            <TouchableOpacity
              style={[styles.tag, styles.tagTappable]}
              onPress={() => setMentionsModal(true)}
              activeOpacity={0.7}
            >
              <Text style={[styles.tagText, styles.tagTextTappable]}>Also found in… ›</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Tributes */}
        {story.grave_id && !isUnsaved && (
          <View style={styles.tributeSection}>
            <Text style={styles.tributeLabel}>Tributes at this grave</Text>
            <View style={styles.tributeCounts}>
              <Text style={styles.tributeCountText}>
                {tributes.candles} {tributes.candles === 1 ? 'candle' : 'candles'}
              </Text>
              <Text style={styles.tributeSep}>·</Text>
              <Text style={styles.tributeCountText}>
                {tributes.flowers} {tributes.flowers === 1 ? 'flower' : 'flowers'}
              </Text>
            </View>
            {story.source === 'camera' && !story._isGlobal && user && (
              <View style={styles.tributeButtons}>
                <TouchableOpacity
                  style={[styles.tributeBtn, tributes.userTribute === 'candle' && styles.tributeBtnActive]}
                  onPress={() => handleTribute('candle')}
                  disabled={tributeLoading}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.tributeBtnText, tributes.userTribute === 'candle' && styles.tributeBtnTextActive]}>
                    {tributes.userTribute === 'candle' ? '✓ Candle left' : 'Leave a candle'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.tributeBtn, tributes.userTribute === 'flower' && styles.tributeBtnActive]}
                  onPress={() => handleTribute('flower')}
                  disabled={tributeLoading}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.tributeBtnText, tributes.userTribute === 'flower' && styles.tributeBtnTextActive]}>
                    {tributes.userTribute === 'flower' ? '✓ Flower left' : 'Leave a flower'}
                  </Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
        )}

        {/* Save (unsaved stories only) — primary action */}
        {isUnsaved && (
          <>
            <Text style={styles.unsavedHint}>
              This story isn't saved yet — saving keeps it in Remembered Stories and pins it on your map.
            </Text>
            <TouchableOpacity
              style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
              onPress={handleSave}
              disabled={saving}
              activeOpacity={0.85}
            >
              <Text style={styles.saveBtnText}>{saving ? 'Saving…' : 'Save Story'}</Text>
            </TouchableOpacity>
          </>
        )}

        {/* Action chips */}
        <View style={styles.chipsRow}>
          {(story.gps || story.location) && (
            <TouchableOpacity
              style={styles.chip}
              onPress={() => navigation.navigate('CemeteryMap', { focusStory: story })}
              activeOpacity={0.7}
            >
              <MapStack size={18} color={colors.flame} />
              <Text style={styles.chipText}>Map</Text>
            </TouchableOpacity>
          )}
          {showMarkerChip && (
            <TouchableOpacity
              style={[styles.chip, savingMarker && styles.chipDisabled]}
              onPress={() => { setMarkerPack(currentMarker.pack || MARKER_PACKS[0].id); setMarkerModal(true); }}
              disabled={savingMarker}
              activeOpacity={0.7}
            >
              <GraveMarkerSvg styleId={story.marker_style} size={18} />
              <Text style={styles.chipText}>{savingMarker ? '…' : 'Marker'}</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={[styles.chip, sharing && styles.chipDisabled]}
            onPress={handleShare}
            disabled={sharing}
            activeOpacity={0.7}
          >
            <ShareIcon size={18} color={colors.flame} />
            <Text style={styles.chipText}>{sharing ? '…' : 'Share'}</Text>
          </TouchableOpacity>
          {showPublicToggle && (
            <TouchableOpacity
              style={[styles.chip, isPublic && styles.chipActive, togglingPublic && styles.chipDisabled]}
              onPress={handleTogglePublic}
              disabled={togglingPublic}
              activeOpacity={0.7}
            >
              <Globe size={18} color={isPublic ? colors.silver : colors.flame} />
              <Text style={[styles.chipText, isPublic && { color: colors.silver }]}>
                {togglingPublic ? '…' : isPublic ? 'Public' : 'Private'}
              </Text>
            </TouchableOpacity>
          )}
        </View>

        {showPublicToggle && !isPublic && (
          <Text style={styles.chipsHint}>
            Tap Private to make this story Public — it joins the Community Map for other visitors to discover.
          </Text>
        )}

        {/* GEDCOM export — owner-only (hidden on global/sample). A full-width
            secondary button rather than a 5th chip (the chips row is already
            cramped on narrow phones). */}
        {!story._isGlobal && !isSample && (
          <TouchableOpacity
            style={[styles.exportBtn, exporting && styles.chipDisabled]}
            onPress={handleExport}
            disabled={exporting}
            activeOpacity={0.7}
          >
            <TreeIcon size={18} color={colors.ash} />
            <Text style={styles.exportBtnText}>
              {exporting ? 'Saving…' : 'Save family-tree file (GEDCOM)'}
            </Text>
          </TouchableOpacity>
        )}

        {/* Scan another (sample shows it as the primary next step) */}
        <TouchableOpacity
          style={isSample ? styles.saveBtn : styles.scanAgainBtn}
          onPress={() => navigation.navigate('Camera')}
          activeOpacity={isSample ? 0.85 : 0.7}
        >
          <Text style={isSample ? styles.saveBtnText : styles.scanAgainText}>
            {isSample ? 'Scan Your First Gravestone' : 'Scan Another Gravestone'}
          </Text>
        </TouchableOpacity>

        {/* Delete (saved) / Discard (unsaved) — never for the read-only sample */}
        {!story._isGlobal && !isSample && (
          <TouchableOpacity
            style={styles.deleteBtn}
            onPress={isUnsaved ? () => navigation.navigate('Home') : handleDelete}
            activeOpacity={0.7}
          >
            <Text style={styles.deleteBtnText}>{isUnsaved ? 'Discard' : 'Delete Story'}</Text>
          </TouchableOpacity>
        )}
      </ScrollView>

      {/* Marker style picker */}
      <Modal
        visible={markerModal}
        transparent
        animationType="slide"
        onRequestClose={() => setMarkerModal(false)}
      >
        <Pressable style={styles.symbolOverlay} onPress={() => setMarkerModal(false)}>
          <Pressable style={[styles.markerSheet, { paddingBottom: insets.bottom + 28 }]} onPress={() => {}}>
            <SwipeHandle onClose={() => setMarkerModal(false)} />
            <Text style={styles.symbolSheetName}>Choose a marker</Text>
            <Text style={styles.markerSheetHint}>
              {isUnsaved
                ? 'Your pin for this grave on your Cemetery map. The first person to share a grave publicly picks the marker that appears on the community map — so if you’re first to share it, this stone stays there for good.'
                : 'How this grave appears on your Cemetery map. The first person to share a grave publicly picks the marker shown on the community map — if that was you, this is the stone everyone sees there.'}
            </Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.markerTabRow}
              contentContainerStyle={styles.markerTabRowContent}
            >
              {MARKER_PACKS.map(p => {
                const on = p.id === markerPack;
                return (
                  <TouchableOpacity
                    key={p.id}
                    style={[styles.markerTab, on && styles.markerTabActive]}
                    onPress={() => setMarkerPack(p.id)}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.markerTabText, on && styles.markerTabTextActive]}>{p.label}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            <ScrollView
              style={styles.markerGridScroll}
              contentContainerStyle={styles.markerGrid}
              showsVerticalScrollIndicator={false}
            >
              {MARKER_STYLES.filter(m => m.pack === markerPack).map(m => {
                const selected = currentMarker.id === m.id;
                return (
                  <TouchableOpacity
                    key={m.id}
                    style={[styles.markerCell, selected && styles.markerCellSelected]}
                    onPress={() => handlePickMarker(m.id)}
                    activeOpacity={0.7}
                  >
                    <GraveMarkerSvg styleId={m.id} size={44} />
                    <Text
                      style={[styles.markerCellLabel, selected && styles.markerCellLabelSelected]}
                      numberOfLines={1}
                    >
                      {m.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            <TouchableOpacity style={styles.symbolSheetClose} onPress={() => setMarkerModal(false)} activeOpacity={0.7}>
              <Text style={styles.symbolSheetCloseText}>Close</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Symbol info modal */}
      <Modal
        visible={!!symbolModal}
        transparent
        animationType="slide"
        onRequestClose={() => setSymbolModal(null)}
      >
        <Pressable style={styles.symbolOverlay} onPress={() => setSymbolModal(null)}>
          <Pressable style={[styles.symbolSheet, { paddingBottom: insets.bottom + 36 }]} onPress={() => {}}>
            <SwipeHandle onClose={() => setSymbolModal(null)} />
            <Text style={styles.symbolSheetName}>{symbolModal?.name}</Text>
            <Text style={styles.symbolSheetText}>{symbolModal?.text}</Text>
            <TouchableOpacity style={styles.symbolSheetClose} onPress={() => setSymbolModal(null)} activeOpacity={0.7}>
              <Text style={styles.symbolSheetCloseText}>Close</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Mentions sheet — name-safe one-line source hyperlinks. Each sentence is
          the tappable link; a hit with an unusable URL (link-rot) renders as a
          non-tappable line but still reads. */}
      <Modal
        visible={mentionsModal}
        transparent
        animationType="slide"
        onRequestClose={() => setMentionsModal(false)}
      >
        <Pressable style={styles.symbolOverlay} onPress={() => setMentionsModal(false)}>
          <Pressable style={[styles.symbolSheet, { paddingBottom: insets.bottom + 36 }]} onPress={() => {}}>
            <SwipeHandle onClose={() => setMentionsModal(false)} />
            <Text style={styles.symbolSheetName}>Also found in…</Text>
            {mentions.map((m, i) => {
              const ok = typeof m.url === 'string' && /^https?:\/\//i.test(m.url);
              return (
                <TouchableOpacity
                  key={i}
                  style={styles.mentionRow}
                  onPress={() => ok && Linking.openURL(m.url)}
                  disabled={!ok}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.mentionLine, ok && styles.mentionLink]}>{m.sentence}</Text>
                </TouchableOpacity>
              );
            })}
            <TouchableOpacity style={styles.symbolSheetClose} onPress={() => setMentionsModal(false)} activeOpacity={0.7}>
              <Text style={styles.symbolSheetCloseText}>Close</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      {/* First-view AI-disclaimer explainer — shown once, ever. */}
      <Modal
        visible={aiModal}
        transparent
        animationType="slide"
        onRequestClose={dismissAiModal}
      >
        <Pressable style={styles.symbolOverlay} onPress={dismissAiModal}>
          <Pressable style={[styles.symbolSheet, { paddingBottom: insets.bottom + 36 }]} onPress={() => {}}>
            <SwipeHandle onClose={dismissAiModal} />
            <Text style={styles.symbolSheetName}>About these stories</Text>
            <Text style={styles.symbolSheetText}>
              GraveStory assembles each biography with AI from public records and historical
              sources. It's a thoughtful starting point for remembrance and research — but it can
              contain errors and is not an official or authoritative record. If you spot something
              wrong, you can report it.
            </Text>
            <TouchableOpacity style={styles.symbolSheetClose} onPress={dismissAiModal} activeOpacity={0.7}>
              <Text style={styles.symbolSheetCloseText}>I understand</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Post-save reminder: place your pin precisely on the map. Shown after
          every save until the user ticks "Don't show this again". */}
      <Modal
        visible={pinReminderModal}
        transparent
        animationType="slide"
        onRequestClose={dismissPinReminder}
      >
        <Pressable style={styles.symbolOverlay} onPress={dismissPinReminder}>
          <Pressable style={[styles.symbolSheet, { paddingBottom: insets.bottom + 36 }]} onPress={() => {}}>
            <SwipeHandle onClose={dismissPinReminder} />
            <Text style={styles.symbolSheetName}>Place your pin on the map</Text>
            <Text style={styles.symbolSheetText}>
              Saved. GPS can be off by 10–30 metres — more under tree cover — so this
              grave's pin may not sit exactly on the spot. Open your map, then press
              and hold the marker and drag it onto the exact grave so your pins stay
              easy to tell apart.
            </Text>
            <TouchableOpacity
              style={styles.pinReminderCheckRow}
              onPress={() => setPinReminderDontShow(v => !v)}
              activeOpacity={0.7}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: pinReminderDontShow }}
              accessibilityLabel="Don't show this again"
            >
              <View style={[styles.pinReminderCheckbox, pinReminderDontShow && styles.pinReminderCheckboxOn]}>
                {pinReminderDontShow && <Text style={styles.pinReminderCheckMark}>✓</Text>}
              </View>
              <Text style={styles.pinReminderCheckLabel}>Don't show this again</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.symbolSheetClose} onPress={dismissPinReminder} activeOpacity={0.7}>
              <Text style={styles.symbolSheetCloseText}>OK</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Report a problem sheet */}
      <Modal
        visible={reportModal}
        transparent
        animationType="slide"
        onRequestClose={() => setReportModal(false)}
      >
        <Pressable style={styles.symbolOverlay} onPress={() => setReportModal(false)}>
          <Pressable style={[styles.symbolSheet, { paddingBottom: insets.bottom + 36 }]} onPress={() => {}}>
            <SwipeHandle onClose={() => setReportModal(false)} />
            {reportDone ? (
              <>
                <Text style={styles.symbolSheetName}>Thank you</Text>
                <Text style={styles.symbolSheetText}>
                  Your report has been sent. We review flagged stories and will take a look.
                </Text>
                <TouchableOpacity style={styles.symbolSheetClose} onPress={() => setReportModal(false)} activeOpacity={0.7}>
                  <Text style={styles.symbolSheetCloseText}>Done</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <Text style={styles.symbolSheetName}>Report a problem</Text>
                <Text style={styles.reportSub}>
                  Thanks for helping keep these stories accurate and respectful. What's wrong?
                </Text>
                <View style={styles.reportReasons}>
                  {REPORT_REASONS.map(r => {
                    const sel = reportReason === r.id;
                    return (
                      <TouchableOpacity
                        key={r.id}
                        style={[styles.reportChip, sel && styles.reportChipSel]}
                        onPress={() => setReportReason(r.id)}
                        activeOpacity={0.7}
                      >
                        <Text style={[styles.reportChipText, sel && styles.reportChipTextSel]}>{r.label}</Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
                <TextInput
                  style={styles.reportNote}
                  placeholder="Add any details (optional)"
                  placeholderTextColor={colors.ashDim}
                  value={reportNote}
                  onChangeText={setReportNote}
                  multiline
                  maxLength={REPORT_NOTE_MAX}
                />
                <View style={styles.reportActions}>
                  <TouchableOpacity style={styles.reportCancel} onPress={() => setReportModal(false)} activeOpacity={0.7}>
                    <Text style={styles.reportCancelText}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.reportSubmit, (!reportReason || reportSending) && styles.reportSubmitDisabled]}
                    onPress={handleSubmitReport}
                    disabled={!reportReason || reportSending}
                    activeOpacity={0.85}
                  >
                    <Text style={styles.reportSubmitText}>{reportSending ? 'Sending…' : 'Send report'}</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </Pressable>
        </Pressable>
      </Modal>

      {/* First-share public notice — shown once, before the first time a user
          makes any story public. */}
      <Modal
        visible={shareNoticeModal}
        transparent
        animationType="slide"
        onRequestClose={() => setShareNoticeModal(false)}
      >
        <Pressable style={styles.symbolOverlay} onPress={() => setShareNoticeModal(false)}>
          <Pressable style={[styles.symbolSheet, { paddingBottom: insets.bottom + 36 }]} onPress={() => {}}>
            <SwipeHandle onClose={() => setShareNoticeModal(false)} />
            <Text style={styles.symbolSheetName}>Sharing publicly</Text>
            <Text style={styles.symbolSheetText}>
              Public stories appear on the community map for anyone to see — including the
              biography, photo, name, dates, and approximate location — and they may name other
              people. Only share stories you're comfortable making public, and please don't share
              private details about living people. You can make a story private again at any time.
            </Text>
            <View style={styles.reportActions}>
              <TouchableOpacity style={styles.reportCancel} onPress={() => setShareNoticeModal(false)} activeOpacity={0.7}>
                <Text style={styles.reportCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.reportSubmit} onPress={acceptShareNotice} activeOpacity={0.85}>
                <Text style={styles.reportSubmitText}>Share publicly</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.ink },
  // Back (left) + Home (right) share one row. Each button keeps its own 24px
  // padding so the tap targets stay generous and the labels sit at the screen
  // edges; the row only adds the flex distribution.
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  back: { padding: 24, paddingBottom: 0 },
  home: { padding: 24, paddingBottom: 0 },
  backText: { color: colors.ashDim, fontSize: 15, fontFamily: fonts.body },
  scroll: { padding: 24, paddingTop: 12, paddingBottom: 48 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyText: { color: colors.ash, fontFamily: fonts.bodyItalic },

  // Break out of the 24px horizontal padding so carousel spans full screen width
  carouselOuter: { marginHorizontal: -24, marginBottom: 24 },
  carouselSlide: { width: SCREEN_W, height: 320, position: 'relative', backgroundColor: colors.ink },
  carouselImage: { width: SCREEN_W, height: 320 },
  carouselLabelBadge: {
    position: 'absolute', bottom: 10, left: 12,
    backgroundColor: 'rgba(20,16,11,0.72)',
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: 4,
  },
  carouselLabelText: { color: colors.ash, fontSize: 11, fontFamily: fonts.body, letterSpacing: 0.5 },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 6, marginTop: 10 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.line },
  dotActive: { backgroundColor: colors.flame },

  sampleBanner: {
    backgroundColor: 'rgba(242,182,92,0.1)',
    borderWidth: 1, borderColor: 'rgba(242,182,92,0.3)',
    borderRadius: radius.sm, paddingVertical: 10, paddingHorizontal: 14,
    marginBottom: 16,
  },
  sampleBannerText: {
    color: colors.flame, fontFamily: fonts.bodyItalic, fontSize: 12,
    lineHeight: 17, textAlign: 'center',
  },

  name: {
    color: colors.parchment, fontSize: 31, fontFamily: fonts.title,
    marginBottom: 10, lineHeight: 36, letterSpacing: -0.3,
  },
  // Dates sit under the name with a short gold rule leading in — reads as an
  // engraved lifespan line rather than a loose subtitle.
  datesRow: { flexDirection: 'row', alignItems: 'center', gap: 9, marginBottom: 9 },
  datesRule: { width: 22, height: 1.5, backgroundColor: colors.flame, opacity: 0.7 },
  datesText: { color: colors.flame, fontSize: 14.5, fontFamily: fonts.serifItalic, letterSpacing: 0.4 },
  locationRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 4 },
  location: { color: colors.ash, fontSize: 13, fontFamily: fonts.body, letterSpacing: 0.4 },
  contributorLine: { color: colors.silver, fontSize: 12, fontFamily: fonts.bodyItalic, marginTop: 6 },

  divider: { height: 1, backgroundColor: colors.line, marginVertical: 22 },

  // Shared titled-section eyebrow: small uppercase label + trailing hairline
  // rule. Gives the bio, symbols, and sources the same scholarly section
  // header so the page reads as one composed document, not stacked blocks.
  sectionHeading: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14, marginTop: 4 },
  sectionHeadingText: {
    color: colors.flame, fontSize: 11, letterSpacing: 2.5,
    textTransform: 'uppercase', fontFamily: fonts.sansBold, opacity: 0.85,
  },
  sectionHeadingRule: { flex: 1, height: 1, backgroundColor: colors.line },

  bio: {
    color: '#e3d6c0', lineHeight: 27, fontSize: 15, marginBottom: 15,
    fontFamily: fonts.serif,
  },
  bioFirst: { fontSize: 16.5, lineHeight: 29, color: colors.parchment },

  // Read-aloud control — sits under the Life Story heading. A quiet gold-tinted
  // pill (matches the symbol-chip/tribute language); turns into a "Stop" state
  // with the active gold fill while narrating.
  listenBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start',
    paddingVertical: 9, paddingHorizontal: 14, marginBottom: 18,
    borderWidth: 1, borderColor: 'rgba(242,182,92,0.35)',
    backgroundColor: 'rgba(242,182,92,0.07)', borderRadius: radius.md,
  },
  listenBtnActive: { borderColor: colors.flame, backgroundColor: 'rgba(242,182,92,0.16)' },
  listenBtnIcon: { color: colors.flame, fontSize: 12, lineHeight: 16 },
  listenBtnText: { color: colors.flame, fontSize: 13.5, fontFamily: fonts.bodyMedium, letterSpacing: 0.3 },

  // AI-honesty caption — muted gold, honest-research register (not a warning).
  aiCaption: {
    borderLeftWidth: 2,
    borderLeftColor: 'rgba(242,182,92,0.45)',
    backgroundColor: 'rgba(242,182,92,0.06)',
    paddingLeft: 12,
    paddingRight: 10,
    paddingVertical: 8,
    borderRadius: 4,
    marginTop: 4,
    marginBottom: 18,
  },
  aiCaptionText: {
    color: '#b89656',
    fontSize: 12.5,
    lineHeight: 18,
    fontFamily: fonts.bodyItalic,
    fontStyle: 'italic',
  },
  aiReportLink: {
    color: colors.flame,
    textDecorationLine: 'underline',
  },

  inscriptionBox: {
    borderLeftWidth: 2, borderLeftColor: colors.flame,
    paddingLeft: 14, marginVertical: 20, paddingVertical: 12, paddingRight: 12,
    backgroundColor: colors.stone2, borderRadius: radius.sm,
  },
  inscriptionLabel: {
    color: colors.flame, fontSize: 10, letterSpacing: 3,
    textTransform: 'uppercase', fontFamily: fonts.body, marginBottom: 6,
  },
  inscriptionText: { color: colors.parchment, fontFamily: fonts.serifItalic, lineHeight: 22, fontSize: 14 },

  symbolsHint: {
    color: colors.ashDim, fontSize: 12, fontFamily: fonts.bodyItalic,
    marginBottom: 10, lineHeight: 17,
  },
  tagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 },
  tag: {
    borderWidth: 1, borderColor: colors.line, backgroundColor: colors.stone2,
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: radius.sm,
  },
  tagText: { color: colors.ash, fontSize: 12, fontFamily: fonts.body },

  sourcesSection: { marginTop: 4, marginBottom: 24 },
  // Numbered citation row: a small gold index badge + the source text, so the
  // list reads as a reference apparatus rather than loose bracketed lines.
  sourceRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 9, marginBottom: 9 },
  sourceNum: {
    color: colors.flame, fontSize: 11, fontFamily: fonts.sansBold,
    minWidth: 16, lineHeight: 19, textAlign: 'right', opacity: 0.85,
  },
  sourceItem: { flex: 1, color: colors.ash, fontSize: 12.5, fontFamily: fonts.body, lineHeight: 19 },
  sourceLink: { color: colors.flame, textDecorationLine: 'underline' },

  // Mentions sheet rows — one sentence per row; the whole sentence is the link.
  mentionRow: {
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  mentionLine: { color: colors.parchment, fontFamily: fonts.serif, fontSize: 14.5, lineHeight: 21 },
  mentionLink: { color: colors.flame, textDecorationLine: 'underline' },

  chipsRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  chipsHint: {
    color: colors.ashDim, fontSize: 12, fontFamily: fonts.bodyItalic,
    textAlign: 'center', marginTop: -6, marginBottom: 16, lineHeight: 17,
  },
  chip: {
    flex: 1, flexDirection: 'column', alignItems: 'center', gap: 5,
    paddingVertical: 12, paddingHorizontal: 4,
    backgroundColor: colors.stone2, borderWidth: 1, borderColor: colors.line,
    borderRadius: radius.sm,
  },
  chipActive: { borderColor: 'rgba(170,190,220,0.4)', backgroundColor: 'rgba(170,190,220,0.08)' },
  chipDisabled: { opacity: 0.5 },
  chipText: { color: colors.ash, fontSize: 11, fontFamily: fonts.body },

  unsavedHint: {
    color: colors.ash, fontSize: 12, fontFamily: fonts.bodyItalic,
    textAlign: 'center', marginBottom: 10, lineHeight: 17,
  },
  saveBtn: {
    backgroundColor: colors.flame,
    paddingVertical: 16, borderRadius: radius.sm, marginBottom: 16, alignItems: 'center',
  },
  saveBtnDisabled: { opacity: 0.6 },
  saveBtnText: { color: colors.onFlame, fontFamily: fonts.sansBold, letterSpacing: 0.5, fontSize: 15 },

  scanAgainBtn: {
    borderWidth: 1, borderColor: colors.line, backgroundColor: colors.stone2,
    paddingVertical: 15, borderRadius: radius.sm, marginBottom: 10, alignItems: 'center',
  },
  scanAgainText: { color: colors.ash, fontFamily: fonts.body, letterSpacing: 0.5 },

  exportBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    borderWidth: 1, borderColor: colors.line, backgroundColor: colors.stone2,
    paddingVertical: 14, borderRadius: radius.sm, marginBottom: 16,
  },
  exportBtnText: { color: colors.ash, fontFamily: fonts.body, letterSpacing: 0.5, fontSize: 14 },

  deleteBtn: {
    borderWidth: 1, borderColor: colors.dangerDim,
    paddingVertical: 14, borderRadius: radius.sm, marginBottom: 32,
    backgroundColor: 'rgba(160,60,60,0.06)', alignItems: 'center',
  },
  deleteBtnText: { color: colors.danger, fontFamily: fonts.body, letterSpacing: 0.5, fontSize: 14 },

  tributeSection: {
    marginBottom: 20,
    paddingVertical: 16, paddingHorizontal: 14,
    backgroundColor: colors.stone2,
    borderWidth: 1, borderColor: colors.line,
    borderRadius: radius.sm,
  },
  tributeLabel: {
    color: colors.ashDim, fontSize: 10, letterSpacing: 3,
    textTransform: 'uppercase', fontFamily: fonts.body, marginBottom: 10,
  },
  tributeCounts: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  tributeCountText: { color: colors.parchment, fontSize: 14, fontFamily: fonts.name },
  tributeSep: { color: colors.ashDim, fontSize: 14, fontFamily: fonts.body },
  tributeButtons: { flexDirection: 'row', gap: 10 },
  tributeBtn: {
    flex: 1, paddingVertical: 11, alignItems: 'center',
    borderWidth: 1, borderColor: 'rgba(201,168,76,0.3)',
    borderRadius: radius.sm,
  },
  tributeBtnActive: {
    borderColor: colors.flame,
    backgroundColor: 'rgba(201,168,76,0.1)',
  },
  tributeBtnText: { color: colors.ash, fontFamily: fonts.body, fontSize: 13, letterSpacing: 0.3 },
  tributeBtnTextActive: { color: colors.flame },

  tagTappable: { borderColor: 'rgba(201,168,76,0.35)', backgroundColor: 'rgba(201,168,76,0.07)' },
  tagTextTappable: { color: colors.flame },

  symbolOverlay: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  symbolSheet: {
    backgroundColor: colors.stone, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingHorizontal: 24, paddingTop: 12, paddingBottom: 36,
  },
  // Visible grab-bar pill. The surrounding sheetHandleHit gives it a tall,
  // full-width drag/tap target so the swipe-to-close gesture is easy to grab.
  sheetHandleHit: {
    alignSelf: 'stretch', alignItems: 'center',
    paddingTop: 4, paddingBottom: 16, marginTop: -8,
  },
  symbolSheetHandle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: colors.line,
  },
  symbolSheetName: {
    color: colors.flame, fontSize: 18, fontFamily: fonts.name,
    marginBottom: 12, textTransform: 'capitalize',
  },
  symbolSheetText: {
    color: colors.parchment, fontSize: 14, fontFamily: fonts.serif,
    lineHeight: 22,
  },
  symbolSheetClose: {
    marginTop: 24, alignSelf: 'center',
    paddingVertical: 12, paddingHorizontal: 32,
    backgroundColor: colors.stone2, borderRadius: radius.md,
    borderWidth: 1, borderColor: colors.line,
  },
  symbolSheetCloseText: { color: colors.ash, fontFamily: fonts.body, fontSize: 14 },

  // Post-save "place your pin" reminder — "don't show again" checkbox row
  pinReminderCheckRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    marginTop: 18, alignSelf: 'flex-start',
    paddingVertical: 4,
  },
  pinReminderCheckbox: {
    width: 22, height: 22, borderRadius: 6,
    borderWidth: 1.5, borderColor: colors.line,
    backgroundColor: colors.stone2,
    alignItems: 'center', justifyContent: 'center',
  },
  pinReminderCheckboxOn: { backgroundColor: colors.flame, borderColor: colors.flame },
  pinReminderCheckMark: { color: colors.onFlame, fontSize: 14, fontWeight: '700', lineHeight: 16 },
  pinReminderCheckLabel: { color: colors.ash, fontFamily: fonts.body, fontSize: 14 },

  // Report-a-problem sheet
  reportSub: {
    color: colors.ash, fontSize: 14, fontFamily: fonts.serif,
    lineHeight: 21, marginBottom: 16,
  },
  reportReasons: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  reportChip: {
    backgroundColor: 'rgba(242,182,92,0.08)',
    borderWidth: 1, borderColor: 'rgba(242,182,92,0.35)',
    borderRadius: 20, paddingVertical: 8, paddingHorizontal: 14,
  },
  reportChipSel: {
    backgroundColor: 'rgba(242,182,92,0.22)', borderColor: colors.flame,
  },
  reportChipText: { color: colors.parchment, fontSize: 13.5, fontFamily: fonts.body },
  reportChipTextSel: { color: '#fff', fontFamily: fonts.bodyMedium },
  reportNote: {
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderWidth: 1, borderColor: 'rgba(242,182,92,0.25)',
    borderRadius: radius.sm, color: colors.parchment,
    fontFamily: fonts.body, fontSize: 14,
    paddingHorizontal: 12, paddingVertical: 10,
    minHeight: 70, textAlignVertical: 'top', marginBottom: 16,
  },
  reportActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10 },
  reportCancel: {
    paddingVertical: 11, paddingHorizontal: 18,
    borderRadius: radius.md, borderWidth: 1, borderColor: colors.line,
  },
  reportCancelText: { color: colors.ash, fontFamily: fonts.body, fontSize: 14 },
  reportSubmit: {
    paddingVertical: 11, paddingHorizontal: 22,
    borderRadius: radius.md, backgroundColor: 'rgba(242,182,92,0.2)',
    borderWidth: 1, borderColor: colors.flame,
  },
  reportSubmitDisabled: { opacity: 0.45 },
  reportSubmitText: { color: '#fff', fontFamily: fonts.bodyMedium, fontSize: 14 },

  markerSheet: {
    backgroundColor: colors.stone, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingHorizontal: 20, paddingTop: 12, paddingBottom: 28,
    maxHeight: '80%',
  },
  markerSheetHint: {
    color: colors.ash, fontSize: 13, fontFamily: fonts.body,
    marginBottom: 14, lineHeight: 18,
  },
  // Let the row size to its content instead of a fixed height — a fixed-height
  // pill inside a horizontal ScrollView clips the tab text's top/bottom on
  // Android. Pinning the text line via a fixed-height inner Text and padding the
  // pill (rather than fighting font metrics) is the established fix.
  markerTabRow: { flexGrow: 0, marginBottom: 14 },
  markerTabRowContent: { gap: 8, paddingRight: 8, paddingVertical: 4, alignItems: 'center' },
  markerTab: {
    paddingHorizontal: 14, paddingVertical: 8,
    borderWidth: 1, borderColor: colors.line, borderRadius: 999,
    backgroundColor: 'transparent',
    alignItems: 'center', justifyContent: 'center',
  },
  markerTabActive: { borderColor: colors.flame, backgroundColor: colors.stone2 },
  markerTabText: {
    color: colors.ash, fontSize: 13, lineHeight: 20, height: 20,
    fontFamily: fonts.bodyMedium, textAlignVertical: 'center',
    includeFontPadding: false,
  },
  markerTabTextActive: { color: colors.flame },
  markerGridScroll: { flexGrow: 0 },
  markerGrid: {
    flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between',
    gap: 0,
  },
  markerCell: {
    width: '23%', aspectRatio: 0.82, marginBottom: 12,
    alignItems: 'center', justifyContent: 'center',
    paddingVertical: 8,
    borderWidth: 1, borderColor: colors.line, borderRadius: radius.sm,
    backgroundColor: colors.stone2,
  },
  markerCellSelected: {
    borderColor: colors.flame,
    backgroundColor: 'rgba(201,168,76,0.1)',
  },
  markerCellLabel: {
    color: colors.ashDim, fontSize: 9, lineHeight: 14, fontFamily: fonts.body,
    marginTop: 4, textAlign: 'center', letterSpacing: 0.2,
  },
  markerCellLabelSelected: { color: colors.flame },
});
