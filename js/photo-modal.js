// ─── Module: photo-modal.js ─────────────────────────────────────
// Open/close logic for the camera-or-library picker modal shown
// when the user taps the upload zone on the home screen.
//
// All three functions hoist to window so HTML onclick="..." attrs
// on the modal markup resolve at event time. No module-level state
// — purely DOM toggling.

// ── PHOTO SOURCE MODAL ───────────────────────────────────────────
function openPhotoSourceModal() {
  // Always opens — tapping a loaded photo re-opens the picker so users
  // can swap a bad photo without hunting for a button.
  document.getElementById('photo-source-modal').classList.add('active');
}

function closePhotoSourceModal(event) {
  // If called from the backdrop, only close when the backdrop itself was clicked
  // (the inner modal stops propagation, so this is just for the explicit Cancel and backdrop).
  if (event && event.currentTarget !== event.target && event.type === 'click') {
    // backdrop click landed on backdrop itself — close
  }
  document.getElementById('photo-source-modal').classList.remove('active');
}

function pickPhotoSource(source) {
  closePhotoSourceModal();
  const inputId = source === 'camera' ? 'camera-input' : 'file-input';
  // Defer the click slightly so the modal close animation doesn't race the file picker
  setTimeout(() => { document.getElementById(inputId).click(); }, 50);
}
