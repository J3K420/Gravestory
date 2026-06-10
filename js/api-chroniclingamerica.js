// js/api-chroniclingamerica.js
// Direct queries to the Library of Congress Chronicling America API.
// Free, no key required.
//
// Uses the search/pages/results endpoint (NOT the loc.gov/collections endpoint),
// which searches the OCR'd page TEXT and returns ocr_eng snippets containing the
// actual obituary words — far richer for Gemini to mine than the collection
// endpoint's issue-level metadata. date1/date2 window the search around the
// death year so we surface the obituary, not unrelated mentions.
//
// Cutoff is 1928: this module tags results source_type: 'public_domain', which is
// only honest while every result sits under the US rolling public-domain wall
// (works published <= 1929 are PD in 2026). A 1928 death's obituary publishes in
// 1928–1929, safely under the wall. Post-1928, Tavily's Legacy.com / Newspapers.com
// slots are stronger anyway and CA's digitised coverage thins out.
// NOTE: api-tavily.js slots 5/6 are calibrated against this cutoff — keep them in sync.

const _CA_CUTOFF = 1928;

async function searchChroniclingAmerica(name, deathYear) {
  if (!name || !deathYear) return [];
  const year = parseInt(deathYear, 10);
  if (isNaN(year) || year > _CA_CUTOFF) return [];

  // Window the OCR text search to the death year ± 1 (obituaries run for days/weeks).
  const date1 = year - 1;
  const date2 = Math.min(year + 1, _CA_CUTOFF + 1);
  const andtext = encodeURIComponent(`${name} died`);
  const url = `https://chroniclingamerica.loc.gov/search/pages/results/` +
    `?andtext=${andtext}&date1=${date1}&date2=${date2}&dateFilterType=yearRange` +
    `&rows=5&format=json`;

  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'GraveStory/1.0' } });
    if (!res.ok) return [];
    const data = await res.json();
    const items = Array.isArray(data.items) ? data.items : [];
    return items.slice(0, 3).map(it => {
      // ocr_eng holds the full OCR'd page text — clip to a window around the name
      // so Gemini gets the relevant passage, not the whole noisy page.
      const ocr = (it.ocr_eng || '').replace(/\s+/g, ' ').trim();
      const snippet = _windowAroundName(ocr, name) || ocr.slice(0, 800);
      const paper = it.title_normal || it.title || 'Chronicling America';
      const dateStr = it.date ? `${it.date.slice(0,4)}-${it.date.slice(4,6)}-${it.date.slice(6,8)}` : '';
      return {
        title: `${paper}${dateStr ? ' (' + dateStr + ')' : ''}`,
        url: it.id ? `https://chroniclingamerica.loc.gov${it.id}` : '',
        content: snippet,
        source_type: 'public_domain',
      };
    }).filter(r => r.content && r.content.length > 40);
  } catch {
    return [];
  }
}

// Return ~800 chars of OCR text centred on the first occurrence of the person's
// surname, so the obituary passage is favoured over arbitrary page text. Falls
// back to null when the name isn't found in the OCR (caller uses a head slice).
function _windowAroundName(ocr, name) {
  if (!ocr) return null;
  const surname = name.trim().split(/\s+/).pop();
  if (!surname || surname.length < 3) return null;
  const idx = ocr.toLowerCase().indexOf(surname.toLowerCase());
  if (idx === -1) return null;
  const start = Math.max(0, idx - 250);
  return ocr.slice(start, start + 800).trim();
}
