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
  { id: 'copyright',     label: 'Copyright or ownership concern' },
  { id: 'spam',          label: 'Spam or scam' },
  { id: 'other',         label: 'Something else' },
];

export const CONTRIBUTOR_REPORT_REASONS = [
  { id: 'harassment', label: 'Harassment or threats' },
  { id: 'hate', label: 'Hateful conduct' },
  { id: 'sexual_content', label: 'Sexual content' },
  { id: 'violence', label: 'Graphic violence' },
  { id: 'spam', label: 'Spam or scam' },
  { id: 'other', label: 'Something else' },
];

export const REPORT_NOTE_MAX = 600;

export async function submitContentReport({
  storyId,
  storyTs,
  graveId,
  personName,
  reason,
  note,
  isPublic,
  targetUserId,
  targetType = 'story',
}) {
  const validReasons = [...REPORT_REASONS, ...CONTRIBUTOR_REPORT_REASONS];
  if (!reason || !validReasons.some(r => r.id === reason)) return false;
  if (!['story', 'user'].includes(targetType)) return false;
  try {
    const { data: { session } } = await supabase.auth.getSession();
    const row = {
      story_ts: storyTs != null ? String(storyTs) : null,
      story_id: storyId || null,
      grave_id: graveId || null,
      person_name: personName ? String(personName).slice(0, 200) : null,
      reason,
      note: note ? String(note).trim().slice(0, REPORT_NOTE_MAX) : null,
      reporter_id: session?.user?.id ?? null,  // RLS requires null or our own id
      target_user_id: targetUserId || null,
      target_type: targetType,
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

export function submitContributorReport({ story, reason, note }) {
  return submitContentReport({
    storyId: story?.id || null,
    storyTs: story?.timestamp || null,
    graveId: story?.grave_id || null,
    personName: story?.name || null,
    reason,
    note,
    isPublic: true,
    targetUserId: story?._contributorId || null,
    targetType: 'user',
  });
}
