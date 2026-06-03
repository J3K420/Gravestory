import React, { useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, Switch,
  StyleSheet, Alert, ScrollView, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../lib/supabase';
import { useRefresh } from '../lib/use-refresh';
import { colors, fonts, radius } from '../lib/theme';

export default function SettingsScreen({ navigation }) {
  const [user, setUser]                 = useState(null);
  const [displayName, setDisplayName]   = useState('');
  const [defaultPublic, setDefaultPublic] = useState(false);
  const [saving, setSaving]             = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session?.user) return;
      setUser(session.user);
      setDisplayName(session.user.user_metadata?.full_name || session.user.email?.split('@')[0] || '');
      setDefaultPublic(session.user.user_metadata?.default_public ?? false);
    });
  }, []);

  const { refreshControl } = useRefresh(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user) {
      setUser(session.user);
      setDisplayName(session.user.user_metadata?.full_name || session.user.email?.split('@')[0] || '');
      setDefaultPublic(session.user.user_metadata?.default_public ?? false);
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

  const provider = user?.app_metadata?.provider;
  const providerLabel = provider === 'google'
    ? 'Google'
    : provider === 'email'
      ? 'Email / password'
      : provider || '—';

  return (
    <SafeAreaView style={styles.container}>
      <TouchableOpacity onPress={() => navigation.goBack()} style={styles.back}>
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

            {/* Sign out */}
            <TouchableOpacity style={styles.signOutBtn} onPress={handleSignOut}>
              <Text style={styles.signOutText}>Sign Out</Text>
            </TouchableOpacity>
          </>
        ) : (
          <Text style={styles.notSignedIn}>Not signed in.</Text>
        )}
      </ScrollView>
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

  signOutBtn: {
    borderWidth: 1, borderColor: colors.line,
    backgroundColor: colors.stone2,
    paddingVertical: 15, borderRadius: radius.sm, alignItems: 'center',
  },
  signOutText: { color: colors.ash, fontSize: 14, fontFamily: fonts.body, letterSpacing: 0.5 },

  notSignedIn: { color: colors.ash, fontFamily: fonts.bodyItalic, textAlign: 'center', marginTop: 32 },
});
