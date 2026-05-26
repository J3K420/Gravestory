// biography.js — Generate biographical narrative via Gemini (extracted Stage 4)

// ── GEMINI: GENERATE BIOGRAPHY ───────────────────────────────────
async function generateBiography(graveData, searchResults, wikiData, location) {
  // Confidence floor — the single biggest hallucination vector is asking the
  // model to write a rich biography when there is nothing to write FROM. If no
  // web results and no WikiTree record came back, do not call the LLM at all:
  // return a short biography drawn strictly from the stone itself. The model
  // cannot invent a life it was never asked to narrate.
  const hasRealSources = (searchResults && searchResults.length > 0) || (wikiData != null);
  if (!hasRealSources) {
    console.log('📜 No real sources — returning stone-only biography, skipping LLM.');
    const who = graveData.primary_name || graveData.names?.[0] || 'an individual';
    const bday = graveData.birth_date ? `, born ${graveData.birth_date}` : '';
    const dday = graveData.death_date ? ` and passed ${graveData.death_date}` : '';
    const insc = graveData.inscription
      ? ` Their stone bears the words: "${graveData.inscription}".`
      : '';
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
      location: location || ''
    };
  }

  // Surface source_type so the model can preferentially cite verified
  // transcriptions and public-domain records over generic web results.
  const TYPE_LABELS = {
    verified_transcription: '[BillionGraves — GPS-verified transcription]',
    public_domain:          '[Chronicling America — public-domain newspaper]',
    memorial:               '[Find A Grave memorial]',
    obituary:               '[Obituary]',
    web:                    '[Web]'
  };
  const searchContext = searchResults.length > 0
    ? 'Web research found (numbered sources — use [N] markers in the biography to cite specific claims):\n' +
      searchResults.map((r, i) =>
        `[${i + 1}] ${TYPE_LABELS[r.source_type] || '[Web]'} ${r.title}: ${r.content}`
      ).join('\n')
    : 'No additional web results found.';

  const wikiContext = wikiData
    ? `WikiTree genealogy record found: ${JSON.stringify(wikiData)}`
    : 'No WikiTree record found.';

  const locationContext = location ? `Cemetery location: ${location}` : 'Cemetery location: unknown — infer from research results if possible.';

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
- Deeply analyzes symbols on the stone — religious imagery (crosses, Divine Mercy, etc.), military emblems, fraternal symbols, and floral carvings all reveal character and belief
- If the surname has a well-documented cultural origin, you MAY note that names of this kind are commonly associated with that heritage — but do NOT assert anything about this individual's own background, ancestry, or experiences on the basis of their name. ADDITIONALLY: if "family_name" in the gravestone data is empty, null, or missing, do NOT discuss surname heritage at all — any surname elsewhere in the data (in the inscription, names array, or research results) belongs to a relative, not the deceased, and cannot be used to infer the deceased's heritage.
- When sources are limited, write a SHORTER biography grounded only in what the stone itself and the verified sources actually state — do not extrapolate, speculate, or pad with general historical background to reach a length target
- Reflects on the inscription or epitaph with depth and compassion
- If multiple people share the stone, weaves their stories together meaningfully
- Closes with a warm, dignified reflection on their shared legacy
- If an inscription seems unusual or sad, approaches it with extra warmth and humanity
- Length should follow the evidence: a well-documented life earns a full biography; a sparsely-documented one gets a short, honest one. A brief accurate account builds trust; an invented one destroys it. Never fabricate facts, relationships, events, or characterizations that the sources do not support

CITATIONS — required when sources are present:
- After EACH specific factual claim drawn from a numbered source above, append the bracketed source number, e.g. "Lee was buried at Lake View Cemetery in Seattle [2]." Multiple sources for one claim: "[2][4]"
- Cite ONLY claims actually supported by that numbered source — do not attach a citation to a sentence the source does not back up
- Do NOT cite gravestone-inscription claims (the stone is shown to the reader directly); cite only claims that came from research
- Prefer citing [BillionGraves — GPS-verified transcription] and [Chronicling America — public-domain newspaper] sources when they support a claim; they are higher-credibility than generic web
- If no numbered source supports a claim, do NOT invent a citation — and consider whether the claim itself should be removed

For the location field: this MUST be the BURIAL location — where the body lies — NOT where the person was born, lived, died, or was famous. These are often different places. For example: Bruce Lee died in Hong Kong but is buried at Lake View Cemetery in Seattle, Washington. Marilyn Monroe died in Los Angeles and is buried at Westwood Village Memorial Park in Los Angeles — same city. Napoleon died on St. Helena but is buried at Les Invalides in Paris. Always read the research results carefully for words like "buried", "interred", "laid to rest", "grave at", "final resting place", or a cemetery name — these signal burial location. Words like "died in", "born in", "passed away in", or "lived in" are NOT burial location signals. IMPORTANT: if this person is a well-known historical or public figure whose burial place is common knowledge, trust your own knowledge of where they are buried OVER ambiguous search snippets that emphasize their birthplace or deathplace. Search results often over-represent where someone lived or died because that's where most articles about them are written. If a GPS location was provided above, use it exactly. Format as: "Cemetery Name, City, State/Country" (e.g. "St. Casimir Cemetery, Baldwin, Pennsylvania" or "Lake View Cemetery, Seattle, Washington"). For famous figures buried on estates, use the specific tomb/vault name. If the research clearly identifies a burial cemetery, use it. If only a city/region is mentioned as burial place, format as "Cemetery near City, State". If burial location cannot be determined from research, leave it empty — do NOT substitute the death or birth place.

Return ONLY valid JSON with these exact fields:
{
  "name": "full name",
  "dates": "born [date] — died [date]",
  "biography": "biography text with [N] citation markers inline, paragraphs separated by \\n\\n",
  "sources": ["description for [1]", "description for [2]", "..."],
  "source_urls": ["url for [1]", "url for [2]", "..."],
  "location": "Cemetery Name, City, State — as specific as possible, empty string if unknown"
}

CRITICAL: the "sources" and "source_urls" arrays MUST be index-aligned to the [N] markers used in the biography. sources[0] / source_urls[0] is what "[1]" in the text points to, sources[1] / source_urls[1] is "[2]", and so on. Only include sources you actually cited with a marker. If no citations were used (e.g. nothing in the biography came from web research), return empty arrays for both.`;

  const { data } = await geminiCallWithFallback({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.1, maxOutputTokens: 8000 }
  });
  if (data.error) throw new Error(data.error.message);

  const text = data.candidates[0].content.parts[0].text;
  console.log('BIOGRAPHY RAW:', text);
  const parsed = safeParseJSON(text, null);
  if (parsed && parsed.biography) return parsed;
  // Build basic story from gravestone data if AI response failed
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
