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

// Device-global first-run flag (not user-scoped) — gates the one-time Home tip
// card + auto-shown sample story. Returns true once the user has seen onboarding.
const FIRST_RUN_KEY = 'gs_onboarded';

export async function hasOnboarded() {
  try {
    return (await AsyncStorage.getItem(FIRST_RUN_KEY)) === 'true';
  } catch {
    return true; // fail "seen" so we never nag on a storage error
  }
}

export async function setOnboarded() {
  try {
    await AsyncStorage.setItem(FIRST_RUN_KEY, 'true');
  } catch {}
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
