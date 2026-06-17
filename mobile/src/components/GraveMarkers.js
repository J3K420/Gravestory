// GraveMarkers.js — 100 hand-built SVG gravestone markers for the Cemetery map.
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
// Pack-4 (Celestial & Eternity) accent: a faint silver-blue (echoes the global-
// map silver). Only the celestial DETAIL (suns/moons/stars/flames) uses it; the
// stone + gold stroke stay identical so the global-map gold identity survives.
const SILVER = '#bccde6';          // silver-blue stroke
const SILVERG = 'url(#skyGrad)';   // silver-blue fill
// Pack-5 (Symbols & Trades) accent: a warm burnished copper-bronze. Only the
// emblem/tool DETAIL uses it; the stone + gold stroke stay identical so the
// global-map gold identity survives.
const COPPER = '#eab277';          // bright burnished copper-bronze stroke
const COPPERG = 'url(#bronzeGrad)';// copper-bronze fill (lit-metal gradient)

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
    <LinearGradient id="skyGrad" x1="0" y1="0" x2="0" y2="1">
      <Stop offset="0" stopColor="rgba(190,205,230,0.36)" />
      <Stop offset="1" stopColor="rgba(140,160,200,0.14)" />
    </LinearGradient>
    <LinearGradient id="bronzeGrad" x1="0" y1="0" x2="0" y2="1">
      <Stop offset="0" stopColor="rgba(248,206,150,0.62)" />
      <Stop offset="0.5" stopColor="rgba(214,158,104,0.34)" />
      <Stop offset="1" stopColor="rgba(150,96,52,0.16)" />
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

// Silver-accent groove for Pack-4 celestial outline detail (rays, beams, arcs).
const GrooveSky = ({ d, w }) => (
  <>
    <G x={0.9} y={1}>
      <Path d={d} stroke={GROOVE_DK} strokeWidth={w} fill="none" strokeLinecap="round" />
    </G>
    <Path d={d} stroke={SILVER} strokeWidth={w} fill="none" strokeLinecap="round" />
  </>
);

// Copper-accent groove for Pack-5 trade/symbol outline detail (tools, emblems).
const GrooveCopper = ({ d, w }) => (
  <>
    <G x={0.9} y={1}>
      <Path d={d} stroke={GROOVE_DK} strokeWidth={w} fill="none" strokeLinecap="round" />
    </G>
    <Path d={d} stroke={COPPER} strokeWidth={w} fill="none" strokeLinecap="round" />
  </>
);

// ── 1. Book (default — matches the original marker) ───────────────────────────
const BookGlyph = () => (
  <G>
    <Base />
    <Path d="M30 84 L30 35 Q30 18 50 18 Q70 18 70 35 L70 84 Z" stroke={GOLDG} strokeWidth="2.2" fill={STONE}/>
    <Path d="M49 40 Q43 37 37 38 L37 60 Q43 59 49 62 Z" stroke={PARCH} strokeWidth="1.8" fill={PARCHG} strokeLinejoin="round"/>
    <Path d="M51 40 Q57 37 63 38 L63 60 Q57 59 51 62 Z" stroke={PARCH} strokeWidth="1.8" fill={PARCHG} strokeLinejoin="round"/>
    <Groove d="M50 41 L50 62" w={1.5} />
    <Groove d="M41 46 L47 46" w={1.1} />
    <Groove d="M41 51 L47 51" w={1.1} />
    <Groove d="M53 46 L59 46" w={1.1} />
    <Groove d="M53 51 L59 51" w={1.1} />
  </G>
);

// ── 2. Arched (plain rounded top) ─────────────────────────────────────────────
const ArchedGlyph = () => (
  <G>
    <Base />
    <Path d="M30 84 L30 38 Q30 18 50 18 Q70 18 70 38 L70 84 Z" stroke={GOLDG} strokeWidth="2.2" fill={STONE}/>
    <Groove d="M38 48 L62 48" w={1.4} />
    <Groove d="M38 58 L62 58" w={1.4} />
    <Groove d="M38 68 L62 68" w={1.4} />
  </G>
);

// ── 3. Cross-topped tablet ────────────────────────────────────────────────────
const CrossTabletGlyph = () => (
  <G>
    <Base />
    <Path d="M30 84 L30 44 Q30 30 50 30 Q70 30 70 44 L70 84 Z" stroke={GOLDG} strokeWidth="2.2" fill={STONE}/>
    <Path d="M46 54 L46 46 L42 46 L42 40 L46 40 L46 33 Q48 31 50 31 Q52 31 54 33 L54 40 L58 40 L58 46 L54 46 L54 54 Z" stroke={PARCH} strokeWidth="1.4" fill={PARCHG} strokeLinejoin="round"/>
    <Groove d="M40 62 L60 62" w={1.4} />
    <Groove d="M40 70 L60 70" w={1.4} />
  </G>
);

// ── 4. Latin standing cross ───────────────────────────────────────────────────
const CrossGlyph = () => (
  <G>
    <Ground />
    <Rect x="34" y="82" width="32" height="8" rx="1.5" stroke={GOLDG} strokeWidth="2" fill={STONE}/>
    <Path d="M45 82 L45 50 L31 50 L31 38 L45 38 L45 22 Q45 19 50 19 Q55 19 55 22 L55 38 L69 38 L69 50 L55 50 L55 82 Z" stroke={GOLDG} strokeWidth="2.2" fill={STONE} strokeLinejoin="round"/>
    <Groove d="M50 26 L50 78" w={1.2} />
    <Groove d="M36 44 L64 44" w={1.2} />
  </G>
);

// ── 5. Celtic cross (ringed) ──────────────────────────────────────────────────
// Arms are filled <Rect>s (not <Line>s) so the vertical goldGrad has a real
// bounding box — a zero-height horizontal line collapses the gradient.
const CelticCrossGlyph = () => (
  <G>
    <Ground />
    <Rect x="36" y="82" width="28" height="8" rx="1.5" stroke={GOLDG} strokeWidth="2" fill={STONE}/>
    <Rect x="47" y="14" width="6" height="68" fill={GOLDG}/>
    <Rect x="30" y="37" width="40" height="6" fill={GOLDG}/>
    <Circle cx="50" cy="40" r="15" stroke={GOLDG} strokeWidth="3" fill="none"/>
    <Groove d="M50 22 L50 58" w={1.1} />
    <Groove d="M37 40 L63 40" w={1.1} />
  </G>
);

// ── 6. Obelisk ────────────────────────────────────────────────────────────────
const ObeliskGlyph = () => (
  <G>
    <Ground />
    <Rect x="34" y="82" width="32" height="8" stroke={GOLDG} strokeWidth="2" fill={STONE}/>
    <Rect x="40" y="72" width="20" height="12" stroke={GOLDG} strokeWidth="2" fill={STONE}/>
    <Path d="M44 72 L44 22 L50 10 L56 22 L56 72 Z" stroke={GOLDG} strokeWidth="2.2" fill={STONE}/>
    <Groove d="M50 26 L50 70" w={1.2} />
  </G>
);

// ── 7. Scroll / parchment ─────────────────────────────────────────────────────
const ScrollGlyph = () => (
  <G>
    <Base />
    <Path d="M36 30 L60 30 L60 70 L36 70 Z" stroke={GOLDG} strokeWidth="2.2" fill={STONE}/>
    <Path d="M36 30 Q30 30 30 25 Q30 20 36 20 Q42 20 42 25 L42 30 Z" stroke={GOLDG} strokeWidth="2" fill={STONE} strokeLinejoin="round"/>
    <Path d="M60 70 Q66 70 66 75 Q66 80 60 80 Q54 80 54 75 L54 70 Z" stroke={GOLDG} strokeWidth="2" fill={STONE} strokeLinejoin="round"/>
    <Groove d="M40 40 L56 40" w={1.3} />
    <Groove d="M40 48 L56 48" w={1.3} />
    <Groove d="M40 56 L52 56" w={1.3} />
  </G>
);

// ── 8. Rose ───────────────────────────────────────────────────────────────────
const RoseGlyph = () => (
  <G>
    <Base />
    <Path d="M30 84 L30 40 Q30 22 50 22 Q70 22 70 40 L70 84 Z" stroke={GOLDG} strokeWidth="2.2" fill={STONE}/>
    <Path d="M50 38 Q40 38 40 46 Q40 54 50 54 Q60 54 60 46 Q60 38 50 38 Z" stroke={PARCH} strokeWidth="1.6" fill={PARCHG}/>
    <Groove d="M44 45 Q44 41 48 41 Q52 41 52 45 Q52 49 48 49 Q45 49 45 46 Q45 44 47 44" w={1.3} />
    <Groove d="M52 48 Q56 48 56 45" w={1.3} />
    <Groove d="M50 54 L50 72" w={1.6} />
    <Path d="M50 60 Q41 58 38 51 Q47 51 50 60 Z" stroke={PARCH} strokeWidth="1.2" fill={PARCHG} strokeLinejoin="round"/>
    <Path d="M50 66 Q59 64 62 57 Q53 57 50 66 Z" stroke={PARCH} strokeWidth="1.2" fill={PARCHG} strokeLinejoin="round"/>
  </G>
);

// ── 9. Skull (memento mori) ───────────────────────────────────────────────────
const SkullGlyph = () => (
  <G>
    <Base />
    <Path d="M30 84 L30 42 Q30 24 50 24 Q70 24 70 42 L70 84 Z" stroke={GOLDG} strokeWidth="2.2" fill={STONE}/>
    <Path d="M38 46 Q38 34 50 34 Q62 34 62 46 Q62 54 57 58 L57 62 Q57 66 50 66 Q43 66 43 62 L43 58 Q38 54 38 46 Z" stroke={PARCH} strokeWidth="1.8" fill={PARCHG} strokeLinejoin="round"/>
    <Path d="M42 47 Q42 42 46 42 Q50 42 50 47 Q50 52 46 52 Q42 52 42 47 Z" fill={GROOVE_DK}/>
    <Path d="M50 47 Q50 42 54 42 Q58 42 58 47 Q58 52 54 52 Q50 52 50 47 Z" fill={GROOVE_DK}/>
    <Path d="M48 55 L50 59 L52 55 Z" fill={GROOVE_DK}/>
    <Groove d="M45 62 L45 66" w={1} />
    <Groove d="M50 62 L50 66" w={1} />
    <Groove d="M55 62 L55 66" w={1} />
  </G>
);

// ── 10. Ornate / scrolled crown ───────────────────────────────────────────────
const OrnateGlyph = () => (
  <G>
    <Base />
    <Path d="M32 84 L32 40 L68 40 L68 84 Z" stroke={GOLDG} strokeWidth="2.2" fill={STONE}/>
    <Path d="M32 40 Q32 30 38 30 Q38 22 44 22 Q47 22 48 26 Q49 19 50 19 Q51 19 52 26 Q53 22 56 22 Q62 22 62 30 Q68 30 68 40 Z" stroke={GOLDG} strokeWidth="2.2" fill={STONE} strokeLinejoin="round"/>
    <Groove d="M38 36 Q42 30 46 34" w={1.2} />
    <Groove d="M62 36 Q58 30 54 34" w={1.2} />
    <Groove d="M40 54 L60 54" w={1.3} />
    <Groove d="M40 63 L60 63" w={1.3} />
  </G>
);

