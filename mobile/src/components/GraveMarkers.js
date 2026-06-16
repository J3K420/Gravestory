// GraveMarkers.js — 40 hand-built SVG gravestone markers for the Cemetery map.
//
// Each entry is a "glyph": a React fragment of raw SVG primitives on the shared
// viewBox="0 0 100 100". A single <Svg> wrapper (GraveMarkerSvg) owns width/height
// AND the shared <Defs>, so the same glyphs render both on the map (react-native-
// maps <Marker> child) and in the Result-screen picker grid at any size.
//
// DEPTH TREATMENT (gradient-based, NO SVG filters — react-native-svg does not
// reliably support feGaussianBlur/feDropShadow on Android, so depth comes from
// LinearGradient + RadialGradient only). Byte-for-byte equivalent to the web
// glyphs in js/grave-markers.js:
//   • goldGrad   — bright→deep gold so the stone outline reads as polished metal
//   • stoneGrad  — vertical lit-top→dark-base gradient = a lit rounded stone face
//   • parchGrad  — same lit→shadow idea for carved parchment fills
//   • groundGrad — soft radial ellipse under each pin so it sits, not floats
//   • <Groove d w/> — the path drawn twice, a dark "far wall" offset +~1px under
//                     the bright parchment "near wall" = an incised carved line
//
// Visual language: gold stroke (#c9a84c), dark stone, parchment detail (#e8d4a0).
//
// Public API:
//   MARKER_STYLES   — ordered array of { id, label, pack, Glyph }
//   MARKER_PACKS    — ordered pack tabs for the picker
//   DEFAULT_MARKER  — 'book' (the original GravestoneMarker; existing pins are unchanged)
//   getMarker(id)   — resolve an id (or null/unknown) to a descriptor, falling back to default
//   GraveMarkerSvg  — <GraveMarkerSvg styleId={...} size={32} /> renderer

import React from 'react';
import Svg, {
  Rect, Path, Line, Circle, Ellipse, Polygon, G,
  Defs, LinearGradient, RadialGradient, Stop,
} from 'react-native-svg';

const GOLD = '#c9a84c';
const PARCH = '#e8d4a0';

// Gradient stops (byte-for-byte in sync with web js/grave-markers.js).
const GOLD_HI = '#e6c870';            // lit gold (top)
const GOLD_LO = '#9c7e34';            // shadowed gold (base)
const STONE_HI = '#2c2418';           // lit top of the stone face
const STONE_LO = '#0f0b06';           // shadowed base of the stone
const GROOVE_DK = 'rgba(10,7,3,0.55)';// far wall of an incised groove

const STONE = 'url(#stoneGrad)';   // lit stone face
const GOLDG = 'url(#goldGrad)';    // polished-metal gold stroke
const PARCHG = 'url(#parchGrad)';  // lit parchment fill
// Pack-3 (Nature & Flora) foliage accent: faint green-tinted parchment. Only the
// leaf/petal/plant DETAIL uses it — stone + gold stroke stay identical, so the
// global-map gold identity survives.
const LEAF = '#c6d696';            // green-tinted parchment stroke
const LEAFG = 'url(#leafGrad)';    // green-tinted parchment fill

// Shared <Defs> rendered once per <Svg> wrapper; glyphs reference via url(#id).
const MarkerDefs = () => (
  <Defs>
    <LinearGradient id="goldGrad" x1="0" y1="0" x2="0" y2="1">
      <Stop offset="0" stopColor={GOLD_HI} />
      <Stop offset="0.5" stopColor={GOLD} />
      <Stop offset="1" stopColor={GOLD_LO} />
    </LinearGradient>
    <LinearGradient id="stoneGrad" x1="0" y1="0" x2="0" y2="1">
      <Stop offset="0" stopColor={STONE_HI} />
      <Stop offset="1" stopColor={STONE_LO} />
    </LinearGradient>
    <LinearGradient id="parchGrad" x1="0" y1="0" x2="0" y2="1">
      <Stop offset="0" stopColor="rgba(232,212,160,0.34)" />
      <Stop offset="1" stopColor="rgba(232,212,160,0.12)" />
    </LinearGradient>
    <LinearGradient id="leafGrad" x1="0" y1="0" x2="0" y2="1">
      <Stop offset="0" stopColor="rgba(198,214,150,0.34)" />
      <Stop offset="1" stopColor="rgba(150,176,110,0.14)" />
    </LinearGradient>
    <RadialGradient id="groundGrad" cx="0.5" cy="0.5" r="0.5">
      <Stop offset="0" stopColor="rgba(0,0,0,0.45)" />
      <Stop offset="0.7" stopColor="rgba(0,0,0,0.22)" />
      <Stop offset="1" stopColor="rgba(0,0,0,0)" />
    </RadialGradient>
  </Defs>
);

// Soft ground shadow, drawn first so the stone sits on it.
const Ground = () => <Ellipse cx="50" cy="90" rx="30" ry="6" fill="url(#groundGrad)" />;

// Shared base step drawn under most upright stones (now gradient-lit).
const Base = () => (
  <>
    <Ground />
    <Rect x="22" y="84" width="56" height="6" stroke={GOLDG} strokeWidth="2" fill={STONE} />
  </>
);

// Carved-groove stroke: a dark "far wall" offset down/right, then the bright
// parchment "near wall" on top → reads as an incised line. Use for all parchment
// OUTLINE detail (crosses, lettering, fluting, rays…).
const Groove = ({ d, w }) => (
  <>
    <G x={0.9} y={1}>
      <Path d={d} stroke={GROOVE_DK} strokeWidth={w} fill="none" strokeLinecap="round" />
    </G>
    <Path d={d} stroke={PARCH} strokeWidth={w} fill="none" strokeLinecap="round" />
  </>
);

// Green-accent groove for Pack-3 foliage outline detail (stems, veins, fronds).
const GrooveLeaf = ({ d, w }) => (
  <>
    <G x={0.9} y={1}>
      <Path d={d} stroke={GROOVE_DK} strokeWidth={w} fill="none" strokeLinecap="round" />
    </G>
    <Path d={d} stroke={LEAF} strokeWidth={w} fill="none" strokeLinecap="round" />
  </>
);

// ── 1. Book (default — matches the original marker) ───────────────────────────
const BookGlyph = () => (
  <G>
    <Base />
    <Path d="M30 84 L30 35 Q30 18 50 18 Q70 18 70 35 L70 84 Z" stroke={GOLDG} strokeWidth="2.2" fill={STONE} />
    <Path d="M38 40 L38 56 Q44 54 49 56 L49 42 Q44 40 38 40 Z" stroke={PARCH} strokeWidth="2" fill={PARCHG} />
    <Path d="M51 42 Q56 40 62 40 L62 56 Q56 54 51 56 Z" stroke={PARCH} strokeWidth="2" fill={PARCHG} />
    <Groove d="M50 41 L50 56" w={1.5} />
    <Groove d="M50 63 L50 76" w={1.5} />
    <Groove d="M44 68 L56 68" w={1.5} />
  </G>
);

// ── 2. Arched (plain rounded top) ─────────────────────────────────────────────
const ArchedGlyph = () => (
  <G>
    <Base />
    <Path d="M30 84 L30 38 Q30 18 50 18 Q70 18 70 38 L70 84 Z" stroke={GOLDG} strokeWidth="2.2" fill={STONE} />
    <Groove d="M38 48 L62 48" w={1.4} />
    <Groove d="M38 58 L62 58" w={1.4} />
    <Groove d="M38 68 L62 68" w={1.4} />
  </G>
);

