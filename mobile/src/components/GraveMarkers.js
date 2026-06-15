// GraveMarkers.js — 20 hand-built SVG gravestone markers for the Cemetery map.
//
// Each entry is a "glyph": a React fragment of raw SVG primitives on the shared
// viewBox="0 0 100 100". A single <Svg> wrapper (GraveMarkerSvg) owns width/height,
// so the same glyphs render both on the map (react-native-maps <Marker> child) and
// in the Result-screen picker grid at any size, with no nested-<Svg> issues.
//
// Visual language matches the app's gothic palette and the original web Leaflet
// divIcon: gold stroke (#c9a84c), dark translucent stone fill, parchment detail
// (#e8d4a0) for crosses / books / carvings.
//
// Public API:
//   MARKER_STYLES   — ordered array of { id, label, Glyph }
//   DEFAULT_MARKER  — 'book' (the original GravestoneMarker; existing pins are unchanged)
//   getMarker(id)   — resolve an id (or null/unknown) to a descriptor, falling back to default
//   GraveMarkerSvg  — <GraveMarkerSvg styleId={...} size={32} /> renderer

import React from 'react';
import Svg, { Rect, Path, Line, Circle, Ellipse, Polygon, G } from 'react-native-svg';

const GOLD = '#c9a84c';
const PARCH = '#e8d4a0';
const FILL = 'rgba(20,15,8,0.85)';
const PARCH_FILL = 'rgba(232,212,160,0.25)';

// Shared base step drawn under most upright stones.
const Base = () => <Rect x="22" y="84" width="56" height="6" stroke={GOLD} strokeWidth="2" fill={FILL} />;

// ── 1. Book (default — matches the original marker) ───────────────────────────
const BookGlyph = () => (
  <G>
    <Base />
    <Path d="M30 84 L30 35 Q30 18 50 18 Q70 18 70 35 L70 84 Z" stroke={GOLD} strokeWidth="2" fill={FILL} />
    <Path d="M38 40 L38 56 Q44 54 49 56 L49 42 Q44 40 38 40 Z" stroke={PARCH} strokeWidth="2" fill={PARCH_FILL} />
    <Path d="M51 42 Q56 40 62 40 L62 56 Q56 54 51 56 Z" stroke={PARCH} strokeWidth="2" fill={PARCH_FILL} />
    <Line x1="50" y1="41" x2="50" y2="56" stroke={PARCH} strokeWidth="1.5" />
    <Line x1="50" y1="63" x2="50" y2="76" stroke={PARCH} strokeWidth="1.5" />
    <Line x1="44" y1="68" x2="56" y2="68" stroke={PARCH} strokeWidth="1.5" />
  </G>
);

// ── 2. Arched (plain rounded top) ─────────────────────────────────────────────
const ArchedGlyph = () => (
  <G>
    <Base />
    <Path d="M30 84 L30 38 Q30 18 50 18 Q70 18 70 38 L70 84 Z" stroke={GOLD} strokeWidth="2" fill={FILL} />
    <Line x1="38" y1="48" x2="62" y2="48" stroke={PARCH} strokeWidth="1.4" />
    <Line x1="38" y1="58" x2="62" y2="58" stroke={PARCH} strokeWidth="1.4" />
    <Line x1="38" y1="68" x2="62" y2="68" stroke={PARCH} strokeWidth="1.4" />
  </G>
);

// ── 3. Cross-topped tablet ────────────────────────────────────────────────────
const CrossTabletGlyph = () => (
  <G>
    <Base />
    <Path d="M30 84 L30 44 Q30 30 50 30 Q70 30 70 44 L70 84 Z" stroke={GOLD} strokeWidth="2" fill={FILL} />
    <Line x1="50" y1="8" x2="50" y2="28" stroke={PARCH} strokeWidth="2.4" />
    <Line x1="41" y1="15" x2="59" y2="15" stroke={PARCH} strokeWidth="2.4" />
    <Line x1="40" y1="54" x2="60" y2="54" stroke={PARCH} strokeWidth="1.4" />
    <Line x1="40" y1="64" x2="60" y2="64" stroke={PARCH} strokeWidth="1.4" />
  </G>
);

// ── 4. Latin standing cross ───────────────────────────────────────────────────
const CrossGlyph = () => (
  <G>
    <Rect x="34" y="82" width="32" height="8" stroke={GOLD} strokeWidth="2" fill={FILL} />
    <Path d="M44 82 L44 24 L56 24 L56 82 Z" stroke={GOLD} strokeWidth="2" fill={FILL} />
    <Path d="M30 38 L70 38 L70 50 L30 50 Z" stroke={GOLD} strokeWidth="2" fill={FILL} />
  </G>
);

