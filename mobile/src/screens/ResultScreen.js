import React, { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  Linking, Share, Image, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../lib/supabase';
import { loadStories, saveStories } from '../lib/storage';
import { cloudUpdateStory, cloudDeleteStory } from '../lib/sync';

export default function ResultScreen({ navigation, route }) {
  // Keep story in local state so toggling visibility re-renders the button
  const [story, setStory] = useState(route.params?.story);
  const [user, setUser] = useState(null);
  const [sharing, setSharing] = useState(false);
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

  const {
    name, dates, biography, sources = [], source_urls = [],
    location, portraits, graveData,
  } = story;

  const paragraphs = (biography || '').split('\n\n').filter(Boolean);

  async function handleDelete() {
    if (story._isGlobal) return;
    Alert.alert(
      'Delete Story',
      `Remove "${name || 'this story'}" permanently?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            const stories = await loadStories();
            const filtered = stories.filter(s => s.timestamp !== story.timestamp);
            await saveStories(filtered);
            if (story.id && user) {
              await cloudDeleteStory(story, user);
            }
            navigation.navigate('Home');
          },
        },
      ]
    );
  }

  async function handleShare() {
    setSharing(true);
    try {
      const text = [
        name || 'Unknown',
        dates || '',
        location || '',
        '',
        biography || '',
        '',
        'Discovered with GraveStory',
      ].filter(Boolean).join('\n');
      await Share.share({ message: text, title: `GraveStory — ${name || 'Unknown'}` });
    } catch {}
    setSharing(false);
  }

  async function handleTogglePublic() {
    if (!user || story._isGlobal || togglingPublic) return;
    setTogglingPublic(true);
    const updated = { ...story, is_public: !story.is_public };

    // Persist locally first
    const stories = await loadStories();
    const idx = stories.findIndex(s => s.timestamp === story.timestamp);
    if (idx >= 0) {
      stories[idx] = updated;
      await saveStories(stories);
    }
    setStory(updated);

    // Sync to cloud if the story has already been pushed
    if (updated.id) {
      const synced = await cloudUpdateStory(updated, user);
      setStory(synced);
    }
    setTogglingPublic(false);
  }

  // Show the visibility toggle only for the user's own (non-global) stories
  const showPublicToggle = user && !story._isGlobal;
  const publicLabel = togglingPublic
    ? '…'
    : story.is_public
      ? '✦ Public — tap to make private'
      : '✦ Share with community';

  return (
    <SafeAreaView style={styles.container}>
      <TouchableOpacity onPress={() => navigation.goBack()} style={styles.back}>
        <Text style={styles.backText}>← Back</Text>
      </TouchableOpacity>

      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Gravestone photo */}
        {!!story.image_url && (
          <Image
            source={{ uri: story.image_url }}
            style={styles.gravestonePhoto}
            resizeMode="cover"
          />
        )}

        {/* Portraits */}
        {(portraits?.left || portraits?.right) && (
          <View style={styles.portraitsRow}>
            {portraits.left && (
              <Image source={{ uri: portraits.left }} style={styles.portrait} resizeMode="cover" />
            )}
            {portraits.right && (
              <Image source={{ uri: portraits.right }} style={styles.portrait} resizeMode="cover" />
            )}
          </View>
        )}

        {/* Header */}
        <Text style={styles.name}>{name || 'Unknown'}</Text>
        {!!dates && <Text style={styles.dates}>{dates}</Text>}
        {!!location && <Text style={styles.location}>✦ {location}</Text>}
        {story._isGlobal && (
          <Text style={styles.contributorLine}>
            Shared by {story._contributor || 'Anonymous'}
          </Text>
        )}

        <View style={styles.divider} />

        {/* Biography */}
        {paragraphs.map((para, i) => (
          <Text key={i} style={styles.bio}>{para}</Text>
        ))}

        {/* Gravestone data */}
        {graveData?.inscription ? (
          <View style={styles.inscriptionBox}>
            <Text style={styles.inscriptionLabel}>Inscription</Text>
            <Text style={styles.inscriptionText}>"{graveData.inscription}"</Text>
          </View>
        ) : null}

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
            <Text style={styles.sourcesLabel}>✦ Sources</Text>
            {sources.map((src, i) => (
              <TouchableOpacity
                key={i}
                onPress={() => source_urls[i] && Linking.openURL(source_urls[i])}
                disabled={!source_urls[i]}
              >
                <Text style={[styles.sourceItem, source_urls[i] && styles.sourceLink]}>
                  [{i + 1}] {src}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {/* Actions */}
        {(story.gps || story.location) && (
          <TouchableOpacity
            style={styles.mapBtn}
            onPress={() => navigation.navigate('CemeteryMap', { focusStory: story })}
          >
            <Text style={styles.mapBtnText}>✦ View on Map</Text>
          </TouchableOpacity>
        )}

        {/* Community sharing toggle */}
        {showPublicToggle && (
          <TouchableOpacity
            style={[styles.publicBtn, story.is_public && styles.publicBtnActive]}
            onPress={handleTogglePublic}
            disabled={togglingPublic}
          >
            <Text style={[styles.publicBtnText, story.is_public && styles.publicBtnTextActive]}>
              {publicLabel}
            </Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity style={styles.shareBtn} onPress={handleShare} disabled={sharing}>
          <Text style={styles.shareBtnText}>{sharing ? 'Sharing…' : '✦ Share this Story'}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.scanAgainBtn}
          onPress={() => navigation.navigate('Camera')}
        >
          <Text style={styles.scanAgainText}>Scan Another Gravestone</Text>
        </TouchableOpacity>

        {!story._isGlobal && (
          <TouchableOpacity style={styles.deleteBtn} onPress={handleDelete}>
            <Text style={styles.deleteBtnText}>Delete Story</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const GOLD     = '#c9a84c';
const INK      = '#0d0b08';
const PARCHMENT = '#e8d4a0';
const STONE    = 'rgba(138,126,110,0.7)';
const SILVER   = '#aabedc';

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: INK },
  back: { padding: 24, paddingBottom: 0 },
  backText: { color: 'rgba(201,168,76,0.6)', fontSize: 15 },
  scroll: { padding: 24, paddingTop: 12 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyText: { color: STONE, fontStyle: 'italic' },

  portraitsRow: { flexDirection: 'row', gap: 12, marginBottom: 24, justifyContent: 'center' },
  portrait: { width: 140, height: 160, borderWidth: 1, borderColor: 'rgba(201,168,76,0.3)' },

  name: { color: PARCHMENT, fontSize: 28, fontWeight: '700', marginBottom: 6, lineHeight: 34 },
  dates: { color: STONE, fontStyle: 'italic', fontSize: 15, marginBottom: 6 },
  location: { color: GOLD, fontSize: 13, marginBottom: 4, letterSpacing: 1 },
  contributorLine: {
    color: SILVER, fontSize: 12, fontStyle: 'italic', marginTop: 4,
  },

  divider: { height: 1, backgroundColor: GOLD, opacity: 0.3, marginVertical: 20 },

  bio: { color: PARCHMENT, lineHeight: 26, fontSize: 15, marginBottom: 14 },

  inscriptionBox: {
    borderLeftWidth: 2, borderLeftColor: GOLD,
    paddingLeft: 14, marginVertical: 20,
    backgroundColor: 'rgba(201,168,76,0.05)',
    paddingVertical: 12, paddingRight: 12,
  },
  inscriptionLabel: { color: GOLD, fontSize: 10, letterSpacing: 3, textTransform: 'uppercase', marginBottom: 6 },
  inscriptionText: { color: PARCHMENT, fontStyle: 'italic', lineHeight: 22, fontSize: 14 },

  tagsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 20 },
  tag: {
    borderWidth: 1, borderColor: 'rgba(201,168,76,0.25)',
    paddingHorizontal: 10, paddingVertical: 4, borderRadius: 2,
  },
  tagText: { color: STONE, fontSize: 12 },

  sourcesSection: { marginTop: 8, marginBottom: 24 },
  sourcesLabel: {
    color: STONE, fontSize: 10, letterSpacing: 3, textTransform: 'uppercase',
    marginBottom: 10,
  },
  sourceItem: { color: STONE, fontSize: 12, lineHeight: 20, marginBottom: 4 },
  sourceLink: { color: GOLD, textDecorationLine: 'underline' },

  mapBtn: {
    borderWidth: 1, borderColor: 'rgba(201,168,76,0.4)',
    paddingVertical: 16, borderRadius: 2, marginBottom: 12,
  },
  mapBtnText: { color: STONE, textAlign: 'center', letterSpacing: 2, fontSize: 15 },

  // Community sharing toggle
  publicBtn: {
    borderWidth: 1, borderColor: 'rgba(170,190,220,0.3)',
    paddingVertical: 16, borderRadius: 2, marginBottom: 12,
    backgroundColor: 'rgba(170,190,220,0.05)',
  },
  publicBtnActive: {
    borderColor: 'rgba(170,190,220,0.7)',
    backgroundColor: 'rgba(170,190,220,0.12)',
  },
  publicBtnText: { color: SILVER, textAlign: 'center', letterSpacing: 1, fontSize: 14, opacity: 0.7 },
  publicBtnTextActive: { opacity: 1 },

  shareBtn: {
    borderWidth: 1, borderColor: GOLD,
    paddingVertical: 16, borderRadius: 2, marginBottom: 12,
  },
  shareBtnText: { color: GOLD, textAlign: 'center', letterSpacing: 2, fontSize: 15 },

  scanAgainBtn: {
    borderWidth: 1, borderColor: 'rgba(201,168,76,0.3)',
    paddingVertical: 14, borderRadius: 2, marginBottom: 12,
  },
  scanAgainText: { color: STONE, textAlign: 'center', letterSpacing: 1 },

  gravestonePhoto: {
    width: '100%', height: 240,
    borderWidth: 1, borderColor: 'rgba(201,168,76,0.3)',
    marginBottom: 20,
  },

  deleteBtn: {
    borderWidth: 1, borderColor: 'rgba(160,60,60,0.4)',
    paddingVertical: 14, borderRadius: 2, marginBottom: 32,
    backgroundColor: 'rgba(160,60,60,0.06)',
  },
  deleteBtnText: { color: '#a03c3c', textAlign: 'center', letterSpacing: 1, fontSize: 14 },
});
