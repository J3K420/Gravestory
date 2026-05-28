import React from 'react';
import { View, Text, ScrollView, TouchableOpacity, StyleSheet, SafeAreaView } from 'react-native';

// Placeholder — Phase 2 will wire up full biography rendering
export default function ResultScreen({ navigation, route }) {
  const story = route.params?.story;

  return (
    <SafeAreaView style={styles.container}>
      <TouchableOpacity onPress={() => navigation.goBack()} style={styles.back}>
        <Text style={styles.backText}>← Back</Text>
      </TouchableOpacity>
      <ScrollView contentContainerStyle={styles.scroll}>
        <Text style={styles.name}>{story?.name || 'Unknown'}</Text>
        <Text style={styles.dates}>{story?.dates || ''}</Text>
        {story?.location && <Text style={styles.location}>📍 {story.location}</Text>}
        <Text style={styles.bio}>{story?.biography || ''}</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0d0b08' },
  back: { padding: 24 },
  backText: { color: 'rgba(201,168,76,0.6)', fontSize: 15 },
  scroll: { padding: 24 },
  name: { color: '#e8d4a0', fontSize: 26, marginBottom: 6 },
  dates: { color: 'rgba(138,126,110,0.7)', fontStyle: 'italic', marginBottom: 8 },
  location: { color: '#c9a84c', fontSize: 13, marginBottom: 16 },
  bio: { color: '#e8d4a0', lineHeight: 24, fontSize: 15 },
});
