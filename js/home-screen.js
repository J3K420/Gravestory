// ===================================================================
// HOME-SCREEN.JS  (Stage 7 extraction)
// ===================================================================
//
// Owns the Remembered-Stories saved list, its sort bar, and row-level actions:
//   - renderSavedList()           Repaint the #saved-list from savedStories in the
//                                 current sort mode ('recent' | 'name' | 'cemetery').
//   - setSavedSort(mode)          Switch sort mode (wired to the .sort-pill buttons).
//   - toggleCemeteryGroup(name)   Expand/collapse a >5-story cemetery group.
//   - loadSavedByTs(ts)           Open a saved story (keyed by timestamp, not index).
//   - deleteSavedByTs(event, ts)  Confirm + remove + persist-delete a saved story.
//
// Sort mode mirrors the mobile RememberedStoriesScreen. Action handlers are keyed by
// the story's `timestamp` rather than its array index because sorting/grouping makes
// the rendered order diverge from the savedStories array order.
//
// EXTERNAL SYMBOLS CONSUMED (resolved via classic-script shared lexical scope):
//   - savedStories            (inline state in index.html: read + mutated)
//   - currentStory            (inline state in index.html: written by loadSaved)
//   - renderResult            (js/render-result.js)
//   - showScreen              (inline in index.html; the window.showScreen override
//                              installed at the camera-reset block remains effective)
//   - updateHomeMapButton     (promoted into THIS module by Stage 12. Defined at the
//                              bottom of this file. deleteSaved() now resolves it
//                              within the same module scope, no window indirection.)
//   - persistDelete           (js/persistence.js)
//
// PUBLIC API EXPOSED:
//   - renderSavedList, loadSaved, deleteSaved are top-level function declarations
//     in a classic script, so they auto-attach to the global object. Inline onclick
//     handlers built inside renderSavedList ("onclick=\"loadSaved(${i})\"" and
//     "onclick=\"deleteSaved(event, ${i})\"") resolve against window at click time;
//     function declarations satisfy that requirement automatically.
//
// CALL SITES OUTSIDE THIS MODULE (post-Stage 7):
//   - renderSavedList(): called from inline INIT in index.html, from showScreen() when
//     navigating to #remembered-stories, and from signOut() in js/auth.js. All are
//     classic scripts in the same realm; resolution is safe.
//   - setSavedSort / toggleCemeteryGroup / loadSavedByTs / deleteSavedByTs: invoked via
//     the dynamic onclick attributes built inside renderSavedList / the sort-bar markup.
//
// TIMING-LESSON AUDIT (Stage 4 discipline carried forward):
//   This module has ZERO load-time side effects beyond two module-level state vars
//   (_savedSortBy, _expandedCemeteries). Only declarations sit at the top level;
//   nothing runs until something else calls in. Safe to load in <head> in any order
//   relative to other classic scripts. No DOMContentLoaded guard needed.
// ===================================================================

// Sort mode for the Remembered Stories list: 'recent' | 'name' | 'cemetery'.
// Mirrors the mobile RememberedStoriesScreen sort bar.
var _savedSortBy = 'recent';
// Cemetery group names the user has manually expanded (>5-story groups start collapsed).
var _expandedCemeteries = new Set();

function _cemeteryName(story) {
  if (!story.location) return 'Unknown Cemetery';
  return story.location.split(',')[0].trim();
}

// Render a single saved-story card. Action handlers are keyed by timestamp so they
// resolve correctly regardless of sort order or grouping (indices into savedStories
// no longer match the rendered order once sorted/grouped).
function _savedCardHtml(s) {
  const ts = s.timestamp ?? '';
  return `
    <div class="saved-card" style="display:flex;align-items:center;gap:0.5rem;">
      <div style="flex:1;min-width:0;cursor:pointer;" onclick="loadSavedByTs(${JSON.stringify(ts)})">
        <div class="saved-card-name">${escapeHtml(s.name || 'Unknown')}</div>
        <div class="saved-card-date">${escapeHtml(s.dates || '')}</div>
      </div>
      ${s.is_public ? '<span class="saved-card-public">public</span>' : ''}
      <span style="color:var(--gold);opacity:0.5;cursor:pointer;" onclick="loadSavedByTs(${JSON.stringify(ts)})">→</span>
      <button onclick="deleteSavedByTs(event, ${JSON.stringify(ts)})" title="Delete story"
        style="background:none;border:none;color:rgba(139,58,42,0.6);font-size:1.1rem;cursor:pointer;padding:0.25rem 0.4rem;flex-shrink:0;line-height:1;border-radius:3px;"
        onmouseover="this.style.color='#8b3a2a';this.style.background='rgba(139,58,42,0.1)'"
        onmouseout="this.style.color='rgba(139,58,42,0.6)';this.style.background='none'">✕</button>
    </div>
  `;
}

