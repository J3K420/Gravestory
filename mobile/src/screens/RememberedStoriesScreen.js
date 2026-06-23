import React, { memo, useCallback, useMemo, useState } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView,
  StyleSheet, StatusBar, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { supabase } from '../lib/supabase';
import { loadStories, saveStories } from '../lib/storage';
import { cloudDeleteStory, syncDelta } from '../lib/sync';
import { useRefresh } from '../lib/use-refresh';
import { colors, fonts, radius } from '../lib/theme';
import GravestoneLogo from '../components/GravestoneLogo';
import { Headstone } from '../components/Icons';

const StoryCard = memo(function StoryCard({ story, i, onPress, onDelete }) {
  return (
    <View key={story.timestamp ?? i} style={styles.savedCard}>
      <View style={styles.savedAvatar}>
        <Headstone size={17} color={colors.ash} />
      </View>
      <TouchableOpacity style={styles.savedCardMain} onPress={onPress} activeOpacity={0.7}>
        <Text style={styles.savedName}>{story.name || 'Unknown'}</Text>
        <Text style={styles.savedDates}>{story.dates || ''}</Text>
      </TouchableOpacity>
      {story.is_public && <Text style={styles.publicBadge}>public</Text>}
      <Text style={styles.savedArrow}>›</Text>
      <TouchableOpacity
        style={styles.deleteBtn}
        onPress={onDelete}
        activeOpacity={0.6}
        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        accessibilityRole="button"
        accessibilityLabel={`Delete story for ${story.name || 'Unknown'}`}
      >
        <Text style={styles.deleteBtnText}>✕</Text>
      </TouchableOpacity>
    </View>
  );
});

const SORT_MODES = [
  { key: 'recent',   label: 'Recent' },
  { key: 'name',     label: 'Name' },
  { key: 'cemetery', label: 'Cemetery' },
];

function getCemeteryName(story) {
  if (!story.location) return 'Unknown Cemetery';
  return story.location.split(',')[0].trim();
}

