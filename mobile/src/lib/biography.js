import { PROXY_BASE } from './config';
import { proxyHeaders } from './scan-token';
import { safeParseJSON } from './util-json';

// Maps lowercased symbol keywords (as returned by Gemini OCR) to their conventional
// funerary/fraternal meaning. Injected into the bio prompt so Gemini has grounded
// context rather than recalling from training alone — especially useful for obscure
// fraternal emblems where training data is thin.
export const SYMBOL_CONTEXT = {
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

  // ── Plants, Harvest & Nature ─────────────────────────────────────────────
  'sheaf of wheat':       'Sheaf of wheat — a long life brought to fruition; the divine harvest gathering the soul home. Most often marks someone who lived to old age. Also a Masonic and agricultural emblem.',
  'wheat':                'Wheat — symbol of a fruitful life and the divine harvest, usually marking a person who reached old age. The body is "gathered in" like ripened grain.',
  'lily':                 'Lily — purity, innocence, and resurrection; associated with the Virgin Mary and Easter. Common on the graves of women and children.',
  'calla lily':           'Calla lily — marriage, fidelity, and resurrection; a frequent Victorian funerary flower symbolising beauty and rebirth.',
  'columbine':            'Columbine — a symbol of the Holy Spirit (its petals likened to seven doves) and of innocence; also a quiet emblem of sorrow.',
  'lily of the valley':   'Lily of the valley — renewal, humility, and the return of happiness; its early spring bloom made it a symbol of resurrection.',
  'forget-me-not':        'Forget-me-not — remembrance and enduring love; also a symbol used by some fraternal and memorial orders to mean "never forgotten".',
  'poppy':                'Poppy — eternal sleep, rest, and consolation; in the 20th century also a symbol of wartime remembrance.',
  'morning glory':        'Morning glory — the brevity of life and the resurrection; its bloom opens and fades within a single day.',
  'sunflower':            'Sunflower — devotion and faith, the soul turning toward God as the flower turns toward the sun.',
  'daisy':                'Daisy — innocence and purity; very commonly found on the graves of children.',
  'pansy':                'Pansy — remembrance and loving thoughts; the name derives from the French "pensée" (thought).',
  'fern':                 'Fern — sincerity, humility, and solitude; its sheltering fronds suggested a quiet, sincere life.',
  'acorn':                'Acorn — strength, potential, and the promise of life; often paired with the oak to signify a life of endurance or one cut short before maturity.',
  'olive branch':         'Olive branch — peace, reconciliation, and the soul at rest with God.',
  'grapes':               'Grapes and vine — the blood of Christ and the Eucharist; faith and the connection between God and the faithful (John 15:5, "I am the vine").',
  'tree of life':         'Tree of life — immortality, the connection between earth and heaven, and the regeneration of the soul.',
  'tree stump':           'Tree stump or "tree-stump" monument — a life cut short; most famously the rustic markers provided to members of Woodmen of the World. Cut branches may represent deceased family members.',
  'thorns':               'Crown of thorns — the suffering and sacrifice of Christ; signifies a devout faith and earthly trials endured.',

  // ── Passage, Faith & Eternity ────────────────────────────────────────────
  'gates of heaven':      'Gates of Heaven (or pearly gates) — the soul\'s passage from earthly life into the kingdom of heaven; entry into eternal reward.',
  'gates':                'Gates — the threshold between life and death; an open gate signifies the soul\'s passage into heaven.',
  'pearly gates':         'Pearly gates — the entrance to heaven (Revelation 21:21); the soul welcomed into eternal life.',
  'ladder':               'Ladder — Jacob\'s ladder; the soul\'s ascent from earth to heaven and the link between the mortal and divine.',
  'crown':                'Crown — victory over death and the reward of eternal life ("crown of righteousness", 2 Timothy 4:8); a soul that has triumphed in faith.',
  'crown and cross':      'Crown and cross — the reward of heaven (crown) earned through the trials of earthly faith (cross); "no cross, no crown".',
  'harp and crown':       'Harp and crown — a soul that has reached its heavenly reward; the harp signifying celestial worship and the crown signifying victory.',
  'open gate':            'Open gate — the soul\'s passage into heaven, welcomed into eternal life.',
  'circle':               'Circle or ring — eternity and the unending nature of the soul; a wedding ring may also signify a devoted marriage.',
  'wheel':                'Wheel — eternity and the cycle of life; a broken wheel can signify a life ended.',
  'trumpet':              'Trumpet — the call to resurrection on Judgement Day (1 Corinthians 15:52); often held by an angel.',
  'lily and cross':       'Lily and cross — purity (lily) joined to Christian faith and resurrection (cross), commonly marking a devout woman or child.',
  'chalice':              'Chalice — the Holy Communion and Christian faith; may indicate clergy or a deeply devout life.',
  'praying hands':        'Praying hands — devotion, piety, and a soul commending itself to God; a frequent emblem of a faithful Christian life.',
  'finger pointing up':   'Hand with finger pointing upward — the soul\'s ascent to heaven and the hope of reward above.',
  'shell':                'Scallop shell — pilgrimage and the journey of life; a symbol of baptism and of St. James, and an emblem of the Christian pilgrim.',
  'scallop':              'Scallop shell — pilgrimage, baptism, and the journey of the soul; long associated with St. James and the Camino pilgrimage.',
  'butterfly':            'Butterfly — resurrection and the transformation of the soul; the chrysalis-to-butterfly metamorphosis mirrors death and rebirth. Often marks a child\'s grave.',
  'phoenix':              'Phoenix — resurrection and immortality; the soul rising renewed from death.',

  // ── Occupations & Trades ─────────────────────────────────────────────────
  'caduceus':             'Caduceus / rod of Asclepius — the medical profession; marks a physician, surgeon, or healer.',
  'scales':               'Scales of justice — the legal profession or a life devoted to fairness; marks a judge, lawyer, or magistrate.',
  'gavel':                'Gavel — the law or a fraternal officer\'s authority; may mark a judge, or a lodge officer (the gavel is also a Masonic working tool).',
  'plow':                 'Plough — a farmer or a life of honest agricultural labour; also signifies industry and the cultivation of the soul.',
  'hammer':               'Hammer — a tradesman, blacksmith, or craftsman; in Masonic use, one of the working tools signifying labour and self-improvement.',
  'rake':                 'Rake and agricultural tools — a farmer or gardener; a life of cultivation and honest work.',
  'palette':              'Artist\'s palette — a painter or artist; a life devoted to the visual arts.',
  'musical notes':        'Musical notes or instruments — a musician, composer, or chorister; a life filled with music, and the heavenly choir.',
  'open book and pen':    'Open book with pen — a writer, scholar, teacher, or clergyman; a life of learning and the recording of deeds.',
  'locomotive':           'Locomotive or railroad emblem — a railroad worker; the railway was a defining 19th- and early-20th-century occupation.',
  'wheel of life':        'Wheel — eternity and the turning cycle of life and death.',

  // ── Memorial & Decorative ────────────────────────────────────────────────
  'draped cloth':         'Drapery or shroud — mourning and the veil between life and death; the cloth that covers the coffin, a common neoclassical mourning motif.',
  'garland':              'Garland — victory, distinction, and the celebration of a life well lived; a festoon of flowers honouring the deceased.',
  'flame':                'Eternal flame — the immortality of the soul and undying remembrance; the light of life that endures beyond death.',
  'lamp':                 'Lamp — knowledge, the light of the spirit, and immortality; an eternal lamp signifies a soul that lives on. Also an emblem of nursing (the lamp of Florence Nightingale).',
  'lantern':              'Lantern — the light of faith guiding the soul, and the hope of immortality.',
  'candle':               'Candle — the fragile flame of life and the light of the spirit; an extinguished candle signifies death.',
  'snake eating tail':    'Ouroboros (a snake eating its own tail) — eternity and the endless cycle of life, death, and renewal.',
  'all-seeing eye':       'All-seeing eye (Eye of Providence) — the watchful presence of God; also a Masonic emblem of divine oversight.',
  'crescent':             'Crescent moon — feminine and celestial symbolism, resurrection, and (with a star) a connection to faith; also a fraternal emblem in some orders.',
  'flag':                 'Flag — patriotic service or national pride; often marks a veteran or a person of civic devotion.',
};

