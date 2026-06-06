// js/api-wikitree.js
// WikiTree genealogy search.
// POSTs to ${PROXY_BASE}/wikitree via the Cloudflare proxy. Three-pass strategy:
//   1. With year filter for precision (original name).
//   2. Wider net without years if pass 1 returns nothing (original name).
//   3. If first name is an abbreviation/nickname, retry with the formal form.
// Scoring: name alignment (nickname-aware) + date alignment + geographic alignment.
// Hard credibility floor: requires last-name match + (birth OR death year aligned).
// Depends on: PROXY_BASE (from js/config.js).

// Abbreviation/nickname table (lowercase canonical forms for first-name matching).
const _WT_EXPAND = {
  'wm': 'william', 'geo': 'george', 'thos': 'thomas', 'jno': 'john',
  'chas': 'charles', 'jas': 'james', 'robt': 'robert', 'benj': 'benjamin',
  'edw': 'edward', 'sam': 'samuel', 'nathl': 'nathaniel', 'bart': 'bartholomew',
  'richd': 'richard', 'nichs': 'nicholas', 'danl': 'daniel',
  'bill': 'william', 'billy': 'william', 'will': 'william',
  'bob': 'robert', 'rob': 'robert',
  'tom': 'thomas', 'tommy': 'thomas',
  'jim': 'james', 'jimmy': 'james',
  'dick': 'richard', 'rich': 'richard',
  'charlie': 'charles', 'chuck': 'charles',
  'ed': 'edward', 'eddie': 'edward', 'ned': 'edward',
  'jack': 'john', 'johnny': 'john',
  'fred': 'frederick', 'freddy': 'frederick',
  'ben': 'benjamin',
  'dan': 'daniel', 'danny': 'daniel',
  'al': 'albert', 'alex': 'alexander',
  'abe': 'abraham',
  'gus': 'augustus',
  'matt': 'matthew',
  'nick': 'nicholas',
  'ted': 'theodore', 'theo': 'theodore',
  'tim': 'timothy',
  'tony': 'anthony',
  'hal': 'henry', 'hank': 'henry',
  'eliz': 'elizabeth', 'lizzie': 'elizabeth', 'betsy': 'elizabeth',
  'bess': 'elizabeth', 'bessie': 'elizabeth', 'betty': 'elizabeth', 'beth': 'elizabeth',
  'maggie': 'margaret', 'peggy': 'margaret', 'meg': 'margaret',
  'polly': 'mary', 'molly': 'mary',
  'nell': 'eleanor', 'nelly': 'eleanor',
  'sally': 'sarah', 'sadie': 'sarah',
  'hattie': 'harriet',
  'nan': 'ann', 'nancy': 'ann', 'annie': 'ann',
  'kate': 'katherine', 'katy': 'katherine', 'kitty': 'katherine',
  'sue': 'susan', 'susie': 'susan',
};

function _wtFormalFirst(name) {
  const key = name.replace(/\.$/, '').toLowerCase();
  return _WT_EXPAND[key] || key;
}

// Check whether two first names are equivalent, accounting for abbreviations,
// nicknames, and prefix overlap.
function _wtFirstNamesMatch(queried, candidate) {
  const q = _wtFormalFirst(queried);
  const c = _wtFormalFirst(candidate);
  if (q === c) return true;
  if (q.startsWith(c) || c.startsWith(q)) return true;
  return false;
}

const _WT_STATE_ABBREVS = {
  AL:'alabama', AK:'alaska', AZ:'arizona', AR:'arkansas', CA:'california',
  CO:'colorado', CT:'connecticut', DE:'delaware', FL:'florida', GA:'georgia',
  HI:'hawaii', ID:'idaho', IL:'illinois', IN:'indiana', IA:'iowa',
  KS:'kansas', KY:'kentucky', LA:'louisiana', ME:'maine', MD:'maryland',
  MA:'massachusetts', MI:'michigan', MN:'minnesota', MS:'mississippi',
  MO:'missouri', MT:'montana', NE:'nebraska', NV:'nevada', NH:'new hampshire',
  NJ:'new jersey', NM:'new mexico', NY:'new york', NC:'north carolina',
  ND:'north dakota', OH:'ohio', OK:'oklahoma', OR:'oregon', PA:'pennsylvania',
  RI:'rhode island', SC:'south carolina', SD:'south dakota', TN:'tennessee',
  TX:'texas', UT:'utah', VT:'vermont', VA:'virginia', WA:'washington',
  WV:'west virginia', WI:'wisconsin', WY:'wyoming', DC:'district of columbia',
};