// ── 5. Celtic cross (ringed) ──────────────────────────────────────────────────
const CelticCrossGlyph = () => (
  <G>
    <Rect x="36" y="82" width="28" height="8" stroke={GOLD} strokeWidth="2" fill={FILL} />
    <Line x1="50" y1="14" x2="50" y2="82" stroke={GOLD} strokeWidth="6" />
    <Line x1="28" y1="40" x2="72" y2="40" stroke={GOLD} strokeWidth="6" />
    <Circle cx="50" cy="40" r="16" stroke={GOLD} strokeWidth="2.4" fill="none" />
  </G>
);

// ── 6. Obelisk ────────────────────────────────────────────────────────────────
const ObeliskGlyph = () => (
  <G>
    <Rect x="34" y="82" width="32" height="8" stroke={GOLD} strokeWidth="2" fill={FILL} />
    <Rect x="40" y="72" width="20" height="12" stroke={GOLD} strokeWidth="2" fill={FILL} />
    <Path d="M44 72 L44 22 L50 10 L56 22 L56 72 Z" stroke={GOLD} strokeWidth="2" fill={FILL} />
  </G>
);

// ── 7. Scroll / parchment ─────────────────────────────────────────────────────
const ScrollGlyph = () => (
  <G>
    <Base />
    <Path d="M32 28 Q32 20 40 20 L68 20 Q60 22 60 30 L60 78 Q60 84 52 84 L34 84 Q32 80 32 74 Z"
      stroke={GOLD} strokeWidth="2" fill={FILL} />
    <Path d="M60 20 Q70 20 70 28 Q70 34 62 32" stroke={GOLD} strokeWidth="2" fill="none" />
    <Line x1="38" y1="40" x2="56" y2="40" stroke={PARCH} strokeWidth="1.3" />
    <Line x1="38" y1="50" x2="56" y2="50" stroke={PARCH} strokeWidth="1.3" />
    <Line x1="38" y1="60" x2="56" y2="60" stroke={PARCH} strokeWidth="1.3" />
  </G>
);

// ── 8. Rose ───────────────────────────────────────────────────────────────────
const RoseGlyph = () => (
  <G>
    <Base />
    <Path d="M30 84 L30 40 Q30 22 50 22 Q70 22 70 40 L70 84 Z" stroke={GOLD} strokeWidth="2" fill={FILL} />
    <Circle cx="50" cy="46" r="9" stroke={PARCH} strokeWidth="1.6" fill={PARCH_FILL} />
    <Circle cx="50" cy="46" r="4" stroke={PARCH} strokeWidth="1.4" fill="none" />
    <Path d="M50 55 L50 72" stroke={PARCH} strokeWidth="1.6" />
    <Path d="M50 62 Q42 60 40 54 Q48 54 50 62 Z" stroke={PARCH} strokeWidth="1.2" fill={PARCH_FILL} />
    <Path d="M50 66 Q58 64 60 58 Q52 58 50 66 Z" stroke={PARCH} strokeWidth="1.2" fill={PARCH_FILL} />
  </G>
);

// ── 9. Skull (memento mori) ───────────────────────────────────────────────────
const SkullGlyph = () => (
  <G>
    <Base />
    <Path d="M30 84 L30 42 Q30 24 50 24 Q70 24 70 42 L70 84 Z" stroke={GOLD} strokeWidth="2" fill={FILL} />
    <Path d="M40 50 Q40 38 50 38 Q60 38 60 50 Q60 58 55 60 L45 60 Q40 58 40 50 Z"
      stroke={PARCH} strokeWidth="1.6" fill={PARCH_FILL} />
    <Circle cx="46" cy="49" r="2.4" fill={PARCH} />
    <Circle cx="54" cy="49" r="2.4" fill={PARCH} />
    <Path d="M48 56 L50 60 L52 56 Z" fill={PARCH} />
    <Line x1="46" y1="64" x2="54" y2="64" stroke={PARCH} strokeWidth="1.4" />
  </G>
);

// ── 10. Ornate / scrolled crown ───────────────────────────────────────────────
const OrnateGlyph = () => (
  <G>
    <Base />
    <Path d="M32 84 L32 40 L68 40 L68 84 Z" stroke={GOLD} strokeWidth="2" fill={FILL} />
    <Path d="M28 40 Q28 26 38 26 Q42 18 50 18 Q58 18 62 26 Q72 26 72 40 Z"
      stroke={GOLD} strokeWidth="2" fill={FILL} />
    <Path d="M40 30 Q44 24 50 28 Q56 24 60 30" stroke={PARCH} strokeWidth="1.4" fill="none" />
    <Line x1="40" y1="52" x2="60" y2="52" stroke={PARCH} strokeWidth="1.3" />
    <Line x1="40" y1="62" x2="60" y2="62" stroke={PARCH} strokeWidth="1.3" />
  </G>
);

