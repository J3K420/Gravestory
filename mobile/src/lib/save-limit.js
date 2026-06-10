import { loadStories } from './storage';

// Saved-story limits have been removed — saving is free (Postgres row + one R2 image).
// Scan limits (scan-limit.js) remain the cost control, since scans drive all the
// paid AI work (Tavily + Gemini + Wikipedia). checkSaveLimit is kept as a no-op so
// existing call sites (SettingsScreen progress display) keep working; atLimit is
// always false. FREE_LIMIT_* are exported for the Settings count display only.
export const FREE_LIMIT_GUEST = Infinity;
export const FREE_LIMIT_USER  = Infinity;

export async function checkSaveLimit(userId) {
  const isGuest = !userId;
  const stories = (await loadStories(userId)) || [];
  const count   = stories.filter(s => !s.deleted_at).length;
  return { count, limit: Infinity, atLimit: false, isGuest };
}
