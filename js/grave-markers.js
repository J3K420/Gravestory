// grave-markers.js — 40 hand-built SVG gravestone markers for the cemetery map.
//
// Web port of mobile/src/components/GraveMarkers.js. Each entry is a "glyph":
// the inner SVG primitives on the shared viewBox="0 0 100 100". graveMarkerSvg()
// wraps a glyph in a single <svg> at any size (injecting the shared <defs>), so
// the same glyphs render both as the Leaflet divIcon on the map and in the
// result-screen picker grid.
//
// DEPTH TREATMENT (gradient-based, no SVG filters — must render identically on
// react-native-svg, which does not reliably support feGaussianBlur/feDropShadow):
//   • goldGrad   — bright→deep gold so the stone outline reads as polished metal
//   • stoneGrad  — vertical lit-top→dark-base gradient = a lit rounded stone face
//   • parchGrad  — same lit→shadow idea for carved parchment fills
//   • groundGrad — soft radial ellipse drawn under each pin so it sits, not floats
//   • _g(d,w)    — "carved groove": the path drawn twice, a dark shadow wall
//                  offset +~1px under the bright parchment wall = an incised line
// The defs live in the <svg> wrapper, so every glyph inherits them by url(#id).
// Gradient ids are scoped to each <svg> root, so reuse across many pins is safe.
//
// Visual language matches the app's gothic palette: gold stroke (#c9a84c), dark
// stone, parchment detail (#e8d4a0) for crosses / books / carvings.
//
// Public API (all top-level functions auto-attach to window):
//   MARKER_STYLES    — ordered array of { id, label, glyph }
//   DEFAULT_MARKER   — 'book' (the original divIcon; existing pins are unchanged)
//   getMarker(id)    — resolve an id (or null/unknown) to a descriptor, falling back to default
//   graveMarkerSvg(styleId, size) — returns an <svg> string for a marker style

const GOLD = '#c9a84c';
const PARCH = '#e8d4a0';

// Gradient stops (kept in sync, byte-for-byte, with mobile GraveMarkers.js).
const GOLD_HI = '#e6c870';            // lit gold (top)
const GOLD_LO = '#9c7e34';            // shadowed gold (base)
const STONE_HI = '#2c2418';           // lit top of the stone face
const STONE_LO = '#0f0b06';           // shadowed base of the stone
const GROOVE_DK = 'rgba(10,7,3,0.55)';// far wall of an incised groove

// Shared <defs> injected into every <svg> wrapper. The url(#…) refs below resolve
// against this. (RN-SVG-safe: LinearGradient + RadialGradient only, no filters.)
const _DEFS = `<defs>
  <linearGradient id="goldGrad" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="${GOLD_HI}"/><stop offset="0.5" stop-color="${GOLD}"/><stop offset="1" stop-color="${GOLD_LO}"/>
  </linearGradient>
  <linearGradient id="stoneGrad" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="${STONE_HI}"/><stop offset="1" stop-color="${STONE_LO}"/>
  </linearGradient>
  <linearGradient id="parchGrad" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="rgba(232,212,160,0.34)"/><stop offset="1" stop-color="rgba(232,212,160,0.12)"/>
  </linearGradient>
  <radialGradient id="groundGrad" cx="0.5" cy="0.5" r="0.5">
    <stop offset="0" stop-color="rgba(0,0,0,0.45)"/><stop offset="0.7" stop-color="rgba(0,0,0,0.22)"/><stop offset="1" stop-color="rgba(0,0,0,0)"/>
  </radialGradient>
</defs>`;

const STONE = 'url(#stoneGrad)';   // lit stone face
const GOLDG = 'url(#goldGrad)';    // polished-metal gold stroke
const PARCHG = 'url(#parchGrad)';  // lit parchment fill

// Soft ground shadow, drawn first so the stone sits on it.
const _GROUND = `<ellipse cx="50" cy="90" rx="30" ry="6" fill="url(#groundGrad)"/>`;

// Shared base step drawn under most upright stones (now gradient-lit).
const _BASE = `${_GROUND}<rect x="22" y="84" width="56" height="6" stroke="${GOLDG}" stroke-width="2" fill="${STONE}"/>`;

// Carved-groove stroke: a dark "far wall" offset down/right, then the bright
// parchment "near wall" on top → reads as an incised line. Use for all
// parchment OUTLINE detail (crosses, lettering, fluting, rays…).
function _g(d, w) {
  return `<path d="${d}" stroke="${GROOVE_DK}" stroke-width="${w}" fill="none" stroke-linecap="round" transform="translate(0.9,1)"/>` +
         `<path d="${d}" stroke="${PARCH}" stroke-width="${w}" fill="none" stroke-linecap="round"/>`;
}

