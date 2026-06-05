import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';

export const SCAN_LIMIT_GUEST = 3;
export const SCAN_LIMIT_USER  = 5;

const GUEST_COUNT_KEY = 'gs_scan_count';

export async function checkScanLimit(userId) {
  const isGuest = !userId;
  const limit   = isGuest ? SCAN_LIMIT_GUEST : SCAN_LIMIT_USER;
  let count = 0;

  if (isGuest) {
    count = parseInt((await AsyncStorage.getItem(GUEST_COUNT_KEY)) || '0', 10);
  } else {
    try {
      const { count: dbCount, error } = await supabase
        .from('scan_events')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId);
      if (!error) count = dbCount ?? 0;
    } catch (e) {
      console.warn('scan_events count failed (non-fatal):', e.message);
    }
  }

  return { count, limit, atLimit: count >= limit, isGuest };
}

export async function incrementScanCount(userId) {
  if (!userId) {
    const stored = parseInt((await AsyncStorage.getItem(GUEST_COUNT_KEY)) || '0', 10);
    await AsyncStorage.setItem(GUEST_COUNT_KEY, String(stored + 1));
  } else {
    try {
      await supabase.from('scan_events').insert({ user_id: userId });
    } catch (e) {
      console.warn('scan_events insert failed (non-fatal):', e.message);
    }
  }
}
