import { PROXY_BASE } from './config';

export async function searchWikiTree(graveData) {
  const name = graveData.primary_name || graveData.names?.[0];
  if (!name) return null;

  const parts = name.trim().split(' ');
  if (parts.length < 2) return null;
  const firstName = parts[0];
  const lastName = parts[parts.length - 1];
  const birthYear = graveData.birth_date?.match(/\d{4}/)?.[0] || '';
  const deathYear = graveData.death_date?.match(/\d{4}/)?.[0] || '';

  const baseQuery = {
    action: 'searchPerson',
    FirstName: firstName,
    LastName: lastName,
    fields: 'Name,FirstName,LastNameAtBirth,LastNameCurrent,BirthDate,DeathDate,BirthLocation,DeathLocation,Father,Mother,Gender,Bio',
  };

  async function wikiSearch(body) {
    const res = await fetch(`${PROXY_BASE}/wikitree`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) return [];
    const data = await res.json();
    const matches = Array.isArray(data) ? data[0]?.matches : data?.matches;
    return Array.isArray(matches) ? matches : [];
  }

  try {
    let matches = [];
    if (birthYear) {
      matches = await wikiSearch({ ...baseQuery, BirthDate: birthYear, DeathDate: deathYear || undefined });
    }
    if (matches.length === 0) {
      matches = await wikiSearch(baseQuery);
    }
    if (matches.length === 0) return null;

    const queriedFirst  = firstName.toLowerCase();
    const queriedLast   = lastName.toLowerCase();
    const birthYearNum  = birthYear ? parseInt(birthYear, 10) : null;
    const deathYearNum  = deathYear ? parseInt(deathYear, 10) : null;

    let best = null;
    let bestScore = -Infinity;

    for (const m of matches) {
      let score = 0;
      const mFirst = (m.FirstName || '').toLowerCase();
      const mLast  = (m.LastNameAtBirth || m.LastNameCurrent || '').toLowerCase();
      const firstMatch = mFirst && (mFirst === queriedFirst || mFirst.startsWith(queriedFirst) || queriedFirst.startsWith(mFirst));
      const lastMatch  = mLast  && (mLast  === queriedLast);
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

    console.warn('WIKITREE match:', best.Name, best.BirthDate, best.DeathDate);
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
    console.log('WikiTree fetch failed:', e.message);
    return null;
  }
}
