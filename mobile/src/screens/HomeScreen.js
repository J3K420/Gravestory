import React, { useEffect, useState } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView,
  StyleSheet, StatusBar, SafeAreaView,
} from 'react-native';
import { supabase } from '../lib/supabase';
import { loadStories } from '../lib/storage';

export default function HomeScreen({ navigation }) {
  const [user, setUser] = useState(null);
  const [stories, setStories] = useState([]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    loadStories().then(setStories);
  }, []);

  const displayName = user?.user_metadata?.full_name
    || user?.email?.split('@')[0]
    || null;

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0d0b08" />

      {/* User menu */}
      <TouchableOpacity
        style={styles.userBtn}
        onPress={() => navigation.navigate(user ? 'Settings' : 'Auth')}
      >
        <Text style={styles.userBtnText}>{displayName ?? 'Sign in'}</Text>
      </TouchableOpacity>

      <ScrollView contentContainerStyle={styles.scroll}>
        {/* Logo */}
        <View style={styles.logoArea}>
          <Text style={styles.logoTitle}>GraveStory</Text>
          <Text style={styles.logoSubtitle}>every life deserves to be remembered</Text>
        </View>

        <View style={styles.divider} />

        {/* Scan button */}
        <TouchableOpacity
          style={styles.scanBtn}
          onPress={() => navigation.navigate('Camera')}
        >
          <Text style={styles.scanBtnText}>✦ Scan a Gravestone ✦</Text>
        </TouchableOpacity>

        <Text style={styles.desc}>
          Photograph a gravestone. We'll uncover the story of the life it marks.
        </Text>

        {/* Saved stories */}
        <View style={styles.savedSection}>
          <Text style={styles.savedLabel}>✦ Remembered Stories</Text>
          {stories.length === 0 ? (
            <Text style={styles.emptySaved}>Your saved stories will appear here</Text>
          ) : (
            stories.map((story, i) => (
              <TouchableOpacity
                key={story.timestamp ?? i}
                style={styles.savedCard}
                onPress={() => navigation.navigate('Result', { story })}
              >
                <View>
                  <Text style={styles.savedName}>{story.name || 'Unknown'}</Text>
                  <Text style={styles.savedDates}>{story.dates || ''}</Text>
                </View>
                <Text style={styles.savedArrow}>›</Text>
              </TouchableOpacity>
            ))
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const GOLD = '#c9a84c';
const INK = '#0d0b08';
const PARCHMENT = '#e8d4a0';
const STONE = 'rgba(138,126,110,0.7)';

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: INK },
  scroll: { alignItems: 'center', padding: 24, paddingBottom: 48 },
  userBtn: {
    position: 'absolute', top: 56, right: 16, zIndex: 10,
    borderWidth: 1, borderColor: 'rgba(201,168,76,0.4)',
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 4,
    backgroundColor: 'rgba(20,15,10,0.6)',
  },
  userBtnText: { color: GOLD, fontSize: 14 },
  logoArea: { marginTop: 80, marginBottom: 32, alignItems: 'center' },
  logoTitle: {
    fontSize: 42, color: PARCHMENT, letterSpacing: 2, marginBottom: 8,
    fontWeight: '700',
  },
  logoSubtitle: { fontSize: 14, color: STONE, fontStyle: 'italic', letterSpacing: 2 },
  divider: {
    width: 120, height: 1, marginVertical: 24,
    backgroundColor: GOLD, opacity: 0.5,
  },
  scanBtn: {
    borderWidth: 1, borderColor: GOLD,
    paddingHorizontal: 32, paddingVertical: 16, borderRadius: 2,
  },
  scanBtnText: { color: GOLD, fontSize: 16, letterSpacing: 2 },
  desc: {
    color: STONE, fontStyle: 'italic', marginTop: 20,
    textAlign: 'center', lineHeight: 22, maxWidth: 280,
  },
  savedSection: { marginTop: 40, width: '100%' },
  savedLabel: {
    color: STONE, fontSize: 11, letterSpacing: 3,
    textTransform: 'uppercase', marginBottom: 12, textAlign: 'center',
  },
  emptySaved: { color: STONE, fontStyle: 'italic', textAlign: 'center', opacity: 0.6 },
  savedCard: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    borderWidth: 1, borderColor: 'rgba(201,168,76,0.15)',
    padding: 14, marginBottom: 8,
    backgroundColor: 'rgba(245,240,232,0.04)',
  },
  savedName: { color: PARCHMENT, fontSize: 15, marginBottom: 2 },
  savedDates: { color: STONE, fontSize: 13, fontStyle: 'italic' },
  savedArrow: { color: GOLD, fontSize: 22 },
});
