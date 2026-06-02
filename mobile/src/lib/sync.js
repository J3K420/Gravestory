import { supabase } from './supabase';
import { loadStories, saveStories, getLastSync, setLastSync } from './storage';

// Map a Supabase row → in-memory story object (mirrors web persistence.js)
export function rowToStory(row) {
  return {
    id: row.id,
    timestamp: row.client_timestamp || new Date(row.created_at).getTime(),
    name: row.name,
    dates: row.dates,
    biography: row.biography,
    location: row.location,
    inscription: row.inscription,
    symbols: row.symbols,
    family_name: row.family_name,
    notes: row.notes,
    sources: row.sources,
    source_urls: row.source_urls,
    gps: (row.latitude != null && row.longitude != null)
      ? { lat: row.latitude, lng: row.longitude }
      : null,
    userCorrected: row.user_corrected,
    _lowConfidence: row.low_confidence,
    is_public: row.is_public,
    image_url: row.image_url || null,
    portrait_left_url: row.portrait_left_url || null,
    portrait_right_url: row.portrait_right_url || null,
    _deletedAt: row.deleted_at || null,
    _updatedAt: row.updated_at,
  };
}

function storyToRow(story, userId) {
  return {
    user_id: userId,
    name: story.name || null,
    dates: story.dates || null,
    biography: story.biography || null,
    location: story.location || null,
    inscription: story.inscription || null,
    symbols: story.symbols || null,
    family_name: story.family_name || null,
    notes: story.notes || null,
    sources: story.sources || null,
    source_urls: story.source_urls || null,
    latitude: story.gps?.lat ?? null,
    longitude: story.gps?.lng ?? null,
    user_corrected: !!story.userCorrected,
    low_confidence: !!story._lowConfidence,
    is_public: !!story.is_public,
    image_url: story.image_url || null,
    portrait_left_url: story.portrait_left_url || null,
    portrait_right_url: story.portrait_right_url || null,
    client_timestamp: story.timestamp || null,
  };
}

// Insert a new story to Supabase; returns story with cloud id set
export async function cloudSaveStory(story, user) {
  if (!user) return story;
  try {
    const { data, error } = await supabase
      .from('stories')
      .insert(storyToRow(story, user.id))
      .select()
      .single();
    if (error) throw error;
    const saved = { ...story, id: data.id, _updatedAt: data.updated_at };
    const stories = await loadStories(user.id);
    const idx = stories.findIndex(s => s.timestamp === story.timestamp);
    if (idx >= 0) {
      stories[idx] = saved;
      await saveStories(stories, user.id);
    }
    await setLastSync(user.id, data.updated_at);
    return saved;
  } catch (e) {
    console.warn('cloudSaveStory failed (will retry on next sync):', e.message);
    return { ...story, _needsCloudSync: true };
  }
}

// Update an existing story in Supabase (e.g. visibility toggle)
export async function cloudUpdateStory(story, user) {
  if (!user || !story.id) return story;
  try {
    const { data, error } = await supabase
      .from('stories')
      .update(storyToRow(story, user.id))
      .eq('id', story.id)
      .select()
      .single();
    if (error) throw error;
    const updated = { ...story, _updatedAt: data.updated_at };
    const stories = await loadStories(user.id);
    const idx = stories.findIndex(s => s.id === story.id);
    if (idx >= 0) {
      stories[idx] = updated;
      await saveStories(stories, user.id);
    }
    await setLastSync(user.id, data.updated_at);
    return updated;
  } catch (e) {
    console.warn('cloudUpdateStory failed:', e.message);
    return { ...story, _needsCloudSync: true };
  }
}

// Soft-delete a story in Supabase
export async function cloudDeleteStory(story, user) {
  if (!user || !story.id) return;
  try {
    const { data, error } = await supabase
      .from('stories')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', story.id)
      .select()
      .single();
    if (error) throw error;
    await setLastSync(user.id, data.updated_at);
  } catch (e) {
    console.warn('cloudDeleteStory failed:', e.message);
  }
}

// Re-entrancy guard: only one push in flight at a time
let _pushInFlight = false;