// ── 3. Cross-topped tablet ────────────────────────────────────────────────────
const CrossTabletGlyph = () => (
  <G>
    <Base />
    <Path d="M30 84 L30 44 Q30 30 50 30 Q70 30 70 44 L70 84 Z" stroke={GOLDG} strokeWidth="2.2" fill={STONE} />
    <Groove d="M50 8 L50 28" w={2.4} />
    <Groove d="M41 15 L59 15" w={2.4} />
    <Groove d="M40 54 L60 54" w={1.4} />
    <Groove d="M40 64 L60 64" w={1.4} />
  </G>
);

// ── 4. Latin standing cross ───────────────────────────────────────────────────
const CrossGlyph = () => (
  <G>
    <Ground />
    <Rect x="34" y="82" width="32" height="8" stroke={GOLDG} strokeWidth="2" fill={STONE} />
    <Path d="M44 82 L44 24 L56 24 L56 82 Z" stroke={GOLDG} strokeWidth="2.2" fill={STONE} />
    <Path d="M30 38 L70 38 L70 50 L30 50 Z" stroke={GOLDG} strokeWidth="2.2" fill={STONE} />
  </G>
);

// ── 5. Celtic cross (ringed) ──────────────────────────────────────────────────
// Arms are filled <Rect>s (not <Line>s) so the vertical goldGrad has a real
// bounding box — a zero-height horizontal line collapses the gradient.
const CelticCrossGlyph = () => (
  <G>
    <Ground />
    <Rect x="36" y="82" width="28" height="8" stroke={GOLDG} strokeWidth="2" fill={STONE} />
    <Rect x="47" y="14" width="6" height="68" fill={GOLDG} />
    <Rect x="28" y="37" width="44" height="6" fill={GOLDG} />
    <Circle cx="50" cy="40" r="16" stroke={GOLDG} strokeWidth="2.4" fill="none" />
  </G>
);

// ── 6. Obelisk ────────────────────────────────────────────────────────────────
const ObeliskGlyph = () => (
  <G>
    <Ground />
    <Rect x="34" y="82" width="32" height="8" stroke={GOLDG} strokeWidth="2" fill={STONE} />
    <Rect x="40" y="72" width="20" height="12" stroke={GOLDG} strokeWidth="2" fill={STONE} />
    <Path d="M44 72 L44 22 L50 10 L56 22 L56 72 Z" stroke={GOLDG} strokeWidth="2.2" fill={STONE} />
    <Groove d="M50 26 L50 70" w={1.2} />
  </G>
);

// ── 7. Scroll / parchment ─────────────────────────────────────────────────────
const ScrollGlyph = () => (
  <G>
    <Base />
    <Path d="M32 28 Q32 20 40 20 L68 20 Q60 22 60 30 L60 78 Q60 84 52 84 L34 84 Q32 80 32 74 Z"
      stroke={GOLDG} strokeWidth="2.2" fill={STONE} />
    <Path d="M60 20 Q70 20 70 28 Q70 34 62 32" stroke={GOLDG} strokeWidth="2" fill="none" />
    <Groove d="M38 40 L56 40" w={1.3} />
    <Groove d="M38 50 L56 50" w={1.3} />
    <Groove d="M38 60 L56 60" w={1.3} />
  </G>
);

// ── 8. Rose ───────────────────────────────────────────────────────────────────
const RoseGlyph = () => (
  <G>
    <Base />
    <Path d="M30 84 L30 40 Q30 22 50 22 Q70 22 70 40 L70 84 Z" stroke={GOLDG} strokeWidth="2.2" fill={STONE} />
    <Circle cx="50" cy="46" r="9" stroke={PARCH} strokeWidth="1.6" fill={PARCHG} />
    <Groove d="M50 46 m -4 0 a 4 4 0 1 0 8 0 a 4 4 0 1 0 -8 0" w={1.4} />
    <Groove d="M50 55 L50 72" w={1.6} />
    <Path d="M50 62 Q42 60 40 54 Q48 54 50 62 Z" stroke={PARCH} strokeWidth="1.2" fill={PARCHG} />
    <Path d="M50 66 Q58 64 60 58 Q52 58 50 66 Z" stroke={PARCH} strokeWidth="1.2" fill={PARCHG} />
  </G>
);

// ── 9. Skull (memento mori) ───────────────────────────────────────────────────
const SkullGlyph = () => (
  <G>
    <Base />
    <Path d="M30 84 L30 42 Q30 24 50 24 Q70 24 70 42 L70 84 Z" stroke={GOLDG} strokeWidth="2.2" fill={STONE} />
    <Path d="M40 50 Q40 38 50 38 Q60 38 60 50 Q60 58 55 60 L45 60 Q40 58 40 50 Z"
      stroke={PARCH} strokeWidth="1.6" fill={PARCHG} />
    <Circle cx="46" cy="49" r="2.4" fill={GROOVE_DK} />
    <Circle cx="54" cy="49" r="2.4" fill={GROOVE_DK} />
    <Path d="M48 56 L50 60 L52 56 Z" fill={GROOVE_DK} />
    <Groove d="M46 64 L54 64" w={1.4} />
  </G>
);

// ── 10. Ornate / scrolled crown ───────────────────────────────────────────────
const OrnateGlyph = () => (
  <G>
    <Base />
    <Path d="M32 84 L32 40 L68 40 L68 84 Z" stroke={GOLDG} strokeWidth="2.2" fill={STONE} />
    <Path d="M28 40 Q28 26 38 26 Q42 18 50 18 Q58 18 62 26 Q72 26 72 40 Z"
      stroke={GOLDG} strokeWidth="2.2" fill={STONE} />
    <Groove d="M40 30 Q44 24 50 28 Q56 24 60 30" w={1.4} />
    <Groove d="M40 52 L60 52" w={1.3} />
    <Groove d="M40 62 L60 62" w={1.3} />
  </G>
);

// ── 11. Gothic pointed arch ───────────────────────────────────────────────────
const GothicArchGlyph = () => (
  <G>
    <Base />
    <Path d="M30 84 L30 40 Q30 30 50 12 Q70 30 70 40 L70 84 Z" stroke={GOLDG} strokeWidth="2.2" fill={STONE} />
    <Groove d="M38 44 Q38 36 50 26 Q62 36 62 44 L62 60 L38 60 Z" w={1.4} />
    <Groove d="M40 70 L60 70" w={1.3} />
  </G>
);

// ── 12. Heart ─────────────────────────────────────────────────────────────────
const HeartGlyph = () => (
  <G>
    <Base />
    <Path d="M30 84 L30 40 Q30 22 50 22 Q70 22 70 40 L70 84 Z" stroke={GOLDG} strokeWidth="2.2" fill={STONE} />
    <Path d="M50 62 Q40 52 40 46 Q40 40 45 40 Q49 40 50 45 Q51 40 55 40 Q60 40 60 46 Q60 52 50 62 Z"
      stroke={PARCH} strokeWidth="1.6" fill={PARCHG} />
  </G>
);

// ── 13. Praying hands ─────────────────────────────────────────────────────────
const PrayingHandsGlyph = () => (
  <G>
    <Base />
    <Path d="M30 84 L30 40 Q30 22 50 22 Q70 22 70 40 L70 84 Z" stroke={GOLDG} strokeWidth="2.2" fill={STONE} />
    <Path d="M48 68 L44 50 Q43 40 48 38 L50 66 Z" stroke={PARCH} strokeWidth="1.5" fill={PARCHG} />
    <Path d="M52 68 L56 50 Q57 40 52 38 L50 66 Z" stroke={PARCH} strokeWidth="1.5" fill={PARCHG} />
  </G>
);

