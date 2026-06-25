// Direct Wikipedia fetch — no proxy needed.
import * as ImageManipulator from 'expo-image-manipulator';
// expo-file-system v19 (SDK 54) moved the URI-based helpers (documentDirectory,
// getInfoAsync, makeDirectoryAsync, copyAsync, …) to the /legacy entrypoint;
// the default export throws at runtime for these. persistPortrait swallows
// errors and falls back to the temp URI, so this was failing silently before.
import * as FileSystem from 'expo-file-system/legacy';

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

    // EPONYM / OBJECT guard: a thing named AFTER the person (a ship, school, bridge,
    // award, crater…) carries the person's full name verbatim, so the exact-token path
    // below would happily accept "USS_George_Washington.jpg" as George Washington's
    // portrait. Reject outright when the filename names such an object. [search-audit F5]
    const EPONYM = new Set([
      'uss','hms','ss','rms','class','submarine','carrier','frigate','destroyer','battleship',
      'school','university','college','academy','institute','library','hospital','clinic',
      'bridge','tunnel','highway','road','street','avenue','airport','station','terminal',
      'building','hall','tower','center','centre','stadium','arena','theatre','theater',
      'park','garden','square','plaza','dam','reservoir','lake','mount','mountain','river',
      'county','township','village','statue','bust','monument','plaque','mural','fountain',
      'award','medal','prize','trophy','cup','stamp','banknote','coin','crater','asteroid',
      'comet','glacier','locomotive','aircraft','airplane','tank','rocket','species','genus',
    ]);
    // Reject on an eponym token ONLY when it isn't part of the person's own name —
    // otherwise a legitimate surname that happens to be an eponym word (Rosa Parks,
    // a "Hall"/"Lake"/"Rivers"/"Mount" surname) would have their own portrait rejected.
    // queriedNameSet holds the lowercased name tokens. [search-audit F5]
    if (tokens.some(t => EPONYM.has(t) && !queriedNameSet.has(t))) return false;

    const nameLike = tokens.filter(t => !GENERIC.has(t) && !/^\d+$/.test(t) && t.length >= 3);

    if (nameLike.length === 0) return true;

    // A single shared name token is too weak when the FILENAME offers more to match
    // against — "washington" alone matches many namesake people/objects. Require ≥2
    // distinct queried tokens to match only when BOTH the person's name has ≥2
    // significant tokens AND the filename carries ≥2 name-like tokens to match them.
    // That still rejects a shared-surname collision ("Robert_Washington_athlete" for
    // George Washington) but does NOT reject a legitimate surname-only lead thumbnail
    // ("Lincoln.jpg"), which has only one token to offer. Mononyms keep single-match.
    // The eponym guard above is the primary defense for ship/monument/award filenames;
    // this count rule is the residual catch when no eponym keyword is present. [search-audit F5]
    const requiredMatches = (queriedNameSet.size >= 2 && nameLike.length >= 2) ? 2 : 1;
    const matchedNames = new Set();

    // Exact token match is the safe path (a person's real surname matches their own
    // portrait regardless of length). For the CamelCase-glue case ("harryhoudini" /
    // "houdinichains" should still match "houdini"), allow containment ONLY when the
    // shorter operand is a meaningful length AND sits at a boundary of the longer one.
    // The old unbounded bidirectional substring let a short token like "lee" accept a
    // wrong-person image whose filename merely contained it ("Leeson", "Mayflower",
    // "wushu") — exactly the wrong-person leak this guard exists to block. [search-audit #2]
    for (const t of nameLike) {
      for (const name of queriedNameSet) {
        let hit = false;
        if (t === name) {
          hit = true;
        } else {
          const [shortTok, longTok] = t.length <= name.length ? [t, name] : [name, t];
          if (shortTok.length >= 4 && (longTok.startsWith(shortTok) || longTok.endsWith(shortTok))) {
            hit = true;
          }
        }
        if (hit) {
          matchedNames.add(name);
          if (matchedNames.size >= requiredMatches) return true;
        }
      }
    }
    return false;
  } catch {
    return true;
  }
}

