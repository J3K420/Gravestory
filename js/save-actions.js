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

  // If this story is being saved straight to PUBLIC (default_visibility=public),
  // it bypasses the share toggle — so redact living-relative names here too,
  // before it can reach the global map. Same guard + fail-safe as the toggle.
  if (currentStory.is_public && !currentStory.public_biography && currentStory.biography &&
      typeof redactLivingNamesForPublic === 'function') {
    try {
      const subjects = Array.isArray(currentStory.subjects) ? currentStory.subjects
        : (Array.isArray(currentStory.graveData?.subjects) ? currentStory.graveData.subjects : []);
      // INCREMENT 2: deterministically strip app-originated relative names BEFORE
      // the fail-open redactor. Desync guard: flag set but names absent -> safe
      // placeholder, never the raw bio.
      const _orig = Array.isArray(currentStory.originatedRelatives) ? currentStory.originatedRelatives : [];
      if (currentStory.has_originated_relatives && !_orig.length) {
        currentStory.public_biography = 'This public biography is being prepared.';
        // Desync fail-safe: the flag is set but the names are gone, so we can't
        // strip them. The placeholder protects the bio — but mentions/sources are
        // ALSO served raw by the public RPC, so blank them too rather than publish
        // un-stripped raw text. (Review: desync branch must cover every raw column.)
        currentStory.mentions = [];
        currentStory.sources = [];
        currentStory.source_urls = [];
      } else {
        const _stripped = (typeof stripOriginatedNamesForPublic === 'function')
          ? stripOriginatedNamesForPublic(currentStory.biography, _orig, subjects)
          : currentStory.biography;
        currentStory.public_biography = await redactLivingNamesForPublic(_stripped, subjects);
        // `sources` is served RAW by the public RPC — strip originated names from
        // citation descriptions too (model/bioSnippet can feed a name in). Shared
        // column: owner sees the name in the bio prose, so dropping it here is fine.
        if (_orig.length && typeof stripOriginatedNamesFromSources === 'function') {
          currentStory.sources = stripOriginatedNamesFromSources(currentStory.sources, _orig, subjects);
          currentStory.source_urls = stripOriginatedNamesFromSources(currentStory.source_urls, _orig, subjects);
        }
        // Mentions are served RAW publicly. Two-layer public floor: (1) drop any
        // mention naming a LIVING non-originated relative the model failed to
        // generalize (filterMentionsForPublic — the S62-consistent guard mentions
        // otherwise lack, since they get no Gemini redactor); (2) strip any
        // app-originated relative name (stripOriginatedNamesFromMentions).
        if (typeof filterMentionsForPublic === 'function') {
          currentStory.mentions = filterMentionsForPublic(currentStory.mentions, subjects);
        }
        if (_orig.length && typeof stripOriginatedNamesFromMentions === 'function') {
          currentStory.mentions = stripOriginatedNamesFromMentions(currentStory.mentions, _orig, subjects);
        }
      }
    } catch (e) {
      console.warn('public_biography redaction skipped on auto-public save (non-fatal):', e?.message || e);
    }
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
  logEvent(ANALYTICS_EVENTS.STORY_SAVED, { signedIn: !!currentUser, hasGrave: !!currentStory.grave_id });

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
      if (typeof logEvent === 'function') logEvent(ANALYTICS_EVENTS.STORY_SHARED, { method: 'native', isGlobal: !!currentStory._isGlobal });
    } catch (e) { copyToClipboard(text); }
  } else {
    copyToClipboard(text);
    if (typeof logEvent === 'function') logEvent(ANALYTICS_EVENTS.STORY_SHARED, { method: 'clipboard', isGlobal: !!currentStory._isGlobal });
  }
}

function copyToClipboard(text) {
  navigator.clipboard.writeText(text).then(() => {
    alert('Story copied to clipboard!');
  }).catch(() => {
    alert('Could not copy — try selecting and copying the text manually.');
  });
}

// ── EXPORT GEDCOM ────────────────────────────────────────────────
// Download the current story as a GEDCOM (.ged) file a genealogist can import
// into their family tree. OWNER-ONLY: never export someone else's public story
// (global/sample) — those wouldn't carry the kinship columns anyway, and we
// don't re-publish others' data. Same Blob-download pattern as exportCemeteryData.
function exportStoryGedcom() {
  if (!currentStory) return;
  if (currentStory._isGlobal || currentStory._isSample) {
    alert('Export is only available for your own scanned stories.');
    return;
  }
  try {
    const text = buildGedcom(currentStory);
    const blob = new Blob([text], { type: 'application/x-gedcom' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = gedcomFilename(currentStory);
    a.click();
    URL.revokeObjectURL(url);
    if (typeof logEvent === 'function') logEvent(ANALYTICS_EVENTS.STORY_SHARED, { method: 'gedcom', isGlobal: false });
  } catch (e) {
    console.warn('GEDCOM export failed:', e?.message);
    alert('Could not generate the GEDCOM file.');
  }
}

