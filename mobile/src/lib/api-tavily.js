import { PROXY_BASE } from './config';
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

  const queries = [];
  allVariants.forEach(name => {
    queries.push(`"${name}" buried cemetery grave location`.trim());
    queries.push(`site:findagrave.com "${name}" buried`.trim());
    queries.push(`site:billiongraves.com "${name}"`.trim());
    if (effectiveDeath) queries.push(`site:chroniclingamerica.loc.gov "${name}" ${effectiveDeath} obituary`.trim());
  });
  allVariants.forEach(name => {
    const yr = effectiveDeath || effectiveBirth;
    queries.push(`site:findagrave.com "${name}" ${yr}`.trim());
    queries.push(`site:legacy.com "${name}" obituary ${loc}`.trim());
    queries.push(`"${name}" obituary ${yr} ${loc}`.trim());
  });
  if (graveData.family_name) {
    queries.push(`site:newspapers.com "${graveData.family_name}" ${loc} ${effectiveDeath}`.trim());
  }
  if (loc) {
    queries.push(`site:atlasobscura.com ${loc} cemetery history`.trim());
    queries.push(`historic cemetery ${loc} history abandoned`.trim());
  }

  // High-priority disambiguation: when name is a bare surname with no dates (e.g. historical
  // monuments where the stone reads "TOMB OF WASHINGTON"), use the inscription text itself as
  // the search query — far more specific than the name alone.
  const primaryName = cleanNames[0] || '';
  const isBare = primaryName && !primaryName.includes(' ');
  if (isBare && inscr.length > 15) {
    const ctx = inscr.slice(0, 55).replace(/"/g, '').trim();
    queries.unshift(`"${primaryName}" ${ctx}`);
  }
  if (!effectiveDeath && !effectiveBirth && inscr.length > 30) {
    const phrase = inscr.slice(0, 55).replace(/"/g, '').trim();
    queries.unshift(`"${phrase}"`);
  }

  // Symbol-guided queries: each recognised emblem/affiliation generates one
  // targeted query that routes the search toward the right record repositories.
  if (graveData.symbols?.length > 0) {
    const symbolStr = graveData.symbols.join(' ').toLowerCase();
    const primaryVar = allVariants[0] || '';
    for (const [key, suffixes] of Object.entries(SYMBOL_QUERIES)) {
      if (symbolStr.includes(key)) {
        suffixes.forEach(suffix => {
          if (primaryVar) queries.push(`"${primaryVar}" ${suffix}`);
        });
      }
    }
  }

  const results = [];
  const seenUrls = new Set();

  for (const query of queries.slice(0, 6)) {
    try {
      const res = await fetch(`${PROXY_BASE}/tavily`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, search_depth: 'basic', max_results: 3, include_answer: false }),
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
              content: r.content?.slice(0, 1000),
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

  return results;
}
