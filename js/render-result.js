// render-result.js — Render the result screen (story + cite + visibility controls) (extracted Stage 4)

// ── RENDER RESULT ────────────────────────────────────────────────
function renderResult(story) {
  // Persist a lightweight copy so a reload on #result can rehydrate. Strip
  // the in-memory-only base64 image fields — they can easily exceed the
  // ~5MB localStorage quota and they're not needed for rendering (the R2
  // image_url plus Wikipedia portrait URLs are sufficient post-reload).
  try {
    if (story) {
      const { image, _pendingImageBase64, ...persistable } = story;
      localStorage.setItem('gs_last_story', JSON.stringify(persistable));
    }
  } catch (e) {
    // Quota exceeded or serialization failure — non-fatal; reload simply
    // falls back to home rather than rehydrating.
    console.warn('Could not persist last story for reload:', e);
  }

  // Header images — 3 slots: portrait | gravestone | portrait
  const imgContainer = document.getElementById('result-image-container');
  const graveSrc = story.image || story.image_url || null;
  const leftSrc = story.portrait_left_url || null;
  const rightSrc = story.portrait_right_url || null;

  if (graveSrc || leftSrc || rightSrc) {
    const hasPortraits = !!(leftSrc || rightSrc);
    imgContainer.innerHTML = `
      <div class="result-image-row ${hasPortraits ? '' : 'solo'}">
        ${leftSrc ? `<div class="result-image-slot portrait"><img src="${leftSrc}" alt="Portrait" loading="lazy"></div>` : ''}
        ${graveSrc ? `<div class="result-image-slot gravestone"><img src="${graveSrc}" alt="Gravestone" loading="lazy"></div>` : ''}
        ${rightSrc ? `<div class="result-image-slot portrait"><img src="${rightSrc}" alt="Portrait" loading="lazy"></div>` : ''}
      </div>
    `;
    imgContainer.style.display = 'block';
  } else {
    imgContainer.style.display = 'none';
  }

  // Global map bios: async-load all photos of this stone into a scrollable gallery.
  // Fires after the initial single-image render so the screen is never blank.
  if (story._isGlobal && story.grave_id) {
    _loadGravePhotoGallery(story.grave_id, leftSrc, rightSrc);
  }

  document.getElementById('result-name').textContent = story.name || 'Unknown';
  document.getElementById('result-dates').textContent = story.dates || '';

  // Body
  const body = document.getElementById('result-body');
  body.innerHTML = '';

  // Location tag — show ? indicator when location is approximate/uncertain
  if (story.location) {
    const isUncertain = !story.gps && (
      story.location.toLowerCase().includes('near ') ||
      story.location.toLowerCase().includes('in or near') ||
      story.location.toLowerCase().startsWith('cemetery near') ||
      story.location.toLowerCase().startsWith('grave near')
    );
    const locTag = document.createElement('div');
    locTag.className = 'location-tag';
    locTag.innerHTML = isUncertain
      ? `📍 ${story.location} <span title="Approximate location — no GPS data" style="display:inline-flex;align-items:center;justify-content:center;width:1rem;height:1rem;border-radius:50%;background:rgba(138,126,110,0.3);color:var(--stone);font-size:0.65rem;font-style:normal;cursor:help;margin-left:0.2rem;">?</span>`
      : `📍 ${story.location}`;
    body.appendChild(locTag);
  }

  // Bio-confidence badge — mirrors the low-confidence map pin pattern.
  // Fires when the biography is built on thin or no real sources, so the
  // reader knows to treat the prose as inference rather than research.
  //
  // Signals (any one triggers): no source URLs at all; the only source_url
  // is the empty string the stone-only confidence floor returns; or the
  // biography prose contains no [N] citation markers (model went unsourced).
  // Saved bios from older runs that predate citations should NOT trigger
  // this badge — only fire when story.sources/source_urls were attempted
  // and came back empty.
  const _urls = Array.isArray(story.source_urls) ? story.source_urls : [];
  const _bioBody = story.biography || '';
  const _hasCitationMarkers = /\[\d+\]/.test(_bioBody);
  const _allUrlsEmpty = _urls.length === 0 || _urls.every(u => !u || !u.trim());
  const _thinSources = _allUrlsEmpty || !_hasCitationMarkers;
  if (_thinSources && _bioBody) {
    const confBadge = document.createElement('div');
    confBadge.style.cssText = 'margin:0.6rem 0 0.8rem;padding:0.55rem 0.75rem;border-left:3px solid #a87a2a;background:rgba(168,122,42,0.1);color:#a87a2a;font-size:0.85rem;line-height:1.35;border-radius:0 4px 4px 0;';
    confBadge.innerHTML = `⚠ <strong>Limited sources found for this person.</strong> The biography below is based largely on what the stone itself records, plus general historical context. It may not reflect verified facts about this individual.`;
    body.appendChild(confBadge);
  }

  // Biography
  const bioSection = document.createElement('div');
  bioSection.className = 'result-section';
  const bioLabel = document.createElement('div');
  bioLabel.className = 'section-label';
  bioLabel.textContent = 'Life Story';
  const bioText = document.createElement('div');
  bioText.className = 'biography-text';

  // Render [N] citation markers as clickable superscript links into the
  // sources list. sources/source_urls are index-aligned to the [N] markers
  // (sources[0] is [1], etc). Falls back to plain text when arrays are empty
  // or the marker index is out of range — never breaks the read.
  const srcUrls = Array.isArray(story.source_urls) ? story.source_urls : [];
  const srcDescs = Array.isArray(story.sources) ? story.sources : [];
  const renderCitations = paragraph => {
    return escapeHtml(paragraph).replace(/\[(\d+)\]/g, (_, n) => {
      const idx = parseInt(n, 10) - 1;
      const url = srcUrls[idx];
      const desc = srcDescs[idx] || `Source ${n}`;
      if (url && url.startsWith('http')) {
        return ` <sup class="cite"><a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer" title="${escapeHtml(desc)}">[${n}]</a></sup>`;
      }
      // No URL — render as a non-clickable superscript so the reader still
      // sees the citation marker but isn't promised a destination.
      return ` <sup class="cite cite-noref" title="${escapeHtml(desc)}">[${n}]</sup>`;
    });
  };
  const paragraphs = (story.biography || '').split('\n\n');
  bioText.innerHTML = paragraphs.map(p => `<p>${renderCitations(p)}</p>`).join('');
  bioSection.appendChild(bioLabel);
  bioSection.appendChild(bioText);
  body.appendChild(bioSection);

  // Sources
  if (story.sources?.length > 0) {
    const srcSection = document.createElement('div');
    srcSection.className = 'result-section';
    const srcLabel = document.createElement('div');
    srcLabel.className = 'section-label';
    srcLabel.textContent = 'Sources & Research';
    const srcList = document.createElement('div');
    srcList.className = 'sources-list';
    story.sources.forEach((src, i) => {
      const item = document.createElement('div');
      item.className = 'source-item';
      const url = story.source_urls?.[i];
      if (url && url.startsWith('http')) {
        item.innerHTML = `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(src)}</a>`;
      } else {
        item.textContent = src;
      }
      srcList.appendChild(item);
    });
    srcSection.appendChild(srcLabel);
    srcSection.appendChild(srcList);
    body.appendChild(srcSection);
  }

  // Show map button if GPS or text location available
  const mapBtn = document.getElementById('result-map-btn');
  if (mapBtn) {
    if (story.gps || story.location) {
      mapBtn.classList.add('visible');
    } else {
      mapBtn.classList.remove('visible');
    }
  }

  // Set save button based on whether this story is already saved
  const saveBtn = document.getElementById('save-btn');
  const alreadySaved = story.timestamp && savedStories.some(s => s.timestamp === story.timestamp);
  if (alreadySaved) {
    saveBtn.textContent = '✓ Saved';
    saveBtn.className = 'action-btn action-save saved';
  } else {
    saveBtn.textContent = '💾 Save';
    saveBtn.className = 'action-btn action-save';
  }

  // Public/private toggle — only for signed-in users viewing their own saved story
  renderVisibilityControls(story, alreadySaved);

  // Tribute counts + candle/flower buttons
  renderTributeSection(story);
}