// ── 11. Gothic pointed arch ───────────────────────────────────────────────────
const GothicArchGlyph = () => (
  <G>
    <Base />
    <Path d="M30 84 L30 40 Q30 30 50 12 Q70 30 70 40 L70 84 Z" stroke={GOLDG} strokeWidth="2.2" fill={STONE}/>
    <Path d="M38 64 L38 42 Q38 34 50 24 Q62 34 62 42 L62 64 Z" stroke={PARCH} strokeWidth="1.6" fill={PARCHG} strokeLinejoin="round"/>
    <Groove d="M50 30 L50 64" w={1.2} />
    <Groove d="M44 40 Q44 36 50 31 Q56 36 56 40" w={1.1} />
    <Groove d="M40 72 L60 72" w={1.3} />
  </G>
);

// ── 12. Heart ─────────────────────────────────────────────────────────────────
const HeartGlyph = () => (
  <G>
    <Base />
    <Path d="M30 84 L30 40 Q30 22 50 22 Q70 22 70 40 L70 84 Z" stroke={GOLDG} strokeWidth="2.2" fill={STONE}/>
    <Path d="M50 64 C40 56 36 50 36 45 Q36 38 42 38 Q48 38 50 44 Q52 38 58 38 Q64 38 64 45 C64 50 60 56 50 64 Z" stroke={PARCH} strokeWidth="1.8" fill={PARCHG} strokeLinejoin="round"/>
    <Groove d="M50 46 L50 60" w={1.3} />
  </G>
);

// ── 13. Praying hands ─────────────────────────────────────────────────────────
const PrayingHandsGlyph = () => (
  <G>
    <Base />
    <Path d="M30 84 L30 40 Q30 22 50 22 Q70 22 70 40 L70 84 Z" stroke={GOLDG} strokeWidth="2.2" fill={STONE}/>
    <Path d="M50 36 Q46 36 44 42 L41 56 Q40 64 44 68 L50 70 Z" stroke={PARCH} strokeWidth="1.6" fill={PARCHG} strokeLinejoin="round"/>
    <Path d="M50 36 Q54 36 56 42 L59 56 Q60 64 56 68 L50 70 Z" stroke={PARCH} strokeWidth="1.6" fill={PARCHG} strokeLinejoin="round"/>
    <Groove d="M50 38 L50 70" w={1.5} />
    <Path d="M42 56 Q37 55 38 62 Q41 63 44 60 Z" stroke={PARCH} strokeWidth="1.3" fill={PARCHG} strokeLinejoin="round"/>
    <Path d="M58 56 Q63 55 62 62 Q59 63 56 60 Z" stroke={PARCH} strokeWidth="1.2" fill={PARCHG} strokeLinejoin="round"/>
  </G>
);

// ── 14. Dove ──────────────────────────────────────────────────────────────────
const DoveGlyph = () => (
  <G>
    <Base />
    <Path d="M30 84 L30 40 Q30 22 50 22 Q70 22 70 40 L70 84 Z" stroke={GOLDG} strokeWidth="2.2" fill={STONE}/>
    <Path d="M36 62 Q40 54 50 52 Q58 51 62 47 L60 56 Q56 60 50 60 L42 64 Z" stroke={PARCH} strokeWidth="1.7" fill={PARCHG} strokeLinejoin="round"/>
    <Path d="M62 47 Q66 45 67 41 Q64 40 61 42 Q60 45 62 47 Z" stroke={PARCH} strokeWidth="1.5" fill={PARCHG} strokeLinejoin="round"/>
    <Path d="M48 53 Q44 40 38 34 Q42 44 42 54 Z" stroke={PARCH} strokeWidth="1.6" fill={PARCHG} strokeLinejoin="round"/>
    <Circle cx="62" cy="43.5" r="1.4" fill={GROOVE_DK}/>
    <Groove d="M44 63 L40 68 M48 63 L46 69" w={1.3} />
  </G>
);

// ── 15. Anchor (hope / mariner) ───────────────────────────────────────────────
const AnchorGlyph = () => (
  <G>
    <Base />
    <Path d="M30 84 L30 42 Q30 24 50 24 Q70 24 70 42 L70 84 Z" stroke={GOLDG} strokeWidth="2.2" fill={STONE}/>
    <Circle cx="50" cy="36" r="3.5" stroke={PARCH} strokeWidth="1.6" fill="none"/>
    <Groove d="M50 40 L50 70" w={2} />
    <Groove d="M41 47 L59 47" w={1.8} />
    <Groove d="M35 60 Q36 70 50 71 Q64 70 65 60" w={2} />
    <Groove d="M35 60 L33 55" w={1.6} />
    <Groove d="M65 60 L67 55" w={1.6} />
  </G>
);

// ── 16. Broken column (life cut short) — snapped classical column on a plinth ──
const BrokenColumnGlyph = () => (
  <G>
    <Ground />
    <Rect x="28" y="80" width="44" height="8" stroke={GOLDG} strokeWidth="2" fill={STONE}/>
    <Rect x="34" y="72" width="32" height="8" stroke={GOLDG} strokeWidth="2" fill={STONE}/>
    <Path d="M40 72 L40 46 L42 41 L46 44 L50 39 L55 43 L59 38 L60 41 L60 72 Z" stroke={PARCH} strokeWidth="1.8" fill={PARCHG} strokeLinejoin="round"/>
    <Groove d="M45 48 L45 70" w={1.2} />
    <Groove d="M50 46 L50 70" w={1.2} />
    <Groove d="M55 48 L55 70" w={1.2} />
    <Groove d="M38 70 L62 70" w={1.6} />
  </G>
);

// ── 17. Classical funerary urn on a stepped plinth ────────────────────────────
const UrnGlyph = () => (
  <G>
    <Ground />
    <Rect x="30" y="80" width="40" height="8" stroke={GOLDG} strokeWidth="2" fill={STONE}/>
    <Rect x="38" y="73" width="24" height="7" stroke={GOLDG} strokeWidth="2" fill={STONE}/>
    <Path d="M45 73 L43 68 L57 68 L55 73 Z" stroke={PARCH} strokeWidth="1.6" fill={PARCHG} strokeLinejoin="round"/>
    <Path d="M43 68 Q34 60 38 50 L62 50 Q66 60 57 68 Z" stroke={PARCH} strokeWidth="1.8" fill={PARCHG} strokeLinejoin="round"/>
    <Rect x="36" y="46" width="28" height="4" rx="1" stroke={PARCH} strokeWidth="1.6" fill={PARCHG}/>
    <Path d="M40 46 Q40 38 50 38 Q60 38 60 46 Z" stroke={PARCH} strokeWidth="1.6" fill={PARCHG} strokeLinejoin="round"/>
    <Circle cx="50" cy="35" r="2.4" stroke={PARCH} strokeWidth="1.5" fill={STONE}/>
    <Path d="M40 53 Q31 53 35 62" stroke={PARCH} strokeWidth="1.5" fill="none"/>
    <Path d="M60 53 Q69 53 65 62" stroke={PARCH} strokeWidth="1.5" fill="none"/>
  </G>
);

// ── 18. Weeping willow ────────────────────────────────────────────────────────
const WillowGlyph = () => (
  <G>
    <Base />
    <Path d="M30 84 L30 40 Q30 22 50 22 Q70 22 70 40 L70 84 Z" stroke={GOLDG} strokeWidth="2.2" fill={STONE}/>
    <G x={0.9} y={1}><Path d="M50 72 L50 40" stroke={GROOVE_DK} strokeWidth="2.2"/></G>
    <Path d="M50 72 L50 40" stroke={PARCH} strokeWidth="2.2"/>
    <Path d="M50 38 Q37 38 36 48 Q44 46 50 42 Q56 46 64 48 Q63 38 50 38 Z" stroke={PARCH} strokeWidth="1.4" fill={PARCHG} strokeLinejoin="round"/>
    <Groove d="M38 47 Q37 58 39 66" w={1.3} />
    <Groove d="M44 46 Q44 59 45 68" w={1.3} />
    <Groove d="M56 46 Q56 59 55 68" w={1.3} />
    <Groove d="M62 47 Q63 58 61 66" w={1.3} />
  </G>
);

// ── 19. Star of David ─────────────────────────────────────────────────────────
const StarOfDavidGlyph = () => (
  <G>
    <Base />
    <Path d="M30 84 L30 40 Q30 24 50 24 Q70 24 70 40 L70 84 Z" stroke={GOLDG} strokeWidth="2.2" fill={STONE}/>
    <Groove d="M50 34 L61 53 L39 53 Z" w={1.8} />
    <Groove d="M50 64 L39 45 L61 45 Z" w={1.8} />
    <Groove d="M44 49 L56 49" w={1.1} />
  </G>
);

// ── 20. Flat / lawn marker ────────────────────────────────────────────────────
const FlatGlyph = () => (
  <G>
    <Ground />
    <Path d="M24 56 L76 56 L80 78 L20 78 Z" stroke={GOLDG} strokeWidth="2.2" fill={STONE} strokeLinejoin="round"/>
    <Path d="M30 62 L70 62 L72 73 L28 73 Z" stroke={PARCH} strokeWidth="1.2" fill={PARCHG} strokeLinejoin="round"/>
    <Groove d="M34 66 L66 66" w={1.3} />
    <Groove d="M38 70 L62 70" w={1.2} />
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
    <Groove d="M50 56 L50 76" w={2.6} />
    <Groove d="M39 60 L61 60" w={2.6} />
    <Path d="M50 56 Q40 56 40 47 Q40 38 50 38 Q60 38 60 47 Q60 56 50 56 Z" stroke={PARCH} strokeWidth="2.2" fill="none"/>
    <Groove d="M50 56 Q42 56 42 47 Q42 40 50 40 Q58 40 58 47 Q58 56 50 56" w={1.4} />
  </G>
);

// ── 22. Crescent & star (Islamic) ─────────────────────────────────────────────
const CrescentGlyph = () => (
  <G>
    <FaithTablet />
    <Path d="M52 38 Q40 41 40 53 Q40 65 52 68 Q44 60 44 53 Q44 46 52 38 Z" stroke={PARCH} strokeWidth="1.8" fill={PARCHG}/>
    <Polygon points="59,45 61.5,52 68,52 62.5,56.5 65,63 59,59 53,63 55.5,56.5 50,52 56.5,52" stroke={PARCH} strokeWidth="1.4" fill={PARCHG} strokeLinejoin="round"/>
  </G>
);

// ── 23. Menorah (REDRAWN — bolder shaft, fewer hairlines, dotted flames) ───────
const MenorahGlyph = () => (
  <G>
    <FaithTablet />
    <Groove d="M50 44 L50 70" w={2.4} />
    <Groove d="M40 73 L60 73" w={2.6} />
    <Groove d="M44 75 L44 71" w={2.2} />
    <Groove d="M56 75 L56 71" w={2.2} />
    <Groove d="M50 58 Q44 58 44 48" w={1.8} />
    <Groove d="M50 58 Q56 58 56 48" w={1.8} />
    <Groove d="M50 54 Q39 54 39 47" w={1.8} />
    <Groove d="M50 54 Q61 54 61 47" w={1.8} />
    <Groove d="M50 50 Q35 50 35 46" w={1.8} />
    <Groove d="M50 50 Q65 50 65 46" w={1.8} />
    <G fill={PARCH}>
      <Circle cx="35" cy="44" r="1.8"/><Circle cx="39" cy="45" r="1.8"/><Circle cx="44" cy="46" r="1.8"/>
      <Circle cx="50" cy="42" r="1.8"/><Circle cx="56" cy="46" r="1.8"/><Circle cx="61" cy="45" r="1.8"/><Circle cx="65" cy="44" r="1.8"/></G>
  </G>
);