// ── 14. Dove ──────────────────────────────────────────────────────────────────
const DoveGlyph = () => (
  <G>
    <Base />
    <Path d="M30 84 L30 40 Q30 22 50 22 Q70 22 70 40 L70 84 Z" stroke={GOLDG} strokeWidth="2.2" fill={STONE} />
    <Path d="M42 56 Q48 44 60 44 Q54 48 56 54 Q50 50 44 58 Z" stroke={PARCH} strokeWidth="1.5" fill={PARCHG} />
    <Path d="M60 44 L66 42 L62 48 Z" stroke={PARCH} strokeWidth="1.2" fill={PARCHG} />
  </G>
);

// ── 15. Anchor (hope / mariner) ───────────────────────────────────────────────
const AnchorGlyph = () => (
  <G>
    <Base />
    <Path d="M30 84 L30 42 Q30 24 50 24 Q70 24 70 42 L70 84 Z" stroke={GOLDG} strokeWidth="2.2" fill={STONE} />
    <Circle cx="50" cy="38" r="3" stroke={PARCH} strokeWidth="1.6" fill="none" />
    <Groove d="M50 41 L50 70" w={1.8} />
    <Groove d="M42 48 L58 48" w={1.8} />
    <Groove d="M38 60 Q42 70 50 70 Q58 70 62 60" w={1.8} />
  </G>
);

// ── 16. Broken column (life cut short) — snapped classical column on a plinth ──
const BrokenColumnGlyph = () => (
  <G>
    <Ground />
    <Rect x="28" y="80" width="44" height="8" stroke={GOLDG} strokeWidth="2" fill={STONE} />
    <Rect x="34" y="72" width="32" height="8" stroke={GOLDG} strokeWidth="2" fill={STONE} />
    <Path d="M40 72 L40 40 L42 36 L58 32 L60 36 L60 72 Z"
      stroke={PARCH} strokeWidth="1.8" fill={PARCHG} strokeLinejoin="round" />
    <Groove d="M46 44 L46 70" w={1.2} />
    <Groove d="M50 42 L50 70" w={1.2} />
    <Groove d="M54 40 L54 70" w={1.2} />
    <Groove d="M38 70 L62 70" w={1.6} />
  </G>
);

// ── 17. Classical funerary urn on a stepped plinth ────────────────────────────
const UrnGlyph = () => (
  <G>
    <Ground />
    <Rect x="30" y="80" width="40" height="8" stroke={GOLDG} strokeWidth="2" fill={STONE} />
    <Rect x="38" y="73" width="24" height="7" stroke={GOLDG} strokeWidth="2" fill={STONE} />
    <Path d="M45 73 L43 68 L57 68 L55 73 Z" stroke={PARCH} strokeWidth="1.6" fill={PARCHG} strokeLinejoin="round" />
    <Path d="M43 68 Q34 60 38 50 L62 50 Q66 60 57 68 Z"
      stroke={PARCH} strokeWidth="1.8" fill={PARCHG} strokeLinejoin="round" />
    <Rect x="36" y="46" width="28" height="4" rx="1" stroke={PARCH} strokeWidth="1.6" fill={PARCHG} />
    <Path d="M40 46 Q40 38 50 38 Q60 38 60 46 Z" stroke={PARCH} strokeWidth="1.6" fill={PARCHG} strokeLinejoin="round" />
    <Circle cx="50" cy="35" r="2.4" stroke={PARCH} strokeWidth="1.5" fill={STONE} />
    <Path d="M40 53 Q31 53 35 62" stroke={PARCH} strokeWidth="1.5" fill="none" />
    <Path d="M60 53 Q69 53 65 62" stroke={PARCH} strokeWidth="1.5" fill="none" />
  </G>
);

// ── 18. Weeping willow ────────────────────────────────────────────────────────
const WillowGlyph = () => (
  <G>
    <Base />
    <Path d="M30 84 L30 40 Q30 22 50 22 Q70 22 70 40 L70 84 Z" stroke={GOLDG} strokeWidth="2.2" fill={STONE} />
    <Groove d="M50 70 L50 44" w={1.6} />
    <Groove d="M50 44 Q40 42 36 56" w={1.3} />
    <Groove d="M50 44 Q46 42 44 60" w={1.3} />
    <Groove d="M50 44 Q60 42 64 56" w={1.3} />
    <Groove d="M50 44 Q54 42 56 60" w={1.3} />
  </G>
);

// ── 19. Star of David ─────────────────────────────────────────────────────────
const StarOfDavidGlyph = () => (
  <G>
    <Base />
    <Path d="M30 84 L30 40 Q30 24 50 24 Q70 24 70 40 L70 84 Z" stroke={GOLDG} strokeWidth="2.2" fill={STONE} />
    <Groove d="M50 36 L60 54 L40 54 Z" w={1.6} />
    <Groove d="M50 60 L40 42 L60 42 Z" w={1.6} />
  </G>
);

// ── 20. Flat / lawn marker ────────────────────────────────────────────────────
const FlatGlyph = () => (
  <G>
    <Ground />
    <Path d="M20 58 L80 58 L84 78 L16 78 Z" stroke={GOLDG} strokeWidth="2.2" fill={STONE} />
    <Groove d="M32 66 L68 66" w={1.4} />
    <Groove d="M36 72 L64 72" w={1.3} />
  </G>
);

// ═══════════════════════════════════════════════════════════════════════════════
// PACK 2 — FAITH & RELIGIOUS (glyphs 21-40)
// Same gold-stroke / parchment-detail palette + depth treatment as Pack 1. The
// busiest emblems (menorah, om, khanda, eye, angel) were redrawn bolder so they
// survive at ~32px map size. Byte-for-byte equivalent to web js/grave-markers.js.
// ═══════════════════════════════════════════════════════════════════════════════

// Shared arched faith-tablet silhouette many Pack-2 emblems are carved onto.
const FaithTablet = () => (
  <>
    <Base />
    <Path d="M30 84 L30 40 Q30 22 50 22 Q70 22 70 40 L70 84 Z" stroke={GOLDG} strokeWidth="2.2" fill={STONE} />
  </>
);

// ── 21. Ankh ──────────────────────────────────────────────────────────────────
const AnkhGlyph = () => (
  <G>
    <FaithTablet />
    <Groove d="M50 42 m -8 0 a 8 10 0 1 0 16 0 a 8 10 0 1 0 -16 0" w={2} />
    <Groove d="M50 52 L50 74" w={2.4} />
    <Groove d="M40 60 L60 60" w={2.4} />
  </G>
);

// ── 22. Crescent & star (Islamic) ─────────────────────────────────────────────
const CrescentGlyph = () => (
  <G>
    <FaithTablet />
    <Path d="M51 38 Q37 38 37 52 Q37 66 51 66 Q42 60 42 52 Q42 44 51 38 Z" stroke={PARCH} strokeWidth="1.8" fill={PARCHG} />
    <Polygon points="55,46 57,52 63,52 58,56 60,62 55,58 50,62 52,56 47,52 53,52" stroke={PARCH} strokeWidth="1.2" fill={PARCHG} />
  </G>
);

