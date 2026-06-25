// mobile/src/lib/api-internetarchive.js
// Direct queries to the Internet Archive (archive.org). Free, no key.
//
// 19th- and early-20th-century county/local histories are the canonical printed
// source for ordinary people of that era. Full-text searchable on archive.org,
// public domain — tagged source_type: 'archive' (public-domain, but a distinct
// [Internet Archive] citation label so it isn't miscredited to Chronicling America).
//
// Two-step, both free:
//   1. advancedsearch.php — find PD texts mentioning the surname (+ place token),
//      scoped to the PD-era year range.
//   2. download/{id}/{id}_djvu.txt — raw OCR of the top hit; we window ~800 chars
//      around the surname (same technique as Chronicling America).
//
// PLATFORM NOTE: React Native's fetch has no ReadableStream body, so unlike the
// web module we read the full .text(). We guard with a Content-Length check and
// skip any OCR file over the cap so we never buffer a huge volume on-device.
//
// Cutoff is 1925. Strictly ADDITIVE — merged into searchResults alongside
// Tavily/CA, never replacing anything.

const IA_CUTOFF = 1925;
const IA_MAX_OCR_BYTES = 4 * 1024 * 1024;

export async function searchInternetArchive(name, deathYear, location) {
  if (!name || !deathYear) return [];
  const year = parseInt(deathYear, 10);
  if (isNaN(year) || year > IA_CUTOFF) return [];

  const surname = name.trim().split(/\s+/).pop();
  if (!surname || surname.length < 3) return [];

  const placeTok = (location || '').split(',')[0].trim();

  const qParts = [
    'mediatype:texts',
    `"${surname}"`,
    placeTok ? `"${placeTok}"` : '',
    `year:[1820 TO ${IA_CUTOFF}]`,
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

  const fullName = name.trim();
  const firstName = fullName.split(/\s+/)[0];
  const out = [];
  for (const doc of docs.slice(0, 2)) {
    if (!doc.identifier) continue;
    const snippet = await ocrWindow(doc.identifier, surname, firstName);
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

// Fetch the item's raw _djvu.txt OCR (size-guarded) and window ~800 chars around
// the surname, preferring an occurrence with the first name just before it.
async function ocrWindow(identifier, surname, firstName) {
  const url = `https://archive.org/download/${encodeURIComponent(identifier)}/${encodeURIComponent(identifier)}_djvu.txt`;
  try {
    const res = await fetch(url, { headers: { 'Accept': 'text/plain' } });
    if (!res.ok) return null;
    // RN's fetch has no ReadableStream, so we must read the whole body with .text() —
    // the Content-Length check is the ONLY guard against buffering a huge OCR file.
    // Treat a missing/zero Content-Length as UNKNOWN size and refuse: the old
    // `if (len && …)` let a headerless (e.g. chunked) response fall through to
    // buffering the entire file, defeating the cap this guard exists to enforce.
    // archive.org djvu.txt for full books can be hundreds of MB. [search-audit #4]
    const len = parseInt(res.headers.get('content-length') || '0', 10);
    // Refuse unless the header proves the file is within the cap. A missing header
    // (len 0), a non-numeric header (NaN), and a negative header (`-5 > CAP` is false,
    // which would otherwise fall through and buffer) all count as "size unknown". [search-audit #4]
    if (!Number.isFinite(len) || len <= 0 || len > IA_MAX_OCR_BYTES) return null;

    const text = await res.text();
    const clean = text.replace(/\s+/g, ' ').trim();
    const lower = clean.toLowerCase();
    const sLower = surname.toLowerCase();

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