// ── 11. Gothic pointed arch ───────────────────────────────────────────────────
const GothicArchGlyph = () => (
  <G>
    <Base />
    <Path d="M30 84 L30 40 Q30 30 50 12 Q70 30 70 40 L70 84 Z" stroke={GOLD} strokeWidth="2" fill={FILL} />
    <Path d="M38 44 Q38 36 50 26 Q62 36 62 44 L62 60 L38 60 Z" stroke={PARCH} strokeWidth="1.4" fill="none" />
    <Line x1="40" y1="70" x2="60" y2="70" stroke={PARCH} strokeWidth="1.3" />
  </G>
);

// ── 12. Heart ─────────────────────────────────────────────────────────────────
const HeartGlyph = () => (
  <G>
    <Base />
    <Path d="M30 84 L30 40 Q30 22 50 22 Q70 22 70 40 L70 84 Z" stroke={GOLD} strokeWidth="2" fill={FILL} />
    <Path d="M50 62 Q40 52 40 46 Q40 40 45 40 Q49 40 50 45 Q51 40 55 40 Q60 40 60 46 Q60 52 50 62 Z"
      stroke={PARCH} strokeWidth="1.6" fill={PARCH_FILL} />
  </G>
);

// ── 13. Praying hands ─────────────────────────────────────────────────────────
const PrayingHandsGlyph = () => (
  <G>
    <Base />
    <Path d="M30 84 L30 40 Q30 22 50 22 Q70 22 70 40 L70 84 Z" stroke={GOLD} strokeWidth="2" fill={FILL} />
    <Path d="M48 68 L44 50 Q43 40 48 38 L50 66 Z" stroke={PARCH} strokeWidth="1.5" fill={PARCH_FILL} />
    <Path d="M52 68 L56 50 Q57 40 52 38 L50 66 Z" stroke={PARCH} strokeWidth="1.5" fill={PARCH_FILL} />
  </G>
);

// ── 14. Dove ──────────────────────────────────────────────────────────────────
const DoveGlyph = () => (
  <G>
    <Base />
    <Path d="M30 84 L30 40 Q30 22 50 22 Q70 22 70 40 L70 84 Z" stroke={GOLD} strokeWidth="2" fill={FILL} />
    <Path d="M42 56 Q48 44 60 44 Q54 48 56 54 Q50 50 44 58 Z" stroke={PARCH} strokeWidth="1.5" fill={PARCH_FILL} />
    <Path d="M60 44 L66 42 L62 48 Z" stroke={PARCH} strokeWidth="1.2" fill={PARCH_FILL} />
  </G>
);

// ── 15. Anchor (hope / mariner) ───────────────────────────────────────────────
const AnchorGlyph = () => (
  <G>
    <Base />
    <Path d="M30 84 L30 42 Q30 24 50 24 Q70 24 70 42 L70 84 Z" stroke={GOLD} strokeWidth="2" fill={FILL} />
    <Circle cx="50" cy="38" r="3" stroke={PARCH} strokeWidth="1.6" fill="none" />
    <Line x1="50" y1="41" x2="50" y2="70" stroke={PARCH} strokeWidth="1.8" />
    <Line x1="42" y1="48" x2="58" y2="48" stroke={PARCH} strokeWidth="1.8" />
    <Path d="M38 60 Q42 70 50 70 Q58 70 62 60" stroke={PARCH} strokeWidth="1.8" fill="none" />
  </G>
);

// ── 16. Broken column (life cut short) — snapped classical column on a plinth ──
const BrokenColumnGlyph = () => (
  <G>
    {/* two-step plinth */}
    <Rect x="28" y="80" width="44" height="8" stroke={GOLD} strokeWidth="2" fill={FILL} />
    <Rect x="34" y="72" width="32" height="8" stroke={GOLD} strokeWidth="2" fill={FILL} />
    {/* column shaft, snapped off on a diagonal near the top */}
    <Path d="M40 72 L40 40 L42 36 L58 32 L60 36 L60 72 Z"
      stroke={PARCH} strokeWidth="1.8" fill={PARCH_FILL} strokeLinejoin="round" />
    {/* fluting on the shaft */}
    <Line x1="46" y1="44" x2="46" y2="70" stroke={PARCH} strokeWidth="1.2" />
    <Line x1="50" y1="42" x2="50" y2="70" stroke={PARCH} strokeWidth="1.2" />
    <Line x1="54" y1="40" x2="54" y2="70" stroke={PARCH} strokeWidth="1.2" />
    {/* base moulding ring */}
    <Line x1="38" y1="70" x2="62" y2="70" stroke={PARCH} strokeWidth="1.6" />
  </G>
);

