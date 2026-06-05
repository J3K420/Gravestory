import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';

export const SCAN_LIMIT_FREE_GUEST = 3;
export const SCAN_LIMIT_FREE_USER  = 10;

// Keep old export names so existing call sites don't break
export const SCAN_LIMIT_GUEST = SCAN_LIMIT_FREE_GUEST;
export const SCAN_LIMIT_USER  = SCAN_LIMIT_FREE_USER;

const GUEST_COUNT_KEY = 'gs_scan_count';

export async function checkScanLimit(userId) {
  const isGuest = !userId;

  if (isGuest) {
    const count = parseInt((await AsyncStorage.getItem(GUEST_COUNT_KEY)) || '0', 10);
    const limit = SCAN_LIMIT_FREE_GUEST;
    return { count, limit, atLimit: count >= limit, isGuest: true, purchased: 0 };
  }

  let usedCount   = 0;
  let purchased   = 0;

  try {
    // Lifetime scans used
    const { count: dbCount, error: countError } = await supabase
      .from('scan_events')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);
    if (!countError) usedCount = dbCount ?? 0;

    // Purchased credits
    const { data: credits, error: creditsError } = await supabase
      .from('scan_credits')
      .select('purchased')
      .eq('user_id', userId)
      .maybeSingle();
    if (!creditsError && credits) purchased = credits.purchased ?? 0;
  } catch (e) {
    console.warn('scan limit check failed (non-fatal):', e.message);
  }

  // Total allowance = free trial + purchased credits
  const totalAllowance = SCAN_LIMIT_FREE_USER + purchased;
  const atLimit = usedCount >= totalAllowance;

  return { count: usedCount, limit: totalAllowance, atLimit, isGuest: false, purchased };
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
