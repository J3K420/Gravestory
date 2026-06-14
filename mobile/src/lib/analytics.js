// Funnel telemetry — fire-and-forget product events into the Supabase
// analytics_events table (migration 008). Mirrors js/analytics.js on web.
//
// Design rules:
//   - NEVER blocks or throws into the caller. logEvent returns immediately;
//     the insert runs detached and swallows its own errors. Telemetry must
//     not be able to break a scan.
//   - user_id is read from the cached session (works offline-ish); guests log
//     with NULL user_id, which the RLS INSERT policy allows.
//   - props is a small JSON bag of context (e.g. { confidence, subjects }).
//     Keep it lightweight — no base64, no full graveData.

import { Platform } from 'react-native';
import { supabase } from './supabase';

// Canonical event names — keep in sync with web js/analytics.js EVENTS.
export const EVENTS = {
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
  // Phase-B funnels (added 2026-06-13). Keep identical to web ANALYTICS_EVENTS.
  // paywall_shown / purchase_* are MOBILE-ONLY (web has no purchase flow).
  CEMETERY_RESOLVED:     'cemetery_resolved',
  PAYWALL_SHOWN:         'paywall_shown',
  PURCHASE_COMPLETED:    'purchase_completed',
  PURCHASE_FAILED:       'purchase_failed',
  MAP_OPENED:            'map_opened',
  TRIBUTE_LEFT:          'tribute_left',
  STORY_SHARED:          'story_shared',
  RESEARCH_YIELD:        'research_yield',
};

export function logEvent(event, props = {}) {
  // Detach: do not await, do not let a failure surface.
  (async () => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      await supabase.from('analytics_events').insert({
        user_id: session?.user?.id ?? null,
        event,
        props: props || {},
        platform: Platform.OS, // 'ios' | 'android'
      });
    } catch (e) {
      // Telemetry is best-effort. Warn only; never throw.
      console.warn('analytics logEvent failed (non-fatal):', e?.message);
    }
  })();
}
