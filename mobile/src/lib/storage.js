import AsyncStorage from '@react-native-async-storage/async-storage';

const storyKey = (userId) => userId ? `gs_stories_${userId}` : 'gs_stories_guest';

export async function loadStories(userId = null) {
  try {
    const raw = await AsyncStorage.getItem(storyKey(userId));
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export async function saveStories(stories, userId = null) {
  try {
    await AsyncStorage.setItem(storyKey(userId), JSON.stringify(stories));
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
