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
        ${leftSrc ? `<div class="result-image-slot portrait"><img src="${escapeHtml(leftSrc)}" alt="Portrait" loading="lazy"></div>` : ''}
        ${graveSrc ? `<div class="result-image-slot gravestone"><img src="${escapeHtml(graveSrc)}" alt="Gravestone" loading="lazy"></div>` : ''}
        ${rightSrc ? `<div class="result-image-slot portrait"><img src="${escapeHtml(rightSrc)}" alt="Portrait" loading="lazy"></div>` : ''}
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

  // Example banner — first thing in the body for the read-only sample story.
  if (story._isSample) {
    const banner = document.createElement('div');
    banner.className = 'sample-banner';
    banner.textContent = '✦ Example story — this is what GraveStory creates from a single photo';
    body.appendChild(banner);
  }

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
      ? `📍 ${escapeHtml(story.location)} <span title="Approximate location — no GPS data" style="display:inline-flex;align-items:center;justify-content:center;width:1rem;height:1rem;border-radius:50%;background:rgba(138,126,110,0.3);color:var(--stone);font-size:0.65rem;font-style:normal;cursor:help;margin-left:0.2rem;">?</span>`
      : `📍 ${escapeHtml(story.location)}`;
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

  // AI-honesty caption — a small, persistent note beneath every generated
  // biography. Honest-research register (not a scary warning): sets the
  // expectation that the story is AI-assembled from public sources, may err,
  // and is not an authoritative record. Suppressed only for the read-only
  // sample (which carries its own "Example story" banner). The first-ever
  // view also gets the one-time explainer modal (showAiDisclaimerOnce below).
  if (!story._isSample && (story.biography || '').trim()) {
    const aiNote = document.createElement('div');
    aiNote.className = 'ai-disclaimer-note';
    aiNote.innerHTML = `✦ AI-generated story — researched from public records. It may contain errors and is not an official record. <button type="button" class="ai-report-link" id="ai-report-link">Report a problem</button>`;
    bioSection.appendChild(aiNote);
    const reportLink = aiNote.querySelector('#ai-report-link');
    if (reportLink) reportLink.onclick = () => openReportSheet(story);
    showAiDisclaimerOnce();
  }

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

  // Symbols on the stone — tappable gold chips for any symbol with a known
  // meaning (static table OR per-story AI-resolved); plain chips otherwise.
  renderSymbolSection(story);

  // Show map button if GPS or text location available
  const mapBtn = document.getElementById('result-map-btn');
  if (mapBtn) {
    if (story.gps || story.location) {
      mapBtn.classList.add('visible');
    } else {
      mapBtn.classList.remove('visible');
    }
  }

  // The canned first-run example is read-only: no save / sharing / tributes /
  // marker, and a banner makes clear it's a demo, not a real scan.
  const isSample = !!story._isSample;

  // Set save button based on whether this story is already saved
  const saveBtn = document.getElementById('save-btn');
  const alreadySaved = story.timestamp && savedStories.some(s => s.timestamp === story.timestamp);
  if (isSample) {
    saveBtn.style.display = 'none';
  } else {
    saveBtn.style.display = '';
    if (alreadySaved) {
      saveBtn.textContent = '✓ Saved';
      saveBtn.className = 'action-btn action-save saved';
    } else {
      saveBtn.textContent = '💾 Save';
      saveBtn.className = 'action-btn action-save';
    }
  }

  // Public/private toggle, tributes, marker picker — all suppressed for the sample.
  if (!isSample) {
    renderVisibilityControls(story, alreadySaved);
    renderTributeSection(story);
    renderMarkerSection(story, alreadySaved);
  }
}

// ── AI DISCLAIMER (one-time explainer) ───────────────────────────
// The first time a user ever views a generated biography, show a friendly
// one-time modal explaining what these stories are (AI-assembled from public
// records, may err, not an authoritative record). After it's acknowledged we
// set a localStorage flag so it never shows again — the small persistent
// caption beneath each bio carries the message thereafter. Honest-research
// tone by design: this is a confidence/credibility signal, not a scare banner.
const AI_DISCLAIMER_SEEN_KEY = 'gs_ai_disclaimer_seen';

