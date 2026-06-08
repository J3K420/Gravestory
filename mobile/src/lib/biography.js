import { PROXY_BASE, CLIENT_KEY } from './config';
import { safeParseJSON } from './util-json';

// Build a cross-source corroboration summary for the biography prompt.
// Detects name/date agreement and conflicts across WikiTree, Wikidata, FindAGrave,
// obituaries, BillionGraves, and Chronicling America so the model can cite with
// appropriate confidence instead of silently blending conflicting claims.
// wikidataResult: optional { birthDate, deathDate, burialPlaceLabel } from queryWikidata().
function buildCorroborationSummary(graveData, searchResults, wikiData, wikidataResult) {
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
function validateCitations(parsed) {
  if (!parsed?.biography) return parsed;
  const raw = (parsed.citations || []).filter(c => c && Number.isInteger(c.n) && c.n >= 1);
  const sorted = [...raw].sort((a, b) => a.n - b.n);

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

const PRIMARY  = 'gemini-3.1-flash-lite';
const FALLBACK = 'gemini-2.5-flash';

async function geminiText(payload) {
  const init = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Client-Key': CLIENT_KEY },
    body: JSON.stringify(payload),
  };
  try {
    const res = await fetch(`${PROXY_BASE}/gemini/${PRIMARY}`, init);
    const data = await res.json().catch(() => ({ error: {} }));
    if (res.status !== 503 && res.status !== 429 && !data.error) return data;
  } catch {}
  const res2 = await fetch(`${PROXY_BASE}/gemini/${FALLBACK}`, init);
  return res2.json().catch(() => ({ error: { message: 'Invalid JSON' } }));
}

// wikidataResult: optional result from queryWikidata() — structured dates + burial place.
export async function generateBiography(graveData, searchResults, wikiData, location, wikipediaSummary, wikidataResult) {
  const hasRealSources = (searchResults && searchResults.length > 0) || (wikiData != null) ||
    (Array.isArray(wikipediaSummary) ? wikipediaSummary.some(Boolean) : wikipediaSummary != null);
  if (!hasRealSources) {
    // Prefer the deceased-subjects list so a shared family stone with no web sources
    // still names every person, consistent with isMultiSubject elsewhere.
    const _fbSubs = Array.isArray(graveData.subjects) ? graveData.subjects.filter(s => s && s.name) : [];
    const allPeople = _fbSubs.length > 1 ? _fbSubs.map(s => s.name) : (graveData.names || []).filter(Boolean);
    const who = allPeople.length > 1
      ? allPeople.join(' and ')
      : (graveData.primary_name || allPeople[0] || 'an individual');
    const bday = graveData.birth_date ? `, born ${graveData.birth_date}` : '';
    const dday = graveData.death_date ? ` and passed ${graveData.death_date}` : '';
    const insc = graveData.inscription ? ` Their stone bears the words: "${graveData.inscription}".` : '';
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
      location: location || '',
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

  const corroborationContext = buildCorroborationSummary(graveData, searchResults, wikiData, wikidataResult);

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

  const locationContext = location
    ? `Cemetery location: ${location}`
    : 'Cemetery location: unknown — infer from research results if possible.';

  // Per-person deceased subjects with their own dates — more reliable than the single
  // top-level birth_date/death_date pair, which on a shared stone reflects only ONE person.
  const deceasedSubjects = Array.isArray(graveData.subjects) ? graveData.subjects.filter(s => s && s.name) : [];
  // A shared family stone (e.g. grandmother + granddaughter) is NOT "multiple_subjects"
  // by the OCR's narrow definition (separate physical stones), so also treat >1 deceased
  // subject as multi-subject — otherwise the second person is never given a biography.
  const isMultiSubject = deceasedSubjects.length > 1 || (graveData.multiple_subjects === true && (graveData.names?.length > 1));
  const subjectNames = deceasedSubjects.length > 1
    ? deceasedSubjects.map(s => s.name)
    : (graveData.names?.length ? graveData.names : []);
  const perSubjectDates = deceasedSubjects.length > 1
    ? '\nEach person\'s own dates as recorded on the stone:\n' +
      deceasedSubjects.map(s => `- ${s.name}: ${[s.birth_date, s.death_date].filter(Boolean).join(' – ') || 'dates not legible'}`).join('\n') + '\n'
    : '';
  // When one subject on a shared stone has a Wikipedia article, let them have the full
  // historical-figure word budget rather than splitting proportionally.
  const hasFamousSubject = isMultiSubject && wikiSummaries.length > 0;
  const multiSubjectBlock = isMultiSubject
    ? hasFamousSubject
      ? `\nMULTIPLE PEOPLE ON THIS STONE: This memorial commemorates ${subjectNames.join(' and ')}.${perSubjectDates}One of the numbered sources is labelled "[Wikipedia article]" — the subject whose name (or a common variant of it) matches that article title is the historically notable person on this stone. Do NOT judge significance by how many FindAGrave / WikiTree / Tavily records a person has — a Wikipedia article outweighs all of them. Write the historically notable subject's full biography FIRST (up to ~2500 words, all claims cited with [N] markers), then devote a respectful, dignified paragraph to the other person(s), honouring their memory and their relationship to the famous subject.\n`
      : `\nMULTIPLE PEOPLE ON THIS STONE: This memorial commemorates ${subjectNames.join(' and ')}.${perSubjectDates}You MUST write a combined biography that gives each person meaningful, proportional coverage — do not focus exclusively on the most notable or primary subject. Weave their stories together and, where the stone or research reveals their relationship (e.g. grandmother and granddaughter, husband and wife), honour that connection explicitly.\n`
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

LENGTH — scale to the evidence available:
- Stone only, or a single weak/uncorroborated source: 1–2 short paragraphs.
- Two corroborating sources: 2–4 paragraphs.
- Three or more independent sources: a full biography, up to ~1500 words.
- Well-documented historical figure (Wikipedia article confirmed in sources AND 3+ independent sources): write a comprehensive life history up to ~2500 words. Cover their early life and origins, career arc and major achievements, personal life and relationships, cultural impact, and legacy. Use the full allowance — do not stop at a surface summary when the sources support depth.
- Shared stone where one subject has a [Wikipedia article] in the numbered sources: THAT subject is the historical figure regardless of how many other sources they have — a Wikipedia article alone qualifies. Give them the full ~2500-word treatment (all claims cited), then add a respectful paragraph for the other person(s) honouring their memory and relationship.

WRITE A BIOGRAPHY THAT:
- Opens with the full name(s), birth/death dates, and the era they lived in
- Sets historical and local context for their lifetime — only at a depth the sources support; do not pad with generic background
- Weaves in verified details of family, marriage, faith, community, and relationships
- Explains any symbols on the stone by their conventional meaning in that era and region — e.g. an anchor often signified hope or a maritime life; a Masonic square-and-compass indicated Freemasonry membership; clasped hands often marked marriage or farewell. Describe what the symbol conventionally meant; do not assert it as fact about this individual's beliefs or inner life
- Reflects on the inscription with restraint and humanity — let the feeling come from the facts, not from added sentiment
${isMultiSubject ? (hasFamousSubject ? '- Identifies which subject has a [Wikipedia article] in the numbered sources, writes their full historical-figure biography first with all claims cited, then honours the other person(s) with a respectful paragraph acknowledging their relationship and shared memorial' : '- Devotes proportional space to each person on the stone, weaves their stories together, and closes with a brief reflection on their shared legacy and relationship') : ''}

SURNAME / IDENTITY:
- You may note that a surname is commonly associated with a cultural heritage, but do not infer anything about this person's ancestry or experience from their name alone
- If "family_name" is empty, null, or missing, do not discuss surname heritage at all — any surname elsewhere belongs to a relative, not the deceased
- If "name_confidence" is "low", hedge identity ("the stone appears to commemorate…") and suppress all surname-heritage discussion

CONFLICTING SOURCES:
- For vital dates, prefer the stone. Surface the discrepancy in the text rather than silently choosing — e.g. "an obituary records 1896, though the stone reads 1895"

WELL-DOCUMENTED HISTORICAL FIGURES (narrow exception):
- A figure of major historical significance earns a fuller biography only when all of the following hold:
    (1) The stone shows dates for THAT SPECIFIC PERSON — in the "subjects" array, the inscription text, or graveData.birth_date/death_date — within ±5 years of the famous figure's actual dates. On a shared or family stone, validate each candidate against THEIR OWN dates beside their name, never another person's. (Example: a stone commemorating a grandmother 1927–2006 AND her granddaughter 1983–2011 — validate the granddaughter against 1983–2011, not the grandmother's dates. The top-level birth_date/death_date may belong to a different person on the stone.)
    (2) A [Wikipedia] article confirming the same person is present in the numbered sources above
    (3) Every claim in the fuller biography is supported by a numbered source with an [N] marker
- These conditions are evaluated PER PERSON. On a shared stone, one subject may fully qualify for the historical-figure biography while another does not — give the qualifying subject the full treatment and the other a dignified, source-grounded paragraph honouring them and their relationship.
- If a person fails any condition — including no Wikipedia article confirming them in the numbered sources — write the short source-grounded biography for that person. A fabricated famous figure is worse than a brief accurate one.
- Once a person passes all conditions: you are AUTHORISED to draw on your knowledge of that historically documented figure's life to write the comprehensive biography. The [Wikipedia] article [N] is your authoritative anchor — cite it with [N] for every key claim about their biography, career, and legacy. You are NOT restricted to paraphrasing only the extract text. Use the full ~2500-word allowance: write about their early life and origins, career arc and major works, personal life and relationships, cultural impact, and lasting legacy. All claims must carry [N] markers, but use your knowledge of the person as the narrative backbone — the Wikipedia source authorises it.

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

For each [N] marker used, include a matching entry in the "citations" output array with its number (n), a short description, and the source URL. Name field: ${isMultiSubject ? `this stone commemorates more than one deceased person — join all of them with " & " (e.g. "${subjectNames.join(' & ')}"), and separate their dates with " · " in the dates field.` : `this stone commemorates ONE person — use primary_name only; do not join aliases or pen names with " & " (e.g. if the stone lists both "Samuel Langhorne Clemens" and "Mark Twain", the name field should be "Mark Twain" — use whichever form is most widely recognised).`}`;

  const data = await geminiText({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 8000,
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA,
    },
  });
  if (data.error) {
    const msg = typeof data.error === 'string' ? data.error : (data.error.message || data.error.status || JSON.stringify(data.error));
    throw new Error(msg || 'Gemini biography error');
  }

  const text = data.candidates[0].content.parts[0].text;
  const parsed = safeParseJSON(text, null);
  if (parsed?.biography) return validateCitations(parsed);

  const who = graveData.primary_name || graveData.names?.[0] || 'an individual';
  return {
    name: graveData.primary_name || graveData.names?.[0] || 'Unknown',
    dates: (graveData.birth_date && graveData.death_date)
      ? `born ${graveData.birth_date} — died ${graveData.death_date}` : '',
    biography:
      `This stone marks the life of ${who}` +
      (graveData.birth_date ? `, born ${graveData.birth_date}` : '') +
      (graveData.death_date ? ` and passed ${graveData.death_date}` : '') + '. ' +
      (graveData.inscription ? `Their stone bears the words: "${graveData.inscription}". ` : '') +
      'Though we could not gather more details at this time, every life leaves an indelible mark on the world.',
    sources: ['Gravestone inscription (primary source)'],
    source_urls: [''],
    location: location || '',
  };
}