// ── 23. Menorah (REDRAWN — bolder shaft, fewer hairlines, dotted flames) ───────
const MenorahGlyph = () => (
  <G>
    <FaithTablet />
    <Groove d="M50 46 L50 72" w={2.2} />
    <Groove d="M40 74 L60 74" w={2.4} />
    <Groove d="M44 76 L44 72" w={2} />
    <Groove d="M56 76 L56 72" w={2} />
    <Groove d="M50 60 Q42 60 42 48" w={1.9} />
    <Groove d="M50 60 Q58 60 58 48" w={1.9} />
    <Groove d="M50 56 Q35 56 35 46" w={1.9} />
    <Groove d="M50 56 Q65 56 65 46" w={1.9} />
    <Groove d="M50 52 Q29 52 29 44" w={1.9} />
    <Groove d="M50 52 Q71 52 71 44" w={1.9} />
    <G fill={PARCH}>
      <Circle cx="29" cy="43" r="1.6" /><Circle cx="35" cy="45" r="1.6" /><Circle cx="42" cy="47" r="1.6" />
      <Circle cx="50" cy="45" r="1.6" /><Circle cx="58" cy="47" r="1.6" /><Circle cx="65" cy="45" r="1.6" /><Circle cx="71" cy="43" r="1.6" />
    </G>
  </G>
);

// ── 24. Chi-Rho ───────────────────────────────────────────────────────────────
const ChiRhoGlyph = () => (
  <G>
    <FaithTablet />
    <Groove d="M50 34 L50 72" w={2.2} />
    <Groove d="M50 40 Q60 40 60 48 Q60 56 50 56" w={2} />
    <Groove d="M40 60 L60 72" w={2} />
    <Groove d="M60 60 L40 72" w={2} />
  </G>
);

// ── 25. Wheat sheaf (a long life "harvested") ─────────────────────────────────
const WheatGlyph = () => (
  <G>
    <FaithTablet />
    <Groove d="M50 70 L50 42" w={1.6} />
    <Groove d="M50 70 Q44 58 42 44" w={1.6} />
    <Groove d="M50 70 Q56 58 58 44" w={1.6} />
    <Groove d="M50 70 Q40 60 36 49" w={1.4} />
    <Groove d="M50 70 Q60 60 64 49" w={1.4} />
    <Groove d="M50 42 L47 45 M50 42 L53 45 M50 46 L47 49 M50 46 L53 49" w={1.3} />
    <Groove d="M42 44 L39 47 M42 44 L44 47 M43 49 L40 52 M43 49 L45 52" w={1.2} />
    <Groove d="M58 44 L55 47 M58 44 L61 47 M57 49 L54 52 M57 49 L60 52" w={1.2} />
    <Groove d="M36 49 L34 52 M36 49 L38 52" w={1.1} />
    <Groove d="M64 49 L62 52 M64 49 L66 52" w={1.1} />
    <Rect x="45" y="68" width="10" height="5" rx="1.5" stroke={PARCH} strokeWidth="1.6" fill={PARCHG} />
  </G>
);

// ── 26. Orthodox (three-bar) cross ────────────────────────────────────────────
const OrthodoxGlyph = () => (
  <G>
    <FaithTablet />
    <Groove d="M50 30 L50 76" w={2.4} />
    <Groove d="M44 38 L56 38" w={2} />
    <Groove d="M38 50 L62 50" w={2.4} />
    <Groove d="M42 66 L58 60" w={2} />
  </G>
);

// ── 27. Alpha & Omega ─────────────────────────────────────────────────────────
const AlphaOmegaGlyph = () => (
  <G>
    <FaithTablet />
    <Groove d="M41 62 L45 50 L49 62 M42.5 58 L47.5 58" w={1.7} />
    <Groove d="M53 62 Q53 50 58 50 Q63 50 63 62 M51.5 62 L55 62 M61 62 L64.5 62" w={1.7} />
  </G>
);

// ── 28. Sacred Heart (flaming, crowned with cross) ────────────────────────────
const SacredHeartGlyph = () => (
  <G>
    <FaithTablet />
    <Path d="M50 66 Q38 54 38 47 Q38 40 44 40 Q49 40 50 46 Q51 40 56 40 Q62 40 62 47 Q62 54 50 66 Z" stroke={PARCH} strokeWidth="1.8" fill={PARCHG} />
    <Groove d="M50 34 L50 42" w={1.8} />
    <Groove d="M46 37 L54 37" w={1.8} />
    <Groove d="M46 50 Q50 56 54 50" w={1.3} />
  </G>
);

// ── 29. Lamb of God (Agnus Dei) ───────────────────────────────────────────────
const LambGlyph = () => (
  <G>
    <FaithTablet />
    <Ellipse cx="50" cy="56" rx="13" ry="9" stroke={PARCH} strokeWidth="1.6" fill={PARCHG} />
    <Circle cx="38" cy="52" r="5" stroke={PARCH} strokeWidth="1.6" fill={PARCHG} />
    <Groove d="M44 63 L44 70" w={1.5} />
    <Groove d="M56 63 L56 70" w={1.5} />
    <Groove d="M60 40 L60 56" w={1.4} />
    <Path d="M60 40 L66 42 L60 45 Z" stroke={PARCH} strokeWidth="1" fill={PARCHG} />
  </G>
);

// ── 30. Open scripture on a stand ─────────────────────────────────────────────
const ScriptureGlyph = () => (
  <G>
    <FaithTablet />
    <Path d="M50 48 Q42 44 34 46 L34 64 Q42 62 50 66 Z" stroke={PARCH} strokeWidth="1.6" fill={PARCHG} />
    <Path d="M50 48 Q58 44 66 46 L66 64 Q58 62 50 66 Z" stroke={PARCH} strokeWidth="1.6" fill={PARCHG} />
    <Groove d="M38 52 L46 53" w={1} />
    <Groove d="M38 57 L46 58" w={1} />
    <Groove d="M54 53 L62 52" w={1} />
    <Groove d="M54 58 L62 57" w={1} />
    <Groove d="M42 70 L58 70" w={1.6} />
  </G>
);

// ── 31. Chalice ───────────────────────────────────────────────────────────────
const ChaliceGlyph = () => (
  <G>
    <FaithTablet />
    <Path d="M40 44 Q40 56 50 58 Q60 56 60 44 Z" stroke={PARCH} strokeWidth="1.8" fill={PARCHG} />
    <Groove d="M50 58 L50 68" w={1.8} />
    <Path d="M42 72 Q42 68 50 68 Q58 68 58 72 Z" stroke={PARCH} strokeWidth="1.8" fill={PARCHG} />
    <Circle cx="50" cy="38" r="3" stroke={PARCH} strokeWidth="1.4" fill="none" />
  </G>
);

// ── 32. Lotus (Buddhist / Hindu) — symmetric water-lily on a waterline ─────────
const LotusGlyph = () => (
  <G>
    <FaithTablet />
    <Path d="M50 64 Q45 52 50 42 Q55 52 50 64 Z" stroke={PARCH} strokeWidth="1.5" fill={PARCHG} />
    <Path d="M50 64 Q42 54 40 46 Q49 50 50 64 Z" stroke={PARCH} strokeWidth="1.5" fill={PARCHG} />
    <Path d="M50 64 Q58 54 60 46 Q51 50 50 64 Z" stroke={PARCH} strokeWidth="1.5" fill={PARCHG} />
    <Path d="M50 64 Q38 58 32 50 Q46 52 50 64 Z" stroke={PARCH} strokeWidth="1.4" fill={PARCHG} />
    <Path d="M50 64 Q62 58 68 50 Q54 52 50 64 Z" stroke={PARCH} strokeWidth="1.4" fill={PARCHG} />
    <Groove d="M34 66 Q50 72 66 66" w={1.4} />
  </G>
);

// ── 33. Om (REDRAWN — bolder, cleaner separated strokes) ──────────────────────
const OmGlyph = () => (
  <G>
    <FaithTablet />
    <Groove d="M42 52 Q33 52 33 60 Q33 69 43 69 Q51 69 51 61 Q51 55 44 55" w={2.1} />
    <Groove d="M44 55 Q44 48 51 48 Q58 48 58 54" w={2.1} />
    <Groove d="M51 60 Q59 60 63 67" w={2.1} />
    <Groove d="M55 44 Q61 41 67 45" w={1.6} />
    <Circle cx="61" cy="39" r="2" fill={PARCH} />
  </G>
);

