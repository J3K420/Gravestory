// Mobile GEDCOM export — write the story's GEDCOM to a temp file and hand it to
// the system share sheet so the user can send it to their genealogy app / cloud.
//
// OWNER-ONLY: callers must gate on !story._isGlobal && !story._isSample (the
// Result chip does). Fail-soft — returns a {ok, reason} result, never throws into
// the screen.
//
// expo-file-system v19 (SDK 54) moved the URI helpers to /legacy (the default
// export throws at runtime) — same convention as pending.js / api-wikipedia.js.
// expo-sharing is a NATIVE module → it only works in a real build (not Expo Go),
// and adding it required a new EAS build (versionCode 14), not an OTA.

import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { buildGedcom, gedcomFilename } from './gedcom';

const EXPORT_DIR = FileSystem.documentDirectory + 'exports/';

export async function exportStoryGedcom(story) {
  if (!story) return { ok: false, reason: 'no-story' };
  if (story._isGlobal || story._isSample) return { ok: false, reason: 'not-owner' };
  try {
    const available = await Sharing.isAvailableAsync();
    if (!available) return { ok: false, reason: 'sharing-unavailable' };

    const text = buildGedcom(story);
    const info = await FileSystem.getInfoAsync(EXPORT_DIR);
    if (!info.exists) {
      await FileSystem.makeDirectoryAsync(EXPORT_DIR, { intermediates: true });
    }
    const uri = EXPORT_DIR + gedcomFilename(story);
    await FileSystem.writeAsStringAsync(uri, text, { encoding: FileSystem.EncodingType.UTF8 });

    await Sharing.shareAsync(uri, {
      mimeType: 'application/x-gedcom',
      dialogTitle: 'Export GEDCOM',
      UTI: 'public.data',
    });
    return { ok: true };
  } catch (e) {
    console.warn('GEDCOM export failed (non-fatal):', e?.message);
    return { ok: false, reason: 'error' };
  }
}
