import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity,
  StyleSheet, SafeAreaView, KeyboardAvoidingView, Platform,
} from 'react-native';
import { supabase } from '../lib/supabase';

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
});
