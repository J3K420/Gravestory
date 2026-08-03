import * as Crypto from 'expo-crypto';
import { PROXY_BASE, CLIENT_KEY } from './config';
import { supabase } from './supabase';

// Upload a compressed JPEG base64 string to Cloudflare R2 via the Worker proxy.
// Returns the public URL, or null on failure (failure is non-fatal — story saves fine without a photo).
export async function uploadGravestoneImage(base64) {
  try {
    const res = await fetch(`${PROXY_BASE}/upload-image`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Client-Key': CLIENT_KEY },
      body: JSON.stringify({ data: base64, contentType: 'image/jpeg' }),
    });
    if (!res.ok) throw new Error(`R2 upload failed: ${res.status}`);
    const json = await res.json();
    return json.url || null;
  } catch (e) {
    console.warn('uploadGravestoneImage failed (non-fatal):', e.message);
    return null;
  }
}

// Authenticated upload for story-linked UGC. The Worker verifies the caller's
// JWT and confirms story ownership before writing under a per-user/story key.
export async function uploadStoryPhoto(base64, storyId) {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token || !storyId) {
      return { ok: false, error: 'Sign in again before uploading photos.' };
    }
    const uploadId = Crypto.randomUUID();
    const objectKey = `stories/${session.user.id}/${storyId}/${uploadId}.jpg`;
    let lastError = 'Could not upload the photo. Please try again.';
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        const res = await fetch(`${PROXY_BASE}/upload-story-photo`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Client-Key': CLIENT_KEY,
            'Authorization': `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({
            storyId,
            uploadId,
            data: base64,
            contentType: 'image/jpeg',
          }),
        });
        const json = await res.json().catch(() => ({}));
        if (res.ok && json.url && Number.isInteger(json.slot) && json.slot >= 0 && json.slot <= 3) {
          return {
            ok: true,
            url: json.url,
            objectKey: json.objectKey || objectKey,
            uploadId: json.uploadId || uploadId,
            slot: json.slot,
          };
        }
        lastError = json.error || `Photo upload failed (${res.status}).`;
        if (attempt === 0 && res.status >= 500) continue;
        break;
      } catch (e) {
        lastError = 'Could not upload the photo. Please try again.';
        if (attempt === 0) continue;
      }
    }
    // A lost response may have committed the deterministic object/reservation.
    // Explicitly discard that exact unlinked key before reporting failure.
    await discardStoryPhoto(storyId, objectKey);
    return { ok: false, error: lastError };
  } catch (e) {
    console.warn('uploadStoryPhoto failed:', e.message);
    return { ok: false, error: 'Could not upload the photo. Please try again.' };
  }
}

export async function discardStoryPhoto(storyId, objectKey) {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token || !storyId || !objectKey) return false;
    const res = await fetch(`${PROXY_BASE}/discard-story-photo`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Client-Key': CLIENT_KEY,
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ storyId, objectKey }),
    });
    return res.ok;
  } catch (e) {
    console.warn('discardStoryPhoto failed:', e.message);
    return false;
  }
}

export async function createRemembranceStory(payload) {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) return { ok: false, error: 'Sign in again before sharing.' };
    const res = await fetch(`${PROXY_BASE}/create-remembrance`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Client-Key': CLIENT_KEY,
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify(payload),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.story?.id) {
      return { ok: false, error: json.error || `Could not save the remembrance (${res.status}).` };
    }
    return { ok: true, story: json.story, duplicate: json.duplicate === true };
  } catch (e) {
    console.warn('createRemembranceStory failed:', e.message);
    return { ok: false, error: 'Could not save the remembrance. Please retry.' };
  }
}
export async function setRemembranceVisibility(storyId, visibility) {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token || !storyId) return { ok: false, error: 'Sign in again before changing visibility.' };
    const res = await fetch(`${PROXY_BASE}/set-remembrance-visibility`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Client-Key': CLIENT_KEY,
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ storyId, visibility }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.story) return { ok: false, error: json.error || 'Could not change visibility.' };
    return { ok: true, story: json.story };
  } catch (e) {
    console.warn('setRemembranceVisibility failed:', e.message);
    return { ok: false, error: 'Could not change visibility. Please retry.' };
  }
}
export async function deleteStoryPhotos(storyId) {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token || !storyId) return false;
    const res = await fetch(`${PROXY_BASE}/delete-story-photos`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Client-Key': CLIENT_KEY,
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ storyId }),
    });
    return res.ok;
  } catch (e) {
    console.warn('deleteStoryPhotos failed:', e.message);
    return false;
  }
}

// Requests the trusted Worker to re-load the stored remembrance and R2 objects,
// moderate them together, and write the authoritative publication state.
export async function moderateRemembrance(storyId) {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token || !storyId) {
      return { ok: false, decision: 'review', error: 'Sign in again before submitting.' };
    }
    const res = await fetch(`${PROXY_BASE}/moderate-remembrance`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Client-Key': CLIENT_KEY,
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ storyId }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok && res.status !== 202) {
      return {
        ok: false,
        decision: 'review',
        error: json.error || 'Automated review is unavailable. Your story remains private.',
      };
    }
    return {
      ok: true,
      decision: json.decision || 'review',
      publicationStatus: json.publicationStatus || 'pending',
      reason: json.reason || '',
      imageUrl: json.imageUrl || null,
    };
  } catch (e) {
    console.warn('moderateRemembrance failed:', e.message);
    return {
      ok: false,
      decision: 'review',
      error: 'Automated review is unavailable. Your story remains private.',
    };
  }
}
