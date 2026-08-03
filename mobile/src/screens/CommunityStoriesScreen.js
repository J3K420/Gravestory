import React, { useCallback, useState } from 'react';
import {
  ActivityIndicator, Alert, FlatList, Image, Modal, Pressable, StyleSheet,
  Text, TextInput, TouchableOpacity, View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { supabase } from '../lib/supabase';
import { blockContributor, fetchCommunityStories } from '../lib/api-remembrances';
import {
  CONTRIBUTOR_REPORT_REASONS, REPORT_NOTE_MAX, submitContributorReport,
} from '../lib/api-reports';
import { resetGlobalMapCache } from '../lib/global-map-cache';
import { useRefresh } from '../lib/use-refresh';
import { colors, fonts, radius } from '../lib/theme';
import { Globe, Pin } from '../components/Icons';

export default function CommunityStoriesScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const [stories, setStories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [user, setUser] = useState(null);
  const [reportStory, setReportStory] = useState(null);
  const [reportReason, setReportReason] = useState(null);
  const [reportNote, setReportNote] = useState('');
  const [reportSending, setReportSending] = useState(false);

  const load = useCallback(async () => {
    setError('');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      setUser(session?.user || null);
      setStories(await fetchCommunityStories({ limit: 100 }));
    } catch (e) {
      console.warn('CommunityStoriesScreen fetch failed:', e.message);
      setError('Could not load community stories. Pull down to retry.');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));
  const { refreshControl } = useRefresh(load);

  function requestBlock(story) {
    if (!user) {
      Alert.alert('Sign in to block contributors', 'Blocking is saved to your account across devices.', [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign in', onPress: () => navigation.navigate('Auth') },
      ]);
      return;
    }
    if (!story._contributorId || story._contributorId === user.id) return;
    Alert.alert(
      `Block ${story._contributor || 'this contributor'}?`,
      'Their stories will disappear from Community Stories and the Community Map. They are not notified.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Block', style: 'destructive', onPress: async () => {
            const ok = await blockContributor(story._contributorId);
            if (!ok) {
              Alert.alert('Could not block contributor', 'Please try again.');
              return;
            }
            resetGlobalMapCache();
            setStories(items => items.filter(item => item._contributorId !== story._contributorId));
          },
        },
      ]
    );
  }

  function openContributorReport(story) {
    setReportStory(story);
    setReportReason(null);
    setReportNote('');
  }

  async function sendContributorReport() {
    if (!reportStory || !reportReason || reportSending) return;
    setReportSending(true);
    const ok = await submitContributorReport({
      story: reportStory,
      reason: reportReason,
      note: reportNote,
    });
    setReportSending(false);
    if (ok) {
      setReportStory(null);
      Alert.alert('Report sent', 'Thank you. We review contributor reports and take action when needed.');
    } else {
      Alert.alert('Could not send report', 'Please check your connection and try again.');
    }
  }

  function renderStory({ item }) {
    const location = item.location || (item.gps ? 'Location provided' : 'Location not provided');
    return (
      <View style={styles.card}>
        <TouchableOpacity onPress={() => navigation.navigate('Result', { story: item })} activeOpacity={0.82}>
          {!!item.image_url && <Image source={{ uri: item.image_url }} style={styles.image} />}
          <View style={styles.cardBody}>
            <View style={styles.badgeRow}>
              <Text style={styles.typeBadge}>
                {item.story_type === 'remembrance' ? 'Shared remembrance' : 'Researched story'}
              </Text>
              <Text style={styles.contributor}>by {item._contributor || 'Anonymous'}</Text>
            </View>
            <Text style={styles.name}>{item.name || 'Unknown'}</Text>
            {!!item.dates && <Text style={styles.dates}>{item.dates}</Text>}
            <View style={styles.locationRow}>
              <Pin size={12} color={colors.ashDim} />
              <Text style={styles.location}>{location}</Text>
            </View>
            <Text style={styles.excerpt} numberOfLines={4}>{item.biography || ''}</Text>
            <Text style={styles.readMore}>Read the full story ›</Text>
          </View>
        </TouchableOpacity>
        {item._contributorId && item._contributorId !== user?.id && (
          <View style={styles.safetyRow}>
            <TouchableOpacity onPress={() => openContributorReport(item)} style={styles.safetyBtn}>
              <Text style={styles.safetyText}>Report contributor</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => requestBlock(item)} style={styles.safetyBtn}>
              <Text style={styles.safetyText}>Block</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.headerSide}>
          <Text style={styles.back}>← Back</Text>
        </TouchableOpacity>
        <View style={styles.headerCenter}>
          <Globe size={16} color={colors.flame} />
          <Text style={styles.headerTitle}>Community Stories</Text>
        </View>
        <TouchableOpacity onPress={() => navigation.navigate('GlobalMap')} style={[styles.headerSide, styles.headerRight]}>
          <Text style={styles.mapLink}>Map</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.center}><ActivityIndicator color={colors.flame} /><Text style={styles.loadingText}>Loading stories…</Text></View>
      ) : (
        <FlatList
          data={stories}
          keyExtractor={(item, index) => item.id || String(item.timestamp || index)}
          renderItem={renderStory}
          contentContainerStyle={styles.list}
          refreshControl={refreshControl}
          ListHeaderComponent={<Text style={styles.intro}>Public stories shared by the GraveStory community—location optional.</Text>}
          ListEmptyComponent={<Text style={styles.empty}>{error || 'No public stories yet.'}</Text>}
        />
      )}

      <Modal visible={!!reportStory} transparent animationType="slide" onRequestClose={() => setReportStory(null)}>
        <Pressable style={styles.overlay} onPress={() => setReportStory(null)}>
          <Pressable style={[styles.sheet, { paddingBottom: insets.bottom + 24 }]} onPress={() => {}}>
            <Text style={styles.sheetTitle}>Report contributor</Text>
            <Text style={styles.sheetBody}>What behavior should our moderation team review?</Text>
            <View style={styles.reasonWrap}>
              {CONTRIBUTOR_REPORT_REASONS.map(reason => (
                <TouchableOpacity
                  key={reason.id}
                  style={[styles.reasonChip, reportReason === reason.id && styles.reasonChipOn]}
                  onPress={() => setReportReason(reason.id)}
                >
                  <Text style={[styles.reasonText, reportReason === reason.id && styles.reasonTextOn]}>{reason.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <TextInput
              style={styles.note}
              value={reportNote}
              onChangeText={setReportNote}
              placeholder="Add details (optional)"
              placeholderTextColor={colors.ashDim}
              maxLength={REPORT_NOTE_MAX}
              multiline
            />
            <View style={styles.sheetActions}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setReportStory(null)}><Text style={styles.cancelText}>Cancel</Text></TouchableOpacity>
              <TouchableOpacity style={[styles.sendBtn, (!reportReason || reportSending) && styles.disabled]} onPress={sendContributorReport} disabled={!reportReason || reportSending}>
                <Text style={styles.sendText}>{reportSending ? 'Sending…' : 'Send report'}</Text>
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
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 15, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: colors.line },
  headerSide: { width: 64 },
  headerRight: { alignItems: 'flex-end' },
  headerCenter: { flex: 1, flexDirection: 'row', gap: 7, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { color: colors.parchment, fontFamily: fonts.title, fontSize: 16 },
  back: { color: colors.ash, fontFamily: fonts.body },
  mapLink: { color: colors.silver, fontFamily: fonts.bodyMedium },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  loadingText: { color: colors.ash, fontFamily: fonts.body, marginTop: 10 },
  list: { padding: 16, paddingBottom: 48 },
  intro: { color: colors.ash, fontFamily: fonts.bodyItalic, textAlign: 'center', lineHeight: 20, marginBottom: 16 },
  empty: { color: colors.ash, fontFamily: fonts.bodyItalic, textAlign: 'center', marginTop: 50 },
  card: { borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.stone2, marginBottom: 16 },
  image: { width: '100%', height: 190, backgroundColor: colors.stone },
  cardBody: { padding: 15 },
  badgeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  typeBadge: { color: colors.flame, fontFamily: fonts.bodyMedium, fontSize: 10, letterSpacing: 1, textTransform: 'uppercase' },
  contributor: { color: colors.silver, fontFamily: fonts.bodyItalic, fontSize: 11, flexShrink: 1 },
  name: { color: colors.parchment, fontFamily: fonts.title, fontSize: 22, marginTop: 9 },
  dates: { color: colors.flame, fontFamily: fonts.body, marginTop: 2 },
  locationRow: { flexDirection: 'row', gap: 5, alignItems: 'center', marginTop: 6 },
  location: { color: colors.ashDim, fontFamily: fonts.bodyItalic, fontSize: 12, flex: 1 },
  excerpt: { color: colors.parchment, fontFamily: fonts.serif, fontSize: 14, lineHeight: 21, marginTop: 12 },
  readMore: { color: colors.flame, fontFamily: fonts.bodyMedium, marginTop: 10 },
  safetyRow: { flexDirection: 'row', justifyContent: 'flex-end', borderTopWidth: 1, borderTopColor: colors.line, paddingHorizontal: 12, paddingVertical: 8, gap: 8 },
  safetyBtn: { paddingHorizontal: 10, paddingVertical: 6 },
  safetyText: { color: colors.ashDim, fontFamily: fonts.body, fontSize: 11, textDecorationLine: 'underline' },
  overlay: { flex: 1, backgroundColor: colors.overlay, justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.stone, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: 20, borderTopWidth: 1, borderColor: colors.line },
  sheetTitle: { color: colors.parchment, fontFamily: fonts.title, fontSize: 22 },
  sheetBody: { color: colors.ash, fontFamily: fonts.body, marginTop: 7, marginBottom: 15 },
  reasonWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  reasonChip: { borderWidth: 1, borderColor: colors.line, borderRadius: 20, paddingHorizontal: 11, paddingVertical: 7 },
  reasonChipOn: { borderColor: colors.flame, backgroundColor: colors.glow },
  reasonText: { color: colors.ash, fontFamily: fonts.body, fontSize: 12 },
  reasonTextOn: { color: colors.flame },
  note: { minHeight: 90, color: colors.parchment, fontFamily: fonts.body, backgroundColor: colors.stone2, borderWidth: 1, borderColor: colors.line, borderRadius: radius.sm, padding: 12, marginTop: 15, textAlignVertical: 'top' },
  sheetActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 15 },
  cancelBtn: { paddingHorizontal: 15, paddingVertical: 11 },
  cancelText: { color: colors.ash, fontFamily: fonts.bodyMedium },
  sendBtn: { paddingHorizontal: 17, paddingVertical: 11, borderRadius: radius.sm, backgroundColor: colors.flame },
  sendText: { color: colors.onFlame, fontFamily: fonts.sansBold },
  disabled: { opacity: 0.45 },
});


