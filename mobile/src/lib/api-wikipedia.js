// Direct Wikipedia fetch — no proxy needed.
const WIKI_HEADERS = {
  'User-Agent': 'GraveStory/1.0 (https://github.com/J3K420/Gravestory; gravestory mobile app)',
  'Api-User-Agent': 'GraveStory/1.0',
};

function imageFilenameMatchesPerson(imageUrl, queriedNameSet) {
  if (!imageUrl || !queriedNameSet || queriedNameSet.size === 0) return true;
  try {
    const path = imageUrl.split('?')[0];
    const file = decodeURIComponent(path.substring(path.lastIndexOf('/') + 1))
      .replace(/\.(jpe?g|png|gif|svg|webp)$/i, '')
      .toLowerCase();

    const GENERIC = new Set([
      'head','shot','headshot','portrait','photo','photograph','image','img',
      'pic','picture','grave','tomb','tombstone','cemetery','memorial',
      'stone','marker','file','wikipedia','commons','cropped','cropped2',
      'square','wiki','original','default','png','jpg','jpeg'
    ]);

    const tokens = file.split(/[\s_\-.()]+/).filter(t => t.length > 1);
    const nameLike = tokens.filter(t => !GENERIC.has(t) && !/^\d+$/.test(t) && t.length >= 3);

    if (nameLike.length === 0) return true;

    for (const t of nameLike) {
      if (queriedNameSet.has(t)) return true;
    }
    return false;
  } catch {
    return true;
  }
}

// Returns an array of image URLs (up to 5). Old callers expecting { left, right }
// should use normalizePortraits() in the display layer for backward compatibility.
export async function fetchWikipediaPortraits(name, dates) {
  if (!name || name.toLowerCase().includes('unknown')) return [];

  const SKIP = new Set(['mr','mrs','ms','dr','rev','sr','jr','ii','iii','iv','v','the']);
  const significantTokens = name
    .toLowerCase()
    .replace(/[.,'"()]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 1 && !SKIP.has(w));
  if (significantTokens.length < 2) return [];

  try {
    const yearMatch = (dates || '').match(/\b(1[5-9]\d{2}|20\d{2})\b/g);
    const deathYear = yearMatch && yearMatch.length > 0 ? yearMatch[yearMatch.length - 1] : '';
    const searchQuery = encodeURIComponent(`${name} ${deathYear}`.trim());
    const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${searchQuery}&srlimit=3&format=json&origin=*`;

    const searchRes = await fetch(searchUrl, { headers: WIKI_HEADERS });
    if (!searchRes.ok) throw new Error(`search ${searchRes.status}`);
    const searchData = await searchRes.json();
    const hits = searchData?.query?.search || [];
    if (hits.length === 0) return [];

    const required = significantTokens; // already computed above
    const nameSet = new Set(required);

    let title = null;
    for (const hit of hits) {
      const t = (hit.title || '').toLowerCase();
      if (required.every(w => t.includes(w))) { title = hit.title; break; }
    }
    if (!title) return [];

    const summaryRes = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`,
      { headers: WIKI_HEADERS }
    );
    if (!summaryRes.ok) throw new Error(`summary ${summaryRes.status}`);
    const summary = await summaryRes.json();

    const images = [];

    const lead = summary?.originalimage?.source || summary?.thumbnail?.source || null;
    if (lead && imageFilenameMatchesPerson(lead, nameSet)) {
      images.push(lead);
    }

    // Fetch up to 4 secondary images in parallel
    try {
      const imagesUrl = `https://en.wikipedia.org/w/api.php?action=query&prop=images&titles=${encodeURIComponent(title)}&imlimit=15&format=json&origin=*`;
      const imagesRes = await fetch(imagesUrl, { headers: WIKI_HEADERS });
      if (imagesRes.ok) {
        const imagesData = await imagesRes.json();
        const pages = imagesData?.query?.pages || {};
        const firstPage = Object.values(pages)[0];
        const imageList = firstPage?.images || [];

        const candidates = imageList
          .map(i => i.title)
          .filter(t => /\.(jpe?g|png)$/i.test(t))
          .filter(t => !/logo|icon|signature|map|flag|coat[-_ ]of[-_ ]arms|birth|death|burial|gravesite/i.test(t))
          .filter(t => lead ? !lead.includes(encodeURIComponent(t.replace(/^File:/, ''))) : true)
          .slice(0, 4);

        const resolved = await Promise.allSettled(
          candidates.map(async (candidate) => {
            const resolveUrl = `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(candidate)}&prop=imageinfo&iiprop=url&format=json&origin=*`;
            const resolveRes = await fetch(resolveUrl, { headers: WIKI_HEADERS });
            if (!resolveRes.ok) return null;
            const resolveData = await resolveRes.json();
            const resolvedPage = Object.values(resolveData?.query?.pages || {})[0];
            const url = resolvedPage?.imageinfo?.[0]?.url || null;
            return (url && imageFilenameMatchesPerson(url, nameSet)) ? url : null;
          })
        );

        for (const r of resolved) {
          if (r.status === 'fulfilled' && r.value) {
            images.push(r.value);
            if (images.length >= 5) break;
          }
        }
      }
    } catch {}

    return images;
  } catch (err) {
    console.warn('Wikipedia portrait fetch failed:', err.message);
    return [];
  }
}
