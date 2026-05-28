import AsyncStorage from '@react-native-async-storage/async-storage';

const STORIES_KEY = 'gravestories';

export async function loadStories() {
  try {
    const raw = await AsyncStorage.getItem(STORIES_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export async function saveStories(stories) {
  try {
    await AsyncStorage.setItem(STORIES_KEY, JSON.stringify(stories));
  } catch (e) {
    console.warn('Storage write failed:', e.message);
  }
}

export async function getLastSync(userId) {
  try {
    return await AsyncStorage.getItem(`gs_last_sync_${userId}`);
  } catch {
    return null;
  }
}

export async function setLastSync(userId, iso) {
  try {
    await AsyncStorage.setItem(`gs_last_sync_${userId}`, iso);
  } catch {}
}
