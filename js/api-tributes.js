// api-tributes.js — Candle/flower tribute counts per canonical grave (web, Stage 8f)
//
// PUBLIC API (auto-attached to window via function declarations):
//   getTributes(graveId)          — fetch counts + current user's tribute
//   setTribute(graveId, type)     — upsert or remove a tribute (type: 'candle'|'flower'|null)
//
// EXTERNAL DEPENDENCIES:
//   supabaseClient  — js/auth.js (module-local but window-visible)
//   currentUser     — js/auth.js

// Returns { candles, flowers, userTribute } for the given grave.
// userTribute is 'candle', 'flower', or null.
async function getTributes(graveId) {
  if (!graveId) return { candles: 0, flowers: 0, userTribute: null };

  try {
    const { data, error } = await supabaseClient
      .from('tributes')
      .select('type, user_id')
      .eq('grave_id', graveId);

    if (error || !data) return { candles: 0, flowers: 0, userTribute: null };

    const userId = currentUser?.id ?? null;
    return {
      candles: data.filter(t => t.type === 'candle').length,
      flowers: data.filter(t => t.type === 'flower').length,
      userTribute: userId ? (data.find(t => t.user_id === userId)?.type ?? null) : null,
    };
  } catch (e) {
    console.warn('getTributes failed:', e.message);
    return { candles: 0, flowers: 0, userTribute: null };
  }
}

// Sets or removes the current user's tribute for a grave.
// type: 'candle' | 'flower' | null (null removes existing tribute)
// Returns true on success.
async function setTribute(graveId, type) {
  if (!currentUser || !graveId) return false;

  try {
    if (type === null) {
      const { error } = await supabaseClient
        .from('tributes')
        .delete()
        .eq('grave_id', graveId)
        .eq('user_id', currentUser.id);
      return !error;
    }

    const { error } = await supabaseClient
      .from('tributes')
      .upsert(
        { grave_id: graveId, user_id: currentUser.id, type },
        { onConflict: 'grave_id,user_id' }
      );
    return !error;
  } catch (e) {
    console.warn('setTribute failed:', e.message);
    return false;
  }
}