function _wtExtractUSState(str) {
  if (!str) return null;
  const abbrevMatch = str.match(/\b([A-Z]{2})\b/);
  if (abbrevMatch && _WT_STATE_ABBREVS[abbrevMatch[1]]) return _WT_STATE_ABBREVS[abbrevMatch[1]];
  const lower = str.toLowerCase();
  for (const fullName of Object.values(_WT_STATE_ABBREVS)) {
    if (lower.includes(fullName)) return fullName;
  }
  return null;
}

// ── WIKITREE: GENEALOGY SEARCH ───────────────────────────────────
async function searchWikiTree(graveData, location) {
  const name = graveData.primary_name || graveData.names?.[0];
  if (!name) return null;

  const parts = name.trim().split(' ');
  if (parts.length < 2) return null;
  const firstName = parts[0];
  const lastName = parts[parts.length - 1];
  const birthYear = graveData.birth_date?.match(/\d{4}/)?.[0] || '';
  const deathYear = graveData.death_date?.match(/\d{4}/)?.[0] || '';

  // Build expanded first name for pass 3 (if abbreviated/informal)
  const formalFirstLower = _wtFormalFirst(firstName);
  const expandedFirstName = formalFirstLower !== firstName.toLowerCase()
    ? formalFirstLower.charAt(0).toUpperCase() + formalFirstLower.slice(1)
    : null;

  async function wikiSearch(body) {
    const res = await fetch(`${PROXY_BASE}/wikitree`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Client-Key': CLIENT_KEY },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      console.log('🌳 WIKITREE proxy returned', res.status);
      return [];
    }
    const data = await res.json();
    const matches = Array.isArray(data) ? data[0]?.matches : data?.matches;
    return Array.isArray(matches) ? matches : [];
  }

  const baseQuery = {
    action: 'searchPerson',
    FirstName: firstName,
    LastName: lastName,
    fields: 'Name,FirstName,LastNameAtBirth,LastNameCurrent,BirthDate,DeathDate,BirthLocation,DeathLocation,Father,Mother,Gender,Bio'
  };

  const expandedQuery = expandedFirstName ? { ...baseQuery, FirstName: expandedFirstName } : null;

  console.log('🌳 WIKITREE searching:', firstName, lastName, birthYear || '(no year)');

  try {
    let matches = [];

    // Pass 1: date-filtered with original name
    if (birthYear) {
      matches = await wikiSearch({ ...baseQuery, BirthDate: birthYear, DeathDate: deathYear || undefined });
      if (matches.length > 0) {
        console.log('🌳 WIKITREE pass 1: found', matches.length, 'with year filter');
      } else {
        console.log('🌳 WIKITREE pass 1: no matches, retrying without year');
      }
    }

    // Pass 2: unfiltered with original name
    if (matches.length === 0) {
      matches = await wikiSearch(baseQuery);
      console.log('🌳 WIKITREE pass 2: found', matches.length, 'without year filter');
    }

    // Pass 3: if first name was an abbreviation/nickname, retry with formal form
    if (matches.length === 0 && expandedQuery) {
      if (birthYear) {
        matches = await wikiSearch({ ...expandedQuery, BirthDate: birthYear, DeathDate: deathYear || undefined });
      }
      if (matches.length === 0) {
        matches = await wikiSearch(expandedQuery);
      }
      console.log('🌳 WIKITREE pass 3 (expanded name):', matches.length, 'matches');
    }

    if (matches.length === 0) {
      console.log('🌳 WIKITREE no matches');
      return null;
    }

    const queriedFirst = firstName.toLowerCase();
    const queriedLast  = lastName.toLowerCase();
    const birthYearNum = birthYear ? parseInt(birthYear, 10) : null;
    const deathYearNum = deathYear ? parseInt(deathYear, 10) : null;

    // Geographic context: if we know the burial state, use it to boost/penalise
    const queryState = _wtExtractUSState(location);

    let best = null;
    let bestScore = -Infinity;
    for (const m of matches) {
      let score = 0;

      // — Name alignment (nickname/abbreviation-aware) —
      const mFirst = (m.FirstName || '').toLowerCase();
      const mLast  = (m.LastNameAtBirth || m.LastNameCurrent || '').toLowerCase();
      const firstMatch = mFirst && _wtFirstNamesMatch(queriedFirst, mFirst);
      const lastMatch  = mLast  && (mLast === queriedLast);
      if (firstMatch) score += 20;
      if (lastMatch)  score += 20;

      // — Birth year alignment —
      const mBirthYear = parseInt((m.BirthDate || '').slice(0, 4), 10);
      let birthAligned = false;
      if (birthYearNum && mBirthYear) {
        const diff = Math.abs(mBirthYear - birthYearNum);
        if (diff === 0)      { score += 100; birthAligned = true; }
        else if (diff <= 2)  { score += 50;  birthAligned = true; }
        else if (diff <= 5)  { score += 20;  birthAligned = true; }
        else                 { score -= diff; }
      }

      // — Death year alignment —
      const mDeathYear = parseInt((m.DeathDate || '').slice(0, 4), 10);
      let deathAligned = false;
      if (deathYearNum && mDeathYear) {
        const diff = Math.abs(mDeathYear - deathYearNum);
        if (diff === 0)      { score += 100; deathAligned = true; }
        else if (diff <= 2)  { score += 50;  deathAligned = true; }
        else if (diff <= 5)  { score += 20;  deathAligned = true; }
        else                 { score -= diff; }
      }

      // — Geographic alignment —
      // Boost if burial state matches WikiTree birth/death location;
      // penalise if the state is known for this record but contradicts it.
      if (queryState) {
        const mBirthState = _wtExtractUSState(m.BirthLocation || '');
        const mDeathState = _wtExtractUSState(m.DeathLocation || '');
        if (mBirthState === queryState || mDeathState === queryState) {
          score += 30;
        } else if (mBirthState || mDeathState) {
          score -= 20;
        }
      }

      if (m.BirthLocation) score += 1;
      m._nameAligned = firstMatch && lastMatch;
      m._dateAligned = birthAligned || deathAligned;

      if (score > bestScore) { bestScore = score; best = m; }
    }

    // — Credibility floor —
    if (!best || !best._nameAligned || !best._dateAligned) {
      console.log(
        '🌳 WIKITREE best match below credibility floor — rejecting.',
        'name aligned:', !!best?._nameAligned,
        'date aligned:', !!best?._dateAligned,
        'top candidate:', best?.Name || '(none)',
        `(${best?.BirthDate || '?'} → ${best?.DeathDate || '?'})`
      );
      return null;
    }

    if (birthYear) {
      const bestYear = parseInt((best.BirthDate || '').slice(0, 4), 10);
      if (bestYear && Math.abs(bestYear - parseInt(birthYear, 10)) > 10) {
        console.log('🌳 WIKITREE best match too far off (', bestYear, 'vs', birthYear, ') — rejecting');
        return null;
      }
    }

    console.log('🌳 WIKITREE best match:', best.Name, best.BirthDate, '→', best.DeathDate, '(score', bestScore + ')');

    return {
      name: `${best.FirstName || ''} ${best.LastNameAtBirth || best.LastNameCurrent || ''}`.trim(),
      birth: best.BirthDate || null,
      death: best.DeathDate || null,
      birthLocation: best.BirthLocation || null,
      deathLocation: best.DeathLocation || null,
      wikiTreeId: best.Name || null,
      bioSnippet: best.Bio ? best.Bio.slice(0, 1500) : null
    };
  } catch (e) {
    console.log('🌳 WIKITREE fetch failed:', e.message);
    return null;
  }
}
