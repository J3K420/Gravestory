// Direct Wikipedia fetch — no proxy needed.
import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system';

const PORTRAITS_DIR = FileSystem.documentDirectory + 'portraits/';

const WIKI_HEADERS = {
  'User-Agent': 'GraveStory/1.0 (https://github.com/J3K420/Gravestory; gravestory mobile app)',
  'Api-User-Agent': 'GraveStory/1.0',
};

// Downloads a remote image and saves it as a local JPEG via ImageManipulator.
// Fresco (React Native Image on Android) cannot reliably load Wikipedia CDN
// URLs directly; ImageManipulator's native bitmap decoder handles them fine.
// Falls back to the original URL if download/resize fails.
async function resizeForDisplay(url) {
  if (!url) return null;
  try {
    const result = await ImageManipulator.manipulateAsync(
      url,
      [{ resize: { width: 800 } }],
      { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG }
    );
    return result.uri;
  } catch {
    return url;
  }
}

// Copies a temp file:// URI produced by ImageManipulator into the app's
// persistent documentDirectory so portraits survive app restarts.
// Returns the permanent URI, or the original if the copy fails.
async function persistPortrait(tempUri) {
  if (!tempUri || !tempUri.startsWith('file://')) return tempUri;
  try {
    const info = await FileSystem.getInfoAsync(PORTRAITS_DIR);
    if (!info.exists) {
      await FileSystem.makeDirectoryAsync(PORTRAITS_DIR, { intermediates: true });
    }
    const filename = tempUri.split('/').pop();
    const dest = PORTRAITS_DIR + filename;
    await FileSystem.copyAsync({ from: tempUri, to: dest });
    return dest;
  } catch {
    return tempUri;
  }
}

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

    // Strip Wikimedia thumbnail size prefix ("800px-OriginalName" → "OriginalName")
    const stripped = file.replace(/^\d+px-/, '');
    const tokens = stripped.split(/[\s_\-.()]+/).filter(t => t.length > 1);
    const nameLike = tokens.filter(t => !GENERIC.has(t) && !/^\d+$/.test(t) && t.length >= 3);

    if (nameLike.length === 0) return true;

    // Use substring containment in both directions so CamelCase tokens like
    // "houdinichains" or "harryhoudini" still match nameSet entries "houdini"/"harry".
    for (const t of nameLike) {
      for (const name of queriedNameSet) {
        if (t === name || t.includes(name) || name.includes(t)) return true;
      }
    }
    return false;
  } catch {
    return true;
  }
}

