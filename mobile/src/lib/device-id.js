import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import * as Crypto from 'expo-crypto';

const CACHE_KEY = 'gs_device_id';

// Persistent per-install identifier for soft anti-abuse.
// Generated once from a random UUID + platform salt, then cached.
// Uses only expo-crypto (already native in every build) — no expo-device needed.
export async function getDeviceId() {
  const cached = await AsyncStorage.getItem(CACHE_KEY);
  if (cached) return cached;

  const random = Crypto.randomUUID();
  const salt   = `${Platform.OS}|${Platform.Version}`;

  const id = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    `${random}|${salt}`,
  );

  await AsyncStorage.setItem(CACHE_KEY, id);
  return id;
}