// ── 17. Classical funerary urn on a stepped plinth ────────────────────────────
const UrnGlyph = () => (
  <G>
    {/* two-step plinth */}
    <Rect x="30" y="80" width="40" height="8" stroke={GOLD} strokeWidth="2" fill={FILL} />
    <Rect x="38" y="73" width="24" height="7" stroke={GOLD} strokeWidth="2" fill={FILL} />
    {/* foot of the urn */}
    <Path d="M45 73 L43 68 L57 68 L55 73 Z" stroke={PARCH} strokeWidth="1.6" fill={PARCH_FILL} strokeLinejoin="round" />
    {/* urn bowl — rounded body tapering to the foot */}
    <Path d="M43 68 Q34 60 38 50 L62 50 Q66 60 57 68 Z"
      stroke={PARCH} strokeWidth="1.8" fill={PARCH_FILL} strokeLinejoin="round" />
    {/* wide rim */}
    <Rect x="36" y="46" width="28" height="4" rx="1" stroke={PARCH} strokeWidth="1.6" fill={PARCH_FILL} />
    {/* domed lid with finial */}
    <Path d="M40 46 Q40 38 50 38 Q60 38 60 46 Z" stroke={PARCH} strokeWidth="1.6" fill={PARCH_FILL} strokeLinejoin="round" />
    <Circle cx="50" cy="35" r="2.4" stroke={PARCH} strokeWidth="1.5" fill={FILL} />
    {/* paired scroll handles */}
    <Path d="M40 53 Q31 53 35 62" stroke={PARCH} strokeWidth="1.5" fill="none" />
    <Path d="M60 53 Q69 53 65 62" stroke={PARCH} strokeWidth="1.5" fill="none" />
  </G>
);

// ── 18. Weeping willow ────────────────────────────────────────────────────────
const WillowGlyph = () => (
  <G>
    <Base />
    <Path d="M30 84 L30 40 Q30 22 50 22 Q70 22 70 40 L70 84 Z" stroke={GOLD} strokeWidth="2" fill={FILL} />
    <Line x1="50" y1="70" x2="50" y2="44" stroke={PARCH} strokeWidth="1.6" />
    <Path d="M50 44 Q40 42 36 56" stroke={PARCH} strokeWidth="1.3" fill="none" />
    <Path d="M50 44 Q46 42 44 60" stroke={PARCH} strokeWidth="1.3" fill="none" />
    <Path d="M50 44 Q60 42 64 56" stroke={PARCH} strokeWidth="1.3" fill="none" />
    <Path d="M50 44 Q54 42 56 60" stroke={PARCH} strokeWidth="1.3" fill="none" />
  </G>
);

// ── 19. Star of David ─────────────────────────────────────────────────────────
const StarOfDavidGlyph = () => (
  <G>
    <Base />
    <Path d="M30 84 L30 40 Q30 24 50 24 Q70 24 70 40 L70 84 Z" stroke={GOLD} strokeWidth="2" fill={FILL} />
    <Polygon points="50,36 60,54 40,54" stroke={PARCH} strokeWidth="1.6" fill="none" />
    <Polygon points="50,60 40,42 60,42" stroke={PARCH} strokeWidth="1.6" fill="none" />
  </G>
);

// ── 20. Flat / lawn marker ────────────────────────────────────────────────────
const FlatGlyph = () => (
  <G>
    <Path d="M20 58 L80 58 L84 78 L16 78 Z" stroke={GOLD} strokeWidth="2" fill={FILL} />
    <Line x1="32" y1="66" x2="68" y2="66" stroke={PARCH} strokeWidth="1.4" />
    <Line x1="36" y1="72" x2="64" y2="72" stroke={PARCH} strokeWidth="1.3" />
  </G>
);

// ═══════════════════════════════════════════════════════════════════════════════
// PACK 2 — FAITH & RELIGIOUS (glyphs 21-40)
// Same gold-stroke / parchment-detail palette as Pack 1. Most sit on the shared
// arched faith-tablet silhouette; a few are free-standing emblems.
// Byte-for-byte equivalent to the web glyphs in js/grave-markers.js.
// ═══════════════════════════════════════════════════════════════════════════════

// Shared arched faith-tablet silhouette many Pack-2 emblems are carved onto.
const FaithTablet = () => (
  <>
    <Base />
    <Path d="M30 84 L30 40 Q30 22 50 22 Q70 22 70 40 L70 84 Z" stroke={GOLD} strokeWidth="2" fill={FILL} />
  </>
);

