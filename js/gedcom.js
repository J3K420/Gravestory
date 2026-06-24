// GEDCOM 5.5.1 generator — turns a saved story into a genealogy file that
// imports into Gramps / Ancestry / webtrees, so a genealogist can capture a
// gravestone into their family tree.
//
// SHARED LOGIC: the body of buildGedcom (and its helpers) is byte-identical to
// the mobile copy in mobile/src/lib/gedcom.js. Only the module wrapper differs
// (this is a classic script — top-level `function` declarations attach to window;
// mobile uses ES `export`). Mirrors how biography.js / SYMBOL_CONTEXT are kept
// identical across the two codebases. Load AFTER js/biography.js. Pure +
// deterministic (no I/O, no Date.now, '\n' line endings) so the two platforms
// produce identical output for the same story.
//
// Data source: the kinship kernel (migration 021) — story.subjects
// ([{name, birth_date, death_date}], one INDI each), story.relationships
// ([{relation, name}], the FAM links), story.maiden_name, story.family_name.
// Within-stone scope only: a FAM is emitted only when BOTH endpoints are people
// on this stone (no phantom individuals, no cross-grave linking). For a legacy
// story saved before the kernel (subjects empty), falls back to a single INDI
// built from story.name + the free-text story.dates. Never throws.

// ── helpers ──────────────────────────────────────────────────────────────────

// GEDCOM forbids '@' except in xref pointers; escape literal '@' as '@@'.
function escapeGed(s) {
  return String(s == null ? '' : s).replace(/@/g, '@@').replace(/[\r\n]+/g, ' ').trim();
}

// GEDCOM 5.5.1 caps a physical line at 255 chars. Push a tag line, splitting an
// over-long value across CONC continuation sub-lines so no emitted line exceeds
// the limit. Used for every free-text value field (NAME, PLAC, TITL, PUBL) whose
// content is unbounded AI/OCR text. `lvl`/`tag` are the parent line; CONC sub-lines
// are emitted at lvl+1.
function pushTag(lines, lvl, tag, value) {
  const v = String(value == null ? '' : value);
  const prefix = `${lvl} ${tag} `;
  // Conservative chunk so "lvl tag " + chunk and "lvl+1 CONC " + chunk both fit < 255.
  const MAX = 200;
  if (v.length <= MAX) { lines.push(prefix + v); return; }
  let rest = v;
  let first = true;
  while (rest.length > 0) {
    const chunk = rest.slice(0, MAX);
    rest = rest.slice(MAX);
    lines.push(first ? prefix + chunk : `${lvl + 1} CONC ${chunk}`);
    first = false;
  }
}

// Normalize a raw OCR date string to a GEDCOM DATE value, or null if no usable
// date. "1841" -> "1841"; "12 March 1841" / "March 12, 1841" -> "12 MAR 1841";
// anything else with a 4-digit year -> that year; otherwise null.
function formatGedcomDate(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const yearMatch = s.match(/\b(\d{4})\b/);
  if (!yearMatch) return null;
  const year = yearMatch[1];
  // Try to recover a day + month for a fuller DATE; fall back to year-only.
  const monthNames = {
    jan: 'JAN', january: 'JAN', feb: 'FEB', february: 'FEB', mar: 'MAR', march: 'MAR',
    apr: 'APR', april: 'APR', may: 'MAY', jun: 'JUN', june: 'JUN', jul: 'JUL', july: 'JUL',
    aug: 'AUG', august: 'AUG', sep: 'SEP', sept: 'SEP', september: 'SEP', oct: 'OCT', october: 'OCT',
    nov: 'NOV', november: 'NOV', dec: 'DEC', december: 'DEC',
  };
  const lower = s.toLowerCase();
  const monthMatch = lower.match(/\b(jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december)\b/);
  if (monthMatch) {
    const mon = monthNames[monthMatch[1]];
    // Only take a day that sits IMMEDIATELY beside the month token (either order:
    // "12 March" or "March 12") — NOT just any 1-31 number anywhere in the string
    // (else "January 1841, aged 12" would fabricate "12 JAN"). The day must be 1-31.
    const around = monthMatch[1];
    const before = lower.match(new RegExp('\\b([0-3]?\\d)(?:st|nd|rd|th)?\\s+' + around + '\\b'));
    const after = lower.match(new RegExp('\\b' + around + '\\s+([0-3]?\\d)(?:st|nd|rd|th)?\\b'));
    const rawDay = (before && before[1]) || (after && after[1]) || null;
    const day = rawDay && +rawDay >= 1 && +rawDay <= 31 ? String(+rawDay) : null;
    return day ? `${day} ${mon} ${year}` : `${mon} ${year}`;
  }
  return year;
}

