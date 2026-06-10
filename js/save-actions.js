// ── SAVE / SHARE STORY ACTIONS ─────────────────────────────────
// Result-screen action handlers: save, share, copy-to-clipboard.
//
// PUBLIC API (auto-attached to window via classic-script function-
// declaration hoisting — see Stage-7 lesson #1):
//   - saveStory()          — onclick on the result-screen Save button
//   - shareStory()         — onclick on the result-screen Share button
//   - copyToClipboard(t)   — share fallback (not bound directly to DOM)
//
// CROSS-MODULE READS (resolved via classic-script shared scope):
//   - currentStory, savedStories (state, still inline in index.html)
//   - currentUser            (auth.js — Stage 6)
//   - userPrefs              (user-prefs.js — Stage 4)
//
// CROSS-MODULE CALLS (lazy refs, resolved at call time):
//   - uploadImageToR2(...)   (still inline in index.html; planned cut)
//   - updateHomeMapButton()  (still inline in the map block at ~line 2022)
//   - renderResult(...)      (render-result.js — Stage 4)
//   - persistSave(...)       (persistence.js — Stage 4)
//
// ⚠ STAGE-4 TIMING LESSON (preserved verbatim in saveStory) ⚠
// The renderResult(currentStory) call MUST happen BEFORE
// `await persistSave(currentStory)`. The cloud write can hang
// (open issue #2 in the handoff) and a naive ordering would leave
// the visibility toggle invisible until the hang resolves. The
// savedStories.unshift() above is enough to make the saved row
// resolvable; the cloud insert just adds story.id and _updatedAt
// later. DO NOT "FIX" THIS BACK INTO THE BUG.

// ── SAVE STORY ───────────────────────────────────────────────────
async function saveStory() {
  if (!currentStory) return;

  // Guard against double-saving the same story
  if (currentStory.timestamp && savedStories.some(s => s.timestamp === currentStory.timestamp)) {
    const btn = document.getElementById('save-btn');
    btn.textContent = '✓ Saved';
    btn.className = 'action-btn action-save saved';
    return;
  }

  // Saved-story limits have been removed — saving is free. The scan limit
  // (checkWebScanLimit, gating startAnalysis) remains the cost control.

  // Apply default visibility from user prefs (signed-in users only)
  if (currentUser) {
    const vis = userPrefs.default_visibility || 'prompt';
    if (vis === 'public') currentStory.is_public = true;
    else if (vis === 'private') currentStory.is_public = false;
  }

  const btn = document.getElementById('save-btn');

  // Upload the image to R2 before saving (only if we have pending base64 and no URL yet)
  if (currentStory._pendingImageBase64 && !currentStory.image_url) {
    btn.textContent = '☁ Uploading…';
    const url = await uploadImageToR2(currentStory._pendingImageBase64, 'image/jpeg');
    if (url) {
      currentStory.image_url = url;
      console.log('☁️ Image uploaded:', url);
      // Contribute to the grave's community photo pool (non-blocking)
      if (currentStory.grave_id && currentUser) {
        supabaseClient.from('grave_photos').insert({
          grave_id: currentStory.grave_id,
          user_id: currentUser.id,
          image_url: url,
        }).then(({ error }) => {
          if (error) console.warn('grave_photos insert failed (non-fatal):', error.message);
        });
      }
    } else {
      console.warn('☁️ Image upload failed — saving story without image');
    }
    // Always clear the in-memory base64 after attempting upload
    delete currentStory._pendingImageBase64;
  }

  // Strip the data URL `image` field so it doesn't bloat localStorage
  // The image_url will be used to render the image from R2 on subsequent loads.
  if (currentStory.image && currentStory.image.startsWith('data:')) {
    delete currentStory.image;
  }

  savedStories.unshift(currentStory);
  if (savedStories.length > 500) savedStories = savedStories.slice(0, 500);
  updateHomeMapButton();

  btn.textContent = '✓ Saved';
  btn.className = 'action-btn action-save saved';

  // Re-render to show the visibility toggle now that the story is in savedStories.
  // Done BEFORE awaiting persistSave so the UI updates even if the cloud write
  // is slow or hangs — savedStories.unshift above is enough to make the saved
  // row resolvable; the cloud insert just adds story.id and _updatedAt later.
  renderResult(currentStory);

  await persistSave(currentStory);

  // Re-render the visibility controls now that persistSave has resolved and
  // story.id is set. Without this, any "Share publicly" click that fired
  // during the cloud insert would have hit the `!story.id` guard in
  // persistUpdate and been silently dropped — leaving is_public=false in the DB
  // even though the toggle appeared to work.
  renderVisibilityControls(currentStory, true);
}

// ── SHARE STORY ──────────────────────────────────────────────────
async function shareStory() {
  if (!currentStory) return;
  const text = `${currentStory.name}\n${currentStory.dates}\n\n${currentStory.biography?.slice(0, 300)}...\n\nShared from GraveStory`;

  if (navigator.share) {
    try {
      await navigator.share({ title: `GraveStory: ${currentStory.name}`, text });
    } catch (e) { copyToClipboard(text); }
  } else {
    copyToClipboard(text);
  }
}

function copyToClipboard(text) {
  navigator.clipboard.writeText(text).then(() => {
    alert('Story copied to clipboard!');
  }).catch(() => {
    alert('Could not copy — try selecting and copying the text manually.');
  });
}