// ── 34. Trinity knot (triquetra) ──────────────────────────────────────────────
const TrinityGlyph = () => (
  <G>
    <FaithTablet />
    <Groove d="M50 40 Q60 50 50 60 Q40 50 50 40 Z" w={1.8} />
    <Groove d="M50 60 Q38 52 44 42 Q54 48 50 60 Z" w={1.8} />
    <Groove d="M50 60 Q62 52 56 42 Q46 48 50 60 Z" w={1.8} />
  </G>
);

// ── 35. Cross fleury (ornate budded arms) ─────────────────────────────────────
const CrossFleuryGlyph = () => (
  <G>
    <FaithTablet />
    <Groove d="M50 34 L50 74" w={2.4} />
    <Groove d="M36 52 L64 52" w={2.4} />
    <Path d="M50 34 Q46 30 50 28 Q54 30 50 34" stroke={PARCH} strokeWidth="1.4" fill={PARCHG} />
    <Path d="M50 74 Q46 78 50 80 Q54 78 50 74" stroke={PARCH} strokeWidth="1.4" fill={PARCHG} />
    <Path d="M36 52 Q32 48 30 52 Q32 56 36 52" stroke={PARCH} strokeWidth="1.4" fill={PARCHG} />
    <Path d="M64 52 Q68 48 70 52 Q68 56 64 52" stroke={PARCH} strokeWidth="1.4" fill={PARCHG} />
  </G>
);

// ── 36. Hand pointing heavenward ──────────────────────────────────────────────
const HandUpGlyph = () => (
  <G>
    <FaithTablet />
    <Groove d="M50 36 L50 50" w={2.2} />
    <Path d="M44 50 Q44 46 46 46 Q47 50 47 50 Q47 44 49 44 Q50 50 50 50 Q50 43 52 43 Q53 50 53 50 Q53 45 55 45 Q56 50 56 52 L56 62 Q56 68 50 68 Q44 68 44 62 Z" stroke={PARCH} strokeWidth="1.6" fill={PARCHG} />
    <Path d="M44 56 Q40 56 40 60 Q40 64 44 64" stroke={PARCH} strokeWidth="1.4" fill="none" />
  </G>
);

// ── 37. Crown of life ─────────────────────────────────────────────────────────
const CrownGlyph = () => (
  <G>
    <FaithTablet />
    <Path d="M36 64 L32 44 L42 54 L50 40 L58 54 L68 44 L64 64 Z" stroke={PARCH} strokeWidth="1.8" fill={PARCHG} strokeLinejoin="round" />
    <Groove d="M36 64 L64 64" w={1.8} />
    <Circle cx="32" cy="44" r="2" fill={PARCH} />
    <Circle cx="50" cy="40" r="2" fill={PARCH} />
    <Circle cx="68" cy="44" r="2" fill={PARCH} />
  </G>
);

// ── 38. All-seeing eye (REDRAWN — bolder triangle, clearer eye + rays) ─────────
const EyeGlyph = () => (
  <G>
    <FaithTablet />
    <Groove d="M50 36 L67 66 L33 66 Z" w={2} />
    <Path d="M40 56 Q50 49 60 56 Q50 63 40 56 Z" stroke={PARCH} strokeWidth="1.6" fill={PARCHG} />
    <Circle cx="50" cy="56" r="2.8" fill={PARCH} />
    <Groove d="M50 33 L50 28" w={1.4} />
    <Groove d="M39 37 L34 33" w={1.4} />
    <Groove d="M61 37 L66 33" w={1.4} />
  </G>
);

// ── 39. Angel / winged figure (REDRAWN — clearer head, body & wings) ──────────
const AngelGlyph = () => (
  <G>
    <FaithTablet />
    <Circle cx="50" cy="42" r="4.5" stroke={PARCH} strokeWidth="1.8" fill={PARCHG} />
    <Path d="M50 47 Q43 51 43 72 L57 72 Q57 51 50 47 Z" stroke={PARCH} strokeWidth="1.8" fill={PARCHG} />
    <Path d="M44 53 Q31 50 29 66 Q40 59 46 61 Z" stroke={PARCH} strokeWidth="1.6" fill={PARCHG} />
    <Path d="M56 53 Q69 50 71 66 Q60 59 54 61 Z" stroke={PARCH} strokeWidth="1.6" fill={PARCHG} />
    <Ellipse cx="50" cy="34" rx="5.5" ry="1.8" stroke={PARCH} strokeWidth="1.4" fill="none" />
  </G>
);

// ── 40. Khanda (REDRAWN — bolder ring + swords, clearer double-edge) ──────────
const KhandaGlyph = () => (
  <G>
    <FaithTablet />
    <Circle cx="50" cy="56" r="11" stroke={PARCH} strokeWidth="2.2" fill="none" />
    <Groove d="M50 37 L50 70" w={2.2} />
    <Path d="M50 44 L52.5 40 L50 35 L47.5 40 Z" stroke={PARCH} strokeWidth="1.2" fill={PARCHG} />
    <Groove d="M39 47 Q33 56 39 65" w={2} />
    <Groove d="M61 47 Q67 56 61 65" w={2} />
  </G>
);

// ═══════════════════════════════════════════════════════════════════════════════
// PACK 3 — NATURE & FLORA (glyphs 41-60)
// Same depth treatment; FOLIAGE detail uses the green-tinted accent (LEAF/LEAFG/
// <GrooveLeaf>) so the pack reads as "nature" while stone + gold stroke keep the
// global-map gold identity. Byte-for-byte equivalent to web js/grave-markers.js.
// ═══════════════════════════════════════════════════════════════════════════════

const NatureTablet = () => (
  <>
    <Base />
    <Path d="M30 84 L30 40 Q30 22 50 22 Q70 22 70 40 L70 84 Z" stroke={GOLDG} strokeWidth="2.2" fill={STONE} />
  </>
);

// ── 41. Oak ───────────────────────────────────────────────────────────────────
const OakGlyph = () => (
  <G>
    <NatureTablet />
    <GrooveLeaf d="M50 72 L50 56" w={2} />
    <Path d="M50 58 Q34 58 34 47 Q34 36 44 37 Q46 29 50 29 Q54 29 56 37 Q66 36 66 47 Q66 58 50 58 Z" stroke={LEAF} strokeWidth="1.7" fill={LEAFG} />
    <GrooveLeaf d="M44 47 Q50 50 56 47" w={1.2} />
    <GrooveLeaf d="M50 40 L50 52" w={1.1} />
  </G>
);

// ── 42. Tree of Life ──────────────────────────────────────────────────────────
const TreeOfLifeGlyph = () => (
  <G>
    <NatureTablet />
    <Circle cx="50" cy="50" r="18" stroke={GOLDG} strokeWidth="1.6" fill="none" />
    <GrooveLeaf d="M50 50 L50 40" w={2} />
    <GrooveLeaf d="M50 42 Q42 40 38 34 M50 42 Q58 40 62 34" w={1.5} />
    <GrooveLeaf d="M50 45 Q44 44 41 39 M50 45 Q56 44 59 39" w={1.4} />
    <GrooveLeaf d="M50 40 Q48 36 49 32 M50 40 Q52 36 51 32" w={1.4} />
    <GrooveLeaf d="M50 50 L50 60" w={2} />
    <GrooveLeaf d="M50 58 Q42 60 38 66 M50 58 Q58 60 62 66" w={1.5} />
    <GrooveLeaf d="M50 55 Q44 56 41 61 M50 55 Q56 56 59 61" w={1.4} />
  </G>
);

