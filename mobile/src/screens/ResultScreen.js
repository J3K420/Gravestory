import React, { useEffect, useState, useRef } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  Linking, Share, Image, Alert, FlatList, Dimensions, Modal, Pressable,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import { loadStories, saveStories } from '../lib/storage';
import { cloudSaveStory, cloudUpdateStory, cloudDeleteStory, findOrCreateGrave, setGraveMarker } from '../lib/sync';
import { uploadGravestoneImage } from '../lib/api-r2';
import { getTributes, setTribute } from '../lib/api-tributes';
import { fetchWikipediaPortraits, normalizePortraits } from '../lib/api-wikipedia';
import { useRefresh } from '../lib/use-refresh';
import { deletePendingPhoto } from '../lib/pending';
import { logEvent, EVENTS } from '../lib/analytics';
import { colors, fonts, radius } from '../lib/theme';
import { MapStack, ShareIcon, Globe } from '../components/Icons';
import { MARKER_STYLES, getMarker, GraveMarkerSvg } from '../components/GraveMarkers';
import { SYMBOL_CONTEXT } from '../lib/biography';

const SCREEN_W = Dimensions.get('window').width;
const AI_DISCLAIMER_SEEN_KEY = 'gs_ai_disclaimer_seen';

export default function ResultScreen({ navigation, route }) {
  const [story, setStory]               = useState(route.params?.story);
  const [user, setUser]                 = useState(null);
  const [sharing, setSharing]           = useState(false);
  const [saving, setSaving]             = useState(false);
  const [togglingPublic, setTogglingPublic] = useState(false);
  const [carouselIndex, setCarouselIndex] = useState(0);
  const [tributes, setTributes]         = useState({ candles: 0, flowers: 0, userTribute: null });
  const [tributeLoading, setTributeLoading] = useState(false);
  const [gravePhotos, setGravePhotos]   = useState([]);
  const [livePortraits, setLivePortraits] = useState([]);
  const [symbolModal, setSymbolModal]   = useState(null); // { name, text }
  const [markerModal, setMarkerModal]   = useState(false);
  const [aiModal, setAiModal]           = useState(false); // first-view AI-disclaimer explainer
  const [savingMarker, setSavingMarker] = useState(false);
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
      getTributes(story.grave_id).then(setTributes);
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

  if (!story) {
    return (
      <SafeAreaView style={styles.container}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.back}>
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
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.back}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <ScrollView contentContainerStyle={styles.scroll}>
          {!!story.photoUri && (
            <View style={styles.carouselOuter}>
              <View style={styles.carouselSlide}>
                <Image source={{ uri: story.photoUri }} style={styles.carouselImage} resizeMode="contain" />
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
          {story.gps && <Text style={styles.location}>✦ Location captured with photo</Text>}

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
          >
            <Text style={styles.saveBtnText}>Run Research</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.deleteBtn} onPress={discardPending}>
            <Text style={styles.deleteBtnText}>Discard</Text>
          </TouchableOpacity>
        </ScrollView>
      </SafeAreaView>
    );
  }

  const { name, dates, biography, sources = [], source_urls = [], location, portraits, graveData, symbol_meanings } = story;
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
    : (localGraveUri ? [{ uri: localGraveUri, label: 'Gravestone' }] : []);

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
    } catch (err) {
      console.warn('Save failed:', err?.message);
      Alert.alert('Save Failed', 'Could not save this story. Please check your connection and try again.');
    } finally {
      setSaving(false);
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

  async function handleTogglePublic() {
    if (!user || story._isGlobal || togglingPublic) return;
    setTogglingPublic(true);
    const updated = { ...story, is_public: !story.is_public };
    const all = await loadStories(user?.id ?? null);
    const idx = all.findIndex(s => s.timestamp === story.timestamp);
    if (idx >= 0) { all[idx] = updated; await saveStories(all, user?.id ?? null); }
    setStory(updated);
    if (updated.id) setStory(await cloudUpdateStory(updated, user));
    if (updated.is_public) logEvent(EVENTS.MADE_PUBLIC, {});
    setTogglingPublic(false);
  }

  async function handlePickMarker(styleId) {
    if (savingMarker) return;
    setMarkerModal(false);
    if ((story.marker_style || 'book') === styleId) return;
    // Record the pick synchronously so a pre-save Save tap sees it (see ref note).
    markerStyleRef.current = styleId;
    setSavingMarker(true);
    const updated = { ...story, marker_style: styleId };
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
    const uid = user?.id ?? null;
    const all = await loadStories(uid);
    const idx = all.findIndex(s => s.timestamp === story.timestamp);
    if (idx >= 0) { all[idx] = updated; await saveStories(all, uid); }
    setStory(updated);
    if (updated.id && user) setStory(await cloudUpdateStory(updated, user));
    // Stake this grave's permanent global-map pin (first-wins, NULL-guarded
    // server-side). No-ops if already staked or the story has no grave_id.
    if (updated.grave_id && user) setGraveMarker(updated.grave_id, styleId);
    setSavingMarker(false);
  }

  async function handleTribute(type) {
    if (!user || !story.grave_id || tributeLoading) return;
    setTributeLoading(true);
    // Tapping the same type toggles it off; tapping a different type switches
    const newType = tributes.userTribute === type ? null : type;
    await setTribute(story.grave_id, newType);
    // Log only when a tribute is added (not toggled off), so the count tracks engagement.
    if (newType) logEvent(EVENTS.TRIBUTE_LEFT, { type: newType });
    const fresh = await getTributes(story.grave_id);
    setTributes(fresh);
    setTributeLoading(false);
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

  return (
    <SafeAreaView style={styles.container}>
      <TouchableOpacity onPress={handleBack} style={styles.back}>
        <Text style={styles.backText}>← Back</Text>
      </TouchableOpacity>

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
                  <Image source={{ uri: item.uri }} style={styles.carouselImage} resizeMode="contain" />
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

        {/* Header */}
        <Text style={styles.name}>{name || 'Unknown'}</Text>
        {!!dates && (
          <View style={styles.datesRow}>
            <Text style={styles.datesText}>{dates}</Text>
          </View>
        )}
        {!!location && <Text style={styles.location}>✦ {location}</Text>}
        {story._isGlobal && (
          <Text style={styles.contributorLine}>Shared by {story._contributor || 'Anonymous'}</Text>
        )}

        <View style={styles.divider} />

        {/* Biography */}
        {paragraphs.map((para, i) => (
          <Text key={i} style={[styles.bio, i === 0 && styles.bioFirst]}>{para}</Text>
        ))}

        {/* AI-honesty caption — small, calm note beneath every generated bio.
            Honest-research register; first view also triggers the explainer
            modal below. Suppressed for the sample / unresearched template. */}
        {showAiCaption && (
          <Text style={styles.aiCaption}>
            ✦ AI-generated story — researched from public records. It may contain errors and is not an official record.
          </Text>
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
          <Text style={styles.symbolsLabel}>Symbols on the stone</Text>
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
            <Text style={styles.sourcesLabel}>Sources</Text>
            {sources.map((src, i) => (
              <TouchableOpacity key={i} onPress={() => source_urls[i] && Linking.openURL(source_urls[i])} disabled={!source_urls[i]}>
                <Text style={[styles.sourceItem, source_urls[i] && styles.sourceLink]}>
                  [{i + 1}] {src}
                </Text>
              </TouchableOpacity>
            ))}
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
                >
                  <Text style={[styles.tributeBtnText, tributes.userTribute === 'candle' && styles.tributeBtnTextActive]}>
                    {tributes.userTribute === 'candle' ? '✓ Candle left' : 'Leave a candle'}
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.tributeBtn, tributes.userTribute === 'flower' && styles.tributeBtnActive]}
                  onPress={() => handleTribute('flower')}
                  disabled={tributeLoading}
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
            >
              <MapStack size={18} color={colors.flame} />
              <Text style={styles.chipText}>Map</Text>
            </TouchableOpacity>
          )}
          {showMarkerChip && (
            <TouchableOpacity
              style={styles.chip}
              onPress={() => setMarkerModal(true)}
              disabled={savingMarker}
            >
              <GraveMarkerSvg styleId={story.marker_style} size={18} />
              <Text style={styles.chipText}>{savingMarker ? '…' : 'Marker'}</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={styles.chip} onPress={handleShare} disabled={sharing}>
            <ShareIcon size={18} color={colors.flame} />
            <Text style={styles.chipText}>{sharing ? '…' : 'Share'}</Text>
          </TouchableOpacity>
          {showPublicToggle && (
            <TouchableOpacity
              style={[styles.chip, isPublic && styles.chipActive]}
              onPress={handleTogglePublic}
              disabled={togglingPublic}
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

        {/* Scan another (sample shows it as the primary next step) */}
        <TouchableOpacity
          style={isSample ? styles.saveBtn : styles.scanAgainBtn}
          onPress={() => navigation.navigate('Camera')}
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
          <Pressable style={styles.markerSheet} onPress={() => {}}>
            <View style={styles.symbolSheetHandle} />
            <Text style={styles.symbolSheetName}>Choose a marker</Text>
            <Text style={styles.markerSheetHint}>
              {isUnsaved
                ? 'Your pin for this grave. If you’re the first to share it, this marker stays on the community map for good.'
                : 'How this grave appears on your Cemetery map.'}
            </Text>
            <ScrollView
              style={styles.markerGridScroll}
              contentContainerStyle={styles.markerGrid}
              showsVerticalScrollIndicator={false}
            >
              {MARKER_STYLES.map(m => {
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
            <TouchableOpacity style={styles.symbolSheetClose} onPress={() => setMarkerModal(false)}>
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
          <Pressable style={styles.symbolSheet} onPress={() => {}}>
            <View style={styles.symbolSheetHandle} />
            <Text style={styles.symbolSheetName}>{symbolModal?.name}</Text>
            <Text style={styles.symbolSheetText}>{symbolModal?.text}</Text>
            <TouchableOpacity style={styles.symbolSheetClose} onPress={() => setSymbolModal(null)}>
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
          <Pressable style={styles.symbolSheet} onPress={() => {}}>
            <View style={styles.symbolSheetHandle} />
            <Text style={styles.symbolSheetName}>About these stories</Text>
            <Text style={styles.symbolSheetText}>
              GraveStory assembles each biography with AI from public records and historical
              sources. It's a thoughtful starting point for remembrance and research — but it can
              contain errors and is not an official or authoritative record. If you spot something
              wrong, you can report it.
            </Text>
            <TouchableOpacity style={styles.symbolSheetClose} onPress={dismissAiModal}>
              <Text style={styles.symbolSheetCloseText}>I understand</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.ink },
  back: { padding: 24, paddingBottom: 0 },
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
    color: colors.parchment, fontSize: 30, fontFamily: fonts.title,
    marginBottom: 8, lineHeight: 34, letterSpacing: -0.3,
  },
  datesRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 },
  datesText: { color: colors.flame, fontSize: 14, fontFamily: fonts.body, letterSpacing: 0.5 },
  location: { color: colors.ash, fontSize: 13, fontFamily: fonts.body, marginBottom: 4, letterSpacing: 0.5 },
  contributorLine: { color: colors.silver, fontSize: 12, fontFamily: fonts.bodyItalic, marginTop: 4 },

  divider: { height: 1, backgroundColor: colors.line, marginVertical: 20 },

  bio: {
    color: '#e3d6c0', lineHeight: 26, fontSize: 15, marginBottom: 14,
    fontFamily: fonts.serif,
  },
  bioFirst: { fontSize: 16, lineHeight: 28 },

  // AI-honesty caption — muted gold, honest-research register (not a warning).
  aiCaption: {
    color: '#b89656',
    fontSize: 12.5,
    lineHeight: 18,
    fontFamily: fonts.bodyItalic,
    fontStyle: 'italic',
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

  symbolsLabel: {
    color: colors.ashDim, fontSize: 10, letterSpacing: 3,
    textTransform: 'uppercase', fontFamily: fonts.body, marginBottom: 6,
  },
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
  sourcesLabel: {
    color: colors.ashDim, fontSize: 10, letterSpacing: 3,
    textTransform: 'uppercase', fontFamily: fonts.body, marginBottom: 10,
  },
  sourceItem: { color: colors.ash, fontSize: 12, fontFamily: fonts.body, lineHeight: 20, marginBottom: 4 },
  sourceLink: { color: colors.flame, textDecorationLine: 'underline' },

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
  symbolSheetHandle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: colors.line, alignSelf: 'center', marginBottom: 20,
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

  markerSheet: {
    backgroundColor: colors.stone, borderTopLeftRadius: 20, borderTopRightRadius: 20,
    paddingHorizontal: 20, paddingTop: 12, paddingBottom: 28,
    maxHeight: '80%',
  },
  markerSheetHint: {
    color: colors.ash, fontSize: 13, fontFamily: fonts.body,
    marginBottom: 14, lineHeight: 18,
  },
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
    color: colors.ashDim, fontSize: 9, fontFamily: fonts.body,
    marginTop: 4, textAlign: 'center', letterSpacing: 0.2,
  },
  markerCellLabelSelected: { color: colors.flame },
});
