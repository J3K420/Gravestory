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
    public_biography: row.public_biography || null,
    has_originated_relatives: !!row.has_originated_relatives,
    originatedRelatives: Array.isArray(row.originated_relatives) ? row.originated_relatives : [],
    // Kinship kernel (migration 021) — structured family data for GEDCOM export.
    subjects: Array.isArray(row.subjects) ? row.subjects : [],
    relationships: Array.isArray(row.relationships) ? row.relationships : [],
    maiden_name: row.maiden_name || null,
    location: row.location,
    inscription: row.inscription,
    symbols: row.symbols,
    symbol_meanings: row.symbol_meanings || null,
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
    grave_id: row.grave_id || null,
    source: row.source || 'library',
    marker_style: row.marker_style || null,
  };
}

function storyToRow(story, userId) {
  return {
    user_id: userId,
    name: story.name || null,
    dates: story.dates || null,
    biography: story.biography || null,
    public_biography: story.public_biography || null,
    has_originated_relatives: !!story.has_originated_relatives,
    originated_relatives: Array.isArray(story.originatedRelatives) && story.originatedRelatives.length
      ? story.originatedRelatives : null,
    // Kinship kernel (migration 021) — null when empty so jsonb stays clean.
    subjects: Array.isArray(story.subjects) && story.subjects.length ? story.subjects : null,
    relationships: Array.isArray(story.relationships) && story.relationships.length ? story.relationships : null,
    maiden_name: story.maiden_name || null,
    location: story.location || null,
    inscription: story.inscription || null,
    symbols: story.symbols || null,
    symbol_meanings: story.symbol_meanings || null,
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
    grave_id: story.grave_id || null,
    source: story.source || 'library',
    marker_style: story.marker_style || null,
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
    // _pending stories are offline scans awaiting research — local-only until
    // the pipeline runs (they have no biography and a device-local photoUri).
    const candidates = stories.filter(s => (!s.id || s._needsCloudSync) && s.timestamp && !s._pending);
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
      // An id-bearing candidate is here because a prior UPDATE failed
      // (_needsCloudSync) — the row already exists, so UPDATE it, never
      // re-INSERT (no unique constraint on client_timestamp → insert would
      // duplicate). H4 retry path: previously `alreadyInCloud.has` → continue
      // skipped these and the flag never cleared, silently losing a failed
      // visibility/location/marker edit from the cloud.
      if (story.id) {
        try {
          const { data, error } = await supabase
            .from('stories')
            .update(storyToRow(story, user.id))
            .eq('id', story.id)
            .select()
            .single();
          if (error) throw error;
          story._updatedAt = data.updated_at;
          delete story._needsCloudSync;
          if (!latestUpdatedAt || data.updated_at > latestUpdatedAt) {
            latestUpdatedAt = data.updated_at;
          }
        } catch (e) {
          story._needsCloudSync = true;
          console.warn('pushLocalOnly: one update failed, will retry:', e.message);
        }
        continue;
      }
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

// Atomically finds or creates a canonical grave record.
// Returns the grave UUID, or null on failure (non-fatal).
// markerStyle (optional) stakes the grave's global-map pin on the INSERT
// branch only (first-wins forever). Mobile picks the marker on the result
// screen before saving, so it passes story.marker_style here at create time.
export async function findOrCreateGrave(name, lat, lng, isPublic = false, markerStyle = null) {
  if (!name || lat == null || lng == null) return null;
  try {
    const { data, error } = await supabase.rpc('find_or_create_grave', {
      p_name: name,
      p_lat: lat,
      p_lng: lng,
      p_is_public: isPublic,
      p_marker_style: markerStyle || null,
    });
    if (error) throw error;
    return data;
  } catch (e) {
    console.warn('findOrCreateGrave failed:', e.message);
    return null;
  }
}

// Stakes a grave's permanent global-map marker, first-wins. The RPC only
// writes when graves.marker_style is still NULL, so the first user to pick
// wins forever; later pickers and location corrections no-op. Non-fatal.
// Used when the marker is changed AFTER the grave already exists (the user
// re-picks on a saved story).
export async function setGraveMarker(graveId, styleId) {
  if (!graveId || !styleId) return;
  try {
    const { error } = await supabase.rpc('set_grave_marker', {
      p_grave_id: graveId,
      p_marker_style: styleId,
    });
    if (error) throw error;
  } catch (e) {
    console.warn('setGraveMarker failed:', e.message);
  }
}

// Updates the canonical pin location for a grave.
// Only applies if the grave has not already been user-corrected.
export async function updateGraveLocation(graveId, lat, lng) {
  if (!graveId) return;
  try {
    const { error } = await supabase.rpc('update_grave_location', {
      p_grave_id: graveId,
      p_lat: lat,
      p_lng: lng,
    });
    if (error) throw error;
  } catch (e) {
    console.warn('updateGraveLocation failed:', e.message);
  }
}

// Called on sign-in: always does a full pull so cloud is authoritative.
// Only preserves local stories that have never been pushed (no id).
// Returns updated stories array.
export async function syncOnSignIn(user) {
  if (!user) return null;
  let stories = await loadStories(user.id);

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

    // Cloud is authoritative. Only keep local stories that have never been
    // pushed to the cloud (no id) — drops any contaminated stories from
    // other accounts that don't belong here.
    const localOnly = stories.filter(
      s => !s.id && s.timestamp && !cloudTimestamps.has(s.timestamp)
    );
    const merged = [...cloudStories, ...localOnly];

    await saveStories(merged, user.id);
    stories = merged;
    stories = await pushLocalOnly(user, stories);

    const newest = stories.reduce(
      (max, s) => (!max || (s._updatedAt && s._updatedAt > max) ? s._updatedAt : max),
      null
    );
    await setLastSync(user.id, newest || new Date().toISOString());
    return stories;
  } catch (e) {
    console.warn('syncOnSignIn full pull failed, staying on local cache:', e.message);
    return stories;
  }
}
