import { PROXY_BASE, CLIENT_KEY } from './config';
import { EXPAND } from './abbreviations';

// Returns [original, expandedVariant?] — if the first token of the name is a known
// abbreviation or nickname, the second element replaces it with the formal form.
function expandName(name) {
  const parts = name.trim().split(/\s+/);
  const key = parts[0].replace(/\.$/, '').toLowerCase();
  const formal = EXPAND[key];
  if (formal && formal.toLowerCase() !== key) {
    return [name, [formal, ...parts.slice(1)].join(' ')];
  }
  return [name];
}

// Parse "aged 72 yrs", "aet. 45", "in the 45th year of his age" from the inscription
// and derive the missing birth or death year when only one end-date is present.
function parseAgeAtDeath(graveData) {
  const inscr = graveData.inscription || '';
  if (!inscr) return null;

  const patterns = [
    /aged?\s+(\d+)\s*y(?:ea)?r/i,
    /aet\.?\s*(\d+)/i,
    /in\s+(?:the\s+)?(\d+)(?:st|nd|rd|th)\s+year\s+of/i,
    /died\s+in\s+(?:his|her|their)\s+(\d+)(?:st|nd|rd|th)?\s+year/i,
  ];

  const birthYear = graveData.birth_date?.match(/\d{4}/)?.[0];
  const deathYear = graveData.death_date?.match(/\d{4}/)?.[0];

  for (const pat of patterns) {
    const m = inscr.match(pat);
    if (!m) continue;
    const age = parseInt(m[1], 10);
    if (age < 1 || age > 120) continue;
    if (deathYear && !birthYear) return { birth_year: String(parseInt(deathYear, 10) - age), is_approx: true };
    if (birthYear && !deathYear) return { death_year: String(parseInt(birthYear, 10) + age), is_approx: true };
  }
  return null;
}

// Session-level cache: prevents re-querying the same person in a single app session.
// Key: "${normalizedName}|${deathYear}". Lives until the app is force-quit.
const _searchCache = new Map();

// Maps symbol keywords (lowercased) to extra Tavily query suffixes.
// Each entry fires one additional query per matched symbol group, using the
// primary name as the subject, so we find fraternal records and service rolls.
const SYMBOL_QUERIES = {
  'gar':                  ['"Grand Army Republic" veteran obituary'],
  'grand army':           ['"Grand Army Republic" veteran obituary'],
  'civil war':            ['Civil War veteran soldier obituary'],
  'masonic':              ['Freemason Mason lodge member'],
  'freemason':            ['Freemason Mason lodge member'],
  'square and compass':   ['Freemason Mason lodge member'],
  'odd fellows':          ['"Odd Fellows" IOOF member'],
  'ioof':                 ['"Odd Fellows" IOOF member'],
  'rebekah':              ['"Daughters of Rebekah" IOOF'],
  'elks':                 ['"Order of Elks" BPOE member'],
  'bpoe':                 ['"Order of Elks" BPOE member'],
  'knights of columbus':  ['"Knights of Columbus" Catholic'],
  'eastern star':         ['"Order of the Eastern Star" OES'],
  'oes':                  ['"Order of the Eastern Star" OES'],
  'vfw':                  ['"Veterans of Foreign Wars" veteran'],
  'american legion':      ['"American Legion" veteran'],
  'spanish american':     ['"Spanish-American War" veteran'],
  'world war i':          ['World War I veteran obituary'],
  'world war 1':          ['World War I veteran obituary'],
  'wwi':                  ['World War I veteran obituary'],
  'world war ii':         ['World War II veteran obituary'],
  'world war 2':          ['World War II veteran obituary'],
  'wwii':                 ['World War II veteran obituary'],
  'navy':                 ['United States Navy veteran sailor'],
  'marine':               ['United States Marine Corps veteran'],
  'air force':            ['United States Air Force veteran'],
  'infantry':             ['infantry soldier veteran obituary'],
  'cavalry':              ['cavalry soldier veteran obituary'],
};

