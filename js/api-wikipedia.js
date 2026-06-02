// js/api-wikipedia.js
// Wikipedia portrait search (direct fetch, no proxy).
// Two-step strategy: search Wikipedia for the name + death-year disambiguation,
// take the first article whose TITLE actually contains the queried name,
// then pull the lead image plus optionally a secondary image from the page.
// Includes a filename-sanity check (imageFilenameMatchesPerson) that rejects
// images whose filename names a different person -- catches infobox spouse
// photos and similar wrong-person leads. Depends on: nothing.

// ── WIKIPEDIA PORTRAIT SEARCH ────────────────────────────────────
// Returns up to 2 image URLs from Wikipedia for the given person.
// Returns true if a Wikipedia image URL's filename is consistent with the
// queried person, false if it names someone else. Strategy:
//   1. Extract the basename of the file, decode URL escapes, lowercase.
//   2. Split into word-tokens.
//   3. If the filename contains NO recognisable name tokens (e.g. just
//      "head_shot_001.jpg" or "grave_2020.jpg"), treat as a pass — we can't
//      prove it's wrong. Better to keep an image than discard everything.
//   4. If the filename DOES contain name-like tokens (capitalised words in
//      the original case, or words longer than 3 chars that aren't generic),
//      at least one of them must be in the queried person's name set.
function imageFilenameMatchesPerson(imageUrl, queriedNameSet) {
  if (!imageUrl || !queriedNameSet || queriedNameSet.size === 0) return true;
  try {
    const path = imageUrl.split('?')[0];
    const file = decodeURIComponent(path.substring(path.lastIndexOf('/') + 1))
      .replace(/\.(jpe?g|png|gif|svg|webp)$/i, '')
      .toLowerCase();

    // Generic filename tokens that don't signal a person.
    const GENERIC = new Set([
      'head','shot','headshot','portrait','photo','photograph','image','img',
      'pic','picture','grave','tomb','tombstone','cemetery','memorial',
      'stone','marker','file','wikipedia','commons','cropped','cropped2',
      'square','wiki','original','default','png','jpg','jpeg'
    ]);

    const tokens = file.split(/[\s_\-.()]+/).filter(t => t.length > 1);
    const nameLike = tokens.filter(t => !GENERIC.has(t) && !/^\d+$/.test(t) && t.length >= 3);

    // No name-like tokens at all → can't prove it's wrong, pass.
    if (nameLike.length === 0) return true;

    // At least one name-like token must be in the queried person's name set.
    for (const t of nameLike) {
      if (queriedNameSet.has(t)) return true;
    }
    return false;
  } catch {
    return true;  // on parse failure, default to permissive
  }
}