// ── 43. Pine / evergreen ──────────────────────────────────────────────────────
const PineGlyph = () => (
  <G>
    <NatureTablet />
    <Groove d="M46 72 L54 72 L54 66 L46 66 Z" w={1.4} />
    <Path d="M50 30 L40 46 L46 46 L38 56 L46 56 L40 66 L60 66 L54 56 L62 56 L54 46 L60 46 Z" stroke={LEAF} strokeWidth="1.6" fill={LEAFG} strokeLinejoin="round" />
  </G>
);

// ── 44. Acorn ─────────────────────────────────────────────────────────────────
const AcornGlyph = () => (
  <G>
    <NatureTablet />
    <Path d="M40 50 Q40 68 50 70 Q60 68 60 50 Z" stroke={LEAF} strokeWidth="1.7" fill={LEAFG} />
    <Path d="M38 50 Q38 44 50 44 Q62 44 62 50 Q62 53 50 53 Q38 53 38 50 Z" stroke={LEAF} strokeWidth="1.6" fill={LEAFG} />
    <GrooveLeaf d="M50 44 L50 38" w={1.4} />
    <Groove d="M42 50 L58 50" w={1} />
  </G>
);

// ── 45. Fallen tree / stump ───────────────────────────────────────────────────
const FallenTreeGlyph = () => (
  <G>
    <NatureTablet />
    <Path d="M40 70 L40 50 Q40 46 50 46 Q60 46 60 50 L60 70 Z" stroke={PARCH} strokeWidth="1.8" fill={PARCHG} />
    <Ellipse cx="50" cy="48" rx="10" ry="3.4" stroke={PARCH} strokeWidth="1.5" fill={PARCHG} />
    <Ellipse cx="50" cy="48" rx="5" ry="1.7" stroke={PARCH} strokeWidth="1" fill="none" />
    <GrooveLeaf d="M62 52 Q72 50 74 42 M62 56 Q70 56 73 50" w={1.3} />
  </G>
);

// ── 46. Fern ──────────────────────────────────────────────────────────────────
const FernGlyph = () => (
  <G>
    <NatureTablet />
    <GrooveLeaf d="M42 72 Q46 50 58 34" w={1.8} />
    <GrooveLeaf d="M44 64 Q38 62 36 64 M47 57 Q41 55 39 57 M50 50 Q44 48 42 50 M53 44 Q48 41 46 43 M56 39 Q52 36 50 37" w={1.2} />
    <GrooveLeaf d="M44 64 Q47 60 50 61 M47 57 Q50 53 53 54 M50 50 Q53 46 56 47 M53 44 Q56 41 58 42" w={1.2} />
  </G>
);

// ── 47. Lily ──────────────────────────────────────────────────────────────────
const LilyGlyph = () => (
  <G>
    <NatureTablet />
    <GrooveLeaf d="M50 72 L50 52" w={1.8} />
    <Path d="M50 52 Q40 50 36 38 Q46 42 50 52 Z" stroke={LEAF} strokeWidth="1.5" fill={LEAFG} />
    <Path d="M50 52 Q60 50 64 38 Q54 42 50 52 Z" stroke={LEAF} strokeWidth="1.5" fill={LEAFG} />
    <Path d="M50 52 Q44 42 50 32 Q56 42 50 52 Z" stroke={LEAF} strokeWidth="1.6" fill={LEAFG} />
    <GrooveLeaf d="M50 40 L50 50" w={1} />
    <GrooveLeaf d="M50 62 Q44 62 42 66 M50 66 Q56 66 58 70" w={1.2} />
  </G>
);

// ── 48. Calla lily ────────────────────────────────────────────────────────────
const CallaLilyGlyph = () => (
  <G>
    <NatureTablet />
    <GrooveLeaf d="M48 72 Q50 58 54 46" w={1.8} />
    <Path d="M54 46 Q40 40 44 28 Q56 30 62 42 Q60 48 54 46 Z" stroke={LEAF} strokeWidth="1.7" fill={LEAFG} />
    <GrooveLeaf d="M52 44 L57 33" w={1.4} />
    <GrooveLeaf d="M44 66 Q38 64 36 58" w={1.3} />
  </G>
);

// ── 49. Tulip ─────────────────────────────────────────────────────────────────
const TulipGlyph = () => (
  <G>
    <NatureTablet />
    <GrooveLeaf d="M50 72 L50 50" w={1.8} />
    <Path d="M40 48 Q40 36 50 34 Q60 36 60 48 Q54 44 50 50 Q46 44 40 48 Z" stroke={LEAF} strokeWidth="1.7" fill={LEAFG} />
    <GrooveLeaf d="M50 38 L50 48" w={1} />
    <GrooveLeaf d="M50 60 Q40 60 36 50 M50 64 Q60 64 64 54" w={1.4} />
  </G>
);

// ── 50. Forget-me-not ─────────────────────────────────────────────────────────
const ForgetMeNotGlyph = () => (
  <G>
    <NatureTablet />
    <GrooveLeaf d="M50 72 L50 58" w={1.6} />
    <Circle cx="50" cy="42" r="4.4" stroke={LEAF} strokeWidth="1.4" fill={LEAFG} />
    <Circle cx="42" cy="46" r="4.4" stroke={LEAF} strokeWidth="1.4" fill={LEAFG} />
    <Circle cx="58" cy="46" r="4.4" stroke={LEAF} strokeWidth="1.4" fill={LEAFG} />
    <Circle cx="45" cy="54" r="4.4" stroke={LEAF} strokeWidth="1.4" fill={LEAFG} />
    <Circle cx="55" cy="54" r="4.4" stroke={LEAF} strokeWidth="1.4" fill={LEAFG} />
    <Circle cx="50" cy="49" r="2.4" fill={GOLD} />
  </G>
);

// ── 51. Daisy ─────────────────────────────────────────────────────────────────
const DaisyGlyph = () => (
  <G>
    <NatureTablet />
    <GrooveLeaf d="M50 72 L50 58" w={1.6} />
    <G stroke={LEAF} strokeWidth="1.4" fill={LEAFG}>
      <Ellipse cx="50" cy="34" rx="2.6" ry="6" /><Ellipse cx="50" cy="54" rx="2.6" ry="6" />
      <Ellipse cx="40" cy="44" rx="6" ry="2.6" /><Ellipse cx="60" cy="44" rx="6" ry="2.6" />
      <Ellipse cx="43" cy="37" rx="2.6" ry="6" rotation={-45} originX={43} originY={37} />
      <Ellipse cx="57" cy="37" rx="2.6" ry="6" rotation={45} originX={57} originY={37} />
      <Ellipse cx="43" cy="51" rx="2.6" ry="6" rotation={45} originX={43} originY={51} />
      <Ellipse cx="57" cy="51" rx="2.6" ry="6" rotation={-45} originX={57} originY={51} />
    </G>
    <Circle cx="50" cy="44" r="3.4" fill={GOLD} />
  </G>
);

// ── 52. Lotus bud ─────────────────────────────────────────────────────────────
const LotusBudGlyph = () => (
  <G>
    <NatureTablet />
    <GrooveLeaf d="M50 72 L50 56" w={1.8} />
    <Path d="M50 56 Q42 50 44 36 Q50 42 50 56 Z" stroke={LEAF} strokeWidth="1.5" fill={LEAFG} />
    <Path d="M50 56 Q58 50 56 36 Q50 42 50 56 Z" stroke={LEAF} strokeWidth="1.5" fill={LEAFG} />
    <Path d="M50 56 Q47 44 50 30 Q53 44 50 56 Z" stroke={LEAF} strokeWidth="1.6" fill={LEAFG} />
    <GrooveLeaf d="M50 60 Q40 60 36 66 M50 62 Q60 62 64 68" w={1.3} />
  </G>
);

