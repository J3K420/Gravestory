import React, { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  Linking, Share, Image, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../lib/supabase';
import { loadStories, saveStories } from '../lib/storage';
import { cloudUpdateStory, cloudDeleteStory } from '../lib/sync';
import { colors, fonts, radius } from '../lib/theme';
import { MapStack, ShareIcon, Globe } from '../components/Icons';

export default function ResultScreen({ navigation, route }) {
  const [story, setStory]               = useState(route.params?.story);
  const [user, setUser]                 = useState(null);
  const [sharing, setSharing]           = useState(false);
  const [togglingPublic, setTogglingPublic] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
    });
  }, []);

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

  const showPublicToggle = user && !story._isGlobal;
  const isPublic = story.is_public;

  return (
    <SafeAreaView style={styles.container}>
      <TouchableOpacity onPress={() => navigation.goBack()} style={styles.back}>
        <Text style={styles.backText}>← Back</Text>
      </TouchableOpacity>

      <ScrollView contentContainerStyle={styles.scroll}>

        {/* Gravestone photo */}
        {!!story.image_url && (
          <Image source={{ uri: story.image_url }} style={styles.gravestonePhoto} resizeMode="cover" />
        )}

        {/* Portraits */}
        {(portraits?.left || portraits?.right) && (
          <View style={styles.portraitsRow}>
            {portraits.left && <Image source={{ uri: portraits.left }} style={styles.portrait} resizeMode="cover" />}
            {portraits.right && <Image source={{ uri: portraits.right }} style={styles.portrait} resizeMode="cover" />}
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

        {/* Delete */}
        {!story._isGlobal && (
          <TouchableOpacity style={styles.deleteBtn} onPress={handleDelete}>
            <Text style={styles.deleteBtnText}>Delete Story</Text>
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

  gravestonePhoto: {
    width: '100%', height: 240, borderRadius: radius.sm,
    borderWidth: 1, borderColor: colors.line, marginBottom: 20,
  },
  portraitsRow: { flexDirection: 'row', gap: 12, marginBottom: 24, justifyContent: 'center' },
  portrait: { width: 140, height: 160, borderRadius: radius.sm, borderWidth: 1, borderColor: colors.line },

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
});
