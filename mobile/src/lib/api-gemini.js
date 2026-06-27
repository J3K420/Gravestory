import { PROXY_BASE } from './config';
import { proxyHeaders, jwtProxyHeaders, GEMINI_JWT_PATH } from './scan-token';
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

// mode selects the Worker route + auth:
//   'scan' (default) → /gemini/ with X-Scan-Token (proxyHeaders) — calls AFTER beginScan,
//                      INSIDE the scan window: resolveSymbolMeanings, resolveMentions,
//                      and biography (biography.js uses proxyHeaders directly).
//   'jwt'            → /gemini-jwt/ with Authorization: Bearer <jwt> (jwtProxyHeaders),
//                      NO scan token, does NOT consume a scan — for calls that run
//                      BEFORE the scan is counted or at publish-time, where no scan
//                      token exists: verifyIsGravestone + readGravestone (both before
//                      beginScan) and redactLivingNamesForPublic (publish-time). Returns
//                      { data: { error: { code: 401 } }, model } when not signed in, so
//                      verify fails OPEN and redact fails CLOSED. [audit 2026-06-26]
async function geminiCallWithFallback(payload, mode = 'scan') {
  const base = mode === 'jwt' ? `${PROXY_BASE}${GEMINI_JWT_PATH}` : `${PROXY_BASE}/gemini`;
  const headers = mode === 'jwt' ? await jwtProxyHeaders() : proxyHeaders();
  if (mode === 'jwt' && !headers) {
    // No signed-in session — the JWT route requires a real user. Surface a
    // recognizable AUTH error (code 401) so verify can fail OPEN (proceed) while
    // redactLivingNamesForPublic fails CLOSED (must NOT publish unredacted). [#13]
    return { data: { error: { message: 'Not signed in', code: 401 } }, model: PRIMARY };
  }
  const init = {
    method: 'POST',
    headers,
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
    const res = await fetchWithTimeout(`${base}/${PRIMARY}`, init);
    const data = await res.json().catch(() => ({ error: { message: 'Invalid JSON' } }));
    if (!shouldFallback(res, data)) return { data, model: PRIMARY };
  } catch (err) {
    console.warn(`Primary fetch failed (${err.message}) — falling back`);
  }

  const res2 = await fetchWithTimeout(`${base}/${FALLBACK}`, init);
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

  // mode 'jwt': verify runs BEFORE beginScan (a non-gravestone photo must not burn a
  // scan), so it authenticates with the user JWT, not a scan token. [audit 2026-06-26]
  const { data } = await geminiCallWithFallback({
    contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: 'image/jpeg', data: base64 } }] }],
    generationConfig: { temperature: 0.1 },
  }, 'jwt');

  if (data.error) {
    console.warn('verifyIsGravestone error — proceeding anyway. Response:', JSON.stringify(data));
    return;
  }

  // Verify must FAIL OPEN on its own failures — only an explicit is_gravestone===false
  // rejects. A safety-blocked / empty Gemini response ({ promptFeedback: { blockReason } }
  // with no candidates, or a SAFETY finishReason with no content.parts) carries no
  // data.error, so without this guard the unguarded candidates[0]...text read throws a
  // TypeError that surfaces as the generic "Analysis Failed" screen — failing CLOSED and
  // hard-blocking a legitimate gravestone photo. Proceed to OCR instead, like the
  // data.error branch above and the three sibling Gemini calls in this file. [search-audit #5]
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) {
    console.warn('verifyIsGravestone — no candidate text (blocked/empty response), proceeding anyway.');
    return;
  }
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

  // mode 'jwt': OCR runs BEFORE beginScan mints the scan token (the scan is counted
  // AFTER OCR so a non-gravestone doesn't burn a scan), so — like verifyIsGravestone —
  // it must authenticate with the user JWT on the /gemini-jwt route, NOT a scan token
  // it doesn't have yet. A scan-token-mode OCR here would 403 under enforcement (no
  // token is armed until line ~718 of the pipeline). It also no-ops cleanly for a
  // signed-out user (jwtProxyHeaders → null → data.error), closing the free-OCR
  // window before beginScan's NO_AUTH gate. [review 2026-06-26 #1/#3/#11]
  const { data } = await geminiCallWithFallback({
    contents: [{ parts: [{ text: prompt }, { inline_data: { mime_type: 'image/jpeg', data: base64 } }] }],
    generationConfig: { temperature: 0.1 },
  }, 'jwt');
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

