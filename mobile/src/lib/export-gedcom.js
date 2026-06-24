// Mobile GEDCOM export — write the story's GEDCOM to a real .ged file and hand it
// to the system share sheet, where the user picks a destination (Save to Files,
// Google Drive, email, a genealogy app, …).
//
// WHY THE SHARE SHEET (not a folder picker): Android's Storage Access Framework
// folder picker BLOCKS the Download folder and the storage root ("Can't use this
// folder — to protect your privacy, choose another folder"), and on a non-standard
// MIME it dropped the .ged extension — both confusing. The share sheet sidesteps
// all of that: it works on both platforms, keeps the proper "slug.ged" filename,
// and its "Save to Files" target IS the save action (it's an icon among the share
// targets, not a separate button — the calling screen's copy makes that clear).
//
// OWNER-ONLY: callers gate on !story._isGlobal && !story._isSample (the Result
// chip does); we re-check here (defense in depth). Fail-soft — returns {ok, reason}
// and NEVER throws into the screen.
//
// OTA-SAFE: expo-sharing is already a native dep (shipped in versionCode 14). No
// new native module → ships over OTA, no rebuild.
//
// expo-file-system v19 (SDK 54) moved the URI helpers to /legacy (the default
// export throws at runtime) — same convention as pending.js / api-wikipedia.js.

import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { buildGedcom, gedcomFilename } from './gedcom';

const EXPORT_DIR = FileSystem.documentDirectory + 'exports/';
const GED_MIME = 'application/x-gedcom';

// Write the .ged to the app's private dir, then open the system share sheet so the
// user routes it wherever they want (Save to Files / Drive / email / a tree app).
// Never throws — returns {ok, reason}.
export async function exportStoryGedcom(story) {
  if (!story) return { ok: false, reason: 'no-story' };
  if (story._isGlobal || story._isSample) return { ok: false, reason: 'not-owner' };

  try {
    const available = await Sharing.isAvailableAsync();
    if (!available) return { ok: false, reason: 'sharing-unavailable' };

    const text = buildGedcom(story);   // always non-empty (legacy single-INDI fallback)
    const info = await FileSystem.getInfoAsync(EXPORT_DIR);
    if (!info.exists) {
      await FileSystem.makeDirectoryAsync(EXPORT_DIR, { intermediates: true });
    }
    // Keep the proper "slug.ged" filename — a plain file write preserves the
    // extension (unlike SAF's MIME-derived naming, which dropped it).
    const uri = EXPORT_DIR + gedcomFilename(story);
    await FileSystem.writeAsStringAsync(uri, text, { encoding: FileSystem.EncodingType.UTF8 });

    await Sharing.shareAsync(uri, {
      mimeType: GED_MIME,
      dialogTitle: 'Save / share GEDCOM',
      UTI: 'public.data',
    });
    return { ok: true };   // the share sheet is its own confirmation
  } catch (e) {
    console.warn('GEDCOM export failed (non-fatal):', e?.message);
    return { ok: false, reason: 'error' };
  }
}
