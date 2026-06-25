import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import { colors } from './theme';
import type { AgaMode } from '../aga/turn';

type Props = {
  mode: AgaMode;
  /** Approximate level from interim speech / TTS state. True waveform sync can be added later with native audio metering. */
  audioLevel?: number;
  /** When media is open, the avatar tucks into a smaller footprint. */
  compact?: boolean;
  size?: number;
};

function clamp01(value: number) {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function accentFor(mode: AgaMode) {
  switch (mode) {
    case 'listening':
    case 'awake':
      return colors.cyan;
    case 'thinking':
    case 'recovering':
      return colors.lavender;
    case 'speaking':
      return colors.gold;
    case 'translating':
      return colors.pink;
    case 'media':
      return colors.violet;
    case 'offline':
      return colors.danger;
    default:
      return 'rgba(191, 247, 255, 0.85)';
  }
}

export function AgaAvatarZen({ mode, audioLevel = 0, compact, size: requestedSize }: Props) {
  const breathe = useRef(new Animated.Value(0)).current;
  const halo = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;
  const blink = useRef(new Animated.Value(1)).current;
  const mouth = useRef(new Animated.Value(0)).current;
  const wing = useRef(new Animated.Value(0)).current;
  const level = useRef(new Animated.Value(0)).current;

  const accent = useMemo(() => accentFor(mode), [mode]);
  const isLive = mode === 'listening' || mode === 'awake' || mode === 'thinking' || mode === 'translating';
  const size = requestedSize ?? (compact ? 132 : 208);

  useEffect(() => {
    Animated.timing(level, {
      toValue: clamp01(audioLevel),
      duration: 120,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [audioLevel, level]);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breathe, { toValue: 1, duration: 2600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(breathe, { toValue: 0, duration: 2600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [breathe]);

  useEffect(() => {
    halo.setValue(0);
    const loop = Animated.loop(
      Animated.timing(halo, {
        toValue: 1,
        duration: isLive ? 5200 : 9000,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [halo, isLive]);

  useEffect(() => {
    pulse.setValue(0);
    const loop = Animated.loop(
      Animated.timing(pulse, {
        toValue: 1,
        duration: mode === 'sleeping' ? 4200 : 2200,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, mode]);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      timer = setTimeout(() => {
        if (!alive) return;
        Animated.sequence([
          Animated.timing(blink, { toValue: 0.08, duration: 90, useNativeDriver: true }),
          Animated.timing(blink, { toValue: 1, duration: 120, useNativeDriver: true }),
        ]).start(() => alive && schedule());
      }, 2600 + Math.random() * 3600);
    };
    schedule();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [blink]);

  useEffect(() => {
    if (mode === 'speaking') {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(mouth, { toValue: 1, duration: 130 + Math.random() * 70, easing: Easing.out(Easing.quad), useNativeDriver: true }),
          Animated.timing(mouth, { toValue: 0.25, duration: 110 + Math.random() * 90, easing: Easing.in(Easing.quad), useNativeDriver: true }),
        ]),
      );
      loop.start();
      return () => loop.stop();
    }
    Animated.timing(mouth, {
      toValue: mode === 'listening' || mode === 'awake' ? 0.45 : 0.12,
      duration: 260,
      useNativeDriver: true,
    }).start();
  }, [mode, mouth]);

  useEffect(() => {
    if (!(mode === 'listening' || mode === 'awake' || mode === 'translating')) {
      wing.stopAnimation(() => wing.setValue(0));
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(wing, { toValue: 1, duration: 650, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(wing, { toValue: 0, duration: 650, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [mode, wing]);

  const scale = breathe.interpolate({ inputRange: [0, 1], outputRange: [1, 1.03] });
  const levelScale = level.interpolate({ inputRange: [0, 1], outputRange: [1, 1.045] });
  const haloSpin = halo.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const pulseScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1.55] });
  const pulseOpacity = pulse.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.42, 0.2, 0] });
  const mouthScaleY = Animated.add(mouth, level).interpolate({ inputRange: [0, 0.5, 1, 2], outputRange: [0.3, 0.72, 1.35, 1.52] });
  const leftWingLift = wing.interpolate({ inputRange: [0, 1], outputRange: ['-20deg', '-12deg'] });
  const rightWingLift = wing.interpolate({ inputRange: [0, 1], outputRange: ['20deg', '12deg'] });

  return (
    <View style={[styles.stage, { width: size + 96, height: size + 96 }]} pointerEvents="none">
      <Animated.View
        style={[
          styles.glowRing,
          {
            width: size,
            height: size,
            borderRadius: size,
            borderColor: accent,
            transform: [{ scale: pulseScale }],
            opacity: pulseOpacity,
          },
        ]}
      />
      <View style={[styles.aura, { width: size * 1.12, height: size * 1.12, borderRadius: size, shadowColor: accent }]} />

      <Animated.View
        style={[
          styles.halo,
          {
            width: size * 0.62,
            height: size * 0.18,
            borderColor: mode === 'speaking' ? colors.gold : accent,
            top: size * 0.04,
            opacity: mode === 'sleeping' ? 0.58 : 0.84,
            transform: [{ rotate: haloSpin }],
          },
        ]}
      />

      <Animated.View style={[styles.wing, styles.leftWing, { width: size * 0.42, height: size * 0.7, left: size * 0.02, transform: [{ rotate: leftWingLift }] }]} />
      <Animated.View style={[styles.wing, styles.rightWing, { width: size * 0.42, height: size * 0.7, right: size * 0.02, transform: [{ rotate: rightWingLift }] }]} />

      <Animated.View
        style={[
          styles.face,
          {
            width: size,
            height: size,
            borderRadius: size,
            shadowColor: accent,
            transform: [{ scale }, { scale: levelScale }],
          },
        ]}
      >
        <View style={styles.innerLight} />
        <View style={[styles.cheek, { left: size * 0.18, bottom: size * 0.28 }]} />
        <View style={[styles.cheek, { right: size * 0.18, bottom: size * 0.28 }]} />

        <View style={[styles.eyesRow, { gap: size * 0.18, marginTop: size * 0.1 }]}>
          <Animated.View style={[styles.eye, { width: size * 0.1, height: size * 0.13, transform: [{ scaleY: blink }] }]} />
          <Animated.View style={[styles.eye, { width: size * 0.1, height: size * 0.13, transform: [{ scaleY: blink }] }]} />
        </View>

        <Animated.View
          style={[
            styles.mouth,
            {
              width: size * 0.16,
              height: size * 0.07,
              marginTop: size * 0.14,
              backgroundColor: accent,
              transform: [{ scaleY: mouthScaleY }],
            },
          ]}
        />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  stage: { alignItems: 'center', justifyContent: 'center' },
  glowRing: { position: 'absolute', borderWidth: 2 },
  aura: {
    position: 'absolute',
    backgroundColor: 'transparent',
    shadowOpacity: 0.55,
    shadowRadius: 40,
    shadowOffset: { width: 0, height: 0 },
  },
  halo: { position: 'absolute', borderWidth: 4, borderRadius: 999 },
  wing: {
    position: 'absolute',
    backgroundColor: 'rgba(255,255,255,0.16)',
    borderRadius: 90,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  leftWing: {},
  rightWing: {},
  face: {
    backgroundColor: '#bff7ff',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.7)',
    shadowOpacity: 0.5,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 12 },
    overflow: 'hidden',
  },
  innerLight: { position: 'absolute', width: '78%', height: '78%', borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.14)' },
  cheek: { position: 'absolute', width: 26, height: 15, borderRadius: 14, backgroundColor: 'rgba(249,168,212,0.42)' },
  eyesRow: { flexDirection: 'row', alignItems: 'center' },
  eye: { borderRadius: 999, backgroundColor: '#172033' },
  mouth: { borderRadius: 999 },
});

export default AgaAvatarZen;