// ── 21. Ankh ──────────────────────────────────────────────────────────────────
const AnkhGlyph = () => (
  <G>
    <FaithTablet />
    <Ellipse cx="50" cy="42" rx="8" ry="10" stroke={PARCH} strokeWidth="2" fill="none" />
    <Line x1="50" y1="52" x2="50" y2="74" stroke={PARCH} strokeWidth="2.4" />
    <Line x1="40" y1="60" x2="60" y2="60" stroke={PARCH} strokeWidth="2.4" />
  </G>
);

// ── 22. Crescent & star (Islamic) ─────────────────────────────────────────────
const CrescentGlyph = () => (
  <G>
    <FaithTablet />
    <Path d="M58 38 Q44 38 44 52 Q44 66 58 66 Q49 60 49 52 Q49 44 58 38 Z" stroke={PARCH} strokeWidth="1.8" fill={PARCH_FILL} />
    <Polygon points="62,46 64,52 70,52 65,56 67,62 62,58 57,62 59,56 54,52 60,52" stroke={PARCH} strokeWidth="1.2" fill={PARCH_FILL} />
  </G>
);

// ── 23. Menorah ───────────────────────────────────────────────────────────────
const MenorahGlyph = () => (
  <G>
    <FaithTablet />
    <Line x1="50" y1="44" x2="50" y2="70" stroke={PARCH} strokeWidth="2" />
    <Line x1="40" y1="74" x2="60" y2="74" stroke={PARCH} strokeWidth="2" />
    <Path d="M50 56 Q42 56 42 46" stroke={PARCH} strokeWidth="1.6" fill="none" />
    <Path d="M50 56 Q58 56 58 46" stroke={PARCH} strokeWidth="1.6" fill="none" />
    <Path d="M50 52 Q36 52 36 44" stroke={PARCH} strokeWidth="1.6" fill="none" />
    <Path d="M50 52 Q64 52 64 44" stroke={PARCH} strokeWidth="1.6" fill="none" />
    <Path d="M50 48 Q30 48 30 42" stroke={PARCH} strokeWidth="1.6" fill="none" />
    <Path d="M50 48 Q70 48 70 42" stroke={PARCH} strokeWidth="1.6" fill="none" />
    <Line x1="30" y1="42" x2="30" y2="40" stroke={PARCH} strokeWidth="1.6" />
    <Line x1="36" y1="44" x2="36" y2="42" stroke={PARCH} strokeWidth="1.6" />
    <Line x1="42" y1="46" x2="42" y2="44" stroke={PARCH} strokeWidth="1.6" />
    <Line x1="50" y1="44" x2="50" y2="42" stroke={PARCH} strokeWidth="1.6" />
    <Line x1="58" y1="46" x2="58" y2="44" stroke={PARCH} strokeWidth="1.6" />
    <Line x1="64" y1="44" x2="64" y2="42" stroke={PARCH} strokeWidth="1.6" />
    <Line x1="70" y1="42" x2="70" y2="40" stroke={PARCH} strokeWidth="1.6" />
  </G>
);

// ── 24. Chi-Rho ───────────────────────────────────────────────────────────────
const ChiRhoGlyph = () => (
  <G>
    <FaithTablet />
    <Line x1="50" y1="34" x2="50" y2="72" stroke={PARCH} strokeWidth="2.2" />
    <Path d="M50 40 Q60 40 60 48 Q60 56 50 56" stroke={PARCH} strokeWidth="2" fill="none" />
    <Line x1="40" y1="60" x2="60" y2="72" stroke={PARCH} strokeWidth="2" />
    <Line x1="60" y1="60" x2="40" y2="72" stroke={PARCH} strokeWidth="2" />
  </G>
);

// ── 25. IHS monogram tablet ───────────────────────────────────────────────────
const IhsGlyph = () => (
  <G>
    <FaithTablet />
    <Line x1="40" y1="48" x2="40" y2="64" stroke={PARCH} strokeWidth="2" />
    <Line x1="48" y1="48" x2="48" y2="64" stroke={PARCH} strokeWidth="2" />
    <Line x1="46" y1="56" x2="54" y2="56" stroke={PARCH} strokeWidth="2" />
    <Line x1="54" y1="48" x2="54" y2="64" stroke={PARCH} strokeWidth="2" />
    <Path d="M64 50 Q57 48 57 53 Q57 57 63 57 Q69 57 67 62 Q64 65 58 63" stroke={PARCH} strokeWidth="1.8" fill="none" />
    <Line x1="50" y1="42" x2="50" y2="46" stroke={PARCH} strokeWidth="1.6" />
  </G>
);