// ── MENTIONS: NORMALIZE RAW RESEARCH HITS ────────────────────────
// Mirror of web js/api-gemini.js buildMentionHits (keep in sync). Turns the
// per-source research results (otherwise discarded after the bio) into a uniform
// list of { url, kind, snippet, year, source } the generator can describe.
// INCLUDES Tavily web + FindAGrave + Chronicling America + Internet Archive +
// Wikipedia; EXCLUDES Wikidata (structured) and WikiTree (corroboration object +
// synthetic homepage source).
export function buildMentionHits({ searchResults, chronResults, archiveResults, wikiSummary } = {}) {
  const hits = [];
  const yearFrom = (s) => {
    if (typeof s !== 'string') return null;
    const m = s.match(/\b(1[6-9]\d\d|20\d\d)\b/);
    return m ? m[1] : null;
  };
  const isHttp = (u) => typeof u === 'string' && /^https?:\/\//i.test(u);

  if (Array.isArray(searchResults)) {
    for (const r of searchResults) {
      if (!r || !isHttp(r.url)) continue;
      if (r.source_type === 'wikitree') continue;
      const kind = r.source_type === 'memorial'
        ? 'a FindAGrave memorial page'
        : 'a present-day web page';
      hits.push({ url: r.url, kind, snippet: (r.content || r.title || '').slice(0, 600),
        year: yearFrom(r.title) || null, source: 'web' });
    }
  }
  if (Array.isArray(chronResults)) {
    for (const r of chronResults) {
      if (!r || !isHttp(r.url)) continue;
      hits.push({ url: r.url, kind: 'a Chronicling America historical newspaper page',
        snippet: (r.content || '').slice(0, 800), year: yearFrom(r.title), source: 'chronicling' });
    }
  }
  if (Array.isArray(archiveResults)) {
    for (const r of archiveResults) {
      if (!r || !isHttp(r.url)) continue;
      hits.push({ url: r.url, kind: 'an Internet Archive book or county history',
        snippet: (r.content || '').slice(0, 800), year: yearFrom(r.title), source: 'archive' });
    }
  }
  const wikis = Array.isArray(wikiSummary) ? wikiSummary : (wikiSummary ? [wikiSummary] : []);
  for (const w of wikis) {
    if (!w || typeof w.title !== 'string' || !w.title.trim()) continue;
    const url = `https://en.wikipedia.org/wiki/${encodeURIComponent(w.title.trim().replace(/ /g, '_'))}`;
    hits.push({ url, kind: 'a Wikipedia article', snippet: (w.extract || '').slice(0, 800),
      year: null, source: 'wikipedia' });
  }

  const rank = { memorial: 0, wikipedia: 1, chronicling: 2, archive: 2, web: 3 };
  const seen = new Set();
  const deduped = [];
  for (const h of hits) {
    if (seen.has(h.url)) continue;
    seen.add(h.url);
    deduped.push(h);
  }
  deduped.sort((a, b) => {
    const ra = a.kind === 'a FindAGrave memorial page' ? rank.memorial : rank[a.source];
    const rb = b.kind === 'a FindAGrave memorial page' ? rank.memorial : rank[b.source];
    return (ra ?? 9) - (rb ?? 9);
  });
  return deduped;
}

