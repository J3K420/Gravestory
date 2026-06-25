export const meta = {
  name: 'search-pipeline-audit-mobile',
  description: 'Adversarial MOBILE-ONLY audit of the GraveStory search/research pipeline (correctness, namesake guards, citation integrity, anti-hallucination, unguarded access)',
  phases: [
    { title: 'Find', detail: 'parallel finders, one per source/concern (mobile only)' },
    { title: 'Verify', detail: 'adversarial skeptic panel per candidate' },
  ],
}

const REPO = 'C:\\\\Users\\\\james\\\\Desktop\\\\Gravestoryrepo'
const LIB = `${REPO}\\\\mobile\\\\src\\\\lib`

const SHARED_CONTEXT = `
You are auditing the GraveStory MOBILE search/research pipeline for REAL bugs. SCOPE: MOBILE ONLY — files under mobile/src/. Do NOT report web/mobile parity differences; the user explicitly scoped this to mobile. Web files exist only as a reference for what the INTENDED behavior is — if mobile diverges from web in a way that makes MOBILE wrong, that's a mobile bug worth reporting, but a mere stylistic difference is not.

Context:
- GraveStory turns a gravestone photo into a cited biography. Mobile pipeline (ES modules, React Native / Expo): OCR (Gemini, api-gemini.js) -> parallel research fan-out in src/screens/CameraScreen.js (Tavily api-tavily.js, WikiTree api-wikitree.js, Wikidata api-wikidata.js, Chronicling America api-chroniclingamerica.js, Internet Archive api-internetarchive.js, Wikipedia api-wikipedia.js) -> Gemini biography (biography.js). util-json.js has safeParseJSON; abbreviations.js has the shared EXPAND nickname table.
- The breakdown doc at ${REPO}\\\\docs\\\\search-pipeline-breakdown.md describes intended behavior — READ IT FIRST, then hunt for code that violates that intent ON MOBILE.
- Key invariants the mobile pipeline must uphold:
  * Namesake guards: Wikidata skips death-year >5yr off (api-wikidata.js); WikiTree credibility floor needs name+date alignment and hard-rejects birth year >10yr off (api-wikitree.js); biography corroboration flags DATE CONFLICT at >2yr (biography.js). These three tolerances are INTENTIONALLY different numbers — do NOT flag them for being different, but DO flag if any is implemented wrong (off-by-one, wrong variable, sign error, Math.abs missing, comparing the wrong years).
  * Anti-hallucination: stone-only fallback in biography.js must NOT call Gemini (geminiText); the historical-figure exception is evaluated PER PERSON against that person's own dates from subjects[]; "memory is not a source" unless a [Wikipedia] article + dates within +/-5yr + every claim cited. A burial-place-recovered (dateless) subject must be capped to a SHORT cited paragraph (maxOutputTokens 1400 via _viaBurial), never the ~2500-word from-memory treatment.
  * Citation integrity: validateCitations (biography.js) filters integer n>=1, sorts, remaps [N] markers to sequential 1..k, strips orphans -> "", strips invented non-numeric [Label] brackets. A remap that drops a valid citation, duplicates a number, leaves an orphan, or strips a legit [N] is a bug.
  * Cost control: Tavily fires <=6 slots in parallel (api-tavily.js queries.slice(0,6)); the session _searchCache is keyed "name|deathYear" — a collision between two DIFFERENT people that share that key (e.g. two "John Smith" who both died 1900, or two dateless people) is a bug. The scan is counted after the bio resolves (incrementScanCount in CameraScreen).
  * Era cutoffs: Chronicling America CA_CUTOFF 1928, Internet Archive IA_CUTOFF 1925 (1925 inclusive). The CameraScreen gates (deathYrNum <= 1928 / <= 1925) must match the module-internal guards, else a death year falls in a gap where neither fires, or a query goes out past the cutoff.
  * Dedup: Tavily walks results in Promise.allSettled (order-preserving) priority order, a seen-Set on URL keeps the FIRST (highest-priority) copy. The index destructure in CameraScreen relies on a running idx counter over VARIABLE-length wikiTreeTargets and researchTargets slices bracketing the fixed wikidata/chron/archive single values — if a slice length is miscomputed, every downstream result maps to the WRONG source (highest-severity class).

A REAL bug is: a logic error, an off-by-one, a wrong/sign-flipped comparison, a swapped variable, a missing await, an unguarded array/property access on possibly-undefined data (e.g. data.candidates[0] when candidates can be absent, graveData.names when it can be undefined), a dedup that keeps the wrong copy, a cache-key collision between two distinct people, a citation remap that drops/duplicates/orphans a marker, an era-cutoff mismatch between the CameraScreen gate and the module guard, a namesake guard that lets a wrong-person record through, a regex that mis-windows a snippet (negative index, off-by-one bound), a name passed to a downstream query WITH role parentheses still attached ("George (deceased)") or a LIVING relative ("Lizzie Knuver (wife)") researched as if deceased, or an originated-name public-strip that fails to strip / over-strips a deceased subject.

NOT a bug (do not report): web/mobile parity differences (OUT OF SCOPE); the three different year tolerances being different numbers; style/naming; hypothetical "what if the API changes its JSON shape" with no concrete realistic trigger; anything you cannot point to a specific mobile line for; behavior the breakdown documents as intentional (e.g. _searchCache requiring BOTH name and year so dateless people are never cached; the cemetery-centroid coord deliberately not cached; resolveSymbolMeanings deliberately not scan-gated).

For EACH finding you MUST cite exact mobile file path + line number(s) and quote the offending code. Read the actual mobile files — do not guess.
`

