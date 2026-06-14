// api-reports.js — Submit user reports of AI-generated biographies (web)
//
// PUBLIC API (auto-attached to window via function declarations):
//   submitContentReport({ storyTs, graveId, personName, reason, note, isPublic })
//       → resolves true on success, false on failure (non-fatal; never throws)
//
// EXTERNAL DEPENDENCIES:
//   supabaseClient  — js/auth.js (window-visible)
//   currentUser     — js/auth.js (null for guests)
//
// Backs the "Report this story" affordance in the AI-disclaimer caption. Open
// to guests AND signed-in users (a relative who finds a wrong public bio can
// flag it without an account). Writes to the content_reports table, whose RLS
// allows INSERT-by-anyone but no client read-back (migration 013).

const REPORT_REASONS = [
  { id: 'factual_error', label: 'Factual error' },
  { id: 'wrong_person',  label: 'Wrong person' },
  { id: 'offensive',     label: 'Offensive or inappropriate' },
  { id: 'privacy',       label: 'Privacy concern / about a living person' },
  { id: 'other',         label: 'Something else' },
];

// Note is length-capped client-side; the column is unbounded TEXT but there's
// no reason to accept an essay.
const REPORT_NOTE_MAX = 600;

async function submitContentReport({ storyTs, graveId, personName, reason, note, isPublic }) {
  if (!reason || !REPORT_REASONS.some(r => r.id === reason)) return false;
  try {
    const row = {
      story_ts: storyTs ? String(storyTs) : null,
      grave_id: graveId || null,
      person_name: personName ? String(personName).slice(0, 200) : null,
      reason,
      note: note ? String(note).trim().slice(0, REPORT_NOTE_MAX) : null,
      reporter_id: currentUser?.id ?? null,   // RLS requires this be null or our own id
      is_public: !!isPublic,
      platform: 'web',
    };
    const { error } = await supabaseClient.from('content_reports').insert(row);
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
