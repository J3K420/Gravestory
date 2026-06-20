import { PROXY_BASE, CLIENT_KEY } from './config';
import { supabase } from './supabase';

// Permanently delete the signed-in user's account and ALL their data via the
// Worker's /delete-account endpoint (service-role; bypasses RLS). IRREVERSIBLE.
//
// Auth: we send the user's OWN access token as a Bearer header — the Worker
// verifies it against Supabase and scopes every delete to that verified
// user_id, so a token can only ever delete its own account. We also send the
// shared X-Client-Key (the Worker's origin-less auth gate requires it).
//
// Returns { ok: true } on success, or { ok: false, error } so the caller can
// surface a message and NOT sign the user out (their account still exists).
export async function deleteAccount() {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) {
    return { ok: false, error: 'You appear to be signed out. Please sign in again.' };
  }

  try {
    const res = await fetch(`${PROXY_BASE}/delete-account`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Client-Key': CLIENT_KEY,
        'Authorization': `Bearer ${token}`,
      },
    });
    if (!res.ok) {
      let detail = '';
      try { detail = (await res.json())?.error || ''; } catch { /* ignore */ }
      return { ok: false, error: detail || `Deletion failed (${res.status}). Please try again.` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e?.message || 'Network error. Please try again.' };
  }
}
