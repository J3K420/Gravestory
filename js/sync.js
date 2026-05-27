// sync.js — Incremental + initial cloud sync orchestration (extracted Stage 4)

// INCREMENTAL SYNC: pull only changes since last sync
async function syncDelta() {
  if (!currentUser) return { fetched: 0, deleted: 0 };

  const since = getLastSync();
  let query = supabaseClient
    .from('stories')
    .select('*')
    .eq('user_id', currentUser.id)
    .order('updated_at', { ascending: false });

  if (since) {
    query = query.gt('updated_at', since);
  }

  const { data, error } = await query;
  if (error) {
    console.warn('☁️ Delta fetch failed:', error.message);
    return null;
  }

  if (data.length === 0) {
    console.log('☁️ Already up to date (no changes since', since || 'forever', ')');
    // Nothing to pull, but still flush any local-only stories upward so a
    // returning user's stranded saves heal even when there are no deltas.
    await pushLocalOnly();
    return { fetched: 0, deleted: 0 };
  }

  let fetched = 0, deleted = 0;
  for (const row of data) {
    const story = rowToStory(row);
    const idx = savedStories.findIndex(s => s.id === story.id);

    if (row.deleted_at) {
      // Soft-deleted on another device → remove from local
      if (idx >= 0) {
        savedStories.splice(idx, 1);
        deleted++;
      }
    } else if (idx >= 0) {
      // Updated on another device → replace local copy
      savedStories[idx] = story;
      fetched++;
    } else {
      // New story from another device → add to local
      savedStories.unshift(story);
      fetched++;
    }
  }

  // Newest row's updated_at becomes the new high-water mark
  // (data is already ordered by updated_at desc)
  setLastSync(data[0].updated_at);
  persistLocal();
  renderSavedList();
  updateHomeMapButton();
  console.log(`☁️ Delta sync: ${fetched} updated/new, ${deleted} removed`);

  // Always flush local-only stories upward — this is what was missing.
  // Returning users (lastSync set) previously took a pull-only path, so any
  // story whose original insert failed (or that was saved as a guest) was
  // stranded forever. Retrying here means it heals on the next sync.
  await pushLocalOnly();

  return { fetched, deleted };
}

// Called on sign-in: upload any local stories the user has, then delta-sync
async function syncOnSignIn() {
  console.log('☁️ Sign-in sync starting...');

  const localStories = JSON.parse(localStorage.getItem('gravestories') || '[]');
  const lastSync = getLastSync();

  // First time signing in on this device with this account: do a full pull
  if (!lastSync) {
    console.log('☁️ First sync — pulling all cloud stories...');
    try {
      const { data, error } = await supabaseClient
        .from('stories')
        .select('*')
        .eq('user_id', currentUser.id)
        .is('deleted_at', null)
        .order('created_at', { ascending: false });
      if (error) throw error;

      const cloudStories = data.map(rowToStory);
      const cloudTimestamps = new Set(cloudStories.map(s => s.timestamp).filter(Boolean));

      // Merge cloud stories into the working set, then push local-only ones up
      // via the shared reusable path (handles dedupe + per-story retry flags).
      savedStories = cloudStories;
      // Re-attach any local stories not present in the cloud pull so
      // pushLocalOnly() can see and upload them.
      for (const ls of localStories) {
        if (ls.timestamp && !cloudTimestamps.has(ls.timestamp) &&
            !savedStories.some(s => s.timestamp === ls.timestamp)) {
          savedStories.unshift(ls);
        }
      }
      const uploaded = await pushLocalOnly();

      // Only advance the high-water mark if every local story made it up.
      // If any push failed, leaving lastSync unset keeps this branch active so
      // the next sign-in / tab-focus retries the stragglers instead of
      // permanently stranding them (the original bug).
      const stillPending = savedStories.some(s => (!s.id || s._needsCloudSync) && s.timestamp);
      if (!stillPending) {
        const newest = savedStories.reduce((max, s) =>
          !max || (s._updatedAt && s._updatedAt > max) ? s._updatedAt : max, null);
        if (newest) setLastSync(newest);
        else setLastSync(new Date().toISOString());
      } else {
        console.warn('☁️ Some local stories still pending — NOT advancing high-water mark so they retry.');
      }

      persistLocal();
      renderSavedList();
      updateHomeMapButton();
      console.log(`☁️ Initial sync complete. ${savedStories.length} story(s) loaded, ${uploaded} uploaded.`);
    } catch (e) {
      console.warn('☁️ Initial sync failed, staying on local cache:', e.message);
    }
  } else {
    // Returning user — just pull deltas
    await syncDelta();
  }
}

// ── VISIBILITY SYNC GLUE (folded in Stage 8) ────────────────────────
// LOAD-TIME SIDE EFFECT: registers a document-level visibilitychange
// listener. Folded here from inline rather than getting its own
// sync-glue.js module — the listener's sole purpose is to call
// syncDelta() (defined above) whenever the tab regains visibility.
// currentUser is read at callback time (lazy ref to auth.js), so
// script load order doesn't matter for this glue.
// When the user returns to the tab/app after being away, pull deltas
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && currentUser) {
    syncDelta();
  }
});

