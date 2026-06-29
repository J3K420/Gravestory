// render-result.js — Render the read-only public bio screen (extracted Stage 4).
//
// LANDING-PAGE CONVERSION (web → app-store pointer): this file was stripped to a
// READ-ONLY renderer. The web app no longer scans or saves stories; the only way
// a bio reaches this screen is viewGlobalStory() (js/map-global.js) opening a
// PUBLIC story from the community global map. All owner/write features —
// Save/Share/GEDCOM buttons, the public/private visibility toggle, the marker-
// style picker, and tribute (candle/flower) counts — were removed along with the
// scan pipeline. The "Report a problem" link survives (defamation takedown path
// on the now-indexable public surface). render-result.js references ZERO
// deleted-pipeline symbols after this strip.

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
  // and is not an authoritative record. The "Report a problem" link is the
  // takedown path for a wrong/defaming public bio (a relative who finds a bad
  // bio can flag it without an account). The first-ever view also gets the
  // one-time explainer modal (showAiDisclaimerOnce below).
  if ((story.biography || '').trim()) {
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

  // Mentions — a tappable "Also found in…" chip opening a sheet of name-safe
  // one-line hyperlinks to the research sources for this person.
  renderMentionsSection(story);

  // Show map button if GPS or text location available (back to the global map).
  const mapBtn = document.getElementById('result-map-btn');
  if (mapBtn) {
    if (story.gps || story.location) {
      mapBtn.classList.add('visible');
    } else {
      mapBtn.classList.remove('visible');
    }
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
// Lets any viewer flag a generated biography. Reason chips + an optional note →
// submitContentReport (js/api-reports.js) writes to the content_reports table.
// Open to everyone by design: a relative who finds a wrong public bio should be
// able to report it without an account. This is the defamation/takedown path on
// the public, indexable community surface.
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
// Meaning lookup goes through lookupSymbolMeaning() (js/symbols.js, on window via
// the classic-script convention). Per CLAUDE.md we never embed data in onclick:
// each tappable chip stores its meaning in a module-level map keyed by an id and
// a named handler (openSymbolSheet) reads from it.
let _symbolSheetLookup = {};

function renderSymbolSection(story) {
  // Remove any prior render (re-render re-runs renderResult).
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

// ── MENTIONS SECTION ─────────────────────────────────────────────
// A single "Also found in…" chip that opens a bottom-sheet list of name-safe
// one-line hyperlinks to this person's research sources (Tavily web / FindAGrave
// / Chronicling America / Internet Archive / Wikipedia). The sentence text is
// the link label, authored under the living-name rule, so it is safe to show on
// public/global stories. Mirrors the symbol-chip pattern: the list is stored in
// a module-level lookup, never embedded in onclick.
let _mentionSheetLookup = [];

function renderMentionsSection(story) {
  const existing = document.getElementById('mentions-section');
  if (existing) existing.remove();
  _mentionSheetLookup = [];

  const mentions = Array.isArray(story.mentions)
    ? story.mentions.filter(m => m && typeof m.sentence === 'string' && m.sentence.trim())
    : [];
  if (mentions.length === 0) return;

  const body = document.getElementById('result-body');
  if (!body) return;

  _mentionSheetLookup = mentions;

  const section = document.createElement('div');
  section.id = 'mentions-section';
  section.className = 'result-section';
  section.innerHTML = `
    <div class="section-label">Mentions</div>
    <div class="symbol-chips">
      <button type="button" class="symbol-chip symbol-chip-tappable" onclick="openMentionSheet()">Also found in… <span class="symbol-chip-caret">›</span></button>
    </div>
  `;
  body.appendChild(section);
}

// Open the mentions sheet. Reads the list from the module-level lookup (never
// from onclick data). Each sentence is a single hyperlink; a hit whose URL isn't
// a usable http(s) link (link-rot) renders as non-clickable text but still reads.
function openMentionSheet() {
  const list = _mentionSheetLookup;
  if (!Array.isArray(list) || list.length === 0) return;
  closeMentionSheet();

  const rows = list.map(m => {
    const clickable = typeof m.url === 'string' && /^https?:\/\//i.test(m.url);
    const label = escapeHtml(m.sentence);
    return clickable
      ? `<a class="mention-line" href="${escapeHtml(m.url)}" target="_blank" rel="noopener noreferrer">${label}</a>`
      : `<div class="mention-line mention-line-dead">${label}</div>`;
  }).join('');

  const overlay = document.createElement('div');
  overlay.id = 'mention-sheet-overlay';
  overlay.className = 'symbol-sheet-overlay';
  overlay.onclick = (e) => { if (e.target === overlay) closeMentionSheet(); };
  overlay.innerHTML = `
    <div class="symbol-sheet" role="dialog" aria-modal="true">
      <div class="symbol-sheet-handle"></div>
      <div class="symbol-sheet-name">Also found in…</div>
      <div class="mention-lines">${rows}</div>
      <button type="button" class="symbol-sheet-close" onclick="closeMentionSheet()">Close</button>
    </div>
  `;
  document.body.appendChild(overlay);
}

function closeMentionSheet() {
  const existing = document.getElementById('mention-sheet-overlay');
  if (existing) existing.remove();
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
