// A canned example story shown on first run (and via "See an Example" on Home)
// so a brand-new user sees what GraveStory produces BEFORE spending a scan.
//
// Shape matches what ResultScreen renders (name, dates, biography, location,
// inscription, symbols + symbol_meanings, sources, portraits, and the Mentions
// sheet). Deliberately a well-known long-dead figure (Marie Curie, d. 1934) so the
// example is genuinely impressive AND carries zero living-relative/privacy concern.
// NOT marked _unsaved/_pending/_isGlobal, and carries _isSample so ResultScreen can
// hide save/delete/tribute affordances and never persist it. No gps / grave_id →
// map + tribute sections stay hidden.
//
// SHOWCASE NOTE: this sample is the canonical demo of EVERY bio feature, so it sets
// portraits, tappable symbol-meaning chips, the Mentions sheet, and the kinship
// kernel (subjects/relationships). When a new bio feature ships, update this story
// so the example keeps demonstrating the full output. All mention/portrait URLs are
// verified-live (Wikimedia 500px thumbnails; the source links resolve in-browser).
// Keep the biography + sources/source_urls VERBATIM — the inline [1][2][3] markers
// are index-aligned to sources[0..2]/source_urls[0..2]; reordering breaks them.

export const SAMPLE_STORY = {
  _isSample: true,
  name: 'Marie Skłodowska Curie',
  dates: '1867 – 1934',
  location: 'The Panthéon, Paris, France',
  // Two portraits — Marie and her husband/collaborator Pierre (both long deceased).
  // Web shape is portrait_left_url/right_url; mobile reads the portraits[] array via
  // normalizePortraits(). Verified-live Wikimedia Commons thumbnails (HTTP 200 JPEG).
  portraits: [
    'https://upload.wikimedia.org/wikipedia/commons/thumb/c/c8/Marie_Curie_c._1920s.jpg/500px-Marie_Curie_c._1920s.jpg',
    'https://upload.wikimedia.org/wikipedia/commons/thumb/d/db/Pierre_Curie_by_Dujardin_c1906.jpg/500px-Pierre_Curie_by_Dujardin_c1906.jpg',
  ],
  biography:
    "Born Maria Skłodowska in Warsaw in 1867, under a Russian occupation that barred women from its universities, she taught herself in a clandestine \"Flying University\" and worked as a governess to fund her sister's medical studies — on the promise the favour would one day be returned. [1]\n\n" +
    "In 1891 she travelled to Paris and enrolled at the Sorbonne, where she often studied so late and ate so little that she fainted from hunger over her books. There she met Pierre Curie, a physicist who shared her devotion to research; they married in 1895 and made the laboratory the centre of their life together. [2]\n\n" +
    "Investigating the mysterious rays given off by uranium, she coined the term \"radioactivity\" and, with Pierre, isolated two new elements — polonium, named for her homeland, and radium. The work was punishing: she refined tonnes of pitchblende by hand in a leaking shed. In 1903 the Curies shared the Nobel Prize in Physics, making Marie the first woman ever to receive one. [1][3]\n\n" +
    "Pierre's sudden death in 1906 left her grief-stricken but undeterred; she took over his professorship, becoming the first woman to teach at the Sorbonne. In 1911 she won a second Nobel Prize, this time in Chemistry — and remains the only person ever honoured in two different sciences. During the First World War she equipped mobile X-ray units, the \"petites Curies,\" and drove them to the front herself to help surgeons locate shrapnel. [2][3]\n\n" +
    "She died in 1934 of aplastic anaemia, almost certainly caused by her decades of exposure to the radiation she had named. Her notebooks remain so radioactive that they are still kept in lead-lined boxes. In 1995 she was reinterred in the Panthéon — the first woman laid there for her own achievements. [1]",
  inscription: 'MARIE CURIE-SKŁODOWSKA · 1867–1934',
  // 'laurel' and 'open book' resolve their chip text from the STATIC SYMBOL_CONTEXT
  // table (table-first lookup wins). 'atomic symbol' is NOT in the table, so its
  // chip text comes from the per-story symbol_meanings map below — that entry is
  // what genuinely demonstrates the AI-resolved-meaning path on the sample (and it
  // is thematically perfect for Curie). All three render as tappable gold chips.
  symbols: ['laurel', 'open book', 'atomic symbol'],
  // Per-story symbol meanings → tappable gold chips with a bottom-sheet explanation.
  // Keys MUST match the `symbols` strings exactly. Only 'atomic symbol' actually
  // reaches this map (the other two are satisfied by the static table first); it is
  // the entry that exercises the per-story path the scan fills for table-missed symbols.
  symbol_meanings: {
    'atomic symbol': 'Atomic symbol — orbiting electrons around a nucleus, an emblem of science and discovery. On this memorial it honours a pioneer of radioactivity who named two new elements and reshaped our understanding of matter.',
  },
  sources: [
    'Wikipedia — Marie Curie',
    'Nobel Prize biographical archive',
    'Encyclopædia Britannica — Marie Curie',
  ],
  source_urls: [
    'https://en.wikipedia.org/wiki/Marie_Curie',
    'https://www.nobelprize.org/prizes/physics/1903/marie-curie/biographical/',
    'https://www.britannica.com/biography/Marie-Curie',
  ],
  // Kinship kernel — the structured family data the scan now persists (drives
  // GEDCOM export; read defensively everywhere). Both people are long deceased, so
  // naming Pierre carries no privacy concern. Export/UI for these stay hidden on the
  // read-only sample, but the data demonstrates the shape.
  // Two deceased subjects so the spouse relationship below resolves to a real
  // GEDCOM FAM (a faithful, exportable-shaped demo of the kinship kernel). Both are
  // long dead (Marie 1934, Pierre 1906) — no living-name concern. (Export is hidden
  // on the read-only sample, but the data shape is correct for when it isn't.)
  subjects: [
    { name: 'Marie Skłodowska Curie', birth_date: '1867', death_date: '1934' },
    { name: 'Pierre Curie', birth_date: '1859', death_date: '1906' },
  ],
  maiden_name: 'Skłodowska',
  relationships: [
    { relation: 'spouse', name: 'Pierre Curie' },
  ],
  // Mentions — name-safe one-line source hyperlinks shown in the "Also found in…"
  // bottom sheet. All URLs verified-live. Sentences name only the deceased subjects
  // (Marie + her long-dead husband Pierre), per the public name-safety rule.
  mentions: [
    { sentence: 'Read her full life and discoveries on Wikipedia.', url: 'https://en.wikipedia.org/wiki/Marie_Curie', source: 'wikipedia', year: null },
    { sentence: 'Her official Nobel Prize in Physics biography (1903).', url: 'https://www.nobelprize.org/prizes/physics/1903/marie-curie/biographical/', source: 'web', year: '1903' },
    { sentence: 'Her second Nobel Prize, in Chemistry (1911).', url: 'https://www.nobelprize.org/prizes/chemistry/1911/marie-curie/facts/', source: 'web', year: '1911' },
    { sentence: 'Burial record at the Panthéon on Find a Grave.', url: 'https://www.findagrave.com/memorial/1600/marie-curie', source: 'web', year: null },
    { sentence: 'Encyclopaedia Britannica biography of the physicist and chemist.', url: 'https://www.britannica.com/biography/Marie-Curie', source: 'web', year: null },
  ],
  graveData: {
    inscription: 'MARIE CURIE-SKŁODOWSKA · 1867–1934',
    symbols: ['laurel', 'open book', 'atomic symbol'],
  },
};