// ── 24. Chi-Rho ───────────────────────────────────────────────────────────────
const ChiRhoGlyph = () => (
  <G>
    <FaithTablet />
    <Groove d="M50 32 L50 74" w={2.4} />
    <Groove d="M50 36 Q62 36 62 46 Q62 56 50 56" w={2.2} />
    <Groove d="M38 60 L62 74" w={2.2} />
    <Groove d="M62 60 L38 74" w={2.2} />
  </G>
);

// ── 25. Wheat sheaf (a long life "harvested") ─────────────────────────────────
const WheatGlyph = () => (
  <G>
    <FaithTablet />
    <Groove d="M50 72 L50 44" w={1.8} />
    <Groove d="M44 70 Q40 60 42 46" w={1.8} />
    <Groove d="M56 70 Q60 60 58 46" w={1.8} />
    <Path d="M50 38 Q46 41 47 47 Q50 45 50 44 Q50 45 53 47 Q54 41 50 38 Z" stroke={PARCH} strokeWidth="1.4" fill={PARCHG}/>
    <Path d="M42 40 Q39 43 41 49 Q43 47 43 46 Q44 47 45 48 Q46 43 42 40 Z" stroke={PARCH} strokeWidth="1.3" fill={PARCHG}/>
    <Path d="M58 40 Q61 43 59 49 Q57 47 57 46 Q56 47 55 48 Q54 43 58 40 Z" stroke={PARCH} strokeWidth="1.3" fill={PARCHG}/>
    <Groove d="M44 68 L56 68" w={2} />
  </G>
);

// ── 26. Orthodox (three-bar) cross ────────────────────────────────────────────
const OrthodoxGlyph = () => (
  <G>
    <FaithTablet />
    <Groove d="M50 30 L50 78" w={2.6} />
    <Groove d="M43 38 L57 38" w={2.2} />
    <Groove d="M36 50 L64 50" w={2.6} />
    <Groove d="M41 68 L59 60" w={2.2} />
  </G>
);

// ── 27. Alpha & Omega ─────────────────────────────────────────────────────────
const AlphaOmegaGlyph = () => (
  <G>
    <FaithTablet />
    <Groove d="M37 64 L44 46 L51 64 M39.5 58 L48.5 58" w={2} />
    <Groove d="M54 64 Q54 47 60 47 Q66 47 66 64 M51 64 L56 64 M63 64 L67 64" w={2} />
  </G>
);

// ── 28. Sacred Heart (flaming, crowned with cross) ────────────────────────────
const SacredHeartGlyph = () => (
  <G>
    <FaithTablet />
    <Path d="M50 68 Q37 56 37 48 Q37 41 43 41 Q48 41 50 47 Q52 41 57 41 Q63 41 63 48 Q63 56 50 68 Z" stroke={PARCH} strokeWidth="2" fill={PARCHG}/>
    <Groove d="M50 32 L50 43" w={2} />
    <Groove d="M45 36 L55 36" w={2} />
    <Groove d="M44 49 Q50 55 56 49" w={1.5} />
    <Path d="M46 41 Q48 36 50 36 Q52 36 54 41" stroke={PARCH} strokeWidth="1.2" fill="none"/>
  </G>
);

// ── 29. Lamb of God (Agnus Dei) ───────────────────────────────────────────────
const LambGlyph = () => (
  <G>
    <FaithTablet />
    <Path d="M42 58 Q42 50 50 50 Q60 50 60 58 Q60 64 50 64 Q42 64 42 58 Z" stroke={PARCH} strokeWidth="1.7" fill={PARCHG} strokeLinejoin="round"/>
    <Circle cx="39" cy="55" r="5" stroke={PARCH} strokeWidth="1.6" fill={PARCHG}/>
    <Path d="M35 53 Q32 52 33 56 Q35 57 37 55 Z" stroke={PARCH} strokeWidth="1.4" fill={PARCHG} strokeLinejoin="round"/>
    <Circle cx="38" cy="55" r="1.3" fill={GROOVE_DK}/>
    <Groove d="M46 64 L46 70" w={1.8} />
    <Groove d="M54 64 L54 70" w={1.8} />
    <Groove d="M50 64 L50 70" w={1.6} />
    <Groove d="M58 50 L58 34" w={2} />
    <Path d="M58 34 L52 36 L52 42 L58 40 Z" stroke={PARCH} strokeWidth="1.5" fill={PARCHG} strokeLinejoin="round"/>
    <Groove d="M55 35 L55 41 M53 38 L57 38" w={1.3} />
  </G>
);

// ── 30. Open scripture on a stand ─────────────────────────────────────────────
const ScriptureGlyph = () => (
  <G>
    <FaithTablet />
    <Path d="M50 48 Q41 44 33 47 L33 64 Q41 61 50 65 Z" stroke={PARCH} strokeWidth="1.8" fill={PARCHG}/>
    <Path d="M50 48 Q59 44 67 47 L67 64 Q59 61 50 65 Z" stroke={PARCH} strokeWidth="1.8" fill={PARCHG}/>
    <Groove d="M50 48 L50 65" w={1.4} />
    <Groove d="M38 53 L46 54" w={1.2} />
    <Groove d="M38 58 L46 59" w={1.2} />
    <Groove d="M54 54 L62 53" w={1.2} />
    <Groove d="M54 59 L62 58" w={1.2} />
  </G>
);

// ── 31. Chalice ───────────────────────────────────────────────────────────────
const ChaliceGlyph = () => (
  <G>
    <FaithTablet />
    <Path d="M40 46 Q40 58 50 61 Q60 58 60 46 Z" stroke={PARCH} strokeWidth="2" fill={PARCHG}/>
    <Groove d="M40 46 L60 46" w={1.6} />
    <Groove d="M50 61 L50 70" w={2.2} />
    <Path d="M41 74 Q41 69 50 69 Q59 69 59 74 Z" stroke={PARCH} strokeWidth="2" fill={PARCHG}/>
    <Circle cx="50" cy="40" r="4" stroke={PARCH} strokeWidth="1.6" fill="none"/>
    <Groove d="M47 40 L53 40" w={1.2} />
  </G>
);

// ── 32. Lotus (Buddhist / Hindu) — symmetric water-lily on a waterline ─────────
const LotusGlyph = () => (
  <G>
    <FaithTablet />
    <Path d="M50 64 Q43 53 50 42 Q57 53 50 64 Z" stroke={PARCH} strokeWidth="1.6" fill={PARCHG}/>
    <Path d="M50 64 Q40 56 39 46 Q49 51 50 64 Z" stroke={PARCH} strokeWidth="1.6" fill={PARCHG}/>
    <Path d="M50 64 Q60 56 61 46 Q51 51 50 64 Z" stroke={PARCH} strokeWidth="1.6" fill={PARCHG}/>
    <Path d="M50 64 Q39 61 33 53 Q45 54 50 64 Z" stroke={PARCH} strokeWidth="1.5" fill={PARCHG}/>
    <Path d="M50 64 Q61 61 67 53 Q55 54 50 64 Z" stroke={PARCH} strokeWidth="1.5" fill={PARCHG}/>
    <Groove d="M35 67 Q50 73 65 67" w={1.5} />
  </G>
);

// ── 33. Om (REDRAWN — bolder, cleaner separated strokes) ──────────────────────
const OmGlyph = () => (
  <G>
    <FaithTablet />
    <Groove d="M40 50 Q33 50 33 57 Q33 64 41 64 Q47 64 47 58 Q47 53 41 54" w={2.2} />
    <Groove d="M43 53 Q40 47 46 45 Q52 43 54 49" w={2.2} />
    <Groove d="M47 58 Q55 56 58 50 Q60 46 65 49 Q68 52 65 58" w={2.2} />
    <Groove d="M58 38 Q62 35 66 39" w={1.6} />
    <Circle cx="62" cy="33" r="2.1" fill={PARCH}/>
  </G>
);

// ── 34. Trinity knot (triquetra) ──────────────────────────────────────────────
const TrinityGlyph = () => (
  <G>
    <FaithTablet />
    <Groove d="M50 40 Q60 48 56 60 Q50 56 44 60 Q40 48 50 40 Z" w={1.9} />
    <Groove d="M44 60 Q34 56 35 45 Q44 47 50 52 Q47 58 44 60 Z" w={1.9} />
    <Groove d="M56 60 Q66 56 65 45 Q56 47 50 52 Q53 58 56 60 Z" w={1.9} />
    <Circle cx="50" cy="51" r="15" stroke={PARCH} strokeWidth="1.4" fill="none"/>
  </G>
);

// ── 35. Cross fleury (ornate budded arms) ─────────────────────────────────────
const CrossFleuryGlyph = () => (
  <G>
    <FaithTablet />
    <Groove d="M50 34 L50 74" w={2.6} />
    <Groove d="M37 53 L63 53" w={2.6} />
    <Path d="M50 34 Q44 32 44 28 Q47 31 50 31 Q53 31 56 28 Q56 32 50 34 Z" stroke={PARCH} strokeWidth="1.4" fill={PARCHG}/>
    <Path d="M50 74 Q44 76 44 80 Q47 77 50 77 Q53 77 56 80 Q56 76 50 74 Z" stroke={PARCH} strokeWidth="1.4" fill={PARCHG}/>
    <Path d="M37 53 Q35 47 31 47 Q34 50 34 53 Q34 56 31 59 Q35 59 37 53 Z" stroke={PARCH} strokeWidth="1.4" fill={PARCHG}/>
    <Path d="M63 53 Q65 47 69 47 Q66 50 66 53 Q66 56 69 59 Q65 59 63 53 Z" stroke={PARCH} strokeWidth="1.4" fill={PARCHG}/>
  </G>
);

// ── 36. Hand pointing heavenward ──────────────────────────────────────────────
const HandUpGlyph = () => (
  <G>
    <FaithTablet />
    <Path d="M47 60 L47 35 Q47 32 50 32 Q53 32 53 35 L53 60 Z" stroke={PARCH} strokeWidth="1.7" fill={PARCHG} strokeLinejoin="round"/>
    <Path d="M44 60 Q44 50 48 50 L54 50 Q60 50 60 56 L60 64 Q60 70 51 70 Q44 70 44 64 Z" stroke={PARCH} strokeWidth="1.7" fill={PARCHG} strokeLinejoin="round"/>
    <Path d="M44 56 Q40 56 40 60 Q40 64 44 64" stroke={PARCH} strokeWidth="1.6" fill="none" strokeLinecap="round"/>
    <Groove d="M50 52 L50 64" w={1.3} />
    <Groove d="M55 53 L55 63" w={1.3} />
    <Rect x="44" y="70" width="14" height="5" rx="1.5" stroke={PARCH} strokeWidth="1.6" fill={PARCHG}/>
  </G>
);