phase('Find')

const FINDERS = [
  {
    key: 'tavily',
    prompt: `${SHARED_CONTEXT}

YOUR ASSIGNMENT: Audit the mobile TAVILY leg. Read ${LIB}\\\\api-tavily.js and ${LIB}\\\\abbreviations.js.
Hunt for: the 6-slot cap (queries.slice(0,6)) — can an unshifted inscription query push a high-value FindAGrave/obituary slot off the end and silently drop it? the order-preserving dedup (does the seen-Set keep the HIGHEST-priority copy given Promise.allSettled order?); source_type host derivation (any host mapped to the wrong source_type? e.g. a findagrave URL that also contains a substring matching an earlier branch); parseAgeAtDeath math (birth = death - age; death = birth + age — off-by-one? age bounds 1..120? does it ever overwrite a real engraved year?); the _searchCache key "name|deathYear" — two DIFFERENT same-named people who died the same year collide and the second gets the first's results: is that a real risk and is it guarded? expandName / variant dedup; the extractFindAGraveDetail death-year-in-snippet gate + the retry credit logic (does it ever spend the extract credit on the WRONG person, or retry infinitely?). Quote exact lines.`,
  },
  {
    key: 'wikitree',
    prompt: `${SHARED_CONTEXT}

YOUR ASSIGNMENT: Audit the mobile WIKITREE leg. Read ${LIB}\\\\api-wikitree.js.
Hunt for: the multi-pass control flow (Pass 1 date-filtered -> 1.5 maiden -> 2 unfiltered -> 3 expanded-first) — can it skip a pass it should run, or run an expensive pass when an earlier one already had matches? the scoring ladders (firstMatch/lastMatch +20; spouse +40 / parent +25; birth-year 0->+100 / <=2->+50 / <=5->+20 / else -diff; death-year identical ladder; geo +30 / -20; +1 tiebreaker) — any wrong threshold, missing Math.abs, sign error, or ladder boundary off-by-one? the credibility floor (best._nameAligned && best._dateAligned, plus the birthYear >10 hard reject) — is >10 correct, and is it comparing best's birth year to the STONE's birth year (not death)? relationNameMatch (single-token vs multi-token surname+first logic — can a wrong relative score a spouse hit?); the ORIGINATE_RELATIVES gate (Path A / Path B) — could it originate a name when it shouldn't, or leak a name that isn't actually a spouse? Quote exact lines.`,
  },
  {
    key: 'wikidata-wikipedia',
    prompt: `${SHARED_CONTEXT}

YOUR ASSIGNMENT: Audit the mobile WIKIDATA + WIKIPEDIA legs + the title bridge. Read ${LIB}\\\\api-wikidata.js and ${LIB}\\\\api-wikipedia.js.
Hunt for: the namesake guard in queryWikidata (diff > 5 skip; score = 100 - diff*10; is diff absolute? what happens with no death date — does score=-50 ever WIN and return a namesake? if all rejected, does it correctly return null vs falling through to candidates[0]?); the P31=Q5 human filter (could a non-human entity be returned?); fetchBurialCoords second query guard; queryWikidataByBurialPlace (the >1 same-surname abort — can a family plot slip a wrong person through? does the SPARQL surname FILTER actually bound the LIMIT-200 correctly? a malformed decodeURIComponent fallback?); the cemetery proximity guard (3km). In api-wikipedia.js: the title-match guard (firstLast.every(w => t.includes(w)) — substring containment can match the WRONG article, e.g. "Ann Lee" matching "Joann Leeson"?); the knownTitle bypass (does it bypass the guard ONLY when supplied?); imageFilenameMatchesPerson substring-both-directions (can it accept a wrong-person image, e.g. a short name token like "lee" matching any filename containing "lee"?); the <80-char extract + disambiguation rejection. Quote exact lines.`,
  },
  {
    key: 'corroboration-sources',
    prompt: `${SHARED_CONTEXT}

YOUR ASSIGNMENT: Audit the mobile CHRONICLING AMERICA + INTERNET ARCHIVE legs. Read ${LIB}\\\\api-chroniclingamerica.js and ${LIB}\\\\api-internetarchive.js.
Hunt for: the CA window (date1 = year-1, date2 = min(year+1, CUTOFF+1)) — off-by-one? can date2 exceed the PD wall? the CA CUTOFF gate (year > 1928 reject) vs the CameraScreen gate (deathYrNum <= 1928) — consistent? windowAroundName (idx-250 start, 800-char slice — negative-index safe? the surname.length<3 guard silently drops legitimate 2-letter surnames like Ng/Li/Ho/Wu — is that an acceptable known limitation or a real miss?); IA year range [1820 TO 1925] vs IA_CUTOFF reject (year>1925) — is 1925 inclusive on BOTH? IA ocrWindow (the firstName-precedes-surname scan loop — can it infinite-loop? does the from = cand + sLower.length advance correctly? is the Content-Length size guard correct, and does a MISSING content-length header (len=0) correctly fall through to reading the whole file — is that a memory risk on a huge file with no header?); the snippet>60 / >40 length thresholds; does any DATE get parsed out of CA/IA OCR text and leak into date-conflict logic (forbidden — name presence only)? Quote exact lines.`,
  },
  {
    key: 'biography',
    prompt: `${SHARED_CONTEXT}

YOUR ASSIGNMENT: Audit the mobile BIOGRAPHY generator — the most correctness-critical file. Read ${LIB}\\\\biography.js.
Hunt for: hasRealSources (does it correctly treat an EMPTY wikiData array / empty wikipediaSummary array as "no source", so it doesn't call Gemini with zero sources, and conversely never skip Gemini when real sources exist?); buildCorroborationSummary (stoneFirst len>1 + stoneLast len>2 name-confirmer logic; the >=2 -> corroborated / ==1 -> confirmed thresholds; DATE CONFLICT diff>2 using ONLY structured WikiTree/Wikidata years — does any CA/IA text year sneak in? is Math.abs present on every diff?); the historical-figure PER-PERSON gate in the prompt + the _viaBurial maxOutputTokens cap (1400) — can a dateless burial-recovered subject unlock the 8000-token / ~2500-word treatment? validateCitations (filter Number.isInteger(c.n) && n>=1; sort; nMap remap; the bio.replace for [N]; the non-numeric [Label] strip regex /\\[(?!\\d+\\])[^\\]]*\\]/g — does this accidentally strip a legit [12] or a [N][M] sequence? does an orphan [N] with no matching citation get blanked correctly? could two citations with the same n collide in nMap?); isMultiSubject derivation; the parse-failure fallback object (does it omit location vs the entry guard?); buildBurialCandidatePartial (does it ever name a person WITHOUT _wikiConfirmed?). Quote exact lines.`,
  },
  {
    key: 'gemini-ocr',
    prompt: `${SHARED_CONTEXT}

YOUR ASSIGNMENT: Audit the mobile GEMINI OCR/verify/symbol/mentions layer + JSON parsing. Read ${LIB}\\\\api-gemini.js and ${LIB}\\\\util-json.js.
Hunt for: the three error postures — verifyIsGravestone must fail OPEN (return, don't throw) on transport error and reject only on explicit is_gravestone===false; readGravestone must fail HARD (throw); resolveSymbolMeanings/resolveMentions must be non-fatal ({}/[]) — is each correct, or does one fail the wrong way? data.candidates[0].content.parts[0].text — UNGUARDED access: if Gemini returns a response with no candidates (safety block, empty), does this throw a TypeError that escapes as an opaque crash instead of the intended error? (check verifyIsGravestone line ~101, readGravestone line ~176, biography geminiText path). geminiCallWithFallback shouldFallback logic (does a Worker STRING error correctly NOT trigger fallback? does the fallback call's own failure surface a usable error?); safeParseJSON (the 3-tier fallback — could the lastBrace>0 tier return a truncated/invalid object that masks a real parse error? does it ever return the fallback when it should have thrown?); resolveMentions / buildMentionHits (the m${'{'}i${'}'} id mapping — does parsed[\`m\${i}\`] line up with hits[i] after dedup? could a mention attach to the WRONG url?); the public-strip functions (stripOriginatedNamesForPublic regex — could it fail to strip an all-caps WikiTree name, or over-strip a deceased subject token?). Quote exact lines.`,
  },
  {
    key: 'orchestration',
    prompt: `${SHARED_CONTEXT}

YOUR ASSIGNMENT: Audit the mobile PIPELINE ORCHESTRATION — where index-mapping and gating bugs hide. Read ${REPO}\\\\mobile\\\\src\\\\screens\\\\CameraScreen.js, focusing on the research fan-out block (roughly lines 745-1090: the legs array, legFallbacks, the idx destructure, FindAGrave extract, source merge, title bridge, burial-recovery gate, portrait retry, GPS resolution).
Hunt for THE HIGHEST-SEVERITY CLASS FIRST: the idx-counter destructure (lines ~823-830). The legs array is [searchForPerson, ...wikiTreeTargets.map, wikidata, chron, archive, ...researchTargets.map(portraits), ...researchTargets.map(summaries)]. The destructure slices wikiTreeTargets.length for wikitree, then single wikidata/chron/archive, then wikiNames.length for portraits, then the REST for summaries. Verify: (a) wikiNames.length === researchTargets.length always (portraits leg built with researchTargets, sliced with wikiNames.length); (b) legFallbacks on timeout has the EXACT same per-leg shape and length so the destructure lines up; (c) the count holds for 1 wikiTreeTarget+1 researchTarget, 2+3, and the isMulti edge case. THEN: the isMulti branch (line ~759-768) builds researchTargets/wikiTreeTargets/wikiNames from graveData.names WITHOUT stripping role parentheses — does "George (deceased)" / a LIVING "Lizzie Knuver (wife)" get passed raw into fetchWikipediaArticleSummary / fetchWikipediaPortraits / searchWikiTree? Is that a real misfire (polluted query + a living relative researched)? Also: the CA/IA/Wikidata gates (deathYrNum) vs the module cutoffs; the bio-cache short-circuit; the burial-recovery _nameFirstEmpty gate; the wikipediaSummary single-vs-array shape threaded into the bridge and generateBiography; incrementScanCount placement. Quote exact lines.`,
  },
]