// ── 1. Book (default — matches the original marker) ───────────────────────────
const BOOK_GLYPH = `${_BASE}
  <path d="M30 84 L30 35 Q30 18 50 18 Q70 18 70 35 L70 84 Z" stroke="${GOLDG}" stroke-width="2.2" fill="${STONE}"/>
  <path d="M38 40 L38 56 Q44 54 49 56 L49 42 Q44 40 38 40 Z" stroke="${PARCH}" stroke-width="2" fill="${PARCHG}"/>
  <path d="M51 42 Q56 40 62 40 L62 56 Q56 54 51 56 Z" stroke="${PARCH}" stroke-width="2" fill="${PARCHG}"/>
  ${_g('M50 41 L50 56', 1.5)}
  ${_g('M50 63 L50 76', 1.5)}
  ${_g('M44 68 L56 68', 1.5)}`;

// ── 2. Arched (plain rounded top) ─────────────────────────────────────────────
const ARCHED_GLYPH = `${_BASE}
  <path d="M30 84 L30 38 Q30 18 50 18 Q70 18 70 38 L70 84 Z" stroke="${GOLDG}" stroke-width="2.2" fill="${STONE}"/>
  ${_g('M38 48 L62 48', 1.4)}
  ${_g('M38 58 L62 58', 1.4)}
  ${_g('M38 68 L62 68', 1.4)}`;

// ── 3. Cross-topped tablet ────────────────────────────────────────────────────
const CROSS_TABLET_GLYPH = `${_BASE}
  <path d="M30 84 L30 44 Q30 30 50 30 Q70 30 70 44 L70 84 Z" stroke="${GOLDG}" stroke-width="2.2" fill="${STONE}"/>
  ${_g('M50 8 L50 28', 2.4)}
  ${_g('M41 15 L59 15', 2.4)}
  ${_g('M40 54 L60 54', 1.4)}
  ${_g('M40 64 L60 64', 1.4)}`;

// ── 4. Latin standing cross ───────────────────────────────────────────────────
const CROSS_GLYPH = `${_GROUND}
  <rect x="34" y="82" width="32" height="8" stroke="${GOLDG}" stroke-width="2" fill="${STONE}"/>
  <path d="M44 82 L44 24 L56 24 L56 82 Z" stroke="${GOLDG}" stroke-width="2.2" fill="${STONE}"/>
  <path d="M30 38 L70 38 L70 50 L30 50 Z" stroke="${GOLDG}" stroke-width="2.2" fill="${STONE}"/>`;

// ── 5. Celtic cross (ringed) ──────────────────────────────────────────────────
// Arms are drawn as filled <rect>s (not <line>s) so the vertical goldGrad has a
// real bounding box to paint into — a zero-height horizontal <line> collapses
// the objectBoundingBox gradient and paints nothing.
const CELTIC_CROSS_GLYPH = `${_GROUND}
  <rect x="36" y="82" width="28" height="8" stroke="${GOLDG}" stroke-width="2" fill="${STONE}"/>
  <rect x="47" y="14" width="6" height="68" fill="${GOLDG}"/>
  <rect x="28" y="37" width="44" height="6" fill="${GOLDG}"/>
  <circle cx="50" cy="40" r="16" stroke="${GOLDG}" stroke-width="2.4" fill="none"/>`;

// ── 6. Obelisk ────────────────────────────────────────────────────────────────
const OBELISK_GLYPH = `${_GROUND}
  <rect x="34" y="82" width="32" height="8" stroke="${GOLDG}" stroke-width="2" fill="${STONE}"/>
  <rect x="40" y="72" width="20" height="12" stroke="${GOLDG}" stroke-width="2" fill="${STONE}"/>
  <path d="M44 72 L44 22 L50 10 L56 22 L56 72 Z" stroke="${GOLDG}" stroke-width="2.2" fill="${STONE}"/>
  ${_g('M50 26 L50 70', 1.2)}`;

// ── 7. Scroll / parchment ─────────────────────────────────────────────────────
const SCROLL_GLYPH = `${_BASE}
  <path d="M32 28 Q32 20 40 20 L68 20 Q60 22 60 30 L60 78 Q60 84 52 84 L34 84 Q32 80 32 74 Z" stroke="${GOLDG}" stroke-width="2.2" fill="${STONE}"/>
  <path d="M60 20 Q70 20 70 28 Q70 34 62 32" stroke="${GOLDG}" stroke-width="2" fill="none"/>
  ${_g('M38 40 L56 40', 1.3)}
  ${_g('M38 50 L56 50', 1.3)}
  ${_g('M38 60 L56 60', 1.3)}`;

// ── 8. Rose ───────────────────────────────────────────────────────────────────
const ROSE_GLYPH = `${_BASE}
  <path d="M30 84 L30 40 Q30 22 50 22 Q70 22 70 40 L70 84 Z" stroke="${GOLDG}" stroke-width="2.2" fill="${STONE}"/>
  <circle cx="50" cy="46" r="9" stroke="${PARCH}" stroke-width="1.6" fill="${PARCHG}"/>
  ${_g('M50 46 m -4 0 a 4 4 0 1 0 8 0 a 4 4 0 1 0 -8 0', 1.4)}
  ${_g('M50 55 L50 72', 1.6)}
  <path d="M50 62 Q42 60 40 54 Q48 54 50 62 Z" stroke="${PARCH}" stroke-width="1.2" fill="${PARCHG}"/>
  <path d="M50 66 Q58 64 60 58 Q52 58 50 66 Z" stroke="${PARCH}" stroke-width="1.2" fill="${PARCHG}"/>`;

