// js/analytics.js — Funnel telemetry for the web app. Mirrors mobile
// src/lib/analytics.js. Classic script: logEvent attaches to window, reads the
// supabaseClient + currentUser globals (defined in auth.js / index.html).
//
// Load order: AFTER config.js, BEFORE callers. supabaseClient may not exist yet
// at parse time — that's fine, logEvent resolves it lazily at call time and is a
// no-op if it's still missing.
//
// Design rules (same as mobile):
//   - NEVER blocks or throws into the caller; the insert runs detached and
//     swallows its own errors. Telemetry must not break a scan.
//   - Guests log with NULL user_id (RLS INSERT policy allows it).
//   - Keep props small — context only, never base64 or full graveData.

// Canonical event names — keep in sync with mobile EVENTS.
const ANALYTICS_EVENTS = {
  SCAN_STARTED:          'scan_started',
  SCAN_LIMIT_HIT:        'scan_limit_hit',
  VERIFICATION_REJECTED: 'verification_rejected',
  VERIFICATION_BYPASSED: 'verification_bypassed',
  OCR_DONE:              'ocr_done',
  BIO_CACHE_HIT:         'bio_cache_hit',
  BIO_SHOWN:             'bio_shown',
  PIPELINE_ERROR:        'pipeline_error',
  STORY_SAVED:           'story_saved',
  MADE_PUBLIC:           'made_public',
  SAMPLE_VIEWED:         'sample_viewed',
};

function logEvent(event, props) {
  // Detach: do not await, do not let a failure surface to the caller.
  (async () => {
    try {
      if (typeof supabaseClient === 'undefined' || !supabaseClient) return;
      const uid = (typeof currentUser !== 'undefined' && currentUser) ? currentUser.id : null;
      await supabaseClient.from('analytics_events').insert({
        user_id: uid,
        event,
        props: props || {},
        platform: 'web',
      });
    } catch (e) {
      console.warn('analytics logEvent failed (non-fatal):', e && e.message);
    }
  })();
}
