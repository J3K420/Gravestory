// ── CONFIG ──────────────────────────────────────────────────────
// Deploy-varying public handles live at this static-web release boundary. They
// are public by design (the browser must receive them), but their values are
// validated and fingerprinted by tools/deploy-config.mjs before release.
globalThis.GRAVESTORY_DEPLOY_CONFIG = Object.freeze({
  workerOrigin: 'https://gravestory-proxy.james-gravestory.workers.dev',
  supabaseOrigin: 'https://idbrjonofqrsykqsqpwo.supabase.co',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlkYnJqb25vZnFyc3lrcXNxcHdvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg3MDYyMTUsImV4cCI6MjA5NDI4MjIxNX0.hF26KwrkhWRy7Z74YnEd6Oqr3brPSOOz9ykRQZOBWiw',
  clientKey: 'gs-client-2025',
});

const PROXY_BASE = globalThis.GRAVESTORY_DEPLOY_CONFIG.workerOrigin;

// Shared client key sent as X-Client-Key on all proxy requests.
// This is not a true secret (it's in client source) but blocks casual direct API abuse
// and can be rotated without touching the app. Set the matching value via:
//   wrangler secret put CLIENT_KEY
// NOT a substitute for ALLOWED_ORIGIN — both defences should be active.
const CLIENT_KEY = globalThis.GRAVESTORY_DEPLOY_CONFIG.clientKey;

// Increment 2 — WikiTree spouse-name origination into the OWNER'S PRIVATE bio
// only. When false the PRODUCER side is fully inert (no origination, no synthetic
// source, no prompt block). The CONSUMER side (the deterministic public strip +
// the 5 write-site guards) is NEVER gated on this flag — it runs whenever a story
// carries originated names, so a story persisted while the flag was ON stays
// protected after the flag is flipped OFF. Ship dark.
const ORIGINATE_RELATIVES = true;
// Path B (stone names NOBODY -> strict-high origination) is a namesake-fabrication
// risk on common names; ship it OFF and enable only after telemetry. Path A
// (a stone-named spouse independently confirmed) is the only path live in Inc2.
const ORIGINATE_PATH_B = false;
