// js/api-gemini.js
// Gemini API client: image-aware calls via the Cloudflare proxy.
// Contains:
//   geminiCallWithFallback - primary/fallback model wrapper (3.1-flash-lite -> 2.5-flash)
//                            on HTTP 503/429, network errors, or overload responses.
//   verifyIsGravestone     - pre-flight check that the photo is actually a gravestone.
//                            Throws { __verificationRejection: true, reason } on rejection.
//   readGravestone         - main OCR call: returns names/dates/inscription/symbols JSON.
// Depends on: PROXY_BASE (js/config.js), safeParseJSON (js/util-json.js).

// ── GEMINI: CALL WITH FALLBACK ───────────────────────────────────
// Primary: gemini-3.1-flash-lite (stable). Fallback: gemini-2.5-flash.
// Falls back on:
//   - HTTP 503 (Service Unavailable / overload)
//   - HTTP 429 (rate-limited on primary)
//   - Network/fetch errors
//   - Response body containing an explicit overload/unavailable error
async function geminiCallWithFallback(payload) {
  const PRIMARY = 'gemini-3.1-flash-lite';
  const FALLBACK = 'gemini-2.5-flash';
  const init = {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Client-Key': CLIENT_KEY },
    body: JSON.stringify(payload)
  };

  const shouldFallback = (res, data) => {
    if (res && (res.status === 503 || res.status === 429)) return true;
    if (data && data.error) {
      const msg = (data.error.message || '').toLowerCase();
      const code = data.error.code;
      if (code === 503 || code === 429) return true;
      if (msg.includes('overload') || msg.includes('unavailable') ||
          msg.includes('high demand') || msg.includes('try again later')) return true;
    }
    return false;
  };

  // Try primary
  try {
    const res = await fetch(`${PROXY_BASE}/gemini/${PRIMARY}`, init);
    const data = await res.json().catch(() => ({ error: { message: 'Invalid JSON response' } }));
    if (!shouldFallback(res, data)) return { data, model: PRIMARY };
    console.log(`⚠️ ${PRIMARY} unavailable (status ${res.status}) — falling back to ${FALLBACK}`);
  } catch (err) {
    console.log(`⚠️ ${PRIMARY} fetch failed (${err.message}) — falling back to ${FALLBACK}`);
  }

  // Try fallback
  const res2 = await fetch(`${PROXY_BASE}/gemini/${FALLBACK}`, init);
  const data2 = await res2.json().catch(() => ({ error: { message: 'Invalid JSON response from fallback' } }));
  console.log(`✅ Used fallback model: ${FALLBACK}`);
  return { data: data2, model: FALLBACK };
}

// ── GEMINI: VERIFY GRAVESTONE ────────────────────────────────────
// Cheap pre-flight check before the full OCR pipeline. Catches uploads of
// non-gravestones (selfies, screenshots, pets, landscapes) before they
// poison the search / bio pipeline with garbage names.
//
// Throws a structured error { __verificationRejection: true, reason }
// when is_gravestone === false. startAnalysis() catches this and renders
// the rejection UI (with a "Use it anyway" escape hatch) instead of the
// generic error box.
async function verifyIsGravestone(base64) {
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
    contents: [{
      parts: [
        { text: prompt },
        { inline_data: { mime_type: 'image/jpeg', data: base64 } }
      ]
    }],
    generationConfig: { temperature: 0.1 }
  });
  if (data.error) {
    // If the verification call itself fails, fail open — don't block the user
    // on a transient Gemini error. The full OCR call will fail too if the
    // image is truly broken.
    console.warn('⚠️ Gravestone verification call failed — proceeding anyway:', data.error.message);
    return;
  }

  const text = data.candidates[0].content.parts[0].text;
  console.log('VERIFY RAW:', text);
  const parsed = safeParseJSON(text, { is_gravestone: true, confidence: 'low', reason: '' });
  console.log(`📷 Verification: is_gravestone=${parsed.is_gravestone} confidence=${parsed.confidence} reason="${parsed.reason}"`);

  if (parsed.is_gravestone === false) {
    const err = new Error('Image does not appear to contain a gravestone');
    err.__verificationRejection = true;
    err.reason = parsed.reason || 'The image does not appear to contain a gravestone.';
    throw err;
  }
  // is_gravestone === true (any confidence): proceed.
}

// ── GEMINI: READ GRAVESTONE ──────────────────────────────────────
async function readGravestone(base64, location) {
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
  "notes": "any other text, observations, or ambiguity flags — e.g. 'Surname not visible for deceased; KNUVER is the wife's surname'"
}

If multiple deceased people share the stone (e.g. a couple both buried here with both sets of dates), use the names array and pick the most prominent as primary_name. Be precise about dates. Return only JSON.`;

  const { data } = await geminiCallWithFallback({
    contents: [{
      parts: [
        { text: prompt },
        { inline_data: { mime_type: 'image/jpeg', data: base64 } }
      ]
    }],
    generationConfig: { temperature: 0.1 }
  });
  if (data.error) throw new Error(data.error.message);

  const text = data.candidates[0].content.parts[0].text;
  console.log('GRAVESTONE RAW:', text);
  return safeParseJSON(text, {names:[], primary_name:'Unknown', birth_date:'', death_date:'', inscription:'', symbols:[], family_name:'', notes:'', name_confidence:'high', alternate_names:[], multiple_subjects:false});
}
