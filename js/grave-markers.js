// grave-markers.js — 20 hand-built SVG gravestone markers for the cemetery map.
//
// Web port of mobile/src/components/GraveMarkers.js. Each entry is a "glyph":
// the inner SVG primitives on the shared viewBox="0 0 100 100". graveMarkerSvg()
// wraps a glyph in a single <svg> at any size, so the same glyphs render both as
// the Leaflet divIcon on the map and in the result-screen picker grid.
//
// Visual language matches the app's gothic palette and the original Leaflet
// divIcon: gold stroke (#c9a84c), dark translucent stone fill, parchment detail
// (#e8d4a0) for crosses / books / carvings.
//
// Public API (all top-level functions auto-attach to window):
//   MARKER_STYLES    — ordered array of { id, label, glyph }
//   DEFAULT_MARKER   — 'book' (the original divIcon; existing pins are unchanged)
//   getMarker(id)    — resolve an id (or null/unknown) to a descriptor, falling back to default
//   graveMarkerSvg(styleId, size) — returns an <svg> string for a marker style

const GOLD = '#c9a84c';
const PARCH = '#e8d4a0';
const FILL = 'rgba(20,15,8,0.85)';
const PARCH_FILL = 'rgba(232,212,160,0.25)';

// Shared base step drawn under most upright stones.
const _BASE = `<rect x="22" y="84" width="56" height="6" stroke="${GOLD}" stroke-width="2" fill="${FILL}"/>`;

// ── 1. Book (default — matches the original marker) ───────────────────────────
const BOOK_GLYPH = `${_BASE}
  <path d="M30 84 L30 35 Q30 18 50 18 Q70 18 70 35 L70 84 Z" stroke="${GOLD}" stroke-width="2" fill="${FILL}"/>
  <path d="M38 40 L38 56 Q44 54 49 56 L49 42 Q44 40 38 40 Z" stroke="${PARCH}" stroke-width="2" fill="${PARCH_FILL}"/>
  <path d="M51 42 Q56 40 62 40 L62 56 Q56 54 51 56 Z" stroke="${PARCH}" stroke-width="2" fill="${PARCH_FILL}"/>
  <line x1="50" y1="41" x2="50" y2="56" stroke="${PARCH}" stroke-width="1.5"/>
  <line x1="50" y1="63" x2="50" y2="76" stroke="${PARCH}" stroke-width="1.5"/>
  <line x1="44" y1="68" x2="56" y2="68" stroke="${PARCH}" stroke-width="1.5"/>`;

// ── 2. Arched (plain rounded top) ─────────────────────────────────────────────
const ARCHED_GLYPH = `${_BASE}
  <path d="M30 84 L30 38 Q30 18 50 18 Q70 18 70 38 L70 84 Z" stroke="${GOLD}" stroke-width="2" fill="${FILL}"/>
  <line x1="38" y1="48" x2="62" y2="48" stroke="${PARCH}" stroke-width="1.4"/>
  <line x1="38" y1="58" x2="62" y2="58" stroke="${PARCH}" stroke-width="1.4"/>
  <line x1="38" y1="68" x2="62" y2="68" stroke="${PARCH}" stroke-width="1.4"/>`;

// ── 3. Cross-topped tablet ────────────────────────────────────────────────────
const CROSS_TABLET_GLYPH = `${_BASE}
  <path d="M30 84 L30 44 Q30 30 50 30 Q70 30 70 44 L70 84 Z" stroke="${GOLD}" stroke-width="2" fill="${FILL}"/>
  <line x1="50" y1="8" x2="50" y2="28" stroke="${PARCH}" stroke-width="2.4"/>
  <line x1="41" y1="15" x2="59" y2="15" stroke="${PARCH}" stroke-width="2.4"/>
  <line x1="40" y1="54" x2="60" y2="54" stroke="${PARCH}" stroke-width="1.4"/>
  <line x1="40" y1="64" x2="60" y2="64" stroke="${PARCH}" stroke-width="1.4"/>`;