// ── 9. Skull (memento mori) ───────────────────────────────────────────────────
const SKULL_GLYPH = `${_BASE}
  <path d="M30 84 L30 42 Q30 24 50 24 Q70 24 70 42 L70 84 Z" stroke="${GOLDG}" stroke-width="2.2" fill="${STONE}"/>
  <path d="M40 50 Q40 38 50 38 Q60 38 60 50 Q60 58 55 60 L45 60 Q40 58 40 50 Z" stroke="${PARCH}" stroke-width="1.6" fill="${PARCHG}"/>
  <circle cx="46" cy="49" r="2.4" fill="${GROOVE_DK}"/>
  <circle cx="54" cy="49" r="2.4" fill="${GROOVE_DK}"/>
  <path d="M48 56 L50 60 L52 56 Z" fill="${GROOVE_DK}"/>
  ${_g('M46 64 L54 64', 1.4)}`;

// ── 10. Ornate / scrolled crown ───────────────────────────────────────────────
const ORNATE_GLYPH = `${_BASE}
  <path d="M32 84 L32 40 L68 40 L68 84 Z" stroke="${GOLDG}" stroke-width="2.2" fill="${STONE}"/>
  <path d="M28 40 Q28 26 38 26 Q42 18 50 18 Q58 18 62 26 Q72 26 72 40 Z" stroke="${GOLDG}" stroke-width="2.2" fill="${STONE}"/>
  ${_g('M40 30 Q44 24 50 28 Q56 24 60 30', 1.4)}
  ${_g('M40 52 L60 52', 1.3)}
  ${_g('M40 62 L60 62', 1.3)}`;

// ── 11. Gothic pointed arch ───────────────────────────────────────────────────
const GOTHIC_ARCH_GLYPH = `${_BASE}
  <path d="M30 84 L30 40 Q30 30 50 12 Q70 30 70 40 L70 84 Z" stroke="${GOLDG}" stroke-width="2.2" fill="${STONE}"/>
  ${_g('M38 44 Q38 36 50 26 Q62 36 62 44 L62 60 L38 60 Z', 1.4)}
  ${_g('M40 70 L60 70', 1.3)}`;

// ── 12. Heart ─────────────────────────────────────────────────────────────────
const HEART_GLYPH = `${_BASE}
  <path d="M30 84 L30 40 Q30 22 50 22 Q70 22 70 40 L70 84 Z" stroke="${GOLDG}" stroke-width="2.2" fill="${STONE}"/>
  <path d="M50 62 Q40 52 40 46 Q40 40 45 40 Q49 40 50 45 Q51 40 55 40 Q60 40 60 46 Q60 52 50 62 Z" stroke="${PARCH}" stroke-width="1.6" fill="${PARCHG}"/>`;

// ── 13. Praying hands ─────────────────────────────────────────────────────────
const PRAYING_HANDS_GLYPH = `${_BASE}
  <path d="M30 84 L30 40 Q30 22 50 22 Q70 22 70 40 L70 84 Z" stroke="${GOLDG}" stroke-width="2.2" fill="${STONE}"/>
  <path d="M48 68 L44 50 Q43 40 48 38 L50 66 Z" stroke="${PARCH}" stroke-width="1.5" fill="${PARCHG}"/>
  <path d="M52 68 L56 50 Q57 40 52 38 L50 66 Z" stroke="${PARCH}" stroke-width="1.5" fill="${PARCHG}"/>`;

// ── 14. Dove ──────────────────────────────────────────────────────────────────
const DOVE_GLYPH = `${_BASE}
  <path d="M30 84 L30 40 Q30 22 50 22 Q70 22 70 40 L70 84 Z" stroke="${GOLDG}" stroke-width="2.2" fill="${STONE}"/>
  <path d="M42 56 Q48 44 60 44 Q54 48 56 54 Q50 50 44 58 Z" stroke="${PARCH}" stroke-width="1.5" fill="${PARCHG}"/>
  <path d="M60 44 L66 42 L62 48 Z" stroke="${PARCH}" stroke-width="1.2" fill="${PARCHG}"/>`;

// ── 15. Anchor (hope / mariner) ───────────────────────────────────────────────
const ANCHOR_GLYPH = `${_BASE}
  <path d="M30 84 L30 42 Q30 24 50 24 Q70 24 70 42 L70 84 Z" stroke="${GOLDG}" stroke-width="2.2" fill="${STONE}"/>
  <circle cx="50" cy="38" r="3" stroke="${PARCH}" stroke-width="1.6" fill="none"/>
  ${_g('M50 41 L50 70', 1.8)}
  ${_g('M42 48 L58 48', 1.8)}
  ${_g('M38 60 Q42 70 50 70 Q58 70 62 60', 1.8)}`;

