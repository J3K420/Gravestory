// util-dom.js — DOM navigation, hash routing, popstate handling (extracted Stage 4)

// ── NAVIGATION ───────────────────────────────────────────────────
// Hash-based routing so reload returns the user to their current screen
// (previous pushState('', '', '') wrote to an empty URL and lost state on reload).
//
// URL shape: yourdomain.com/Gravestory/        → home
//            yourdomain.com/Gravestory/#camera → camera, etc.

const VALID_SCREENS = [
  'home', 'auth', 'settings', 'camera', 'result',
  'cemetery-map-screen', 'global-map-screen'
  // NOTE: 'loading' deliberately excluded — reload mid-research should
  // fall back to home, not get stuck on a spinner with no in-flight work.
];

// Suppress history mutations when the screen change is itself caused by
// a popstate or by initial hash restoration.
let _navigatingViaHistory = false;

function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  window.scrollTo(0, 0);
  if (id === 'home') {
    renderSavedList();
    updateHomeMapButton();
  }

  if (!_navigatingViaHistory) {
    const targetHash = id === 'home' ? '' : '#' + id;
    if (location.hash !== targetHash) {
      if (id === 'home') {
        // Strip the hash entirely so root reloads stay on home.
        history.replaceState({ screen: id }, '', location.pathname + location.search);
      } else {
        history.pushState({ screen: id }, '', targetHash);
      }
    }
  }
}

// Single dispatcher used by both initial hash restore and popstate, so the
// special cases (story rehydration, map (re-)initialization) stay in one place.
function _navigateToHashTarget(target) {
  if (target === 'result') {
    // Rehydrate the last viewed story from localStorage on reload / shared link.
    const saved = localStorage.getItem('gs_last_story');
    if (saved) {
      try {
        currentStory = JSON.parse(saved);
        showScreen('result');
        renderResult(currentStory);
        return;
      } catch {
        // Corrupted blob — fall through to home rather than crash.
      }
    }
    showScreen('home');
  } else if (target === 'cemetery-map-screen') {
    // openCemeteryMap() handles Leaflet init + invalidateSize. A bare
    // showScreen() here would leave the map container empty.
    // Rehydrate focus story so a reload on a single-cemetery view stays
    // narrowed to that cemetery instead of widening to the global map.
    let focus = null;
    const savedFocus = localStorage.getItem('gs_map_focus');
    if (savedFocus) {
      try { focus = JSON.parse(savedFocus); } catch { /* fall through unfocused */ }
    }
    openCemeteryMap(focus);
  } else if (target === 'global-map-screen') {
    openGlobalMap();
  } else {
    showScreen(target);
  }
}

function restoreScreenFromUrl() {
  const hash = location.hash.replace('#', '');
  const target = VALID_SCREENS.includes(hash) ? hash : 'home';
  _navigatingViaHistory = true;
  try {
    _navigateToHashTarget(target);
  } finally {
    _navigatingViaHistory = false;
  }
}

// Hardware back button, mouse back, Alt+Left, etc.
window.addEventListener('popstate', (event) => {
  _navigatingViaHistory = true;
  const raw = (event.state && event.state.screen)
    || (location.hash.replace('#', '') || 'home');
  const safeTarget = VALID_SCREENS.includes(raw) ? raw : 'home';
  try {
    _navigateToHashTarget(safeTarget);
  } finally {
    _navigatingViaHistory = false;
  }
});

// Kick off initial routing AFTER the synchronous script finishes parsing.
// Function declarations are hoisted, but `let`/`const` bindings used by
// those functions (e.g. `mapPreviousScreen` inside openCemeteryMap) are
// in the Temporal Dead Zone until their declaration line is reached.
// A 0ms setTimeout pushes restoreScreenFromUrl into the next tick, by
// which point every let/const further down the file has initialized.
setTimeout(restoreScreenFromUrl, 0);
