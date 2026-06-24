import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import type { AgaState } from '../aga/stateMachine';
import type { Persona } from '../aga/personas';

export function AgaAvatar({ state, persona }: { state: AgaState; persona: Persona }) {
  const breathe = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;

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
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: state === 'speaking' ? 360 : 900, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: state === 'speaking' ? 360 : 900, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, state]);

  const scale = Animated.add(1, breathe.interpolate({ inputRange: [0, 1], outputRange: [0, state === 'speaking' ? 0.045 : 0.018] }));
  const mouthScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [state === 'speaking' ? 0.8 : 0.22, state === 'speaking' ? 1.8 : 0.5] });
  const ringScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, state === 'listening' || state === 'wake_confirmed' ? 1.12 : 1.04] });
  const opacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.3, 0.75] });

  return (
    <View style={styles.wrap}>
      <Animated.View style={[styles.halo, { borderColor: persona.hue, opacity, transform: [{ scale: ringScale }] }]} />
      <Animated.View style={[styles.avatar, { transform: [{ scale }] }]}>
        <View style={[styles.antenna, { backgroundColor: persona.hue }]} />
        <View style={[styles.antennaTip, { backgroundColor: persona.hue }]} />
        <View style={styles.face}>
          <View style={styles.eyeRow}>
            <View style={[styles.eye, (state === 'listening' || state === 'wake_confirmed') && styles.eyeWide]} />
            <View style={[styles.eye, (state === 'listening' || state === 'wake_confirmed') && styles.eyeWide]} />
          </View>
          <Animated.View style={[styles.mouth, { backgroundColor: persona.hue, transform: [{ scaleY: mouthScale }] }]} />
        </View>
        <Text style={styles.monogram}>AGA</Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { height: 250, alignItems: 'center', justifyContent: 'center' },
  halo: { position: 'absolute', top: 12, width: 126, height: 34, borderRadius: 999, borderWidth: 2, transform: [{ rotateX: '64deg' }] },
  avatar: {
    width: 180,
    height: 200,
    borderRadius: 70,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(191,248,255,0.20)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.28)',
    shadowColor: '#67e8f9',
    shadowOpacity: 0.35,
    shadowRadius: 28,
  },
  antenna: { position: 'absolute', top: -26, width: 8, height: 34, borderRadius: 999 },
  antennaTip: { position: 'absolute', top: -42, width: 24, height: 24, borderRadius: 24 },
  face: { width: 120, height: 96, borderRadius: 42, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(224,242,254,0.86)' },
  eyeRow: { flexDirection: 'row', gap: 28, marginBottom: 18 },
  eye: { width: 15, height: 15, borderRadius: 15, backgroundColor: '#0f172a' },
  eyeWide: { width: 18, height: 18, borderRadius: 18 },
  mouth: { width: 34, height: 8, borderRadius: 999 },
  monogram: { position: 'absolute', bottom: 20, color: '#fef3c7', fontSize: 12, fontWeight: '900', letterSpacing: 2 },
});
