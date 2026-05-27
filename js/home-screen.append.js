
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
