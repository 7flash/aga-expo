import React, { useEffect, useMemo, useRef } from "react";
import { Animated, Easing, StyleSheet, View } from "react-native";
import { colors } from "./theme";
import type { AgaMode } from "../aga/turn";

type Props = {
  mode: AgaMode;
  audioLevel?: number;
  compact?: boolean;
  size?: number;
};

function clamp01(value: number) {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function accentFor(mode: AgaMode) {
  switch (mode) {
    case "listening":
    case "awake":
      return colors.cyan;
    case "thinking":
    case "recovering":
      return colors.lavender;
    case "speaking":
      return colors.gold;
    case "translating":
      return colors.pink;
    case "media":
      return colors.violet;
    case "offline":
      return colors.danger;
    default:
      return "rgba(191,247,255,0.86)";
  }
}

/**
 * Abstract guardian-crystal avatar.
 *
 * No cartoon face: AGA reads as a protective luminous artifact. This keeps the
 * avatar calm, elegant, and less uncanny while preserving state-reactive life.
 */
export function AgaAvatarZen({ mode, audioLevel = 0, compact, size: requestedSize }: Props) {
  const breathe = useRef(new Animated.Value(0)).current;
  const halo = useRef(new Animated.Value(0)).current;
  const orbit = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;
  const wing = useRef(new Animated.Value(0)).current;
  const voice = useRef(new Animated.Value(0)).current;
  const level = useRef(new Animated.Value(0)).current;

  const accent = useMemo(() => accentFor(mode), [mode]);
  const live = mode === "listening" || mode === "awake" || mode === "thinking" || mode === "translating";
  const speaking = mode === "speaking";
  const size = requestedSize ?? (compact ? 148 : 244);
  const stageSize = size + 128;

  useEffect(() => {
    Animated.timing(level, {
      toValue: clamp01(audioLevel),
      duration: 140,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [audioLevel, level]);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breathe, { toValue: 1, duration: 3200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(breathe, { toValue: 0, duration: 3200, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
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
        duration: live || speaking ? 5200 : 9800,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [halo, live, speaking]);

  useEffect(() => {
    orbit.setValue(0);
    const loop = Animated.loop(
      Animated.timing(orbit, {
        toValue: 1,
        duration: mode === "thinking" ? 2600 : 7600,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [orbit, mode]);

  useEffect(() => {
    pulse.setValue(0);
    const loop = Animated.loop(
      Animated.timing(pulse, {
        toValue: 1,
        duration: speaking ? 1250 : live ? 2200 : 4400,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, live, speaking]);

  useEffect(() => {
    if (!live && !speaking) {
      wing.stopAnimation(() => wing.setValue(0));
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(wing, { toValue: 1, duration: speaking ? 760 : 1450, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(wing, { toValue: 0, duration: speaking ? 760 : 1450, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [live, speaking, wing]);

  useEffect(() => {
    if (speaking) {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(voice, { toValue: 1, duration: 110 + Math.random() * 70, easing: Easing.out(Easing.quad), useNativeDriver: true }),
          Animated.timing(voice, { toValue: 0.18, duration: 100 + Math.random() * 80, easing: Easing.in(Easing.quad), useNativeDriver: true }),
        ]),
      );
      loop.start();
      return () => loop.stop();
    }
    Animated.timing(voice, { toValue: live ? 0.4 : 0.12, duration: 260, easing: Easing.out(Easing.quad), useNativeDriver: true }).start();
  }, [voice, live, speaking]);

  const breatheScale = breathe.interpolate({ inputRange: [0, 1], outputRange: [1, 1.025] });
  const levelScale = level.interpolate({ inputRange: [0, 1], outputRange: [1, 1.055] });
  const haloSpin = halo.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] });
  const orbitSpin = orbit.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "-360deg"] });
  const pulseScale = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.82, 1.62] });
  const pulseOpacity = pulse.interpolate({ inputRange: [0, 0.55, 1], outputRange: [0.34, 0.15, 0] });
  const wingScale = wing.interpolate({ inputRange: [0, 1], outputRange: [1, 1.07] });
  const leftWingRotate = wing.interpolate({ inputRange: [0, 1], outputRange: ["-34deg", "-24deg"] });
  const rightWingRotate = wing.interpolate({ inputRange: [0, 1], outputRange: ["34deg", "24deg"] });
  const voiceScale = Animated.add(voice, level).interpolate({ inputRange: [0, 0.5, 1, 2], outputRange: [0.65, 0.92, 1.2, 1.45] });
  const coreLift = level.interpolate({ inputRange: [0, 1], outputRange: [0, -size * 0.018] });

  return (
    <View pointerEvents="none" style={[styles.stage, { width: stageSize, height: stageSize }]}>
      <Animated.View
        style={[
          styles.pulseRing,
          {
            width: size * 0.98,
            height: size * 0.98,
            borderRadius: size,
            borderColor: accent,
            opacity: pulseOpacity,
            transform: [{ scale: pulseScale }],
          },
        ]}
      />

      <View style={[styles.aura, { width: size * 1.18, height: size * 1.18, borderRadius: size, shadowColor: accent }]} />

      <Animated.View
        style={[
          styles.wingBlade,
          styles.leftWingBack,
          {
            width: size * 0.3,
            height: size * 0.75,
            borderColor: accent,
            transform: [{ rotate: leftWingRotate }, { scaleY: wingScale }],
          },
        ]}
      />
      <Animated.View
        style={[
          styles.wingBlade,
          styles.leftWingFront,
          {
            width: size * 0.24,
            height: size * 0.58,
            borderColor: accent,
            transform: [{ rotate: leftWingRotate }, { scaleY: wingScale }],
          },
        ]}
      />
      <Animated.View
        style={[
          styles.wingBlade,
          styles.rightWingBack,
          {
            width: size * 0.3,
            height: size * 0.75,
            borderColor: accent,
            transform: [{ rotate: rightWingRotate }, { scaleY: wingScale }],
          },
        ]}
      />
      <Animated.View
        style={[
          styles.wingBlade,
          styles.rightWingFront,
          {
            width: size * 0.24,
            height: size * 0.58,
            borderColor: accent,
            transform: [{ rotate: rightWingRotate }, { scaleY: wingScale }],
          },
        ]}
      />

      <Animated.View
        style={[
          styles.halo,
          {
            width: size * 0.62,
            height: size * 0.16,
            top: stageSize / 2 - size * 0.67,
            borderColor: speaking ? colors.gold : accent,
            transform: [{ rotate: haloSpin }],
          },
        ]}
      />

      <Animated.View style={[styles.orbit, { width: size * 1.05, height: size * 1.05, borderRadius: size, transform: [{ rotate: orbitSpin }] }]}>
        <View style={[styles.orbitDot, { backgroundColor: accent, shadowColor: accent }]} />
      </Animated.View>

      <Animated.View
        style={[
          styles.crystalShell,
          {
            width: size * 0.66,
            height: size * 0.66,
            borderRadius: size * 0.15,
            shadowColor: accent,
            transform: [{ translateY: coreLift }, { scale: breatheScale }, { scale: levelScale }, { rotate: "45deg" }],
          },
        ]}
      >
        <View style={styles.shellGlow} />
        <View style={styles.facets}>
          <View style={styles.facetTop} />
          <View style={styles.facetLeft} />
          <View style={styles.facetRight} />
        </View>
        <View style={[styles.innerSigil, { transform: [{ rotate: "-45deg" }] }]}>
          <View style={[styles.sigilLine, { backgroundColor: accent, shadowColor: accent }]} />
          <View style={[styles.sigilDot, { backgroundColor: speaking ? colors.gold : accent, shadowColor: speaking ? colors.gold : accent }]} />
          <Animated.View
            style={[
              styles.voiceLine,
              {
                backgroundColor: speaking ? colors.gold : accent,
                shadowColor: speaking ? colors.gold : accent,
                transform: [{ scaleX: voiceScale }, { scaleY: voiceScale }],
              },
            ]}
          />
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  stage: { alignItems: "center", justifyContent: "center" },
  pulseRing: { position: "absolute", borderWidth: 2 },
  aura: {
    position: "absolute",
    backgroundColor: "transparent",
    shadowOpacity: 0.6,
    shadowRadius: 42,
    shadowOffset: { width: 0, height: 0 },
  },
  wingBlade: {
    position: "absolute",
    borderRadius: 999,
    backgroundColor: "rgba(191,247,255,0.055)",
    borderWidth: 1.1,
    opacity: 0.72,
    shadowOpacity: 0.2,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
  },
  leftWingBack: { left: "17%" },
  leftWingFront: { left: "23%" },
  rightWingBack: { right: "17%" },
  rightWingFront: { right: "23%" },
  halo: {
    position: "absolute",
    borderWidth: 3.2,
    borderRadius: 999,
    backgroundColor: "rgba(254,243,199,0.035)",
    opacity: 0.82,
  },
  orbit: { position: "absolute", alignItems: "center", justifyContent: "flex-start" },
  orbitDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginTop: -4,
    shadowOpacity: 0.95,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 },
  },
  crystalShell: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(191,247,255,0.92)",
    borderWidth: 1.4,
    borderColor: "rgba(255,255,255,0.86)",
    shadowOpacity: 0.58,
    shadowRadius: 34,
    shadowOffset: { width: 0, height: 14 },
    overflow: "hidden",
  },
  shellGlow: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(255,255,255,0.2)",
  },
  facets: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  facetTop: {
    position: "absolute",
    top: "8%",
    left: "8%",
    right: "8%",
    height: "32%",
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.28)",
  },
  facetLeft: {
    position: "absolute",
    left: "8%",
    bottom: "10%",
    width: "42%",
    height: "52%",
    backgroundColor: "rgba(103,232,249,0.13)",
  },
  facetRight: {
    position: "absolute",
    right: "6%",
    bottom: "8%",
    width: "38%",
    height: "56%",
    backgroundColor: "rgba(167,139,250,0.12)",
  },
  innerSigil: {
    alignItems: "center",
    justifyContent: "center",
  },
  sigilLine: {
    width: 4,
    height: 34,
    borderRadius: 4,
    opacity: 0.7,
    shadowOpacity: 0.6,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
  },
  sigilDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginTop: 7,
    opacity: 0.92,
    shadowOpacity: 0.7,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 },
  },
  voiceLine: {
    width: 28,
    height: 4,
    borderRadius: 4,
    marginTop: 12,
    opacity: 0.9,
    shadowOpacity: 0.6,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 0 },
  },
});

export default AgaAvatarZen;