export async function searchForPerson(graveData, location) {
  const allNames = [];
  if (graveData.names?.length > 0) {
    graveData.names.forEach(n => { if (n && n !== 'Unknown') allNames.push(n); });
  } else if (graveData.primary_name && graveData.primary_name !== 'Unknown') {
    allNames.push(graveData.primary_name);
  }
  if (allNames.length === 0 && graveData.family_name) allNames.push(graveData.family_name);
  if (allNames.length === 0) return [];

  // Strip parenthetical role tags (e.g. "George (deceased)" → "George")
  for (let i = 0; i < allNames.length; i++) {
    allNames[i] = allNames[i].replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
  }
  const seen = new Set();
  const cleanNames = [];
  for (const n of allNames) { if (n && !seen.has(n)) { seen.add(n); cleanNames.push(n); } }
  if (cleanNames.length === 0) return [];

  // Expand abbreviations/nicknames → additional query variants
  const allVariants = [];
  const variantSeen = new Set();
  cleanNames.slice(0, 3).forEach(name => {
    expandName(name).forEach(v => {
      if (!variantSeen.has(v)) { variantSeen.add(v); allVariants.push(v); }
    });
  });

  // Include OCR alternate readings when name confidence is not high
  if (graveData.name_confidence !== 'high' && graveData.alternate_names?.length > 0) {
    graveData.alternate_names.slice(0, 2).forEach(alt => {
      const clean = (alt || '').replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
      if (clean && !variantSeen.has(clean)) { variantSeen.add(clean); allVariants.push(clean); }
    });
  }

  const deathYear = graveData.death_date?.match(/\d{4}/)?.[0] || '';
  const birthYear = graveData.birth_date?.match(/\d{4}/)?.[0] || '';

  // Derive missing year from age-at-death inscription if both explicit dates are absent
  const ageInfo = parseAgeAtDeath(graveData);
  const effectiveBirth = birthYear || ageInfo?.birth_year || '';
  const effectiveDeath = deathYear || ageInfo?.death_year || '';

  const loc = location ? location.split(',').slice(0, 2).map(s => s.trim()).join(' ') : '';
  const inscr = (graveData.inscription || '').trim();
  const primaryName = cleanNames[0] || '';

  // Session cache: skip Tavily entirely if this person was already searched this session.
  // Handles family plots where the same name appears on multiple stones.
  const cacheKey = `${primaryName.toLowerCase().trim()}|${effectiveDeath}`;
  if (primaryName && effectiveDeath && _searchCache.has(cacheKey)) {
    return _searchCache.get(cacheKey);
  }

  const primaryVar = allVariants[0] || '';
  const yr = effectiveDeath || effectiveBirth;
  const deathYrNum = effectiveDeath ? parseInt(effectiveDeath, 10) : 0;

  // Build priority-ordered query list.
  // Previous approach appended symbol queries and the general obituary query to the end of a
  // 10+ item list — both were always cut off by the slice(0,6) cap and never fired.
  // Duplicate FindAGrave queries also wasted a slot. Fixed below.
  const queries = [];

  if (primaryVar) {
    // Slot 1: FindAGrave — merged into one query (was two separate FindAGrave slots before)
    queries.push(`site:findagrave.com "${primaryVar}"${yr ? ' ' + yr : ''} buried`.trim());

    // Slot 2: BillionGraves
    queries.push(`site:billiongraves.com "${primaryVar}"`);

    // Slot 3: General obituary + year + location (was at position ~6 — never fired before)
    const obitParts = [`"${primaryVar}" obituary`];
    if (yr) obitParts.push(yr);
    if (loc) obitParts.push(loc);
    queries.push(obitParts.join(' '));

    // Slot 4: Symbol-guided (was appended to end — never fired before)
    //         OR expanded/formal name FindAGrave variant (e.g. "Wm" → "William")
    let slot4Used = false;
    if (graveData.symbols?.length > 0) {
      const symbolStr = graveData.symbols.join(' ').toLowerCase();
      for (const [key, suffixes] of Object.entries(SYMBOL_QUERIES)) {
        if (symbolStr.includes(key)) {
          queries.push(`"${primaryVar}" ${suffixes[0]}`);
          slot4Used = true;
          break;
        }
      }
    }
    if (!slot4Used && allVariants[1] && allVariants[1] !== primaryVar) {
      queries.push(`site:findagrave.com "${allVariants[1]}"${yr ? ' ' + yr : ''} buried`.trim());
    }

    // Slot 5: Era-appropriate source.
    // Pre-1924 Chronicling America is now queried directly via api-chroniclingamerica.js
    // (better quality, zero Tavily credit). Use this freed slot for a general historical
    // obituary search without a site restriction.
    if (effectiveDeath && deathYrNum <= 1924) {
      const histParts = [`"${primaryVar}" obituary`];
      if (effectiveDeath) histParts.push(effectiveDeath);
      queries.push(histParts.join(' ') + ' death');
    } else {
      queries.push(`site:legacy.com "${primaryVar}" obituary${loc ? ' ' + loc : ''}`.trim());
    }

    // Slot 6: Secondary fallback
    if (effectiveDeath && deathYrNum <= 1922) {
      queries.push(`site:legacy.com "${primaryVar}" obituary${loc ? ' ' + loc : ''}`.trim());
    } else if (graveData.family_name) {
      queries.push(`site:newspapers.com "${graveData.family_name}"${loc ? ' ' + loc : ''}${effectiveDeath ? ' ' + effectiveDeath : ''}`.trim());
    }
  }

  // Alternate OCR readings for low-confidence names: append (fire only if budget allows)
  if (graveData.name_confidence !== 'high' && graveData.alternate_names?.length > 0) {
    graveData.alternate_names.slice(0, 1).forEach(alt => {
      const clean = (alt || '').replace(/\s*\([^)]*\)\s*/g, ' ').replace(/\s+/g, ' ').trim();
      if (clean && !variantSeen.has(clean)) {
        queries.push(`site:findagrave.com "${clean}"${yr ? ' ' + yr : ''} buried`.trim());
      }
    });
  }

  // Inscription-based disambiguation: unshift to highest priority.
  // Bare surname with inscription context, or no dates at all — the inscription
  // phrase is more specific than the name alone.
  if (!effectiveDeath && !effectiveBirth && inscr.length > 30) {
    queries.unshift(`"${inscr.slice(0, 55).replace(/"/g, '').trim()}"`);
  }
  if (primaryName && !primaryName.includes(' ') && inscr.length > 15) {
    queries.unshift(`"${primaryName}" ${inscr.slice(0, 55).replace(/"/g, '').trim()}`);
  }

  const results = [];
  const seenUrls = new Set();

  for (const query of queries.slice(0, 6)) {
    try {
      const res = await fetch(`${PROXY_BASE}/tavily`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Client-Key': CLIENT_KEY },
        body: JSON.stringify({ query, search_depth: 'advanced', max_results: 2, include_answer: false }),
      });
      const data = await res.json();
      if (data.results) {
        data.results.forEach(r => {
          if (!seenUrls.has(r.url)) {
            seenUrls.add(r.url);
            const u = (r.url || '').toLowerCase();
            results.push({
              title: r.title,
              url: r.url,
              content: r.content?.slice(0, 3000),
              source_type:
                u.includes('billiongraves.com')          ? 'verified_transcription' :
                u.includes('findagrave.com')             ? 'memorial' :
                u.includes('chroniclingamerica.loc.gov') ? 'public_domain' :
                u.includes('legacy.com') || u.includes('newspapers.com') ? 'obituary' :
                'web',
            });
          }
        });
      }
    } catch (e) { console.warn('Tavily query failed:', query, e?.message); }
  }

  if (primaryName && effectiveDeath) _searchCache.set(cacheKey, results);
  return results;
}