// ── 16. Broken column (life cut short) — snapped classical column on a plinth ──
const COLUMN_GLYPH = `${_GROUND}
  <rect x="28" y="80" width="44" height="8" stroke="${GOLDG}" stroke-width="2" fill="${STONE}"/>
  <rect x="34" y="72" width="32" height="8" stroke="${GOLDG}" stroke-width="2" fill="${STONE}"/>
  <path d="M40 72 L40 40 L42 36 L58 32 L60 36 L60 72 Z" stroke="${PARCH}" stroke-width="1.8" fill="${PARCHG}" stroke-linejoin="round"/>
  ${_g('M46 44 L46 70', 1.2)}
  ${_g('M50 42 L50 70', 1.2)}
  ${_g('M54 40 L54 70', 1.2)}
  ${_g('M38 70 L62 70', 1.6)}`;

// ── 17. Classical funerary urn on a stepped plinth ────────────────────────────
const URN_GLYPH = `${_GROUND}
  <rect x="30" y="80" width="40" height="8" stroke="${GOLDG}" stroke-width="2" fill="${STONE}"/>
  <rect x="38" y="73" width="24" height="7" stroke="${GOLDG}" stroke-width="2" fill="${STONE}"/>
  <path d="M45 73 L43 68 L57 68 L55 73 Z" stroke="${PARCH}" stroke-width="1.6" fill="${PARCHG}" stroke-linejoin="round"/>
  <path d="M43 68 Q34 60 38 50 L62 50 Q66 60 57 68 Z" stroke="${PARCH}" stroke-width="1.8" fill="${PARCHG}" stroke-linejoin="round"/>
  <rect x="36" y="46" width="28" height="4" rx="1" stroke="${PARCH}" stroke-width="1.6" fill="${PARCHG}"/>
  <path d="M40 46 Q40 38 50 38 Q60 38 60 46 Z" stroke="${PARCH}" stroke-width="1.6" fill="${PARCHG}" stroke-linejoin="round"/>
  <circle cx="50" cy="35" r="2.4" stroke="${PARCH}" stroke-width="1.5" fill="${STONE}"/>
  <path d="M40 53 Q31 53 35 62" stroke="${PARCH}" stroke-width="1.5" fill="none"/>
  <path d="M60 53 Q69 53 65 62" stroke="${PARCH}" stroke-width="1.5" fill="none"/>`;

// ── 18. Weeping willow ────────────────────────────────────────────────────────
const WILLOW_GLYPH = `${_BASE}
  <path d="M30 84 L30 40 Q30 22 50 22 Q70 22 70 40 L70 84 Z" stroke="${GOLDG}" stroke-width="2.2" fill="${STONE}"/>
  ${_g('M50 70 L50 44', 1.6)}
  ${_g('M50 44 Q40 42 36 56', 1.3)}
  ${_g('M50 44 Q46 42 44 60', 1.3)}
  ${_g('M50 44 Q60 42 64 56', 1.3)}
  ${_g('M50 44 Q54 42 56 60', 1.3)}`;

// ── 19. Star of David ─────────────────────────────────────────────────────────
const STAR_GLYPH = `${_BASE}
  <path d="M30 84 L30 40 Q30 24 50 24 Q70 24 70 40 L70 84 Z" stroke="${GOLDG}" stroke-width="2.2" fill="${STONE}"/>
  ${_g('M50 36 L60 54 L40 54 Z', 1.6)}
  ${_g('M50 60 L40 42 L60 42 Z', 1.6)}`;

// ── 20. Flat / lawn marker ────────────────────────────────────────────────────
const FLAT_GLYPH = `${_GROUND}
  <path d="M20 58 L80 58 L84 78 L16 78 Z" stroke="${GOLDG}" stroke-width="2.2" fill="${STONE}"/>
  ${_g('M32 66 L68 66', 1.4)}
  ${_g('M36 72 L64 72', 1.3)}`;

// ═══════════════════════════════════════════════════════════════════════════════
// PACK 2 — FAITH & RELIGIOUS (glyphs 21-40)
// Same gold-stroke / parchment-detail palette + depth treatment as Pack 1. Most
// sit on an arched tablet (the shared faith-stone silhouette); a few are
// free-standing emblems. The busiest emblems (menorah, om, khanda, eye, angel)
// were redrawn bolder so they survive at ~32px map size.
// ═══════════════════════════════════════════════════════════════════════════════

// Shared arched faith-tablet silhouette many Pack-2 emblems are carved onto.
const _FAITH_TABLET = `${_BASE}
  <path d="M30 84 L30 40 Q30 22 50 22 Q70 22 70 40 L70 84 Z" stroke="${GOLDG}" stroke-width="2.2" fill="${STONE}"/>`;

// ── 21. Ankh ──────────────────────────────────────────────────────────────────
const ANKH_GLYPH = `${_FAITH_TABLET}
  ${_g('M50 42 m -8 0 a 8 10 0 1 0 16 0 a 8 10 0 1 0 -16 0', 2)}
  ${_g('M50 52 L50 74', 2.4)}
  ${_g('M40 60 L60 60', 2.4)}`;

