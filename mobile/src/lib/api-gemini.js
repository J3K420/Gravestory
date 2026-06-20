import { PROXY_BASE, CLIENT_KEY } from './config';
import { safeParseJSON } from './util-json';
import { SYMBOL_CONTEXT } from './biography';

const PRIMARY  = 'gemini-3.1-flash-lite';
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

RELATIONSHIPS & MAIDEN NAMES — these are the best disambiguators on a stone, so capture them precisely:
- When a relational phrase names a relative ("beloved wife of John Doe", "son of...", "daughter of..."), record it in the "relationships" array with the relation type and the relative's name.
- When the inscription reveals a married woman's birth/maiden surname ("née Brown", "born Smith", "Mary (Brown) Jones"), put that surname in "maiden_name".

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
  "maiden_name": "the deceased's birth/maiden surname if the inscription reveals it — e.g. 'née Brown', 'born Smith', or a married woman shown as 'Mary Jones, daughter of the Brown family'. Genealogy records index married women under their maiden name, so capture it whenever shown. Empty/null if not indicated.",
  "relationships": [{"relation": "spouse|father|mother|son|daughter|sibling", "name": "the related person's full name as written"}],
  "name_confidence": "high if the name is clearly legible, medium if partially weathered or ambiguous, low if significantly uncertain",
  "alternate_names": ["if name_confidence is medium or low, list 1-2 plausible alternate readings of primary_name due to weathering or OCR ambiguity — otherwise empty array"],
  "multiple_subjects": "true ONLY when the camera frame physically contains two or more completely separate, freestanding gravestones or grave markers at distinct locations — for example, two separate upright headstones for different people placed at different graves. A SINGLE unified monument, slab, or plaque that honours multiple people buried together at the same grave (even if it lists each person's individual birth/death dates, such as a grandmother and granddaughter interred together) is NOT multiple_subjects — return false. If you are not certain that the markers are physically separate objects at separate graves, return false.",
  "subjects": [{"name": "full name of every deceased person visible anywhere in this photo (from any stone or plaque in the frame)", "birth_date": "their birth date/year exactly as shown beside their own name, else empty", "death_date": "their death date/year exactly as shown beside their own name, else empty"}],
  "notes": "any other text, observations, or ambiguity flags"
}

SUBJECTS ARRAY — IMPORTANT:
Populate "subjects" with one entry for EVERY DECEASED person visible anywhere in the photo frame — regardless of whether multiple_subjects is true or false. If multiple_subjects is true (separate physical stones visible), still include every deceased person from every stone visible. A single shared family stone often commemorates more than one deceased person (e.g. a grandmother AND a granddaughter, each with separate dates) — list each as a separate entry with their individual dates. Exclude living relatives who are named only inside relational phrases ("beloved wife of", "devoted family", lists of survivors) — those are not the deceased. List each deceased person only ONCE: if a single deceased person is known by more than one name or an alias (e.g. a birth name and a stage/pen name), merge them into a single entry using their most recognised name — do NOT create separate entries for the same person. For a stone with one deceased person, return a single entry. This per-person date breakdown matters: top-level birth_date/death_date may reflect only one person, but each subject's own dates must be captured here.

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
    inscription: '', symbols: [], family_name: '', maiden_name: '', relationships: [], notes: '',
    name_confidence: 'high', alternate_names: [], multiple_subjects: false, subjects: [],
  });
}

// True when the static SYMBOL_CONTEXT table already explains this symbol
// (substring match against curated keys — same logic as buildSymbolContext).
// Mirrors web's lookupSymbolMeaning(symbol, null) === null coverage check.
function tableCoversSymbol(symbol) {
  const lower = symbol.toLowerCase();
  return Object.keys(SYMBOL_CONTEXT).some(k => lower.includes(k));
}

// ── GEMINI: RESOLVE UNKNOWN SYMBOL MEANINGS ──────────────────────
// For symbols the static SYMBOL_CONTEXT table does NOT cover, ask Gemini once
// (a single batched call) for each symbol's conventional funerary/cultural
// meaning, so the result screen can show a tappable explanation chip for it.
//
// Trust discipline (matches the bio pipeline's "memory is not a source"): the
// model is told to return null for any symbol with no established meaning rather
// than guess — those stay non-tappable. Returns a { "<symbol>": "<meaning>" }
// map containing ONLY confidently-explained symbols (omits nulls). Non-fatal:
// any error/empty returns {} so the scan is never blocked or failed by this.
// Does NOT touch the scan-limit gate — it's part of the bio, not a billable scan.
export async function resolveSymbolMeanings(symbols) {
  if (!Array.isArray(symbols) || symbols.length === 0) return {};

  const seen = new Set();
  const unknown = [];
  for (const s of symbols) {
    if (typeof s !== 'string' || !s.trim()) continue;
    const key = s.trim();
    const norm = key.toLowerCase();
    if (seen.has(norm)) continue;
    seen.add(norm);
    if (!tableCoversSymbol(key)) unknown.push(key);
  }
  if (unknown.length === 0) return {};

  const prompt = `You are an expert in gravestone iconography and funerary symbolism. For each symbol below — detected on a real gravestone — give its conventional funerary, religious, fraternal, or cultural meaning in 1-2 plain sentences a cemetery visitor would find illuminating.

CRITICAL RULES:
- Only explain symbols that have an ESTABLISHED, recognised meaning in gravestone/funerary, religious, fraternal, military, or occupational tradition.
- If a symbol has NO established conventional meaning, or you are not confident, or the description is too vague to identify a specific symbol, return null for it. DO NOT guess or invent a meaning. An honest null is better than a plausible-sounding fabrication.
- Do not repeat the symbol's name back as its meaning. Explain what it traditionally signifies.
- Keep each meaning self-contained and free of citation markers.

Return ONLY a JSON object whose keys are the EXACT symbol strings given below and whose values are the meaning string, or null. Example shape:
{ "sheaf of wheat": "A long life brought to fruition...", "scribble of unclear marks": null }

Symbols:
${unknown.map(s => `- ${s}`).join('\n')}

Return only JSON.`;

  try {
    const { data } = await geminiCallWithFallback({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.1, responseMimeType: 'application/json' },
    });
    if (!data || data.error || !data.candidates?.[0]?.content?.parts?.[0]?.text) return {};
    const parsed = safeParseJSON(data.candidates[0].content.parts[0].text, {});
    if (!parsed || typeof parsed !== 'object') return {};

    const out = {};
    const askedNorm = new Map(unknown.map(s => [s.toLowerCase(), s]));
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v !== 'string' || !v.trim()) continue;
      const canonical = askedNorm.get(String(k).toLowerCase());
      if (canonical) out[canonical] = v.trim();
    }
    return out;
  } catch (e) {
    console.warn('resolveSymbolMeanings failed (non-fatal):', e?.message || e);
    return {};
  }
}