function renderSavedList() {
  const list = document.getElementById('saved-list');
  const sortBar = document.getElementById('saved-sort-bar');
  if (savedStories.length === 0) {
    if (sortBar) sortBar.style.display = 'none';
    list.innerHTML = '<p class="empty-saved">Your saved stories will appear here</p>';
    return;
  }
  if (sortBar) sortBar.style.display = 'flex';

  if (_savedSortBy === 'cemetery') {
    const groups = new Map();
    for (const s of savedStories) {
      const key = _cemeteryName(s);
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(s);
    }
    const ordered = [...groups.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, items]) => ({
        name,
        items: [...items].sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0)),
      }));

    list.innerHTML = ordered.map(group => {
      const collapsible = group.items.length > 5;
      const expanded = !collapsible || _expandedCemeteries.has(group.name);
      const cards = expanded ? group.items.map(_savedCardHtml).join('') : '';
      const chevron = collapsible ? `<span class="cemetery-chevron">${expanded ? '▾' : '▸'}</span>` : '';
      // Build a JS-string-literal argument, then HTML-escape it for the attribute so a
      // cemetery name with quotes can neither break the JS call nor the onclick="" attr.
      const jsArg = escapeHtml(JSON.stringify(group.name));
      const onclick = collapsible ? `onclick="toggleCemeteryGroup(${jsArg})"` : '';
      return `
        <div class="cemetery-group">
          <div class="cemetery-header" ${onclick} style="${collapsible ? 'cursor:pointer;' : ''}">
            <span class="cemetery-name">${escapeHtml(group.name)}</span>
            <span class="cemetery-badge">${group.items.length}</span>
            ${chevron}
          </div>
          ${cards}
        </div>
      `;
    }).join('');
    return;
  }

  const sorted = [...savedStories];
  if (_savedSortBy === 'name') {
    sorted.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
  } else {
    sorted.sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));
  }
  list.innerHTML = sorted.map(_savedCardHtml).join('');
}

function setSavedSort(mode) {
  _savedSortBy = mode;
  const bar = document.getElementById('saved-sort-bar');
  if (bar) {
    bar.querySelectorAll('.sort-pill').forEach(btn => {
      btn.classList.toggle('sort-pill-active', btn.dataset.sort === mode);
    });
  }
  renderSavedList();
}

function toggleCemeteryGroup(name) {
  if (_expandedCemeteries.has(name)) _expandedCemeteries.delete(name);
  else _expandedCemeteries.add(name);
  renderSavedList();
}

function _findSavedIndexByTs(ts) {
  return savedStories.findIndex(s => String(s.timestamp ?? '') === String(ts));
}

function loadSavedByTs(ts) {
  const index = _findSavedIndexByTs(ts);
  if (index < 0) return;
  currentStory = savedStories[index];
  renderResult(currentStory);
  showScreen('result');
}

async function deleteSavedByTs(event, ts) {
  event.stopPropagation(); // prevent card click
  const index = _findSavedIndexByTs(ts);
  if (index < 0) return;
  const story = savedStories[index];
  if (!confirm(`Delete story for ${story.name || 'this person'}?`)) return;
  savedStories.splice(index, 1);
  renderSavedList();
  updateHomeMapButton();
  await persistDelete(story);
}

// ===================================================================
// Added in Stage 12: promoted from inline index.html (was physically
// inside the // ── GLOBAL MAP ── block but semantically a home-screen
// DOM concern). Toggles visibility of the home-screen "View Map"
// button based on whether any saved story has GPS or a location.
// Called from the INIT block (index.html) and from save-actions on
// save/delete (already wired via window.updateHomeMapButton).
// ===================================================================
// Show/hide map button on home screen based on whether any story has GPS or location
function updateHomeMapButton() {
  const btn = document.getElementById('home-map-btn');
  if (!btn) return;
  const hasLocation = savedStories.some(s => s.gps || s.location);
  btn.style.display = hasLocation ? 'block' : 'none';
}
