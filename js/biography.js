// biography.js — Generate biographical narrative via Gemini (extracted Stage 4)

// Maps lowercased symbol keywords (as returned by Gemini OCR) to their conventional
// funerary/fraternal meaning. Injected into the bio prompt so Gemini has grounded
// context rather than recalling from training alone — especially useful for obscure
// fraternal emblems where training data is thin.
const _SYMBOL_CONTEXT = {
  // ── Military & Veterans ──────────────────────────────────────────────────────
  'gar':                  'Grand Army of the Republic (GAR) — Union Army veteran emblem, Civil War service 1861–1865. GAR posts were active through 1956. Pension and service records may exist at Fold3 or the National Archives.',
  'grand army':           'Grand Army of the Republic (GAR) — Union Army veteran emblem, Civil War service 1861–1865. Pension and service records may exist at Fold3 or the National Archives.',
  'civil war':            'Civil War era (1861–1865) — veteran of either Union or Confederate forces. Service and pension records often survive at the National Archives or Fold3.',
  'confederate':          'Confederate States Army veteran — served the Confederacy during the Civil War 1861–1865. Southern Cross of Honor or Confederate Veterans\' Association records may exist.',
  'spanish american':     'Spanish-American War veteran (1898) — served in Cuba, Puerto Rico, or the Philippines. Records at the National Archives.',
  'world war i':          'World War I veteran (1914–1918, US entry 1917). Draft registration cards survive at Ancestry; service records at the National Archives.',
  'world war 1':          'World War I veteran (1914–1918, US entry 1917). Draft registration cards survive at Ancestry; service records at the National Archives.',
  'wwi':                  'World War I veteran (1914–1918, US entry 1917). Draft registration cards survive at Ancestry; service records at the National Archives.',
  'world war ii':         'World War II veteran (1939–1945, US entry 1941). WWII Army and Navy service records available through the National Personnel Records Center.',
  'world war 2':          'World War II veteran (1939–1945, US entry 1941). WWII Army and Navy service records available through the National Personnel Records Center.',
  'wwii':                 'World War II veteran (1939–1945, US entry 1941). WWII Army and Navy service records available through the National Personnel Records Center.',
  'korean war':           'Korean War veteran (1950–1953). Service records at the National Personnel Records Center.',
  'vietnam':              'Vietnam War veteran (1955–1975, US combat role 1965–1973). Records at the National Personnel Records Center.',
  'vfw':                  'Veterans of Foreign Wars (VFW) — membership indicates overseas combat service. VFW posts kept membership records.',
  'american legion':      'American Legion — veterans\' organisation founded 1919 for WWI veterans; later expanded to all wartime veterans. Local post records may survive.',
  'navy':                 'United States Navy service. Discharge papers (DD-214 or earlier equivalents) and ship logs may be available through the National Archives.',
  'marine':               'United States Marine Corps service. Discharge records and unit histories at the National Archives.',
  'air force':            'United States Air Force (established 1947; prior service under Army Air Forces). Service records at the National Personnel Records Center.',
  'army':                 'United States Army service. Service records at the National Personnel Records Center.',
  'infantry':             'Infantry soldier — ground combat branch. Unit records and muster rolls may survive at the National Archives.',
  'cavalry':              'Cavalry soldier — mounted combat branch. Unit muster rolls may survive at the National Archives.',
  'coast guard':          'United States Coast Guard service. Records at the National Personnel Records Center.',
  'merchant marine':      'Merchant Marine — civilian mariners who served supply and transport roles in wartime; not always eligible for veterans\' benefits despite wartime service.',

  // ── Fraternal & Civic Orders ──────────────────────────────────────────────
  'masonic':              'Freemasonry — square and compass emblem. One of the oldest and most widespread fraternal orders; emphasised moral uprightness, brotherhood, and community service. Local lodge records and Grand Lodge archives often survive.',
  'freemason':            'Freemasonry — one of the oldest fraternal orders, emphasising moral uprightness and brotherhood. Lodge membership records often survive in Grand Lodge archives.',
  'square and compass':   'Freemasonry square and compass emblem — indicates lodge membership. Grand Lodge archives may hold membership and obituary records.',
  'odd fellows':          'Independent Order of Odd Fellows (IOOF) — fraternal organisation founded in the US in 1819, emphasising friendship, love, and truth. Local lodge records and Rebekah Assembly records may survive.',
  'ioof':                 'Independent Order of Odd Fellows (IOOF) — major 19th-century fraternal order. Lodge records and Rebekah Assembly records may survive.',
  'rebekah':              'Daughters of Rebekah — women\'s auxiliary of the Odd Fellows (IOOF), founded 1851. Emphasised charity and community service.',
  'elks':                 'Benevolent and Protective Order of Elks (BPOE) — fraternal organisation founded 1868, originally in New York City. Emphasised charity, justice, brotherly love, and fidelity.',
  'bpoe':                 'Benevolent and Protective Order of Elks (BPOE) — founded 1868. Major American fraternal order emphasising charity and community.',
  'knights of columbus':  'Knights of Columbus — Catholic men\'s fraternal organisation, founded 1882 by Father Michael McGivney in New Haven, Connecticut. Emphasised faith, unity, charity, and patriotism.',
  'eastern star':         'Order of the Eastern Star (OES) — Masonic-affiliated organisation open to women and men, founded in the 1850s. Five-pointed star emblem. Emphasised charitable works.',
  'oes':                  'Order of the Eastern Star (OES) — Masonic-affiliated fraternal organisation for women and men. Five-pointed star with five biblical heroines represented by each point.',
  'pythias':              'Knights of Pythias — fraternal organisation founded 1864 in Washington D.C.; first to be chartered by an Act of Congress. Emphasised friendship, charity, and benevolence.',
  'woodmen':              'Woodmen of the World (WOW) — fraternal benefit society founded 1890. Notable for providing free grave markers (often tree-stump shaped) to members.',
  'moose':                'Loyal Order of Moose — fraternal and service organisation founded 1888. Known for Mooseheart (child welfare community) and Moosehaven (retirement community).',
  'eagles':               'Fraternal Order of Eagles — founded 1898 in Seattle. Credited with lobbying for Social Security and Mother\'s Day legislation.',
  'foresters':            'Independent Order of Foresters — fraternal benefit society providing life insurance and community service since the 1870s.',
  'redmen':               'Improved Order of Red Men — one of the oldest fraternal organisations in the US, tracing roots to the Sons of Liberty (1765). Adopted Native American ceremonial themes.',
  'shriners':             'Ancient Arabic Order of the Nobles of the Mystic Shrine (Shriners) — Masonic appendant body, founded 1870. Known for Shriners Hospitals for Children.',

  // ── Religious & Funerary Symbols ─────────────────────────────────────────
  'anchor':               'Anchor — conventional 19th-century funerary symbol of hope, steadfastness, or Christian faith (Hebrews 6:19: "an anchor for the soul"). Also used to indicate maritime occupations or naval service.',
  'cross':                'Cross — universal Christian symbol of faith, resurrection, and eternal life. Specific cross styles carry additional meaning: Latin (general Christianity), Celtic (Irish/Scottish heritage), Eastern Orthodox (three crossbars).',
  'dove':                 'Dove — symbol of peace, the Holy Spirit, purity, and the soul departing in peace. Common on Victorian-era stones, especially for women and children.',
  'lamb':                 'Lamb — symbol of innocence, gentleness, and purity; most commonly found on children\'s graves. Also the "Lamb of God" in Christian iconography.',
  'angel':                'Angel — messenger of God; symbolises guardianship, resurrection, and the soul\'s passage to heaven. Weeping angels indicate mourning; trumpeting angels indicate resurrection.',
  'weeping willow':       'Weeping willow — 18th- and 19th-century symbol of mourning, grief, and sorrow. One of the most common early American funerary symbols.',
  'urn':                  'Funerary urn — symbol of mourning, mortality, and the vessel of the soul. Often draped with cloth in neoclassical memorial art of the 18th–19th centuries.',
  'draped urn':           'Draped urn — neoclassical mourning symbol popular 1780–1850; draped cloth symbolises the veil between life and death.',
  'wreath':               'Wreath — symbol of victory, honour, and eternal life. A laurel wreath indicates achievement or civic distinction; an oak wreath indicates strength.',
  'laurel':               'Laurel wreath — classical symbol of achievement, honour, and victory. Indicates civic, military, or professional distinction.',
  'oak':                  'Oak leaf or acorn — symbol of strength, longevity, and endurance. Also associated with civic virtue in neoclassical iconography.',
  'ivy':                  'Ivy — symbol of immortality, memory, and friendship. Commonly used on Victorian graves to indicate undying remembrance.',
  'palm':                 'Palm branch — symbol of victory, righteousness, and martyrdom in Christian tradition. Also associated with pilgrimage.',
  'torch':                'Torch — inverted torch symbolises a life extinguished; upright torch symbolises immortality and the eternal flame of memory.',
  'inverted torch':       'Inverted torch — life extinguished; common funerary symbol of the 19th century indicating death.',
  'hourglass':            'Hourglass — symbol of the passage of time and the brevity of life. Often depicted with wings ("time flies") on colonial and early 19th-century stones.',
  'winged hourglass':     'Winged hourglass — "time flies"; a memento mori symbol popular on 17th–18th-century New England gravestones.',
  'skull':                'Skull or death\'s head — memento mori ("remember that you will die"); common on colonial American gravestones before 1750, gradually replaced by cherubs and urns.',
  'skull and crossbones': 'Skull and crossbones — memento mori symbol popular on 17th–18th-century gravestones; mortality reminder, not a pirate symbol in this context.',
  'cherub':               'Cherub or winged cherub — symbolises the soul of the deceased ascending to heaven; replaced the skull as the dominant motif on New England gravestones after ~1720.',
  'sun':                  'Rising sun — symbol of resurrection and the promise of eternal life. Setting sun (half-circle below horizon) sometimes indicates death.',
  'star':                 'Star — may symbolise divine guidance, the soul, or celestial immortality. A six-pointed Star of David indicates Jewish faith.',
  'star of david':        'Star of David — indicates Jewish faith. Jewish gravestones typically face west and bear Hebrew inscriptions; the stone may include a menorah or hands in priestly blessing.',
  'menorah':              'Menorah — Jewish symbol; indicates Jewish faith. Seven-branched menorah represents the Temple in Jerusalem.',
  'hands':                'Clasped hands — commonly symbolise marriage, farewell at death, or the bond between the living and the deceased. Upward-pointing hand indicates the soul\'s ascent to heaven.',
  'clasped hands':        'Clasped hands — symbolise the union of marriage, a farewell gesture at death, or the fraternal bond of a lodge or order.',
  'pointing hand':        'Pointing hand (manicule) — upward-pointing hand (index finger) indicates the soul\'s ascent to heaven or divine direction.',
  'broken column':        'Broken column — life cut short; common Victorian symbol for a life ended prematurely or a head of household who died leaving the family incomplete.',
  'broken ring':          'Broken ring or chain link — a life broken by death; often used on the graves of young people or those who left families behind.',
  'book':                 'Open book — the Bible or the Book of Life; indicates Christian faith and the recording of the deceased\'s deeds. Also used for teachers, scholars, or clergy.',
  'bible':                'Bible — indicates Christian faith; suggests the deceased was devout or involved in church life.',
  'rose':                 'Rose — symbol of love, beauty, and the Virgin Mary. A full-bloom rose indicates a life fully lived; a rosebud indicates a life cut short (especially for children or young adults).',
  'rosebud':              'Rosebud — a life cut short before it fully bloomed; common on graves of children, young women, or those who died young.',
  'thistle':              'Thistle — Scottish national emblem; indicates Scottish heritage or ancestry.',
  'shamrock':             'Shamrock — Irish national emblem; indicates Irish heritage or ancestry. Also associated with St. Patrick and the Holy Trinity.',
  'harp':                 'Harp — Irish cultural symbol; indicates Irish heritage. Also associated with King David and celestial music.',
  'heart':                'Heart — symbol of love, devotion, and the Sacred Heart of Jesus in Catholic tradition.',
  'ihs':                  'IHS — Christogram derived from the Greek name for Jesus (ΙΗΣΟΥΣ); indicates Christian, often Catholic or High Church Protestant, faith.',
  'chi rho':              'Chi Rho (☧) — one of the earliest Christian symbols, combining the first two letters of Christ\'s name in Greek. Indicates Christian faith.',
  'alpha omega':          'Alpha and Omega (Α Ω) — "I am the beginning and the end" (Revelation 1:8); indicates Christian faith and the eternal nature of God.',
  'fleur de lis':         'Fleur-de-lis — French heraldic symbol associated with the Virgin Mary, French heritage, or the Boy Scouts of America.',
  'eagle':                'Eagle — American patriotic symbol; also used by fraternal orders. In Christian iconography, the eagle symbolises resurrection and St. John the Evangelist.',
};