function showAiDisclaimerOnce() {
  let seen = false;
  try { seen = localStorage.getItem(AI_DISCLAIMER_SEEN_KEY) === 'true'; } catch (e) {}
  if (seen) return;
  if (document.getElementById('ai-disclaimer-overlay')) return;

  const dismiss = () => {
    try { localStorage.setItem(AI_DISCLAIMER_SEEN_KEY, 'true'); } catch (e) {}
    const el = document.getElementById('ai-disclaimer-overlay');
    if (el) el.remove();
  };

  const overlay = document.createElement('div');
  overlay.id = 'ai-disclaimer-overlay';
  overlay.className = 'symbol-sheet-overlay';
  overlay.onclick = (e) => { if (e.target === overlay) dismiss(); };
  overlay.innerHTML = `
    <div class="symbol-sheet ai-disclaimer-sheet" role="dialog" aria-modal="true">
      <div class="symbol-sheet-handle"></div>
      <div class="symbol-sheet-name">About these stories</div>
      <div class="symbol-sheet-text">
        GraveStory assembles each biography with AI from public records and
        historical sources. It's a thoughtful starting point for remembrance and
        research — but it can contain errors and is not an official or
        authoritative record. If you spot something wrong, you can report it.
      </div>
      <button type="button" class="symbol-sheet-close" id="ai-disclaimer-ok">I understand</button>
    </div>
  `;
  document.body.appendChild(overlay);
  const okBtn = document.getElementById('ai-disclaimer-ok');
  if (okBtn) okBtn.onclick = dismiss;
}

// ── REPORT A PROBLEM (bottom sheet) ──────────────────────────────
// Lets any viewer (guest or signed-in) flag a generated biography. Reason
// chips + an optional note → submitContentReport (js/api-reports.js) writes to
// the content_reports table. Open to everyone by design: a relative who finds
// a wrong public bio should be able to report it without an account. Satisfies
// Google Play's in-app AI-content reporting requirement.
function openReportSheet(story) {
  const existing = document.getElementById('report-sheet-overlay');
  if (existing) existing.remove();

  const reasons = (typeof REPORT_REASONS !== 'undefined') ? REPORT_REASONS : [
    { id: 'factual_error', label: 'Factual error' },
    { id: 'wrong_person', label: 'Wrong person' },
    { id: 'offensive', label: 'Offensive or inappropriate' },
    { id: 'privacy', label: 'Privacy concern / about a living person' },
    { id: 'other', label: 'Something else' },
  ];

  const overlay = document.createElement('div');
  overlay.id = 'report-sheet-overlay';
  overlay.className = 'symbol-sheet-overlay';
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };

  const chips = reasons.map(r =>
    `<button type="button" class="report-reason-chip" data-reason="${r.id}">${escapeHtml(r.label)}</button>`
  ).join('');

  overlay.innerHTML = `
    <div class="symbol-sheet report-sheet" role="dialog" aria-modal="true">
      <div class="symbol-sheet-handle"></div>
      <div class="symbol-sheet-name">Report a problem</div>
      <div class="report-sheet-sub">Thanks for helping keep these stories accurate and respectful. What's wrong?</div>
      <div class="report-reasons">${chips}</div>
      <textarea id="report-note" class="report-note" rows="3" maxlength="600" placeholder="Add any details (optional)"></textarea>
      <div class="report-actions">
        <button type="button" class="report-cancel" id="report-cancel">Cancel</button>
        <button type="button" class="report-submit" id="report-submit" disabled>Send report</button>
      </div>
      <div class="report-status" id="report-status"></div>
    </div>
  `;
  document.body.appendChild(overlay);

  let selectedReason = null;
  const submitBtn = document.getElementById('report-submit');
  overlay.querySelectorAll('.report-reason-chip').forEach(chip => {
    chip.onclick = () => {
      selectedReason = chip.getAttribute('data-reason');
      overlay.querySelectorAll('.report-reason-chip').forEach(c => c.classList.remove('selected'));
      chip.classList.add('selected');
      submitBtn.disabled = false;
    };
  });

  document.getElementById('report-cancel').onclick = () => overlay.remove();

  submitBtn.onclick = async () => {
    if (!selectedReason) return;
    submitBtn.disabled = true;
    submitBtn.textContent = 'Sending…';
    const note = (document.getElementById('report-note') || {}).value || '';
    const ok = (typeof submitContentReport === 'function')
      ? await submitContentReport({
          storyTs: story.timestamp,
          graveId: story.grave_id || null,
          personName: story.name || story.primary_name || null,
          reason: selectedReason,
          note,
          isPublic: !!(story.is_public || story._isGlobal),
        })
      : false;
    const statusEl = document.getElementById('report-status');
    if (ok) {
      const sheet = overlay.querySelector('.report-sheet');
      if (sheet) sheet.innerHTML = `
        <div class="symbol-sheet-handle"></div>
        <div class="symbol-sheet-name">Thank you</div>
        <div class="report-sheet-sub">Your report has been sent. We review flagged stories and will take a look.</div>
        <div class="report-actions"><button type="button" class="report-submit" id="report-done">Done</button></div>
      `;
      const doneBtn = document.getElementById('report-done');
      if (doneBtn) doneBtn.onclick = () => overlay.remove();
    } else {
      if (statusEl) statusEl.textContent = 'Could not send the report. Please check your connection and try again.';
      submitBtn.disabled = false;
      submitBtn.textContent = 'Send report';
    }
  };
}

