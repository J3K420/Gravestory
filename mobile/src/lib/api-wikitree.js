import { PROXY_BASE, CLIENT_KEY } from './config';
import { EXPAND as _EXPAND } from './abbreviations';

// WikiTree matching needs lowercase — derive from the shared title-case table.
const EXPAND = Object.fromEntries(
  Object.entries(_EXPAND).map(([k, v]) => [k, v.toLowerCase()])
);

// Return the canonical (lowercase) formal name for a given first name, or the
// original lowercased name if no expansion is found.
function formalFirst(name) {
  const key = name.replace(/\.$/, '').toLowerCase();
  return EXPAND[key] || key;
}

// Check whether two first names are considered equivalent, accounting for
// abbreviations, nicknames, and prefix/suffix overlap.
function firstNamesMatch(queried, candidate) {
  const q = formalFirst(queried);
  const c = formalFirst(candidate);
  if (q === c) return true;
  // Prefix match (e.g. "geo" → "george", "william" starts with "will")
  if (q.startsWith(c) || c.startsWith(q)) return true;
  return false;
}

// Extract a normalised US state name from a free-form location string.
// Returns lowercase state name (e.g. "pennsylvania") or null.
const STATE_ABBREVS = {
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

function extractUSState(str) {
  if (!str) return null;
  // Try 2-char abbreviation (e.g. ", PA" or " PA,")
  const abbrevMatch = str.match(/\b([A-Z]{2})\b/);
  if (abbrevMatch && STATE_ABBREVS[abbrevMatch[1]]) return STATE_ABBREVS[abbrevMatch[1]];
  // Try full state name (case-insensitive)
  const lower = str.toLowerCase();
  for (const [, fullName] of Object.entries(STATE_ABBREVS)) {
    if (lower.includes(fullName)) return fullName;
  }
  return null;
}

export async function searchWikiTree(graveData, location = null) {
  const name = graveData.primary_name || graveData.names?.[0];
  if (!name) return null;

  const parts = name.trim().split(' ');
  if (parts.length < 2) return null;
  const firstName = parts[0];
  const lastName = parts[parts.length - 1];
  const birthYear = graveData.birth_date?.match(/\d{4}/)?.[0] || '';
  const deathYear = graveData.death_date?.match(/\d{4}/)?.[0] || '';

  // Try expanded first name if it differs from the raw form
  const formalFirstName = formalFirst(firstName);
  const expandedFirstName =
    formalFirstName !== firstName.toLowerCase()
      ? formalFirstName.charAt(0).toUpperCase() + formalFirstName.slice(1)
      : null;

  const baseQuery = {
    action: 'searchPerson',
    FirstName: firstName,
    LastName: lastName,
    fields: 'Name,FirstName,LastNameAtBirth,LastNameCurrent,BirthDate,DeathDate,BirthLocation,DeathLocation,Father,Mother,Gender,Bio',
  };

  const expandedQuery = expandedFirstName
    ? { ...baseQuery, FirstName: expandedFirstName }
    : null;

  async function wikiSearch(body) {
    const res = await fetch(`${PROXY_BASE}/wikitree`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Client-Key': CLIENT_KEY },
      body: JSON.stringify(body),
    });
    if (!res.ok) return [];
    const data = await res.json();
    const matches = Array.isArray(data) ? data[0]?.matches : data?.matches;
    return Array.isArray(matches) ? matches : [];
  }

  try {
    let matches = [];

    // Pass 1: date-filtered search with original name
    if (birthYear) {
      matches = await wikiSearch({ ...baseQuery, BirthDate: birthYear, DeathDate: deathYear || undefined });
    }
    // Pass 2: unfiltered search with original name
    if (matches.length === 0) {
      matches = await wikiSearch(baseQuery);
    }
    // Pass 3: if first name was an abbreviation/nickname, retry with the formal form
    if (matches.length === 0 && expandedQuery) {
      if (birthYear) {
        matches = await wikiSearch({ ...expandedQuery, BirthDate: birthYear, DeathDate: deathYear || undefined });
      }
      if (matches.length === 0) {
        matches = await wikiSearch(expandedQuery);
      }
    }

    if (matches.length === 0) return null;

    const queriedFirst  = firstName.toLowerCase();
    const queriedLast   = lastName.toLowerCase();
    const birthYearNum  = birthYear ? parseInt(birthYear, 10) : null;
    const deathYearNum  = deathYear ? parseInt(deathYear, 10) : null;

    // Geographic context: if we know the burial state, use it to boost/penalise
    const queryState = extractUSState(location);

    let best = null;
    let bestScore = -Infinity;

    for (const m of matches) {
      let score = 0;
      const mFirst = (m.FirstName || '').toLowerCase();
      const mLast  = (m.LastNameAtBirth || m.LastNameCurrent || '').toLowerCase();

      // Name scoring — nickname/abbreviation-aware
      const firstMatch = mFirst && firstNamesMatch(queriedFirst, mFirst);
      const lastMatch  = mLast  && (mLast === queriedLast);
      if (firstMatch) score += 20;
      if (lastMatch)  score += 20;

      const mBirthYear = parseInt((m.BirthDate || '').slice(0, 4), 10);
      let birthAligned = false;
      if (birthYearNum && mBirthYear) {
        const diff = Math.abs(mBirthYear - birthYearNum);
        if (diff === 0)     { score += 100; birthAligned = true; }
        else if (diff <= 2) { score += 50;  birthAligned = true; }
        else if (diff <= 5) { score += 20;  birthAligned = true; }
        else                { score -= diff; }
      }

      const mDeathYear = parseInt((m.DeathDate || '').slice(0, 4), 10);
      let deathAligned = false;
      if (deathYearNum && mDeathYear) {
        const diff = Math.abs(mDeathYear - deathYearNum);
        if (diff === 0)     { score += 100; deathAligned = true; }
        else if (diff <= 2) { score += 50;  deathAligned = true; }
        else if (diff <= 5) { score += 20;  deathAligned = true; }
        else                { score -= diff; }
      }

      // Geographic alignment: boost if burial state matches WikiTree birth/death location;
      // penalise if the state is known but contradicts the WikiTree record.
      if (queryState) {
        const mBirthState = extractUSState(m.BirthLocation || '');
        const mDeathState = extractUSState(m.DeathLocation || '');
        if (mBirthState === queryState || mDeathState === queryState) {
          score += 30;
        } else if (mBirthState || mDeathState) {
          // State is known for this record but doesn't align — likely wrong person
          score -= 20;
        }
      }

      if (m.BirthLocation) score += 1;
      m._nameAligned = firstMatch && lastMatch;
      m._dateAligned = birthAligned || deathAligned;

      if (score > bestScore) { bestScore = score; best = m; }
    }

    if (!best || !best._nameAligned || !best._dateAligned) return null;

    if (birthYear) {
      const bestYear = parseInt((best.BirthDate || '').slice(0, 4), 10);
      if (bestYear && Math.abs(bestYear - parseInt(birthYear, 10)) > 10) return null;
    }

    return {
      name: `${best.FirstName || ''} ${best.LastNameAtBirth || best.LastNameCurrent || ''}`.trim(),
      birth: best.BirthDate || null,
      death: best.DeathDate || null,
      birthLocation: best.BirthLocation || null,
      deathLocation: best.DeathLocation || null,
      wikiTreeId: best.Name || null,
      bioSnippet: best.Bio ? best.Bio.slice(0, 1500) : null,
    };
  } catch (e) {
    console.warn('WikiTree fetch failed:', e.message);
    return null;
  }
}
