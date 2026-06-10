// media-gps.js — recover GPS EXIF from library-picked photos on Android.
//
// Since Android 10 the OS redacts GPS tags from any photo stream an app reads
// through the media provider, so expo-image-picker's asset.exif never contains
// location data on Android (the web app is unaffected — browsers hand over raw
// file bytes). expo-media-library's getAssetInfoAsync() holds
// ACCESS_MEDIA_LOCATION and calls MediaStore.setRequireOriginal natively,
// which is the only sanctioned way to read the unredacted location.
//
// Requires the picker to be launched with legacy: true on Android — the modern
// system Photo Picker returns URIs that carry no MediaStore assetId, and its
// streams cannot be unredacted at all.
//
// expo-media-library is a NATIVE module: this file must keep the require()
// lazy and guarded so an OTA update landing on an older binary (built before
// the module was added) degrades to "no GPS" instead of crashing at startup.

import { Platform } from 'react-native';

export async function getLibraryAssetGps(assetId) {
  if (Platform.OS !== 'android' || !assetId) return null;

  let MediaLibrary;
  try {
    MediaLibrary = require('expo-media-library');
  } catch (e) {
    // Binary predates expo-media-library — behave as if no GPS was found.
    return null;
  }

  try {
    let perm = await MediaLibrary.getPermissionsAsync(false, ['photo']);
    if (!perm.granted) {
      perm = await MediaLibrary.requestPermissionsAsync(false, ['photo']);
    }
    if (!perm.granted) return null;

    const info = await MediaLibrary.getAssetInfoAsync(assetId);
    const loc = info?.location;
    if (typeof loc?.latitude === 'number' && typeof loc?.longitude === 'number' &&
        (loc.latitude !== 0 || loc.longitude !== 0)) {
      return { lat: loc.latitude, lng: loc.longitude };
    }
    return null;
  } catch (e) {
    console.warn('Media-library GPS lookup failed:', e.message);
    return null;
  }
}
