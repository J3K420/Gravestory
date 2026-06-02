import React, { useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, Switch,
  StyleSheet, Alert, ScrollView, ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '../lib/supabase';

export default function SettingsScreen({ navigation }) {
  const [user, setUser] = useState(null);
  const [displayName, setDisplayName] = useState('');
  const [defaultPublic, setDefaultPublic] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session?.user) return;
      setUser(session.user);
      setDisplayName(session.user.user_metadata?.full_name || session.user.email?.split('@')[0] || '');
      setDefaultPublic(session.user.user_metadata?.default_public ?? false);
    });
  }, []);

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

  async function handleSignOut() {
    await supabase.auth.signOut();
    navigation.goBack();
  }

  const provider = user?.app_metadata?.provider;
  const providerLabel = provider === 'google' ? 'Google' : provider === 'email' ? 'Email / password' : provider || '—';

  return (
    <SafeAreaView style={styles.container}>
      <TouchableOpacity onPress={() => navigation.goBack()} style={styles.back}>
        <Text style={styles.backText}>← Back</Text>
      </TouchableOpacity>

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Account</Text>

        {user ? (
          <>
            {/* Account info */}
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>Account Info</Text>
              <View style={styles.infoRow}>
                <Text style={styles.infoKey}>Email</Text>
                <Text style={styles.infoVal}>{user.email}</Text>
              </View>
              <View style={[styles.infoRow, styles.infoRowLast]}>
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
                placeholderTextColor="rgba(138,126,110,0.4)"
                autoCorrect={false}
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
                  trackColor={{ false: 'rgba(138,126,110,0.3)', true: 'rgba(201,168,76,0.6)' }}
                  thumbColor={defaultPublic ? GOLD : '#888'}
                />
              </View>
            </View>

            {/* Save button */}
            <TouchableOpacity style={styles.saveBtn} onPress={saveProfile} disabled={saving}>
              {saving
                ? <ActivityIndicator color={GOLD} />
                : <Text style={styles.saveBtnText}>Save Changes</Text>}
            </TouchableOpacity>

            <View style={styles.divider} />

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

const GOLD      = '#c9a84c';
const INK       = '#0d0b08';
const PARCHMENT = '#e8d4a0';
const STONE     = 'rgba(138,126,110,0.7)';

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: INK },
  back: { padding: 24, paddingBottom: 0 },
  backText: { color: 'rgba(201,168,76,0.6)', fontSize: 15 },
  content: { padding: 24, paddingTop: 16 },
  title: { color: PARCHMENT, fontSize: 24, fontWeight: '700', letterSpacing: 1, marginBottom: 28 },

  section: {
    marginBottom: 28,
    borderWidth: 1, borderColor: 'rgba(201,168,76,0.15)',
    backgroundColor: 'rgba(245,240,232,0.04)',
    borderRadius: 2,
    overflow: 'hidden',
  },
  sectionLabel: {
    color: STONE, fontSize: 10, letterSpacing: 2.5, textTransform: 'uppercase',
    paddingHorizontal: 14, paddingTop: 12, paddingBottom: 8,
  },

  infoRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 14, paddingVertical: 10,
    borderTopWidth: 1, borderTopColor: 'rgba(201,168,76,0.08)',
  },
  infoRowLast: {},
  infoKey: { color: STONE, fontSize: 13 },
  infoVal: { color: PARCHMENT, fontSize: 13 },

  input: {
    color: PARCHMENT, fontSize: 15,
    paddingHorizontal: 14, paddingVertical: 12,
    borderTopWidth: 1, borderTopColor: 'rgba(201,168,76,0.08)',
  },

  toggleRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 14, paddingVertical: 12,
    borderTopWidth: 1, borderTopColor: 'rgba(201,168,76,0.08)',
  },
  toggleTextGroup: { flex: 1, marginRight: 12 },
  toggleLabel: { color: PARCHMENT, fontSize: 14, marginBottom: 3 },
  toggleDesc: { color: STONE, fontSize: 12, fontStyle: 'italic', lineHeight: 16 },

  saveBtn: {
    borderWidth: 1, borderColor: GOLD,
    paddingVertical: 14, borderRadius: 2, marginBottom: 24,
    alignItems: 'center',
  },
  saveBtnText: { color: GOLD, fontSize: 15, letterSpacing: 1.5 },

  divider: { height: 1, backgroundColor: 'rgba(201,168,76,0.12)', marginBottom: 24 },

  signOutBtn: {
    borderWidth: 1, borderColor: 'rgba(201,168,76,0.3)',
    paddingVertical: 14, borderRadius: 2,
  },
  signOutText: { color: STONE, textAlign: 'center', letterSpacing: 1.5 },

  notSignedIn: { color: STONE, fontStyle: 'italic', textAlign: 'center', marginTop: 32 },
});
