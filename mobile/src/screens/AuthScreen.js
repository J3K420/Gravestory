import React, { useState } from 'react';
import {
  View, Text, TouchableOpacity,
  StyleSheet, KeyboardAvoidingView, Platform, ScrollView,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { supabase } from '../lib/supabase';
import { colors, fonts, radius } from '../lib/theme';
import GravestoneLogo from '../components/GravestoneLogo';

WebBrowser.maybeCompleteAuthSession();

// Sign-in is Google-only on mobile (S34) — the email/password UI was removed.
export default function AuthScreen({ navigation }) {
  const [status, setStatus]     = useState('');
  const [loading, setLoading]   = useState(false);
  const [signingIn, setSigningIn] = useState(false);

  async function signInWithGoogle() {
    setLoading(true);
    setStatus('');
    try {
      const redirectTo = Linking.createURL('login-callback');
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo, skipBrowserRedirect: true },
      });
      if (error) throw error;
      const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
      if (result.type === 'success') {
        // The browser has closed and this screen is visible again while the
        // code-for-session exchange round-trips to Supabase — show progress.
        setSigningIn(true);
        const params = new URLSearchParams(result.url.split('?')[1] ?? '');
        const code = params.get('code');
        if (!code) throw new Error('No code in callback URL');
        const { error: sessionError } = await supabase.auth.exchangeCodeForSession(code);
        if (sessionError) throw sessionError;
        navigation.goBack();
      } else {
        setStatus('Login cancelled');
      }
    } catch (err) {
      setStatus(err.message);
      setSigningIn(false);
    }
    setLoading(false);
  }

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
        >

          <TouchableOpacity
            onPress={() => navigation.goBack()}
            style={styles.back}
            activeOpacity={0.7}
            accessibilityRole="button"
            accessibilityLabel="Go back"
          >
            <Text style={styles.backText}>← Back</Text>
          </TouchableOpacity>

          {/* Brand */}
          <View style={styles.brand}>
            <GravestoneLogo size={90} animate={false} />
            <Text style={styles.title}>GraveStory</Text>
            <Text style={styles.subtitle}>Sign in to save your stories across devices</Text>
          </View>

          {/* Google */}
          {signingIn ? (
            <View style={styles.signingInRow}>
              <ActivityIndicator size="small" color={colors.flame} />
              <Text style={styles.signingInText}>Signing you in…</Text>
            </View>
          ) : (
            <TouchableOpacity
              style={[styles.googleBtn, loading && styles.googleBtnDisabled]}
              onPress={signInWithGoogle}
              disabled={loading}
              activeOpacity={0.85}
              accessibilityRole="button"
              accessibilityLabel="Continue with Google"
            >
              <Text style={styles.googleBtnText}>G Continue with Google</Text>
            </TouchableOpacity>
          )}

          {/* Reserved space for additional sign-in providers (e.g. Apple on iOS) */}

          {!!status && (
            <Text style={[styles.statusText, status.includes('Check') && { color: colors.moss }]}>
              {status}
            </Text>
          )}

        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.ink },
  scroll: { padding: 24, paddingBottom: 48 },

  back: { marginBottom: 16 },
  backText: { color: colors.ashDim, fontSize: 15, fontFamily: fonts.body },

  brand: { alignItems: 'center', marginBottom: 32, marginTop: 8 },
  title: { fontSize: 36, color: colors.parchment, fontFamily: fonts.title, marginTop: 12, letterSpacing: 0.5 },
  subtitle: { color: colors.ash, fontFamily: fonts.bodyItalic, fontSize: 14, marginTop: 8, textAlign: 'center', lineHeight: 20 },

  // '#ffffff' is Google's required brand background for the sign-in button — no
  // theme token maps to it, so it stays a literal by design.
  googleBtn: {
    backgroundColor: '#ffffff', paddingVertical: 15,
    borderRadius: radius.sm, alignItems: 'center', marginBottom: 20,
  },
  googleBtnDisabled: { opacity: 0.6 },
  googleBtnText: { color: colors.stone2, fontSize: 15, fontFamily: fonts.sansBold, letterSpacing: 0.3 },

  signingInRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingVertical: 15, marginBottom: 20, gap: 10,
  },
  signingInText: { color: colors.ash, fontSize: 15, fontFamily: fonts.bodyMedium, letterSpacing: 0.3 },

  statusText: { color: colors.danger, textAlign: 'center', marginTop: 16, fontSize: 13, fontFamily: fonts.body, lineHeight: 20 },
});
