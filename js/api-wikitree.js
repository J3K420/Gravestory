// js/api-wikitree.js
// WikiTree genealogy search.
// POSTs to ${PROXY_BASE}/wikitree via the Cloudflare proxy. Two-pass strategy:
//   1. With year filter for precision.
//   2. Wider net without years if pass 1 returns nothing, then score locally.
// Hard credibility floor: requires last-name match + (birth OR death year aligned)
// before returning a record. Rejects "WikiTree-found-something" zero-evidence hits.
// Depends on: PROXY_BASE (from js/config.js).

// ── WIKITREE: GENEALOGY SEARCH ───────────────────────────────────
async function searchWikiTree(graveData) {
  const name = graveData.primary_name || graveData.names?.[0];
  if (!name) return null;

  const parts = name.trim().split(' ');
  if (parts.length < 2) return null;
  const firstName = parts[0];
  const lastName = parts[parts.length - 1];
  const birthYear = graveData.birth_date?.match(/\d{4}/)?.[0] || '';
  const deathYear = graveData.death_date?.match(/\d{4}/)?.[0] || '';

  // Inner helper: do a single search call
  async function wikiSearch(body) {
    const res = await fetch(`${PROXY_BASE}/wikitree`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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

  console.log('🌳 WIKITREE searching:', firstName, lastName, birthYear || '(no year)');

  try {
    // Attempt 1: with year filter (if we have one)
    let matches = [];
    if (birthYear) {
      matches = await wikiSearch({ ...baseQuery, BirthDate: birthYear, DeathDate: deathYear || undefined });
      if (matches.length > 0) {
        console.log('🌳 WIKITREE pass 1: found', matches.length, 'with year filter');
      } else {
        console.log('🌳 WIKITREE pass 1: no matches, retrying without year');
      }
    }

    // Attempt 2: no year filter — wider net, then score locally
    if (matches.length === 0) {
      matches = await wikiSearch(baseQuery);
      console.log('🌳 WIKITREE pass 2: found', matches.length, 'without year filter');
    }

    if (matches.length === 0) {
      console.log('🌳 WIKITREE no matches');
      return null;
    }

    // Score each match against the queried person.
    // A match needs name alignment AND at least one date alignment to count.
    // Records with no BirthDate AND no DeathDate cannot clear the floor
    // even if WikiTree's own filter surfaced them — they're zero-evidence hits.
    const queriedFirst = firstName.toLowerCase();
    const queriedLast  = lastName.toLowerCase();
    const birthYearNum = birthYear ? parseInt(birthYear, 10) : null;
    const deathYearNum = deathYear ? parseInt(deathYear, 10) : null;

    let best = null;
    let bestScore = -Infinity;
    for (const m of matches) {
      let score = 0;

      // — Name alignment (required component) —
      const mFirst = (m.FirstName || '').toLowerCase();
      const mLast  = (m.LastNameAtBirth || m.LastNameCurrent || '').toLowerCase();
      const firstMatch = mFirst && (mFirst === queriedFirst || mFirst.startsWith(queriedFirst) || queriedFirst.startsWith(mFirst));
      const lastMatch  = mLast  && (mLast  === queriedLast);
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

      // Slight bonus for records that have an actual birth location filled in
      if (m.BirthLocation) score += 1;

      // Stash the alignment flags so the floor check below can read them
      m._nameAligned = firstMatch && lastMatch;
      m._dateAligned = birthAligned || deathAligned;

      if (score > bestScore) { bestScore = score; best = m; }
    }

    // — Credibility floor —
    // Require: last-name match + (birth-year OR death-year alignment).
    // Without these, the record is "WikiTree returned something for the name filter
    // but no real biographical fields aligned" — same bug class as the Wikipedia
    // hits[0] / Linda Lee Cadwell case that surfaced in Session 5.
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

    // Secondary sanity check: if both sides have a birth year and they're >10 years apart, reject.
    // (Belt-and-suspenders — the floor above already requires date alignment, but keep this
    //  in case future scoring changes loosen the alignment thresholds.)
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
