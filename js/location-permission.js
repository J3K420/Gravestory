// ─────────────────────────────────────────────────────────────────
// LOCATION PERMISSION
// ─────────────────────────────────────────────────────────────────
//
// Owns the user-facing geolocation-consent flow:
//   - requestLocationPermission(callback)  — gates GPS access on a
//     remembered preference, or prompts via #location-permission-modal.
//   - handleLocationPermission(allowed)    — modal Allow/Deny handler.
//     Persists the decision to localStorage('gs_location_permission').
//   - showPrivacyInfo / closePrivacyInfo   — #privacy-modal toggles.
//   - resetLocationPermission()            — clears the stored decision
//     so the next request reprompts. Called from settings.
//
// Global dependencies (lexical scope, not on window):
//   locationPermission  — `let` declared inline in index.html, read
//     and written by this module via global scope. Same pattern the
//     Stage 4–8 modules use for state vars (currentUser, savedStories,
//     etc.). External scripts share the global lexical environment of
//     classic <script>s, so bare-name access resolves correctly.
//
// DOM dependencies:
//   #location-permission-modal, #privacy-modal — defined in index.html.
//
// onclick callers in index.html static markup:
//   handleLocationPermission(true|false), showPrivacyInfo,
//   closePrivacyInfo. Top-level function declarations in a classic
//   script auto-attach to window, so the onclick handlers resolve.
//
// Stage 9 extraction. Byte-perfect transcribe of the function bodies
// from index.html lines 1102–1132 of the pre-Stage-9 source.
// ─────────────────────────────────────────────────────────────────

function requestLocationPermission(callback) {
  // If already decided, respect the saved preference
  if (locationPermission === 'granted') { callback(true); return; }
  if (locationPermission === 'denied') { callback(false); return; }
  // First time — show the modal
  window._locationPermissionCallback = callback;
  document.getElementById('location-permission-modal').classList.remove('hidden');
}

function handleLocationPermission(allowed) {
  document.getElementById('location-permission-modal').classList.add('hidden');
  locationPermission = allowed ? 'granted' : 'denied';
  localStorage.setItem('gs_location_permission', locationPermission);
  if (window._locationPermissionCallback) {
    window._locationPermissionCallback(allowed);
    window._locationPermissionCallback = null;
  }
}

function showPrivacyInfo() {
  document.getElementById('privacy-modal').classList.remove('hidden');
}

function closePrivacyInfo() {
  document.getElementById('privacy-modal').classList.add('hidden');
}

function resetLocationPermission() {
  locationPermission = null;
  localStorage.removeItem('gs_location_permission');
}
