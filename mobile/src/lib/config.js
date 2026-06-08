import Constants from 'expo-constants';

export const PROXY_BASE = 'https://gravestory-proxy.james-gravestory.workers.dev';

// Shared client key sent as X-Client-Key on all proxy requests.
// Not a true secret (in client source) but blocks casual direct API abuse.
// Rotate by updating here + `wrangler secret put CLIENT_KEY`.
export const CLIENT_KEY = 'gs-client-2025';
// RevenueCat Android (Google) SDK key.
//
// The production key is NEVER committed here. It is stored as an EAS Secret:
//   npx eas secret:create --scope project --name REVENUECAT_API_KEY --value goog_...
// app.config.js reads process.env.REVENUECAT_API_KEY at build time and exposes it
// via expo.extra.revenueCatApiKey, which we read back through expo-constants below.
//
// The bare test key only ever applies to local `expo start` dev where no EAS Secret
// is injected. A test key MUST NOT reach a Play-distributed build — RevenueCat's SDK
// crashes release builds initialized with a test key by design. Production/preview
// builds always carry the real goog_ key via the EAS Secret.
const REVENUECAT_TEST_KEY = 'test_QDhrXlvJtoqBKvVLLCtRihKmkRC';

export const REVENUECAT_API_KEY =
  Constants.expoConfig?.extra?.revenueCatApiKey || REVENUECAT_TEST_KEY;