// ── SYMBOLS ON THE STONE ─────────────────────────────────────────
// Render the OCR-detected symbols as chips beneath the bio. A symbol whose
// meaning is known — from the static SYMBOL_CONTEXT table OR this story's
// AI-resolved symbol_meanings map — becomes a tappable gold chip that opens a
// bottom-sheet with its conventional meaning. Unknown symbols render as plain,
// non-tappable chips. Mirrors the mobile ResultScreen symbol chips.
//
// Meaning lookup goes through lookupSymbolMeaning() (biography.js, on window via
// the classic-script convention). Per CLAUDE.md we never embed data in onclick:
// each tappable chip stores its meaning in a module-level map keyed by an id and
// a named handler (openSymbolSheet) reads from it.
let _symbolSheetLookup = {};

function renderSymbolSection(story) {
  // Remove any prior render (re-render on save/toggle re-runs renderResult).
  const existing = document.getElementById('symbol-section');
  if (existing) existing.remove();
  _symbolSheetLookup = {};

  const symbols = Array.isArray(story.symbols) ? story.symbols.filter(s => s && s.trim()) : [];
  if (symbols.length === 0) return;

  const body = document.getElementById('result-body');
  if (!body) return;

  const meanings = (story.symbol_meanings && typeof story.symbol_meanings === 'object')
    ? story.symbol_meanings : null;

  const chips = symbols.map((s, i) => {
    const meaning = (typeof lookupSymbolMeaning === 'function')
      ? lookupSymbolMeaning(s, meanings)
      : null;
    if (meaning) {
      const id = 'sym-' + i;
      _symbolSheetLookup[id] = { name: s, text: meaning };
      return `<button type="button" class="symbol-chip symbol-chip-tappable" data-sym="${id}" onclick="openSymbolSheet(this.getAttribute('data-sym'))">${escapeHtml(s)} <span class="symbol-chip-caret">›</span></button>`;
    }
    return `<span class="symbol-chip">${escapeHtml(s)}</span>`;
  }).join('');

  const hasTappable = Object.keys(_symbolSheetLookup).length > 0;

  const section = document.createElement('div');
  section.id = 'symbol-section';
  section.className = 'result-section';
  section.innerHTML = `
    <div class="section-label">Symbols on the Stone</div>
    ${hasTappable ? '<div class="symbol-hint">Tap a gold symbol to learn its traditional meaning.</div>' : ''}
    <div class="symbol-chips">${chips}</div>
  `;
  body.appendChild(section);
}

