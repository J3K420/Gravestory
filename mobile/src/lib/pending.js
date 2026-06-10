// Offline scan queue — persists a scanned photo to the app's documentDirectory
// so the research pipeline can run later, once connectivity returns. A pending
// story carries `_pending: true` + `photoUri` and is local-only (sync.js skips
// it) until research completes and replaces it with a real story.
import * as FileSystem from 'expo-file-system';

const PENDING_DIR = FileSystem.documentDirectory + 'pending/';

// Writes the base64 JPEG to a persistent file; returns the file URI.
export async function savePendingPhoto(base64, timestamp) {
  const info = await FileSystem.getInfoAsync(PENDING_DIR);
  if (!info.exists) {
    await FileSystem.makeDirectoryAsync(PENDING_DIR, { intermediates: true });
  }
  const uri = `${PENDING_DIR}${timestamp}.jpg`;
  await FileSystem.writeAsStringAsync(uri, base64, { encoding: FileSystem.EncodingType.Base64 });
  return uri;
}

// Reads a pending photo back as base64 for the pipeline. Null if missing.
export async function readPendingPhoto(uri) {
  try {
    return await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
  } catch {
    return null;
  }
}

export async function deletePendingPhoto(uri) {
  if (!uri) return;
  try {
    await FileSystem.deleteAsync(uri, { idempotent: true });
  } catch {}
}