const FINDING_SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'short stable slug' },
          title: { type: 'string' },
          severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
          category: { type: 'string', enum: ['logic-error', 'namesake-guard', 'citation-integrity', 'cost-control', 'era-cutoff', 'dedup', 'unguarded-access', 'off-by-one', 'name-cleaning', 'anti-hallucination', 'other'] },
          file: { type: 'string', description: 'exact mobile file path' },
          lines: { type: 'string', description: 'exact line number(s)' },
          code_quote: { type: 'string', description: 'the exact offending code' },
          explanation: { type: 'string', description: 'why it is a real bug; the concrete input that triggers it; the wrong behavior' },
          suggested_fix: { type: 'string' },
        },
        required: ['id', 'title', 'severity', 'category', 'file', 'lines', 'code_quote', 'explanation', 'suggested_fix'],
      },
    },
  },
  required: ['findings'],
}

const VERDICT_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    is_real: { type: 'boolean' },
    confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
    verdict_reason: { type: 'string', description: 'cite the exact mobile code you re-read; explain why real or refuted' },
    corrected_severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
    fix_is_sound: { type: 'boolean' },
  },
  required: ['id', 'is_real', 'confidence', 'verdict_reason', 'fix_is_sound'],
}

const results = await pipeline(
  FINDERS,
  f => agent(f.prompt, { label: `find:${f.key}`, phase: 'Find', schema: FINDING_SCHEMA }),
  (found, finder) => {
    const findings = (found && Array.isArray(found.findings)) ? found.findings : []
    if (!findings.length) return []
    return parallel(findings.map(finding => () =>
      parallel([0, 1, 2].map(i => () =>
        agent(
          `${SHARED_CONTEXT}

You are an adversarial verifier. A prior audit agent claims the following MOBILE bug. REFUTE it. Re-read the ACTUAL mobile code at the cited location yourself — do not trust the claim. Default to is_real=false unless the code genuinely misbehaves on a concrete realistic input. Watch for: claims that misread the code; claims that are actually guarded a few lines away; claims about web/mobile parity (OUT OF SCOPE — refute these); claims confusing the three intentionally-different year tolerances; claims with no concrete triggering input; claims about behavior the breakdown documents as intentional.

CLAIMED BUG (id=${finding.id}):
Title: ${finding.title}
Severity: ${finding.severity} | Category: ${finding.category}
File: ${finding.file}  Lines: ${finding.lines}
Quoted code: ${finding.code_quote}
Claim: ${finding.explanation}
Proposed fix: ${finding.suggested_fix}

Re-read the file around those lines and any nearby guard code. Decide: REAL or refuted? Also judge whether the proposed fix is sound (fixes it without breaking documented-intentional behavior).`,
          { label: `verify:${finder.key}:${finding.id}#${i}`, phase: 'Verify', schema: VERDICT_SCHEMA }
        )
      )).then(votes => {
        const v = votes.filter(Boolean)
        const realVotes = v.filter(x => x.is_real).length
        const survives = realVotes >= 2
        const fixVotes = v.filter(x => x.fix_is_sound).length
        return { finding, finder: finder.key, survives, realVotes, totalVotes: v.length, fixSound: fixVotes >= 2, verdicts: v }
      })
    ))
  }
)

const all = results.flat().filter(Boolean)
const confirmed = all.filter(r => r.survives)
const refuted = all.filter(r => !r.survives)

log(`MOBILE audit: ${all.length} candidate bugs; ${confirmed.length} survived adversarial verification, ${refuted.length} refuted.`)

return {
  confirmed: confirmed.map(r => ({
    finder: r.finder,
    realVotes: `${r.realVotes}/${r.totalVotes}`,
    fixSound: r.fixSound,
    ...r.finding,
    verdict_reasons: r.verdicts.map(v => `[${v.is_real ? 'REAL' : 'refuted'}/${v.confidence}] ${v.verdict_reason}`),
  })),
  refuted: refuted.map(r => ({
    finder: r.finder,
    realVotes: `${r.realVotes}/${r.totalVotes}`,
    title: r.finding.title,
    file: r.finding.file,
    lines: r.finding.lines,
    why_refuted: r.verdicts.filter(v => !v.is_real).map(v => v.verdict_reason),
  })),
}
