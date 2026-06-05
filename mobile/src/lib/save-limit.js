import { loadStories } from './storage';

export const FREE_LIMIT_GUEST = 3;
export const FREE_LIMIT_USER  = 5;

export async function checkSaveLimit(userId) {
  const isGuest = !userId;
  const limit   = isGuest ? FREE_LIMIT_GUEST : FREE_LIMIT_USER;
  const stories = (await loadStories(userId)) || [];
  const count   = stories.filter(s => !s.deleted_at).length;
  return { count, limit, atLimit: count >= limit, isGuest };
}
