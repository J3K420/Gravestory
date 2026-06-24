// Mobile GEDCOM export — write the story's GEDCOM to a real file the user can keep.
//
// TWO PATHS:
//   • Android  → Storage Access Framework: the user picks a folder, we create the
//     .ged THERE, so the file lands in a real, user-chosen location (Downloads,
//     Documents, a Drive folder, etc.) and we can tell them exactly where. Fixes
//     the "share sheet has no Save button → file seems to vanish" confusion.
//   • iOS      → expo-sharing share sheet (which already offers "Save to Files").
//
// OWNER-ONLY: callers gate on !story._isGlobal && !story._isSample (the Result
// chip does); we re-check here (defense in depth). Fail-soft — every path returns
// a {ok, reason, ...} result and NEVER throws into the screen.
//
// OTA-SAFE: StorageAccessFramework lives on the SAME expo-file-system/legacy
// module already imported (FileSystem.StorageAccessFramework) and expo-sharing is
// already a native dep (shipped in versionCode 14). No NEW native module → ships
// over OTA, no rebuild.
//
// expo-file-system v19 (SDK 54) moved the URI helpers to /legacy (the default
// export throws at runtime) — same convention as pending.js / api-wikipedia.js.

import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { buildGedcom, gedcomFilename } from './gedcom';

const EXPORT_DIR = FileSystem.documentDirectory + 'exports/';
// The share-sheet path advertises the precise GEDCOM type. The Android SAF save
// path deliberately does NOT: Android derives the saved file's extension from the
// MIME via MimeTypeMap, and 'application/x-gedcom' is absent from AOSP's table, so
// it would append NOTHING and the file would land with no .ged extension (genealogy
// apps + file browsers filter by extension → it wouldn't import on tap). So the SAF
// path supplies the FULL "slug.ged" name itself and uses octet-stream, which keeps
// the explicit .ged across providers (ExternalStorageProvider + Drive). [review HIGH]
const GED_MIME_SHARE = 'application/x-gedcom';
const GED_MIME_SAF = 'application/octet-stream';

// Best-effort human-readable folder name out of a SAF tree URI, for the
// confirmation message. SAF URIs look like:
//   content://com.android.externalstorage.documents/tree/primary%3ADownload
// We decode and take the leaf segment after the last ':' or '/'. Returns '' if we
// can't parse it OR if the leaf is a meaningless volume id (e.g. "0000-0000" for an
// SD card) — the caller then falls back to a generic "the folder you chose".
export function safFolderLabel(uri) {
  try {
    if (!uri) return '';
    const decoded = decodeURIComponent(String(uri));
    const afterColon = decoded.includes(':') ? decoded.split(':').pop() : decoded;
    const leaf = afterColon.split('/').filter(Boolean).pop() || '';
    // Suppress raw volume ids (SD-card / OEM "XXXX-XXXX") — meaningless to a user.
    if (/^[0-9a-f]{4}-[0-9a-f]{4}$/i.test(leaf)) return '';
    return leaf;
  } catch {
    return '';
  }
}

// ── ANDROID: write into a user-picked SAF folder ─────────────────────────────
async function saveToDeviceAndroid(story) {
  const SAF = FileSystem.StorageAccessFramework;
  if (!SAF || typeof SAF.requestDirectoryPermissionsAsync !== 'function') {
    return { ok: false, reason: 'saf-unavailable' };
  }

  let perm;
  try {
    perm = await SAF.requestDirectoryPermissionsAsync();
  } catch (e) {
    console.warn('GEDCOM SAF permission request failed (non-fatal):', e?.message);
    return { ok: false, reason: 'error' };
  }
  // User cancelled the folder picker → quiet no-op (NOT an error).
  if (!perm || !perm.granted) return { ok: false, reason: 'permission-denied' };

  // Declared outside the try so the catch can clean up a created-but-unwritten file.
  let fileUri = null;
  try {
    const text = buildGedcom(story);            // always non-empty (legacy fallback)
    // Supply the FULL "slug.ged" name (with extension) + octet-stream — see the
    // GED_MIME_SAF note above. Passing the explicit .ged keeps the suffix intact.
    fileUri = await SAF.createFileAsync(perm.directoryUri, gedcomFilename(story), GED_MIME_SAF);
    await SAF.writeAsStringAsync(fileUri, text, { encoding: FileSystem.EncodingType.UTF8 });
    return { ok: true, savedTo: safFolderLabel(perm.directoryUri), uri: fileUri };
  } catch (e) {
    console.warn('GEDCOM SAF write failed (non-fatal):', e?.message);
    // createFileAsync may have already created an empty file in the user's folder
    // before the write threw — delete it so we don't leave a 0-byte .ged behind.
    if (fileUri) { try { await SAF.deleteAsync(fileUri); } catch { /* best-effort */ } }
    return { ok: false, reason: 'write-failed' };
  }
}

// ── iOS / fallback: write to app dir + system share sheet (offers Save to Files)
async function shareFromAppDir(story) {
  const available = await Sharing.isAvailableAsync();
  if (!available) return { ok: false, reason: 'sharing-unavailable' };

  const text = buildGedcom(story);
  const info = await FileSystem.getInfoAsync(EXPORT_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(EXPORT_DIR, { intermediates: true });
  }
  const uri = EXPORT_DIR + gedcomFilename(story);  // keep .ged here (plain file write)
  await FileSystem.writeAsStringAsync(uri, text, { encoding: FileSystem.EncodingType.UTF8 });

  await Sharing.shareAsync(uri, {
    mimeType: GED_MIME_SHARE,
    dialogTitle: 'Export GEDCOM',
    UTI: 'public.data',
  });
  return { ok: true };   // share sheet is its own confirmation; no savedTo
}

// Public entry point. Android → SAF save (real folder + confirmation);
// other platforms → share sheet. Never throws.
export async function exportStoryGedcom(story) {
  if (!story) return { ok: false, reason: 'no-story' };
  if (story._isGlobal || story._isSample) return { ok: false, reason: 'not-owner' };

  if (Platform.OS === 'android') {
    // saveToDeviceAndroid already try/catches its risky calls; the outer guard
    // is belt-and-suspenders so a surprise throw still returns fail-soft.
    try {
      return await saveToDeviceAndroid(story);
    } catch (e) {
      console.warn('GEDCOM export (android) failed (non-fatal):', e?.message);
      return { ok: false, reason: 'error' };
    }
  }

  try {
    return await shareFromAppDir(story);
  } catch (e) {
    console.warn('GEDCOM export (share) failed (non-fatal):', e?.message);
    return { ok: false, reason: 'error' };
  }
}
