export const PROXY_BASE = 'https://gravestory-proxy.james-gravestory.workers.dev';

// Shared client key sent as X-Client-Key on all proxy requests.
// Not a true secret (in client source) but blocks casual direct API abuse.
// Rotate by updating here + `wrangler secret put CLIENT_KEY`.
export const CLIENT_KEY = 'gs-client-2025';
// WARNING: Never commit a production RevenueCat key here.
// This is a test key only. The production key must be stored as an EAS Secret
// (npx eas secret:create --scope project --name REVENUECAT_API_KEY --value <key>)
// and read via process.env.REVENUECAT_API_KEY in app.config.js.
export const REVENUECAT_API_KEY = 'test_WJSBtTAuUGRlLvGePwNHNqEFJeq';