// "John Quincy Adams" + maiden "Brown" -> "John Quincy /Adams/" (or with maiden
// surname in the slashes). Single-token names stay given-only (valid GEDCOM).
// surnameOverride lets the caller supply story.family_name when the name is
// given-only on the stone.
function formatGedcomName(rawName, surnameOverride) {
  const name = escapeGed(rawName).replace(/\//g, ' ').replace(/\s+/g, ' ').trim();
  if (!name) return surnameOverride ? `/${escapeGed(surnameOverride)}/` : 'Unknown';
  const parts = name.split(' ');
  if (surnameOverride) {
    const sur = escapeGed(surnameOverride).replace(/\//g, ' ').trim();
    // If the name already ends with the surname, don't duplicate it as given.
    const given = parts.length > 1 && parts[parts.length - 1].toLowerCase() === sur.toLowerCase()
      ? parts.slice(0, -1).join(' ') : parts.join(' ');
    return given ? `${given} /${sur}/` : `/${sur}/`;
  }
  if (parts.length === 1) return parts[0]; // given-only, valid
  const surname = parts[parts.length - 1];
  const given = parts.slice(0, -1).join(' ');
  return `${given} /${surname}/`;
}

// Normalized key for matching a relationship name to a subject INDI.
function nameKey(s) {
  return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

// Wrap a long text value across CONT (newline) / CONC (continuation) sub-lines so
// no emitted line exceeds the GEDCOM practical limit (~248 chars). `level` is the
// level number of the CONT/CONC sub-lines.
function emitNote(lines, level, text) {
  const clean = String(text == null ? '' : text)
    .replace(/\[(\d+)\]/g, '')           // strip [N] citation markers
    .replace(/[<>]/g, '')                // strip stray chevrons
    .replace(/@/g, '@@');
  const paras = clean.split(/\n{2,}/).map(p => p.replace(/\n+/g, ' ').trim()).filter(Boolean);
  if (!paras.length) return;
  const MAX = 200; // conservative; leaves room for the "L CONC " prefix
  paras.forEach((para, pi) => {
    // Hard-wrap each paragraph into <=MAX-char chunks (CONC), paragraphs joined by CONT.
    let first = true;
    let rest = para;
    while (rest.length > 0) {
      let chunk = rest.slice(0, MAX);
      rest = rest.slice(MAX);
      if (pi === 0 && first) {
        lines.push(`${level - 1} NOTE ${chunk}`);
      } else if (first) {
        lines.push(`${level} CONT ${chunk}`); // new paragraph
      } else {
        lines.push(`${level} CONC ${chunk}`); // continuation of same line
      }
      first = false;
    }
  });
}

// Sanitize the primary name into a filename: "John Q. Adams" -> "john-q-adams.ged".
function gedcomFilename(story) {
  const base = (story && (story.name || (Array.isArray(story.subjects) && story.subjects[0] && story.subjects[0].name))) || '';
  const slug = String(base).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  return `${slug || 'gravestory'}.ged`;
}

// Parse a free-text "born X — died Y" dates string into {birth, death} year-ish
// values, for the legacy (no-subjects) fallback.
function parseDatesString(dates) {
  if (!dates) return { birth: '', death: '' };
  const years = String(dates).match(/\b\d{4}\b/g) || [];
  if (years.length >= 2) return { birth: years[0], death: years[1] };
  if (years.length === 1) {
    // A single year on a stone is far more often a death year.
    return /born|b\.|\bb\b/i.test(dates) ? { birth: years[0], death: '' } : { birth: '', death: years[0] };
  }
  return { birth: '', death: '' };
}

// ── main ─────────────────────────────────────────────────────────────────────

function buildGedcom(story) {
  story = story || {};
  const familyName = story.family_name || null;
  const burialPlace = story.location || '';

  // Build the subject list. Prefer the kernel's structured subjects; fall back to
  // a single subject derived from name + the free-text dates string.
  let subjects = Array.isArray(story.subjects) ? story.subjects.filter(s => s && s.name) : [];
  if (!subjects.length) {
    const { birth, death } = parseDatesString(story.dates);
    subjects = [{ name: story.name || 'Unknown', birth_date: birth, death_date: death }];
  }

  // Assign stable xrefs + a name→xref map (first occurrence wins on duplicate
  // names). KNOWN LIMITATION: if two deceased people on one stone share a name,
  // both get their own INDI but a relationship naming that name binds to the FIRST
  // — the second becomes an unlinked (orphan) INDI. That's an inherently ambiguous
  // case; the output stays valid GEDCOM, the link is just dropped rather than guessed.
  const indis = [];
  const keyToXref = new Map();
  subjects.forEach((s, i) => {
    const xref = `@I${i + 1}@`;
    const key = nameKey(s.name);
    if (!keyToXref.has(key)) keyToXref.set(key, xref);
    indis.push({
      xref, key,
      name: s.name,
      birth: formatGedcomDate(s.birth_date),
      death: formatGedcomDate(s.death_date),
      isPrimary: i === 0,
      fams: [],   // spouse-family xrefs (filled in pass 2)
      famc: [],   // child-in-family xrefs (filled in pass 2)
    });
  });
  const byXref = new Map(indis.map(p => [p.xref, p]));

  // Pass 2 — relationships → FAM records. Within-stone only: both endpoints must
  // resolve to a subject INDI, else skip (no phantom INDIs / cross-grave links).
  const fams = [];
  let famSeq = 0;
  function newFam() { famSeq += 1; return { xref: `@F${famSeq}@`, husb: null, wife: null, chil: [] }; }
  // The primary subject anchors parent/child/spouse relations (relationships are
  // expressed relative to the deceased).
  const primary = indis[0];
  const rels = Array.isArray(story.relationships) ? story.relationships : [];

  // Group relations so spouse + the deceased share ONE family, and parents share
  // ONE family with the deceased as a child.
  let spouseFam = null;   // family where primary + spouse are partners
  let parentFam = null;   // family where primary is a child
  function ensureSpouseFam() {
    if (!spouseFam) { spouseFam = newFam(); fams.push(spouseFam); }
    return spouseFam;
  }
  function ensureParentFam() {
    if (!parentFam) { parentFam = newFam(); fams.push(parentFam); }
    return parentFam;
  }

  // Place a person as a PARTNER (HUSB/WIFE) of a family — only if a partner slot
  // is free AND they aren't already a child of that same family (guards against a
  // mislabeled OCR relation making someone their own parent). Returns true if
  // placed, so the caller only records the reciprocal FAMS when the link is real
  // (a dangling FAMS with no matching HUSB/WIFE is a validator failure).
  function placePartner(fam, xref, prefer) {
    if (fam.chil.includes(xref)) return false;        // can't be partner + child
    if (fam.husb === xref || fam.wife === xref) return true; // already placed
    if (prefer === 'husb' && !fam.husb) { fam.husb = xref; return true; }
    if (prefer === 'wife' && !fam.wife) { fam.wife = xref; return true; }
    if (!fam.husb) { fam.husb = xref; return true; }
    if (!fam.wife) { fam.wife = xref; return true; }
    return false;                                     // both slots taken → can't place
  }
  function placeChild(fam, xref) {
    if (fam.husb === xref || fam.wife === xref) return false; // can't be child + partner
    if (!fam.chil.includes(xref)) fam.chil.push(xref);
    return true;
  }
  function addFams(person, fam) { if (!person.fams.includes(fam.xref)) person.fams.push(fam.xref); }
  function addFamc(person, fam) { if (!person.famc.includes(fam.xref)) person.famc.push(fam.xref); }

  rels.forEach((r) => {
    if (!r || !r.name) return;
    const xref = keyToXref.get(nameKey(r.name));
    if (!xref || xref === primary.xref) return; // off-stone or self → skip
    const other = byXref.get(xref);
    const rel = String(r.relation || '').toLowerCase();
    if (rel === 'spouse') {
      // primary + this spouse are the two partners of the spouse-family. Sex is
      // unknown from OCR (everyone is SEX U), so the HUSB/WIFE roles are arbitrary
      // but valid. Only record FAMS if both were actually placed in a slot — on a
      // stone naming a second spouse the slots are full, so we skip rather than
      // emit a dangling FAMS pointer.
      const f = ensureSpouseFam();
      const pPlaced = placePartner(f, primary.xref, 'husb');
      const oPlaced = placePartner(f, other.xref, 'wife');
      if (pPlaced) addFams(primary, f);
      if (oPlaced) addFams(other, f);
    } else if (rel === 'father' || rel === 'mother') {
      const f = ensureParentFam();
      if (placePartner(f, other.xref, rel === 'father' ? 'husb' : 'wife')) addFams(other, f);
      if (placeChild(f, primary.xref)) addFamc(primary, f);
    } else if (rel === 'son' || rel === 'daughter') {
      // The named person is the deceased's child → the spouse-family where the
      // primary is a parent. Don't force a HUSB/WIFE role (sex unknown); place the
      // primary in whichever partner slot is free.
      const f = ensureSpouseFam();
      if (placePartner(f, primary.xref)) addFams(primary, f);
      if (placeChild(f, other.xref)) addFamc(other, f);
    } else if (rel === 'sibling') {
      // Siblings share a parent family (parents unknown) → both are CHIL.
      const f = ensureParentFam();
      if (placeChild(f, primary.xref)) addFamc(primary, f);
      if (placeChild(f, other.xref)) addFamc(other, f);
    }
  });

  // SOUR records from parallel sources / source_urls arrays.
  const sources = Array.isArray(story.sources) ? story.sources : [];
  const sourceUrls = Array.isArray(story.source_urls) ? story.source_urls : [];

  // ── render ───────────────────────────────────────────────────────────────
  const L = [];
  L.push('0 HEAD');
  L.push('1 SOUR GraveStory');
  L.push('2 NAME GraveStory');
  L.push('1 GEDC');
  L.push('2 VERS 5.5.1');
  L.push('2 FORM LINEAGE-LINKED');
  L.push('1 CHAR UTF-8');
  L.push('1 SUBM @SUB1@');
  L.push('0 @SUB1@ SUBM');
  L.push('1 NAME GraveStory User');

  indis.forEach((p) => {
    L.push(`0 ${p.xref} INDI`);
    // The primary NAME uses the engraved/current surname (family_name when the
    // stone gives only a given name). The maiden name is NOT forced into the
    // surname slot (that would demote the married name) — instead it's emitted as
    // a separate married-name-aware NAME on the primary subject, the GEDCOM-correct
    // way to record a née surname.
    pushTag(L, 1, 'NAME', formatGedcomName(p.name, familyName || null));
    if (p.isPrimary && story.maiden_name) {
      pushTag(L, 1, 'NAME', formatGedcomName(p.name, story.maiden_name));
      L.push('2 TYPE maiden');
    }
    L.push('1 SEX U');
    if (p.birth) { L.push('1 BIRT'); L.push(`2 DATE ${p.birth}`); }
    if (p.death) { L.push('1 DEAT'); L.push(`2 DATE ${p.death}`); }
    if (burialPlace) { L.push('1 BURI'); pushTag(L, 2, 'PLAC', escapeGed(burialPlace)); }
    // Biography note on the primary INDI only (avoid duplicating across people).
    if (p.isPrimary && story.biography) emitNote(L, 2, story.biography);
    // FAMS / FAMC back-pointers (dedup).
    Array.from(new Set(p.fams)).forEach(fx => L.push(`1 FAMS ${fx}`));
    Array.from(new Set(p.famc)).forEach(fx => L.push(`1 FAMC ${fx}`));
    // Cite all sources on the primary; minimal SOUR pointer.
    if (p.isPrimary) sources.forEach((_, k) => L.push(`1 SOUR @S${k + 1}@`));
  });

  fams.forEach((f) => {
    L.push(`0 ${f.xref} FAM`);
    if (f.husb) L.push(`1 HUSB ${f.husb}`);
    if (f.wife) L.push(`1 WIFE ${f.wife}`);
    Array.from(new Set(f.chil)).forEach(cx => L.push(`1 CHIL ${cx}`));
  });

  sources.forEach((src, k) => {
    L.push(`0 @S${k + 1}@ SOUR`);
    pushTag(L, 1, 'TITL', escapeGed(src));
    const url = sourceUrls[k];
    if (url) pushTag(L, 1, 'PUBL', escapeGed(url));
  });

  L.push('0 TRLR');
  return L.join('\n') + '\n';
}
