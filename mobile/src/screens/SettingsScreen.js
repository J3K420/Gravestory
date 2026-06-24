import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, Switch,
  StyleSheet, Alert, ScrollView, ActivityIndicator, Linking, Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as StoreReview from 'expo-store-review';
import * as Updates from 'expo-updates';
import Constants from 'expo-constants';
import Purchases from 'react-native-purchases';
import { supabase } from '../lib/supabase';
import { useRefresh } from '../lib/use-refresh';
import { colors, fonts, radius } from '../lib/theme';
import { checkSaveLimit } from '../lib/save-limit';
import { checkScanLimit, SCAN_LIMIT_FREE_USER } from '../lib/scan-limit';
import { deleteAccount } from '../lib/api-account';
import { saveStories } from '../lib/storage';

export default function SettingsScreen({ navigation }) {
  const [user, setUser]                 = useState(null);
  const [displayName, setDisplayName]   = useState('');
  const [defaultPublic, setDefaultPublic] = useState(false);
  const [saving, setSaving]             = useState(false);
  const [saveCount, setSaveCount]       = useState(null);
  const [scanCount, setScanCount]       = useState(null);
  const [scanLimit, setScanLimit]       = useState(SCAN_LIMIT_FREE_USER);
  const [deleteModal, setDeleteModal]   = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [deleting, setDeleting]         = useState(false);
  // Synchronous re-entry lock for the irreversible delete — `deleting` state
  // updates async, so a fast double-tap could fire two requests before the
  // re-render lands. The ref blocks the second tap immediately. (Same pattern
  // as ResultScreen's markerStyleRef.)
  const deletingRef = useRef(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session?.user) return;
      setUser(session.user);
      setDisplayName(session.user.user_metadata?.full_name || session.user.email?.split('@')[0] || '');
      setDefaultPublic(session.user.user_metadata?.default_public ?? false);
      Promise.all([
        checkSaveLimit(session.user.id),
        checkScanLimit(session.user.id, session.user),
      ]).then(([saves, scans]) => {
        setSaveCount(saves.count);
        setScanCount(scans.count);
        setScanLimit(scans.limit);
      });
    });
  }, []);

  const { refreshControl } = useRefresh(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user) {
      setUser(session.user);
      setDisplayName(session.user.user_metadata?.full_name || session.user.email?.split('@')[0] || '');
      setDefaultPublic(session.user.user_metadata?.default_public ?? false);
      const [saves, scans] = await Promise.all([
        checkSaveLimit(session.user.id),
        checkScanLimit(session.user.id, session.user),
      ]);
      setSaveCount(saves.count);
      setScanCount(scans.count);
      setScanLimit(scans.limit);
    }
  });

  async function saveProfile() {
    setSaving(true);
    try {
      const { error } = await supabase.auth.updateUser({
        data: { full_name: displayName.trim(), default_public: defaultPublic },
      });
      if (error) throw error;
      Alert.alert('Saved', 'Your profile has been updated.');
    } catch (e) {
      Alert.alert('Save failed', e.message);
    } finally {
      setSaving(false);
    }
  }

  function handleSignOut() {
    Alert.alert(
      'Sign Out',
      'Are you sure you want to sign out?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Sign Out',
          style: 'destructive',
          onPress: async () => {
            await supabase.auth.signOut();
            navigation.goBack();
          },
        },
      ]
    );
  }

  // Permanently delete the account. Gated behind a type-to-confirm modal
  // (the user must type DELETE) so it can't be tapped by accident — Google
  // Play requires a deliberate in-app deletion path. On success we clear the
  // local story cache and sign out; the account + all cloud data are already
  // gone server-side.
  async function handleDeleteAccount() {
    // Synchronous re-entry guard — blocks a double-tap before the async
    // `deleting` state (and the disabled prop) has a chance to update.
    if (deletingRef.current) return;
    deletingRef.current = true;
    setDeleting(true);
    const result = await deleteAccount();
    if (!result.ok) {
      deletingRef.current = false;
      setDeleting(false);
      // Re-require typing DELETE before any retry — re-confirms intent and
      // closes the primed one-tap retry window.
      setDeleteConfirmText('');
      Alert.alert('Could not delete account', result.error);
      return;
    }
    // Wipe ALL of this user's local, identity-scoped data, then detach the
    // RevenueCat identity and sign out. Guard each step so a post-delete
    // hiccup never leaves the user staring at a spinner. The cloud + auth
    // user are already gone server-side at this point.
    if (user?.id) {
      try { await saveStories([], user.id); } catch { /* ignore */ }
      try { await AsyncStorage.removeItem(`gs_last_sync_${user.id}`); } catch { /* ignore */ }
    }
    try { await Purchases.logOut(); } catch { /* RC not configured / anon — fine */ }
    try { await supabase.auth.signOut(); } catch { /* session is already invalid */ }
    deletingRef.current = false;
    setDeleting(false);
    setDeleteModal(false);
    Alert.alert(
      'Account deleted',
      'Your account and all associated data have been permanently deleted.',
      [{ text: 'OK', onPress: () => navigation.goBack() }]
    );
  }

  // "Rate GraveStory": prefer Google's native in-app review overlay (rate
  // without leaving the app), but it's quota-throttled and silently no-ops if
  // the user already reviewed / it was shown recently / the device lacks Play
  // Services — and the Expo docs warn it may do nothing from a button. So we
  // always fall back to the Play Store listing, guaranteeing the tap does
  // something visible. The listing deep-link works regardless of the native flow.
  const PLAY_LISTING_URL = 'https://play.google.com/store/apps/details?id=com.gravestory.app';
  async function handleRate() {
    try {
      if ((await StoreReview.isAvailableAsync()) && (await StoreReview.hasAction())) {
        await StoreReview.requestReview();
        return;
      }
    } catch (e) {
      // fall through to the store listing
    }
    Linking.openURL(PLAY_LISTING_URL).catch(() => {
      Alert.alert('Could not open the store', 'Please search for GraveStory in the Play Store.');
    });
  }

  const provider = user?.app_metadata?.provider;
  const providerLabel = provider === 'google'
    ? 'Google'
    : provider === 'email'
      ? 'Email / password'
      : provider || '—';

  return (
    <SafeAreaView style={styles.container}>
      <TouchableOpacity
        onPress={() => navigation.goBack()}
        style={styles.back}
        activeOpacity={0.7}
        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        accessibilityRole="button"
        accessibilityLabel="Go back"
      >
        <Text style={styles.backText}>← Back</Text>
      </TouchableOpacity>

      <ScrollView
        contentContainerStyle={styles.scroll}
        refreshControl={refreshControl}
      >
        <Text style={styles.title}>Account</Text>

        {user ? (
          <>
            {/* Account info */}
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Account Info</Text>
              <View style={styles.infoRow}>
                <Text style={styles.infoKey}>Email</Text>
                <Text style={styles.infoVal} numberOfLines={1}>{user.email}</Text>
              </View>
              <View style={[styles.infoRow, { borderBottomWidth: 0 }]}>
                <Text style={styles.infoKey}>Sign-in</Text>
                <Text style={styles.infoVal}>{providerLabel}</Text>
              </View>
            </View>

            {/* Stories saved — no limit, just a count */}
            {saveCount !== null && (
              <View style={styles.section}>
                <Text style={styles.sectionLabel}>Stories Saved</Text>
                <View style={styles.progressRow}>
                  <Text style={styles.progressLabel}>
                    {saveCount} {saveCount === 1 ? 'story' : 'stories'}
                  </Text>
                </View>
              </View>
            )}

            {/* Scan limit progress — tap to open the scan-pack paywall */}
            {scanCount !== null && (
              <TouchableOpacity
                style={styles.section}
                activeOpacity={0.7}
                onPress={() =>
                  navigation.navigate('Paywall', {
                    type: 'scan',
                    count: scanCount,
                    isGuest: false,
                  })
                }
              >
                <View style={styles.sectionHeaderRow}>
                  <Text style={[styles.sectionLabel, styles.sectionLabelInline]}>Scans Used</Text>
                  <Text style={styles.buyMoreLink}>Buy more ›</Text>
                </View>
                <View style={styles.progressRow}>
                  <Text style={styles.progressLabel}>
                    {scanCount} of {scanLimit} scans
                  </Text>
                  {scanCount >= scanLimit && (
                    <Text style={styles.progressFull}>Limit reached</Text>
                  )}
                </View>
                <View style={styles.barTrack}>
                  <View
                    style={[
                      styles.barFill,
                      { width: `${Math.min((scanCount / scanLimit) * 100, 100)}%` },
                      scanCount >= scanLimit && styles.barFull,
                    ]}
                  />
                </View>
                <Text style={styles.progressHint}>
                  Tap to buy more scans and keep exploring.
                </Text>
              </TouchableOpacity>
            )}

            {/* Display name */}
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Display Name</Text>
              <TextInput
                style={styles.input}
                value={displayName}
                onChangeText={setDisplayName}
                placeholder="Your name"
                placeholderTextColor={colors.ashDim}
                autoCorrect={false}
                keyboardAppearance="dark"
              />
            </View>

            {/* Default visibility */}
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>New Story Visibility</Text>
              <View style={styles.toggleRow}>
                <View style={styles.toggleTextGroup}>
                  <Text style={styles.toggleLabel}>Public by default</Text>
                  <Text style={styles.toggleDesc}>
                    {defaultPublic
                      ? 'New stories appear on the community map'
                      : 'New stories are private until you share them'}
                  </Text>
                </View>
                <Switch
                  value={defaultPublic}
                  onValueChange={setDefaultPublic}
                  trackColor={{ false: colors.line, true: 'rgba(242,182,92,0.5)' }}
                  thumbColor={defaultPublic ? colors.flame : colors.ashDim}
                />
              </View>
            </View>

            {/* Save */}
            <TouchableOpacity onPress={saveProfile} disabled={saving} activeOpacity={0.88} style={styles.saveBtn}>
              {saving
                ? <ActivityIndicator color={colors.onFlame} />
                : <Text style={styles.saveBtnText}>Save Changes</Text>}
            </TouchableOpacity>

            <View style={styles.separator} />

            {/* Rate the app — tries Google's in-app review, falls back to the
                Play listing. Sits above sign-out as a positive, encouraged action. */}
            <TouchableOpacity style={styles.rateBtn} onPress={handleRate} activeOpacity={0.85}>
              <Text style={styles.rateBtnText}>★  Rate GraveStory</Text>
            </TouchableOpacity>

            {/* Sign out */}
            <TouchableOpacity style={styles.signOutBtn} onPress={handleSignOut} activeOpacity={0.7}>
              <Text style={styles.signOutText}>Sign Out</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.privacyLink}
              activeOpacity={0.7}
              onPress={() => Linking.openURL('https://j3k420.github.io/Gravestory/privacy-policy/')}
            >
              <Text style={styles.privacyLinkText}>Privacy Policy</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.privacyLink}
              activeOpacity={0.7}
              onPress={() => Linking.openURL('https://j3k420.github.io/Gravestory/terms/')}
            >
              <Text style={styles.privacyLinkText}>Terms of Service</Text>
            </TouchableOpacity>

            {/* Delete account — destructive, set apart at the very bottom.
                Opens a type-to-confirm modal; never deletes on a single tap. */}
            <TouchableOpacity
              style={styles.deleteLink}
              activeOpacity={0.7}
              onPress={() => { setDeleteConfirmText(''); setDeleteModal(true); }}
            >
              <Text style={styles.deleteLinkText}>Delete Account</Text>
            </TouchableOpacity>
          </>
        ) : (
          <Text style={styles.notSignedIn}>Not signed in.</Text>
        )}

        {/* Build/bundle stamp — shows which JS bundle is actually running so OTA
            delivery is verifiable. `Updates.updateId` is null when running the
            build's EMBEDDED bundle (no OTA applied yet) and a UUID once an OTA is
            live. The short suffix is enough to tell two bundles apart. */}
        <Text style={styles.buildStamp}>
          {`v${Constants.expoConfig?.version || '?'} · ${
            Updates.updateId ? `OTA ${String(Updates.updateId).slice(0, 8)}` : 'embedded bundle'
          }`}
        </Text>
      </ScrollView>

      {/* Type-to-confirm account deletion */}
      <Modal
        visible={deleteModal}
        transparent
        animationType="fade"
        onRequestClose={() => !deleting && setDeleteModal(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Delete Account</Text>
            <Text style={styles.modalBody}>
              This permanently deletes your account, every story you've saved
              (including those on the community map), your photos, and any unused
              purchased scans. Unused scans are non-refundable. This cannot be undone.
            </Text>
            <Text style={styles.modalPrompt}>Type DELETE to confirm:</Text>
            <TextInput
              style={styles.modalInput}
              value={deleteConfirmText}
              onChangeText={setDeleteConfirmText}
              placeholder="DELETE"
              placeholderTextColor={colors.ashDim}
              autoCapitalize="characters"
              autoCorrect={false}
              keyboardAppearance="dark"
              editable={!deleting}
            />
            <TouchableOpacity
              style={[
                styles.modalDeleteBtn,
                (deleteConfirmText.trim().toUpperCase() !== 'DELETE' || deleting) && styles.modalDeleteBtnDisabled,
              ]}
              disabled={deleteConfirmText.trim().toUpperCase() !== 'DELETE' || deleting}
              activeOpacity={0.85}
              onPress={handleDeleteAccount}
            >
              {deleting
                ? <ActivityIndicator color={colors.parchment} />
                : <Text style={styles.modalDeleteText}>Permanently Delete</Text>}
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.modalCancelBtn}
              disabled={deleting}
              activeOpacity={0.7}
              onPress={() => setDeleteModal(false)}
            >
              <Text style={styles.modalCancelText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.ink },
  back: { padding: 24, paddingBottom: 0 },
  backText: { color: colors.ashDim, fontSize: 15, fontFamily: fonts.body },
  scroll: { padding: 24, paddingTop: 16, paddingBottom: 48 },

  title: {
    color: colors.parchment, fontSize: 28, fontFamily: fonts.title,
    letterSpacing: 0.5, marginBottom: 28,
  },

  section: {
    marginBottom: 20,
    borderWidth: 1, borderColor: colors.line,
    backgroundColor: colors.stone2,
    borderRadius: radius.sm, overflow: 'hidden',
  },
  sectionLabel: {
    color: colors.ashDim, fontSize: 10, letterSpacing: 2.5,
    textTransform: 'uppercase', fontFamily: fonts.body,
    paddingHorizontal: 14, paddingTop: 12, paddingBottom: 8,
  },

  infoRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 14, paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: colors.line,
  },
  infoKey: { color: colors.ash, fontSize: 13, fontFamily: fonts.body },
  infoVal: { color: colors.parchment, fontSize: 13, fontFamily: fonts.name, flex: 1, textAlign: 'right' },

  input: {
    color: colors.parchment, fontSize: 15, fontFamily: fonts.name,
    paddingHorizontal: 14, paddingVertical: 13,
    borderTopWidth: 1, borderTopColor: colors.line,
  },

  toggleRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 14, paddingVertical: 12,
    borderTopWidth: 1, borderTopColor: colors.line,
  },
  toggleTextGroup: { flex: 1, marginRight: 12 },
  toggleLabel: { color: colors.parchment, fontSize: 14, marginBottom: 3, fontFamily: fonts.body },
  toggleDesc: { color: colors.ash, fontSize: 12, fontFamily: fonts.bodyItalic, lineHeight: 17 },

  saveBtn: { paddingVertical: 15, borderRadius: radius.md, alignItems: 'center', backgroundColor: colors.flame, marginBottom: 24 },
  saveBtnText: { color: colors.onFlame, fontSize: 15, fontFamily: fonts.sansBold, letterSpacing: 0.5 },

  separator: { height: 1, backgroundColor: colors.line, marginBottom: 24 },

  // Rate button — gold-accented to invite the tap (a positive action), but not
  // as loud as the solid-flame Save CTA. Sits just above Sign Out.
  // Soft gold wash, lighter than the colors.glow token (0.18) so the Rate button
  // stays quieter than the gold CTAs — deliberately a bespoke 0.08, no token.
  rateBtn: {
    borderWidth: 1, borderColor: 'rgba(242,182,92,0.5)',
    backgroundColor: 'rgba(242,182,92,0.08)',
    paddingVertical: 15, borderRadius: radius.sm, alignItems: 'center',
    marginBottom: 14,
  },
  rateBtnText: { color: colors.flame, fontSize: 14, fontFamily: fonts.bodyMedium, letterSpacing: 0.5 },

  signOutBtn: {
    borderWidth: 1, borderColor: colors.line,
    backgroundColor: colors.stone2,
    paddingVertical: 15, borderRadius: radius.sm, alignItems: 'center',
  },
  signOutText: { color: colors.ash, fontSize: 14, fontFamily: fonts.body, letterSpacing: 0.5 },

  notSignedIn: { color: colors.ash, fontFamily: fonts.bodyItalic, textAlign: 'center', marginTop: 32 },

  privacyLink: { alignItems: 'center', paddingVertical: 20 },
  privacyLinkText: { color: colors.ashDim, fontSize: 12, fontFamily: fonts.body, textDecorationLine: 'underline' },
  buildStamp: { color: colors.ashDim, fontSize: 11, fontFamily: fonts.body, textAlign: 'center', paddingTop: 8, paddingBottom: 24, opacity: 0.7 },

  deleteLink: { alignItems: 'center', paddingTop: 4, paddingBottom: 24 },
  deleteLinkText: {
    color: 'rgba(207,122,58,0.85)', fontSize: 12, fontFamily: fonts.body,
    textDecorationLine: 'underline', letterSpacing: 0.3,
  },

  modalBackdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center', padding: 28,
  },
  modalCard: {
    backgroundColor: colors.stone, borderRadius: radius.lg,
    borderWidth: 1, borderColor: colors.line, padding: 22,
  },
  modalTitle: {
    color: colors.parchment, fontSize: 20, fontFamily: fonts.title,
    marginBottom: 12,
  },
  modalBody: {
    color: colors.ash, fontSize: 14, fontFamily: fonts.body,
    lineHeight: 21, marginBottom: 18,
  },
  modalPrompt: {
    color: colors.ashDim, fontSize: 11, letterSpacing: 1.5,
    textTransform: 'uppercase', fontFamily: fonts.body, marginBottom: 8,
  },
  modalInput: {
    color: colors.parchment, fontSize: 16, fontFamily: fonts.name,
    borderWidth: 1, borderColor: colors.line, borderRadius: radius.sm,
    backgroundColor: colors.ink, paddingHorizontal: 14, paddingVertical: 12,
    marginBottom: 18, letterSpacing: 2,
  },
  modalDeleteBtn: {
    backgroundColor: '#7a2e1c', borderRadius: radius.md,
    paddingVertical: 14, alignItems: 'center', marginBottom: 10,
  },
  modalDeleteBtnDisabled: { opacity: 0.4 },
  modalDeleteText: { color: colors.parchment, fontSize: 15, fontFamily: fonts.sansBold, letterSpacing: 0.5 },
  modalCancelBtn: { paddingVertical: 12, alignItems: 'center' },
  modalCancelText: { color: colors.ash, fontSize: 14, fontFamily: fonts.body },

  progressRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 14, paddingTop: 10, paddingBottom: 6,
    borderTopWidth: 1, borderTopColor: colors.line,
  },
  sectionHeaderRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingRight: 14,
  },
  sectionLabelInline: { flex: 1 },
  buyMoreLink: { color: colors.flame, fontSize: 12, fontFamily: fonts.bodyMedium },
  progressLabel: { color: colors.parchment, fontSize: 14, fontFamily: fonts.bodyMedium },
  progressFull:  { color: colors.ember, fontSize: 12, fontFamily: fonts.body },
  barTrack: {
    marginHorizontal: 14, height: 5, borderRadius: 3,
    backgroundColor: colors.line, overflow: 'hidden', marginBottom: 10,
  },
  barFill: { height: '100%', borderRadius: 3, backgroundColor: colors.flame },
  barFull: { backgroundColor: colors.ember },
  progressHint: {
    color: colors.ashDim, fontSize: 12, fontFamily: fonts.bodyItalic,
    paddingHorizontal: 14, paddingBottom: 12, lineHeight: 17,
  },
});
