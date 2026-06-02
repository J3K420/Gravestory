import { PROXY_BASE } from './config';

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

  const deathYear = graveData.death_date?.match(/\d{4}/)?.[0] || '';
  const birthYear = graveData.birth_date?.match(/\d{4}/)?.[0] || '';
  const loc = location ? location.split(',').slice(0, 2).map(s => s.trim()).join(' ') : '';
  const inscr = (graveData.inscription || '').trim();

  const queries = [];
  cleanNames.slice(0, 3).forEach(name => {
    queries.push(`"${name}" buried cemetery grave location`.trim());
    queries.push(`site:findagrave.com "${name}" buried`.trim());
    queries.push(`site:billiongraves.com "${name}"`.trim());
    if (deathYear) queries.push(`site:chroniclingamerica.loc.gov "${name}" ${deathYear} obituary`.trim());
  });
  cleanNames.slice(0, 3).forEach(name => {
    const yr = deathYear || birthYear;
    queries.push(`site:findagrave.com "${name}" ${yr}`.trim());
    queries.push(`site:legacy.com "${name}" obituary ${loc}`.trim());
    queries.push(`"${name}" obituary ${yr} ${loc}`.trim());
  });
  if (graveData.family_name) {
    queries.push(`site:newspapers.com "${graveData.family_name}" ${loc} ${deathYear}`.trim());
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
  if (!deathYear && !birthYear && inscr.length > 30) {
    const phrase = inscr.slice(0, 55).replace(/"/g, '').trim();
    queries.unshift(`"${phrase}"`);
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

  console.warn('TAVILY results:', results.length, results.map(r => r.title).join(' | '));
  return results;
}
