import Constants from 'expo-constants';

export const PROXY_BASE = 'https://gravestory-proxy.james-gravestory.workers.dev';

// Shared client key sent as X-Client-Key on all proxy requests.
// Not a true secret (in client source) but blocks casual direct API abuse.
// Rotate by updating here + `wrangler secret put CLIENT_KEY`.
export const CLIENT_KEY = 'gs-client-2025';
// RevenueCat Android (Google) SDK key.
//
// The production key is NEVER committed here. It is provided as an EAS env var
// REVENUECAT_API_KEY with **Sensitive** visibility (NOT Secret — Secret vars are
// build-only and are NOT injected into `eas update` OTA bundles, which made OTAs
// silently fall back to the test key and crash the release build). RC Android
// SDK keys are public-by-design (shipped in every APK), so Sensitive is correct.
//
// app.config.js reads process.env.REVENUECAT_API_KEY (at build AND update time)
// and exposes it via expo.extra.revenueCatApiKey, read back through expo-constants.
//
// The bare test key only ever applies to local `expo start` dev (__DEV__). A test
// key MUST NOT reach a Play-distributed build — RevenueCat's SDK crashes release
// builds initialized with a test key by design. So in a non-dev build we refuse
// to fall back to the test key: REVENUECAT_API_KEY is '' and the caller must guard.
const REVENUECAT_TEST_KEY = 'test_QDhrXlvJtoqBKvVLLCtRihKmkRC';

const _injectedKey = Constants.expoConfig?.extra?.revenueCatApiKey || '';

// In release builds, never substitute the test key — a missing real key means the
// env var wasn't injected (e.g. an OTA bundled without the Sensitive var). Returning
// '' lets App.js skip Purchases.configure() instead of crashing the whole app.
export const REVENUECAT_API_KEY = _injectedKey || (__DEV__ ? REVENUECAT_TEST_KEY : '');

// Increment 2 — see web js/config.js. Single source, byte-parallel values.
export const ORIGINATE_RELATIVES = true;
export const ORIGINATE_PATH_B = false;
