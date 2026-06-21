import { supabase } from './supabase';

// Returns tribute counts and whether the current user has left one.
// Wrapped in try/catch (mirrors web api-tributes.js): a network-level rejection
// of the Supabase query must NOT throw out of here — callers (mount effect,
// handleTribute) don't expect a rejection and a throw would leave the tribute
// UI wedged. No `.catch()` on the query builder (Hermes) — use try/catch.
export async function getTributes(graveId) {
  if (!graveId) return { candles: 0, flowers: 0, userTribute: null };

  try {
    const [{ data, error }, { data: { session } }] = await Promise.all([
      supabase.from('tributes').select('type, user_id').eq('grave_id', graveId),
      supabase.auth.getSession(),
    ]);

    if (error || !data) return { candles: 0, flowers: 0, userTribute: null };

    const userId = session?.user?.id ?? null;
    return {
      candles: data.filter(t => t.type === 'candle').length,
      flowers: data.filter(t => t.type === 'flower').length,
      userTribute: userId ? (data.find(t => t.user_id === userId)?.type ?? null) : null,
    };
  } catch (e) {
    console.warn('getTributes failed:', e?.message || e);
    return { candles: 0, flowers: 0, userTribute: null };
  }
}

// Sets or removes a tribute. type: 'candle' | 'flower' | null (null = remove).
// Returns true on success.
export async function setTribute(graveId, type) {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user || !graveId) return false;

    if (type === null) {
      const { error } = await supabase
        .from('tributes')
        .delete()
        .eq('grave_id', graveId)
        .eq('user_id', session.user.id);
      return !error;
    }

    const { error } = await supabase
      .from('tributes')
      .upsert(
        { grave_id: graveId, user_id: session.user.id, type },
        { onConflict: 'grave_id,user_id' }
      );
    return !error;
  } catch (e) {
    console.warn('setTribute failed:', e?.message || e);
    return false;
  }
}