export default function RememberedStoriesScreen({ navigation }) {
  const [stories, setStories] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [sortBy, setSortBy] = useState('recent');
  const [expandedCemeteries, setExpandedCemeteries] = useState(new Set());

  useFocusEffect(
    useCallback(() => {
      let active = true;
      async function load() {
        const { data: { session } } = await supabase.auth.getSession();
        const uid = session?.user?.id ?? null;
        // Show local immediately, then pull cloud deltas so a long-backgrounded
        // resume (or an edit/delete from another device) reflects here instead
        // of showing the stale local copy until a manual pull-to-refresh.
        const local = await loadStories(uid);
        if (active) { setStories(local); setLoaded(true); }
        if (session?.user) {
          const synced = await syncDelta(session.user);
          if (active && synced) setStories(synced);
        }
      }
      load();
      return () => { active = false; };
    }, [])
  );

  const sortedStories = useMemo(() => {
    const copy = [...stories];
    if (sortBy === 'name') {
      copy.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    } else {
      copy.sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));
    }
    return copy;
  }, [stories, sortBy]);

  const cemeteryGroups = useMemo(() => {
    if (sortBy !== 'cemetery') return null;
    const map = new Map();
    for (const story of stories) {
      const key = getCemeteryName(story);
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(story);
    }
    return [...map.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, list]) => ({
        name,
        stories: [...list].sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0)),
      }));
  }, [stories, sortBy]);

  const { refreshControl } = useRefresh(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    const uid = session?.user?.id ?? null;
    const local = await loadStories(uid);
    setStories(local);
  });

  function toggleCemetery(name) {
    setExpandedCemeteries(prev => {
      const next = new Set(prev);
      next.has(name) ? next.delete(name) : next.add(name);
      return next;
    });
  }

  function isCemeteryExpanded(name, count) {
    return count <= 5 || expandedCemeteries.has(name);
  }

  const confirmDelete = useCallback((story) => {
    Alert.alert(
      'Delete story?',
      `Remove "${story.name || 'this story'}" permanently?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete', style: 'destructive',
          onPress: async () => {
            const updated = stories.filter(s => s.timestamp !== story.timestamp);
            setStories(updated);
            const { data: { session } } = await supabase.auth.getSession();
            await saveStories(updated, session?.user?.id ?? null);
            if (session?.user) await cloudDeleteStory(story, session.user);
          },
        },
      ]
    );
  }, [stories]);

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={colors.ink} />

      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => navigation.goBack()}
          style={styles.backBtn}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Remembered Stories</Text>
        <View style={styles.headerSpacer} />
      </View>

      {/* Sort bar */}
      <View style={styles.sortBar}>
        <Text style={styles.sortLabel}>Sort by</Text>
        <View style={styles.sortPills}>
          {SORT_MODES.map(mode => (
            <TouchableOpacity
              key={mode.key}
              style={[styles.sortPill, sortBy === mode.key && styles.sortPillActive]}
              onPress={() => setSortBy(mode.key)}
              activeOpacity={0.7}
            >
              <Text style={[styles.sortPillText, sortBy === mode.key && styles.sortPillTextActive]}>
                {mode.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={refreshControl}
      >
        {loaded && stories.length === 0 ? (
          <View style={styles.emptyState}>
            <GravestoneLogo size={80} animate={false} />
            <Text style={styles.emptyTitle}>No stories yet</Text>
            <Text style={styles.emptySaved}>
              Tap "Scan a Gravestone" on the home screen to photograph your first one.
            </Text>
          </View>

        ) : sortBy === 'cemetery' ? (
          cemeteryGroups?.map(group => {
            const collapsible = group.stories.length > 5;
            const expanded = isCemeteryExpanded(group.name, group.stories.length);
            return (
              <View key={group.name} style={styles.cemeteryGroup}>
                <TouchableOpacity
                  style={styles.cemeteryHeader}
                  onPress={() => collapsible && toggleCemetery(group.name)}
                  activeOpacity={collapsible ? 0.7 : 1}
                >
                  <View style={styles.cemeteryHeaderLeft}>
                    <Text style={styles.cemeteryName}>{group.name}</Text>
                    <View style={styles.cemeteryBadge}>
                      <Text style={styles.cemeteryCount}>{group.stories.length}</Text>
                    </View>
                  </View>
                  {collapsible && (
                    <Text style={styles.cemeteryChevron}>{expanded ? '▾' : '▸'}</Text>
                  )}
                </TouchableOpacity>
                {expanded && group.stories.map((story, i) => (
                  <StoryCard
                    key={story.timestamp ?? i} story={story} i={i}
                    onPress={() => navigation.navigate('Result', { story })}
                    onDelete={() => confirmDelete(story)}
                  />
                ))}
              </View>
            );
          })

        ) : (
          sortedStories.map((story, i) => (
            <StoryCard
              key={story.timestamp ?? i} story={story} i={i}
              onPress={() => navigation.navigate('Result', { story })}
              onDelete={() => confirmDelete(story)}
            />
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.ink },

  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 14,
    borderBottomWidth: 1, borderBottomColor: colors.line,
  },
  backBtn: { width: 80, paddingRight: 12 },
  backText: { color: colors.ashDim, fontSize: 15, fontFamily: fonts.body },
  title: {
    flex: 1, textAlign: 'center',
    color: colors.parchment, fontSize: 16,
    fontFamily: fonts.title, letterSpacing: 1,
  },
  headerSpacer: { width: 80 },

  sortBar: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 10,
    borderBottomWidth: 1, borderBottomColor: colors.line,
    gap: 12,
  },
  sortLabel: {
    color: colors.ashDim, fontSize: 11, fontFamily: fonts.body,
    textTransform: 'uppercase', letterSpacing: 1,
  },
  sortPills: { flexDirection: 'row', gap: 6 },
  sortPill: {
    paddingHorizontal: 12, paddingVertical: 5,
    borderRadius: 20, borderWidth: 1, borderColor: colors.line,
    backgroundColor: colors.stone2,
  },
  sortPillActive: {
    borderColor: colors.flame,
    backgroundColor: 'rgba(242,182,92,0.12)',
  },
  sortPillText: { color: colors.ash, fontSize: 12, fontFamily: fonts.body },
  sortPillTextActive: { color: colors.flame, fontFamily: fonts.bodyMedium },

  scroll: { padding: 16, paddingBottom: 48 },

  emptyState: { alignItems: 'center', paddingVertical: 48 },
  emptyTitle: {
    color: colors.parchment, fontSize: 18, marginTop: 16, marginBottom: 8,
    fontFamily: fonts.title,
  },
  emptySaved: {
    color: colors.ash, fontFamily: fonts.bodyItalic,
    textAlign: 'center', opacity: 0.6, maxWidth: 260,
  },

  /* Cemetery grouping */
  cemeteryGroup: { marginBottom: 16 },
  cemeteryHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 10, paddingHorizontal: 4,
    borderBottomWidth: 1, borderBottomColor: colors.line,
    marginBottom: 8,
  },
  cemeteryHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  cemeteryName: {
    color: colors.parchment, fontSize: 15, fontFamily: fonts.title, letterSpacing: 0.5,
  },
  cemeteryBadge: {
    backgroundColor: colors.stone2, borderWidth: 1, borderColor: colors.line,
    borderRadius: 10, paddingHorizontal: 7, paddingVertical: 2,
  },
  cemeteryCount: { color: colors.ash, fontSize: 11, fontFamily: fonts.body },
  cemeteryChevron: { color: colors.flame, fontSize: 18, fontFamily: fonts.body },

  /* Story cards */
  savedCard: {
    flexDirection: 'row', alignItems: 'center',
    borderWidth: 1, borderColor: colors.line,
    padding: 11, marginBottom: 10, borderRadius: radius.sm,
    backgroundColor: colors.stone2, gap: 11,
  },
  savedAvatar: {
    width: 34, height: 34, borderRadius: 9,
    backgroundColor: colors.stone,
    alignItems: 'center', justifyContent: 'center',
  },
  savedCardMain: { flex: 1, paddingVertical: 2 },
  savedName: { color: colors.parchment, fontSize: 15, marginBottom: 2, fontFamily: fonts.name },
  savedDates: { color: colors.ashDim, fontSize: 12, fontFamily: fonts.bodyItalic },
  publicBadge: {
    color: colors.silver, fontSize: 10, letterSpacing: 1, fontFamily: fonts.body,
    textTransform: 'uppercase', marginRight: 4,
  },
  savedArrow: { color: colors.flame, fontSize: 20 },
  deleteBtn: { paddingLeft: 12 },
  deleteBtnText: { color: colors.dangerDim, fontSize: 15, fontFamily: fonts.body },
});
