const DEFAULT_PUBLIC_CONFIG = Object.freeze({
  workerOrigin: 'https://gravestory-proxy.james-gravestory.workers.dev',
  supabaseOrigin: 'https://idbrjonofqrsykqsqpwo.supabase.co',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImlkYnJqb25vZnFyc3lrcXNxcHdvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg3MDYyMTUsImV4cCI6MjA5NDI4MjIxNX0.hF26KwrkhWRy7Z74YnEd6Oqr3brPSOOz9ykRQZOBWiw',
  clientKey: 'gs-client-2025',
});

function exactHttpsOrigin(value, name) {
  let url;
  try { url = new URL(value); } catch { throw new Error(`${name} must be an exact HTTPS origin`); }
  if (url.protocol !== 'https:' || url.origin !== value || url.username || url.password) {
    throw new Error(`${name} must be an exact HTTPS origin`);
  }
  return value;
}

function requiredPublicValue(value, name) {
  if (typeof value !== 'string' || !value.trim() || /(?:^|[-_<])(?:paste|placeholder|replace|change|changeme|your|todo|tbd|insert)(?:$|[-_>:])/i.test(value.trim())) {
    throw new Error(`${name} must be a non-placeholder public value`);
  }
  return value.trim();
}

export function resolveMobileDeployConfig(overrides = {}) {
  const unknown = Object.keys(overrides).filter((key) => !Object.hasOwn(DEFAULT_PUBLIC_CONFIG, key));
  if (unknown.length) throw new Error(`Unknown mobile public configuration: ${unknown.join(', ')}`);
  const value = Object.fromEntries(Object.keys(DEFAULT_PUBLIC_CONFIG).map((key) => [
    key,
    requiredPublicValue(overrides[key] ?? DEFAULT_PUBLIC_CONFIG[key], key),
  ]));
  exactHttpsOrigin(value.workerOrigin, 'workerOrigin');
  exactHttpsOrigin(value.supabaseOrigin, 'supabaseOrigin');
  return Object.freeze(value);
}

function conditionalPublicIdentifier(env, feature, flag, input) {
  const state = env[flag];
  if (state !== undefined && state !== 'true' && state !== 'false') {
    throw new Error(`${flag} must be explicitly true or false when supplied`);
  }
  const supplied = env[input] !== undefined && env[input] !== '';
  const enabled = state === 'true' || (state === undefined && supplied);
  if (state === 'false' && supplied) {
    throw new Error(`${input} requires ${flag}=true`);
  }
  return {
    enabled,
    feature,
    value: enabled ? requiredPublicValue(env[input], input) : '',
  };
}

export function resolveMobileBuildInputs(env = process.env) {
  const googleMaps = conditionalPublicIdentifier(env, 'google-maps', 'GRAVESTORY_ENABLE_GOOGLE_MAPS', 'GOOGLE_MAPS_ANDROID_API_KEY');
  const revenueCat = conditionalPublicIdentifier(env, 'revenuecat', 'GRAVESTORY_ENABLE_REVENUECAT', 'REVENUECAT_API_KEY');
  return Object.freeze({
    enabledFeatures: [googleMaps, revenueCat].filter((item) => item.enabled).map((item) => item.feature),
    googleMapsApiKey: googleMaps.value,
    revenueCatApiKey: revenueCat.value,
  });
}

const deployConfig = resolveMobileDeployConfig();
const buildInputs = resolveMobileBuildInputs();