// ── 26. Orthodox (three-bar) cross ────────────────────────────────────────────
const OrthodoxGlyph = () => (
  <G>
    <FaithTablet />
    <Line x1="50" y1="30" x2="50" y2="76" stroke={PARCH} strokeWidth="2.4" />
    <Line x1="44" y1="38" x2="56" y2="38" stroke={PARCH} strokeWidth="2" />
    <Line x1="38" y1="50" x2="62" y2="50" stroke={PARCH} strokeWidth="2.4" />
    <Line x1="42" y1="66" x2="58" y2="60" stroke={PARCH} strokeWidth="2" />
  </G>
);

// ── 27. Alpha & Omega ─────────────────────────────────────────────────────────
const AlphaOmegaGlyph = () => (
  <G>
    <FaithTablet />
    <Path d="M36 64 L42 46 L48 64 M38 58 L46 58" stroke={PARCH} strokeWidth="1.8" fill="none" />
    <Path d="M54 64 Q54 46 62 46 Q70 46 70 64 M52 64 L58 64 M66 64 L72 64" stroke={PARCH} strokeWidth="1.8" fill="none" />
  </G>
);

// ── 28. Sacred Heart (flaming, crowned with cross) ────────────────────────────
const SacredHeartGlyph = () => (
  <G>
    <FaithTablet />
    <Path d="M50 66 Q38 54 38 47 Q38 40 44 40 Q49 40 50 46 Q51 40 56 40 Q62 40 62 47 Q62 54 50 66 Z" stroke={PARCH} strokeWidth="1.8" fill={PARCH_FILL} />
    <Line x1="50" y1="34" x2="50" y2="42" stroke={PARCH} strokeWidth="1.8" />
    <Line x1="46" y1="37" x2="54" y2="37" stroke={PARCH} strokeWidth="1.8" />
    <Path d="M46 50 Q50 56 54 50" stroke={PARCH} strokeWidth="1.3" fill="none" />
  </G>
);

// ── 29. Lamb of God (Agnus Dei) ───────────────────────────────────────────────
const LambGlyph = () => (
  <G>
    <FaithTablet />
    <Ellipse cx="50" cy="56" rx="13" ry="9" stroke={PARCH} strokeWidth="1.6" fill={PARCH_FILL} />
    <Circle cx="38" cy="52" r="5" stroke={PARCH} strokeWidth="1.6" fill={PARCH_FILL} />
    <Line x1="44" y1="63" x2="44" y2="70" stroke={PARCH} strokeWidth="1.5" />
    <Line x1="56" y1="63" x2="56" y2="70" stroke={PARCH} strokeWidth="1.5" />
    <Line x1="60" y1="40" x2="60" y2="56" stroke={PARCH} strokeWidth="1.4" />
    <Path d="M60 40 L66 42 L60 45 Z" stroke={PARCH} strokeWidth="1" fill={PARCH_FILL} />
  </G>
);

// ── 30. Open scripture on a stand ─────────────────────────────────────────────
const ScriptureGlyph = () => (
  <G>
    <FaithTablet />
    <Path d="M50 48 Q42 44 34 46 L34 64 Q42 62 50 66 Z" stroke={PARCH} strokeWidth="1.6" fill={PARCH_FILL} />
    <Path d="M50 48 Q58 44 66 46 L66 64 Q58 62 50 66 Z" stroke={PARCH} strokeWidth="1.6" fill={PARCH_FILL} />
    <Line x1="38" y1="52" x2="46" y2="53" stroke={PARCH} strokeWidth="1" />
    <Line x1="38" y1="57" x2="46" y2="58" stroke={PARCH} strokeWidth="1" />
    <Line x1="54" y1="53" x2="62" y2="52" stroke={PARCH} strokeWidth="1" />
    <Line x1="54" y1="58" x2="62" y2="57" stroke={PARCH} strokeWidth="1" />
    <Line x1="42" y1="70" x2="58" y2="70" stroke={PARCH} strokeWidth="1.6" />
  </G>
);

// ── 31. Chalice ───────────────────────────────────────────────────────────────
const ChaliceGlyph = () => (
  <G>
    <FaithTablet />
    <Path d="M40 44 Q40 56 50 58 Q60 56 60 44 Z" stroke={PARCH} strokeWidth="1.8" fill={PARCH_FILL} />
    <Line x1="50" y1="58" x2="50" y2="68" stroke={PARCH} strokeWidth="1.8" />
    <Path d="M42 72 Q42 68 50 68 Q58 68 58 72 Z" stroke={PARCH} strokeWidth="1.8" fill={PARCH_FILL} />
    <Circle cx="50" cy="38" r="3" stroke={PARCH} strokeWidth="1.4" fill="none" />
  </G>
);

