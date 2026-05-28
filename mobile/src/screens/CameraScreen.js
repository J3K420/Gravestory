import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, SafeAreaView } from 'react-native';

// Placeholder — Phase 2 will wire up expo-image-picker and the Gemini pipeline
export default function CameraScreen({ navigation }) {
  return (
    <SafeAreaView style={styles.container}>
      <TouchableOpacity onPress={() => navigation.goBack()} style={styles.back}>
        <Text style={styles.backText}>← Back</Text>
      </TouchableOpacity>
      <View style={styles.center}>
        <Text style={styles.title}>Photograph the Stone</Text>
        <Text style={styles.subtitle}>Camera integration coming in Phase 2</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0d0b08' },
  back: { padding: 24 },
  backText: { color: 'rgba(201,168,76,0.6)', fontSize: 15 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  title: { color: '#e8d4a0', fontSize: 22, marginBottom: 12 },
  subtitle: { color: 'rgba(138,126,110,0.7)', fontStyle: 'italic' },
});
