import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';

export const SCAN_LIMIT_GUEST = 3;
export const SCAN_LIMIT_USER  = 10;

const GUEST_COUNT_KEY = 'gs_scan_count';
const GUEST_MONTH_KEY = 'gs_scan_reset_month';

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
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
    const { data: { user } } = await supabase.auth.getUser();
    const meta = user?.user_metadata || {};
    if (meta.scan_reset_month !== currentMonth()) {
      await supabase.auth.updateUser({ data: { scan_count: 0, scan_reset_month: currentMonth() } });
    } else {
      count = meta.scan_count || 0;
    }
  }

  return { count, limit, atLimit: count >= limit, isGuest };
}

export async function incrementScanCount(userId) {
  if (!userId) {
    const stored = parseInt((await AsyncStorage.getItem(GUEST_COUNT_KEY)) || '0', 10);
    await AsyncStorage.setItem(GUEST_COUNT_KEY, String(stored + 1));
  } else {
    const { data: { user } } = await supabase.auth.getUser();
    const current = user?.user_metadata?.scan_count || 0;
    await supabase.auth.updateUser({ data: { scan_count: current + 1 } }).catch(() => {});
  }
}
