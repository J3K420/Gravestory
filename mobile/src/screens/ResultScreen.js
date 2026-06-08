import React, { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  Linking, Share, Image, Alert, FlatList, Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../lib/supabase';
import { loadStories, saveStories } from '../lib/storage';
import { cloudSaveStory, cloudUpdateStory, cloudDeleteStory, findOrCreateGrave } from '../lib/sync';
import { uploadGravestoneImage } from '../lib/api-r2';
import { getTributes, setTribute } from '../lib/api-tributes';
import { fetchWikipediaPortraits, normalizePortraits } from '../lib/api-wikipedia';
import { useRefresh } from '../lib/use-refresh';
import { colors, fonts, radius } from '../lib/theme';
import { MapStack, ShareIcon, Globe } from '../components/Icons';

const SCREEN_W = Dimensions.get('window').width;

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

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
    });
  }, []);

  useEffect(() => {
    if (story?.grave_id) {
      getTributes(story.grave_id).then(setTributes);
    }
  }, [story?.grave_id]);

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

  const { name, dates, biography, sources = [], source_urls = [], location, portraits, graveData } = story;
  const paragraphs = (biography || '').split('\n\n').filter(Boolean);

  // Global map bios: show all community photos of this stone when available.
  // Own stories: show only the user's own gravestone photo.
  const graveSlots = (story._isGlobal && gravePhotos.length > 0)
    ? gravePhotos.map((uri, i) => ({
        uri,
        label: gravePhotos.length > 1 ? `Photo ${i + 1} of ${gravePhotos.length}` : 'Gravestone',
      }))
    : (story.image_url ? [{ uri: story.image_url, label: 'Gravestone' }] : []);

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

      // Resolve the canonical grave at save time. On a find_grave cache hit the
      // grave_id is already set; otherwise dedup via find_or_create (~20m name match).
      let graveId = story.grave_id || null;
      if (!graveId && sessionUser && story.gps && primaryName) {
        graveId = await findOrCreateGrave(primaryName, story.gps.lat, story.gps.lng, story.is_public);
      }

      // Strip transient pipeline-only fields before persisting.
      const { _unsaved, _base64, _primaryName, ...clean } = story;
      let saved = { ...clean, grave_id: graveId };

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
    setTogglingPublic(false);
  }

  async function handleTribute(type) {
    if (!user || !story.grave_id || tributeLoading) return;
    setTributeLoading(true);
    // Tapping the same type toggles it off; tapping a different type switches
    const newType = tributes.userTribute === type ? null : type;
    await setTribute(story.grave_id, newType);
    const fresh = await getTributes(story.grave_id);
    setTributes(fresh);
    setTributeLoading(false);
  }

  const isUnsaved = !!story._unsaved;
  const showPublicToggle = user && !story._isGlobal && !isUnsaved;
  const isPublic = story.is_public;

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

        {/* Inscription */}
        {!!graveData?.inscription && (
          <View style={styles.inscriptionBox}>
            <Text style={styles.inscriptionLabel}>Inscription</Text>
            <Text style={styles.inscriptionText}>"{graveData.inscription}"</Text>
          </View>
        )}

        {/* Symbols */}
        {graveData?.symbols?.length > 0 && (
          <View style={styles.tagsRow}>
            {graveData.symbols.map((s, i) => (
              <View key={i} style={styles.tag}>
                <Text style={styles.tagText}>{s}</Text>
              </View>
            ))}
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
          <TouchableOpacity
            style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
            onPress={handleSave}
            disabled={saving}
          >
            <Text style={styles.saveBtnText}>{saving ? 'Saving…' : 'Save Story'}</Text>
          </TouchableOpacity>
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

        {/* Scan another */}
        <TouchableOpacity style={styles.scanAgainBtn} onPress={() => navigation.navigate('Camera')}>
          <Text style={styles.scanAgainText}>Scan Another Gravestone</Text>
        </TouchableOpacity>

        {/* Delete (saved) / Discard (unsaved) */}
        {!story._isGlobal && (
          <TouchableOpacity
            style={styles.deleteBtn}
            onPress={isUnsaved ? () => navigation.navigate('Home') : handleDelete}
          >
            <Text style={styles.deleteBtnText}>{isUnsaved ? 'Discard' : 'Delete Story'}</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
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
  chip: {
    flex: 1, flexDirection: 'column', alignItems: 'center', gap: 5,
    paddingVertical: 12, paddingHorizontal: 4,
    backgroundColor: colors.stone2, borderWidth: 1, borderColor: colors.line,
    borderRadius: radius.sm,
  },
  chipActive: { borderColor: 'rgba(170,190,220,0.4)', backgroundColor: 'rgba(170,190,220,0.08)' },
  chipText: { color: colors.ash, fontSize: 11, fontFamily: fonts.body },

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
});