// Push local-only stories (no id, or _needsCloudSync) up to Supabase.
// Dedupes by client_timestamp so partial-succeeded prior runs don't double-insert.
// Mutates stories in place and writes back to AsyncStorage. Returns updated array.
async function pushLocalOnly(user, stories) {
  if (!user || _pushInFlight) return stories;
  _pushInFlight = true;
  try {
    const candidates = stories.filter(s => (!s.id || s._needsCloudSync) && s.timestamp);
    if (candidates.length === 0) return stories;

    const stamps = candidates.map(s => s.timestamp).filter(Boolean);
    const alreadyInCloud = new Set();
    if (stamps.length > 0) {
      try {
        const { data } = await supabase
          .from('stories')
          .select('id, client_timestamp')
          .eq('user_id', user.id)
          .in('client_timestamp', stamps);
        for (const row of (data || [])) {
          alreadyInCloud.add(row.client_timestamp);
          // Adopt cloud id for stories we thought were local-only
          const local = stories.find(s => s.timestamp === row.client_timestamp);
          if (local && !local.id) {
            local.id = row.id;
            delete local._needsCloudSync;
          }
        }
      } catch (e) {
        console.warn('pushLocalOnly dedupe check failed:', e.message);
      }
    }

    let latestUpdatedAt = null;
    for (const story of candidates) {
      if (alreadyInCloud.has(story.timestamp)) continue;
      try {
        const { data, error } = await supabase
          .from('stories')
          .insert(storyToRow(story, user.id))
          .select()
          .single();
        if (error) throw error;
        story.id = data.id;
        story._updatedAt = data.updated_at;
        delete story._needsCloudSync;
        if (!latestUpdatedAt || data.updated_at > latestUpdatedAt) {
          latestUpdatedAt = data.updated_at;
        }
      } catch (e) {
        story._needsCloudSync = true;
        console.warn('pushLocalOnly: one story failed, will retry:', e.message);
      }
    }
    if (latestUpdatedAt) {
      await setLastSync(user.id, latestUpdatedAt);
    }
    await saveStories(stories, user.id);
    return stories;
  } finally {
    _pushInFlight = false;
  }
}

// Pull only rows changed since last sync, merge into local, push any local-only up.
// Returns updated stories array, or null on hard failure.
export async function syncDelta(user) {
  if (!user) return null;
  const since = await getLastSync(user.id);

  let query = supabase
    .from('stories')
    .select('*')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false });
  if (since) {
    query = query.gt('updated_at', since);
  }

  const { data, error } = await query;
  if (error) {
    console.warn('syncDelta failed:', error.message);
    return null;
  }

  let stories = await loadStories(user.id);

  if (data.length === 0) {
    stories = await pushLocalOnly(user, stories);
    return stories;
  }

  for (const row of data) {
    const story = rowToStory(row);
    const idx = stories.findIndex(s => s.id === story.id);
    if (row.deleted_at) {
      if (idx >= 0) stories.splice(idx, 1);
    } else if (idx >= 0) {
      stories[idx] = story;
    } else {
      stories.unshift(story);
    }
  }

  await setLastSync(user.id, data[0].updated_at);
  await saveStories(stories, user.id);
  stories = await pushLocalOnly(user, stories);
  return stories;
}

// Called on sign-in: full pull on first sign-in, delta on returning devices.
// Returns updated stories array.
export async function syncOnSignIn(user) {
  if (!user) return null;
  const since = await getLastSync(user.id);
  let stories = await loadStories(user.id);

  if (!since || stories.length === 0) {
    // First sign-in on this device — pull everything
    try {
      const { data, error } = await supabase
        .from('stories')
        .select('*')
        .eq('user_id', user.id)
        .is('deleted_at', null)
        .order('created_at', { ascending: false });
      if (error) throw error;

      const cloudStories = data.map(rowToStory);
      const cloudTimestamps = new Set(cloudStories.map(s => s.timestamp).filter(Boolean));

      // Merge: cloud first, then re-attach local-only stories not yet in cloud
      const merged = [...cloudStories];
      for (const ls of stories) {
        if (
          ls.timestamp &&
          !cloudTimestamps.has(ls.timestamp) &&
          !merged.some(s => s.timestamp === ls.timestamp)
        ) {
          merged.unshift(ls);
        }
      }
      await saveStories(merged, user.id);
      stories = merged;
      stories = await pushLocalOnly(user, stories);

      // Only advance high-water mark once all locals are synced
      const stillPending = stories.some(s => (!s.id || s._needsCloudSync) && s.timestamp);
      if (!stillPending) {
        const newest = stories.reduce(
          (max, s) => (!max || (s._updatedAt && s._updatedAt > max) ? s._updatedAt : max),
          null
        );
        await setLastSync(user.id, newest || new Date().toISOString());
      }
      return stories;
    } catch (e) {
      console.warn('syncOnSignIn full pull failed, staying on local cache:', e.message);
      return stories;
    }
  } else {
    return await syncDelta(user);
  }
}