// ── 32. Lotus (Buddhist / Hindu) — symmetric water-lily on a waterline ─────────
const LotusGlyph = () => (
  <G>
    <FaithTablet />
    <Path d="M50 64 Q45 52 50 42 Q55 52 50 64 Z" stroke={PARCH} strokeWidth="1.5" fill={PARCH_FILL} />
    <Path d="M50 64 Q42 54 40 46 Q49 50 50 64 Z" stroke={PARCH} strokeWidth="1.5" fill={PARCH_FILL} />
    <Path d="M50 64 Q58 54 60 46 Q51 50 50 64 Z" stroke={PARCH} strokeWidth="1.5" fill={PARCH_FILL} />
    <Path d="M50 64 Q38 58 32 50 Q46 52 50 64 Z" stroke={PARCH} strokeWidth="1.4" fill={PARCH_FILL} />
    <Path d="M50 64 Q62 58 68 50 Q54 52 50 64 Z" stroke={PARCH} strokeWidth="1.4" fill={PARCH_FILL} />
    <Path d="M34 66 Q50 72 66 66" stroke={PARCH} strokeWidth="1.4" fill="none" />
  </G>
);

// ── 33. Om (ॐ) symbol tablet — simplified, well-separated strokes ──────────────
const OmGlyph = () => (
  <G>
    <FaithTablet />
    {/* lower loop (the big '3'-like belly) */}
    <Path d="M42 52 Q34 52 34 60 Q34 68 43 68 Q50 68 50 61 Q50 56 44 56" stroke={PARCH} strokeWidth="1.8" fill="none" />
    {/* upper loop sitting on the lower one */}
    <Path d="M44 56 Q44 49 51 49 Q57 49 57 54" stroke={PARCH} strokeWidth="1.8" fill="none" />
    {/* tail sweeping to the right */}
    <Path d="M50 60 Q58 60 62 66" stroke={PARCH} strokeWidth="1.8" fill="none" />
    {/* crescent + dot (chandrabindu) above */}
    <Path d="M55 44 Q61 41 66 45" stroke={PARCH} strokeWidth="1.5" fill="none" />
    <Circle cx="60.5" cy="39.5" r="1.8" fill={PARCH} />
  </G>
);

// ── 34. Trinity knot (triquetra) ──────────────────────────────────────────────
const TrinityGlyph = () => (
  <G>
    <FaithTablet />
    <Path d="M50 40 Q60 50 50 60 Q40 50 50 40 Z" stroke={PARCH} strokeWidth="1.8" fill="none" />
    <Path d="M50 60 Q38 52 44 42 Q54 48 50 60 Z" stroke={PARCH} strokeWidth="1.8" fill="none" />
    <Path d="M50 60 Q62 52 56 42 Q46 48 50 60 Z" stroke={PARCH} strokeWidth="1.8" fill="none" />
  </G>
);

// ── 35. Cross fleury (ornate budded arms) ─────────────────────────────────────
const CrossFleuryGlyph = () => (
  <G>
    <FaithTablet />
    <Line x1="50" y1="34" x2="50" y2="74" stroke={PARCH} strokeWidth="2.4" />
    <Line x1="36" y1="52" x2="64" y2="52" stroke={PARCH} strokeWidth="2.4" />
    <Path d="M50 34 Q46 30 50 28 Q54 30 50 34" stroke={PARCH} strokeWidth="1.4" fill={PARCH_FILL} />
    <Path d="M50 74 Q46 78 50 80 Q54 78 50 74" stroke={PARCH} strokeWidth="1.4" fill={PARCH_FILL} />
    <Path d="M36 52 Q32 48 30 52 Q32 56 36 52" stroke={PARCH} strokeWidth="1.4" fill={PARCH_FILL} />
    <Path d="M64 52 Q68 48 70 52 Q68 56 64 52" stroke={PARCH} strokeWidth="1.4" fill={PARCH_FILL} />
  </G>
);

// ── 36. Hand pointing heavenward ──────────────────────────────────────────────
const HandUpGlyph = () => (
  <G>
    <FaithTablet />
    <Line x1="50" y1="36" x2="50" y2="50" stroke={PARCH} strokeWidth="2.2" />
    <Path d="M44 50 Q44 46 46 46 Q47 50 47 50 Q47 44 49 44 Q50 50 50 50 Q50 43 52 43 Q53 50 53 50 Q53 45 55 45 Q56 50 56 52 L56 62 Q56 68 50 68 Q44 68 44 62 Z" stroke={PARCH} strokeWidth="1.6" fill={PARCH_FILL} />
    <Path d="M44 56 Q40 56 40 60 Q40 64 44 64" stroke={PARCH} strokeWidth="1.4" fill="none" />
  </G>
);

