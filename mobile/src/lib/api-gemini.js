import { PROXY_BASE } from './config';
import { safeParseJSON } from './util-json';

const PRIMARY  = 'gemini-3.1-flash-lite';
const FALLBACK = 'gemini-2.5-flash';

async function geminiCallWithFallback(payload) {
  const init = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  };

  const shouldFallback = (res, data) => {
    if (res && (res.status === 503 || res.status === 429)) return true;
    if (data?.error) {
      const msg = (data.error.message || '').toLowerCase();
      const code = data.error.code;
      if (code === 503 || code === 429) return true;
      if (msg.includes('overload') || msg.includes('unavailable') ||
          msg.includes('high demand') || msg.includes('try again later')) return true;
    }
    return false;
  };

  try {
    const res = await fetch(`${PROXY_BASE}/gemini/${PRIMARY}`, init);
    const data = await res.json().catch(() => ({ error: { message: 'Invalid JSON' } }));
    if (!shouldFallback(res, data)) return { data, model: PRIMARY };
  } catch (err) {
    console.log(`Primary fetch failed (${err.message}) — falling back`);
  }

  const res2 = await fetch(`${PROXY_BASE}/gemini/${FALLBACK}`, init);
  const data2 = await res2.json().catch(() => ({ error: { message: 'Invalid JSON from fallback' } }));
  return { data: data2, model: FALLBACK };
}

export async function verifyIsGravestone(base64) {
  const prompt = `Look at this image and decide whether it contains a gravestone, headstone, grave marker, memorial plaque, or cemetery monument.

A gravestone may be:
- An upright headstone with inscribed text and dates
- A flat ground-level marker or plaque
- A weathered, broken, or partially-buried stone
- A tomb, mausoleum exterior, or memorial monument
- A photo taken at any angle, in any lighting, including low-quality phone photos

Do NOT reject for:
- Poor lighting, blur, or partial framing — if a gravestone is visible, accept it
- Weathered or illegible text — the stone itself is still what's being photographed
- The presence of grass, flowers, leaves, or other cemetery surroundings

DO reject if the photo is clearly something else:
- A selfie or photo of a living person
- A screenshot of text, a website, or an app
- A pet, plant, food, or object unrelated to memorialization
- A landscape, building interior, or street scene with no grave marker visible

Return ONLY a valid JSON object with these exact fields:
{
  "is_gravestone": true or false,
  "confidence": "high" or "medium" or "low",
  "reason": "one short sentence describing what is in the image"
}

Return only JSON.`;

  const { data } = await geminiCallWithFallback({
    contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: 'image/jpeg', data: base64 } }] }],
    generationConfig: { temperature: 0.1 },
  });

  if (data.error) {
    console.warn('Gravestone verification failed — proceeding anyway:', data.error.message);
    return;
  }

  const text = data.candidates[0].content.parts[0].text;
  const parsed = safeParseJSON(text, { is_gravestone: true, confidence: 'low', reason: '' });
  console.warn('VERIFY:', JSON.stringify(parsed));

  if (parsed.is_gravestone === false) {
    const err = new Error('Image does not appear to contain a gravestone');
    err.__verificationRejection = true;
    err.reason = parsed.reason || 'The image does not appear to contain a gravestone.';
    throw err;
  }
}

export async function readGravestone(base64, location) {
  const locationHint = location ? `This gravestone is located near: ${location}.` : '';

  const prompt = `You are an expert gravestone reader. Carefully examine this gravestone image and extract ALL visible text and symbols.

${locationHint}

CRITICAL — DECEASED vs RELATIONS:
Many gravestones name people other than the deceased. The deceased is the person buried under this stone — usually identified by their name plus a birth/death date or "AT REST" phrase. Other names on the stone are often spouses, parents, or children mentioned in relational phrases.

Watch for relational phrases like:
- "Beloved Husband of [Name]"
- "Beloved Wife of [Name]"
- "Mother of [Name]" / "Father of [Name]" / "Son of" / "Daughter of"
- "In Memory of [Name], wife of [Name]"

In these cases, the [Name] inside the relational phrase is NOT the deceased — it is a relative. The surname in such a phrase belongs to the relative, not necessarily to the deceased.

EXAMPLE: A stone reading "GEORGE / Beloved Husband of / LIZZIE KNUVER / 1841-1900" means:
- Deceased: George (first name only — his surname is NOT shown on this stone)
- Relation: Lizzie Knuver (his wife, surname Knuver)
- primary_name should be "George" — do NOT fabricate a surname for him
- family_name should be empty or null — his surname is not visible
- The full inscription should preserve "Beloved Husband of Lizzie Knuver" verbatim

If the only surname on the stone appears inside a relational phrase, assume it belongs to the relative unless other evidence (e.g. a family plot header, a separate surname banner above the inscription) clearly attaches it to the deceased.

Return ONLY a valid JSON object with these exact fields:
{
  "names": ["every name visible on the stone, with role if relational, e.g. 'George (deceased)', 'Lizzie Knuver (wife)'"],
  "primary_name": "the deceased's name as shown on the stone — may be first-name-only if no surname is visible for them",
  "birth_date": "date or year if visible",
  "death_date": "date or year if visible",
  "married_date": "if visible",
  "inscription": "the full epitaph/quote/relational text VERBATIM — preserve all surnames that appear inside relational phrases",
  "symbols": ["list of symbols, emblems, or decorations — be specific: 'GAR Grand Army of the Republic emblem', 'Masonic square and compass', 'Odd Fellows three links', etc."],
  "family_name": "the deceased's surname ONLY IF it is clearly theirs (e.g. shown as a standalone surname banner, or in a family plot context). Leave empty/null if the only surname on the stone appears inside a relational phrase about someone else.",
  "name_confidence": "high if the name is clearly legible, medium if partially weathered or ambiguous, low if significantly uncertain",
  "alternate_names": ["if name_confidence is medium or low, list 1-2 plausible alternate readings of primary_name due to weathering or OCR ambiguity — otherwise empty array"],
  "multiple_subjects": "true if this photo clearly shows multiple SEPARATE, DISTINCT gravestones or memorial markers in the same frame (not a single shared family stone) — false otherwise",
  "notes": "any other text, observations, or ambiguity flags"
}

If multiple deceased people share the stone, use the names array and pick the most prominent as primary_name. Return only JSON.`;

  const { data } = await geminiCallWithFallback({
    contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: 'image/jpeg', data: base64 } }] }],
    generationConfig: { temperature: 0.1 },
  });
  if (data.error) throw new Error(data.error.message);

  const text = data.candidates[0].content.parts[0].text;
  console.warn('GRAVESTONE RAW:', text.slice(0, 300));
  return safeParseJSON(text, {
    names: [], primary_name: 'Unknown', birth_date: '', death_date: '',
    inscription: '', symbols: [], family_name: '', notes: '',
    name_confidence: 'high', alternate_names: [], multiple_subjects: false,
  });
}