// ── 4. Latin standing cross ───────────────────────────────────────────────────
const CROSS_GLYPH = `<rect x="34" y="82" width="32" height="8" stroke="${GOLD}" stroke-width="2" fill="${FILL}"/>
  <path d="M44 82 L44 24 L56 24 L56 82 Z" stroke="${GOLD}" stroke-width="2" fill="${FILL}"/>
  <path d="M30 38 L70 38 L70 50 L30 50 Z" stroke="${GOLD}" stroke-width="2" fill="${FILL}"/>`;

// ── 5. Celtic cross (ringed) ──────────────────────────────────────────────────
const CELTIC_CROSS_GLYPH = `<rect x="36" y="82" width="28" height="8" stroke="${GOLD}" stroke-width="2" fill="${FILL}"/>
  <line x1="50" y1="14" x2="50" y2="82" stroke="${GOLD}" stroke-width="6"/>
  <line x1="28" y1="40" x2="72" y2="40" stroke="${GOLD}" stroke-width="6"/>
  <circle cx="50" cy="40" r="16" stroke="${GOLD}" stroke-width="2.4" fill="none"/>`;

// ── 6. Obelisk ────────────────────────────────────────────────────────────────
const OBELISK_GLYPH = `<rect x="34" y="82" width="32" height="8" stroke="${GOLD}" stroke-width="2" fill="${FILL}"/>
  <rect x="40" y="72" width="20" height="12" stroke="${GOLD}" stroke-width="2" fill="${FILL}"/>
  <path d="M44 72 L44 22 L50 10 L56 22 L56 72 Z" stroke="${GOLD}" stroke-width="2" fill="${FILL}"/>`;

// ── 7. Scroll / parchment ─────────────────────────────────────────────────────
const SCROLL_GLYPH = `${_BASE}
  <path d="M32 28 Q32 20 40 20 L68 20 Q60 22 60 30 L60 78 Q60 84 52 84 L34 84 Q32 80 32 74 Z" stroke="${GOLD}" stroke-width="2" fill="${FILL}"/>
  <path d="M60 20 Q70 20 70 28 Q70 34 62 32" stroke="${GOLD}" stroke-width="2" fill="none"/>
  <line x1="38" y1="40" x2="56" y2="40" stroke="${PARCH}" stroke-width="1.3"/>
  <line x1="38" y1="50" x2="56" y2="50" stroke="${PARCH}" stroke-width="1.3"/>
  <line x1="38" y1="60" x2="56" y2="60" stroke="${PARCH}" stroke-width="1.3"/>`;

// ── 8. Rose ───────────────────────────────────────────────────────────────────
const ROSE_GLYPH = `${_BASE}
  <path d="M30 84 L30 40 Q30 22 50 22 Q70 22 70 40 L70 84 Z" stroke="${GOLD}" stroke-width="2" fill="${FILL}"/>
  <circle cx="50" cy="46" r="9" stroke="${PARCH}" stroke-width="1.6" fill="${PARCH_FILL}"/>
  <circle cx="50" cy="46" r="4" stroke="${PARCH}" stroke-width="1.4" fill="none"/>
  <path d="M50 55 L50 72" stroke="${PARCH}" stroke-width="1.6"/>
  <path d="M50 62 Q42 60 40 54 Q48 54 50 62 Z" stroke="${PARCH}" stroke-width="1.2" fill="${PARCH_FILL}"/>
  <path d="M50 66 Q58 64 60 58 Q52 58 50 66 Z" stroke="${PARCH}" stroke-width="1.2" fill="${PARCH_FILL}"/>`;