// Open the bottom-sheet for a tapped symbol chip. id keys into the module-level
// lookup populated by renderSymbolSection (never trusts data passed via onclick).
function openSymbolSheet(id) {
  const entry = _symbolSheetLookup[id];
  if (!entry) return;
  closeSymbolSheet();

  const overlay = document.createElement('div');
  overlay.id = 'symbol-sheet-overlay';
  overlay.className = 'symbol-sheet-overlay';
  overlay.onclick = (e) => { if (e.target === overlay) closeSymbolSheet(); };
  overlay.innerHTML = `
    <div class="symbol-sheet" role="dialog" aria-modal="true">
      <div class="symbol-sheet-handle"></div>
      <div class="symbol-sheet-name">${escapeHtml(entry.name)}</div>
      <div class="symbol-sheet-text">${escapeHtml(entry.text)}</div>
      <button type="button" class="symbol-sheet-close" onclick="closeSymbolSheet()">Close</button>
    </div>
  `;
  document.body.appendChild(overlay);
}

function closeSymbolSheet() {
  const existing = document.getElementById('symbol-sheet-overlay');
  if (existing) existing.remove();
}

// Marker-style picker — lets the user choose this grave's pin: their personal
// cemetery-map pin AND, for the first public scanner, the grave's permanent
// global-map marker (first-wins). Mirrors the mobile ResultScreen "Marker" chip.
// Shown for the signed-in user's own non-global story with a location — saved OR
// unsaved (the grave is created during the pipeline, so a pre-save pick can stake
// it immediately). Global bios are hidden (no editable pin).
function renderMarkerSection(story, alreadySaved) {
  const existing = document.getElementById('marker-section');
  if (existing) existing.remove();

  if (!currentUser || story._isGlobal) return;
  if (!story.gps && !story.location) return;

  // Operate on the saved row when one exists (it has the id for cloud update);
  // otherwise operate on the in-memory story so a pre-save pick carries into
  // saveStory() AND stakes the already-created grave's global pin immediately.
  const target = savedStories.find(s => s.timestamp === story.timestamp) || story;

  const body = document.getElementById('result-body');
  if (!body) return;

  const currentStyle = target.marker_style || DEFAULT_MARKER;
  // Before save the marker's headline meaning is the community global map
  // (first-wins); after save it's also the user's own Cemetery-map pin.
  const hint = alreadySaved
    ? 'Map pin style'
    : 'Your map pin — first to share wins it on the community map';
  const wrap = document.createElement('div');
  wrap.id = 'marker-section';
  wrap.className = 'result-section';
  wrap.style.cssText = 'border-top:1px solid rgba(201,168,76,0.2);padding-top:1rem;margin-top:1rem;';
  wrap.innerHTML = `
    <div style="font-family:'Crimson Pro',serif;color:var(--stone);font-size:0.8rem;font-style:italic;margin-bottom:0.5rem;letter-spacing:0.05em;text-transform:uppercase;">${escapeHtml(hint)}</div>
    <div style="display:flex;align-items:center;justify-content:space-between;gap:1rem;">
      <div style="display:flex;align-items:center;gap:0.75rem;">
        <div style="width:40px;height:40px;line-height:0;">${graveMarkerSvg(currentStyle, 40)}</div>
        <div style="font-family:'Playfair Display',serif;color:var(--ink);font-size:0.95rem;">${escapeHtml(getMarker(currentStyle).label)}</div>
      </div>
      <button id="marker-pick-btn" style="background:rgba(201,168,76,0.15);border:1px solid rgba(201,168,76,0.5);color:var(--ink);font-family:'Crimson Pro',serif;font-size:0.85rem;padding:0.5rem 0.9rem;cursor:pointer;border-radius:3px;white-space:nowrap;">
        Change pin
      </button>
    </div>
  `;
  body.appendChild(wrap);

  document.getElementById('marker-pick-btn').onclick = () => openMarkerPicker(target, alreadySaved);
}

