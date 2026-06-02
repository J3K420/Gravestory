import { PROXY_BASE } from './config';
import { safeParseJSON } from './util-json';

const PRIMARY  = 'gemini-3.1-flash-lite';
const FALLBACK = 'gemini-2.5-flash';

async function geminiText(payload) {
  const init = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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

export async function generateBiography(graveData, searchResults, wikiData, location) {
  const hasRealSources = (searchResults && searchResults.length > 0) || (wikiData != null);
  if (!hasRealSources) {
    const who = graveData.primary_name || graveData.names?.[0] || 'an individual';
    const bday = graveData.birth_date ? `, born ${graveData.birth_date}` : '';
    const dday = graveData.death_date ? ` and passed ${graveData.death_date}` : '';
    const insc = graveData.inscription ? ` Their stone bears the words: "${graveData.inscription}".` : '';
    return {
      name: graveData.primary_name || graveData.names?.[0] || 'Unknown',
      dates: (graveData.birth_date && graveData.death_date)
        ? `born ${graveData.birth_date} — died ${graveData.death_date}` : '',
      biography:
        `This stone marks the life of ${who}${bday}${dday}.${insc} ` +
        `Beyond what the stone itself records, the available sources do not ` +
        `yield further verifiable details about this person. What endures here ` +
        `is the marker they were given and the words chosen to remember them.`,
      sources: ['Gravestone inscription (primary source)'],
      source_urls: [''],
      location: location || '',
    };
  }

  const TYPE_LABELS = {
    verified_transcription: '[BillionGraves — GPS-verified transcription]',
    public_domain:          '[Chronicling America — public-domain newspaper]',
    memorial:               '[Find A Grave memorial]',
    obituary:               '[Obituary]',
    web:                    '[Web]',
  };
  const searchContext = searchResults.length > 0
    ? 'Web research found (numbered sources — use [N] markers in the biography to cite specific claims):\n' +
      searchResults.map((r, i) => `[${i + 1}] ${TYPE_LABELS[r.source_type] || '[Web]'} ${r.title}: ${r.content}`).join('\n')
    : 'No additional web results found.';

  const wikiContext = wikiData
    ? `WikiTree genealogy record found: ${JSON.stringify(wikiData)}`
    : 'No WikiTree record found.';

  const locationContext = location
    ? `Cemetery location: ${location}`
    : 'Cemetery location: unknown — infer from research results if possible.';

  const prompt = `You are GraveStory AI, a compassionate and thoughtful historian. Using the gravestone data and research below, write a respectful, moving life history for this person.

GRAVESTONE DATA:
${JSON.stringify(graveData, null, 2)}

${locationContext}

${searchContext}

${wikiContext}

Write a biography that (aim for up to ~500 words when the sources genuinely support it, much shorter when they do not):
- Opens with the full name(s), birth and death dates, and a vivid sense of the era they lived in
- Paints a picture of their world — historical events, cultural shifts, and local context of their lifetime
- Weaves in known details about family, marriage, faith, community, or relationships
- Deeply analyzes symbols on the stone — religious imagery, military emblems, fraternal symbols, and floral carvings all reveal character and belief
- If the surname has a well-documented cultural origin, you MAY note that names of this kind are commonly associated with that heritage — but do NOT assert anything about this individual's own background on the basis of their name. ADDITIONALLY: if "family_name" in the gravestone data is empty, null, or missing, do NOT discuss surname heritage at all.
- When sources are limited, write a SHORTER biography grounded only in what the stone itself and the verified sources actually state
- **EXCEPTION — well-documented historical figures**: If the gravestone data, inscription, or search results unambiguously identify a person of major historical significance (a head of state, president, monarch, general, or other figure extensively documented in historical record), you MUST write a full, rich biography drawing on well-established historical facts. Cite such facts as '[Historical record]' in the sources list. The anti-fabrication rule protects private individuals — it does NOT mean minimal coverage for George Washington or Abraham Lincoln. A two-paragraph biography for a founding father is a failure.
- Reflects on the inscription or epitaph with depth and compassion
- Length should follow the evidence: a well-documented life earns a full biography; a sparsely-documented one gets a short, honest one. Never fabricate facts about private individuals.

CITATIONS — required when sources are present:
- After EACH specific factual claim drawn from a numbered source above, append the bracketed source number, e.g. "Lee was buried at Lake View Cemetery [2]."
- Cite ONLY claims actually supported by that numbered source
- Do NOT cite gravestone-inscription claims
- If no numbered source supports a claim, do NOT invent a citation

For the location field: this MUST be the BURIAL location — where the body lies — NOT where the person was born, lived, or died. Read research results carefully for words like "buried", "interred", "laid to rest", "grave at", "final resting place". Format as: "Cemetery Name, City, State/Country". If burial location cannot be determined, leave it empty.

Return ONLY valid JSON with these exact fields:
{
  "name": "full name",
  "dates": "born [date] — died [date]",
  "biography": "biography text with [N] citation markers inline, paragraphs separated by \\n\\n",
  "sources": ["description for [1]", "description for [2]", "..."],
  "source_urls": ["url for [1]", "url for [2]", "..."],
  "location": "Cemetery Name, City, State — as specific as possible, empty string if unknown"
}

The "sources" and "source_urls" arrays MUST be index-aligned to the [N] markers used. Only include sources you actually cited.`;

  const data = await geminiText({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.1, maxOutputTokens: 8000 },
  });
  if (data.error) throw new Error(data.error.message);

  const text = data.candidates[0].content.parts[0].text;
  console.warn('BIOGRAPHY length:', text.length, 'chars');
  const parsed = safeParseJSON(text, null);
  if (parsed?.biography) return parsed;

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