// ── 9. Skull (memento mori) ───────────────────────────────────────────────────
const SKULL_GLYPH = `${_BASE}
  <path d="M30 84 L30 42 Q30 24 50 24 Q70 24 70 42 L70 84 Z" stroke="${GOLD}" stroke-width="2" fill="${FILL}"/>
  <path d="M40 50 Q40 38 50 38 Q60 38 60 50 Q60 58 55 60 L45 60 Q40 58 40 50 Z" stroke="${PARCH}" stroke-width="1.6" fill="${PARCH_FILL}"/>
  <circle cx="46" cy="49" r="2.4" fill="${PARCH}"/>
  <circle cx="54" cy="49" r="2.4" fill="${PARCH}"/>
  <path d="M48 56 L50 60 L52 56 Z" fill="${PARCH}"/>
  <line x1="46" y1="64" x2="54" y2="64" stroke="${PARCH}" stroke-width="1.4"/>`;

// ── 10. Ornate / scrolled crown ───────────────────────────────────────────────
const ORNATE_GLYPH = `${_BASE}
  <path d="M32 84 L32 40 L68 40 L68 84 Z" stroke="${GOLD}" stroke-width="2" fill="${FILL}"/>
  <path d="M28 40 Q28 26 38 26 Q42 18 50 18 Q58 18 62 26 Q72 26 72 40 Z" stroke="${GOLD}" stroke-width="2" fill="${FILL}"/>
  <path d="M40 30 Q44 24 50 28 Q56 24 60 30" stroke="${PARCH}" stroke-width="1.4" fill="none"/>
  <line x1="40" y1="52" x2="60" y2="52" stroke="${PARCH}" stroke-width="1.3"/>
  <line x1="40" y1="62" x2="60" y2="62" stroke="${PARCH}" stroke-width="1.3"/>`;

// ── 11. Gothic pointed arch ───────────────────────────────────────────────────
const GOTHIC_ARCH_GLYPH = `${_BASE}
  <path d="M30 84 L30 40 Q30 30 50 12 Q70 30 70 40 L70 84 Z" stroke="${GOLD}" stroke-width="2" fill="${FILL}"/>
  <path d="M38 44 Q38 36 50 26 Q62 36 62 44 L62 60 L38 60 Z" stroke="${PARCH}" stroke-width="1.4" fill="none"/>
  <line x1="40" y1="70" x2="60" y2="70" stroke="${PARCH}" stroke-width="1.3"/>`;

// ── 12. Heart ─────────────────────────────────────────────────────────────────
const HEART_GLYPH = `${_BASE}
  <path d="M30 84 L30 40 Q30 22 50 22 Q70 22 70 40 L70 84 Z" stroke="${GOLD}" stroke-width="2" fill="${FILL}"/>
  <path d="M50 62 Q40 52 40 46 Q40 40 45 40 Q49 40 50 45 Q51 40 55 40 Q60 40 60 46 Q60 52 50 62 Z" stroke="${PARCH}" stroke-width="1.6" fill="${PARCH_FILL}"/>`;

// ── 13. Praying hands ─────────────────────────────────────────────────────────
const PRAYING_HANDS_GLYPH = `${_BASE}
  <path d="M30 84 L30 40 Q30 22 50 22 Q70 22 70 40 L70 84 Z" stroke="${GOLD}" stroke-width="2" fill="${FILL}"/>
  <path d="M48 68 L44 50 Q43 40 48 38 L50 66 Z" stroke="${PARCH}" stroke-width="1.5" fill="${PARCH_FILL}"/>
  <path d="M52 68 L56 50 Q57 40 52 38 L50 66 Z" stroke="${PARCH}" stroke-width="1.5" fill="${PARCH_FILL}"/>`;

// ── 14. Dove ──────────────────────────────────────────────────────────────────
const DOVE_GLYPH = `${_BASE}
  <path d="M30 84 L30 40 Q30 22 50 22 Q70 22 70 40 L70 84 Z" stroke="${GOLD}" stroke-width="2" fill="${FILL}"/>
  <path d="M42 56 Q48 44 60 44 Q54 48 56 54 Q50 50 44 58 Z" stroke="${PARCH}" stroke-width="1.5" fill="${PARCH_FILL}"/>
  <path d="M60 44 L66 42 L62 48 Z" stroke="${PARCH}" stroke-width="1.2" fill="${PARCH_FILL}"/>`;