// Slide-up modal grid of all 20 marker styles. Picking one persists immediately
// (local + cloud when saved) and stakes the grave's global-map pin, then
// re-renders the result screen so the new pin shows.
function openMarkerPicker(savedRow, alreadySaved) {
  const existing = document.getElementById('marker-picker-overlay');
  if (existing) existing.remove();

  const currentStyle = savedRow.marker_style || DEFAULT_MARKER;
  // Open on the pack that holds the current selection, so the active pin is visible.
  let activePack = (getMarker(currentStyle).pack) || MARKER_PACKS[0].id;
  const overlay = document.createElement('div');
  overlay.id = 'marker-picker-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(10,8,5,0.7);z-index:1000;display:flex;align-items:flex-end;justify-content:center;';

  const cellHtml = m => {
    const active = m.id === currentStyle;
    return `
      <button class="marker-pick-cell" data-style="${m.id}" style="
        background:${active ? 'rgba(201,168,76,0.18)' : 'rgba(255,255,255,0.03)'};
        border:1px solid ${active ? 'rgba(201,168,76,0.8)' : 'rgba(201,168,76,0.2)'};
        border-radius:6px;padding:0.5rem 0.25rem;cursor:pointer;display:flex;
        flex-direction:column;align-items:center;gap:0.3rem;">
        <div style="width:44px;height:44px;line-height:0;">${graveMarkerSvg(m.id, 44)}</div>
        <span style="font-family:'Crimson Pro',serif;color:var(--cream,#e8d4a0);font-size:0.7rem;text-align:center;line-height:1.1;">${escapeHtml(m.label)}</span>
      </button>
    `;
  };

  const tabsHtml = () => MARKER_PACKS.map(p => {
    const on = p.id === activePack;
    return `<button class="marker-pack-tab" data-pack="${p.id}" style="
      background:${on ? 'rgba(201,168,76,0.2)' : 'transparent'};
      border:1px solid ${on ? 'rgba(201,168,76,0.7)' : 'rgba(201,168,76,0.25)'};
      color:${on ? 'var(--gold,#c9a84c)' : 'var(--cream,#e8d4a0)'};
      font-family:'Crimson Pro',serif;font-size:0.82rem;line-height:1.4;padding:0.4rem 0.9rem;
      border-radius:999px;cursor:pointer;white-space:nowrap;flex:0 0 auto;">${escapeHtml(p.label)}</button>`;
  }).join('');

  overlay.innerHTML = `
    <div style="background:#1a1410;border-top-left-radius:16px;border-top-right-radius:16px;border-top:1px solid rgba(201,168,76,0.3);width:100%;max-width:520px;max-height:80vh;overflow-y:auto;padding:1.2rem 1rem 1.6rem;">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:0.9rem;">
        <div style="font-family:'Playfair Display',serif;color:var(--gold,#c9a84c);font-size:1.05rem;">Choose a map pin</div>
        <button id="marker-picker-close" style="background:none;border:none;color:var(--cream,#e8d4a0);font-size:1.4rem;cursor:pointer;line-height:1;padding:0 0.25rem;">×</button>
      </div>
      <div id="marker-pack-tabs" style="display:flex;gap:0.5rem;overflow-x:auto;margin-bottom:1rem;padding:0.15rem 0 0.45rem;">${tabsHtml()}</div>
      <div id="marker-pick-grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(78px,1fr));gap:0.6rem;"></div>
    </div>
  `;
  document.body.appendChild(overlay);

  const gridEl = overlay.querySelector('#marker-pick-grid');
  const tabsEl = overlay.querySelector('#marker-pack-tabs');

  function renderGrid() {
    gridEl.innerHTML = MARKER_STYLES.filter(m => m.pack === activePack).map(cellHtml).join('');
    gridEl.querySelectorAll('.marker-pick-cell').forEach(bindCell);
  }
  function renderTabs() {
    tabsEl.innerHTML = tabsHtml();
    tabsEl.querySelectorAll('.marker-pack-tab').forEach(tab => {
      tab.onclick = () => { activePack = tab.getAttribute('data-pack'); renderTabs(); renderGrid(); };
    });
  }

  const close = () => overlay.remove();
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  document.getElementById('marker-picker-close').onclick = close;

  function bindCell(cell) {
    cell.onclick = async () => {
      const styleId = cell.getAttribute('data-style');
      savedRow.marker_style = styleId;
      if (currentStory && currentStory.timestamp === savedRow.timestamp) {
        currentStory.marker_style = styleId;
      }
      close();
      // Self-heal a missing grave link: if findOrCreateGrave failed during the
      // pipeline (non-fatal) the story has no grave_id, so a pick would never
      // stake. Create-and-stake in one shot and backfill grave_id.
      if (!savedRow.grave_id && currentUser && savedRow.gps && savedRow.name) {
        const gid = await findOrCreateGrave(savedRow.name, savedRow.gps.lat, savedRow.gps.lng, !!savedRow.is_public, styleId);
        if (gid) {
          savedRow.grave_id = gid;
          if (currentStory && currentStory.timestamp === savedRow.timestamp) currentStory.grave_id = gid;
        }
      }
      // UNSAVED story: do NOT write a cloud row here. The in-memory
      // currentStory.marker_style mutation above is carried into saveStory(),
      // which owns the single INSERT. Calling persistSave here would (a) mint a
      // cloud row before the user taps Save — a pick-then-leave still left the
      // story in the cloud — and (b) NOT add savedRow to savedStories, so the
      // later saveStory() (its double-save guard keys on savedStories
      // membership) INSERTs a SECOND row → duplicate in Remembered Stories.
      // (H6, web counterpart of the mobile handlePickMarker fix.) The grave is
      // already staked via findOrCreateGrave above/at pipeline time, so the
      // global pin still lands immediately.
      if (alreadySaved) {
        // Persist the marker to the cloud stories row so it survives a device
        // switch / reinstall. persistUpdate when we have an id, else persistSave
        // to MINT one for a saved-but-not-yet-cloud-synced story.
        if (savedRow.id) await persistUpdate(savedRow);
        else if (currentUser) await persistSave(savedRow);
      }
      // Stake this grave's permanent global-map pin (first-wins, NULL-guarded
      // server-side). The grave already exists from the pipeline, so this
      // works even before the story row is saved. No-ops without a grave_id.
      if (savedRow.grave_id) setGraveMarker(savedRow.grave_id, styleId);
      // Re-render so the marker section reflects the new choice
      renderResult(currentStory || savedRow);
    };
  }

  renderTabs();
  renderGrid();
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
    const goingPublic = !savedRow.is_public;
    // First time a user shares ANY story publicly, make them read+accept a
    // one-time notice that public stories are visible to everyone and may name
    // others. Acknowledged once, then never again (flag gs_share_notice_seen).
    // Making a story private again never gates.
    if (goingPublic && !_hasSeenShareNotice()) {
      showShareNoticeOnce(() => _applyVisibilityToggle(savedRow));
      return;
    }
    _applyVisibilityToggle(savedRow);
  };
}