// ── GEMINI: RESOLVE MENTIONS ─────────────────────────────────────
// Mirror of web js/api-gemini.js resolveMentions (keep in sync). Turns the best
// of this scan's research hits into short, NAME-SAFE one-sentence pointers the
// result screen shows as a "Mentions" sheet of tappable hyperlinks — on the
// owner's story AND on the public global map. One batched call, null-guarded,
// fails CLOSED to [] (sheet omitted). NOT scan-limit-gated. The label is authored
// under the same living-name rule as redactLivingNamesForPublic (S62), so no
// living relative's name can reach the public map via a raw snippet.
export async function resolveMentions(rawHits, subjects) {
  const MAX_SEND = 8;
  if (!Array.isArray(rawHits) || rawHits.length === 0) return [];
  const hits = rawHits
    .filter(h => h && typeof h.url === 'string' && /^https?:\/\//i.test(h.url))
    .slice(0, MAX_SEND);
  if (hits.length === 0) return [];

  const allowed = [];
  if (Array.isArray(subjects)) {
    for (const s of subjects) {
      if (s && typeof s.name === 'string' && s.name.trim()) {
        const d = [s.birth_date, s.death_date].filter(Boolean).join('–') || s.dates || '';
        allowed.push(`${s.name.trim()}${d ? ` (${d})` : ''}`);
      }
    }
  }

  const prompt = `You are writing short pointer sentences for a gravestone-history app. Each item below is a real research hit ABOUT one or more DECEASED people. For each item, write ONE short, natural sentence a museum visitor would read, telling them WHERE this person is mentioned — e.g. "Mentioned in a 1919 obituary in the Aiken Courier." or "Appears in a county history from 1908." or "Has a memorial on Find a Grave.". Use the item's source kind and year. Do NOT summarize the content, quote it, or add facts not present in the snippet. Keep it under ~18 words. No citation markers, no quotation marks.

THE DECEASED SUBJECT(S) — you MAY name these people exactly as written:
${allowed.length ? allowed.map(n => `- ${n}`).join('\n') : '- (none listed — infer the subject and keep only that person\'s name)'}

NAME-SAFETY RULES (follow EXACTLY):
- For ANY person mentioned in a snippet who is NOT one of the deceased subjects above and is NOT confirmed dead by an explicit death year in the snippet, do NOT name them — refer to them by relationship only (her son, his wife, a daughter), or omit them.
- If unsure whether a named person is living or dead, treat them as LIVING and do not name them. When in doubt, remove the name.
- A person explicitly shown as deceased in the snippet (a death year, "the late", "predeceased") is NOT living — you may name them.

QUALITY RULES:
- If a snippet does NOT clearly refer to one of the deceased subjects above (e.g. it is about a different person who happens to share the surname), return null for that item. An honest null is better than pointing the visitor at the wrong person.
- If you cannot write a confident, useful sentence, return null for that item.

Return ONLY a JSON object whose keys are the item ids given below and whose values are the sentence string, or null. Example shape:
{ "m0": "Mentioned in a 1919 obituary in the Aiken Courier.", "m1": null }

Items:
${hits.map((h, i) => `- m${i}: kind=${h.kind}; year=${h.year || 'unknown'}; snippet="${(h.snippet || '').slice(0, 400).replace(/"/g, "'")}"`).join('\n')}