// ── 53. Thistle ───────────────────────────────────────────────────────────────
const ThistleGlyph = () => (
  <G>
    <NatureTablet />
    <GrooveLeaf d="M50 74 L50 58" w={1.8} />
    <Path d="M43 58 Q43 50 50 50 Q57 50 57 58 Q57 64 50 64 Q43 64 43 58 Z" stroke={LEAF} strokeWidth="1.6" fill={LEAFG} />
    <GrooveLeaf d="M45 55 L55 61 M55 55 L45 61" w={1} />
    <GrooveLeaf d="M50 50 L50 38 M50 50 L43 40 M50 50 L57 40 M50 51 L39 44 M50 51 L61 44" w={1.3} />
    <GrooveLeaf d="M50 38 L48 34 M50 38 L52 34" w={1.1} />
    <GrooveLeaf d="M48 64 Q42 66 39 62 M52 64 Q58 66 61 62" w={1.3} />
  </G>
);

// ── 54. Poppy ─────────────────────────────────────────────────────────────────
const PoppyGlyph = () => (
  <G>
    <NatureTablet />
    <GrooveLeaf d="M50 72 Q50 56 44 48" w={1.8} />
    <Path d="M44 48 Q34 44 36 34 Q44 32 50 40 Q56 32 64 34 Q66 44 56 48 Q50 52 44 48 Z" stroke={LEAF} strokeWidth="1.6" fill={LEAFG} />
    <Circle cx="50" cy="42" r="3" fill={GROOVE_DK} />
    <GrooveLeaf d="M50 60 Q42 62 40 56" w={1.3} />
  </G>
);

// ── 55. Ivy ───────────────────────────────────────────────────────────────────
const IvyGlyph = () => (
  <G>
    <NatureTablet />
    <GrooveLeaf d="M44 72 Q58 66 50 56 Q42 48 54 42 Q62 38 54 32" w={1.7} />
    <Path d="M48 66 Q42 67 40 62 Q42 57 47 58 Q51 60 51 63 Q50 66 48 66 Z" stroke={LEAF} strokeWidth="1.3" fill={LEAFG} />
    <Path d="M52 56 Q58 57 60 52 Q58 47 53 48 Q49 50 49 53 Q50 56 52 56 Z" stroke={LEAF} strokeWidth="1.3" fill={LEAFG} />
    <Path d="M46 47 Q40 47 39 42 Q41 37 46 39 Q50 41 50 44 Q49 47 46 47 Z" stroke={LEAF} strokeWidth="1.3" fill={LEAFG} />
    <Path d="M54 38 Q60 37 60 32 Q58 28 53 30 Q49 32 50 35 Q51 38 54 38 Z" stroke={LEAF} strokeWidth="1.3" fill={LEAFG} />
  </G>
);

// ── 56. Laurel wreath ─────────────────────────────────────────────────────────
const LaurelGlyph = () => (
  <G>
    <NatureTablet />
    <GrooveLeaf d="M50 67 Q40 63 39 51 Q38 44 43 39" w={1.6} />
    <GrooveLeaf d="M50 67 Q60 63 61 51 Q62 44 57 39" w={1.6} />
    <G stroke={LEAF} strokeWidth="1.1" fill={LEAFG}>
      <Ellipse cx="37" cy="49" rx="3.6" ry="1.9" rotation={-58} originX={37} originY={49} />
      <Ellipse cx="38" cy="57" rx="3.6" ry="1.9" rotation={-32} originX={38} originY={57} />
      <Ellipse cx="43" cy="64" rx="3.6" ry="1.9" rotation={-12} originX={43} originY={64} />
      <Ellipse cx="63" cy="49" rx="3.6" ry="1.9" rotation={58} originX={63} originY={49} />
      <Ellipse cx="62" cy="57" rx="3.6" ry="1.9" rotation={32} originX={62} originY={57} />
      <Ellipse cx="57" cy="64" rx="3.6" ry="1.9" rotation={12} originX={57} originY={64} />
    </G>
    <GrooveLeaf d="M47 67 Q50 70 53 67" w={1.3} />
  </G>
);

// ── 57. Single oak leaf ───────────────────────────────────────────────────────
const LeafGlyph = () => (
  <G>
    <NatureTablet />
    <Path d="M50 70 Q34 58 38 42 Q44 30 50 30 Q56 30 62 42 Q66 58 50 70 Z" stroke={LEAF} strokeWidth="1.7" fill={LEAFG} />
    <GrooveLeaf d="M50 66 L50 34" w={1.4} />
    <GrooveLeaf d="M50 44 Q44 42 41 46 M50 44 Q56 42 59 46 M50 52 Q43 50 40 55 M50 52 Q57 50 60 55 M50 60 Q45 58 43 62 M50 60 Q55 58 57 62" w={1} />
  </G>
);

// ── 58. Wheat sprig ───────────────────────────────────────────────────────────
const WheatSprigGlyph = () => (
  <G>
    <NatureTablet />
    <GrooveLeaf d="M50 72 L50 38" w={1.7} />
    <GrooveLeaf d="M50 40 L46 44 M50 40 L54 44 M50 46 L45 50 M50 46 L55 50 M50 52 L45 56 M50 52 L55 56 M50 58 L46 62 M50 58 L54 62" w={1.3} />
    <GrooveLeaf d="M50 38 L48 33 M50 38 L52 33 M50 38 L50 32" w={1.3} />
  </G>
);

// ── 59. Sunrise ───────────────────────────────────────────────────────────────
const SunriseGlyph = () => (
  <G>
    <NatureTablet />
    <Groove d="M32 62 L68 62" w={1.8} />
    <Path d="M38 62 Q38 48 50 48 Q62 48 62 62 Z" stroke={GOLDG} strokeWidth="1.8" fill={PARCHG} />
    <Groove d="M50 44 L50 38 M40 47 L36 42 M60 47 L64 42 M33 56 L27 54 M67 56 L73 54" w={1.4} />
  </G>
);

// ── 60. Butterfly ─────────────────────────────────────────────────────────────
const ButterflyGlyph = () => (
  <G>
    <NatureTablet />
    <Groove d="M50 40 L50 64" w={1.8} />
    <Path d="M50 46 Q36 32 32 44 Q30 54 44 54 Q50 52 50 46 Z" stroke={PARCH} strokeWidth="1.5" fill={PARCHG} />
    <Path d="M50 46 Q64 32 68 44 Q70 54 56 54 Q50 52 50 46 Z" stroke={PARCH} strokeWidth="1.5" fill={PARCHG} />
    <Path d="M50 52 Q40 56 40 64 Q46 68 50 62 Z" stroke={PARCH} strokeWidth="1.4" fill={PARCHG} />
    <Path d="M50 52 Q60 56 60 64 Q54 68 50 62 Z" stroke={PARCH} strokeWidth="1.4" fill={PARCHG} />
    <Groove d="M50 40 L47 35 M50 40 L53 35" w={1.2} />
  </G>
);

// Pack definitions — drive the picker's tab row (order = display order).
// Add a pack here and tag its markers with the matching `pack` id below.
export const MARKER_PACKS = [
  { id: 'classic', label: 'Classic' },
  { id: 'faith',   label: 'Faith' },
  { id: 'nature',  label: 'Nature' },
];

