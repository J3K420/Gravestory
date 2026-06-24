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
  "notes": "any other text, observations, or ambiguity flags — e.g. 'Surname not visible for deceased; KNUVER is the wife's surname'"
}

SUBJECTS ARRAY — IMPORTANT:
Populate "subjects" with one entry for EVERY DECEASED person visible anywhere in the photo frame — regardless of whether multiple_subjects is true or false. If multiple_subjects is true (separate physical stones visible), still include every deceased person from every stone visible. A single shared family stone often commemorates more than one deceased person (e.g. a grandmother AND a granddaughter, each with separate dates) — list each as a separate entry with their individual dates. Exclude living relatives who are named only inside relational phrases ("beloved wife of", "devoted family", lists of survivors) — those are not the deceased. List each deceased person only ONCE: if a single deceased person is known by more than one name or an alias (e.g. a birth name and a stage/pen name), merge them into a single entry using their most recognised name — do NOT create separate entries for the same person. For a stone with one deceased person, return a single entry. This per-person date breakdown matters: top-level birth_date/death_date may reflect only one person, but each subject's own dates must be captured here.

If multiple deceased people share the stone (e.g. a couple both buried here with both sets of dates), use the names array and pick the most prominent as primary_name, and list every deceased person with their own dates in subjects. Be precise about dates. Return only JSON.`;

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
  return safeParseJSON(text, {names:[], primary_name:'Unknown', birth_date:'', death_date:'', inscription:'', symbols:[], family_name:'', maiden_name:'', relationships:[], notes:'', name_confidence:'high', alternate_names:[], multiple_subjects:false, subjects:[]});
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
//
// Does NOT touch the scan-limit gate — it's part of the bio, not a billable scan.
// Reuses lookupSymbolMeaning() (biography.js) to decide which symbols the table
// already covers; resolved at call-time, after all scripts have loaded.
async function resolveSymbolMeanings(symbols) {
  if (!Array.isArray(symbols) || symbols.length === 0) return {};

  // Keep only symbols the static table can't already explain. Dedupe (case-insensitive)
  // while preserving the original OCR string as the canonical key.
  const seen = new Set();
  const unknown = [];
  for (const s of symbols) {
    if (typeof s !== 'string' || !s.trim()) continue;
    const key = s.trim();
    const norm = key.toLowerCase();
    if (seen.has(norm)) continue;
    seen.add(norm);
    if (lookupSymbolMeaning(key, null) === null) unknown.push(key);
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
      generationConfig: { temperature: 0.1, responseMimeType: 'application/json' }
    });
    if (!data || data.error || !data.candidates?.[0]?.content?.parts?.[0]?.text) return {};
    const parsed = safeParseJSON(data.candidates[0].content.parts[0].text, {});
    if (!parsed || typeof parsed !== 'object') return {};

    // Keep only string meanings keyed to a symbol we actually asked about.
    const out = {};
    const askedNorm = new Map(unknown.map(s => [s.toLowerCase(), s]));
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v !== 'string' || !v.trim()) continue;       // drop null / empty
      const canonical = askedNorm.get(String(k).toLowerCase());  // tolerate case drift in keys
      if (canonical) out[canonical] = v.trim();
    }
    return out;
  } catch (e) {
    console.warn('resolveSymbolMeanings failed (non-fatal):', e?.message || e);
    return {};
  }
}

// ── GEMINI: REDACT LIVING-RELATIVE NAMES FOR PUBLIC SHARING ───────
// When a user makes a story PUBLIC (it then appears on the community global
// map with a precise GPS pin), we must not re-identify or defame a LIVING
// person named in the biography. The deceased cannot be defamed; living
// relatives named in the prose ("survived by her son Michael Thompson") can.
//
// We cannot reliably know who is alive — the stone gives dates for the
// DECEASED, almost never for relatives. So this fails SAFE: any named person
// who is NOT confirmed deceased by a death year is generalized to their
// relationship ("survived by her son"). The deceased subjects' own names and
// story are preserved untouched.
//
// Returns a REDACTED copy of the biography string for public display. The
// caller stores this as `public_biography`; the private/owner copy keeps the
// full `biography`. Fails OPEN to the original ONLY on a hard error — but on
// the share path the caller should treat a null/empty return as "do not
// publish redacted" and fall back to NOT making public, OR publish the
// original (caller's policy). Here, on any failure we return the ORIGINAL
// string so sharing never silently breaks; the report button remains the
// backstop. (A stricter caller may choose to block instead.)
//
// INCREMENT 2 — DETERMINISTIC public strip for APP-ORIGINATED relative names.
// Runs BEFORE redactLivingNamesForPublic at every public write site. Unlike the
// fail-OPEN Gemini redactor, this is pure code and UNCONDITIONAL: an originated
// name (a relative from WikiTree NOT on the stone) is reduced to its relationship
// word REGARDLESS of any death-year. NOT gated on ORIGINATE_RELATIVES — it must
// strip names persisted while the flag was ON even after the flag is flipped OFF.
// `originatedRelatives` = [{name, relation}]; `subjects` = OCR deceased we must
// NOT over-strip. Empty list = pass-through. Never keeps a name on error.
function stripOriginatedNamesForPublic(biography, originatedRelatives, subjects) {
  if (typeof biography !== 'string' || !biography) return biography;
  if (!Array.isArray(originatedRelatives) || !originatedRelatives.length) return biography;

  const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Tokens of every deceased subject's name — the first-name-only variant must
  // never strip these: "John Sr." subject + a WikiTree spouse "John".
  const subjectTokens = new Set();
  if (Array.isArray(subjects)) {
    for (const s of subjects) {
      if (s && typeof s.name === 'string') {
        for (const t of s.name.toLowerCase().split(/\s+/)) if (t.length > 1) subjectTokens.add(t);
      }
    }
  }
  // Lifespan / b./d. paren only: require TWO dashed years, or a b./d. prefix.
  // A bare single-year paren is more likely an event year — do NOT consume it.
  const dateParen = '(?:\\s*\\((?:(?:b\\.|d\\.)\\s*\\d{3,4}|\\d{3,4}\\s*[\\u2013\\u2014-]\\s*\\d{3,4})\\))?';
  const cite = '(?:\\s*\\[\\d+\\])?';   // single trailing [N] only (don't eat a 2nd legit citation)

  let out = biography;
  for (const rel of originatedRelatives) {
    if (!rel || typeof rel.name !== 'string' || !rel.name.trim()) continue;
    const relWord = (typeof rel.relation === 'string' && rel.relation.trim())
      ? rel.relation.trim() : 'relative';
    // Strip parenthetical/bracketed tokens (WikiTree LongName "Mary (Brown) Smith")
    // BEFORE tokenizing — keep the inner maiden token as its own surname.
    const cleaned = rel.name.replace(/[()\[\]]/g, ' ').replace(/\s+/g, ' ').trim();
    const parts = cleaned.split(/\s+/).filter(Boolean);
    if (!parts.length) continue;
    const first = parts[0], last = parts[parts.length - 1];

    const variants = [];
    if (parts.length >= 2) {
      variants.push(parts.join(' '));            // full incl. middles + maiden
      variants.push(`${first} ${last}`);         // first + last
      for (let k = 1; k < parts.length; k++) variants.push(`${first} ${parts[k]}`); // first + each interior/maiden
    }
    // first-only LAST and only if it doesn't collide with a subject token.
    const includeFirstOnly = !subjectTokens.has(first.toLowerCase());
    if (includeFirstOnly) variants.push(first);

    const uniq = [...new Set(variants)].sort((a, b) => b.length - a.length);
    for (const v of uniq) {
      // Unicode-aware boundaries: \b is ASCII-only; use Unicode lookarounds with
      // the u flag so accented surnames (Renée, Müller) still match. Case-INSENSITIVE
      // (i): WikiTree records are often all-caps ("MARY SMITH") and the model may
      // render any casing — a case mismatch must NOT leak the name.
      const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(v)}(?![\\p{L}\\p{N}])${dateParen}${cite}`, 'giu');
      out = out.replace(re, relWord);
    }
  }
  // Collapse "spouse spouse" / "the relative relative" artifacts + tidy spacing.
  out = out.replace(/\b(spouse|relative|husband|wife)(\s+\1\b)+/gi, '$1');
  // A consumed " [N]" can leave the relation word jammed against a surviving
  // citation ("spouse[4]") — re-insert the single space.
  out = out.replace(/\b(spouse|relative|husband|wife)\[/gi, '$1 [');
  out = out.replace(/[ \t]{2,}/g, ' ').replace(/\s+([.,;!?])/g, '$1');
  return out;
}

