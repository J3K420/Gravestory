import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Device from 'expo-device';
import * as Crypto from 'expo-crypto';

const CACHE_KEY = 'gs_device_id';

// SHA-256 hash of stable hardware properties, cached across restarts.
// Survives reinstall (same hardware → same hash) so soft limits are harder
// to reset by reinstalling alone.
export async function getDeviceId() {
  const cached = await AsyncStorage.getItem(CACHE_KEY);
  if (cached) return cached;

  const input = [
    Device.brand ?? '',
    Device.modelName ?? '',
    Device.osName ?? '',
    Device.osVersion ?? '',
    String(Device.totalMemory ?? ''),
  ].join('|');

  const id = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    input,
  );

  await AsyncStorage.setItem(CACHE_KEY, id);
  return id;
}