// Build a symbol context block from OCR-detected symbols. Returns a formatted
// string ready for prompt injection, or empty string if no symbols matched.
function _buildSymbolContext(symbols) {
  if (!Array.isArray(symbols) || symbols.length === 0) return '';
  const symbolStr = symbols.join(' ').toLowerCase();
  const matched = [];
  const seen = new Set();
  for (const [key, context] of Object.entries(_SYMBOL_CONTEXT)) {
    if (symbolStr.includes(key) && !seen.has(context)) {
      matched.push(`- ${context}`);
      seen.add(context);
    }
  }
  if (matched.length === 0) return '';
  return 'SYMBOL CONTEXT (conventional meanings for this era — use these as grounded context when describing symbols on the stone):\n' + matched.join('\n');
}

// Build a cross-source corroboration summary for the biography prompt.
// Detects name/date agreement and conflicts across WikiTree, Wikidata, FindAGrave,
// obituaries, BillionGraves, and Chronicling America so the model can cite with
// appropriate confidence instead of silently blending conflicting claims.
// wikidataResult: optional { birthDate, deathDate, burialPlaceLabel } from queryWikidata().
function _buildCorroborationSummary(graveData, searchResults, wikiData, wikidataResult) {
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
function _validateCitations(parsed) {
  if (!parsed?.biography) return parsed;
  const raw = (parsed.citations || []).filter(c => c && Number.isInteger(c.n) && c.n >= 1);
  const sorted = [...raw].sort((a, b) => a.n - b.n);

  // Build a remap so non-sequential n values align to 1-based sources array
  const nMap = {};
  sorted.forEach((c, i) => { nMap[c.n] = i + 1; });

  let bio = parsed.biography.replace(/\[(\d+)\]/g, (match, nStr) => {
    const mapped = nMap[parseInt(nStr, 10)];
    return mapped ? `[${mapped}]` : '';
  });
  // Strip non-numeric bracket labels the model sometimes invents (e.g.
  // "[Inscription]", "[Notes]", "[Web]"). Only numeric [N] citations are valid.
  bio = bio.replace(/\[(?!\d+\])[^\]]*\]/g, '');
  bio = bio.replace(/[ \t]{2,}/g, ' ').replace(/\s+([.,;!?])/g, '$1');

  return {
    ...parsed,
    biography: bio,
    sources:     sorted.map(c => c.description || ''),
    source_urls: sorted.map(c => c.url || ''),
  };
}