// Fetches the Wikipedia article lead text for a person. Returns { title, extract, url }
// or null if no matching article is found. Does not download any images.
async function fetchWikipediaArticleSummary(name, dates) {
  if (!name || name.toLowerCase().includes('unknown')) return null;

  const SKIP = new Set(['mr','mrs','ms','dr','rev','sr','jr','ii','iii','iv','v','the']);
  const significantTokens = name
    .toLowerCase()
    .replace(/[.,'"()]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 1 && !SKIP.has(w));
  if (significantTokens.length < 2) return null;

  try {
    const yearMatch = (dates || '').match(/\b(1[5-9]\d{2}|20\d{2})\b/g);
    const deathYear = yearMatch?.length > 0 ? yearMatch[yearMatch.length - 1] : '';
    const searchQuery = encodeURIComponent(`${name} ${deathYear}`.trim());
    const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${searchQuery}&srlimit=3&format=json&origin=*`;

    const searchRes = await fetch(searchUrl);
    if (!searchRes.ok) return null;
    const searchData = await searchRes.json();
    const hits = searchData?.query?.search || [];
    if (hits.length === 0) return null;

    let title = null;
    for (const hit of hits) {
      const t = (hit.title || '').toLowerCase();
      if (significantTokens.every(w => t.includes(w))) { title = hit.title; break; }
    }
    if (!title) return null;

    const summaryRes = await fetch(
      `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`
    );
    if (!summaryRes.ok) return null;
    const summary = await summaryRes.json();
    if (summary.type === 'disambiguation' || !summary.extract || summary.extract.length < 80) return null;

    console.log('📖 Wikipedia article found:', summary.title);
    return {
      title: summary.title,
      extract: summary.extract.slice(0, 2000),
      url: summary.content_urls?.desktop?.page || `https://en.wikipedia.org/wiki/${encodeURIComponent(title)}`,
    };
  } catch (err) {
    console.warn('📖 Wikipedia article summary fetch failed:', err.message);
    return null;
  }
}

// Strategy: search Wikipedia for the name + a context word ("grave" or birth
// year if known), pick the top match, fetch its summary, take the lead image.
// If the page has multiple images (file-list), grab a second one from the
// images-on-page list.
async function fetchWikipediaPortraits(name, dates) {
  const result = { left: null, right: null };
  if (!name || name.toLowerCase().includes('unknown')) return result;

  // Single-token-name guard: if the deceased's name is just one word
  // (e.g. "George", "Mary"), Wikipedia search will reliably return a famous
  // person, monarch, or saint by that name — King George V, Mary Queen of
  // Scots, etc. The title-match guard below CAN'T disambiguate these,
  // because every "George Xyz" article title contains "george".
  //
  // For these cases we skip the Wikipedia portrait pull entirely. An empty
  // header is honest; a king's portrait on a random stone is not.
  //
  // Skip honorifics/suffixes the same way the title-match guard does, so
  // "Dr. George" with the "Dr." stripped is still treated as one token.
  const SKIP = new Set(['mr','mrs','ms','dr','rev','sr','jr','ii','iii','iv','v','the']);
  const significantTokens = name
    .toLowerCase()
    .replace(/[.,'"()]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 1 && !SKIP.has(w));
  if (significantTokens.length < 2) {
    console.log('🖼️ Skipping Wikipedia portrait — single-token name too generic to disambiguate:', JSON.stringify(name));
    return result;
  }

  try {
    // Step 1: search for a matching Wikipedia article
    // Use the death year as disambiguation when available
    const yearMatch = (dates || '').match(/\b(1[5-9]\d{2}|20\d{2})\b/g);
    const deathYear = yearMatch && yearMatch.length > 0 ? yearMatch[yearMatch.length - 1] : '';
    const searchQuery = encodeURIComponent(`${name} ${deathYear}`.trim());
    const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${searchQuery}&srlimit=3&format=json&origin=*`;

    const searchRes = await fetch(searchUrl);
    if (!searchRes.ok) throw new Error(`search ${searchRes.status}`);
    const searchData = await searchRes.json();
    const hits = searchData?.query?.search || [];
    if (hits.length === 0) {
      console.log('🖼️ No Wikipedia article found for', name);
      return result;
    }

    // Step 2: pick the first hit whose TITLE actually contains the queried
    // name. Wikipedia's full-text search ranks by snippet relevance, not title
    // match — so for a name like "Bruce Lee" the top hit can be "Linda Lee
    // Cadwell" (his wife's article mentions him heavily). Accepting hits[0]
    // blindly is what surfaced Linda's headshot as Bruce's portrait.
    //
    // Rule: every significant word of the queried name (length > 1 — skips
    // initials like "J.") must appear in the article title, case-insensitive.
    // Skip honorifics and generation suffixes that may not be on Wikipedia.
    const SKIP = new Set(['mr','mrs','ms','dr','rev','sr','jr','ii','iii','iv','v','the']);
    const required = name
      .toLowerCase()
      .replace(/[.,'"()]/g, '')
      .split(/\s+/)
      .filter(w => w.length > 1 && !SKIP.has(w));

    let title = null;
    for (const hit of hits) {
      const t = (hit.title || '').toLowerCase();
      if (required.every(w => t.includes(w))) {
        title = hit.title;
        break;
      }
    }
    if (!title) {
      console.log('🖼️ No Wikipedia article title matches', JSON.stringify(name),
                  '— hits were:', hits.map(h => h.title));
      return result;
    }
    console.log('🖼️ Wikipedia article matched:', title);
    const summaryUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
    const summaryRes = await fetch(summaryUrl);
    if (!summaryRes.ok) throw new Error(`summary ${summaryRes.status}`);
    const summary = await summaryRes.json();

    // Lead image — prefer originalimage but fall back to thumbnail
    const lead = summary?.originalimage?.source || summary?.thumbnail?.source || null;

    // Filename sanity check: reject the lead image if its filename contains a
    // human-name token that isn't part of the queried name (e.g. "Linda_Lee"
    // returned for a "Bruce Lee" query). This catches infobox spouse photos
    // and similar wrong-person leads that the article-title match can't.
    const nameSet = new Set(required);
    const leadOk = lead ? imageFilenameMatchesPerson(lead, nameSet) : false;
    if (lead && leadOk) {
      result.left = lead;
      console.log('🖼️ Wikipedia lead image:', lead);
    } else if (lead) {
      console.log('🖼️ Rejecting lead image — filename does not match queried name:', lead);
    }

    // Step 3 (optional): grab a second image from images-on-page list
    // Only attempt if we found a lead image so we don't waste a call on nobodies
    if (lead) {
      try {
        const imagesUrl = `https://en.wikipedia.org/w/api.php?action=query&prop=images&titles=${encodeURIComponent(title)}&imlimit=5&format=json&origin=*`;
        const imagesRes = await fetch(imagesUrl);
        if (imagesRes.ok) {
          const imagesData = await imagesRes.json();
          const pages = imagesData?.query?.pages || {};
          const firstPage = Object.values(pages)[0];
          const imageList = firstPage?.images || [];
          // Filter to actual portrait-like files (skip logos, icons, signatures, maps)
          const candidates = imageList
            .map(i => i.title)
            .filter(t => /\.(jpe?g|png)$/i.test(t))
            .filter(t => !/logo|icon|signature|map|flag|coat[-_ ]of[-_ ]arms/i.test(t))
            .filter(t => !lead.includes(encodeURIComponent(t.replace(/^File:/, ''))));

          if (candidates.length > 0) {
            // Resolve the file title to its actual image URL
            const secondTitle = candidates[0];
            const resolveUrl = `https://en.wikipedia.org/w/api.php?action=query&titles=${encodeURIComponent(secondTitle)}&prop=imageinfo&iiprop=url&format=json&origin=*`;
            const resolveRes = await fetch(resolveUrl);
            if (resolveRes.ok) {
              const resolveData = await resolveRes.json();
              const resolvedPages = resolveData?.query?.pages || {};
              const resolvedPage = Object.values(resolvedPages)[0];
              const secondUrl = resolvedPage?.imageinfo?.[0]?.url || null;
              if (secondUrl && imageFilenameMatchesPerson(secondUrl, nameSet)) {
                result.right = secondUrl;
                console.log('🖼️ Wikipedia secondary image:', secondUrl);
              } else if (secondUrl) {
                console.log('🖼️ Rejecting secondary image — filename mismatch:', secondUrl);
              }
            }
          }
        }
      } catch (innerErr) {
        console.warn('🖼️ Secondary image lookup failed:', innerErr.message);
      }
    }
  } catch (err) {
    console.warn('🖼️ Wikipedia portrait fetch failed:', err.message);
  }

  return result;
}