export const MARKER_STYLES = [
  { id: 'book',       label: 'Open Book',     pack: 'classic', Glyph: BookGlyph },
  { id: 'arched',     label: 'Arched',        pack: 'classic', Glyph: ArchedGlyph },
  { id: 'cross-tab',  label: 'Cross Tablet',  pack: 'classic', Glyph: CrossTabletGlyph },
  { id: 'cross',      label: 'Cross',         pack: 'classic', Glyph: CrossGlyph },
  { id: 'celtic',     label: 'Celtic Cross',  pack: 'classic', Glyph: CelticCrossGlyph },
  { id: 'obelisk',    label: 'Obelisk',       pack: 'classic', Glyph: ObeliskGlyph },
  { id: 'scroll',     label: 'Scroll',        pack: 'classic', Glyph: ScrollGlyph },
  { id: 'rose',       label: 'Rose',          pack: 'classic', Glyph: RoseGlyph },
  { id: 'skull',      label: 'Skull',         pack: 'classic', Glyph: SkullGlyph },
  { id: 'ornate',     label: 'Ornate',        pack: 'classic', Glyph: OrnateGlyph },
  { id: 'gothic',     label: 'Gothic Arch',   pack: 'classic', Glyph: GothicArchGlyph },
  { id: 'heart',      label: 'Heart',         pack: 'classic', Glyph: HeartGlyph },
  { id: 'praying',    label: 'Praying Hands', pack: 'classic', Glyph: PrayingHandsGlyph },
  { id: 'dove',       label: 'Dove',          pack: 'classic', Glyph: DoveGlyph },
  { id: 'anchor',     label: 'Anchor',        pack: 'classic', Glyph: AnchorGlyph },
  { id: 'column',     label: 'Broken Column', pack: 'classic', Glyph: BrokenColumnGlyph },
  { id: 'urn',        label: 'Urn',           pack: 'classic', Glyph: UrnGlyph },
  { id: 'willow',     label: 'Willow',        pack: 'classic', Glyph: WillowGlyph },
  { id: 'star',       label: 'Star of David', pack: 'classic', Glyph: StarOfDavidGlyph },
  { id: 'flat',       label: 'Lawn Marker',   pack: 'classic', Glyph: FlatGlyph },
  // ── Pack 2 — Faith & Religious ──
  { id: 'ankh',         label: 'Ankh',            pack: 'faith', Glyph: AnkhGlyph },
  { id: 'crescent',     label: 'Crescent & Star', pack: 'faith', Glyph: CrescentGlyph },
  { id: 'menorah',      label: 'Menorah',         pack: 'faith', Glyph: MenorahGlyph },
  { id: 'chirho',       label: 'Chi-Rho',         pack: 'faith', Glyph: ChiRhoGlyph },
  { id: 'wheat',        label: 'Wheat Sheaf',     pack: 'faith', Glyph: WheatGlyph },
  { id: 'orthodox',     label: 'Orthodox Cross',  pack: 'faith', Glyph: OrthodoxGlyph },
  { id: 'alphaomega',   label: 'Alpha & Omega',   pack: 'faith', Glyph: AlphaOmegaGlyph },
  { id: 'sacredheart',  label: 'Sacred Heart',    pack: 'faith', Glyph: SacredHeartGlyph },
  { id: 'lamb',         label: 'Lamb of God',     pack: 'faith', Glyph: LambGlyph },
  { id: 'scripture',    label: 'Open Scripture',  pack: 'faith', Glyph: ScriptureGlyph },
  { id: 'chalice',      label: 'Chalice',         pack: 'faith', Glyph: ChaliceGlyph },
  { id: 'lotus',        label: 'Lotus',           pack: 'faith', Glyph: LotusGlyph },
  { id: 'om',           label: 'Om',              pack: 'faith', Glyph: OmGlyph },
  { id: 'trinity',      label: 'Trinity Knot',    pack: 'faith', Glyph: TrinityGlyph },
  { id: 'crossfleury',  label: 'Cross Fleury',    pack: 'faith', Glyph: CrossFleuryGlyph },
  { id: 'handup',       label: 'Hand Heavenward', pack: 'faith', Glyph: HandUpGlyph },
  { id: 'crown',        label: 'Crown of Life',   pack: 'faith', Glyph: CrownGlyph },
  { id: 'eye',          label: 'All-Seeing Eye',  pack: 'faith', Glyph: EyeGlyph },
  { id: 'angel',        label: 'Angel',           pack: 'faith', Glyph: AngelGlyph },
  { id: 'khanda',       label: 'Khanda',          pack: 'faith', Glyph: KhandaGlyph },
  // ── Pack 3 — Nature & Flora ──
  { id: 'oak',          label: 'Oak',             pack: 'nature', Glyph: OakGlyph },
  { id: 'treeoflife',   label: 'Tree of Life',    pack: 'nature', Glyph: TreeOfLifeGlyph },
  { id: 'pine',         label: 'Evergreen',       pack: 'nature', Glyph: PineGlyph },
  { id: 'acorn',        label: 'Acorn',           pack: 'nature', Glyph: AcornGlyph },
  { id: 'fallentree',   label: 'Tree Stump',      pack: 'nature', Glyph: FallenTreeGlyph },
  { id: 'fern',         label: 'Fern',            pack: 'nature', Glyph: FernGlyph },
  { id: 'lily',         label: 'Lily',            pack: 'nature', Glyph: LilyGlyph },
  { id: 'callalily',    label: 'Calla Lily',      pack: 'nature', Glyph: CallaLilyGlyph },
  { id: 'tulip',        label: 'Tulip',           pack: 'nature', Glyph: TulipGlyph },
  { id: 'forgetmenot',  label: 'Forget-Me-Not',   pack: 'nature', Glyph: ForgetMeNotGlyph },
  { id: 'daisy',        label: 'Daisy',           pack: 'nature', Glyph: DaisyGlyph },
  { id: 'lotusbud',     label: 'Lotus Bud',       pack: 'nature', Glyph: LotusBudGlyph },
  { id: 'thistle',      label: 'Thistle',         pack: 'nature', Glyph: ThistleGlyph },
  { id: 'poppy',        label: 'Poppy',           pack: 'nature', Glyph: PoppyGlyph },
  { id: 'ivy',          label: 'Ivy',             pack: 'nature', Glyph: IvyGlyph },
  { id: 'laurel',       label: 'Laurel Wreath',   pack: 'nature', Glyph: LaurelGlyph },
  { id: 'leaf',         label: 'Oak Leaf',        pack: 'nature', Glyph: LeafGlyph },
  { id: 'wheatsprig',   label: 'Wheat Sprig',     pack: 'nature', Glyph: WheatSprigGlyph },
  { id: 'sunrise',      label: 'Sunrise',         pack: 'nature', Glyph: SunriseGlyph },
  { id: 'butterfly',    label: 'Butterfly',       pack: 'nature', Glyph: ButterflyGlyph },
];

export const DEFAULT_MARKER = 'book';

const _byId = Object.fromEntries(MARKER_STYLES.map(m => [m.id, m]));

// Resolve a stored style id to a descriptor, falling back to the default marker
// for null / unknown / legacy values so existing pins always render.
export function getMarker(id) {
  return _byId[id] || _byId[DEFAULT_MARKER];
}

// Single <Svg> wrapper used by both the map marker and the picker grid.
// Injects the shared <Defs> so each glyph's url(#…) gradient refs resolve.
export function GraveMarkerSvg({ styleId, size = 32 }) {
  const { Glyph } = getMarker(styleId);
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100" fill="none">
      <MarkerDefs />
      <Glyph />
    </Svg>
  );
}