Return only JSON.`;

  try {
    const { data } = await geminiCallWithFallback({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.1, responseMimeType: 'application/json' },
    });
    if (!data || data.error || !data.candidates?.[0]?.content?.parts?.[0]?.text) return [];
    const parsed = safeParseJSON(data.candidates[0].content.parts[0].text, {});
    if (!parsed || typeof parsed !== 'object') return [];

    const MAX_SHOW = 5;
    const out = [];
    const usedUrls = new Set();
    for (let i = 0; i < hits.length; i++) {
      const v = parsed[`m${i}`];
      if (typeof v !== 'string' || !v.trim()) continue;
      const hit = hits[i];
      if (usedUrls.has(hit.url)) continue;
      usedUrls.add(hit.url);
      out.push({ sentence: v.trim(), url: hit.url, source: hit.source, year: hit.year || null });
      if (out.length >= MAX_SHOW) break;
    }
    return out;
  } catch (e) {
    console.warn('resolveMentions failed (non-fatal):', e?.message || e);
    return [];
  }
}

// Deterministic fail-CLOSED backstop for the PUBLIC path. Mirror of web
// stripOriginatedNamesFromMentions (keep in sync). Even though every mention
// sentence is authored under the living-name rule, strip any originated relative
// name before a flagged story is published. Empty originatedRelatives = pass-through.
export function stripOriginatedNamesFromMentions(mentions, originatedRelatives, subjects) {
  if (!Array.isArray(mentions)) return mentions;
  if (!Array.isArray(originatedRelatives) || !originatedRelatives.length) return mentions;
  return mentions.map(m => {
    if (!m || typeof m.sentence !== 'string') return m;
    return { ...m, sentence: stripOriginatedNamesForPublic(m.sentence, originatedRelatives, subjects) };
  });
}

// PUBLIC-PATH name-safety filter for mentions (mirror of web filterMentionsForPublic,
// keep in sync). Mentions get no Gemini living-name redactor at publish, so this is
// the S62-consistent deterministic floor: DROP any mention whose sentence contains a
// capitalized multi-word personal name NOT covered by the deceased allowlist (or by
// common source/place/month words). Conservative — fewer, safer on the public path.
export function filterMentionsForPublic(mentions, subjects) {
  if (!Array.isArray(mentions)) return mentions;
  const allow = new Set();
  if (Array.isArray(subjects)) {
    for (const s of subjects) {
      if (s && typeof s.name === 'string') {
        for (const t of s.name.toLowerCase().split(/\s+/)) if (t.length > 1) allow.add(t);
      }
    }
  }
  const SOURCE_WORDS = ['find','a','grave','findagrave','billiongraves','ancestry','obituary',
    'obituaries','newspaper','courier','times','herald','gazette','tribune','journal','press',
    'news','record','register','county','history','archive','internet','wikipedia','wikitree',
    'memorial','cemetery','legacy','com','org','january','february','march','april','may','june',
    'july','august','september','october','november','december','st','saint','the','of','and'];
  for (const w of SOURCE_WORDS) allow.add(w);

  return mentions.filter(m => {
    if (!m || typeof m.sentence !== 'string') return false;
    const runs = m.sentence.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b/g) || [];
    for (const run of runs) {
      const tokens = run.toLowerCase().split(/\s+/);
      if (!tokens.every(t => allow.has(t))) return false;
    }
    return true;
  });
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

// INCREMENT 2 — DETERMINISTIC public strip for APP-ORIGINATED relative names.
// Runs BEFORE redactLivingNamesForPublic at every public write site. Unlike the
// fail-OPEN Gemini redactor, this is pure code and UNCONDITIONAL: an originated
// name (a relative from WikiTree NOT on the stone) is reduced to its relationship
// word REGARDLESS of any death-year. NOT gated on ORIGINATE_RELATIVES — it must
// strip names persisted while the flag was ON even after the flag is flipped OFF.
// `originatedRelatives` = [{name, relation}]; `subjects` = OCR deceased we must
// NOT over-strip. Empty list = pass-through. Never keeps a name on error.
export function stripOriginatedNamesForPublic(biography, originatedRelatives, subjects) {
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
export function stripOriginatedNamesFromSources(sources, originatedRelatives, subjects) {
  if (!Array.isArray(sources)) return sources;
  if (!Array.isArray(originatedRelatives) || !originatedRelatives.length) return sources;
  return sources.map(s => typeof s === 'string'
    ? stripOriginatedNamesForPublic(s, originatedRelatives, subjects) : s);
}

// Returned by redactLivingNamesForPublic when redaction could NOT run because the
// user's session is missing/expired (the JWT route can't authenticate). The caller
// MUST treat this as "do not publish raw": write this placeholder as public_biography
// AND blank the raw-served public columns (sources/source_urls/mentions). Failing to
// recognize it would re-leak a living relative's name on session expiry. [#13]
export const REDACTION_UNAVAILABLE = 'This public biography is being prepared.';

// True when a JWT-route Gemini failure is an AUTH failure (no session / expired or
// unverifiable JWT → Worker 401/403), as opposed to a benign Gemini hiccup. Auth
// failures must fail CLOSED on the public path; benign failures keep the long-standing
// fail-open (return original). data.error may be a nested object (code 401) or a Worker
// string error ('Sign in…' / code NO_AUTH|BAD_AUTH).
function isJwtAuthError(data) {
  const e = data?.error;
  if (!e) return false;
  if (typeof e === 'object') {
    if (e.code === 401 || e.code === 403) return true;
    const m = (e.message || '').toLowerCase();
    return m.includes('not signed in') || m.includes('sign in') || m.includes('expired') || m.includes('no_auth') || m.includes('bad_auth');
  }
  const s = String(e).toLowerCase();
  return s.includes('sign in') || s.includes('no_auth') || s.includes('bad_auth') || s.includes('expired') || s.includes('unauthorized');
}

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
    // mode 'jwt': redaction runs at Save/Share/make-public — OUTSIDE any scan window
    // (an already-saved story toggled public has no scan token at all). Authenticate
    // with the user JWT so it can't 403 under scan-token enforcement. [audit 2026-06-26]
    const { data } = await geminiCallWithFallback({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.1, responseMimeType: 'application/json' }
    }, 'jwt');
    // FAIL CLOSED on an AUTH failure (no/expired session): returning the original
    // here would publish an UNREDACTED bio with a living relative's name — the exact
    // S62 regression. Return the placeholder sentinel so the caller writes the
    // placeholder AND blanks the raw-served public columns. [review 2026-06-26 #13]
    if (isJwtAuthError(data)) {
      console.warn('redactLivingNamesForPublic: auth failure — failing CLOSED (not publishing unredacted)');
      return REDACTION_UNAVAILABLE;
    }
    // Benign Gemini failure (hiccup / malformed / safety block): keep the
    // long-standing fail-OPEN behavior (return the original) so legitimate sharing
    // isn't broken by a transient model error. This is unchanged from pre-S78.
    if (!data || data.error || !data.candidates?.[0]?.content?.parts?.[0]?.text) return biography;
    const parsed = safeParseJSON(data.candidates[0].content.parts[0].text, {});
    const out = parsed && typeof parsed.public_biography === 'string' ? parsed.public_biography.trim() : '';
    return out.length >= 20 ? out : biography;
  } catch (e) {
    console.warn('redactLivingNamesForPublic failed (non-fatal, using original):', e?.message || e);
    return biography;
  }
}