// ── 37. Crown of life ─────────────────────────────────────────────────────────
const CrownGlyph = () => (
  <G>
    <FaithTablet />
    <Path d="M35 62 L32 44 L42 53 L50 39 L58 53 L68 44 L65 62 Z" stroke={PARCH} strokeWidth="2" fill={PARCHG} strokeLinejoin="round"/>
    <Rect x="35" y="62" width="30" height="6" rx="1.5" stroke={PARCH} strokeWidth="1.8" fill={PARCHG}/>
    <Groove d="M40 65 L60 65" w={1.2} />
    <Circle cx="32" cy="44" r="2.3" fill={PARCH}/>
    <Circle cx="50" cy="39" r="2.3" fill={PARCH}/>
    <Circle cx="68" cy="44" r="2.3" fill={PARCH}/>
  </G>
);

// ── 38. All-seeing eye (REDRAWN — bolder triangle, clearer eye + rays) ─────────
const EyeGlyph = () => (
  <G>
    <FaithTablet />
    <Groove d="M50 35 L67 66 L33 66 Z" w={2.2} />
    <Path d="M40 54 Q50 47 60 54 Q50 61 40 54 Z" stroke={PARCH} strokeWidth="1.8" fill={PARCHG}/>
    <Circle cx="50" cy="54" r="2.8" fill={PARCH}/>
    <Groove d="M50 33 L50 26" w={1.5} />
    <Groove d="M42 35 L36 29" w={1.5} />
    <Groove d="M58 35 L64 29" w={1.5} />
  </G>
);

// ── 39. Angel / winged figure (REDRAWN — clearer head, body & wings) ──────────
const AngelGlyph = () => (
  <G>
    <FaithTablet />
    <Ellipse cx="50" cy="34" rx="6" ry="2" stroke={PARCH} strokeWidth="1.6" fill="none"/>
    <Circle cx="50" cy="42" r="4.5" stroke={PARCH} strokeWidth="1.8" fill={PARCHG}/>
    <Path d="M50 47 Q42 50 41 72 Q50 69 59 72 Q58 50 50 47 Z" stroke={PARCH} strokeWidth="1.8" fill={PARCHG}/>
    <Path d="M45 52 Q35 49 34 64 Q40 58 47 60 Z" stroke={PARCH} strokeWidth="1.6" fill={PARCHG} strokeLinejoin="round"/>
    <Path d="M55 52 Q65 49 66 64 Q60 58 53 60 Z" stroke={PARCH} strokeWidth="1.6" fill={PARCHG} strokeLinejoin="round"/>
  </G>
);

// ── 40. Khanda (REDRAWN — bolder ring + swords, clearer double-edge) ──────────
const KhandaGlyph = () => (
  <G>
    <FaithTablet />
    <Circle cx="50" cy="57" r="12" stroke={PARCH} strokeWidth="2.4" fill="none"/>
    <Path d="M50 33 L53 38 L53 68 L50 72 L47 68 L47 38 Z" stroke={PARCH} strokeWidth="1.6" fill={PARCHG}/>
    <Groove d="M50 38 L50 68" w={1.2} />
    <Path d="M50 33 L52 37 L48 37 Z" stroke={PARCH} strokeWidth="1.2" fill={PARCH}/>
    <Groove d="M40 45 Q34 57 40 68" w={2.2} />
    <Groove d="M60 45 Q66 57 60 68" w={2.2} />
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
    <GrooveLeaf d="M50 74 L50 58" w={2.2} />
    <GrooveLeaf d="M50 66 Q44 65 41 60 M50 62 Q57 61 60 56" w={1.3} />
    <Path d="M50 58 Q33 56 34 44 Q35 35 43 38 Q44 29 50 28 Q56 29 57 38 Q65 35 66 44 Q67 56 50 58 Z" stroke={LEAF} strokeWidth="1.8" fill={LEAFG}/>
    <GrooveLeaf d="M50 36 L50 53" w={1.2} />
    <GrooveLeaf d="M50 41 Q44 41 41 45 M50 41 Q56 41 59 45 M50 48 Q45 48 42 51 M50 48 Q55 48 58 51" w={1} />
  </G>
);

// ── 42. Tree of Life ──────────────────────────────────────────────────────────
const TreeOfLifeGlyph = () => (
  <G>
    <NatureTablet />
    <Circle cx="50" cy="46" r="16" stroke={GOLDG} strokeWidth="1.6" fill="none"/>
    <GrooveLeaf d="M50 70 L50 46" w={2.2} />
    <GrooveLeaf d="M50 50 Q44 48 40 42 M50 50 Q56 48 60 42" w={1.5} />
    <GrooveLeaf d="M50 44 Q45 42 43 36 M50 44 Q55 42 57 36" w={1.4} />
    <GrooveLeaf d="M50 40 Q49 36 50 32 M50 38 Q47 35 45 32 M50 38 Q53 35 55 32" w={1.3} />
    <GrooveLeaf d="M50 64 Q44 64 40 70 M50 64 Q56 64 60 70 M50 64 L50 72" w={1.5} />
  </G>
);

// ── 43. Pine / evergreen ──────────────────────────────────────────────────────
const PineGlyph = () => (
  <G>
    <NatureTablet />
    <Rect x="47" y="64" width="6" height="9" stroke={PARCH} strokeWidth="1.3" fill={PARCHG}/>
    <Path d="M50 28 L42 44 L46 44 L40 55 L45 55 L38 67 L62 67 L55 55 L60 55 L54 44 L58 44 Z" stroke={LEAF} strokeWidth="1.6" fill={LEAFG} strokeLinejoin="round"/>
    <GrooveLeaf d="M50 32 L50 64" w={1} />
  </G>
);

// ── 44. Acorn ─────────────────────────────────────────────────────────────────
const AcornGlyph = () => (
  <G>
    <NatureTablet />
    <Path d="M39 50 Q39 66 50 71 Q61 66 61 50 Z" stroke={LEAF} strokeWidth="1.8" fill={LEAFG}/>
    <Path d="M37 49 Q37 41 50 41 Q63 41 63 49 Q63 52 50 52 Q37 52 37 49 Z" stroke={LEAF} strokeWidth="1.7" fill={LEAFG}/>
    <GrooveLeaf d="M50 41 L50 35" w={1.5} />
    <GrooveLeaf d="M40 46 Q45 48 40 50 M50 45 Q55 47 50 49 M60 46 Q55 48 60 50" w={1} />
  </G>
);

// ── 45. Fallen tree / stump ───────────────────────────────────────────────────
const FallenTreeGlyph = () => (
  <G>
    <NatureTablet />
    <Path d="M41 72 L41 50 Q41 46 50 46 Q59 46 59 50 L59 72 Z" stroke={PARCH} strokeWidth="1.8" fill={PARCHG}/>
    <Ellipse cx="50" cy="47" rx="9" ry="3.4" stroke={PARCH} strokeWidth="1.6" fill={PARCHG}/>
    <Ellipse cx="50" cy="47" rx="5.2" ry="1.9" stroke={PARCH} strokeWidth="1.1" fill="none"/>
    <Circle cx="50" cy="47" r="1.1" fill={PARCH}/>
    <GrooveLeaf d="M44 56 L44 70 M50 54 L50 70 M56 56 L56 70" w={1} />
    <GrooveLeaf d="M59 52 Q67 50 68 43 M59 58 Q65 58 67 52" w={1.3} />
  </G>
);

// ── 46. Fern ──────────────────────────────────────────────────────────────────
const FernGlyph = () => (
  <G>
    <NatureTablet />
    <GrooveLeaf d="M43 72 Q45 50 54 36 Q56 33 56 31" w={1.8} />
    <GrooveLeaf d="M44 65 Q37 64 35 67 M46 58 Q39 56 37 59 M48 51 Q42 49 40 52 M50 45 Q45 42 43 45 M53 40 Q49 37 48 40" w={1.2} />
    <GrooveLeaf d="M44 65 Q49 62 52 63 M46 58 Q51 55 54 56 M48 51 Q53 48 56 49 M50 45 Q54 42 57 43 M53 40 Q56 38 58 38" w={1.2} />
  </G>
);

// ── 47. Lily ──────────────────────────────────────────────────────────────────
const LilyGlyph = () => (
  <G>
    <NatureTablet />
    <GrooveLeaf d="M50 72 L50 50" w={1.8} />
    <Path d="M50 52 Q39 49 35 37 Q45 40 50 52 Z" stroke={LEAF} strokeWidth="1.5" fill={LEAFG}/>
    <Path d="M50 52 Q61 49 65 37 Q55 40 50 52 Z" stroke={LEAF} strokeWidth="1.5" fill={LEAFG}/>
    <Path d="M50 52 Q43 41 50 30 Q57 41 50 52 Z" stroke={LEAF} strokeWidth="1.6" fill={LEAFG}/>
    <GrooveLeaf d="M50 50 L50 36 M50 48 L45 40 M50 48 L55 40" w={1} />
    <GrooveLeaf d="M50 60 Q43 60 40 64 M50 65 Q57 65 60 69" w={1.2} />
  </G>
);

// ── 48. Calla lily ────────────────────────────────────────────────────────────
const CallaLilyGlyph = () => (
  <G>
    <NatureTablet />
    <GrooveLeaf d="M47 72 Q49 56 52 46" w={1.8} />
    <Path d="M52 46 Q39 44 40 32 Q46 26 54 30 Q63 36 62 46 Q58 50 52 46 Z" stroke={LEAF} strokeWidth="1.7" fill={LEAFG}/>
    <GrooveLeaf d="M51 44 L55 30" w={1.5} />
    <GrooveLeaf d="M47 64 Q40 62 38 56" w={1.3} />
  </G>
);

// ── 49. Tulip ─────────────────────────────────────────────────────────────────
const TulipGlyph = () => (
  <G>
    <NatureTablet />
    <GrooveLeaf d="M50 72 L50 49" w={1.8} />
    <Path d="M40 49 Q39 35 50 33 Q61 35 60 49 Q56 51 53 49 Q53 39 50 38 Q47 39 47 49 Q44 51 40 49 Z" stroke={LEAF} strokeWidth="1.7" fill={LEAFG}/>
    <GrooveLeaf d="M50 59 Q41 59 37 50 M50 64 Q59 64 63 55" w={1.4} />
  </G>
);

// ── 50. Forget-me-not ─────────────────────────────────────────────────────────
const ForgetMeNotGlyph = () => (
  <G>
    <NatureTablet />
    <GrooveLeaf d="M50 72 L50 60" w={1.6} />
    <GrooveLeaf d="M50 62 Q44 62 42 57 M50 62 Q56 62 58 57" w={1.1} />
    <Circle cx="50" cy="38" r="5.6" stroke={LEAF} strokeWidth="1.4" fill={LEAFG}/>
    <Circle cx="40" cy="45" r="5.6" stroke={LEAF} strokeWidth="1.4" fill={LEAFG}/>
    <Circle cx="60" cy="45" r="5.6" stroke={LEAF} strokeWidth="1.4" fill={LEAFG}/>
    <Circle cx="44" cy="55" r="5.6" stroke={LEAF} strokeWidth="1.4" fill={LEAFG}/>
    <Circle cx="56" cy="55" r="5.6" stroke={LEAF} strokeWidth="1.4" fill={LEAFG}/>
    <Circle cx="50" cy="48" r="3.4" fill={GOLD}/>
  </G>
);