// Fetches the Wikipedia article lead text for a person. Returns { title, extract, url }
// or null if no matching article is found. Does not download any images.
//
// `knownTitle` (optional): an authoritative Wikipedia article title resolved
// upstream — e.g. from Wikidata's en.wikipedia sitelink (queryWikidata's
// wikipediaTitle), which bridges a stone whose engraved name differs from the
// article title ("Erik Weisz" → "Harry Houdini"). When supplied, the name-search
// + title-match guard is BYPASSED and the summary is fetched directly by that
// title — the guard would otherwise reject the correct article because the
// engraved name doesn't appear in it.
export async function fetchWikipediaArticleSummary(name, dates, knownTitle) {
  if (!name || name.toLowerCase().includes('unknown')) return null;

  try {
    let title = (knownTitle || '').trim() || null;

    // No authoritative title — search Wikipedia and accept only a hit whose
    // article TITLE contains the first+last significant token of the queried
    // name (middle names like "Jade" in "Amy Jade Winehouse" won't appear in
    // the article title "Amy Winehouse").
    if (!title) {
      const SKIP = new Set(['mr','mrs','ms','dr','rev','sr','jr','ii','iii','iv','v','the']);
      const significantTokens = name
        .toLowerCase()
        .replace(/[.,'"()]/g, '')
        .split(/\s+/)
        .filter(w => w.length > 1 && !SKIP.has(w));
      if (significantTokens.length < 2) return null;

      const firstLast = [significantTokens[0], significantTokens[significantTokens.length - 1]];

      const yearMatch = (dates || '').match(/\b(1[5-9]\d{2}|20\d{2})\b/g);
      const deathYear = yearMatch?.length > 0 ? yearMatch[yearMatch.length - 1] : '';
      const searchQuery = encodeURIComponent(`${name} ${deathYear}`.trim());
      const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${searchQuery}&srlimit=3&format=json&origin=*`;

      const searchRes = await fetch(searchUrl, { headers: WIKI_HEADERS });
      if (!searchRes.ok) return null;
      const searchData = await searchRes.json();
      const hits = searchData?.query?.search || [];
      if (hits.length === 0) return null;

      for (const hit of hits) {
        const t = (hit.title || '').toLowerCase();
        if (firstLast.every(w => t.includes(w))) { title = hit.title; break; }
      }
      if (!title) return null;
    }

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
// `knownTitle` (optional): an authoritative Wikipedia article title resolved
// upstream (e.g. Wikidata's sitelink — see fetchWikipediaArticleSummary). When
// supplied, the name search + title-match guard is bypassed and the
// filename-sanity name set is derived from the ARTICLE TITLE, not the engraved
// name — "Erik Weisz" wouldn't match a "Harry_Houdini.jpg" filename, but
// "Harry Houdini" will.
export async function fetchWikipediaPortraits(name, dates, knownTitle) {
  if (!name || name.toLowerCase().includes('unknown')) return [];

  const SKIP = new Set(['mr','mrs','ms','dr','rev','sr','jr','ii','iii','iv','v','the']);
  const significantTokens = name
    .toLowerCase()
    .replace(/[.,'"()]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 1 && !SKIP.has(w));

  let title = (knownTitle || '').trim() || null;
  const titleTokens = title
    ? title.toLowerCase().replace(/[.,'"()]/g, '').split(/\s+/).filter(w => w.length > 1 && !SKIP.has(w))
    : [];

  if (!title && significantTokens.length < 2) return [];

  // Match on first+last token only — avoids middle-name mismatches like
  // "Amy Jade Winehouse" failing to match the "Amy Winehouse" article title.
  const firstLast = significantTokens.length >= 2
    ? [significantTokens[0], significantTokens[significantTokens.length - 1]]
    : significantTokens;
  // Filename-sanity name set: article-title tokens when a title was supplied
  // (so an engraved-name mismatch doesn't reject the correct portrait).
  const nameSet = new Set(titleTokens.length ? titleTokens : significantTokens);

  try {
    if (!title) {
      const yearMatch = (dates || '').match(/\b(1[5-9]\d{2}|20\d{2})\b/g);
      const deathYear = yearMatch && yearMatch.length > 0 ? yearMatch[yearMatch.length - 1] : '';
      const searchQuery = encodeURIComponent(`${name} ${deathYear}`.trim());
      const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${searchQuery}&srlimit=3&format=json&origin=*`;

      const searchRes = await fetch(searchUrl, { headers: WIKI_HEADERS });
      if (!searchRes.ok) throw new Error(`search ${searchRes.status}`);
      const searchData = await searchRes.json();
      const hits = searchData?.query?.search || [];
      if (hits.length === 0) return [];

      for (const hit of hits) {
        const t = (hit.title || '').toLowerCase();
        if (firstLast.every(w => t.includes(w))) { title = hit.title; break; }
      }
      if (!title) return [];
    }

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
