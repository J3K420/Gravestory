// biography.js — Generate biographical narrative via Gemini (extracted Stage 4)

// Build a cross-source corroboration summary for the biography prompt.
// Detects name/date agreement and conflicts across WikiTree, Wikidata, FindAGrave,
// obituaries, BillionGraves, and Chronicling America so the model can cite with
// appropriate confidence instead of silently blending conflicting claims.
// wikidataResult: optional { birthDate, deathDate, burialPlaceLabel } from queryWikidata().
function _buildCorroborationSummary(graveData, searchResults, wikiData, wikidataResult) {
  const lines = [];
  // Use first WikiTree result for corroboration (primary person on multi-subject stones)
  const primaryWikiData = Array.isArray(wikiData) ? wikiData[0] : wikiData;
  const stoneName = (graveData.primary_name || graveData.names?.[0] || '').toLowerCase();
  const stoneBirth = graveData.birth_date?.match(/\d{4}/)?.[0];
  const stoneDeath = graveData.death_date?.match(/\d{4}/)?.[0];
  const stoneFirst = stoneName.split(' ')[0];
  const stoneLast  = stoneName.split(' ').pop();

  const nameConfirmers = new Set();
  if (primaryWikiData?.name) {
    const wikiFirst = primaryWikiData.name.toLowerCase().split(' ')[0];
    if (stoneFirst && wikiFirst && (wikiFirst.startsWith(stoneFirst) || stoneFirst.startsWith(wikiFirst))) {
      nameConfirmers.add('WikiTree');
    }
  }
  const SOURCE_LABEL = {
    memorial: 'FindAGrave',
    obituary: 'Obituary',
    verified_transcription: 'BillionGraves',
    public_domain: 'Chronicling America',
  };
  for (const r of searchResults) {
    const label = SOURCE_LABEL[r.source_type];
    if (!label || !stoneName) continue;
    const hay = ((r.title || '') + ' ' + (r.content || '')).toLowerCase();
    const hasFirst = stoneFirst && stoneFirst.length > 1 && hay.includes(stoneFirst);
    const hasLast  = stoneLast && stoneLast.length > 2 && hay.includes(stoneLast);
    if (hasFirst && hasLast) nameConfirmers.add(label);
  }

  if (nameConfirmers.size >= 2) {
    lines.push(`Name independently corroborated by: ${[...nameConfirmers].join(' + ')} — higher confidence in identity.`);
  } else if (nameConfirmers.size === 1) {
    lines.push(`Name confirmed by: ${[...nameConfirmers][0]}.`);
  }

  const wikiDeath = primaryWikiData?.death?.slice(0, 4);
  const wikiBirth = primaryWikiData?.birth?.slice(0, 4);
  if (stoneDeath && wikiDeath) {
    const diff = Math.abs(parseInt(stoneDeath, 10) - parseInt(wikiDeath, 10));
    if (diff <= 2) {
      lines.push(`Death year corroborated: stone (${stoneDeath}) matches WikiTree (${wikiDeath}).`);
    } else {
      lines.push(`DATE CONFLICT: stone death year ${stoneDeath} vs WikiTree ${wikiDeath} — trust the stone; WikiTree may refer to a different person.`);
    }
  }
  if (stoneBirth && wikiBirth) {
    const diff = Math.abs(parseInt(stoneBirth, 10) - parseInt(wikiBirth, 10));
    if (diff <= 2) {
      lines.push(`Birth year corroborated: stone (${stoneBirth}) matches WikiTree (${wikiBirth}).`);
    } else {
      lines.push(`DATE CONFLICT: stone birth year ${stoneBirth} vs WikiTree ${wikiBirth} — trust the stone.`);
    }
  }

  // Wikidata date corroboration (independent structured source)
  if (wikidataResult) {
    const wdDeath = wikidataResult.deathDate?.slice(0, 4);
    const wdBirth = wikidataResult.birthDate?.slice(0, 4);
    if (stoneDeath && wdDeath) {
      const diff = Math.abs(parseInt(stoneDeath, 10) - parseInt(wdDeath, 10));
      if (diff <= 2) {
        lines.push(`Death year corroborated by Wikidata: stone (${stoneDeath}) matches Wikidata (${wdDeath}).`);
      } else {
        lines.push(`DATE CONFLICT: stone death year ${stoneDeath} vs Wikidata ${wdDeath} — possible different person.`);
      }
    }
    if (stoneBirth && wdBirth) {
      const diff = Math.abs(parseInt(stoneBirth, 10) - parseInt(wdBirth, 10));
      if (diff <= 2) {
        lines.push(`Birth year corroborated by Wikidata: stone (${stoneBirth}) matches Wikidata (${wdBirth}).`);
      }
    }
    if (wikidataResult.burialPlaceLabel) {
      lines.push(`Wikidata confirms burial place: "${wikidataResult.burialPlaceLabel}".`);
    }
  }

  if (lines.length === 0) return '';
  return 'SOURCE CORROBORATION:\n' + lines.map(l => `- ${l}`).join('\n');
}