// ── 15. Anchor (hope / mariner) ───────────────────────────────────────────────
const ANCHOR_GLYPH = `${_BASE}
  <path d="M30 84 L30 42 Q30 24 50 24 Q70 24 70 42 L70 84 Z" stroke="${GOLD}" stroke-width="2" fill="${FILL}"/>
  <circle cx="50" cy="38" r="3" stroke="${PARCH}" stroke-width="1.6" fill="none"/>
  <line x1="50" y1="41" x2="50" y2="70" stroke="${PARCH}" stroke-width="1.8"/>
  <line x1="42" y1="48" x2="58" y2="48" stroke="${PARCH}" stroke-width="1.8"/>
  <path d="M38 60 Q42 70 50 70 Q58 70 62 60" stroke="${PARCH}" stroke-width="1.8" fill="none"/>`;

// ── 16. Broken column (life cut short) — snapped classical column on a plinth ──
const COLUMN_GLYPH = `<rect x="28" y="80" width="44" height="8" stroke="${GOLD}" stroke-width="2" fill="${FILL}"/>
  <rect x="34" y="72" width="32" height="8" stroke="${GOLD}" stroke-width="2" fill="${FILL}"/>
  <path d="M40 72 L40 40 L42 36 L58 32 L60 36 L60 72 Z" stroke="${PARCH}" stroke-width="1.8" fill="${PARCH_FILL}" stroke-linejoin="round"/>
  <line x1="46" y1="44" x2="46" y2="70" stroke="${PARCH}" stroke-width="1.2"/>
  <line x1="50" y1="42" x2="50" y2="70" stroke="${PARCH}" stroke-width="1.2"/>
  <line x1="54" y1="40" x2="54" y2="70" stroke="${PARCH}" stroke-width="1.2"/>
  <line x1="38" y1="70" x2="62" y2="70" stroke="${PARCH}" stroke-width="1.6"/>`;

// ── 17. Classical funerary urn on a stepped plinth ────────────────────────────
const URN_GLYPH = `<rect x="30" y="80" width="40" height="8" stroke="${GOLD}" stroke-width="2" fill="${FILL}"/>
  <rect x="38" y="73" width="24" height="7" stroke="${GOLD}" stroke-width="2" fill="${FILL}"/>
  <path d="M45 73 L43 68 L57 68 L55 73 Z" stroke="${PARCH}" stroke-width="1.6" fill="${PARCH_FILL}" stroke-linejoin="round"/>
  <path d="M43 68 Q34 60 38 50 L62 50 Q66 60 57 68 Z" stroke="${PARCH}" stroke-width="1.8" fill="${PARCH_FILL}" stroke-linejoin="round"/>
  <rect x="36" y="46" width="28" height="4" rx="1" stroke="${PARCH}" stroke-width="1.6" fill="${PARCH_FILL}"/>
  <path d="M40 46 Q40 38 50 38 Q60 38 60 46 Z" stroke="${PARCH}" stroke-width="1.6" fill="${PARCH_FILL}" stroke-linejoin="round"/>
  <circle cx="50" cy="35" r="2.4" stroke="${PARCH}" stroke-width="1.5" fill="${FILL}"/>
  <path d="M40 53 Q31 53 35 62" stroke="${PARCH}" stroke-width="1.5" fill="none"/>
  <path d="M60 53 Q69 53 65 62" stroke="${PARCH}" stroke-width="1.5" fill="none"/>`;

// ── 18. Weeping willow ────────────────────────────────────────────────────────
const WILLOW_GLYPH = `${_BASE}
  <path d="M30 84 L30 40 Q30 22 50 22 Q70 22 70 40 L70 84 Z" stroke="${GOLD}" stroke-width="2" fill="${FILL}"/>
  <line x1="50" y1="70" x2="50" y2="44" stroke="${PARCH}" stroke-width="1.6"/>
  <path d="M50 44 Q40 42 36 56" stroke="${PARCH}" stroke-width="1.3" fill="none"/>
  <path d="M50 44 Q46 42 44 60" stroke="${PARCH}" stroke-width="1.3" fill="none"/>
  <path d="M50 44 Q60 42 64 56" stroke="${PARCH}" stroke-width="1.3" fill="none"/>
  <path d="M50 44 Q54 42 56 60" stroke="${PARCH}" stroke-width="1.3" fill="none"/>`;

