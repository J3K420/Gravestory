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