// ── 22. Crescent & star (Islamic) ─────────────────────────────────────────────
const CRESCENT_GLYPH = `${_FAITH_TABLET}
  <path d="M51 38 Q37 38 37 52 Q37 66 51 66 Q42 60 42 52 Q42 44 51 38 Z" stroke="${PARCH}" stroke-width="1.8" fill="${PARCHG}"/>
  <polygon points="55,46 57,52 63,52 58,56 60,62 55,58 50,62 52,56 47,52 53,52" stroke="${PARCH}" stroke-width="1.2" fill="${PARCHG}"/>`;

// ── 23. Menorah (REDRAWN — bolder shaft, fewer hairlines, dotted flames) ───────
const MENORAH_GLYPH = `${_FAITH_TABLET}
  ${_g('M50 46 L50 72', 2.2)}
  ${_g('M40 74 L60 74', 2.4)}
  ${_g('M44 76 L44 72', 2)}
  ${_g('M56 76 L56 72', 2)}
  ${_g('M50 60 Q42 60 42 48', 1.9)}
  ${_g('M50 60 Q58 60 58 48', 1.9)}
  ${_g('M50 56 Q35 56 35 46', 1.9)}
  ${_g('M50 56 Q65 56 65 46', 1.9)}
  ${_g('M50 52 Q29 52 29 44', 1.9)}
  ${_g('M50 52 Q71 52 71 44', 1.9)}
  <g fill="${PARCH}">
    <circle cx="29" cy="43" r="1.6"/><circle cx="35" cy="45" r="1.6"/><circle cx="42" cy="47" r="1.6"/>
    <circle cx="50" cy="45" r="1.6"/><circle cx="58" cy="47" r="1.6"/><circle cx="65" cy="45" r="1.6"/><circle cx="71" cy="43" r="1.6"/>
  </g>`;

// ── 24. Chi-Rho ───────────────────────────────────────────────────────────────
const CHIRHO_GLYPH = `${_FAITH_TABLET}
  ${_g('M50 34 L50 72', 2.2)}
  ${_g('M50 40 Q60 40 60 48 Q60 56 50 56', 2)}
  ${_g('M40 60 L60 72', 2)}
  ${_g('M60 60 L40 72', 2)}`;

// ── 25. Wheat sheaf (a long life "harvested") ─────────────────────────────────
const WHEAT_GLYPH = `${_FAITH_TABLET}
  ${_g('M50 70 L50 42', 1.6)}
  ${_g('M50 70 Q44 58 42 44', 1.6)}
  ${_g('M50 70 Q56 58 58 44', 1.6)}
  ${_g('M50 70 Q40 60 36 49', 1.4)}
  ${_g('M50 70 Q60 60 64 49', 1.4)}
  ${_g('M50 42 L47 45 M50 42 L53 45 M50 46 L47 49 M50 46 L53 49', 1.3)}
  ${_g('M42 44 L39 47 M42 44 L44 47 M43 49 L40 52 M43 49 L45 52', 1.2)}
  ${_g('M58 44 L55 47 M58 44 L61 47 M57 49 L54 52 M57 49 L60 52', 1.2)}
  ${_g('M36 49 L34 52 M36 49 L38 52', 1.1)}
  ${_g('M64 49 L62 52 M64 49 L66 52', 1.1)}
  <rect x="45" y="68" width="10" height="5" rx="1.5" stroke="${PARCH}" stroke-width="1.6" fill="${PARCHG}"/>`;

// ── 26. Orthodox (three-bar) cross ────────────────────────────────────────────
const ORTHODOX_GLYPH = `${_FAITH_TABLET}
  ${_g('M50 30 L50 76', 2.4)}
  ${_g('M44 38 L56 38', 2)}
  ${_g('M38 50 L62 50', 2.4)}
  ${_g('M42 66 L58 60', 2)}`;

// ── 27. Alpha & Omega ─────────────────────────────────────────────────────────
const ALPHAOMEGA_GLYPH = `${_FAITH_TABLET}
  ${_g('M41 62 L45 50 L49 62 M42.5 58 L47.5 58', 1.7)}
  ${_g('M53 62 Q53 50 58 50 Q63 50 63 62 M51.5 62 L55 62 M61 62 L64.5 62', 1.7)}`;

// ── 28. Sacred Heart (flaming, crowned with cross) ────────────────────────────
const SACREDHEART_GLYPH = `${_FAITH_TABLET}
  <path d="M50 66 Q38 54 38 47 Q38 40 44 40 Q49 40 50 46 Q51 40 56 40 Q62 40 62 47 Q62 54 50 66 Z" stroke="${PARCH}" stroke-width="1.8" fill="${PARCHG}"/>
  ${_g('M50 34 L50 42', 1.8)}
  ${_g('M46 37 L54 37', 1.8)}
  ${_g('M46 50 Q50 56 54 50', 1.3)}`;

