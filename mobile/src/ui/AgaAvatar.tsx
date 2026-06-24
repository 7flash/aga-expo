import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, StyleSheet, Text, View } from 'react-native';
import type { AgaState } from '../aga/stateMachine';
import type { Persona } from '../aga/personas';

function moodLabel(state: AgaState) {
  switch (state) {
    case 'listening':
    case 'wake_confirmed': return 'leaning in';
    case 'thinking': return 'thinking';
    case 'speaking': return 'speaking';
    case 'playing_media': return 'music glow';
    case 'translating': return 'interpreter';
    case 'recovering': return 'self repair';
    case 'offline': return 'offline';
    default: return 'soft idle';
  }
}

export function AgaAvatar({ state, persona }: { state: AgaState; persona: Persona }) {
  const breathe = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;
  const tilt = useRef(new Animated.Value(0)).current;
  const sparkle = useRef(new Animated.Value(0)).current;
  const speechEnvelope = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breathe, { toValue: 1, duration: state === 'recovering' ? 900 : 2600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(breathe, { toValue: 0, duration: state === 'recovering' ? 900 : 2600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [breathe, state]);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: state === 'speaking' ? 280 : state === 'playing_media' ? 460 : 850, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: state === 'speaking' ? 280 : state === 'playing_media' ? 460 : 850, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, state]);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(tilt, { toValue: 1, duration: 3400, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(tilt, { toValue: -1, duration: 3400, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(tilt, { toValue: 0, duration: 2200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [tilt]);


  useEffect(() => {
    if (state !== 'speaking') {
      speechEnvelope.stopAnimation();
      Animated.timing(speechEnvelope, { toValue: 0, duration: 180, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
      return;
    }

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(speechEnvelope, { toValue: 1, duration: 120, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(speechEnvelope, { toValue: 0.32, duration: 95, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(speechEnvelope, { toValue: 0.78, duration: 150, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(speechEnvelope, { toValue: 0.12, duration: 130, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [speechEnvelope, state]);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(sparkle, { toValue: 1, duration: 1200, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(sparkle, { toValue: 0, duration: 1200, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [sparkle]);

  const stateStyle = useMemo(() => {
    if (state === 'offline') return styles.avatarOffline;
    if (state === 'recovering') return styles.avatarRecovering;
    if (state === 'translating') return styles.avatarTranslating;
    if (state === 'playing_media') return styles.avatarMedia;
    return null;
  }, [state]);

  const scale = Animated.add(1, breathe.interpolate({ inputRange: [0, 1], outputRange: [0, state === 'speaking' ? 0.045 : 0.018] }));
  const mouthDriver = state === 'speaking' ? speechEnvelope : pulse;
  const mouthScale = mouthDriver.interpolate({ inputRange: [0, 1], outputRange: [state === 'speaking' ? 0.42 : 0.22, state === 'speaking' ? 2.25 : state === 'thinking' ? 1.0 : 0.55] });
  const ringScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, state === 'listening' || state === 'wake_confirmed' ? 1.18 : state === 'playing_media' ? 1.1 : 1.04] });
  const opacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.25, state === 'offline' ? 0.35 : 0.85] });
  const rotate = tilt.interpolate({ inputRange: [-1, 1], outputRange: ['-3deg', '3deg'] });
  const sparkleScale = sparkle.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1.25] });

  return (
    <View style={styles.wrap}>
      <Animated.View style={[styles.halo, { borderColor: persona.hue, opacity, transform: [{ scale: ringScale }] }]} />
      <Animated.View style={[styles.orb, styles.orbLeft, { backgroundColor: persona.hue, opacity, transform: [{ scale: sparkleScale }] }]} />
      <Animated.View style={[styles.orb, styles.orbRight, { backgroundColor: persona.hue, opacity, transform: [{ scale: sparkleScale }] }]} />
      <Animated.View style={[styles.avatar, stateStyle, { transform: [{ scale }, { rotate }] }]}> 
        <View style={[styles.antenna, { backgroundColor: persona.hue }]} />
        <Animated.View style={[styles.antennaTip, { backgroundColor: persona.hue, opacity }]} />
        <View style={styles.face}>
          <View style={styles.eyeRow}>
            <View style={[styles.eye, (state === 'listening' || state === 'wake_confirmed') && styles.eyeWide, state === 'thinking' && styles.eyeThinking]} />
            <View style={[styles.eye, (state === 'listening' || state === 'wake_confirmed') && styles.eyeWide, state === 'thinking' && styles.eyeThinking]} />
          </View>
          <Animated.View style={[styles.mouth, { backgroundColor: persona.hue, transform: [{ scaleY: mouthScale }] }]} />
        </View>
        <Text style={styles.monogram}>AGA</Text>
        <Text style={styles.mood}>{moodLabel(state)}</Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { height: 270, alignItems: 'center', justifyContent: 'center' },
  halo: { position: 'absolute', top: 10, width: 136, height: 36, borderRadius: 999, borderWidth: 2, transform: [{ rotateX: '64deg' }] },
  orb: { position: 'absolute', width: 18, height: 18, borderRadius: 18, shadowColor: '#fff', shadowOpacity: 0.5, shadowRadius: 16 },
  orbLeft: { left: 82, top: 82 },
  orbRight: { right: 82, bottom: 86 },
  avatar: {
    width: 190,
    height: 212,
    borderRadius: 74,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(191,248,255,0.20)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.28)',
    shadowColor: '#67e8f9',
    shadowOpacity: 0.35,
    shadowRadius: 28,
  },
  avatarMedia: { backgroundColor: 'rgba(167,139,250,0.23)' },
  avatarTranslating: { backgroundColor: 'rgba(103,232,249,0.16)', borderColor: 'rgba(254,243,199,0.5)' },
  avatarRecovering: { backgroundColor: 'rgba(251,113,133,0.14)', borderColor: 'rgba(251,113,133,0.42)' },
  avatarOffline: { opacity: 0.72, backgroundColor: 'rgba(148,163,184,0.12)' },
  antenna: { position: 'absolute', top: -26, width: 8, height: 34, borderRadius: 999 },
  antennaTip: { position: 'absolute', top: -42, width: 24, height: 24, borderRadius: 24 },
  face: { width: 124, height: 98, borderRadius: 42, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(224,242,254,0.86)' },
  eyeRow: { flexDirection: 'row', gap: 28, marginBottom: 18 },
  eye: { width: 15, height: 15, borderRadius: 15, backgroundColor: '#0f172a' },
  eyeWide: { width: 18, height: 18, borderRadius: 18 },
  eyeThinking: { height: 9, borderRadius: 9 },
  mouth: { width: 34, height: 8, borderRadius: 999 },
  monogram: { position: 'absolute', bottom: 25, color: '#fef3c7', fontSize: 12, fontWeight: '900', letterSpacing: 2 },
  mood: { position: 'absolute', bottom: 9, color: 'rgba(248,251,255,0.64)', fontSize: 9, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 1.1 },
});
