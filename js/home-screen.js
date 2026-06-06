// ===================================================================
// HOME-SCREEN.JS  (Stage 7 extraction)
// ===================================================================
//
// Owns the home-screen saved-stories list and its row-level actions:
//   - renderSavedList()        Repaint the #saved-list element from savedStories.
//   - loadSaved(index)         Open a saved story on the result screen.
//   - deleteSaved(event, idx)  Confirm + remove + persist-delete a saved story.
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
//   - renderSavedList(): called from inline INIT in index.html and from signOut() in
//     js/auth.js. Both are classic scripts in the same realm; resolution is safe.
//   - loadSaved(): only invoked via the dynamic onclick built inside renderSavedList.
//   - deleteSaved(): same -- only via the dynamic onclick.
//
// TIMING-LESSON AUDIT (Stage 4 discipline carried forward):
//   This module has ZERO load-time side effects. Only function declarations sit at
//   the top level; nothing runs until something else calls in. Safe to load in <head>
//   in any order relative to other classic scripts. No DOMContentLoaded guard needed.
//
// BYTE-IDENTITY: the bytes below from "function renderSavedList()" through the
// closing brace of deleteSaved() are a verbatim splice from the post-Stage-6
// index.html (lines 1105..1141 inclusive). Reconstruction proof in splice.py asserts
// byte equality of  original_index.html  ==  new_index.html minus this block plus
// the new <script src> line, with zero drift.
// ===================================================================

function renderSavedList() {
  const list = document.getElementById('saved-list');
  if (savedStories.length === 0) {
    list.innerHTML = '<p class="empty-saved">Your saved stories will appear here</p>';
    return;
  }

  list.innerHTML = savedStories.map((s, i) => `
    <div class="saved-card" style="display:flex;align-items:center;gap:0.5rem;">
      <div style="flex:1;min-width:0;cursor:pointer;" onclick="loadSaved(${i})">
        <div class="saved-card-name">${escapeHtml(s.name || 'Unknown')}</div>
        <div class="saved-card-date">${escapeHtml(s.dates || '')}</div>
      </div>
      <span style="color:var(--gold);opacity:0.5;cursor:pointer;" onclick="loadSaved(${i})">→</span>
      <button onclick="deleteSaved(event, ${i})" title="Delete story"
        style="background:none;border:none;color:rgba(139,58,42,0.6);font-size:1.1rem;cursor:pointer;padding:0.25rem 0.4rem;flex-shrink:0;line-height:1;border-radius:3px;"
        onmouseover="this.style.color='#8b3a2a';this.style.background='rgba(139,58,42,0.1)'"
        onmouseout="this.style.color='rgba(139,58,42,0.6)';this.style.background='none'">✕</button>
    </div>
  `).join('');
}

function loadSaved(index) {
  currentStory = savedStories[index];
  renderResult(currentStory);
  showScreen('result');
}

async function deleteSaved(event, index) {
  event.stopPropagation(); // prevent card click
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