// ── 29. Lamb of God (Agnus Dei) ───────────────────────────────────────────────
const LAMB_GLYPH = `${_FAITH_TABLET}
  <ellipse cx="50" cy="56" rx="13" ry="9" stroke="${PARCH}" stroke-width="1.6" fill="${PARCHG}"/>
  <circle cx="38" cy="52" r="5" stroke="${PARCH}" stroke-width="1.6" fill="${PARCHG}"/>
  ${_g('M44 63 L44 70', 1.5)}
  ${_g('M56 63 L56 70', 1.5)}
  ${_g('M60 40 L60 56', 1.4)}
  <path d="M60 40 L66 42 L60 45 Z" stroke="${PARCH}" stroke-width="1" fill="${PARCHG}"/>`;

// ── 30. Open scripture on a stand ─────────────────────────────────────────────
const SCRIPTURE_GLYPH = `${_FAITH_TABLET}
  <path d="M50 48 Q42 44 34 46 L34 64 Q42 62 50 66 Z" stroke="${PARCH}" stroke-width="1.6" fill="${PARCHG}"/>
  <path d="M50 48 Q58 44 66 46 L66 64 Q58 62 50 66 Z" stroke="${PARCH}" stroke-width="1.6" fill="${PARCHG}"/>
  ${_g('M38 52 L46 53', 1)}
  ${_g('M38 57 L46 58', 1)}
  ${_g('M54 53 L62 52', 1)}
  ${_g('M54 58 L62 57', 1)}
  ${_g('M42 70 L58 70', 1.6)}`;

// ── 31. Chalice ───────────────────────────────────────────────────────────────
const CHALICE_GLYPH = `${_FAITH_TABLET}
  <path d="M40 44 Q40 56 50 58 Q60 56 60 44 Z" stroke="${PARCH}" stroke-width="1.8" fill="${PARCHG}"/>
  ${_g('M50 58 L50 68', 1.8)}
  <path d="M42 72 Q42 68 50 68 Q58 68 58 72 Z" stroke="${PARCH}" stroke-width="1.8" fill="${PARCHG}"/>
  <circle cx="50" cy="38" r="3" stroke="${PARCH}" stroke-width="1.4" fill="none"/>`;

// ── 32. Lotus (Buddhist / Hindu) — symmetric water-lily on a waterline ─────────
const LOTUS_GLYPH = `${_FAITH_TABLET}
  <path d="M50 64 Q45 52 50 42 Q55 52 50 64 Z" stroke="${PARCH}" stroke-width="1.5" fill="${PARCHG}"/>
  <path d="M50 64 Q42 54 40 46 Q49 50 50 64 Z" stroke="${PARCH}" stroke-width="1.5" fill="${PARCHG}"/>
  <path d="M50 64 Q58 54 60 46 Q51 50 50 64 Z" stroke="${PARCH}" stroke-width="1.5" fill="${PARCHG}"/>
  <path d="M50 64 Q38 58 32 50 Q46 52 50 64 Z" stroke="${PARCH}" stroke-width="1.4" fill="${PARCHG}"/>
  <path d="M50 64 Q62 58 68 50 Q54 52 50 64 Z" stroke="${PARCH}" stroke-width="1.4" fill="${PARCHG}"/>
  ${_g('M34 66 Q50 72 66 66', 1.4)}`;

// ── 33. Om (REDRAWN — bolder, cleaner separated strokes) ──────────────────────
const OM_GLYPH = `${_FAITH_TABLET}
  ${_g('M42 52 Q33 52 33 60 Q33 69 43 69 Q51 69 51 61 Q51 55 44 55', 2.1)}
  ${_g('M44 55 Q44 48 51 48 Q58 48 58 54', 2.1)}
  ${_g('M51 60 Q59 60 63 67', 2.1)}
  ${_g('M55 44 Q61 41 67 45', 1.6)}
  <circle cx="61" cy="39" r="2" fill="${PARCH}"/>`;

// ── 34. Trinity knot (triquetra) ──────────────────────────────────────────────
const TRINITY_GLYPH = `${_FAITH_TABLET}
  ${_g('M50 40 Q60 50 50 60 Q40 50 50 40 Z', 1.8)}
  ${_g('M50 60 Q38 52 44 42 Q54 48 50 60 Z', 1.8)}
  ${_g('M50 60 Q62 52 56 42 Q46 48 50 60 Z', 1.8)}`;

// ── 35. Cross fleury (ornate budded arms) ─────────────────────────────────────
const CROSSFLEURY_GLYPH = `${_FAITH_TABLET}
  ${_g('M50 34 L50 74', 2.4)}
  ${_g('M36 52 L64 52', 2.4)}
  <path d="M50 34 Q46 30 50 28 Q54 30 50 34" stroke="${PARCH}" stroke-width="1.4" fill="${PARCHG}"/>
  <path d="M50 74 Q46 78 50 80 Q54 78 50 74" stroke="${PARCH}" stroke-width="1.4" fill="${PARCHG}"/>
  <path d="M36 52 Q32 48 30 52 Q32 56 36 52" stroke="${PARCH}" stroke-width="1.4" fill="${PARCHG}"/>
  <path d="M64 52 Q68 48 70 52 Q68 56 64 52" stroke="${PARCH}" stroke-width="1.4" fill="${PARCHG}"/>`;