// Performs the actual public/private flip + persist + re-render. Split out so the
// first-share consent gate can call it after the user accepts the notice.
async function _applyVisibilityToggle(savedRow) {
  const btn = document.getElementById('visibility-toggle-btn');
  if (btn) { btn.disabled = true; btn.textContent = '…'; }
  savedRow.is_public = !savedRow.is_public;
  // Mirror in currentStory so the UI re-render after toggle is consistent
  if (currentStory && currentStory.timestamp === savedRow.timestamp) {
    currentStory.is_public = savedRow.is_public;
  }
  if (savedRow.is_public) {
    logEvent(ANALYTICS_EVENTS.MADE_PUBLIC, {});
    // Before a story reaches the public global map, strip the names of any
    // LIVING relatives from the bio prose (privacy/defamation guard). Done
    // once and cached on the row; the redacted copy is what the global RPC
    // serves. Non-blocking-safe: on any failure redactLivingNamesForPublic
    // returns the original, so sharing never breaks.
    if (!savedRow.public_biography && savedRow.biography &&
        typeof redactLivingNamesForPublic === 'function') {
      if (btn) btn.textContent = 'Preparing…';
      try {
        const subjects = Array.isArray(savedRow.subjects) ? savedRow.subjects
          : (Array.isArray(savedRow.graveData?.subjects) ? savedRow.graveData.subjects : []);
        savedRow.public_biography = await redactLivingNamesForPublic(savedRow.biography, subjects);
        if (currentStory && currentStory.timestamp === savedRow.timestamp) {
          currentStory.public_biography = savedRow.public_biography;
        }
      } catch (e) {
        console.warn('public_biography redaction skipped (non-fatal):', e?.message || e);
      }
    }
  }
  await persistUpdate(savedRow);
  renderVisibilityControls(currentStory || savedRow, true);
}