// ── 51. Daisy ─────────────────────────────────────────────────────────────────
const DaisyGlyph = () => (
  <G>
    <NatureTablet />
    <GrooveLeaf d="M50 72 L50 56" w={1.6} />
    <GrooveLeaf d="M50 60 Q44 60 41 55 M50 62 Q57 62 60 58" w={1.1} />
    <G stroke={LEAF} strokeWidth="1.4" fill={LEAFG}>
      <Ellipse cx="50" cy="31" rx="2.8" ry="7"/><Ellipse cx="50" cy="53" rx="2.8" ry="7"/>
      <Ellipse cx="39" cy="42" rx="7" ry="2.8"/><Ellipse cx="61" cy="42" rx="7" ry="2.8"/>
      <Ellipse cx="42" cy="34" rx="2.8" ry="7" rotation={-45} originX={42} originY={34}/>
      <Ellipse cx="58" cy="34" rx="2.8" ry="7" rotation={45} originX={58} originY={34}/>
      <Ellipse cx="42" cy="50" rx="2.8" ry="7" rotation={45} originX={42} originY={50}/>
      <Ellipse cx="58" cy="50" rx="2.8" ry="7" rotation={-45} originX={58} originY={50}/>
    </G>
    <Circle cx="50" cy="42" r="4.2" fill={GOLD}/>
  </G>
);

// ── 52. Lotus bud ─────────────────────────────────────────────────────────────
const LotusBudGlyph = () => (
  <G>
    <NatureTablet />
    <GrooveLeaf d="M50 72 L50 58" w={1.8} />
    <Path d="M50 58 Q40 51 43 36 Q50 43 50 58 Z" stroke={LEAF} strokeWidth="1.5" fill={LEAFG}/>
    <Path d="M50 58 Q60 51 57 36 Q50 43 50 58 Z" stroke={LEAF} strokeWidth="1.5" fill={LEAFG}/>
    <Path d="M50 58 Q46 44 50 30 Q54 44 50 58 Z" stroke={LEAF} strokeWidth="1.6" fill={LEAFG}/>
    <GrooveLeaf d="M50 60 Q41 61 38 67 M50 60 Q59 61 62 67" w={1.3} />
  </G>
);

// ── 53. Thistle ───────────────────────────────────────────────────────────────
const ThistleGlyph = () => (
  <G>
    <NatureTablet />
    <GrooveLeaf d="M50 74 L50 60" w={1.8} />
    <Path d="M43 58 Q42 64 50 66 Q58 64 57 58 Q56 52 50 52 Q44 52 43 58 Z" stroke={LEAF} strokeWidth="1.6" fill={LEAFG}/>
    <GrooveLeaf d="M45 57 Q50 60 55 57 M45 61 Q50 63 55 61" w={1} />
    <GrooveLeaf d="M50 52 L50 36 M44 53 L40 40 M56 53 L60 40 M47 52 L44 38 M53 52 L56 38" w={1.3} />
    <GrooveLeaf d="M50 36 L47 31 M50 36 L53 31 M40 40 L37 36 M60 40 L63 36" w={1.1} />
    <GrooveLeaf d="M44 66 Q39 67 37 62 M56 66 Q61 67 63 62" w={1.3} />
  </G>
);

// ── 54. Poppy ─────────────────────────────────────────────────────────────────
const PoppyGlyph = () => (
  <G>
    <NatureTablet />
    <GrooveLeaf d="M50 72 Q48 58 50 50" w={1.8} />
    <Path d="M50 44 Q41 30 50 26 Q59 30 50 44 Z" stroke={LEAF} strokeWidth="1.4" fill={LEAFG}/>
    <Path d="M50 44 Q34 38 36 47 Q39 54 50 48 Z" stroke={LEAF} strokeWidth="1.4" fill={LEAFG}/>
    <Path d="M50 44 Q66 38 64 47 Q61 54 50 48 Z" stroke={LEAF} strokeWidth="1.4" fill={LEAFG}/>
    <Circle cx="50" cy="44" r="3.4" fill={GROOVE_DK}/>
    <GrooveLeaf d="M50 62 Q42 62 39 56" w={1.3} />
  </G>
);

// ── 55. Ivy ───────────────────────────────────────────────────────────────────
const IvyGlyph = () => (
  <G>
    <NatureTablet />
    <GrooveLeaf d="M50 72 Q42 64 50 54 Q58 44 50 34 Q44 30 50 28" w={1.7} />
    <Path d="M44 64 Q36 62 37 55 Q42 54 44 58 Q46 54 51 55 Q52 62 44 64 Z" stroke={LEAF} strokeWidth="1.3" fill={LEAFG}/>
    <Path d="M56 50 Q64 48 63 41 Q58 40 56 44 Q54 40 49 41 Q48 48 56 50 Z" stroke={LEAF} strokeWidth="1.3" fill={LEAFG}/>
    <Path d="M44 38 Q36 36 37 29 Q42 28 44 32 Q46 28 51 29 Q52 36 44 38 Z" stroke={LEAF} strokeWidth="1.3" fill={LEAFG}/>
  </G>
);

// ── 56. Laurel wreath ─────────────────────────────────────────────────────────
const LaurelGlyph = () => (
  <G>
    <NatureTablet />
    <GrooveLeaf d="M50 68 Q39 64 38 51 Q37 42 44 37" w={1.6} />
    <GrooveLeaf d="M50 68 Q61 64 62 51 Q63 42 56 37" w={1.6} />
    <G stroke={LEAF} strokeWidth="1.1" fill={LEAFG}>
      <Ellipse cx="36" cy="48" rx="4.2" ry="2.2" rotation={-60} originX={36} originY={48}/>
      <Ellipse cx="37" cy="56" rx="4.2" ry="2.2" rotation={-34} originX={37} originY={56}/>
      <Ellipse cx="42" cy="64" rx="4.2" ry="2.2" rotation={-12} originX={42} originY={64}/>
      <Ellipse cx="64" cy="48" rx="4.2" ry="2.2" rotation={60} originX={64} originY={48}/>
      <Ellipse cx="63" cy="56" rx="4.2" ry="2.2" rotation={34} originX={63} originY={56}/>
      <Ellipse cx="58" cy="64" rx="4.2" ry="2.2" rotation={12} originX={58} originY={64}/>
    </G>
    <GrooveLeaf d="M46 68 Q50 72 54 68 M48 70 L46 74 M52 70 L54 74" w={1.3} />
  </G>
);

// ── 57. Single oak leaf ───────────────────────────────────────────────────────
const LeafGlyph = () => (
  <G>
    <NatureTablet />
    <Path d="M50 72 Q44 68 44 62 Q36 62 35 56 Q41 54 42 51 Q35 49 36 43 Q42 43 43 40 Q39 35 42 31 Q47 33 50 30 Q53 33 58 31 Q61 35 57 40 Q58 43 64 43 Q65 49 58 51 Q59 54 65 56 Q64 62 56 62 Q56 68 50 72 Z" stroke={LEAF} strokeWidth="1.6" fill={LEAFG}/>
    <GrooveLeaf d="M50 68 L50 32" w={1.4} />
    <GrooveLeaf d="M50 42 Q45 42 42 39 M50 42 Q55 42 58 39 M50 51 Q44 51 41 47 M50 51 Q56 51 59 47 M50 60 Q45 60 43 57 M50 60 Q55 60 57 57" w={1} />
  </G>
);

// ── 58. Wheat sprig ───────────────────────────────────────────────────────────
const WheatSprigGlyph = () => (
  <G>
    <NatureTablet />
    <GrooveLeaf d="M50 72 L50 40" w={1.7} />
    <GrooveLeaf d="M50 44 Q44 44 44 48 M50 44 Q56 44 56 48 M50 50 Q44 50 44 54 M50 50 Q56 50 56 54 M50 56 Q45 56 45 60 M50 56 Q55 56 55 60" w={1.3} />
    <GrooveLeaf d="M50 40 Q47 37 47 33 M50 40 Q53 37 53 33 M50 40 L50 31" w={1.3} />
  </G>
);

// ── 59. Sunrise ───────────────────────────────────────────────────────────────
const SunriseGlyph = () => (
  <G>
    <NatureTablet />
    <Groove d="M34 64 L66 64" w={2} />
    <Path d="M39 64 Q39 49 50 49 Q61 49 61 64 Z" stroke={GOLDG} strokeWidth="1.8" fill={PARCHG}/>
    <Groove d="M50 45 L50 39 M42 47 L39 42 M58 47 L61 42 M37 53 L33 50 M63 53 L67 50" w={1.4} />
  </G>
);

// ── 60. Butterfly ─────────────────────────────────────────────────────────────
const ButterflyGlyph = () => (
  <G>
    <NatureTablet />
    <Path d="M50 64 Q47 54 49 44 Q49 40 50 40 Q51 40 51 44 Q53 54 50 64 Z" stroke={PARCH} strokeWidth="1.3" fill={PARCHG}/>
    <Path d="M49 47 Q35 35 33 44 Q31 52 40 53 Q47 53 49 47 Z" stroke={PARCH} strokeWidth="1.5" fill={PARCHG}/>
    <Path d="M51 47 Q65 35 67 44 Q69 52 60 53 Q53 53 51 47 Z" stroke={PARCH} strokeWidth="1.5" fill={PARCHG}/>
    <Path d="M49 51 Q40 56 39 64 Q44 68 49 60 Z" stroke={PARCH} strokeWidth="1.4" fill={PARCHG}/>
    <Path d="M51 51 Q60 56 61 64 Q56 68 51 60 Z" stroke={PARCH} strokeWidth="1.4" fill={PARCHG}/>
    <Groove d="M50 42 Q47 36 44 34 M50 42 Q53 36 56 34" w={1.2} />
  </G>
);

// ═══════════════════════════════════════════════════════════════════════════════
// PACK 4 — CELESTIAL & ETERNITY (glyphs 61-80)
// Same depth treatment; celestial detail (suns, moons, stars, flames, beams) uses
// the silver-blue accent (SILVER/SILVERG/<GrooveSky>) so the pack reads as "sky /
// eternity" while stone + gold stroke keep the global-map gold identity. All art
// kept inside x≈[34,66] so nothing crosses the tablet edge. Byte-for-byte
// equivalent to web js/grave-markers.js.
// ═══════════════════════════════════════════════════════════════════════════════

const SkyTablet = () => (
  <>
    <Base />
    <Path d="M30 84 L30 40 Q30 22 50 22 Q70 22 70 40 L70 84 Z" stroke={GOLDG} strokeWidth="2.2" fill={STONE} />
  </>
);

// ── 61. Sun ───────────────────────────────────────────────────────────────────
const SunGlyph = () => (
  <G>
    <SkyTablet />
    <GrooveSky d="M50 36 L50 30 M50 70 L50 64 M36 53 L30 53 M70 53 L64 53 M40 43 L36 39 M60 43 L64 39 M40 63 L36 67 M60 63 L64 67" w={1.5} />
    <Circle cx="50" cy="53" r="9" stroke={SILVER} strokeWidth="1.8" fill={SILVERG}/>
  </G>
);

// ── 62. Crescent moon ─────────────────────────────────────────────────────────
const CrescentMoonGlyph = () => (
  <G>
    <SkyTablet />
    <Path d="M59 35 Q42 38 42 54 Q42 70 59 73 Q47 65 47 54 Q47 43 59 35 Z" stroke={SILVER} strokeWidth="1.9" fill={SILVERG}/>
  </G>
);