// Build a symbol context block from OCR-detected symbols. Returns a formatted
// string ready for prompt injection, or empty string if no symbols matched.
function buildSymbolContext(symbols) {
  if (!Array.isArray(symbols) || symbols.length === 0) return '';
  const symbolStr = symbols.join(' ').toLowerCase();
  const matched = [];
  const seen = new Set();
  for (const [key, context] of Object.entries(SYMBOL_CONTEXT)) {
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
function buildCorroborationSummary(graveData, searchResults, wikiData, wikidataResult) {
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
    archive: 'Internet Archive',
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

// FIX 4 helper — turn a burial-place recovery candidate into an ATTRIBUTIVE,
// source-cited interment sentence (not an assertion, not generated by an LLM).
// Returns { sentence, sourceLabel, sourceUrl, location } or null when there is no
// citable source to anchor the claim (no source URL → no claim, stays conservative).
// The phrasing reports what the public records SAY ("is recorded as interred"),
// so GraveStory is a reporter of sourced facts, not the originator of the claim.
function buildBurialCandidatePartial(burialCandidate, location) {
  if (!burialCandidate || !burialCandidate.name) return null;
  const place = burialCandidate.burialPlaceLabel || (location ? location.split(',')[0] : '') || 'this cemetery';
  // Name the person ONLY when an INDEPENDENT Wikipedia article confirmed them.
  // A Wikidata-only citation is the same single burial edge that produced the
  // guess (self-citation) — not corroboration — so without confirmation we
  // surface no name at all and fall through to the neutral paragraph. [review M1]
  if (!burialCandidate._wikiConfirmed || !burialCandidate.wikipediaTitle) return null;
  const sourceLabel = `Wikipedia: ${burialCandidate.wikipediaTitle}`;
  const sourceUrl = `https://en.wikipedia.org/wiki/${encodeURIComponent(burialCandidate.wikipediaTitle.replace(/ /g, '_'))}`;
  const yrs = [burialCandidate.birthDate?.slice(0, 4), burialCandidate.deathDate?.slice(0, 4)]
    .filter(Boolean).join('–');
  const who = yrs ? `${burialCandidate.name} (${yrs})` : burialCandidate.name;
  const sentence = `According to Wikipedia and Wikidata, ${who} is recorded as interred at ${place}.`;
  return {
    sentence,
    sourceLabel,
    sourceUrl,
    location: burialCandidate.burialPlaceLabel || location || '',
  };
}

// Validate and normalise the structured citations returned by Gemini.
// Sorts by n, remaps any non-sequential numbers to 1,2,3..., strips orphan
// [N] markers, and produces sources/source_urls arrays for backwards-compat
// with storage and display code.
function validateCitations(parsed) {
  if (!parsed?.biography) return parsed;
  const raw = (parsed.citations || []).filter(c => c && Number.isInteger(c.n) && c.n >= 1);
  const sorted = [...raw].sort((a, b) => a.n - b.n);

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

const PRIMARY  = 'gemini-3.1-flash-lite';
const FALLBACK = 'gemini-2.5-flash';
const TIMEOUT_MS = 30000;

// Duplicated locally rather than imported from api-gemini.js: api-gemini.js
// imports SYMBOL_CONTEXT from this module, so importing back would create a
// circular dependency. The biography call has the largest payload / longest
// generation, so it's the call most likely to hang on flaky cellular — without
// a timeout a stall would freeze the whole scan pipeline indefinitely. The
// reject is caught by CameraScreen's pipelineError handler ("Analysis Failed" +
// queue-for-later), same as any other failed Gemini call.
function fetchWithTimeout(url, init) {
  return Promise.race([
    fetch(url, init),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Gemini request timed out')), TIMEOUT_MS)
    ),
  ]);
}

async function geminiText(payload) {
  const init = {
    method: 'POST',
    // generateBiography runs INSIDE the scan window — /gemini is scan-token gated,
    // so attach X-Scan-Token via proxyHeaders() or it 403s once enforcement is on.
    headers: proxyHeaders(),
    body: JSON.stringify(payload),
  };
  try {
    const res = await fetchWithTimeout(`${PROXY_BASE}/gemini/${PRIMARY}`, init);
    const data = await res.json().catch(() => ({ error: {} }));
    if (res.status !== 503 && res.status !== 429 && !data.error) return data;
  } catch {}
  const res2 = await fetchWithTimeout(`${PROXY_BASE}/gemini/${FALLBACK}`, init);
  return res2.json().catch(() => ({ error: { message: 'Invalid JSON' } }));
}

// wikidataResult: optional result from queryWikidata() — structured dates + burial place.
// burialCandidate: optional result from queryWikidataByBurialPlace() — a famous person
//   recovered from cemetery+surname when name-first paths found nobody (e.g. a bare
//   "BOOTH" banner → John Wilkes Booth). It is a CANDIDATE: named only as a sourced,
//   attributive interment fact, never asserted as the bio's subject from memory.
//   `_wikiConfirmed` is true when an independent Wikipedia article confirmed the person.
export async function generateBiography(graveData, searchResults, wikiData, location, wikipediaSummary, wikidataResult, burialCandidate) {
  // wikiData is an ARRAY on multi-subject stones (wikiTreeResults.filter(Boolean)),
  // which is [] when every lookup failed — and [] != null is true, which would
  // wrongly count it as a real source and skip the stone-only no-LLM fallback,
  // calling Gemini with zero sources. Treat an empty array as no source.
  const hasRealSources = (searchResults && searchResults.length > 0) ||
    (Array.isArray(wikiData) ? wikiData.length > 0 : wikiData != null) ||
    (Array.isArray(wikipediaSummary) ? wikipediaSummary.some(Boolean) : wikipediaSummary != null);
  if (!hasRealSources) {
    // Prefer the deceased-subjects list so a shared family stone with no web sources
    // still names every person, consistent with isMultiSubject elsewhere.
    const _fbSubs = Array.isArray(graveData.subjects) ? graveData.subjects.filter(s => s && s.name) : [];
    const allPeople = _fbSubs.length > 1 ? _fbSubs.map(s => s.name) : (graveData.names || []).filter(Boolean);
    const who = allPeople.length > 1
      ? allPeople.join(' and ')
      : (graveData.primary_name || allPeople[0] || 'an individual');
    const bday = graveData.birth_date ? `, born ${graveData.birth_date}` : '';
    const dday = graveData.death_date ? ` and passed ${graveData.death_date}` : '';
    const insc = graveData.inscription ? ` Their stone bears the words: "${graveData.inscription}".` : '';
    // FIX 4 — Famous-interment partial: surface a recovered notable interment as an
    // ATTRIBUTIVE, source-cited fact (never an assertion, never via Gemini), but ONLY
    // when an independent Wikipedia article confirmed the person. After the [review M1]
    // tightening, a Wiki-confirmed candidate always sets wikipediaSummary, which makes
    // hasRealSources true — so a confirmed candidate routes to the cited Gemini path
    // above and never reaches here. This branch therefore only ever returns the
    // unconfirmed → no-name result (buildBurialCandidatePartial returns null), i.e.
    // the neutral paragraph below. Kept as a defensive floor: if the routing ever
    // changes, a famous name still cannot appear here without Wikipedia confirmation.
    const _bcSrc = buildBurialCandidatePartial(burialCandidate, location);
    if (_bcSrc) {
      return {
        name: allPeople.length > 1 ? allPeople.join(' & ') : (graveData.primary_name || allPeople[0] || 'Unknown'),
        dates: (graveData.birth_date && graveData.death_date)
          ? `born ${graveData.birth_date} — died ${graveData.death_date}` : '',
        biography:
          `This stone marks the ${allPeople.length > 1 ? 'lives' : 'life'} of ${who}${bday}${dday}.${insc} ` +
          _bcSrc.sentence +
          ` The stone itself bears only the ${graveData.family_name ? 'surname' : 'name'}, so this is offered as a record-based possibility rather than a confirmed identification.`,
        sources: ['Gravestone inscription (primary source)', _bcSrc.sourceLabel],
        source_urls: ['', _bcSrc.sourceUrl],
        location: _bcSrc.location || location || '',
      };
    }
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
      location: location || '',
    };
  }

  const TYPE_LABELS = {
    verified_transcription: '[BillionGraves]',
    public_domain:          '[Chronicling America]',
    archive:                '[Internet Archive]',
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

  const corroborationContext = buildCorroborationSummary(graveData, searchResults, wikiData, wikidataResult);

  // wikiData may be an array (multi-person stones with one WikiTree result per person)
  const wikiDataItems = Array.isArray(wikiData) ? wikiData.filter(Boolean) : (wikiData ? [wikiData] : []);
  // Decision C (Inc2): build the WikiTree blob from an explicit ALLOWLIST.
  // JSON.stringify(wd) would auto-leak any NEW return field (e.g.
  // originatedRelatives) verbatim into the prompt with no control. Originated
  // names reach the prompt ONLY through the controlled synthetic [WikiTree]
  // source built at the call site (Decision B) — numbered, citable, and
  // findable by the deterministic public strip.
  const _WT_PROMPT_FIELDS = ['name', 'birth', 'death', 'birthLocation', 'deathLocation', 'wikiTreeId', 'bioSnippet'];
  const _wtAllow = wd => {
    const o = {};
    for (const k of _WT_PROMPT_FIELDS) if (wd[k] != null) o[k] = wd[k];
    return o;
  };
  const wikiContext = wikiDataItems.length > 0
    ? wikiDataItems.map((wd, i) =>
        wikiDataItems.length > 1
          ? `WikiTree genealogy record (person ${i + 1}): ${JSON.stringify(_wtAllow(wd))}`
          : `WikiTree genealogy record found: ${JSON.stringify(_wtAllow(wd))}`
      ).join('\n')
    : 'No WikiTree record found.';

  const wikidataContext = wikidataResult
    ? `Wikidata record: burial place "${wikidataResult.burialPlaceLabel || 'unknown'}", birth ${wikidataResult.birthDate || '?'}, death ${wikidataResult.deathDate || '?'}.`
    : '';

  const locationContext = location
    ? `Cemetery location: ${location}`
    : 'Cemetery location: unknown — infer from research results if possible.';

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

  const symbolContext = buildSymbolContext(graveData.symbols);

  // FIX 2 — Dateless famous-interment recovery. When the subject was recovered
  // from the cemetery's burial-place record (bare surname, no stone dates) AND an
  // independent Wikipedia article confirmed the same person, the standard
  // historical-figure gate (which demands stone dates within ±5 yr of the figure)
  // is unsatisfiable — there are no stone dates to compare. This block REPLACES
  // that check with an equal-or-stricter one (burial-place match + two independent
  // sources agreeing) and CAPS output to a short, fully-cited paragraph, so a
  // dateless stone can never unlock the long historical-figure treatment.
  const burialRecoveryBlock = (burialCandidate && burialCandidate._wikiConfirmed)
    ? `\nBURIAL-RECORD IDENTITY (dateless stone — special handling):
- This stone bears only a ${graveData.family_name ? 'surname' : 'name'} and no dates. The subject was identified NOT from the stone but from the cemetery's place-of-burial record: Wikidata records that ${burialCandidate.name} is buried at "${burialCandidate.burialPlaceLabel || (location || 'this cemetery')}", and a [Wikipedia article] in the numbered sources independently confirms that same person.
- Because the stone carries no dates, the usual ±5-year stone-date check cannot apply. It is REPLACED by this stricter requirement, which is already satisfied: the burial place matches AND two independent records (Wikidata + Wikipedia) confirm the same person.
- Write a SHORT, attributive, fully-cited account (a few sentences to one short paragraph — NOT the long historical-figure treatment, because the stone itself does not name this person). Make clear the identification comes from the cemetery's burial records, e.g. "Burial records identify this as the grave of …[N]" — attribute it, do not assert it as if read from the stone. Every factual claim must carry an [N] marker to the Wikipedia/Wikidata source. Do not pad with general knowledge beyond what the numbered sources support.\n`
    : '';

  // INCREMENT 2: when a synthetic [WikiTree] family-record source is present
  // (origination fired at the call site), the model MAY name those relatives —
  // but ONLY with the [N] anchor to that source, never from memory. If it cannot
  // cite the record, it must use the relationship word, not the name. These names
  // are stripped from the PUBLIC copy deterministically afterward.
  // The names are listed HERE in the ephemeral prompt instruction (NOT in the
  // citable source's description) so they can never be copied into a persisted
  // citation `description`/`sources` field that the public map renders unstripped
  // (C1 fix). Names are read from the raw wikiData, not the allowlisted context.
  const _hasOriginated = Array.isArray(searchResults) &&
    searchResults.some(r => r && r.source_type === 'wikitree' && /WikiTree family record/.test(r.title || ''));
  const _origNames = _hasOriginated
    ? wikiDataItems.flatMap(wd => Array.isArray(wd.originatedRelatives) ? wd.originatedRelatives : [])
        .filter(r => r && r.name).map(r => `${r.name} (${r.relation || 'relative'})`)
    : [];
  const originatedBlock = (_hasOriginated && _origNames.length)
    ? `\nFAMILY RECORD (genealogical, NOT on the stone): The [WikiTree] family-record source names the deceased's: ${_origNames.join('; ')}. These relatives are NOT engraved on this gravestone. You MAY weave them into the biography to enrich the family context, but ONLY when you append that source's [N] marker to the claim. If you cannot cite the record for a relative, refer to them by relationship only (e.g. "his wife") and do NOT state their name. Never state a relative's name without the [N] anchor. Do not assert anything about these relatives beyond their name and relationship.\n`
    : '';

  const prompt = `You are GraveStory AI, a careful historian writing a respectful life history.
Accuracy and dignity matter more than length or eloquence. Write only from the gravestone data and the numbered sources below. Do not use facts from memory or general knowledge unless a numbered source supports them. Never fabricate facts, relationships, events, or characterizations. A short, honest biography builds trust; an invented one destroys it.

GRAVESTONE DATA:
${JSON.stringify(graveData, null, 2)}
${multiSubjectBlock}${burialRecoveryBlock}${originatedBlock}
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

  // Hard-cap length for a burial-place-recovered subject. A dateless bare-surname
  // stone is identified by a cemetery-reverse heuristic, not a name match — even if
  // it coincidentally carries a year that satisfies the historical-figure date gate,
  // it must NOT unlock the ~2500-word from-memory treatment. Don't rely on the model
  // reconciling the two opposing length instructions in the prompt — enforce it. [review M3]
  const _viaBurial = !!(burialCandidate && burialCandidate._wikiConfirmed && burialCandidate._viaBurialPlace);
  const data = await geminiText({
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: _viaBurial ? 1400 : 8000,
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA,
    },
  });
  if (data.error) {
    const msg = typeof data.error === 'string' ? data.error : (data.error.message || data.error.status || JSON.stringify(data.error));
    throw new Error(msg || 'Gemini biography error');
  }

  const text = data.candidates[0].content.parts[0].text;
  const parsed = safeParseJSON(text, null);
  if (parsed?.biography) return validateCitations(parsed);

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
