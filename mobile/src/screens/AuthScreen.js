import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, KeyboardAvoidingView, Platform, ScrollView, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { supabase } from '../lib/supabase';
import { colors, fonts, radius } from '../lib/theme';
import GravestoneLogo from '../components/GravestoneLogo';

WebBrowser.maybeCompleteAuthSession();

export default function AuthScreen({ navigation }) {
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus]     = useState('');
  const [loading, setLoading]   = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  function onRefresh() {
    setRefreshing(true);
    setEmail('');
    setPassword('');
    setStatus('');
    setRefreshing(false);
  }

  async function signIn() {
    if (!email || !password) { setStatus('Email and password required'); return; }
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) setStatus(error.message);
    else navigation.goBack();
  }

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
    }
    setLoading(false);
  }

  async function signUp() {
    if (!email || !password) { setStatus('Email and password required'); return; }
    if (password.length < 6) { setStatus('Password must be at least 6 characters'); return; }
    setLoading(true);
    const { data, error } = await supabase.auth.signUp({ email, password });
    setLoading(false);
    if (error) setStatus(error.message);
    else if (data.user && !data.session) setStatus('Check your email to verify your account');
    else navigation.goBack();
  }

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.flame} colors={[colors.flame]} />}
        >

          <TouchableOpacity onPress={() => navigation.goBack()} style={styles.back}>
            <Text style={styles.backText}>← Back</Text>
          </TouchableOpacity>

          {/* Brand */}
          <View style={styles.brand}>
            <GravestoneLogo size={90} animate={false} />
            <Text style={styles.title}>GraveStory</Text>
            <Text style={styles.subtitle}>Sign in to save your stories across devices</Text>
          </View>

          {/* Google */}
          <TouchableOpacity style={styles.googleBtn} onPress={signInWithGoogle} disabled={loading} activeOpacity={0.85}>
            <Text style={styles.googleBtnText}>G  Continue with Google</Text>
          </TouchableOpacity>

          {/* Divider */}
          <View style={styles.orRow}>
            <View style={styles.orLine} />
            <Text style={styles.orText}>or</Text>
            <View style={styles.orLine} />
          </View>

          {/* Email / password */}
          <TextInput
            style={styles.input}
            placeholder="Email"
            placeholderTextColor={colors.ashDim}
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            keyboardType="email-address"
            keyboardAppearance="dark"
          />
          <TextInput
            style={[styles.input, { marginBottom: 0 }]}
            placeholder="Password"
            placeholderTextColor={colors.ashDim}
            value={password}
            onChangeText={setPassword}
            secureTextEntry
            keyboardAppearance="dark"
          />

          {/* Buttons */}
          <TouchableOpacity onPress={signIn} disabled={loading} activeOpacity={0.88} style={styles.primaryBtn}>
            <Text style={styles.primaryBtnText}>{loading ? '…' : 'Sign in'}</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.ghostBtn} onPress={signUp} disabled={loading}>
            <Text style={styles.ghostBtnText}>Create account</Text>
          </TouchableOpacity>

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

  googleBtn: {
    backgroundColor: '#ffffff', paddingVertical: 15,
    borderRadius: radius.sm, alignItems: 'center', marginBottom: 20,
  },
  googleBtnText: { color: '#2a2017', fontSize: 15, fontFamily: fonts.sansBold, letterSpacing: 0.3 },

  orRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 20 },
  orLine: { flex: 1, height: 1, backgroundColor: colors.line },
  orText: { color: colors.ashDim, marginHorizontal: 12, fontSize: 12, fontFamily: fonts.body },

  input: {
    backgroundColor: colors.stone2, borderWidth: 1,
    borderColor: colors.line, color: colors.parchment,
    padding: 14, borderRadius: radius.sm,
    marginBottom: 12, fontSize: 15, fontFamily: fonts.body,
  },

  primaryBtn: {
    marginTop: 16, paddingVertical: 15, borderRadius: radius.md,
    alignItems: 'center', justifyContent: 'center', backgroundColor: colors.flame,
  },
  primaryBtnText: { color: colors.onFlame, fontSize: 15, fontFamily: fonts.sansBold, letterSpacing: 0.5 },

  ghostBtn: {
    marginTop: 10, paddingVertical: 15, borderRadius: radius.sm,
    borderWidth: 1, borderColor: colors.line,
    backgroundColor: colors.stone2, alignItems: 'center',
  },
  ghostBtnText: { color: colors.parchment, fontSize: 15, fontFamily: fonts.body },

  statusText: { color: colors.danger, textAlign: 'center', marginTop: 16, fontSize: 13, fontFamily: fonts.body, lineHeight: 20 },
});