export default {
  expo: {
    name: 'GraveStory',
    slug: 'mobile',
    owner: 'j3k420',
    scheme: 'gravestory',
    version: '1.0.0',
    orientation: 'portrait',
    updates: {
      url: 'https://u.expo.dev/f26f7a8b-2c63-4a68-bb44-903d7ed01b30',
      enabled: true,
      fallbackToCacheTimeout: 0,
    },
    runtimeVersion: {
      policy: 'sdkVersion',
    },
    icon: './assets/icon.png',
    userInterfaceStyle: 'dark',
    splash: {
      image: './assets/splash.png',
      resizeMode: 'contain',
      backgroundColor: '#0d0b08',
    },
    ios: {
      bundleIdentifier: 'com.gravestory.app',
      supportsTablet: true,
    },
    android: {
      package: 'com.gravestory.app',
      versionCode: 16,
      // The RevenueCat (react-native-purchases) and Play Services SDKs add
      // com.google.android.gms.permission.AD_ID to the merged manifest by default.
      // GraveStory does NOT read the advertising ID, so we strip it here to keep the
      // manifest consistent with the Data safety declaration ("Advertising ID: not
      // collected"). A manifest-vs-declaration mismatch is a top Play rejection cause.
      blockedPermissions: ['com.google.android.gms.permission.AD_ID'],
      adaptiveIcon: {
        backgroundColor: '#14100b',
        foregroundImage: './assets/android-icon-foreground.png',
        backgroundImage: './assets/android-icon-background.png',
        monochromeImage: './assets/android-icon-monochrome.png',
      },
      config: {
        googleMaps: {
          // Key lives in .env (gitignored) locally, or in EAS Secrets for builds.
          // Restrict this key in Google Cloud Console to your app's package name
          // + SHA-1 certificate so it's useless even if extracted from the APK.
          apiKey: buildInputs.googleMapsApiKey,
        },
      },
    },
    web: {
      favicon: './assets/favicon.png',
    },
    extra: {
      deployConfig,
      eas: {
        projectId: 'f26f7a8b-2c63-4a68-bb44-903d7ed01b30',
      },
      // RevenueCat Android (Google) SDK key. Injected from the EAS Secret
      // REVENUECAT_API_KEY at build time; read back via expo-constants in
      // src/lib/config.js. Empty in local dev unless the env var is set, in
      // which case config.js falls back to the RevenueCat test key.
      revenueCatApiKey: buildInputs.revenueCatApiKey,
    },
    plugins: [
      'expo-secure-store',
      'expo-font',
      'expo-web-browser',
      [
        // expo-image-picker is auto-applied by prebuild (it's an autolinked dep) and
        // by default adds android.permission.RECORD_AUDIO to the merged manifest. We
        // only ever pick still images (mediaTypes: ['images']) and never record audio,
        // so we drop the mic permission here to keep the manifest consistent with the
        // Data safety declaration ("Microphone: not used"). microphonePermission:false
        // both omits the iOS usage string and blocks RECORD_AUDIO on Android. Same
        // manifest-hygiene reasoning as the AD_ID blockedPermission above; a sensitive
        // permission with no matching feature is a Play permissions-policy flag risk.
        'expo-image-picker',
        {
          microphonePermission: false,
        },
      ],
      [
        'expo-location',
        {
          locationWhenInUsePermission:
            'Allow GraveStory to use your location to pin graves on the map.',
        },
      ],
      // NOTE: expo-media-library was removed to comply with Google Play's photo &
      // video permissions policy. It held READ_MEDIA_IMAGES purely to recover the
      // OS-redacted GPS EXIF from library-picked photos (auto-pin). Our photo use is
      // "infrequent" under the policy (occasional gravestone pick via the system
      // photo picker), which is disallowed from holding READ_MEDIA_IMAGES. The system
      // picker (expo-image-picker, no legacy:true) needs no broad media permission.
      // Camera shots still auto-pin via device GPS; famous graves via Wikidata burial
      // coords; ordinary gallery photos fall back to manual pin placement on the map.
      [
        // Local-only notifications: fire a "your story is ready" notification when
        // a scan finishes while the app is backgrounded. No remote push / tokens.
        // The plugin adds POST_NOTIFICATIONS to the Android manifest (Android 13+),
        // which is why adding it requires a fresh native build, not an OTA.
        // No `icon` asset yet — Android falls back to the app icon, tinted `color`
        // (theme `flame`); a dedicated monochrome notification icon is a follow-up.
        'expo-notifications',
        {
          color: '#f2b65c',
        },
      ],
    ],
  },
};
