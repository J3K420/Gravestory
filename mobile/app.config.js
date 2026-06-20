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
      versionCode: 9,
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
          apiKey: process.env.GOOGLE_MAPS_ANDROID_API_KEY ?? '',
        },
      },
    },
    web: {
      favicon: './assets/favicon.png',
    },
    extra: {
      eas: {
        projectId: 'f26f7a8b-2c63-4a68-bb44-903d7ed01b30',
      },
      // RevenueCat Android (Google) SDK key. Injected from the EAS Secret
      // REVENUECAT_API_KEY at build time; read back via expo-constants in
      // src/lib/config.js. Empty in local dev unless the env var is set, in
      // which case config.js falls back to the RevenueCat test key.
      revenueCatApiKey: process.env.REVENUECAT_API_KEY ?? '',
    },
    plugins: [
      'expo-secure-store',
      'expo-font',
      'expo-web-browser',
      [
        'expo-location',
        {
          locationWhenInUsePermission:
            'Allow GraveStory to use your location to pin graves on the map.',
        },
      ],
      [
        // Android strips GPS EXIF from photos read through the system picker.
        // expo-media-library's getAssetInfoAsync does the ACCESS_MEDIA_LOCATION +
        // setRequireOriginal dance natively so library picks can recover the
        // photo's location. granularPermissions limited to images only —
        // READ_MEDIA_VIDEO/AUDIO would complicate Play Store review.
        'expo-media-library',
        {
          photosPermission:
            'Allow GraveStory to read photo location data so gravestone photos can be pinned on the map.',
          isAccessMediaLocationEnabled: true,
          granularPermissions: ['photo'],
        },
      ],
    ],
  },
};
