// ─── Module: auth.js (read-only client) ───
//
// LANDING-PAGE CONVERSION (web → app-store pointer): the web app no longer signs
// users in. All sign-in/up/out + user-menu code was removed along with the auth
// screen. What survives is the bare Supabase client + a `currentUser` placeholder,
// because the surviving read paths reference them:
//   - js/map-global.js     — supabaseClient.rpc('global_public_stories', …)
//   - js/render-result.js  — supabaseClient.from('grave_photos')… (gallery)
//   - js/api-reports.js    — supabaseClient.from('content_reports').insert(…)
//   - js/analytics.js      — supabaseClient lazy read for event logging
// Every web Supabase touch is now a READ (or an anonymous content_reports/analytics
// INSERT, both RLS-permitted for anon). No session is established; `currentUser`
// stays null. The community map serves every visitor the full (signed-in-tier)
// row limit — see js/map-global.js.
//
// LOAD ORDER: must load AFTER the Supabase library script tag
// (@supabase/supabase-js), because createClient runs at parse time.

const SUPABASE_URL = 'https://idbrjonofqrsykqsqpwo.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlkYnJqb25vZnFyc3lrcXNxcHdvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg3MDYyMTUsImV4cCI6MjA5NDI4MjIxNX0.hF26KwrkhWRy7Z74YnEd6Oqr3brPSOOz9ykRQZOBWiw';

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false
  }
});

// No sign-in on web. Kept defined (not removed) because the surviving read paths
// reference it for gating that is now always-guest.
let currentUser = null;