// ── 63. Full moon ─────────────────────────────────────────────────────────────
const FullMoonGlyph = () => (
  <G>
    <SkyTablet />
    <Circle cx="50" cy="52" r="15" stroke={SILVER} strokeWidth="1.9" fill={SILVERG}/>
    <Circle cx="44" cy="47" r="3.2" stroke={SILVER} strokeWidth="1.3" fill="none"/>
    <Circle cx="56" cy="55" r="2.4" stroke={SILVER} strokeWidth="1.2" fill="none"/>
    <Circle cx="47" cy="58" r="1.8" stroke={SILVER} strokeWidth="1.1" fill="none"/>
  </G>
);

// ── 64. Five-pointed star ─────────────────────────────────────────────────────
const FiveStarGlyph = () => (
  <G>
    <SkyTablet />
    <Polygon points="50,32 55.5,47 71,47 58.5,56.5 63,72 50,62.5 37,72 41.5,56.5 29,47 44.5,47" stroke={SILVER} strokeWidth="1.6" fill={SILVERG} strokeLinejoin="round"/>
  </G>
);

// ── 65. Starfield ─────────────────────────────────────────────────────────────
const StarfieldGlyph = () => (
  <G>
    <SkyTablet />
    <Polygon points="45,35 47.5,43 56,43 49,48 51.5,56 45,51 38.5,56 41,48 34,43 42.5,43" stroke={SILVER} strokeWidth="1.3" fill={SILVERG} strokeLinejoin="round"/>
    <Polygon points="60,52 61.8,57 67,57 62.8,60.5 64.5,65.5 60,62.5 55.5,65.5 57.2,60.5 53,57 58.2,57" stroke={SILVER} strokeWidth="1.1" fill={SILVERG} strokeLinejoin="round"/>
    <Polygon points="41,60 42,63.5 46,63.5 42.8,66 44,70 41,67.5 38,70 39.2,66 36,63.5 40,63.5" stroke={SILVER} strokeWidth="1" fill={SILVERG} strokeLinejoin="round"/>
  </G>
);

// ── 66. Shooting star ─────────────────────────────────────────────────────────
const ShootingStarGlyph = () => (
  <G>
    <SkyTablet />
    <GrooveSky d="M58 40 L40 60 M61 44 L46 62 M54 38 L38 54" w={1.5} />
    <Polygon points="61,37 63.5,44 71,44 65,49 67.5,56 61,51.5 54.5,56 57,49 51,44 58.5,44" stroke={SILVER} strokeWidth="1.3" fill={SILVERG} strokeLinejoin="round"/>
  </G>
);

// ── 67. Eternal flame ─────────────────────────────────────────────────────────
const EternalFlameGlyph = () => (
  <G>
    <SkyTablet />
    <Path d="M50 72 Q38 64 38 52 Q38 41 49 30 Q49 40 54 42 Q62 46 62 56 Q62 66 50 72 Z" stroke={SILVER} strokeWidth="1.8" fill={SILVERG}/>
    <Path d="M50 67 Q44 61 45 53 Q46 46 50 41 Q54 48 54 56 Q54 63 50 67 Z" stroke={SILVER} strokeWidth="1.3" fill={STONE}/>
  </G>
);

// ── 68. Candle ────────────────────────────────────────────────────────────────
const CandleGlyph = () => (
  <G>
    <SkyTablet />
    <Rect x="44" y="50" width="12" height="22" rx="1.5" stroke={PARCH} strokeWidth="1.7" fill={PARCHG}/>
    <Groove d="M44 56 L56 56" w={1.1} />
    <GrooveSky d="M50 50 L50 45" w={1.3} />
    <Path d="M50 45 Q44 39 50 30 Q56 39 50 45 Z" stroke={SILVER} strokeWidth="1.5" fill={SILVERG}/>
  </G>
);

// ── 69. Gates of heaven ───────────────────────────────────────────────────────
const GatesOfHeavenGlyph = () => (
  <G>
    <SkyTablet />
    <Path d="M38 74 L38 50 Q38 40 45 37 L45 74 Z" stroke={PARCH} strokeWidth="1.7" fill={PARCHG}/>
    <Path d="M62 74 L62 50 Q62 40 55 37 L55 74 Z" stroke={PARCH} strokeWidth="1.7" fill={PARCHG}/>
    <Groove d="M41 45 L41 72 M50 40 L50 72 M59 45 L59 72" w={1} />
    <GrooveSky d="M50 34 L50 29 M44 36 L41 31 M56 36 L59 31" w={1.3} />
  </G>
);

// ── 70. Ascending stair ───────────────────────────────────────────────────────
const AscendingStairGlyph = () => (
  <G>
    <SkyTablet />
    <Groove d="M35 71 L43 71 L43 63 L51 63 L51 55 L59 55 L59 47 L66 47" w={2.2} />
    <GrooveSky d="M61 41 L61 35 M55 43 L52 38 M67 43 L70 38" w={1.3} />
  </G>
);

// ── 71. Infinity ──────────────────────────────────────────────────────────────
const InfinityGlyph = () => (
  <G>
    <SkyTablet />
    <GrooveSky d="M50 53 Q42 41 35 48 Q29 53 35 58 Q42 65 50 53 Q58 41 65 48 Q71 53 65 58 Q58 65 50 53 Z" w={2.6} />
  </G>
);

// ── 72. Ouroboros ─────────────────────────────────────────────────────────────
const OuroborosGlyph = () => (
  <G>
    <SkyTablet />
    <Path d="M50 38 A14 14 0 1 1 41 41" stroke={SILVER} strokeWidth="3.6" fill="none" strokeLinecap="round"/>
    <Path d="M41 41 L33 36 L37 45 L43 47 Q49 46 49 42 Q49 39 44 39 Z" stroke={SILVER} strokeWidth="1.4" fill={SILVERG} strokeLinejoin="round"/>
    <Circle cx="40" cy="40" r="1.3" fill={GROOVE_DK}/>
  </G>
);

// ── 73. Hourglass ─────────────────────────────────────────────────────────────
const HourglassGlyph = () => (
  <G>
    <SkyTablet />
    <Groove d="M39 36 L61 36 M39 70 L61 70" w={2} />
    <Path d="M43 38 L57 38 L50 53 Z" stroke={PARCH} strokeWidth="1.6" fill={PARCHG} strokeLinejoin="round"/>
    <Path d="M43 68 L57 68 L50 53 Z" stroke={PARCH} strokeWidth="1.6" fill={PARCHG} strokeLinejoin="round"/>
    <GrooveSky d="M50 53 L50 64" w={1.3} />
  </G>
);

// ── 74. Winged hourglass ──────────────────────────────────────────────────────
const WingedHourglassGlyph = () => (
  <G>
    <SkyTablet />
    <Groove d="M43 43 L57 43 M43 67 L57 67" w={1.7} />
    <Path d="M46 44 L54 44 L50 55 Z" stroke={PARCH} strokeWidth="1.5" fill={PARCHG} strokeLinejoin="round"/>
    <Path d="M46 66 L54 66 L50 55 Z" stroke={PARCH} strokeWidth="1.5" fill={PARCHG} strokeLinejoin="round"/>
    <Path d="M43 46 Q32 43 32 50 Q32 55 36 56 Q35 51 43 51 Z" stroke={SILVER} strokeWidth="1.4" fill={SILVERG} strokeLinejoin="round"/>
    <Path d="M57 46 Q68 43 68 50 Q68 55 64 56 Q65 51 57 51 Z" stroke={SILVER} strokeWidth="1.4" fill={SILVERG} strokeLinejoin="round"/>
  </G>
);

// ── 75. Radiant cross ─────────────────────────────────────────────────────────
const RadiantCrossGlyph = () => (
  <G>
    <SkyTablet />
    <GrooveSky d="M50 33 L50 35 M41 38 L39 36 M59 38 L61 36 M37 47 L34 46 M63 47 L66 46" w={1.3} />
    <Groove d="M50 41 L50 73" w={2.6} />
    <Groove d="M39 53 L61 53" w={2.6} />
  </G>
);

// ── 76. Rays / glory ──────────────────────────────────────────────────────────
const RaysGlyph = () => (
  <G>
    <SkyTablet />
    <Path d="M37 58 Q33 58 33 54 Q33 48 40 49 Q42 44 50 45 Q58 44 60 50 Q67 50 67 56 Q67 60 63 60 Z" stroke={PARCH} strokeWidth="1.6" fill={PARCHG}/>
    <GrooveSky d="M42 62 L39 71 M50 62 L50 72 M58 62 L61 71" w={1.5} />
  </G>
);

// ── 77. North star ────────────────────────────────────────────────────────────
const NorthStarGlyph = () => (
  <G>
    <SkyTablet />
    <Polygon points="50,30 53,49 72,52 53,55 50,74 47,55 28,52 47,49" stroke={SILVER} strokeWidth="1.5" fill={SILVERG} strokeLinejoin="round"/>
    <GrooveSky d="M58 44 L62 40 M42 44 L38 40 M58 60 L62 64 M42 60 L38 64" w={1.1} />
    <Circle cx="50" cy="52" r="2.6" fill={SILVER}/>
  </G>
);

// ── 78. Constellation ─────────────────────────────────────────────────────────
const ConstellationGlyph = () => (
  <G>
    <SkyTablet />
    <GrooveSky d="M40 38 L50 50 L46 64 M50 50 L62 44 M50 50 L60 62" w={1.4} />
    <Circle cx="40" cy="38" r="2.6" fill={SILVER}/>
    <Circle cx="50" cy="50" r="3" fill={SILVER}/>
    <Circle cx="46" cy="64" r="2.4" fill={SILVER}/>
    <Circle cx="62" cy="44" r="2.4" fill={SILVER}/>
    <Circle cx="60" cy="62" r="2.4" fill={SILVER}/>
  </G>
);

// ── 79. Eclipse ───────────────────────────────────────────────────────────────
const EclipseGlyph = () => (
  <G>
    <SkyTablet />
    <GrooveSky d="M50 32 L50 37 M68 52 L73 52 M50 72 L50 67 M32 52 L27 52 M62 40 L66 36 M62 64 L66 68 M38 40 L34 36 M38 64 L34 68" w={1.4} />
    <Circle cx="50" cy="52" r="13" fill={SILVERG} stroke={SILVER} strokeWidth="1.7"/>
    <Circle cx="53" cy="50" r="11.5" fill={STONE} stroke={SILVER} strokeWidth="1.4"/>
  </G>
);

// ── 80. Clouds ────────────────────────────────────────────────────────────────
const CloudsGlyph = () => (
  <G>
    <SkyTablet />
    <Path d="M50 38 Q44 38 44 44 Q40 44 40 49 Q44 49 50 49 Q56 49 56 44 Q56 38 50 38 Z" stroke={SILVER} strokeWidth="1.4" fill={SILVERG}/>
    <Path d="M36 70 Q30 70 30 63 Q30 56 38 57 Q40 50 50 51 Q60 50 62 58 Q70 58 70 65 Q70 70 64 70 Z" stroke={PARCH} strokeWidth="1.7" fill={PARCHG}/>
    <Groove d="M37 70 Q42 66 47 70 Q52 66 57 70 Q62 66 67 70" w={1.2} />
  </G>
);

