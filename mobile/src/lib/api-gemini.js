import { PROXY_BASE, CLIENT_KEY } from './config';
import { safeParseJSON } from './util-json';

const PRIMARY  = 'gemini-2.5-flash-lite';
const FALLBACK = 'gemini-2.5-flash';
const TIMEOUT_MS = 30000;

function fetchWithTimeout(url, init) {
  return Promise.race([
    fetch(url, init),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Gemini request timed out')), TIMEOUT_MS)
    ),
  ]);
}

// Handles both Gemini error objects ({ message, code, status }) and
// Worker string errors ({ error: 'Forbidden' }) so callers always get a string.
function extractErrMsg(dataError) {
  if (!dataError) return '';
  if (typeof dataError === 'string') return dataError;
  return dataError.message || dataError.status || dataError.detail || JSON.stringify(dataError);
}

async function geminiCallWithFallback(payload) {
  const init = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Client-Key': CLIENT_KEY },
    body: JSON.stringify(payload),
  };

  const shouldFallback = (res, data) => {
    if (res && (res.status === 503 || res.status === 429)) return true;
    // Only inspect nested Gemini error objects — Worker string errors never trigger fallback
    if (data?.error && typeof data.error === 'object') {
      const msg = (data.error.message || '').toLowerCase();
      const code = data.error.code;
      // 404 = model not found on Gemini → try fallback model
      if (code === 503 || code === 429 || code === 404) return true;
      if (msg.includes('overload') || msg.includes('unavailable') ||
          msg.includes('high demand') || msg.includes('try again later') ||
          msg.includes('not found')) return true;
    }
    return false;
  };

  try {
    const res = await fetchWithTimeout(`${PROXY_BASE}/gemini/${PRIMARY}`, init);
    const data = await res.json().catch(() => ({ error: { message: 'Invalid JSON' } }));
    if (!shouldFallback(res, data)) return { data, model: PRIMARY };
  } catch (err) {
    console.warn(`Primary fetch failed (${err.message}) — falling back`);
  }

  const res2 = await fetchWithTimeout(`${PROXY_BASE}/gemini/${FALLBACK}`, init);
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
    console.warn('verifyIsGravestone error — proceeding anyway. Response:', JSON.stringify(data));
    return;
  }

  const text = data.candidates[0].content.parts[0].text;
  const parsed = safeParseJSON(text, { is_gravestone: true, confidence: 'low', reason: '' });

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
  "subjects": [{"name": "a deceased person commemorated on this stone", "birth_date": "their birth date/year if shown, else empty", "death_date": "their death date/year if shown, else empty"}],
  "notes": "any other text, observations, or ambiguity flags"
}

SUBJECTS ARRAY — IMPORTANT:
Populate "subjects" with one entry for EACH DECEASED person commemorated on this stone, each with their OWN birth/death dates exactly as shown beside their name. A single shared family stone often commemorates more than one deceased person (e.g. a grandmother AND a granddaughter, each with separate dates) — list each as a separate entry with their individual dates. Exclude living relatives who are named only inside relational phrases ("beloved wife of", "devoted family", lists of survivors) — those are not the deceased. List each deceased person only ONCE: if a single deceased person is known by more than one name or an alias (e.g. a birth name and a stage/pen name), merge them into a single entry using their most recognised name — do NOT create separate entries for the same person. For a stone with one deceased person, return a single entry. This per-person date breakdown matters: top-level birth_date/death_date may reflect only one person, but each subject's own dates must be captured here.

If multiple deceased people share the stone, use the names array and pick the most prominent as primary_name, and list every deceased person with their own dates in subjects. Return only JSON.`;

  const { data } = await geminiCallWithFallback({
    contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: 'image/jpeg', data: base64 } }] }],
    generationConfig: { temperature: 0.1 },
  });
  if (data.error) {
    console.warn('readGravestone API error. Full response:', JSON.stringify(data));
    throw new Error(extractErrMsg(data.error) || 'Gemini API error');
  }

  const text = data.candidates[0].content.parts[0].text;
  return safeParseJSON(text, {
    names: [], primary_name: 'Unknown', birth_date: '', death_date: '',
    inscription: '', symbols: [], family_name: '', notes: '',
    name_confidence: 'high', alternate_names: [], multiple_subjects: false, subjects: [],
  });
}
