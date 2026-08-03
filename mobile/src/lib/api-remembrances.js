import { supabase } from './supabase';
import { createRemembranceStory, discardStoryPhoto, moderateRemembrance, uploadStoryPhoto } from './api-r2';
import { cloudDeleteStory, findOrCreateGrave, rowToStory } from './sync';

export const MAX_REMEMBRANCE_PHOTOS = 4;
export const REMEMBRANCE_MAX_LENGTH = 6000;

export async function publishRemembrance({
  user,
  name,
  dates,
  remembrance,
  photos,
  location,
  gps,
  lowConfidence = false,
  requestedVisibility,
  verification,
  termsAcceptedAt,
  clientTimestamp,
}) {
  if (!user?.id) return { ok: false, error: 'Sign in to share a remembrance.' };
  if (!name?.trim() || !remembrance?.trim() || !photos?.length) {
    return { ok: false, error: 'A name, remembrance, and primary photo are required.' };
  }

  const wantsPublic = requestedVisibility === 'public';
  // The client may request publication but never grants approval. The database
  // enforces this pending/private starting state; the Worker below independently
  // reviews the stored story and R2 objects before publishing with service-role.
  const publicationStatus = wantsPublic ? 'pending' : 'private';
  const moderationStatus = 'pending';
  const moderationReason = verification?.status === 'approved'
    ? 'Awaiting server-side moderation.'
    : (verification?.reason || 'Human review required.');

  const graveId = gps
    ? await findOrCreateGrave(name.trim(), gps.lat, gps.lng, publicationStatus === 'published')
    : null;

  const story = {
    timestamp: clientTimestamp || Date.now(),
    name: name.trim().slice(0, 200),
    dates: dates?.trim().slice(0, 100) || null,
    biography: remembrance.trim().slice(0, REMEMBRANCE_MAX_LENGTH),
    public_biography: null,
    location: location?.trim().slice(0, 300) || null,
    gps: gps || null,
    is_public: publicationStatus === 'published',
    requested_visibility: wantsPublic ? 'public' : 'private',
    publication_status: publicationStatus,
    moderation_status: moderationStatus,
    moderation_reason: moderationReason,
    terms_accepted_at: termsAcceptedAt,
    story_type: 'remembrance',
    source: 'remembrance',
    grave_id: graveId,
    _lowConfidence: !!lowConfidence,
  };

  const created = await createRemembranceStory({
    clientTimestamp: story.timestamp,
    name: story.name,
    dates: story.dates,
    remembrance: story.biography,
    location: story.location,
    latitude: story.gps?.lat ?? null,
    longitude: story.gps?.lng ?? null,
    lowConfidence: story._lowConfidence,
    requestedVisibility: story.requested_visibility,
    termsAcceptedAt: story.terms_accepted_at,
    graveId: story.grave_id,
  });
  if (!created.ok || !created.story?.id) {
    return { ok: false, error: created.error || 'Could not save the remembrance. Please check your connection and retry.' };
  }
  let saved = { ...story, ...created.story, id: created.story.id, _updatedAt: created.story.updated_at };

  const uploaded = [];
  let partialPhotos = false;
  for (let i = 0; i < photos.slice(0, MAX_REMEMBRANCE_PHOTOS).length; i += 1) {
    const photo = photos[i];
    const result = await uploadStoryPhoto(photo.base64, saved.id);
    if (!result.ok) {
      if (i === 0) {
        await cloudDeleteStory(saved, user);
        return { ok: false, error: result.error || 'The primary photo could not be uploaded.' };
      }
      partialPhotos = true;
      break;
    }

    const row = {
      story_id: saved.id,
      user_id: user.id,
      image_url: result.url,
      object_key: result.objectKey,
      photo_role: i === 0 ? 'primary' : 'supporting',
      sort_order: result.slot,
      visibility: publicationStatus === 'published' ? 'public' : 'private',
      moderation_status: moderationStatus,
    };
    const { error } = await supabase.from('story_photos').insert(row);
    if (error) {
      console.warn('story_photos insert failed:', error.message);
      await discardStoryPhoto(saved.id, result.objectKey);
      if (i === 0) {
        await cloudDeleteStory(saved, user);
        return { ok: false, error: 'The primary photo could not be linked to the story.' };
      }
      partialPhotos = true;
      break;
    }
    uploaded.push(result.url);
  }

  const moderation = await moderateRemembrance(saved.id);
  const decision = moderation.ok ? moderation.decision : 'review';
  const resolvedPublication = moderation.ok
    ? moderation.publicationStatus
    : publicationStatus;
  saved = {
    ...saved,
    image_url: moderation.imageUrl || uploaded[0] || null,
    _storyPhotos: uploaded,
    publication_status: resolvedPublication,
    moderation_status: decision === 'approved'
      ? 'approved'
      : (decision === 'rejected' ? 'rejected' : 'pending'),
    moderation_reason: moderation.reason || moderation.error || moderationReason,
    is_public: resolvedPublication === 'published',
  };


  return {
    ok: true,
    story: saved,
    rejected: decision === 'rejected',
    pendingReview: wantsPublic && resolvedPublication !== 'published',
    moderationUnavailable: !moderation.ok,
    partialPhotos,
    photoUploadWarning: partialPhotos ? 'Some supporting photos could not be uploaded and were omitted.' : null,
  };
}

export async function fetchCommunityStories({ limit = 50, offset = 0 } = {}) {
  const { data, error } = await supabase.rpc('community_public_stories', {
    p_limit: Math.min(Math.max(limit, 1), 100),
    p_offset: Math.max(offset, 0),
  });
  if (error) throw error;
  return (data || []).map(row => ({
    ...rowToStory(row),
    story_type: row.story_type || 'researched',
    publication_status: row.publication_status || 'published',
    is_public: true,
    _contributor: row.contributor_name || 'Anonymous',
    _contributorId: row.contributor_id || null,
    _isGlobal: true,
  }));
}

export async function blockContributor(blockedId) {
  const { data: { session } } = await supabase.auth.getSession();
  const blockerId = session?.user?.id;
  if (!blockerId || !blockedId || blockerId === blockedId) return false;
  try {
    const { error } = await supabase.from('user_blocks').upsert({
      blocker_id: blockerId,
      blocked_id: blockedId,
    });
    if (error) throw error;
    return true;
  } catch (e) {
    console.warn('blockContributor failed:', e.message);
    return false;
  }
}


