import React, { useEffect, useRef } from 'react';
import { Animated } from 'react-native';
import Svg, { Defs, LinearGradient, Stop, Rect, Path, Line } from 'react-native-svg';

export default function GravestoneLogo({ size = 200 }) {
  const opacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const flicker = Animated.loop(
      Animated.sequence([
        Animated.delay(200),
        Animated.timing(opacity, { toValue: 0.15, duration: 40, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1,    duration: 40, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.4,  duration: 40, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1,    duration: 40, useNativeDriver: true }),
        Animated.delay(600),
        Animated.timing(opacity, { toValue: 0.1,  duration: 30, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1,    duration: 30, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.05, duration: 30, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1,    duration: 30, useNativeDriver: true }),
        Animated.delay(500),
        Animated.timing(opacity, { toValue: 0.2,  duration: 35, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1,    duration: 35, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 0.1,  duration: 35, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1,    duration: 35, useNativeDriver: true }),
        Animated.delay(400),
      ])
    );
    flicker.start();
    return () => flicker.stop();
  }, []);

  const h = size * 1.12;

  return (
    <Animated.View style={{ opacity }}>
      <Svg width={size} height={h} viewBox="0 0 100 112" fill="none" strokeWidth={1.5}>
        <Defs>
          <LinearGradient id="grad" x1="0%" y1="0%" x2="0%" y2="100%">
            <Stop offset="0%" stopColor="#e8d4a0" />
            <Stop offset="100%" stopColor="#8a6f3a" />
          </LinearGradient>
        </Defs>

        {/* Base ledger */}
        <Rect x="22" y="84" width="56" height="6" stroke="url(#grad)" fill="none" />

        {/* Tablet outline */}
        <Path d="M30 84 L30 35 Q30 18 50 18 Q70 18 70 35 L70 84 Z" stroke="url(#grad)" fill="none" />

        {/* Inner inscription border */}
        <Path d="M36 80 L36 38 Q36 24 50 24 Q64 24 64 38 L64 80" stroke="url(#grad)" strokeOpacity={0.4} fill="none" />

        {/* Left book page */}
        <Path d="M38 40 L38 56 Q44 54 49 56 L49 42 Q44 40 38 40 Z" stroke="url(#grad)" strokeWidth={1.8} fill="rgba(180,145,80,0.18)" />

        {/* Right book page */}
        <Path d="M51 42 Q56 40 62 40 L62 56 Q56 54 51 56 Z" stroke="url(#grad)" strokeWidth={1.8} fill="rgba(180,145,80,0.18)" />

        {/* Book spine */}
        <Line x1="50" y1="41" x2="50" y2="56" stroke="url(#grad)" strokeWidth={1.2} strokeOpacity={0.7} />

        {/* Left page lines */}
        <Line x1="40" y1="44" x2="47" y2="44" stroke="url(#grad)" strokeWidth={0.8} strokeOpacity={0.5} />
        <Line x1="40" y1="47" x2="47" y2="47" stroke="url(#grad)" strokeWidth={0.8} strokeOpacity={0.45} />
        <Line x1="40" y1="50" x2="47" y2="50" stroke="url(#grad)" strokeWidth={0.8} strokeOpacity={0.4} />

        {/* Right page lines */}
        <Line x1="53" y1="44" x2="60" y2="44" stroke="url(#grad)" strokeWidth={0.8} strokeOpacity={0.5} />
        <Line x1="53" y1="47" x2="60" y2="47" stroke="url(#grad)" strokeWidth={0.8} strokeOpacity={0.45} />
        <Line x1="53" y1="50" x2="60" y2="50" stroke="url(#grad)" strokeWidth={0.8} strokeOpacity={0.4} />

        {/* Ground line */}
        <Line x1="18" y1="92" x2="82" y2="92" stroke="url(#grad)" strokeOpacity={0.5} />
      </Svg>
    </Animated.View>
  );
}
