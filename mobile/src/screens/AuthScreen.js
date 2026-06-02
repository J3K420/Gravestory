import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import { supabase } from '../lib/supabase';

WebBrowser.maybeCompleteAuthSession();

export default function AuthScreen({ navigation }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);

  async function signIn() {
    if (!email || !password) { setStatus('Email and password required'); return; }
    setLoading(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) { setStatus('❌ ' + error.message); }
    else { navigation.goBack(); }
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
        setStatus('❌ Login cancelled (' + result.type + ')');
      }
    } catch (err) {
      setStatus('❌ ' + err.message);
    }
    setLoading(false);
  }

  async function signUp() {
    if (!email || !password) { setStatus('Email and password required'); return; }
    if (password.length < 6) { setStatus('Password must be at least 6 characters'); return; }
    setLoading(true);
    const { data, error } = await supabase.auth.signUp({ email, password });
    setLoading(false);
    if (error) { setStatus('❌ ' + error.message); }
    else if (data.user && !data.session) { setStatus('✅ Check your email to verify your account'); }
    else { navigation.goBack(); }
  }

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.inner}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.back}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>

        <Text style={styles.title}>Sign in to GraveStory</Text>
        <Text style={styles.subtitle}>Save your stories across devices</Text>

        <TouchableOpacity style={styles.googleBtn} onPress={signInWithGoogle} disabled={loading}>
          <Text style={styles.googleBtnText}>G  Continue with Google</Text>
        </TouchableOpacity>

        <View style={styles.orRow}>
          <View style={styles.orLine} />
          <Text style={styles.orText}>or</Text>
          <View style={styles.orLine} />
        </View>

        <TextInput
          style={styles.input}
          placeholder="Email"
          placeholderTextColor="rgba(201,168,76,0.4)"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
        />
        <TextInput
          style={styles.input}
          placeholder="Password"
          placeholderTextColor="rgba(201,168,76,0.4)"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
        />

        <View style={styles.btnRow}>
          <TouchableOpacity style={styles.btnPrimary} onPress={signIn} disabled={loading}>
            <Text style={styles.btnPrimaryText}>{loading ? '…' : 'Sign in'}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.btnSecondary} onPress={signUp} disabled={loading}>
            <Text style={styles.btnSecondaryText}>Create account</Text>
          </TouchableOpacity>
        </View>

        {!!status && <Text style={styles.statusText}>{status}</Text>}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const GOLD = '#c9a84c';
const PARCHMENT = '#e8d4a0';

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0d0b08' },
  inner: { flex: 1, padding: 24 },
  back: { marginBottom: 32 },
  backText: { color: 'rgba(201,168,76,0.6)', fontSize: 15 },
  title: { color: GOLD, fontSize: 26, textAlign: 'center', marginBottom: 6 },
  subtitle: { color: 'rgba(201,168,76,0.6)', fontSize: 13, textAlign: 'center', fontStyle: 'italic', marginBottom: 32 },
  input: {
    backgroundColor: 'rgba(20,15,10,0.5)', borderWidth: 1,
    borderColor: 'rgba(201,168,76,0.3)', color: PARCHMENT,
    padding: 12, borderRadius: 4, marginBottom: 12, fontSize: 15,
  },
  btnRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  btnPrimary: {
    flex: 1, backgroundColor: 'rgba(201,168,76,0.2)',
    borderWidth: 1, borderColor: 'rgba(201,168,76,0.5)',
    padding: 14, borderRadius: 4, alignItems: 'center',
  },
  btnPrimaryText: { color: GOLD, fontSize: 15 },
  btnSecondary: {
    flex: 1, backgroundColor: 'rgba(20,15,10,0.5)',
    borderWidth: 1, borderColor: 'rgba(201,168,76,0.3)',
    padding: 14, borderRadius: 4, alignItems: 'center',
  },
  btnSecondaryText: { color: 'rgba(201,168,76,0.8)', fontSize: 15 },
  statusText: { color: 'rgba(201,168,76,0.7)', textAlign: 'center', marginTop: 16, fontSize: 14 },
  googleBtn: {
    backgroundColor: '#fff', paddingVertical: 14, borderRadius: 4,
    alignItems: 'center', marginBottom: 16,
  },
  googleBtnText: { color: '#3c3c3c', fontSize: 15, fontWeight: '600', letterSpacing: 0.5 },
  orRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  orLine: { flex: 1, height: 1, backgroundColor: 'rgba(201,168,76,0.2)' },
  orText: { color: 'rgba(201,168,76,0.5)', marginHorizontal: 12, fontSize: 13 },
});
