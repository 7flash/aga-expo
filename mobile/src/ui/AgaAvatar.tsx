import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import { colors } from './theme';
import type { AgaMode } from '../aga/actions';

export function AgaAvatar({ mode }: { mode: AgaMode }) {
  const breathe = useRef(new Animated.Value(0)).current;
  const mouth = useRef(new Animated.Value(0)).current;
  const halo = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breathe, { toValue: 1, duration: 2600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(breathe, { toValue: 0, duration: 2600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [breathe]);

  useEffect(() => {
    const haloLoop = Animated.loop(
      Animated.timing(halo, { toValue: 1, duration: mode === 'listening' ? 900 : 1800, easing: Easing.linear, useNativeDriver: true })
    );
    halo.setValue(0);
    haloLoop.start();
    return () => haloLoop.stop();
  }, [halo, mode]);

  useEffect(() => {
    if (mode !== 'speaking') {
      Animated.timing(mouth, { toValue: 0, duration: 180, useNativeDriver: true }).start();
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(mouth, { toValue: 1, duration: 170, useNativeDriver: true }),
        Animated.timing(mouth, { toValue: 0.2, duration: 130, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [mode, mouth]);

  const scale = breathe.interpolate({ inputRange: [0, 1], outputRange: [1, 1.025] });
  const mouthScale = mouth.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1.25] });
  const haloSpin = halo.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  return (
    <View style={styles.wrap} pointerEvents="none">
      <Animated.View style={[styles.halo, { transform: [{ rotate: haloSpin }] }]} />
      <View style={styles.wingsRow}>
        <View style={[styles.wing, styles.leftWing]} />
        <Animated.View style={[styles.face, { transform: [{ scale }] }]}>
          <View style={styles.antenna}><View style={styles.antennaDot} /></View>
          <View style={styles.eyesRow}>
            <View style={styles.eye}><View style={styles.pupil} /></View>
            <View style={styles.eye}><View style={styles.pupil} /></View>
          </View>
          <Animated.View style={[styles.mouth, { transform: [{ scaleY: mouthScale }] }]} />
          <Text style={styles.mode}>{mode === 'sleeping' ? 'Listening for wake phrase' : mode}</Text>
        </Animated.View>
        <View style={[styles.wing, styles.rightWing]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center', paddingTop: 24, paddingBottom: 6 },
  halo: { width: 126, height: 34, borderRadius: 999, borderWidth: 4, borderColor: colors.gold, opacity: 0.72, marginBottom: -6 },
  wingsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  wing: { width: 82, height: 132, backgroundColor: 'rgba(255,255,255,0.18)', borderRadius: 80, borderWidth: 1, borderColor: 'rgba(255,255,255,0.34)' },
  leftWing: { transform: [{ rotate: '-18deg' }], marginRight: -14 },
  rightWing: { transform: [{ rotate: '18deg' }], marginLeft: -14 },
  face: { width: 196, height: 196, borderRadius: 98, backgroundColor: '#bff7ff', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: 'rgba(255,255,255,0.78)', shadowColor: colors.cyan, shadowOpacity: 0.4, shadowRadius: 28 },
  antenna: { position: 'absolute', top: -45, width: 12, height: 48, backgroundColor: '#dbeafe', borderRadius: 999, alignItems: 'center' },
  antennaDot: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.gold, marginTop: -18 },
  eyesRow: { flexDirection: 'row', gap: 34, marginTop: 24 },
  eye: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.58)', alignItems: 'center', justifyContent: 'center' },
  pupil: { width: 18, height: 18, borderRadius: 9, backgroundColor: '#172033' },
  mouth: { width: 34, height: 12, borderRadius: 8, backgroundColor: colors.violet, marginTop: 24 },
  mode: { color: '#0f172a', fontWeight: '800', fontSize: 10, opacity: 0.48, marginTop: 12, textTransform: 'uppercase', letterSpacing: 1.4 },
});