// ── 19. Star of David ─────────────────────────────────────────────────────────
const STAR_GLYPH = `${_BASE}
  <path d="M30 84 L30 40 Q30 24 50 24 Q70 24 70 40 L70 84 Z" stroke="${GOLD}" stroke-width="2" fill="${FILL}"/>
  <polygon points="50,36 60,54 40,54" stroke="${PARCH}" stroke-width="1.6" fill="none"/>
  <polygon points="50,60 40,42 60,42" stroke="${PARCH}" stroke-width="1.6" fill="none"/>`;

// ── 20. Flat / lawn marker ────────────────────────────────────────────────────
const FLAT_GLYPH = `<path d="M20 58 L80 58 L84 78 L16 78 Z" stroke="${GOLD}" stroke-width="2" fill="${FILL}"/>
  <line x1="32" y1="66" x2="68" y2="66" stroke="${PARCH}" stroke-width="1.4"/>
  <line x1="36" y1="72" x2="64" y2="72" stroke="${PARCH}" stroke-width="1.3"/>`;

const MARKER_STYLES = [
  { id: 'book',      label: 'Open Book',     glyph: BOOK_GLYPH },
  { id: 'arched',    label: 'Arched',        glyph: ARCHED_GLYPH },
  { id: 'cross-tab', label: 'Cross Tablet',  glyph: CROSS_TABLET_GLYPH },
  { id: 'cross',     label: 'Cross',         glyph: CROSS_GLYPH },
  { id: 'celtic',    label: 'Celtic Cross',  glyph: CELTIC_CROSS_GLYPH },
  { id: 'obelisk',   label: 'Obelisk',       glyph: OBELISK_GLYPH },
  { id: 'scroll',    label: 'Scroll',        glyph: SCROLL_GLYPH },
  { id: 'rose',      label: 'Rose',          glyph: ROSE_GLYPH },
  { id: 'skull',     label: 'Skull',         glyph: SKULL_GLYPH },
  { id: 'ornate',    label: 'Ornate',        glyph: ORNATE_GLYPH },
  { id: 'gothic',    label: 'Gothic Arch',   glyph: GOTHIC_ARCH_GLYPH },
  { id: 'heart',     label: 'Heart',         glyph: HEART_GLYPH },
  { id: 'praying',   label: 'Praying Hands', glyph: PRAYING_HANDS_GLYPH },
  { id: 'dove',      label: 'Dove',          glyph: DOVE_GLYPH },
  { id: 'anchor',    label: 'Anchor',        glyph: ANCHOR_GLYPH },
  { id: 'column',    label: 'Broken Column', glyph: COLUMN_GLYPH },
  { id: 'urn',       label: 'Urn',           glyph: URN_GLYPH },
  { id: 'willow',    label: 'Willow',        glyph: WILLOW_GLYPH },
  { id: 'star',      label: 'Star of David', glyph: STAR_GLYPH },
  { id: 'flat',      label: 'Lawn Marker',   glyph: FLAT_GLYPH },
];

const DEFAULT_MARKER = 'book';

const _markerById = Object.fromEntries(MARKER_STYLES.map(m => [m.id, m]));

// Resolve a stored style id to a descriptor, falling back to the default marker
// for null / unknown / legacy values so existing pins always render.
function getMarker(id) {
  return _markerById[id] || _markerById[DEFAULT_MARKER];
}

// Returns a self-contained <svg> string for a marker style at the given size.
// Used by both the Leaflet divIcon and the result-screen picker grid.
function graveMarkerSvg(styleId, size = 32) {
  const { glyph } = getMarker(styleId);
  return `<svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" style="width:${size}px;height:${size}px;display:block;">${glyph}</svg>`;
}
