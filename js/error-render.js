// ── ERROR RENDERING ─────────────────────────────────────────────
// Standalone error/rejection handlers for the analysis flow. The
// inline catch block in startAnalysis() builds its own error-box
// content and calls retryAnalysis(); this module owns the retry,
// "this isn't a gravestone" rejection screen, and the verification
// override path.
//
// Dependencies (resolved at call time via window):
//   - escapeHtml          (util-html.js)
//   - currentImageBase64  (inline state)
//   - _bypassVerification (inline state — set true here, consumed in startAnalysis)
//   - startAnalysis       (inline)
//   - resetCamera         (inline — referenced from HTML onclick)
//
// All three functions hoist to window so the HTML onclick="..."
// references in the error-box markup resolve at event time.

// Retry the last analysis with the image still in memory.
function retryAnalysis() {
  const errBox = document.getElementById('error-box');
  if (errBox) errBox.style.display = 'none';
  if (!currentImageBase64) {
    // Image was lost somehow — guide user to re-upload
    if (errBox) {
      errBox.innerHTML = 'Image no longer available — please choose a photo again.';
      errBox.style.display = 'block';
    }
    return;
  }
  startAnalysis();
}

// Render the "this doesn't look like a gravestone" rejection screen with two
// choices: pick a different photo, or override the verification and continue.
// Reuses #error-box as the container so the layout/spacing match other errors.
function showVerificationRejection(reason) {
  const errBox = document.getElementById('error-box');
  if (!errBox) return;
  const safeReason = escapeHtml(reason || 'The image does not appear to contain a gravestone.');
  errBox.innerHTML = `
    <div style="font-family:'Marcellus',serif;font-size:1rem;color:var(--gold);margin-bottom:0.5rem;letter-spacing:0.04em;">
      ⚠ This doesn't look like a gravestone
    </div>
    <div style="margin-bottom:0.9rem;font-style:italic;opacity:0.85;">${safeReason}</div>
    <div style="display:flex;gap:0.6rem;flex-wrap:wrap;">
      <button onclick="resetCamera()" style="
        background: rgba(201,168,76,0.15);
        border: 1px solid rgba(201,168,76,0.6);
        color: var(--gold);
        padding: 0.4rem 1.1rem;
        font-family: 'Marcellus', serif;
        font-size: 0.85rem;
        letter-spacing: 0.08em;
        cursor: pointer;
        font-style: normal;
      ">📷 Choose another photo</button>
      <button onclick="forceAnalyze()" style="
        background: transparent;
        border: 1px solid rgba(201,168,76,0.4);
        color: var(--gold);
        padding: 0.4rem 1.1rem;
        font-family: 'Marcellus', serif;
        font-size: 0.85rem;
        letter-spacing: 0.08em;
        cursor: pointer;
        font-style: normal;
        opacity: 0.85;
      ">Use it anyway</button>
    </div>
  `;
  errBox.style.display = 'block';
}

// Escape hatch from showVerificationRejection. Sets the one-shot bypass flag
// and re-runs startAnalysis() with the same image. The flag is consumed and
// reset inside startAnalysis() — it will not leak into subsequent runs.
function forceAnalyze() {
  if (!currentImageBase64) {
    const errBox = document.getElementById('error-box');
    if (errBox) {
      errBox.innerHTML = 'Image no longer available — please choose a photo again.';
      errBox.style.display = 'block';
    }
    return;
  }
  _bypassVerification = true;
  document.getElementById('error-box').style.display = 'none';
  startAnalysis();
}
