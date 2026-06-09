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

// ── 16. Lamb (child's grave) ──────────────────────────────────────────────────
const LambGlyph = () => (
  <G>
    <Rect x="28" y="78" width="44" height="10" stroke={GOLD} strokeWidth="2" fill={FILL} />
    <Ellipse cx="50" cy="58" rx="16" ry="11" stroke={PARCH} strokeWidth="1.6" fill={PARCH_FILL} />
    <Circle cx="36" cy="54" r="6" stroke={PARCH} strokeWidth="1.6" fill={PARCH_FILL} />
    <Line x1="42" y1="69" x2="42" y2="78" stroke={PARCH} strokeWidth="1.6" />
    <Line x1="58" y1="69" x2="58" y2="78" stroke={PARCH} strokeWidth="1.6" />
  </G>
);

// ── 17. Urn on plinth ─────────────────────────────────────────────────────────
const UrnGlyph = () => (
  <G>
    <Rect x="34" y="78" width="32" height="10" stroke={GOLD} strokeWidth="2" fill={FILL} />
    <Rect x="40" y="66" width="20" height="12" stroke={GOLD} strokeWidth="2" fill={FILL} />
    <Path d="M40 64 Q38 44 50 40 Q62 44 60 64 Z" stroke={PARCH} strokeWidth="1.6" fill={PARCH_FILL} />
    <Path d="M40 48 Q34 50 38 54" stroke={PARCH} strokeWidth="1.4" fill="none" />
    <Path d="M60 48 Q66 50 62 54" stroke={PARCH} strokeWidth="1.4" fill="none" />
    <Rect x="44" y="34" width="12" height="6" stroke={PARCH} strokeWidth="1.4" fill="none" />
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

export const MARKER_STYLES = [
  { id: 'book',       label: 'Open Book',     Glyph: BookGlyph },
  { id: 'arched',     label: 'Arched',        Glyph: ArchedGlyph },
  { id: 'cross-tab',  label: 'Cross Tablet',  Glyph: CrossTabletGlyph },
  { id: 'cross',      label: 'Cross',         Glyph: CrossGlyph },
  { id: 'celtic',     label: 'Celtic Cross',  Glyph: CelticCrossGlyph },
  { id: 'obelisk',    label: 'Obelisk',       Glyph: ObeliskGlyph },
  { id: 'scroll',     label: 'Scroll',        Glyph: ScrollGlyph },
  { id: 'rose',       label: 'Rose',          Glyph: RoseGlyph },
  { id: 'skull',      label: 'Skull',         Glyph: SkullGlyph },
  { id: 'ornate',     label: 'Ornate',        Glyph: OrnateGlyph },
  { id: 'gothic',     label: 'Gothic Arch',   Glyph: GothicArchGlyph },
  { id: 'heart',      label: 'Heart',         Glyph: HeartGlyph },
  { id: 'praying',    label: 'Praying Hands', Glyph: PrayingHandsGlyph },
  { id: 'dove',       label: 'Dove',          Glyph: DoveGlyph },
  { id: 'anchor',     label: 'Anchor',        Glyph: AnchorGlyph },
  { id: 'lamb',       label: 'Lamb',          Glyph: LambGlyph },
  { id: 'urn',        label: 'Urn',           Glyph: UrnGlyph },
  { id: 'willow',     label: 'Willow',        Glyph: WillowGlyph },
  { id: 'star',       label: 'Star of David', Glyph: StarOfDavidGlyph },
  { id: 'flat',       label: 'Lawn Marker',   Glyph: FlatGlyph },
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
