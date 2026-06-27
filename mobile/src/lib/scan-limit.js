import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';

// Guests get 0 scans (S66): they can explore the app and browse the community
// global map (see real bios to get a feel) WITHOUT an account, but scanning —
// the part that costs real Tavily/Gemini money — requires signing in. The first
// tap to scan routes a guest to the sign-in invite, not a "limit reached" wall.
export const SCAN_LIMIT_FREE_GUEST = 0;
// Signed-in free lifetime scans. Lowered 10 → 3 (S66): the research pipeline has
// no warm-up — scan #1 is the same quality as scan #10 — so a great first bio
// sells the app, and a user who'd need 10 to be convinced was never going to be.
// 3 lands the paywall at peak willingness-to-pay and signals product confidence.
export const SCAN_LIMIT_FREE_USER  = 3;

// Keep old export names so existing call sites don't break
export const SCAN_LIMIT_GUEST = SCAN_LIMIT_FREE_GUEST;
export const SCAN_LIMIT_USER  = SCAN_LIMIT_FREE_USER;

const GUEST_COUNT_KEY = 'gs_scan_count';

export async function checkScanLimit(userId, user = null) {
  const isGuest = !userId;

  if (isGuest) {
    const count = parseInt((await AsyncStorage.getItem(GUEST_COUNT_KEY)) || '0', 10);
    const limit = SCAN_LIMIT_FREE_GUEST;
    return { count, limit, atLimit: count >= limit, isGuest: true, purchased: 0 };
  }

  if (user?.app_metadata?.is_unlimited === true) {
    return { count: 0, limit: Infinity, atLimit: false, isGuest: false, purchased: 0 };
  }

  let usedCount = 0;
  let purchased = 0;

  try {
    // Lifetime scans used
    const { count: dbCount, error: countError } = await supabase
      .from('scan_events')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', userId);
    if (countError) throw countError;
    usedCount = dbCount ?? 0;

    // Purchased credits
    const { data: credits, error: creditsError } = await supabase
      .from('scan_credits')
      .select('purchased')
      .eq('user_id', userId)
      .maybeSingle();
    if (!creditsError && credits) purchased = credits.purchased ?? 0;
  } catch (e) {
    console.warn('scan limit check failed — blocking scan to prevent unlimited free usage:', e.message);
    // Fail-closed: if we can't verify the count, block rather than silently allow
    return { count: 0, limit: SCAN_LIMIT_FREE_USER, atLimit: true, isGuest: false, purchased: 0, _checkFailed: true };
  }

  // Total allowance = free trial + purchased credits
  const totalAllowance = SCAN_LIMIT_FREE_USER + purchased;
  const atLimit = usedCount >= totalAllowance;

  return { count: usedCount, limit: totalAllowance, atLimit, isGuest: false, purchased };
}

// NOTE (S78): the former client-side incrementScanCount() was REMOVED. Scans are now
// recorded SERVER-SIDE only, by commit_reservation via the Worker /commit-scan route
// (see scan-token.js commitScan). A client-side scan_events INSERT would be a second,
// untrusted write path to the cost counter — deliberately gone. checkScanLimit above
// stays as an advisory pre-picker fast-path; reserve_scan is the authoritative gate.
