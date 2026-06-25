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
 * AGA's less-cartoon, more-sacred avatar.
 *
 * The old face/wing layout could read as a strange robot. This version treats
 * AGA as a living guardian orb: soft core, small awareness eyes, abstract wing
 * ribbons, halo, and orbiting light. It remains pure React Native Animated so
 * it works without Skia/SVG/native graphics dependencies.
 */
export function AgaAvatarZen({
  mode,
  audioLevel = 0,
  compact,
  size: requestedSize,
}: Props) {
  const breathe = useRef(new Animated.Value(0)).current;
  const halo = useRef(new Animated.Value(0)).current;
  const orbit = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;
  const blink = useRef(new Animated.Value(1)).current;
  const mouth = useRef(new Animated.Value(0)).current;
  const wing = useRef(new Animated.Value(0)).current;
  const level = useRef(new Animated.Value(0)).current;

  const accent = useMemo(() => accentFor(mode), [mode]);
  const live =
    mode === "listening" ||
    mode === "awake" ||
    mode === "thinking" ||
    mode === "translating";
  const speaking = mode === "speaking";
  const size = requestedSize ?? (compact ? 148 : 244);
  const stageSize = size + 128;

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
        Animated.timing(breathe, {
          toValue: 1,
          duration: 3100,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(breathe, {
          toValue: 0,
          duration: 3100,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
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
        duration: live ? 5200 : 9800,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [halo, live]);

  useEffect(() => {
    orbit.setValue(0);
    const loop = Animated.loop(
      Animated.timing(orbit, {
        toValue: 1,
        duration: mode === "thinking" ? 2800 : 7200,
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
        duration: speaking ? 1300 : live ? 2200 : 4200,
        easing: Easing.out(Easing.quad),
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, live, speaking]);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      timer = setTimeout(
        () => {
          if (!alive) return;
          Animated.sequence([
            Animated.timing(blink, {
              toValue: 0.08,
              duration: 80,
              useNativeDriver: true,
            }),
            Animated.timing(blink, {
              toValue: 1,
              duration: 140,
              useNativeDriver: true,
            }),
          ]).start(() => alive && schedule());
        },
        2400 + Math.random() * 4200,
      );
    };
    schedule();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [blink]);

  useEffect(() => {
    if (speaking) {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(mouth, {
            toValue: 1,
            duration: 120 + Math.random() * 60,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(mouth, {
            toValue: 0.18,
            duration: 100 + Math.random() * 80,
            easing: Easing.in(Easing.quad),
            useNativeDriver: true,
          }),
        ]),
      );
      loop.start();
      return () => loop.stop();
    }
    Animated.timing(mouth, {
      toValue: live ? 0.35 : 0.08,
      duration: 260,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [live, mouth, speaking]);

  useEffect(() => {
    if (!live && !speaking) {
      wing.stopAnimation(() => wing.setValue(0));
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(wing, {
          toValue: 1,
          duration: speaking ? 760 : 1300,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(wing, {
          toValue: 0,
          duration: speaking ? 760 : 1300,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [live, speaking, wing]);

  const breatheScale = breathe.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.026],
  });
  const levelScale = level.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.05],
  });
  const haloSpin = halo.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  });
  const orbitSpin = orbit.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "-360deg"],
  });
  const pulseScale = pulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.86, 1.68],
  });
  const pulseOpacity = pulse.interpolate({
    inputRange: [0, 0.55, 1],
    outputRange: [0.36, 0.16, 0],
  });
  const wingScale = wing.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.065],
  });
  const leftWingRotate = wing.interpolate({
    inputRange: [0, 1],
    outputRange: ["-28deg", "-18deg"],
  });
  const rightWingRotate = wing.interpolate({
    inputRange: [0, 1],
    outputRange: ["28deg", "18deg"],
  });
  const mouthScaleY = Animated.add(mouth, level).interpolate({
    inputRange: [0, 0.5, 1, 2],
    outputRange: [0.18, 0.52, 1.1, 1.36],
  });
  const pupilLift = level.interpolate({
    inputRange: [0, 1],
    outputRange: [0, -size * 0.012],
  });

  return (
    <View
      pointerEvents="none"
      style={[styles.stage, { width: stageSize, height: stageSize }]}
    >
      <Animated.View
        style={[
          styles.pulseRing,
          {
            width: size * 1.02,
            height: size * 1.02,
            borderRadius: size,
            borderColor: accent,
            opacity: pulseOpacity,
            transform: [{ scale: pulseScale }],
          },
        ]}
      />

      <View
        style={[
          styles.outerAura,
          {
            width: size * 1.26,
            height: size * 1.26,
            borderRadius: size,
            shadowColor: accent,
          },
        ]}
      />

      <Animated.View
        style={[
          styles.wingRibbon,
          styles.leftRibbon,
          {
            width: size * 0.58,
            height: size * 0.92,
            borderRadius: size,
            borderColor: accent,
            transform: [{ rotate: leftWingRotate }, { scaleY: wingScale }],
          },
        ]}
      />
      <Animated.View
        style={[
          styles.wingRibbon,
          styles.rightRibbon,
          {
            width: size * 0.58,
            height: size * 0.92,
            borderRadius: size,
            borderColor: accent,
            transform: [{ rotate: rightWingRotate }, { scaleY: wingScale }],
          },
        ]}
      />

      <Animated.View
        style={[
          styles.halo,
          {
            width: size * 0.66,
            height: size * 0.16,
            top: stageSize / 2 - size * 0.66,
            borderColor: speaking ? colors.gold : accent,
            opacity: mode === "sleeping" ? 0.56 : 0.84,
            transform: [{ rotate: haloSpin }],
          },
        ]}
      />

      <Animated.View
        style={[
          styles.orbit,
          {
            width: size * 1.05,
            height: size * 1.05,
            borderRadius: size,
            transform: [{ rotate: orbitSpin }],
          },
        ]}
      >
        <View
          style={[
            styles.orbitDot,
            { backgroundColor: accent, shadowColor: accent },
          ]}
        />
      </Animated.View>

      <Animated.View
        style={[
          styles.core,
          {
            width: size,
            height: size,
            borderRadius: size,
            shadowColor: accent,
            transform: [{ scale: breatheScale }, { scale: levelScale }],
          },
        ]}
      >
        <View style={styles.coreGlow} />
        <View
          style={[
            styles.upperGlow,
            { width: size * 0.64, height: size * 0.5, borderRadius: size },
          ]}
        />

        <View
          style={[styles.eyes, { gap: size * 0.16, marginTop: size * 0.02 }]}
        >
          <Animated.View
            style={[
              styles.eye,
              {
                width: size * 0.092,
                height: size * 0.115,
                transform: [{ scaleY: blink }, { translateY: pupilLift }],
              },
            ]}
          />
          <Animated.View
            style={[
              styles.eye,
              {
                width: size * 0.092,
                height: size * 0.115,
                transform: [{ scaleY: blink }, { translateY: pupilLift }],
              },
            ]}
          />
        </View>

        <Animated.View
          style={[
            styles.mouth,
            {
              width: size * 0.16,
              height: size * 0.045,
              marginTop: size * 0.11,
              backgroundColor: speaking ? colors.gold : accent,
              transform: [{ scaleY: mouthScaleY }],
            },
          ]}
        />
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  stage: { alignItems: "center", justifyContent: "center" },
  pulseRing: { position: "absolute", borderWidth: 2 },
  outerAura: {
    position: "absolute",
    backgroundColor: "transparent",
    shadowOpacity: 0.62,
    shadowRadius: 44,
    shadowOffset: { width: 0, height: 0 },
  },
  wingRibbon: {
    position: "absolute",
    backgroundColor: "rgba(255,255,255,0.07)",
    borderWidth: 1.2,
    opacity: 0.7,
    shadowOpacity: 0.22,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 10 },
  },
  leftRibbon: { left: 26 },
  rightRibbon: { right: 26 },
  halo: {
    position: "absolute",
    borderWidth: 3.5,
    borderRadius: 999,
    backgroundColor: "rgba(254,243,199,0.03)",
  },
  orbit: {
    position: "absolute",
    alignItems: "center",
    justifyContent: "flex-start",
  },
  orbitDot: {
    width: 11,
    height: 11,
    borderRadius: 6,
    marginTop: -5,
    shadowOpacity: 0.9,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 0 },
  },
  core: {
    backgroundColor: "#bff7ff",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1.5,
    borderColor: "rgba(255,255,255,0.82)",
    shadowOpacity: 0.56,
    shadowRadius: 34,
    shadowOffset: { width: 0, height: 15 },
    overflow: "hidden",
  },
  coreGlow: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(255,255,255,0.18)",
  },
  upperGlow: {
    position: "absolute",
    top: "10%",
    backgroundColor: "rgba(255,255,255,0.34)",
    opacity: 0.72,
  },
  eyes: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  eye: { borderRadius: 999, backgroundColor: "#12182c", opacity: 0.94 },
  mouth: { borderRadius: 999, opacity: 0.94 },
});

export default AgaAvatarZen;