function renderVisibilityControls(story, alreadySaved) {
  // Clear any previous controls
  const existing = document.getElementById('visibility-controls');
  if (existing) existing.remove();

  if (!currentUser || !alreadySaved) return;
  // Find the saved row so toggles operate on the canonical object (has id)
  const savedRow = savedStories.find(s => s.timestamp === story.timestamp);
  if (!savedRow) return;

  const body = document.getElementById('result-body');
  if (!body) return;

  const wrap = document.createElement('div');
  wrap.id = 'visibility-controls';
  wrap.className = 'result-section';
  wrap.style.borderTop = '1px solid rgba(201,168,76,0.2)';
  wrap.style.paddingTop = '1rem';
  wrap.style.marginTop = '1rem';

  const isPublic = !!savedRow.is_public;
  wrap.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:1rem;">
      <div>
        <div style="font-family:'Playfair Display',serif;color:var(--ink);font-size:0.95rem;">
          ${isPublic ? '🌍 Shared publicly' : '🔒 Private'}
        </div>
        <div style="font-family:'Crimson Pro',serif;color:var(--stone);font-size:0.8rem;font-style:italic;margin-top:0.2rem;">
          ${isPublic ? 'Visible on the global cemetery map.' : 'Only visible to you.'}
        </div>
      </div>
      <button id="visibility-toggle-btn" style="background:rgba(201,168,76,0.15);border:1px solid rgba(201,168,76,0.5);color:var(--ink);font-family:'Crimson Pro',serif;font-size:0.85rem;padding:0.5rem 0.9rem;cursor:pointer;border-radius:3px;white-space:nowrap;">
        ${isPublic ? 'Make private' : 'Share publicly'}
      </button>
    </div>
  `;
  body.appendChild(wrap);

  document.getElementById('visibility-toggle-btn').onclick = async () => {
    const btn = document.getElementById('visibility-toggle-btn');
    btn.disabled = true;
    btn.textContent = '…';
    savedRow.is_public = !savedRow.is_public;
    // Mirror in currentStory so the UI re-render after toggle is consistent
    if (currentStory && currentStory.timestamp === savedRow.timestamp) {
      currentStory.is_public = savedRow.is_public;
    }
    await persistUpdate(savedRow);
    renderVisibilityControls(currentStory || savedRow, true);
  };
}

function renderTributeSection(story) {
  const existing = document.getElementById('tribute-section');
  if (existing) existing.remove();

  if (!story.grave_id) return;

  const body = document.getElementById('result-body');
  if (!body) return;

  const wrap = document.createElement('div');
  wrap.id = 'tribute-section';
  wrap.className = 'result-section';
  wrap.style.cssText = 'border-top:1px solid rgba(201,168,76,0.2);padding-top:1rem;margin-top:1rem;';
  wrap.innerHTML = `
    <div style="font-family:'Crimson Pro',serif;color:var(--stone);font-size:0.8rem;font-style:italic;margin-bottom:0.5rem;letter-spacing:0.05em;text-transform:uppercase;">Tributes at this grave</div>
    <div id="tribute-counts" style="font-family:'Playfair Display',serif;color:var(--ink);font-size:0.95rem;margin-bottom:0.75rem;">Loading…</div>
    <div id="tribute-buttons"></div>
  `;
  body.appendChild(wrap);

  // Load counts async, then wire buttons
  getTributes(story.grave_id).then(tributes => {
    const countsEl = document.getElementById('tribute-counts');
    if (!countsEl) return;
    countsEl.textContent = `${tributes.candles} ${tributes.candles === 1 ? 'candle' : 'candles'} · ${tributes.flowers} ${tributes.flowers === 1 ? 'flower' : 'flowers'}`;

    // Tribute buttons only for camera-sourced, non-global stories when signed in
    const showButtons = currentUser && story.source === 'camera' && !story._isGlobal;
    if (!showButtons) return;

    const btnsEl = document.getElementById('tribute-buttons');
    if (!btnsEl) return;

    const btnStyle = (active) => `
      background:${active ? 'rgba(201,168,76,0.12)' : 'none'};
      border:1px solid ${active ? 'rgba(201,168,76,0.7)' : 'rgba(201,168,76,0.3)'};
      color:${active ? 'var(--gold)' : 'var(--stone)'};
      font-family:'Crimson Pro',serif;font-size:0.85rem;
      padding:0.45rem 1rem;cursor:pointer;border-radius:3px;margin-right:0.5rem;
    `.trim();

    const renderButtons = (t) => {
      btnsEl.innerHTML = `
        <button id="tribute-candle-btn" style="${btnStyle(t.userTribute === 'candle')}">
          ${t.userTribute === 'candle' ? '✓ Candle left' : 'Leave a candle'}
        </button>
        <button id="tribute-flower-btn" style="${btnStyle(t.userTribute === 'flower')}">
          ${t.userTribute === 'flower' ? '✓ Flower left' : 'Leave a flower'}
        </button>
      `;

      const makeTributeHandler = (type) => async () => {
        const newType = t.userTribute === type ? null : type;
        const candleBtn = document.getElementById('tribute-candle-btn');
        const flowerBtn = document.getElementById('tribute-flower-btn');
        if (candleBtn) candleBtn.disabled = true;
        if (flowerBtn) flowerBtn.disabled = true;
        await setTribute(story.grave_id, newType);
        const fresh = await getTributes(story.grave_id);
        const cEl = document.getElementById('tribute-counts');
        if (cEl) cEl.textContent = `${fresh.candles} ${fresh.candles === 1 ? 'candle' : 'candles'} · ${fresh.flowers} ${fresh.flowers === 1 ? 'flower' : 'flowers'}`;
        renderButtons(fresh);
      };

      document.getElementById('tribute-candle-btn').onclick = makeTributeHandler('candle');
      document.getElementById('tribute-flower-btn').onclick = makeTributeHandler('flower');
    };

    renderButtons(tributes);
  });
}

// Load all community photos of a grave and replace the image container with a
// horizontal scrollable gallery. Only called for global map bios (_isGlobal).
// Fires after the initial single-image render so the screen is never blank.
async function _loadGravePhotoGallery(graveId, leftPortrait, rightPortrait) {
  try {
    const { data } = await supabaseClient
      .from('grave_photos')
      .select('image_url')
      .eq('grave_id', graveId)
      .order('created_at', { ascending: false })
      .limit(10);
    const photos = (data || []).map(r => r.image_url).filter(Boolean);
    if (photos.length <= 1) return; // single photo — existing layout is fine

    const portraits = [leftPortrait, rightPortrait].filter(Boolean);
    const imgContainer = document.getElementById('result-image-container');
    if (!imgContainer) return;

    const graveSlides = photos.map((src, i) =>
      `<div class="grave-gallery-slide">
         <img src="${src}" alt="Gravestone photo ${i + 1}" loading="${i === 0 ? 'eager' : 'lazy'}">
         <span class="grave-gallery-label">Photo ${i + 1} of ${photos.length}</span>
       </div>`
    ).join('');
    const portraitSlides = portraits.map(src =>
      `<div class="grave-gallery-slide portrait">
         <img src="${src}" alt="Portrait" loading="lazy">
         <span class="grave-gallery-label">Portrait</span>
       </div>`
    ).join('');

    imgContainer.innerHTML =
      `<div class="grave-gallery-strip">${graveSlides}${portraitSlides}</div>`;
    imgContainer.style.display = 'block';
  } catch (e) {
    // Non-fatal — the initial single-image render remains visible
  }
}