// ═══════════════════════════════════════════════════════════════════════════════
// PACK 5 — SYMBOLS & TRADES (glyphs 81-100)
// Emblems of vocation, fellowship and remembrance. Same depth treatment; the
// tool/emblem detail uses the warm copper-bronze accent (COPPER/COPPERG/
// <GrooveCopper>) so the pack reads as "craft / burnished metal" while stone +
// gold stroke keep the global-map gold identity. All art kept inside x≈[34,66] so
// nothing crosses the tablet edge. Byte-for-byte equivalent to web grave-markers.js.
// ═══════════════════════════════════════════════════════════════════════════════

const TradeTablet = () => (
  <>
    <Base />
    <Path d="M30 84 L30 40 Q30 22 50 22 Q70 22 70 40 L70 84 Z" stroke={GOLDG} strokeWidth="2.2" fill={STONE} />
  </>
);

// ── 81. Square & compasses ────────────────────────────────────────────────────
const SquareGlyph = () => (
  <G>
    <TradeTablet />
    <GrooveCopper d="M35 49 L50 70 L65 49" w={2.2} />
    <GrooveCopper d="M50 28 L37 60" w={2.4} />
    <GrooveCopper d="M50 28 L63 60" w={2.4} />
    <GrooveCopper d="M37 60 L41 55 M63 60 L59 55" w={1.4} />
    <Circle cx="50" cy="28" r="2.8" fill={COPPER}/>
  </G>
);

// ── 82. Anvil ─────────────────────────────────────────────────────────────────
const AnvilGlyph = () => (
  <G>
    <TradeTablet />
    <Path d="M34 44 Q40 44 40 48 L60 48 L66 44 L66 50 Q60 52 56 52 Q62 58 68 57 Q63 62 54 60 L54 54 L46 54 L46 60 L42 60 L42 50 L34 50 Z" stroke={COPPER} strokeWidth="1.6" fill={COPPERG} strokeLinejoin="round"/>
    <GrooveCopper d="M48 60 L48 66 M52 60 L52 66" w={1.6} />
    <Path d="M40 66 L60 66 L62 72 L38 72 Z" stroke={COPPER} strokeWidth="1.5" fill={COPPERG} strokeLinejoin="round"/>
  </G>
);

// ── 83. Ship's wheel ──────────────────────────────────────────────────────────
const WheelGlyph = () => (
  <G>
    <TradeTablet />
    <Circle cx="50" cy="52" r="13" stroke={COPPER} strokeWidth="1.8" fill="none"/>
    <Circle cx="50" cy="52" r="4" stroke={COPPER} strokeWidth="1.5" fill={COPPERG}/>
    <GrooveCopper d="M50 39 L50 47 M50 57 L50 65 M37 52 L45 52 M55 52 L63 52" w={1.5} />
    <GrooveCopper d="M41 43 L46 48 M59 43 L54 48 M41 61 L46 56 M59 61 L54 56" w={1.3} />
    <GrooveCopper d="M50 34 L50 39 M50 65 L50 70 M34 52 L39 52 M61 52 L66 52" w={2} />
    <GrooveCopper d="M38 40 L41 43 M62 40 L59 43 M38 64 L41 61 M62 64 L59 61" w={2} />
  </G>
);

// ── 84. Quill & inkwell ───────────────────────────────────────────────────────
const QuillGlyph = () => (
  <G>
    <TradeTablet />
    <Path d="M40 62 Q48 52 58 34 Q60 30 62 32 Q60 50 46 62 Z" stroke={COPPER} strokeWidth="1.5" fill={COPPERG} strokeLinejoin="round"/>
    <GrooveCopper d="M44 60 Q52 50 60 36" w={1.1} />
    <Path d="M40 64 L42 56 L54 56 L56 64 Z" stroke={PARCH} strokeWidth="1.6" fill={PARCHG} strokeLinejoin="round"/>
    <Groove d="M40 64 L56 64" w={1.4} />
    <Path d="M42 56 L54 56 L53 52 L43 52 Z" stroke={PARCH} strokeWidth="1.3" fill={PARCHG} strokeLinejoin="round"/>
  </G>
);

// ── 85. Lyre ──────────────────────────────────────────────────────────────────
const LyreGlyph = () => (
  <G>
    <TradeTablet />
    <Path d="M42 66 Q33 52 40 38 Q43 32 48 36" stroke={COPPER} strokeWidth="2.2" fill="none" strokeLinecap="round"/>
    <Path d="M58 66 Q67 52 60 38 Q57 32 52 36" stroke={COPPER} strokeWidth="2.2" fill="none" strokeLinecap="round"/>
    <GrooveCopper d="M43 41 L57 41" w={1.8} />
    <GrooveCopper d="M45 43 L45 64 M50 43 L50 64 M55 43 L55 64" w={1.1} />
    <GrooveCopper d="M41 65 L59 65" w={1.8} />
  </G>
);

// ── 86. Scales of justice ─────────────────────────────────────────────────────
const ScalesGlyph = () => (
  <G>
    <TradeTablet />
    <GrooveCopper d="M50 32 L50 66" w={2} />
    <GrooveCopper d="M34 40 L66 40" w={2} />
    <Circle cx="50" cy="32" r="2.4" fill={COPPER}/>
    <GrooveCopper d="M34 40 L30 50 M34 40 L38 50 M66 40 L62 50 M66 40 L70 50" w={1} />
    <Path d="M29 50 Q34 58 39 50 Z" stroke={COPPER} strokeWidth="1.4" fill={COPPERG} strokeLinejoin="round"/>
    <Path d="M61 50 Q66 58 71 50 Z" stroke={COPPER} strokeWidth="1.4" fill={COPPERG} strokeLinejoin="round"/>
    <GrooveCopper d="M42 66 L58 66 L55 72 L45 72 Z" w={1.4} />
  </G>
);

// ── 87. Caduceus ──────────────────────────────────────────────────────────────
const CaduceusGlyph = () => (
  <G>
    <TradeTablet />
    <GrooveCopper d="M50 40 L50 72" w={2} />
    <Path d="M50 46 Q40 48 42 54 Q44 60 50 60 Q56 60 58 66 Q60 70 50 70" stroke={COPPER} strokeWidth="1.7" fill="none" strokeLinecap="round"/>
    <Path d="M50 46 Q60 48 58 54 Q56 60 50 60 Q44 60 42 66 Q40 70 50 70" stroke={COPPER} strokeWidth="1.7" fill="none" strokeLinecap="round"/>
    <Path d="M50 42 Q40 36 33 42 Q41 42 48 47 Z" stroke={COPPER} strokeWidth="1.3" fill={COPPERG} strokeLinejoin="round"/>
    <Path d="M50 42 Q60 36 67 42 Q59 42 52 47 Z" stroke={COPPER} strokeWidth="1.3" fill={COPPERG} strokeLinejoin="round"/>
    <Circle cx="50" cy="39" r="2.6" fill={COPPER}/>
  </G>
);

// ── 88. Gear / cog ────────────────────────────────────────────────────────────
const GearGlyph = () => (
  <G>
    <TradeTablet />
    <Path d="M47 34 L53 34 L54 39 L58 41 L62 38 L66 42 L63 46 L65 50 L70 51 L70 57 L65 58 L63 62 L66 66 L62 70 L58 67 L54 69 L53 74 L47 74 L46 69 L42 67 L38 70 L34 66 L37 62 L35 58 L30 57 L30 51 L35 50 L37 46 L34 42 L38 38 L42 41 L46 39 Z" stroke={COPPER} strokeWidth="1.5" fill={COPPERG} strokeLinejoin="round"/>
    <Circle cx="50" cy="54" r="7" stroke={COPPER} strokeWidth="1.6" fill={STONE}/>
  </G>
);

// ── 89. Torch ─────────────────────────────────────────────────────────────────
const TorchGlyph = () => (
  <G>
    <TradeTablet />
    <Path d="M50 50 Q40 42 46 30 Q47 38 50 36 Q53 26 56 34 Q60 40 54 48 Q52 52 50 50 Z" stroke={COPPER} strokeWidth="1.6" fill={COPPERG} strokeLinejoin="round"/>
    <Path d="M43 52 L57 52 L55 57 L45 57 Z" stroke={PARCH} strokeWidth="1.4" fill={PARCHG} strokeLinejoin="round"/>
    <Groove d="M46 57 L48 74 M54 57 L52 74" w={2.2} />
    <Groove d="M46 74 L54 74" w={2} />
  </G>
);

// ── 90. Sword ─────────────────────────────────────────────────────────────────
const SwordGlyph = () => (
  <G>
    <TradeTablet />
    <Path d="M47 40 L53 40 L52 68 L50 73 L48 68 Z" stroke={COPPER} strokeWidth="1.5" fill={COPPERG} strokeLinejoin="round"/>
    <GrooveCopper d="M50 41 L50 67" w={1.2} />
    <GrooveCopper d="M38 44 L62 44" w={2.2} />
    <Path d="M47 34 L53 34 L53 40 L47 40 Z" stroke={COPPER} strokeWidth="1.4" fill={COPPERG}/>
    <Circle cx="50" cy="32" r="2.6" stroke={COPPER} strokeWidth="1.4" fill={COPPERG}/>
  </G>
);

// ── 91. Laurel medal ──────────────────────────────────────────────────────────
const MedalGlyph = () => (
  <G>
    <TradeTablet />
    <G x={0.9} y={1}><Path d="M41 32 L48 50 M59 32 L52 50" stroke={GROOVE_DK} strokeWidth="2" fill="none" strokeLinecap="round"/></G>
    <Path d="M41 32 L48 50 M59 32 L52 50" stroke={COPPER} strokeWidth="2" fill="none" strokeLinecap="round"/>
    <Circle cx="50" cy="58" r="12" stroke={COPPER} strokeWidth="2.2" fill={STONE}/>
    <Path d="M50 49 L53 56 L60 56 L54 60 L57 67 L50 62 L43 67 L46 60 L40 56 L47 56 Z" stroke={COPPER} strokeWidth="1.2" fill={COPPERG} strokeLinejoin="round"/>
  </G>
);

// ── 92. Crossed pick & shovel ─────────────────────────────────────────────────
const PickGlyph = () => (
  <G>
    <TradeTablet />
    <Path d="M34 38 Q42 30 50 34 Q58 30 66 38 Q58 38 50 44 Q42 38 34 38 Z" stroke={COPPER} strokeWidth="1.5" fill={COPPERG} strokeLinejoin="round"/>
    <GrooveCopper d="M36 40 L62 70" w={2.2} />
    <GrooveCopper d="M64 40 L52 60" w={2.2} />
    <Path d="M46 58 L58 58 L58 66 Q52 70 46 66 Z" stroke={COPPER} strokeWidth="1.5" fill={COPPERG} strokeLinejoin="round"/>
  </G>
);

// ── 93. Crossed hammer & spanner ──────────────────────────────────────────────
const HammerGlyph = () => (
  <G>
    <TradeTablet />
    <GrooveCopper d="M40 70 L58 38" w={2.2} />
    <Path d="M52 30 L66 30 L66 39 L52 39 Z" stroke={COPPER} strokeWidth="1.5" fill={COPPERG} rotation={-30} originX={59} originY={34} strokeLinejoin="round"/>
    <GrooveCopper d="M60 70 L44 40" w={2} />
    <Path d="M38 30 Q32 33 34 39 Q37 36 40 39 Q44 42 46 36 Q44 28 38 30 Z" stroke={COPPER} strokeWidth="1.5" fill={COPPERG} strokeLinejoin="round"/>
  </G>
);