// ── GEMINI: REDACT LIVING-RELATIVE NAMES FOR PUBLIC SHARING ───────
// Mirror of the web js/api-gemini.js function (keep in sync). When a user
// makes a story PUBLIC (it then appears on the community global map with a
// precise GPS pin), we must not re-identify or defame a LIVING person named
// in the bio prose. The deceased cannot be defamed; living relatives named in
// the prose ("survived by her son Michael Thompson") can.
//
// Fails SAFE: any named person NOT confirmed deceased by a death year is
// generalized to their relationship. The deceased subjects' names and story
// are preserved. On any hard error, returns the ORIGINAL biography so sharing
// never silently breaks (the report button is the backstop). `subjects` is
// the OCR subjects array (each {name, birth_date, death_date}) — names we keep.
// Non-billable; reuses geminiCallWithFallback.
export async function redactLivingNamesForPublic(biography, subjects) {
  if (typeof biography !== 'string' || !biography.trim()) return biography;

  // OCR subject shape is {name, birth_date, death_date}; derive a date hint
  // from those (subjects don't carry a `dates` field).
  const allowed = [];
  if (Array.isArray(subjects)) {
    for (const s of subjects) {
      if (s && typeof s.name === 'string' && s.name.trim()) {
        const d = [s.birth_date, s.death_date].filter(Boolean).join('–') || s.dates || '';
        allowed.push(`${s.name.trim()}${d ? ` (${d})` : ''}`);
      }
    }
  }

  const prompt = `You are preparing a biography for PUBLIC display on a map that anyone can see. The biography is about one or more DECEASED people, but its prose may also name OTHER people — spouses, children, parents, siblings — who could still be ALIVE. Naming a living private person publicly is a privacy and legal risk, so we must remove or generalize them.

THE DECEASED SUBJECT(S) OF THIS BIOGRAPHY — you MUST keep their names exactly as written:
${allowed.length ? allowed.map(n => `- ${n}`).join('\n') : '- (none explicitly listed — infer the subject from the text and keep that person\'s name)'}

YOUR TASK — rewrite the biography for public display following these rules EXACTLY:
1. Keep the deceased subject(s) named above fully intact — their names, dates, and entire story.
2. For ANY OTHER specific person named in the prose who is NOT one of the deceased subjects above and is NOT confirmed dead by an explicit death year in the text, REMOVE their proper name and replace it with their relationship only.
   - "survived by her son, Michael Thompson, of Atlanta" -> "survived by her son"
   - "married John Doe in 1952" -> keep ONLY if the text shows John Doe is also deceased (e.g. a death year); otherwise -> "married in 1952"
   - "her daughter Sarah and grandson Liam" -> "her daughter and grandson"
3. A person explicitly shown as deceased in the text (has a death year, is described as "the late", "predeceased", buried, etc.) is NOT living — keep their name.
4. If unsure whether a named relative is living or dead, treat them as LIVING and generalize the name. When in doubt, remove the name.
5. Do NOT add new facts, do NOT change the deceased's story, do NOT add disclaimers. Preserve paragraph breaks, tone, and any [N] citation markers exactly.
6. If the biography names no living relatives, return it essentially unchanged.

Return ONLY a JSON object: { "public_biography": "the rewritten text" }

BIOGRAPHY TO REWRITE:
${biography}

Return only JSON.`;

  try {
    const { data } = await geminiCallWithFallback({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.1, responseMimeType: 'application/json' }
    });
    if (!data || data.error || !data.candidates?.[0]?.content?.parts?.[0]?.text) return biography;
    const parsed = safeParseJSON(data.candidates[0].content.parts[0].text, {});
    const out = parsed && typeof parsed.public_biography === 'string' ? parsed.public_biography.trim() : '';
    return out.length >= 20 ? out : biography;
  } catch (e) {
    console.warn('redactLivingNamesForPublic failed (non-fatal, using original):', e?.message || e);
    return biography;
  }
}
