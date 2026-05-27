// ════════════════════════════════════════════════════════════
// loading-ui.js -- loading-step UI for the analysis pipeline
// ════════════════════════════════════════════════════════════
//
// MODULE SURFACE
// --------------
//   const steps           -- 8-entry array of step labels (file-local).
//   function cycleSteps() -- starts a setInterval that rotates the
//                            #loading-step element through steps[].
//                            Returns the interval id so the caller
//                            can clearInterval() when the pipeline
//                            finishes (success or error).
//   function setStep(i)   -- snaps #loading-step to steps[i] without
//                            waiting for the rotation timer.
//
// EXTERNAL DEPENDENCIES
// ---------------------
//   DOM:    #loading-step       (in the loading screen)
//
// CROSS-BOUNDARY CALLS (resolved via window at call time)
// -------------------------------------------------------
//   Called from inline orchestrator (startAnalysis):
//     cycleSteps()      -- once, to start the rotation.
//     setStep(0..5)     -- six snap points across the pipeline.
//
//   Resolution: classic `function NAME()` declarations attach to
//   window, so the inline pipeline's bare calls resolve cleanly.
//
// SOURCE PROVENANCE
// -----------------
//   index.html (Stage 12 output) lines 835-858 + 1008-1012,
//   moved verbatim in Stage 13.
//
// ════════════════════════════════════════════════════════════


// ── LOADING STEPS ────────────────────────────────────────────────
const steps = [
  'Checking the photo…',
  'Reading the gravestone…',
  'Detecting location…',
  'Searching historical records…',
  'Consulting genealogy archives…',
  'Searching for obituaries…',
  'Weaving the story together…',
  'Almost ready…'
];

function cycleSteps() {
  let i = 0;
  return setInterval(() => {
    const el = document.getElementById('loading-step');
    el.style.opacity = 0;
    setTimeout(() => {
      i = Math.min(i + 1, steps.length - 1);
      el.textContent = steps[i];
      el.style.opacity = 1;
    }, 300);
  }, 2800);
}

function setStep(i) {
  const el = document.getElementById('loading-step');
  if (el) el.textContent = steps[i];
}
