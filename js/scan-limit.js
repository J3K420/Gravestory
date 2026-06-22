// js/scan-limit.js — Freemium scan + save limits for the web app.
// Mirrors the mobile scan-limit.js / save-limit.js logic.
// Depends on: supabaseClient (auth.js), currentUser (auth.js), savedStories (index.html).

// Guests get 0 scans (S66) — they can browse the app + community global map
// WITHOUT an account, but scanning (real Tavily/Gemini cost) requires sign-in.
const WEB_SCAN_LIMIT_GUEST  = 0;
// Signed-in free lifetime scans. Lowered 10 → 3 (S66) — keep in sync with
// mobile SCAN_LIMIT_FREE_USER. The pipeline has no warm-up (scan #1 == scan #10
// in quality), so a strong first bio sells the app; 3 lands the paywall at peak
// willingness-to-pay and signals product confidence.
const WEB_SCAN_LIMIT_USER   = 3;
const WEB_GUEST_SCAN_KEY    = 'gs_web_scan_count';

// Expose on window so other classic scripts (e.g. user-prefs.js) can read the
// free-scan limit from this single source of truth regardless of load order.
window.WEB_SCAN_LIMIT_USER = WEB_SCAN_LIMIT_USER;

async function checkWebScanLimit() {
  const isGuest = !currentUser;

  if (isGuest) {
    const count = parseInt(localStorage.getItem(WEB_GUEST_SCAN_KEY) || '0', 10);
    const limit = WEB_SCAN_LIMIT_GUEST;
    return { count, limit, atLimit: count >= limit, isGuest: true, purchased: 0 };
  }

  let usedCount = 0;
  let purchased = 0;
  const isUnlimited = currentUser?.app_metadata?.is_unlimited === true;
  if (isUnlimited) return { count: 0, limit: Infinity, atLimit: false, isGuest: false, purchased: 0 };

  try {
    const { count: dbCount, error: countErr } = await supabaseClient
      .from('scan_events')
      .select('*', { count: 'exact', head: true })
      .eq('user_id', currentUser.id);
    if (countErr) throw countErr;
    usedCount = dbCount ?? 0;

    const { data: credits, error: credErr } = await supabaseClient
      .from('scan_credits')
      .select('purchased')
      .eq('user_id', currentUser.id)
      .maybeSingle();
    if (!credErr && credits) purchased = credits.purchased ?? 0;
  } catch (e) {
    console.warn('⚠️ Scan limit check failed — conservatively blocking scan:', e.message);
    // Fail-closed: if we can't verify the count, block rather than allow unlimited free scans
    return { count: 0, limit: WEB_SCAN_LIMIT_USER, atLimit: true, isGuest: false, purchased: 0, _checkFailed: true };
  }

  const totalAllowance = WEB_SCAN_LIMIT_USER + purchased;
  return { count: usedCount, limit: totalAllowance, atLimit: usedCount >= totalAllowance, isGuest: false, purchased };
}

async function incrementWebScanCount() {
  if (!currentUser) {
    const stored = parseInt(localStorage.getItem(WEB_GUEST_SCAN_KEY) || '0', 10);
    localStorage.setItem(WEB_GUEST_SCAN_KEY, String(stored + 1));
    return;
  }
  try {
    const { error } = await supabaseClient.from('scan_events').insert({ user_id: currentUser.id });
    if (error) throw error;
  } catch (e) {
    console.warn('⚠️ Failed to record scan event — scan proceeded but was not counted:', e.message);
  }
}

// Saved-story limits have been removed — saving is free. Kept as a no-op in case
// any caller still references it; always returns atLimit: false.
function checkWebSaveLimit() {
  const count = (savedStories || []).filter(s => !s._deletedAt).length;
  return { count, limit: Infinity, atLimit: false, isGuest: !currentUser };
}