// ── 37. Crown of life ─────────────────────────────────────────────────────────
const CrownGlyph = () => (
  <G>
    <FaithTablet />
    <Path d="M36 64 L32 44 L42 54 L50 40 L58 54 L68 44 L64 64 Z" stroke={PARCH} strokeWidth="1.8" fill={PARCH_FILL} strokeLinejoin="round" />
    <Line x1="36" y1="64" x2="64" y2="64" stroke={PARCH} strokeWidth="1.8" />
    <Circle cx="32" cy="44" r="2" fill={PARCH} />
    <Circle cx="50" cy="40" r="2" fill={PARCH} />
    <Circle cx="68" cy="44" r="2" fill={PARCH} />
  </G>
);

// ── 38. All-seeing eye in radiant triangle ────────────────────────────────────
const EyeGlyph = () => (
  <G>
    <FaithTablet />
    <Polygon points="50,38 66,66 34,66" stroke={PARCH} strokeWidth="1.8" fill="none" />
    <Path d="M42 56 Q50 50 58 56 Q50 62 42 56 Z" stroke={PARCH} strokeWidth="1.4" fill={PARCH_FILL} />
    <Circle cx="50" cy="56" r="2.4" fill={PARCH} />
    <Line x1="50" y1="34" x2="50" y2="30" stroke={PARCH} strokeWidth="1.2" />
    <Line x1="40" y1="38" x2="36" y2="35" stroke={PARCH} strokeWidth="1.2" />
    <Line x1="60" y1="38" x2="64" y2="35" stroke={PARCH} strokeWidth="1.2" />
  </G>
);

// ── 39. Angel / winged figure ─────────────────────────────────────────────────
const AngelGlyph = () => (
  <G>
    <FaithTablet />
    <Circle cx="50" cy="42" r="4" stroke={PARCH} strokeWidth="1.6" fill={PARCH_FILL} />
    <Path d="M50 46 Q44 50 44 70 L56 70 Q56 50 50 46 Z" stroke={PARCH} strokeWidth="1.6" fill={PARCH_FILL} />
    <Path d="M44 52 Q32 50 30 64 Q40 58 46 60 Z" stroke={PARCH} strokeWidth="1.5" fill={PARCH_FILL} />
    <Path d="M56 52 Q68 50 70 64 Q60 58 54 60 Z" stroke={PARCH} strokeWidth="1.5" fill={PARCH_FILL} />
    <Ellipse cx="50" cy="35" rx="5" ry="1.6" stroke={PARCH} strokeWidth="1.2" fill="none" />
  </G>
);

// ── 40. Khanda (Sikh) ─────────────────────────────────────────────────────────
const KhandaGlyph = () => (
  <G>
    <FaithTablet />
    <Line x1="50" y1="38" x2="50" y2="70" stroke={PARCH} strokeWidth="2.2" />
    <Path d="M50 44 L52 40 L50 36 L48 40 Z" stroke={PARCH} strokeWidth="1.2" fill={PARCH_FILL} />
    <Circle cx="50" cy="56" r="11" stroke={PARCH} strokeWidth="1.8" fill="none" />
    <Path d="M40 48 Q34 56 40 64" stroke={PARCH} strokeWidth="1.8" fill="none" />
    <Path d="M60 48 Q66 56 60 64" stroke={PARCH} strokeWidth="1.8" fill="none" />
  </G>
);

// Pack definitions — drive the picker's tab row (order = display order).
// Add a pack here and tag its markers with the matching `pack` id below.
export const MARKER_PACKS = [
  { id: 'classic', label: 'Classic' },
  { id: 'faith',   label: 'Faith' },
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
  { id: 'ihs',          label: 'IHS Monogram',    pack: 'faith', Glyph: IhsGlyph },
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
];

export const DEFAULT_MARKER = 'book';

const _byId = Object.fromEntries(MARKER_STYLES.map(m => [m.id, m]));

// Resolve a stored style id to a descriptor, falling back to the default marker
// for null / unknown / legacy values so existing pins always render.
export function getMarker(id) {
  return _byId[id] || _byId[DEFAULT_MARKER];
}

// Single <Svg> wrapper used by both the map marker and the picker grid.
export function GraveMarkerSvg({ styleId, size = 32 }) {
  const { Glyph } = getMarker(styleId);
  return (
    <Svg width={size} height={size} viewBox="0 0 100 100" fill="none">
      <Glyph />
    </Svg>
  );
}
