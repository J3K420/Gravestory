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

export async function fetchWikipediaPortraits(name, dates) {
  const result = { left: null, right: null };
  if (!name || name.toLowerCase().includes('unknown')) return result;

  const SKIP = new Set(['mr','mrs','ms','dr','rev','sr','jr','ii','iii','iv','v','the']);
  const significantTokens = name
    .toLowerCase()
    .replace(/[.,'"()]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 1 && !SKIP.has(w));
  if (significantTokens.length < 2) return result;

  try {
    const yearMatch = (dates || '').match(/\b(1[5-9]\d{2}|20\d{2})\b/g);
    const deathYear = yearMatch && yearMatch.length > 0 ? yearMatch[yearMatch.length - 1] : '';
    const searchQuery = encodeURIComponent(`${name} ${deathYear}`.trim());
    const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${searchQuery}&srlimit=3&format=json&origin=*`;

    const searchRes = await fetch(searchUrl, { headers: WIKI_HEADERS });
    if (!searchRes.ok) throw new Error(`search ${searchRes.status}`);
    const searchData = await searchRes.json();
    const hits = searchData?.query?.search || [];
    if (hits.length === 0) return result;

    const required = name
      .toLowerCase()
      .replace(/[.,'"()]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 1 && !SKIP.has(w));

    let title = null;
    for (const hit of hits) {
      const t = (hit.title || '').toLowerCase();
      if (required.every(w => t.includes(w))) { title = hit.title; break; }
    }
    if (!title) return result;

    const summaryRes = await fetch(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`, { headers: WIKI_HEADERS });
    if (!summaryRes.ok) throw new Error(`summary ${summaryRes.status}`);
    const summary = await summaryRes.json();

    const lead = summary?.originalimage?.source || summary?.thumbnail?.source || null;
    const nameSet = new Set(required);
    if (lead && imageFilenameMatchesPerson(lead, nameSet)) {
      result.left = lead;
    }

    if (lead) {
      try {
        const imagesUrl = `https://en.wikipedia.org/w/api.php?action=query&prop=images&titles=${encodeURIComponent(title)}&imlimit=5&format=json&origin=*`;
        const imagesRes = await fetch(imagesUrl, { headers: WIKI_HEADERS });
        if (imagesRes.ok) {
          const imagesData = await imagesRes.json();
          const pages = imagesData?.query?.pages || {};
          const firstPage = Object.values(pages)[0];
          const imageList = firstPage?.images || [];
          const candidates = imageList
            .map(i => i.title)
            .filter(t => /\.(jpe?g|png)$/i.test(t))
            .filter(t => !/logo|icon|signature|map|flag|coat[-_ ]of[-_ ]arms/i.test(t))
            .filter(t => !lead.includes(encodeURIComponent(t.replace(/^File:/, ''))));

          if (candidates.length > 0) {
            const resolveUrl = `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(candidates[0])}&prop=imageinfo&iiprop=url&format=json&origin=*`;
            const resolveRes = await fetch(resolveUrl, { headers: WIKI_HEADERS });
            if (resolveRes.ok) {
              const resolveData = await resolveRes.json();
              const resolvedPage = Object.values(resolveData?.query?.pages || {})[0];
              const secondUrl = resolvedPage?.imageinfo?.[0]?.url || null;
              if (secondUrl && imageFilenameMatchesPerson(secondUrl, nameSet)) {
                result.right = secondUrl;
              }
            }
          }
        }
      } catch {}
    }
  } catch (err) {
    console.warn('Wikipedia portrait fetch failed:', err.message);
  }

  return result;
}