// ── 36. Hand pointing heavenward ──────────────────────────────────────────────
const HANDUP_GLYPH = `${_FAITH_TABLET}
  ${_g('M50 36 L50 50', 2.2)}
  <path d="M44 50 Q44 46 46 46 Q47 50 47 50 Q47 44 49 44 Q50 50 50 50 Q50 43 52 43 Q53 50 53 50 Q53 45 55 45 Q56 50 56 52 L56 62 Q56 68 50 68 Q44 68 44 62 Z" stroke="${PARCH}" stroke-width="1.6" fill="${PARCHG}"/>
  <path d="M44 56 Q40 56 40 60 Q40 64 44 64" stroke="${PARCH}" stroke-width="1.4" fill="none"/>`;

// ── 37. Crown of life ─────────────────────────────────────────────────────────
const CROWN_GLYPH = `${_FAITH_TABLET}
  <path d="M36 64 L32 44 L42 54 L50 40 L58 54 L68 44 L64 64 Z" stroke="${PARCH}" stroke-width="1.8" fill="${PARCHG}" stroke-linejoin="round"/>
  ${_g('M36 64 L64 64', 1.8)}
  <circle cx="32" cy="44" r="2" fill="${PARCH}"/>
  <circle cx="50" cy="40" r="2" fill="${PARCH}"/>
  <circle cx="68" cy="44" r="2" fill="${PARCH}"/>`;

// ── 38. All-seeing eye (REDRAWN — bolder triangle, clearer eye + rays) ─────────
const EYE_GLYPH = `${_FAITH_TABLET}
  ${_g('M50 36 L67 66 L33 66 Z', 2)}
  <path d="M40 56 Q50 49 60 56 Q50 63 40 56 Z" stroke="${PARCH}" stroke-width="1.6" fill="${PARCHG}"/>
  <circle cx="50" cy="56" r="2.8" fill="${PARCH}"/>
  ${_g('M50 33 L50 28', 1.4)}
  ${_g('M39 37 L34 33', 1.4)}
  ${_g('M61 37 L66 33', 1.4)}`;

// ── 39. Angel / winged figure (REDRAWN — clearer head, body & wings) ──────────
const ANGEL_GLYPH = `${_FAITH_TABLET}
  <circle cx="50" cy="42" r="4.5" stroke="${PARCH}" stroke-width="1.8" fill="${PARCHG}"/>
  <path d="M50 47 Q43 51 43 72 L57 72 Q57 51 50 47 Z" stroke="${PARCH}" stroke-width="1.8" fill="${PARCHG}"/>
  <path d="M44 53 Q31 50 29 66 Q40 59 46 61 Z" stroke="${PARCH}" stroke-width="1.6" fill="${PARCHG}"/>
  <path d="M56 53 Q69 50 71 66 Q60 59 54 61 Z" stroke="${PARCH}" stroke-width="1.6" fill="${PARCHG}"/>
  <ellipse cx="50" cy="34" rx="5.5" ry="1.8" stroke="${PARCH}" stroke-width="1.4" fill="none"/>`;

// ── 40. Khanda (REDRAWN — bolder ring + swords, clearer double-edge) ──────────
const KHANDA_GLYPH = `${_FAITH_TABLET}
  <circle cx="50" cy="56" r="11" stroke="${PARCH}" stroke-width="2.2" fill="none"/>
  ${_g('M50 37 L50 70', 2.2)}
  <path d="M50 44 L52.5 40 L50 35 L47.5 40 Z" stroke="${PARCH}" stroke-width="1.2" fill="${PARCHG}"/>
  ${_g('M39 47 Q33 56 39 65', 2)}
  ${_g('M61 47 Q67 56 61 65', 2)}`;

// Pack definitions — drive the picker's tab row (order = display order).
// Add a pack here and tag its markers with the matching `pack` id below.
const MARKER_PACKS = [
  { id: 'classic', label: 'Classic' },
  { id: 'faith',   label: 'Faith' },
];

