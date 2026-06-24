// ── CONFIG ──────────────────────────────────────────────────────
// API keys live server-side in the Cloudflare Worker proxy.
// Update PROXY_BASE to your deployed Worker URL after running `wrangler deploy`.
// Example: 'https://gravestory-proxy.YOUR-SUBDOMAIN.workers.dev'
const PROXY_BASE = 'https://gravestory-proxy.james-gravestory.workers.dev';

// Shared client key sent as X-Client-Key on all proxy requests.
// This is not a true secret (it's in client source) but blocks casual direct API abuse
// and can be rotated without touching the app. Set the matching value via:
//   wrangler secret put CLIENT_KEY
// NOT a substitute for ALLOWED_ORIGIN — both defences should be active.
const CLIENT_KEY = 'gs-client-2025';

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