// INCREMENT 2 — strip app-originated names from a citation/source string ARRAY
// for the public copy. `sources` is served RAW by global_public_stories (no
// redaction), and the model can author an originated name into a citation
// `description` — so the deterministic name-strip must also run over the source
// descriptions, not just the bio prose, before a flagged story is published.
// Reuses stripOriginatedNamesForPublic per element. Returns a new array.
function stripOriginatedNamesFromSources(sources, originatedRelatives, subjects) {
  if (!Array.isArray(sources)) return sources;
  if (!Array.isArray(originatedRelatives) || !originatedRelatives.length) return sources;
  return sources.map(s => typeof s === 'string'
    ? stripOriginatedNamesForPublic(s, originatedRelatives, subjects) : s);
}

// `subjects` is the OCR subjects array (each {name, birth_date, death_date}) —
// the deceased we are ALLOWED to name. Non-billable; reuses geminiCallWithFallback.
async function redactLivingNamesForPublic(biography, subjects) {
  if (typeof biography !== 'string' || !biography.trim()) return biography;

  // Names we are explicitly allowed to keep: every deceased subject, plus any
  // alias the OCR captured. Passed to the model so it never strips THEM. The
  // OCR subject shape is {name, birth_date, death_date} — derive a date hint
  // from those (NOT a `dates` field, which subjects don't carry).
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
    // Guard against a model that returns junk/empty — never publish an empty bio.
    return out.length >= 20 ? out : biography;
  } catch (e) {
    console.warn('redactLivingNamesForPublic failed (non-fatal, using original):', e?.message || e);
    return biography;
  }
}
