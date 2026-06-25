import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { colors } from './theme';
import type { AgaMode } from '../aga/turn';

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

export function AgaAvatarZen({ mode, audioLevel = 0, size = 260 }: { mode: AgaMode; audioLevel?: number; size?: number }) {
  const breathe = useRef(new Animated.Value(0)).current;
  const thinking = useRef(new Animated.Value(0)).current;
  const wing = useRef(new Animated.Value(0)).current;
  const mouth = useRef(new Animated.Value(0)).current;
  const level = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(level, {
      toValue: clamp01(audioLevel),
      duration: 120,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [audioLevel, level]);

  useEffect(() => {
    const breathingLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(breathe, { toValue: 1, duration: 2600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(breathe, { toValue: 0, duration: 2600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])
    );
    breathingLoop.start();
    return () => breathingLoop.stop();
  }, [breathe]);

  useEffect(() => {
    const thinkingLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(thinking, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(thinking, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])
    );
    const wingLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(wing, { toValue: 1, duration: 560, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(wing, { toValue: 0, duration: 560, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])
    );
    const mouthLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(mouth, { toValue: 1, duration: 130, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(mouth, { toValue: 0, duration: 180, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      ])
    );

    if (mode === 'thinking' || mode === 'recovering') thinkingLoop.start();
    else thinking.stopAnimation(() => thinking.setValue(0));

    if (mode === 'listening' || mode === 'awake' || mode === 'translating') wingLoop.start();
    else wing.stopAnimation(() => wing.setValue(0));

    if (mode === 'speaking') mouthLoop.start();
    else mouth.stopAnimation(() => mouth.setValue(0));

    return () => {
      thinkingLoop.stop();
      wingLoop.stop();
      mouthLoop.stop();
    };
  }, [mode, thinking, wing, mouth]);

  const palette = useMemo(() => {
    if (mode === 'speaking') return { halo: colors.gold, glow: colors.gold, label: 'speaking' };
    if (mode === 'thinking' || mode === 'recovering') return { halo: colors.lavender, glow: colors.lavender, label: 'thinking' };
    if (mode === 'media') return { halo: colors.pink, glow: colors.pink, label: 'media' };
    if (mode === 'listening' || mode === 'awake' || mode === 'translating') return { halo: colors.cyan, glow: colors.cyan, label: 'listening' };
    return { halo: 'rgba(254,243,199,0.72)', glow: colors.cyan, label: 'dreaming' };
  }, [mode]);

  const baseScale = breathe.interpolate({ inputRange: [0, 1], outputRange: [1, 1.025] });
  const liveScale = level.interpolate({ inputRange: [0, 1], outputRange: [1, 1.06] });
  const thinkingScale = thinking.interpolate({ inputRange: [0, 1], outputRange: [1, 1.045] });
  const haloOpacity = level.interpolate({ inputRange: [0, 1], outputRange: [0.58, 1] });
  const mouthScale = Animated.add(mouth, level).interpolate({ inputRange: [0, 0.5, 1, 2], outputRange: [0.25, 0.8, 1.25, 1.45] });
  const leftWingLift = wing.interpolate({ inputRange: [0, 1], outputRange: ['-6deg', '8deg'] });
  const rightWingLift = wing.interpolate({ inputRange: [0, 1], outputRange: ['6deg', '-8deg'] });
  const faceSize = size * 0.68;

  return (
    <View style={[styles.stage, { width: size, height: size * 0.95 }]}> 
      <Animated.View
        style={[
          styles.halo,
          {
            width: size * 0.46,
            height: size * 0.12,
            borderColor: palette.halo,
            opacity: mode === 'sleeping' ? 0.5 : haloOpacity,
            transform: [{ scale: thinkingScale }],
          },
        ]}
      />
      <View style={styles.wingsRow}>
        <Animated.View style={[styles.wing, styles.leftWing, { transform: [{ rotate: leftWingLift }] }]} />
        <Animated.View
          style={[
            styles.face,
            {
              width: faceSize,
              height: faceSize,
              borderRadius: faceSize / 2,
              shadowColor: palette.glow,
              transform: [{ scale: baseScale }, { scale: liveScale }, { scale: thinkingScale }],
            },
          ]}
        >
          <View style={styles.innerLight} />
          <View style={styles.eyesRow}>
            <View style={[styles.eye, (mode === 'listening' || mode === 'awake') && styles.eyeLive]}><View style={styles.pupil} /></View>
            <View style={[styles.eye, (mode === 'listening' || mode === 'awake') && styles.eyeLive]}><View style={styles.pupil} /></View>
          </View>
          <Animated.View style={[styles.mouth, { transform: [{ scaleY: mouthScale }] }]} />
          <Text style={styles.mode}>{palette.label}</Text>
        </Animated.View>
        <Animated.View style={[styles.wing, styles.rightWing, { transform: [{ rotate: rightWingLift }] }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  stage: { alignItems: 'center', justifyContent: 'center' },
  halo: { borderRadius: 999, borderWidth: 5, marginBottom: -6, shadowOpacity: 0.65, shadowRadius: 18 },
  wingsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  wing: { width: 86, height: 136, backgroundColor: 'rgba(255,255,255,0.16)', borderRadius: 80, borderWidth: 1, borderColor: 'rgba(255,255,255,0.30)' },
  leftWing: { marginRight: -24 },
  rightWing: { marginLeft: -24 },
  face: { backgroundColor: '#bff7ff', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'rgba(255,255,255,0.78)', shadowOpacity: 0.48, shadowRadius: 30, shadowOffset: { width: 0, height: 14 }, overflow: 'hidden' },
  innerLight: { position: 'absolute', width: '78%', height: '78%', borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.15)' },
  eyesRow: { flexDirection: 'row', gap: 32, marginTop: 20 },
  eye: { width: 40, height: 40, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.58)', alignItems: 'center', justifyContent: 'center' },
  eyeLive: { transform: [{ scale: 1.07 }], backgroundColor: 'rgba(255,255,255,0.72)' },
  pupil: { width: 16, height: 16, borderRadius: 8, backgroundColor: '#172033' },
  mouth: { width: 34, height: 12, borderRadius: 8, backgroundColor: colors.violet, marginTop: 22 },
  mode: { color: '#0f172a', fontWeight: '900', fontSize: 10, opacity: 0.44, marginTop: 12, textTransform: 'uppercase', letterSpacing: 1.4 },
});