// ── GEMINI: GENERATE BIOGRAPHY ───────────────────────────────────
// wikidataResult: optional result from queryWikidata() — structured dates + burial place.
async function generateBiography(graveData, searchResults, wikiData, location, wikipediaSummary, wikidataResult) {
  // Confidence floor — if no web results, no WikiTree record, and no Wikipedia
  // summary came back, do not call the LLM at all: return a short biography drawn
  // strictly from the stone itself to prevent hallucination.
  const hasRealSources = (searchResults && searchResults.length > 0) || (wikiData != null) ||
    (Array.isArray(wikipediaSummary) ? wikipediaSummary.some(Boolean) : wikipediaSummary != null);
  if (!hasRealSources) {
    console.log('📜 No real sources — returning stone-only biography, skipping LLM.');
    // Prefer the deceased-subjects list so a shared family stone with no web sources
    // still names every person, consistent with isMultiSubject elsewhere.
    const _fbSubs = Array.isArray(graveData.subjects) ? graveData.subjects.filter(s => s && s.name) : [];
    const allPeople = _fbSubs.length > 1 ? _fbSubs.map(s => s.name) : (graveData.names || []).filter(Boolean);
    const who = allPeople.length > 1
      ? allPeople.join(' and ')
      : (graveData.primary_name || allPeople[0] || 'an individual');
    const bday = graveData.birth_date ? `, born ${graveData.birth_date}` : '';
    const dday = graveData.death_date ? ` and passed ${graveData.death_date}` : '';
    const insc = graveData.inscription
      ? ` Their stone bears the words: "${graveData.inscription}".`
      : '';
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
      location: location || ''
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

  const corroborationContext = _buildCorroborationSummary(graveData, searchResults, wikiData, wikidataResult);

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

  const locationContext = location ? `Cemetery location: ${location}` : 'Cemetery location: unknown — infer from research results if possible.';

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

  const symbolContext = _buildSymbolContext(graveData.symbols);

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
${symbolContext ? '\n' + symbolContext : ''}

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
- MINES EACH SOURCE for every concrete biographical fact it states — do not treat sources as mere date-confirmation. An obituary or memorial often names the person's occupation or life's work, their spouse and children and grandchildren by name, their siblings, their hobbies and interests, places they lived, and their church or community ties. Surface every such verifiable detail the sources contain (each cited with [N]); a story that mentions a 43-year career or names the surviving children is far richer than one that only restates the stone. Never invent these details — but never omit one the sources actually provide
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

FORMATTING (the "biography" output field is rendered as plain text, split into paragraphs on blank lines):
- Separate every paragraph with a blank line (\\n\\n). Never return the whole biography as one unbroken block.
- ${isMultiSubject ? 'Give each person their OWN paragraph(s) — start a new paragraph (with a blank line) when you move from one person to the next. Do not run the lives of two people together in a single paragraph.' : 'Use a new paragraph for each distinct phase of the life (early life, career, family, legacy).'}
- The ONLY brackets allowed in the biography text are numeric citation markers like [2] or [2][4]. NEVER write label-style brackets such as [Inscription], [Notes], [Stone], or [Wikipedia] in the prose — they are not citations and look broken to the reader. To refer to the inscription, write "the inscription reads…" in plain words, with no bracket.

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

  const { data } = await geminiCallWithFallback({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 8000,
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA,
    }
  });
  if (data.error) throw new Error(data.error.message);

  const text = data.candidates[0].content.parts[0].text;
  console.log('BIOGRAPHY RAW:', text);
  const parsed = safeParseJSON(text, null);
  if (parsed && parsed.biography) return _validateCitations(parsed);

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
