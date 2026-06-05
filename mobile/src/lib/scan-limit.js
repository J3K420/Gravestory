import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';

export const SCAN_LIMIT_GUEST = 3;
export const SCAN_LIMIT_USER  = 5;

const GUEST_COUNT_KEY = 'gs_scan_count';
const GUEST_MONTH_KEY = 'gs_scan_reset_month';

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthStart() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString();
}

export async function checkScanLimit(userId) {
  const isGuest = !userId;
  const limit   = isGuest ? SCAN_LIMIT_GUEST : SCAN_LIMIT_USER;
  let count = 0;

  if (isGuest) {
    const month = await AsyncStorage.getItem(GUEST_MONTH_KEY);
    if (month !== currentMonth()) {
      await AsyncStorage.multiSet([[GUEST_MONTH_KEY, currentMonth()], [GUEST_COUNT_KEY, '0']]);
    } else {
      count = parseInt((await AsyncStorage.getItem(GUEST_COUNT_KEY)) || '0', 10);
    }
  } else {
    try {
      const { count: dbCount, error } = await supabase
        .from('scan_events')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .gte('scanned_at', monthStart());
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
