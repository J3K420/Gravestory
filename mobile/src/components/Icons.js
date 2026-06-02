import React from 'react';
import Svg, { Path, Circle, Line, Rect } from 'react-native-svg';
import { colors } from '../lib/theme';

export function CandleMark({ size = 22, color = colors.flame }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M12 3c-1.1 0-2 .9-2 2 0 1.5 2 3 2 3s2-1.5 2-3c0-1.1-.9-2-2-2z" fill={color} />
      <Path d="M9 10h6v9a3 3 0 0 1-3 3 3 3 0 0 1-3-3z" stroke={color} strokeWidth={1.6} />
    </Svg>
  );
}

export function Headstone({ size = 22, color = colors.ash }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 64 64" fill="none">
      <Path d="M18 56V26a14 14 0 0 1 28 0v30z" fill={colors.stone2} stroke={color} strokeWidth={1.4} />
      <Line x1="26" y1="34" x2="38" y2="34" stroke={color} strokeWidth={1.4} />
      <Line x1="24" y1="41" x2="40" y2="41" stroke={color} strokeWidth={1.4} />
      <Line x1="27" y1="48" x2="37" y2="48" stroke={color} strokeWidth={1.4} />
      <Line x1="14" y1="56" x2="50" y2="56" stroke={color} strokeWidth={2} />
    </Svg>
  );
}

export function MapStack({ size = 22, color = colors.flame }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2z" stroke={color} strokeWidth={1.6} />
      <Path d="M9 4v14M15 6v14" stroke={color} strokeWidth={1.6} />
    </Svg>
  );
}

export function Globe({ size = 22, color = colors.flame }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx="12" cy="12" r="9" stroke={color} strokeWidth={1.6} />
      <Path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" stroke={color} strokeWidth={1.6} />
    </Svg>
  );
}

export function ShareIcon({ size = 22, color = colors.flame }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx="6" cy="12" r="2.5" stroke={color} strokeWidth={1.6} />
      <Circle cx="18" cy="6" r="2.5" stroke={color} strokeWidth={1.6} />
      <Circle cx="18" cy="18" r="2.5" stroke={color} strokeWidth={1.6} />
      <Path d="m8 11 8-4M8 13l8 4" stroke={color} strokeWidth={1.6} />
    </Svg>
  );
}

export function Pin({ size = 18, color = colors.flame }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path d="M12 2C8 2 5 5 5 9c0 5 7 13 7 13s7-8 7-13c0-4-3-7-7-7z" fill={color} />
      <Circle cx="12" cy="9" r="2.5" fill={colors.stone} />
    </Svg>
  );
}