const MARKER_STYLES = [
  { id: 'book',      label: 'Open Book',     pack: 'classic', glyph: BOOK_GLYPH },
  { id: 'arched',    label: 'Arched',        pack: 'classic', glyph: ARCHED_GLYPH },
  { id: 'cross-tab', label: 'Cross Tablet',  pack: 'classic', glyph: CROSS_TABLET_GLYPH },
  { id: 'cross',     label: 'Cross',         pack: 'classic', glyph: CROSS_GLYPH },
  { id: 'celtic',    label: 'Celtic Cross',  pack: 'classic', glyph: CELTIC_CROSS_GLYPH },
  { id: 'obelisk',   label: 'Obelisk',       pack: 'classic', glyph: OBELISK_GLYPH },
  { id: 'scroll',    label: 'Scroll',        pack: 'classic', glyph: SCROLL_GLYPH },
  { id: 'rose',      label: 'Rose',          pack: 'classic', glyph: ROSE_GLYPH },
  { id: 'skull',     label: 'Skull',         pack: 'classic', glyph: SKULL_GLYPH },
  { id: 'ornate',    label: 'Ornate',        pack: 'classic', glyph: ORNATE_GLYPH },
  { id: 'gothic',    label: 'Gothic Arch',   pack: 'classic', glyph: GOTHIC_ARCH_GLYPH },
  { id: 'heart',     label: 'Heart',         pack: 'classic', glyph: HEART_GLYPH },
  { id: 'praying',   label: 'Praying Hands', pack: 'classic', glyph: PRAYING_HANDS_GLYPH },
  { id: 'dove',      label: 'Dove',          pack: 'classic', glyph: DOVE_GLYPH },
  { id: 'anchor',    label: 'Anchor',        pack: 'classic', glyph: ANCHOR_GLYPH },
  { id: 'column',    label: 'Broken Column', pack: 'classic', glyph: COLUMN_GLYPH },
  { id: 'urn',       label: 'Urn',           pack: 'classic', glyph: URN_GLYPH },
  { id: 'willow',    label: 'Willow',        pack: 'classic', glyph: WILLOW_GLYPH },
  { id: 'star',      label: 'Star of David', pack: 'classic', glyph: STAR_GLYPH },
  { id: 'flat',      label: 'Lawn Marker',   pack: 'classic', glyph: FLAT_GLYPH },
  // ── Pack 2 — Faith & Religious ──
  { id: 'ankh',         label: 'Ankh',            pack: 'faith', glyph: ANKH_GLYPH },
  { id: 'crescent',     label: 'Crescent & Star', pack: 'faith', glyph: CRESCENT_GLYPH },
  { id: 'menorah',      label: 'Menorah',         pack: 'faith', glyph: MENORAH_GLYPH },
  { id: 'chirho',       label: 'Chi-Rho',         pack: 'faith', glyph: CHIRHO_GLYPH },
  { id: 'wheat',        label: 'Wheat Sheaf',     pack: 'faith', glyph: WHEAT_GLYPH },
  { id: 'orthodox',     label: 'Orthodox Cross',  pack: 'faith', glyph: ORTHODOX_GLYPH },
  { id: 'alphaomega',   label: 'Alpha & Omega',   pack: 'faith', glyph: ALPHAOMEGA_GLYPH },
  { id: 'sacredheart',  label: 'Sacred Heart',    pack: 'faith', glyph: SACREDHEART_GLYPH },
  { id: 'lamb',         label: 'Lamb of God',     pack: 'faith', glyph: LAMB_GLYPH },
  { id: 'scripture',    label: 'Open Scripture',  pack: 'faith', glyph: SCRIPTURE_GLYPH },
  { id: 'chalice',      label: 'Chalice',         pack: 'faith', glyph: CHALICE_GLYPH },
  { id: 'lotus',        label: 'Lotus',           pack: 'faith', glyph: LOTUS_GLYPH },
  { id: 'om',           label: 'Om',              pack: 'faith', glyph: OM_GLYPH },
  { id: 'trinity',      label: 'Trinity Knot',    pack: 'faith', glyph: TRINITY_GLYPH },
  { id: 'crossfleury',  label: 'Cross Fleury',    pack: 'faith', glyph: CROSSFLEURY_GLYPH },
  { id: 'handup',       label: 'Hand Heavenward', pack: 'faith', glyph: HANDUP_GLYPH },
  { id: 'crown',        label: 'Crown of Life',   pack: 'faith', glyph: CROWN_GLYPH },
  { id: 'eye',          label: 'All-Seeing Eye',  pack: 'faith', glyph: EYE_GLYPH },
  { id: 'angel',        label: 'Angel',           pack: 'faith', glyph: ANGEL_GLYPH },
  { id: 'khanda',       label: 'Khanda',          pack: 'faith', glyph: KHANDA_GLYPH },
];

const DEFAULT_MARKER = 'book';

const _markerById = Object.fromEntries(MARKER_STYLES.map(m => [m.id, m]));

// Resolve a stored style id to a descriptor, falling back to the default marker
// for null / unknown / legacy values so existing pins always render.
function getMarker(id) {
  return _markerById[id] || _markerById[DEFAULT_MARKER];
}

// Returns a self-contained <svg> string for a marker style at the given size.
// Injects the shared <defs> so the glyph's url(#…) gradient refs resolve.
// Used by both the Leaflet divIcon and the result-screen picker grid.
function graveMarkerSvg(styleId, size = 32) {
  const { glyph } = getMarker(styleId);
  return `<svg viewBox="0 0 100 100" fill="none" xmlns="http://www.w3.org/2000/svg" style="width:${size}px;height:${size}px;display:block;">${_DEFS}${glyph}</svg>`;
}