// ── 94. Palette & brush ───────────────────────────────────────────────────────
const PaletteGlyph = () => (
  <G>
    <TradeTablet />
    <Path d="M37 54 Q35 40 50 39 Q65 39 65 50 Q65 55 59 55 Q54 55 54 60 Q54 67 46 66 Q37 65 37 54 Z" stroke={COPPER} strokeWidth="1.6" fill={COPPERG} strokeLinejoin="round"/>
    <Circle cx="46" cy="60" r="3.2" stroke={COPPER} strokeWidth="1.3" fill={STONE}/>
    <Circle cx="45" cy="47" r="2.2" fill={COPPER}/>
    <Circle cx="53" cy="44" r="2.2" fill={COPPER}/>
    <Circle cx="60" cy="48" r="2" fill={COPPER}/>
    <GrooveCopper d="M56 38 L66 26" w={1.8} />
    <Path d="M64 30 L70 24 L66 28 Z" stroke={COPPER} strokeWidth="1.2" fill={COPPER} strokeLinejoin="round"/>
  </G>
);

// ── 95. Crossed keys ──────────────────────────────────────────────────────────
const KeyGlyph = () => (
  <G>
    <TradeTablet />
    <Circle cx="40" cy="40" r="6" stroke={COPPER} strokeWidth="1.8" fill="none"/>
    <Circle cx="40" cy="40" r="2" fill={COPPER}/>
    <GrooveCopper d="M44 44 L60 66" w={2} />
    <GrooveCopper d="M56 60 L62 60 M52 55 L58 55" w={1.6} />
    <Circle cx="60" cy="40" r="6" stroke={COPPER} strokeWidth="1.8" fill="none"/>
    <Circle cx="60" cy="40" r="2" fill={COPPER}/>
    <GrooveCopper d="M56 44 L40 66" w={2} />
    <GrooveCopper d="M44 60 L38 60 M48 55 L42 55" w={1.6} />
  </G>
);

// ── 96. Bell ──────────────────────────────────────────────────────────────────
const BellGlyph = () => (
  <G>
    <TradeTablet />
    <GrooveCopper d="M50 30 L50 36" w={1.4} />
    <Circle cx="50" cy="37" r="2.4" stroke={COPPER} strokeWidth="1.3" fill={COPPERG}/>
    <Path d="M40 64 Q38 46 50 40 Q62 46 60 64 Z" stroke={COPPER} strokeWidth="1.7" fill={COPPERG} strokeLinejoin="round"/>
    <Path d="M35 64 Q50 60 65 64 Q50 68 35 64 Z" stroke={COPPER} strokeWidth="1.6" fill={COPPERG} strokeLinejoin="round"/>
    <Circle cx="50" cy="70" r="2.4" fill={COPPER}/>
  </G>
);

// ── 97. Plough ────────────────────────────────────────────────────────────────
const PlowGlyph = () => (
  <G>
    <TradeTablet />
    <GrooveCopper d="M62 34 L48 46 L46 56" w={2} />
    <Path d="M38 56 Q34 56 34 62 Q34 70 46 70 Q58 70 60 60 Q54 64 48 62 Q42 60 42 56 Z" stroke={COPPER} strokeWidth="1.7" fill={COPPERG} strokeLinejoin="round"/>
    <GrooveCopper d="M46 56 L42 56" w={1.5} />
    <GrooveCopper d="M55 38 L64 38" w={1.5} />
  </G>
);

// ── 98. Shield ────────────────────────────────────────────────────────────────
const ShieldGlyph = () => (
  <G>
    <TradeTablet />
    <Path d="M36 36 L64 36 L64 50 Q64 66 50 73 Q36 66 36 50 Z" stroke={COPPER} strokeWidth="1.9" fill={COPPERG} strokeLinejoin="round"/>
    <GrooveCopper d="M38 52 L50 44 L62 52" w={2.2} />
    <GrooveCopper d="M42 60 L50 54 L58 60" w={1.6} />
  </G>
);

// ── 99. Clasped hands ─────────────────────────────────────────────────────────
const ClaspedGlyph = () => (
  <G>
    <TradeTablet />
    <Path d="M34 68 L44 66 L42 52 L34 53 Z" stroke={PARCH} strokeWidth="1.5" fill={PARCHG} strokeLinejoin="round"/>
    <Path d="M66 44 L57 46 L59 60 L66 59 Z" stroke={PARCH} strokeWidth="1.5" fill={PARCHG} strokeLinejoin="round"/>
    <Path d="M42 52 Q50 49 57 50 Q60 52 58 56 L58 60 Q52 62 46 60 L42 58 Z" stroke={COPPER} strokeWidth="1.6" fill={COPPERG} strokeLinejoin="round"/>
    <Path d="M44 60 Q50 62 56 60 L57 56 Q50 56 45 54 Z" stroke={COPPER} strokeWidth="1.5" fill={COPPERG} strokeLinejoin="round"/>
    <Path d="M55 50 Q59 48 60 52 Q59 55 55 54 Z" stroke={COPPER} strokeWidth="1.4" fill={COPPERG} strokeLinejoin="round"/>
    <GrooveCopper d="M47 57 L55 57 M47 60 L54 60" w={1.3} />
  </G>
);

// ── 100. Horseshoe ────────────────────────────────────────────────────────────
const HorseshoeGlyph = () => (
  <G>
    <TradeTablet />
    <Path d="M41 70 L41 52 Q41 35 50 35 Q59 35 59 52 L59 70" stroke={COPPER} strokeWidth="4.5" fill="none" strokeLinecap="round"/>
    <G x={0.6} y={0.8}><Path d="M41 70 L41 52 Q41 35 50 35 Q59 35 59 52 L59 70" stroke={GROOVE_DK} strokeWidth="1.6" fill="none" strokeLinecap="round"/></G>
    <GrooveCopper d="M44 47 L46 47 M41 55 L43 55 M41 63 L43 63 M54 47 L56 47 M57 55 L59 55 M57 63 L59 63" w={1.2} />
  </G>
);

// Pack definitions — drive the picker's tab row (order = display order).
// Add a pack here and tag its markers with the matching `pack` id below.
export const MARKER_PACKS = [
  { id: 'classic',   label: 'Classic' },
  { id: 'faith',     label: 'Faith' },
  { id: 'nature',    label: 'Nature' },
  { id: 'celestial', label: 'Celestial' },
  { id: 'trades',    label: 'Trades' },
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
  // ── Pack 4 — Celestial & Eternity ──
  { id: 'sun',            label: 'Sun',             pack: 'celestial', Glyph: SunGlyph },
  { id: 'crescentmoon',   label: 'Crescent Moon',   pack: 'celestial', Glyph: CrescentMoonGlyph },
  { id: 'fullmoon',       label: 'Full Moon',       pack: 'celestial', Glyph: FullMoonGlyph },
  { id: 'fivestar',       label: 'Star',            pack: 'celestial', Glyph: FiveStarGlyph },
  { id: 'starfield',      label: 'Starfield',       pack: 'celestial', Glyph: StarfieldGlyph },
  { id: 'shootingstar',   label: 'Shooting Star',   pack: 'celestial', Glyph: ShootingStarGlyph },
  { id: 'eternalflame',   label: 'Eternal Flame',   pack: 'celestial', Glyph: EternalFlameGlyph },
  { id: 'candle',         label: 'Candle',          pack: 'celestial', Glyph: CandleGlyph },
  { id: 'gates',          label: 'Gates of Heaven', pack: 'celestial', Glyph: GatesOfHeavenGlyph },
  { id: 'stair',          label: 'Ascending Stair', pack: 'celestial', Glyph: AscendingStairGlyph },
  { id: 'infinity',       label: 'Infinity',        pack: 'celestial', Glyph: InfinityGlyph },
  { id: 'ouroboros',      label: 'Ouroboros',       pack: 'celestial', Glyph: OuroborosGlyph },
  { id: 'hourglass',      label: 'Hourglass',       pack: 'celestial', Glyph: HourglassGlyph },
  { id: 'wingedhourglass',label: 'Winged Hourglass',pack: 'celestial', Glyph: WingedHourglassGlyph },
  { id: 'radiantcross',   label: 'Radiant Cross',   pack: 'celestial', Glyph: RadiantCrossGlyph },
  { id: 'rays',           label: 'Rays of Glory',   pack: 'celestial', Glyph: RaysGlyph },
  { id: 'northstar',      label: 'North Star',      pack: 'celestial', Glyph: NorthStarGlyph },
  { id: 'constellation',  label: 'Constellation',   pack: 'celestial', Glyph: ConstellationGlyph },
  { id: 'eclipse',        label: 'Eclipse',         pack: 'celestial', Glyph: EclipseGlyph },
  { id: 'clouds',         label: 'Clouds',          pack: 'celestial', Glyph: CloudsGlyph },
  // ── Pack 5 — Symbols & Trades ──
  { id: 'square',         label: 'Square & Compass',pack: 'trades', Glyph: SquareGlyph },
  { id: 'anvil',          label: 'Anvil',           pack: 'trades', Glyph: AnvilGlyph },
  { id: 'wheel',          label: "Ship's Wheel",    pack: 'trades', Glyph: WheelGlyph },
  { id: 'quill',          label: 'Quill & Ink',     pack: 'trades', Glyph: QuillGlyph },
  { id: 'lyre',           label: 'Lyre',            pack: 'trades', Glyph: LyreGlyph },
  { id: 'scales',         label: 'Scales',          pack: 'trades', Glyph: ScalesGlyph },
  { id: 'caduceus',       label: 'Caduceus',        pack: 'trades', Glyph: CaduceusGlyph },
  { id: 'gear',           label: 'Gear',            pack: 'trades', Glyph: GearGlyph },
  { id: 'torch',          label: 'Torch',           pack: 'trades', Glyph: TorchGlyph },
  { id: 'sword',          label: 'Sword',           pack: 'trades', Glyph: SwordGlyph },
  { id: 'medal',          label: 'Laurel Medal',    pack: 'trades', Glyph: MedalGlyph },
  { id: 'pick',           label: 'Pick & Shovel',   pack: 'trades', Glyph: PickGlyph },
  { id: 'hammer',         label: 'Hammer & Spanner',pack: 'trades', Glyph: HammerGlyph },
  { id: 'palette',        label: 'Palette',         pack: 'trades', Glyph: PaletteGlyph },
  { id: 'key',            label: 'Crossed Keys',    pack: 'trades', Glyph: KeyGlyph },
  { id: 'bell',           label: 'Bell',            pack: 'trades', Glyph: BellGlyph },
  { id: 'plow',           label: 'Plough',          pack: 'trades', Glyph: PlowGlyph },
  { id: 'shield',         label: 'Shield',          pack: 'trades', Glyph: ShieldGlyph },
  { id: 'clasped',        label: 'Clasped Hands',   pack: 'trades', Glyph: ClaspedGlyph },
  { id: 'horseshoe',      label: 'Horseshoe',       pack: 'trades', Glyph: HorseshoeGlyph },
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
