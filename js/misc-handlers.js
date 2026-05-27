// ════════════════════════════════════════════════════════════
// misc-handlers.js -- straggler handlers that don't fit a feature module
// ════════════════════════════════════════════════════════════
//
// MODULE SURFACE
// --------------
//   function exportCemeteryData()
//     Exports the GPS-tagged subset of savedStories[] as a JSON
//     file via a synthetic <a download> click. Invoked by the
//     cemetery-map sidebar "Export" button.
//
// EXTERNAL DEPENDENCIES
// ---------------------
//   Globals (read):   savedStories  -- declared inline in index.html.
//   Browser APIs:     Blob, URL.createObjectURL, document.createElement.
//
// CROSS-BOUNDARY CALLS (resolved via window at call time)
// -------------------------------------------------------
//   Called from HTML:
//     onclick="exportCemeteryData()"  -- cemetery-map sidebar (L328).
//
//   Resolution: classic `function NAME()` declaration attaches to
//   window, so the onclick string resolves at click time.
//
// FUTURE
// ------
//   If more straggler handlers accumulate, keep them in this file.
//   If a coherent feature emerges (e.g. all data-export flows),
//   split out then.
//
// SOURCE PROVENANCE
// -----------------
//   index.html (Stage 12 output) lines 1043-1062,
//   moved verbatim in Stage 13.
//
// ════════════════════════════════════════════════════════════


// Export cemetery data as JSON
function exportCemeteryData() {
  const mapped = savedStories.filter(s => s.gps);
  if (mapped.length === 0) { alert('No GPS data to export yet.'); return; }
  const data = mapped.map(s => ({
    name: s.name,
    dates: s.dates,
    lat: s.gps.lat,
    lng: s.gps.lng,
    location: s.location
  }));
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'gravestory-cemetery-data.json';
  a.click();
  URL.revokeObjectURL(url);
}