// ── FIRST-SHARE PUBLIC NOTICE (one-time) ─────────────────────────
// Shown the first time a user shares any story to the public community map.
// Informed-consent moment at the action that creates the exposure: public
// stories are visible to everyone and may name other people. Reuses the
// symbol bottom-sheet shell. onAccept runs the share; cancel aborts it.
const SHARE_NOTICE_SEEN_KEY = 'gs_share_notice_seen';

function _hasSeenShareNotice() {
  try { return localStorage.getItem(SHARE_NOTICE_SEEN_KEY) === 'true'; } catch (e) { return false; }
}

function showShareNoticeOnce(onAccept) {
  const existing = document.getElementById('share-notice-overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'share-notice-overlay';
  overlay.className = 'symbol-sheet-overlay';
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  overlay.innerHTML = `
    <div class="symbol-sheet" role="dialog" aria-modal="true">
      <div class="symbol-sheet-handle"></div>
      <div class="symbol-sheet-name">Sharing publicly</div>
      <div class="symbol-sheet-text">
        Public stories appear on the community map for anyone to see, including the
        biography, photo, name, dates, and approximate location — and they may name
        other people. Only share stories you're comfortable making public, and please
        don't share private details about living people. You can make a story private
        again at any time.
      </div>
      <div class="report-actions" style="margin-top:1.2rem;">
        <button type="button" class="report-cancel" id="share-notice-cancel">Cancel</button>
        <button type="button" class="report-submit" id="share-notice-accept">Share publicly</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  document.getElementById('share-notice-cancel').onclick = () => overlay.remove();
  document.getElementById('share-notice-accept').onclick = () => {
    try { localStorage.setItem(SHARE_NOTICE_SEEN_KEY, 'true'); } catch (e) {}
    overlay.remove();
    if (typeof onAccept === 'function') onAccept();
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
        // Log only when a tribute is added (not toggled off), so the count tracks
        // engagement, not removals. logEvent is a global from js/analytics.js.
        if (newType && typeof logEvent === 'function') logEvent(ANALYTICS_EVENTS.TRIBUTE_LEFT, { type: newType });
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
         <img src="${escapeHtml(src)}" alt="Gravestone photo ${i + 1}" loading="${i === 0 ? 'eager' : 'lazy'}">
         <span class="grave-gallery-label">Photo ${i + 1} of ${photos.length}</span>
       </div>`
    ).join('');
    const portraitSlides = portraits.map(src =>
      `<div class="grave-gallery-slide portrait">
         <img src="${escapeHtml(src)}" alt="Portrait" loading="lazy">
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