// Validate and normalise the structured citations returned by Gemini.
// Sorts by n, remaps any non-sequential numbers to 1,2,3..., strips orphan
// [N] markers, and produces sources/source_urls arrays for backwards-compat
// with storage and display code.
function _validateCitations(parsed) {
  if (!parsed?.biography) return parsed;
  const raw = (parsed.citations || []).filter(c => c && Number.isInteger(c.n) && c.n >= 1);
  const sorted = [...raw].sort((a, b) => a.n - b.n);

  // Build a remap so non-sequential n values align to 1-based sources array
  const nMap = {};
  sorted.forEach((c, i) => { nMap[c.n] = i + 1; });

  let bio = parsed.biography.replace(/\[(\d+)\]/g, (match, nStr) => {
    const mapped = nMap[parseInt(nStr, 10)];
    return mapped ? `[${mapped}]` : '';
  });
  bio = bio.replace(/[ \t]{2,}/g, ' ').replace(/\s+([.,;!?])/g, '$1');

  return {
    ...parsed,
    biography: bio,
    sources:     sorted.map(c => c.description || ''),
    source_urls: sorted.map(c => c.url || ''),
  };
}

// ── GEMINI: GENERATE BIOGRAPHY ───────────────────────────────────
// wikidataResult: optional result from queryWikidata() — structured dates + burial place.
async function generateBiography(graveData, searchResults, wikiData, location, wikipediaSummary, wikidataResult) {
  // Confidence floor — if no web results, no WikiTree record, and no Wikipedia
  // summary came back, do not call the LLM at all: return a short biography drawn
  // strictly from the stone itself to prevent hallucination.
  const hasRealSources = (searchResults && searchResults.length > 0) || (wikiData != null) ||
    (Array.isArray(wikipediaSummary) ? wikipediaSummary.some(Boolean) : wikipediaSummary != null);
  if (!hasRealSources) {
    console.log('📜 No real sources — returning stone-only biography, skipping LLM.');
    const allPeople = (graveData.names || []).filter(Boolean);
    const who = allPeople.length > 1
      ? allPeople.join(' and ')
      : (graveData.primary_name || allPeople[0] || 'an individual');
    const bday = graveData.birth_date ? `, born ${graveData.birth_date}` : '';
    const dday = graveData.death_date ? ` and passed ${graveData.death_date}` : '';
    const insc = graveData.inscription
      ? ` Their stone bears the words: "${graveData.inscription}".`
      : '';
    return {
      name: allPeople.length > 1 ? allPeople.join(' & ') : (graveData.primary_name || allPeople[0] || 'Unknown'),
      dates: (graveData.birth_date && graveData.death_date)
        ? `born ${graveData.birth_date} — died ${graveData.death_date}` : '',
      biography:
        `This stone marks the ${allPeople.length > 1 ? 'lives' : 'life'} of ${who}${bday}${dday}.${insc} ` +
        `Beyond what the stone itself records, the available sources do not ` +
        `yield further verifiable details. What endures here ` +
        `is the marker they were given and the words chosen to remember them.`,
      sources: ['Gravestone inscription (primary source)'],
      source_urls: [''],
      location: location || ''
    };
  }

  const TYPE_LABELS = {
    verified_transcription: '[BillionGraves]',
    public_domain:          '[Chronicling America]',
    memorial:               '[Find A Grave]',
    obituary:               '[Obituary]',
    wikidata:               '[Wikidata]',
    wikitree:               '[WikiTree]',
    web:                    '[Web]',
  };

  const RESPONSE_SCHEMA = {
    type: 'object',
    properties: {
      name:      { type: 'string' },
      dates:     { type: 'string' },
      biography: { type: 'string' },
      citations: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            n:           { type: 'integer' },
            description: { type: 'string' },
            url:         { type: 'string' },
          },
          required: ['n', 'description', 'url'],
        },
      },
      location: { type: 'string' },
    },
    required: ['name', 'dates', 'biography', 'citations', 'location'],
  };

  // Numbered sources: search results first, Wikipedia article(s) appended.
  // wikipediaSummary may be a single object or an array (multi-person stones).
  const allSources = [...searchResults];
  const wikiSummaries = Array.isArray(wikipediaSummary)
    ? wikipediaSummary.filter(Boolean)
    : (wikipediaSummary ? [wikipediaSummary] : []);
  const searchContext = allSources.length > 0 || wikiSummaries.length > 0
    ? 'Web research found (numbered sources — use [N] markers in the biography to cite specific claims):\n' +
      allSources.map((r, i) => `[${i + 1}] ${TYPE_LABELS[r.source_type] || '[Web]'} ${r.title}: ${r.content}`).join('\n') +
      wikiSummaries.map((ws, j) => `\n[${allSources.length + j + 1}] [Wikipedia article] ${ws.title}: ${ws.extract}`).join('')
    : 'No additional web results found.';

  const corroborationContext = _buildCorroborationSummary(graveData, searchResults, wikiData, wikidataResult);

  // wikiData may be an array (multi-person stones with one WikiTree result per person)
  const wikiDataItems = Array.isArray(wikiData) ? wikiData.filter(Boolean) : (wikiData ? [wikiData] : []);
  const wikiContext = wikiDataItems.length > 0
    ? wikiDataItems.map((wd, i) =>
        wikiDataItems.length > 1
          ? `WikiTree genealogy record (person ${i + 1}): ${JSON.stringify(wd)}`
          : `WikiTree genealogy record found: ${JSON.stringify(wd)}`
      ).join('\n')
    : 'No WikiTree record found.';

  const wikidataContext = wikidataResult
    ? `Wikidata record: burial place "${wikidataResult.burialPlaceLabel || 'unknown'}", birth ${wikidataResult.birthDate || '?'}, death ${wikidataResult.deathDate || '?'}.`
    : '';

  const locationContext = location ? `Cemetery location: ${location}` : 'Cemetery location: unknown — infer from research results if possible.';

  const isMultiSubject = graveData.multiple_subjects === true && (graveData.names?.length > 1);
  const multiSubjectBlock = isMultiSubject
    ? `\nMULTIPLE PEOPLE ON THIS STONE: This memorial commemorates ${graveData.names.join(' and ')}. You MUST write a combined biography that gives each person meaningful, proportional coverage — do not focus exclusively on the most notable or primary subject. Weave their stories together and, where the stone or research reveals their relationship (e.g. grandmother and granddaughter, husband and wife), honour that connection explicitly.\n`
    : '';

  const prompt = `You are GraveStory AI, a careful historian writing a respectful life history.
Accuracy and dignity matter more than length or eloquence. Write only from the gravestone data and the numbered sources below. Do not use facts from memory or general knowledge unless a numbered source supports them. Never fabricate facts, relationships, events, or characterizations. A short, honest biography builds trust; an invented one destroys it.

GRAVESTONE DATA:
${JSON.stringify(graveData, null, 2)}
${multiSubjectBlock}
${locationContext}

${searchContext}

${wikiContext}
${wikidataContext ? '\n' + wikidataContext : ''}
${corroborationContext ? '\n' + corroborationContext : ''}

LENGTH — follow the evidence, do not pad to a target:
- Stone only, or a single weak/uncorroborated source: 1–2 short paragraphs.
- Two corroborating sources: 2–4 paragraphs.
- Three or more independent sources: a full biography, up to ~1000 words.

WRITE A BIOGRAPHY THAT:
- Opens with the full name(s), birth/death dates, and the era they lived in
- Sets historical and local context for their lifetime — only at a depth the sources support; do not pad with generic background
- Weaves in verified details of family, marriage, faith, community, and relationships
- Explains any symbols on the stone by their conventional meaning in that era and region — e.g. an anchor often signified hope or a maritime life; a Masonic square-and-compass indicated Freemasonry membership; clasped hands often marked marriage or farewell. Describe what the symbol conventionally meant; do not assert it as fact about this individual's beliefs or inner life
- Reflects on the inscription with restraint and humanity — let the feeling come from the facts, not from added sentiment
${isMultiSubject ? '- Devotes proportional space to each person on the stone, weaves their stories together, and closes with a brief reflection on their shared legacy and relationship' : ''}

SURNAME / IDENTITY:
- You may note that a surname is commonly associated with a cultural heritage, but do not infer anything about this person's ancestry or experience from their name alone
- If "family_name" is empty, null, or missing, do not discuss surname heritage at all — any surname elsewhere belongs to a relative, not the deceased
- If "name_confidence" is "low", hedge identity ("the stone appears to commemorate…") and suppress all surname-heritage discussion

CONFLICTING SOURCES:
- For vital dates, prefer the stone. Surface the discrepancy in the text rather than silently choosing — e.g. "an obituary records 1896, though the stone reads 1895"

WELL-DOCUMENTED HISTORICAL FIGURES (narrow exception):
- A figure of major historical significance earns a fuller biography only when all of the following hold:
    (1) graveData birth/death dates are within ±5 years of the famous figure's actual dates
    (2) A [Wikipedia] article confirming the same person is present in the numbered sources above
    (3) Every claim in the fuller biography is supported by a numbered source with an [N] marker
- If any condition fails — including no Wikipedia article being present in the numbered sources — write the short source-grounded biography. Memory is not a source. A fabricated famous figure is worse than a brief accurate one.

CITATIONS:
- After each specific factual claim drawn from a numbered source, append the source number: "Buried at Lake View Cemetery [2]." Multiple: "[2][4]"
- Cite only claims the numbered source actually supports. If no source supports a claim, remove the claim — never invent a citation
- Do not cite inscription claims; the stone is shown to the reader directly
- Prefer [BillionGraves] and [Chronicling America] over [Web] when both apply

BURIAL LOCATION (the "location" output field):
- This is where the body lies, not where the person was born, lived, died, or was famous
- Format: "Cemetery Name, City, State/Country" — empty string if undeterminable
- Do not substitute birth place or death place for burial location
- For well-known figures, prefer the burial location confirmed by a numbered source over ambiguous search snippets about where they lived or died

For each [N] marker used, include a matching entry in the "citations" output array with its number (n), a short description, and the source URL. Name field: when multiple_subjects is false, use primary_name only — do not join aliases or pen names with " & " (e.g. if the stone lists both "Samuel Langhorne Clemens" and "Mark Twain", the name field should be "Mark Twain" — use whichever form is most widely recognised). When multiple_subjects is true, join all subjects with " & ". Dates field: separate with " · " for multiple people.`;

  const { data } = await geminiCallWithFallback({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 8000,
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA,
    }
  });
  if (data.error) throw new Error(data.error.message);

  const text = data.candidates[0].content.parts[0].text;
  console.log('BIOGRAPHY RAW:', text);
  const parsed = safeParseJSON(text, null);
  if (parsed && parsed.biography) return _validateCitations(parsed);

  return {
    name: graveData.primary_name || graveData.names?.[0] || 'Unknown',
    dates: (graveData.birth_date && graveData.death_date) ? 'born ' + graveData.birth_date + ' — died ' + graveData.death_date : '',
    biography: 'This stone marks the life of ' + (graveData.primary_name || graveData.names?.[0] || 'an individual') +
      (graveData.birth_date ? ', born ' + graveData.birth_date : '') +
      (graveData.death_date ? ' and passed ' + graveData.death_date : '') +
      '. ' + (graveData.inscription ? 'Their stone bears the words: "' + graveData.inscription + '".' : '') +
      ' Though we could not gather more details at this time, every life leaves an indelible mark on the world.',
    sources: ['Gravestone inscription (primary source)'],
    source_urls: ['']
  };
}
