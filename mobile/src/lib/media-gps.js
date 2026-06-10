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

// getLibraryAssetGps returns { gps, reason }:
//   gps    — { lat, lng } on success, else null
//   reason — a short diagnostic code naming why GPS was NOT recovered, so the
//            silent-failure modes (denied permission, cloud-only Google Photos
//            pick, modern-picker URI with no assetId) can be told apart at
//            runtime instead of all collapsing to a single null. Callers that
//            only want the coords can read `.gps`.
//
// Reason codes:
//   'not-android'    — iOS/web; expo-media-library recovery is Android-only
//   'no-asset-id'    — picker returned no MediaStore assetId (modern Photo
//                      Picker / cloud share target). Unrecoverable.
//   'module-missing' — binary predates expo-media-library (old OTA target)
//   'permission'     — user denied the photo-location permission prompt
//   'no-location'    — asset has no stored location (e.g. cloud-backed Google
//                      Photos that never synced original EXIF, screenshot, etc.)
//   'error'          — getAssetInfoAsync threw
export async function getLibraryAssetGps(assetId) {
  if (Platform.OS !== 'android') return { gps: null, reason: 'not-android' };
  if (!assetId) return { gps: null, reason: 'no-asset-id' };

  let MediaLibrary;
  try {
    MediaLibrary = require('expo-media-library');
  } catch (e) {
    // Binary predates expo-media-library — behave as if no GPS was found.
    return { gps: null, reason: 'module-missing' };
  }

  try {
    let perm = await MediaLibrary.getPermissionsAsync(false, ['photo']);
    if (!perm.granted) {
      perm = await MediaLibrary.requestPermissionsAsync(false, ['photo']);
    }
    if (!perm.granted) return { gps: null, reason: 'permission' };

    const info = await MediaLibrary.getAssetInfoAsync(assetId);
    const loc = info?.location;
    if (typeof loc?.latitude === 'number' && typeof loc?.longitude === 'number' &&
        (loc.latitude !== 0 || loc.longitude !== 0)) {
      return { gps: { lat: loc.latitude, lng: loc.longitude }, reason: null };
    }
    return { gps: null, reason: 'no-location' };
  } catch (e) {
    console.warn('Media-library GPS lookup failed:', e.message);
    return { gps: null, reason: 'error' };
  }
}
