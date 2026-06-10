// js/api-internetarchive.js
// Direct queries to the Internet Archive (archive.org). Free, no key, CORS-open.
//
// 19th- and early-20th-century county/local histories ("History of Allegheny
// County, Pennsylvania" and the like) are the canonical printed source for
// ordinary people of that era. They are full-text searchable on archive.org and
// are public domain. We tag results source_type: 'archive' — public-domain like
// Chronicling America, but a DISTINCT citation label ([Internet Archive]) so the
// biography never miscredits a county history to Chronicling America.
//
// Two-step, both free and CORS-open (verified against the live API):
//   1. advancedsearch.php — find PD texts (mediatype:texts) whose OCR mentions
//      the surname AND a place token, scoped to the PD-era year range.
//   2. download/{id}/{id}_djvu.txt — the raw OCR of the top hit; we window ~800
//      chars around the surname (same technique as Chronicling America) so Gemini
//      gets the biographical passage, not just a book title. The download endpoint
//      302s to a data node and sends Access-Control-Allow-Origin:* (browser-safe).
//
// Cutoff is 1925: county histories taper off after, and Chronicling America /
// Tavily obituary slots cover the later period better. Below it, archive.org is
// often the ONLY source for an ordinary rural person. Strictly ADDITIVE — results
// are merged into searchResults alongside Tavily/CA, never replacing anything.

const _IA_CUTOFF = 1925;
// Cap how much of a (potentially multi-MB) OCR file we pull before giving up on
// finding the surname. 3 MB comfortably covers a county-history volume's front
// matter + biographical section without reading an unbounded body.
const _IA_MAX_OCR_BYTES = 3 * 1024 * 1024;

async function searchInternetArchive(name, deathYear, location) {
  if (!name || !deathYear) return [];
  const year = parseInt(deathYear, 10);
  if (isNaN(year) || year > _IA_CUTOFF) return [];

  const surname = name.trim().split(/\s+/).pop();
  if (!surname || surname.length < 3) return [];

  // Place token (first segment of "City, State") tightens the full-text match so
  // we surface the county/local history that actually covers this person's region.
  const placeTok = (location || '').split(',')[0].trim();

  // Step 1 — find a public-domain text mentioning the surname (+ place if known),
  // restricted to the PD era. IA collapses phrase quotes to a loose text: match,
  // so the AND of surname+place+year is what keeps it targeted.
  const qParts = [
    'mediatype:texts',
    `"${surname}"`,
    placeTok ? `"${placeTok}"` : '',
    `year:[1820 TO ${_IA_CUTOFF}]`,
  ].filter(Boolean);
  const q = encodeURIComponent(qParts.join(' AND '));
  const searchUrl = `https://archive.org/advancedsearch.php` +
    `?q=${q}&fl[]=identifier&fl[]=title&fl[]=year&rows=4&page=1&output=json`;

  let docs;
  try {
    const res = await fetch(searchUrl, { headers: { 'Accept': 'application/json' } });
    if (!res.ok) return [];
    const data = await res.json();
    docs = data?.response?.docs;
  } catch {
    return [];
  }
  if (!Array.isArray(docs) || docs.length === 0) return [];

  // Step 2 — pull the OCR of the top candidates and window around the surname.
  // Only the first 2 hits, and we stop as soon as one yields a passage.
  const fullName = name.trim();
  const firstName = fullName.split(/\s+/)[0];
  const out = [];
  for (const doc of docs.slice(0, 2)) {
    if (!doc.identifier) continue;
    const snippet = await _ocrWindow(doc.identifier, surname, firstName);
    if (!snippet) continue;
    out.push({
      title: `${doc.title || 'Archive.org'}${doc.year ? ' (' + doc.year + ')' : ''}`,
      url: `https://archive.org/details/${doc.identifier}`,
      content: snippet,
      source_type: 'archive',
    });
    if (out.length >= 2) break;
  }
  return out;
}

// Stream the item's raw _djvu.txt OCR (capped) and return a ~800-char window
// around the first occurrence of the surname that also sits near the first name
// when possible — favouring the biographical entry over a stray index mention.
// Null if the file is missing or the surname never appears in the read window.
async function _ocrWindow(identifier, surname, firstName) {
  const url = `https://archive.org/download/${encodeURIComponent(identifier)}/${encodeURIComponent(identifier)}_djvu.txt`;
  try {
    const res = await fetch(url, { headers: { 'Accept': 'text/plain' } });
    if (!res.ok || !res.body) return null;

    // Read incrementally so we can bail at the cap and as soon as we have enough
    // context after the first surname hit — avoids buffering an entire volume.
    const reader = res.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buf = '';
    let bytes = 0;
    const sLower = surname.toLowerCase();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      buf += decoder.decode(value, { stream: true });
      const hit = buf.toLowerCase().indexOf(sLower);
      // Once we've seen the surname AND have ~800 chars past it, we can stop.
      if (hit !== -1 && buf.length - hit > 800) { reader.cancel().catch(() => {}); break; }
      if (bytes >= _IA_MAX_OCR_BYTES) { reader.cancel().catch(() => {}); break; }
    }

    const clean = buf.replace(/\s+/g, ' ').trim();
    const lower = clean.toLowerCase();
    // Prefer a surname occurrence that has the first name within ~120 chars before
    // it (e.g. "John Smith, a farmer …") — that's the biographical entry shape.
    let idx = -1;
    if (firstName) {
      const fLower = firstName.toLowerCase();
      let from = 0;
      while (true) {
        const cand = lower.indexOf(sLower, from);
        if (cand === -1) break;
        const pre = lower.slice(Math.max(0, cand - 120), cand);
        if (pre.includes(fLower)) { idx = cand; break; }
        from = cand + sLower.length;
      }
    }
    if (idx === -1) idx = lower.indexOf(sLower);
    if (idx === -1) return null;

    const start = Math.max(0, idx - 250);
    const snippet = clean.slice(start, start + 800).trim();
    return snippet.length > 60 ? snippet : null;
  } catch {
    return null;
  }
}
