import { supabase } from './supabase';

// Submit a user report of an AI-generated biography (mobile).
// Mirrors js/api-reports.js. Open to guests AND signed-in users; writes to the
// content_reports table (RLS: INSERT-by-anyone, no client read-back —
// migration 013). Non-fatal: resolves false on any failure, never throws.

export const REPORT_REASONS = [
  { id: 'factual_error', label: 'Factual error' },
  { id: 'wrong_person',  label: 'Wrong person' },
  { id: 'offensive',     label: 'Offensive or inappropriate' },
  { id: 'privacy',       label: 'Privacy concern / about a living person' },
  { id: 'other',         label: 'Something else' },
];

export const REPORT_NOTE_MAX = 600;

export async function submitContentReport({ storyTs, graveId, personName, reason, note, isPublic }) {
  if (!reason || !REPORT_REASONS.some(r => r.id === reason)) return false;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const row = {
      story_ts: storyTs != null ? String(storyTs) : null,
      grave_id: graveId || null,
      person_name: personName ? String(personName).slice(0, 200) : null,
      reason,
      note: note ? String(note).trim().slice(0, REPORT_NOTE_MAX) : null,
      reporter_id: session?.user?.id ?? null,  // RLS requires null or our own id
      is_public: !!isPublic,
      platform: 'mobile',
    };
    const { error } = await supabase.from('content_reports').insert(row);
    if (error) {
      console.warn('submitContentReport failed:', error.message);
      return false;
    }
    return true;
  } catch (e) {
    console.warn('submitContentReport threw:', e.message);
    return false;
  }
}
