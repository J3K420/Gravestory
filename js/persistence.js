// persistence.js — Local + Supabase persistence layer (extracted Stage 4)

// ── PERSISTENCE LAYER ──────────────────────────────────────────
// All saves/deletes/updates go through here. Routes to cloud if signed in
// (with localStorage as offline cache), or pure localStorage if guest.

// Map an in-memory story object to a row for the Supabase table
function storyToRow(story) {
  return {
    user_id: currentUser.id,
    name: story.name || null,
    dates: story.dates || null,
    biography: story.biography || null,
    public_biography: story.public_biography || null,
    has_originated_relatives: !!story.has_originated_relatives,
    originated_relatives: Array.isArray(story.originatedRelatives) && story.originatedRelatives.length
      ? story.originatedRelatives : null,
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

// Map a Supabase row back to the in-memory story shape the rest of the app uses
function rowToStory(row) {
  return {
    id: row.id,
    timestamp: row.client_timestamp || new Date(row.created_at).getTime(),
    name: row.name,
    dates: row.dates,
    biography: row.biography,
    public_biography: row.public_biography || null,
    has_originated_relatives: !!row.has_originated_relatives,
    originatedRelatives: Array.isArray(row.originated_relatives) ? row.originated_relatives : [],
    location: row.location,
    inscription: row.inscription,
    symbols: row.symbols,
    symbol_meanings: row.symbol_meanings || null,
    family_name: row.family_name,
    notes: row.notes,
    sources: row.sources,
    source_urls: row.source_urls,
    gps: (row.latitude != null && row.longitude != null) ? { lat: row.latitude, lng: row.longitude } : null,
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

// Persist the current savedStories array + sync metadata to localStorage
function persistLocal() {
  try {
    localStorage.setItem('gravestories', JSON.stringify(savedStories));
  } catch (e) {
    console.warn('💾 localStorage write failed:', e.message);
  }
}

// Per-user sync timestamp (so different users on the same device don't collide)
function lastSyncKey() {
  return currentUser ? `gs_last_sync_${currentUser.id}` : null;
}
function getLastSync() {
  const k = lastSyncKey();
  return k ? localStorage.getItem(k) : null;
}
function setLastSync(iso) {
  const k = lastSyncKey();
  if (k) localStorage.setItem(k, iso);
}

// SAVE a new story (cloud + local mirror)
async function persistSave(story) {
  persistLocal();
  if (!currentUser) return;

  try {
    const { data, error } = await supabaseClient
      .from('stories')
      .insert(storyToRow(story))
      .select()
      .single();
    if (error) throw error;
    story.id = data.id;
    story._updatedAt = data.updated_at;
    setLastSync(data.updated_at);
    persistLocal();
    console.log('☁️ Saved to cloud:', data.id);
  } catch (e) {
    console.warn('☁️ Cloud save failed (will retry on next sync):', e.message);
    story._needsCloudSync = true;
    persistLocal();
  }
}

// DELETE a story (soft-delete in cloud + remove from local mirror)
async function persistDelete(story) {
  persistLocal();
  if (!currentUser || !story.id) return;

  try {
    const { data, error } = await supabaseClient
      .from('stories')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', story.id)
      .select()
      .single();
    if (error) throw error;
    setLastSync(data.updated_at);
    console.log('☁️ Soft-deleted in cloud:', story.id);
  } catch (e) {
    console.warn('☁️ Cloud delete failed:', e.message);
  }
}

// UPDATE an existing story
async function persistUpdate(story) {
  persistLocal();
  if (!currentUser || !story.id) return;

  try {
    const { data, error } = await supabaseClient
      .from('stories')
      .update(storyToRow(story))
      .eq('id', story.id)
      .select()
      .single();
    if (error) throw error;
    story._updatedAt = data.updated_at;
    setLastSync(data.updated_at);
    persistLocal();
    console.log('☁️ Updated in cloud:', story.id);
  } catch (e) {
    console.warn('☁️ Cloud update failed:', e.message);
    story._needsCloudSync = true;
    persistLocal();
  }
}

// PUSH local-only stories up to the cloud. Idempotent and safe to call on
// every sync — this is the retry path the dead `_needsCloudSync` flag always
// implied but never had. A story is "local-only" if it has no cloud `id`
// (never inserted) or it's flagged `_needsCloudSync` (a prior insert failed).
// De-dupes against the cloud by `timestamp` so a partially-succeeded earlier
// push can't create duplicates. Returns the count actually uploaded.
let _pushInFlight = false;
async function pushLocalOnly() {
  if (!currentUser) return 0;
  // Re-entrancy guard: this is awaited from first-sync, post-delta, and the
  // visibilitychange listener. Two overlapping runs would each build the same
  // id-less candidate list and double-insert. Skip if one is already running.
  if (_pushInFlight) {
    console.log('☁️ pushLocalOnly already in flight — skipping concurrent run.');
    return 0;
  }
  _pushInFlight = true;
  try {

  const candidates = savedStories.filter(s =>
    (!s.id || s._needsCloudSync) && s.timestamp
  );
  if (candidates.length === 0) return 0;

  // Find which of these already exist in the cloud so a failed earlier run
  // that DID insert some rows doesn't double-insert them now. The schema
  // column is `client_timestamp` (storyToRow writes it, rowToStory reads it)
  // — querying a bare `timestamp` column errors and silently disables dedupe,
  // which causes duplicate rows on retry.
  const stamps = candidates.map(s => s.timestamp).filter(v => v != null);
  let existing = new Set();
  if (stamps.length > 0) {
    try {
      const { data, error } = await supabaseClient
        .from('stories')
        .select('id, client_timestamp')
        .eq('user_id', currentUser.id)
        .in('client_timestamp', stamps);
      if (error) throw error;
      for (const row of (data || [])) {
        existing.add(row.client_timestamp);
        // Adopt the cloud id locally so future updates target the right row
        // and this story is no longer treated as a push candidate.
        const local = savedStories.find(s => s.timestamp === row.client_timestamp);
        if (local && !local.id) {
          local.id = row.id;
          delete local._needsCloudSync;
        }
      }
    } catch (e) {
      console.warn('☁️ pushLocalOnly dedupe check failed — proceeding cautiously:', e.message);
    }
  }

  let uploaded = 0;
  for (const story of candidates) {
    // An id-bearing candidate is here because a prior UPDATE failed
    // (_needsCloudSync) — the row already exists, so it must be UPDATEd, never
    // re-INSERTed (there is no unique constraint on client_timestamp, so an
    // insert would create a duplicate). This is the H4 retry path that was
    // previously skipped: `existing.has(timestamp)` sent it to `continue` and
    // the flag never cleared, so a failed visibility/location/marker edit was
    // silently lost from the cloud forever.
    if (story.id) {
      try {
        const { data: updated, error: updErr } = await supabaseClient
          .from('stories')
          .update(storyToRow(story))
          .eq('id', story.id)
          .select()
          .single();
        if (updErr) throw updErr;
        story._updatedAt = updated.updated_at;
        delete story._needsCloudSync;
        uploaded++;
      } catch (e) {
        story._needsCloudSync = true;
        console.warn('☁️ pushLocalOnly: one update failed, will retry next sync:', e.message);
      }
      continue;
    }
    if (existing.has(story.timestamp)) continue; // already in cloud (id adopted above)
    try {
      const { data: inserted, error: insErr } = await supabaseClient
        .from('stories')
        .insert(storyToRow(story))
        .select()
        .single();
      if (insErr) throw insErr;
      story.id = inserted.id;
      story._updatedAt = inserted.updated_at;
      delete story._needsCloudSync;
      uploaded++;
    } catch (e) {
      // Leave _needsCloudSync set so the NEXT sync retries it. Do not advance
      // any high-water mark on its behalf.
      story._needsCloudSync = true;
      console.warn('☁️ pushLocalOnly: one story failed, will retry next sync:', e.message);
    }
  }

  if (uploaded > 0) {
    persistLocal();
    renderSavedList();
    updateHomeMapButton();
    console.log(`☁️ pushLocalOnly: uploaded ${uploaded} local-only story(s).`);
  }
  return uploaded;

  } finally {
    _pushInFlight = false;
  }
}