// Fetches the Wikipedia article lead text for a person. Returns { title, extract, url }
// or null if no matching article is found. Does not download any images.
export async function fetchWikipediaArticleSummary(name, dates) {
  if (!name || name.toLowerCase().includes('unknown')) return null;

  const SKIP = new Set(['mr','mrs','ms','dr','rev','sr','jr','ii','iii','iv','v','the']);
  const significantTokens = name
    .toLowerCase()
    .replace(/[.,'"()]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 1 && !SKIP.has(w));
  if (significantTokens.length < 2) return null;

  // Match on first+last significant token only — middle names like "Jade" in
  // "Amy Jade Winehouse" won't appear in the Wikipedia article title "Amy Winehouse".
  const firstLast = [significantTokens[0], significantTokens[significantTokens.length - 1]];

  try {
    const yearMatch = (dates || '').match(/\b(1[5-9]\d{2}|20\d{2})\b/g);
    const deathYear = yearMatch?.length > 0 ? yearMatch[yearMatch.length - 1] : '';
    const searchQuery = encodeURIComponent(`${name} ${deathYear}`.trim());
    const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${searchQuery}&srlimit=3&format=json&origin=*`;

    const searchRes = await fetch(searchUrl, { headers: WIKI_HEADERS });
    if (!searchRes.ok) return null;
    const searchData = await searchRes.json();
    const hits = searchData?.query?.search || [];
    if (hits.length === 0) return null;

    let title = null;
    for (const hit of hits) {
      const t = (hit.title || '').toLowerCase();
      if (firstLast.every(w => t.includes(w))) { title = hit.title; break; }
    }
    if (!title) return null;

    const summaryRes = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`,
      { headers: WIKI_HEADERS }
    );
    if (!summaryRes.ok) return null;
    const summary = await summaryRes.json();
    if (summary.type === 'disambiguation' || !summary.extract || summary.extract.length < 80) return null;

    return {
      title: summary.title,
      extract: summary.extract.slice(0, 2000),
      url: summary.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${encodeURIComponent(title)}`,
    };
  } catch (err) {
    console.warn('Wikipedia article summary fetch failed:', err.message);
    return null;
  }
}

// Normalizes portrait data from both old saved stories ({ left, right } object)
// and the new array format so display code doesn't need to handle both shapes.
export function normalizePortraits(portraits) {
  if (!portraits) return [];
  if (Array.isArray(portraits)) return portraits.filter(Boolean);
  return [portraits.left, portraits.right].filter(Boolean);
}

// Returns an array of up to 5 remote Wikipedia image URLs (stable HTTPS JPEGs).
// Returns remote URLs directly — no local file download needed, so portraits
// persist across app restarts. Wikipedia's thumbnail URLs are always pre-rendered
// JPEGs regardless of the original file format, safe for React Native's Image.
export async function fetchWikipediaPortraits(name, dates) {
  if (!name || name.toLowerCase().includes('unknown')) return [];

  const SKIP = new Set(['mr','mrs','ms','dr','rev','sr','jr','ii','iii','iv','v','the']);
  const significantTokens = name
    .toLowerCase()
    .replace(/[.,'"()]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 1 && !SKIP.has(w));
  if (significantTokens.length < 2) return [];

  // Match on first+last token only — avoids middle-name mismatches like
  // "Amy Jade Winehouse" failing to match the "Amy Winehouse" article title.
  const firstLast = [significantTokens[0], significantTokens[significantTokens.length - 1]];
  const nameSet = new Set(significantTokens);

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

    let title = null;
    for (const hit of hits) {
      const t = (hit.title || '').toLowerCase();
      if (firstLast.every(w => t.includes(w))) { title = hit.title; break; }
    }
    if (!title) return [];

    const summaryRes = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`,
      { headers: WIKI_HEADERS }
    );
    if (!summaryRes.ok) throw new Error(`summary ${summaryRes.status}`);
    const summary = await summaryRes.json();

    // Use thumbnail.source only — always a pre-rendered JPEG served by Wikipedia.
    // Avoid originalimage.source which can be raw TIFF/huge unresized files.
    const leadRaw = summary?.thumbnail?.source || null;
    const rawUrls = [];
    if (leadRaw && imageFilenameMatchesPerson(leadRaw, nameSet)) {
      rawUrls.push(leadRaw);
    }

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
          .filter(t => /\.(jpe?g|png|tiff?|svg)$/i.test(t))
          .filter(t => !/logo|icon|signature|map|flag|coat[-_ ]of[-_ ]arms|birth|death|burial|gravesite/i.test(t))
          .filter(t => leadRaw ? !leadRaw.includes(encodeURIComponent(t.replace(/^File:/, ''))) : true)
          .slice(0, 4);

        // iiurlwidth=800 forces Wikipedia to render a JPEG thumbnail at 800px
        // width for all source formats (TIFF, SVG, PNG → always returns JPEG thumburl).
        const resolvedRaw = await Promise.allSettled(
          candidates.map(async (candidate) => {
            const resolveUrl = `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(candidate)}&prop=imageinfo&iiprop=url|thumbnail&iiurlwidth=800&format=json&origin=*`;
            const resolveRes = await fetch(resolveUrl, { headers: WIKI_HEADERS });
            if (!resolveRes.ok) return null;
            const resolveData = await resolveRes.json();
            const resolvedPage = Object.values(resolveData?.query?.pages || {})[0];
            const url = resolvedPage?.imageinfo?.[0]?.thumburl
                     || resolvedPage?.imageinfo?.[0]?.url
                     || null;
            return (url && imageFilenameMatchesPerson(url, nameSet)) ? url : null;
          })
        );
        for (const r of resolvedRaw) {
          if (r.status === 'fulfilled' && r.value && rawUrls.length < 5) {
            rawUrls.push(r.value);
          }
        }
      }
    } catch {}

    // Download and resize each URL to a local JPEG, then copy to persistent storage.
    const resized = await Promise.allSettled(rawUrls.map(u => resizeForDisplay(u)));
    const tempUris = resized
      .filter(r => r.status === 'fulfilled' && r.value)
      .map(r => r.value);

    const persisted = await Promise.allSettled(tempUris.map(u => persistPortrait(u)));
    return persisted
      .filter(r => r.status === 'fulfilled' && r.value)
      .map(r => r.value);
  } catch (err) {
    console.warn('Wikipedia portrait fetch failed:', err.message);
    return [];
  }
}
