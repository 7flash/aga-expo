import React, { memo, useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import type { AgaMode } from '../aga/turn';

type Props = {
  mode: AgaMode;
  audioLevel?: number;
  compact?: boolean;
  lowPower?: boolean;
};

function modeIntensity(mode: AgaMode) {
  if (mode === 'speaking') return 1;
  if (mode === 'thinking' || mode === 'recovering') return 0.75;
  if (mode === 'media' || mode === 'translating') return 0.66;
  if (mode === 'listening' || mode === 'awake') return 0.5;
  return 0.32;
}

export const HologramEnvironment = memo(function HologramEnvironment({ mode, audioLevel = 0, compact, lowPower }: Props) {
  const breathe = useRef(new Animated.Value(0)).current;
  const drift = useRef(new Animated.Value(0)).current;
  const intensity = Math.min(1, modeIntensity(mode) + Math.max(0, Math.min(1, audioLevel)) * 0.28);
  const particleCount = lowPower ? 4 : compact ? 7 : 12;

  useEffect(() => {
    const loop = Animated.parallel([
      Animated.loop(Animated.sequence([
        Animated.timing(breathe, { toValue: 1, duration: 5200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(breathe, { toValue: 0, duration: 5200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])),
      Animated.loop(Animated.timing(drift, { toValue: 1, duration: 26000, easing: Easing.linear, useNativeDriver: true })),
    ]);
    loop.start();
    return () => loop.stop();
  }, [breathe, drift]);

  const scale = breathe.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1.045] });
  const scanY = drift.interpolate({ inputRange: [0, 1], outputRange: [-90, 90] });
  const rotate = drift.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <Animated.View style={[styles.nebula, { opacity: 0.16 + intensity * 0.22, transform: [{ scale }] }]} />
      <Animated.View style={[styles.scan, { opacity: lowPower ? 0.08 : 0.16, transform: [{ translateY: scanY }] }]} />
      <Animated.View style={[styles.parallaxRing, { opacity: 0.14 + intensity * 0.18, transform: [{ rotate }] }]} />
      {Array.from({ length: particleCount }).map((_, index) => {
        const left = `${8 + ((index * 17) % 84)}%`;
        const top = `${12 + ((index * 29) % 72)}%`;
        const size = 2 + (index % 4);
        const localScale = breathe.interpolate({ inputRange: [0, 1], outputRange: [0.72 + index * 0.012, 1.18 + index * 0.012] });
        return <Animated.View key={index} style={[styles.particle, { left, top, width: size, height: size, opacity: 0.22 + intensity * 0.48, transform: [{ scale: localScale }] }]} />;
      })}
      <View style={styles.vignette} />
    </View>
  );
});

const styles = StyleSheet.create({
  nebula: {
    position: 'absolute',
    left: '8%',
    right: '8%',
    top: '10%',
    bottom: '10%',
    borderRadius: 999,
    backgroundColor: 'rgba(103,232,249,0.18)',
    shadowColor: '#67e8f9',
    shadowOpacity: 0.72,
    shadowRadius: 58,
  },
  scan: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: '48%',
    height: 2,
    backgroundColor: 'rgba(226,255,255,0.72)',
    shadowColor: '#ecfeff',
    shadowOpacity: 0.8,
    shadowRadius: 18,
  },
  parallaxRing: {
    position: 'absolute',
    left: '18%',
    right: '18%',
    top: '17%',
    bottom: '17%',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(103,232,249,0.26)',
  },
  particle: {
    position: 'absolute',
    borderRadius: 99,
    backgroundColor: 'rgba(236,254,255,0.9)',
    shadowColor: '#a5f3fc',
    shadowOpacity: 0.9,
    shadowRadius: 10,
  },
  vignette: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(103,232,249,0.08)',
  },
});
