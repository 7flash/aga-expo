import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, Ellipse, G, Path, RadialGradient, Stop } from 'react-native-svg';
import { colors } from './theme';
import type { AgaMode } from '../aga/turn';

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
      return 'rgba(191,247,255,0.9)';
  }
}

const FIGURE_D =
  'M170 96c-30 4-58 30-70 78-6 24-26 40-52 44 40 10 70-2 92-30 6 50 6 96 0 150h60c-6-54-6-100 0-150 22 28 52 40 92 30-26-4-46-20-52-44-12-48-40-74-70-78z';

export function AgaAvatarZen({ mode, audioLevel = 0, compact, size = compact ? 220 : 300 }: Props) {
  const float = useRef(new Animated.Value(0)).current;
  const halo = useRef(new Animated.Value(0)).current;
  const wing = useRef(new Animated.Value(0)).current;
  const pulse = useRef(new Animated.Value(0)).current;
  const blink = useRef(new Animated.Value(1)).current;
  const shimmer = useRef(new Animated.Value(0)).current;
  const level = useRef(new Animated.Value(0)).current;

  const accent = useMemo(() => accentFor(mode), [mode]);
  const live = mode === 'listening' || mode === 'awake' || mode === 'thinking' || mode === 'translating';
  const speaking = mode === 'speaking';

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
        Animated.timing(float, { toValue: 1, duration: 2600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(float, { toValue: 0, duration: 2600, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [float]);

  useEffect(() => {
    halo.setValue(0);
    const loop = Animated.loop(
      Animated.timing(halo, {
        toValue: 1,
        duration: live || speaking ? 5200 : 9000,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [halo, live, speaking]);

  useEffect(() => {
    pulse.setValue(0);
    const loop = Animated.loop(
      Animated.timing(pulse, {
        toValue: 1,
        duration: speaking ? 1300 : live ? 2400 : 4200,
        easing: Easing.inOut(Easing.sin),
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse, live, speaking]);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(wing, { toValue: 1, duration: speaking ? 760 : 1500, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(wing, { toValue: 0, duration: speaking ? 760 : 1500, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [wing, speaking]);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      timer = setTimeout(() => {
        if (!alive) return;
        Animated.sequence([
          Animated.timing(blink, { toValue: 0.08, duration: 90, useNativeDriver: true }),
          Animated.timing(blink, { toValue: 1, duration: 130, useNativeDriver: true }),
        ]).start(() => alive && schedule());
      }, 2800 + Math.random() * 3600);
    };
    schedule();
    return () => { alive = false; clearTimeout(timer); };
  }, [blink]);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(shimmer, { toValue: 1, duration: 2300, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(shimmer, { toValue: 0, duration: 2300, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [shimmer]);

  const floatY = float.interpolate({ inputRange: [0, 1], outputRange: [6, -10] });
  const haloSpin = halo.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const auraScale = Animated.add(
    pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.12] }),
    level.interpolate({ inputRange: [0, 1], outputRange: [0, 0.22] }),
  );
  const auraOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.3, 0.58] });
  const leftWingRotate = wing.interpolate({ inputRange: [0, 1], outputRange: [speaking ? '-11deg' : '-7deg', speaking ? '9deg' : '5deg'] });
  const rightWingRotate = wing.interpolate({ inputRange: [0, 1], outputRange: [speaking ? '11deg' : '7deg', speaking ? '-9deg' : '-5deg'] });
  const shimmerX = shimmer.interpolate({ inputRange: [0, 1], outputRange: [-2.4, 2.4] });
  const coreScale = Animated.add(1, level.interpolate({ inputRange: [0, 1], outputRange: [0, 0.05] }));
  const blinkScale = blink;

  const stage = size * 1.45;
  const bodyWidth = size;
  const bodyHeight = size * 1.18;
  const bodyLeft = (stage - bodyWidth) / 2;
  const bodyTop = (stage - bodyHeight) / 2 + 5;
  const wingWidth = size * 0.58;
  const wingHeight = size * 0.38;

  return (
    <View pointerEvents="none" style={[styles.root, { width: stage, height: stage }]}> 
      <Animated.View style={[styles.center, { opacity: auraOpacity, transform: [{ scale: auraScale }] }]}> 
        <Svg width={stage} height={stage}>
          <Defs>
            <RadialGradient id="aura" cx="50%" cy="44%" r="50%">
              <Stop offset="0%" stopColor={accent} stopOpacity={0.55} />
              <Stop offset="45%" stopColor={colors.lavender} stopOpacity={0.18} />
              <Stop offset="72%" stopColor={accent} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Circle cx={stage / 2} cy={stage * 0.46} r={stage * 0.4} fill="url(#aura)" />
        </Svg>
      </Animated.View>

      <Animated.View style={[styles.center, { transform: [{ translateY: floatY }] }]}> 
        <Animated.View
          style={[
            styles.haloLayer,
            { width: size, height: size * 0.42, transform: [{ rotate: haloSpin }] },
          ]}
        >
          <Svg width={size} height={size * 0.42} viewBox="0 0 340 140">
            <Ellipse cx={170} cy={58} rx={48} ry={13} fill="none" stroke={speaking ? colors.gold : accent} strokeWidth={3} opacity={0.9} />
          </Svg>
        </Animated.View>

        <Animated.View
          style={[
            styles.wingLayer,
            {
              left: bodyLeft - size * 0.08,
              top: bodyTop + size * 0.17,
              width: wingWidth,
              height: wingHeight,
              transform: [{ rotate: leftWingRotate }],
            },
          ]}
        >
          <Svg width={wingWidth} height={wingHeight} viewBox="0 0 170 120">
            <Path d="M118 15c-46-6-86 18-102 72 32-14 58-12 86 8-2-30 4-56 16-80z" fill={accent} opacity={0.14} />
            <Path d="M120 31c-36 1-66 20-80 56 24-7 46-4 68 12-1-25 4-47 12-68z" fill="#eaffff" opacity={0.2} />
          </Svg>
        </Animated.View>

        <Animated.View
          style={[
            styles.wingLayer,
            {
              right: bodyLeft - size * 0.08,
              top: bodyTop + size * 0.17,
              width: wingWidth,
              height: wingHeight,
              transform: [{ rotate: rightWingRotate }],
            },
          ]}
        >
          <Svg width={wingWidth} height={wingHeight} viewBox="170 0 170 120">
            <Path d="M222 15c46-6 86 18 102 72-32-14-58-12-86 8 2-30-4-56-16-80z" fill={accent} opacity={0.14} />
            <Path d="M220 31c36 1 66 20 80 56-24-7-46-4-68 12 1-25-4-47-12-68z" fill="#eaffff" opacity={0.2} />
          </Svg>
        </Animated.View>

        <Animated.View style={[styles.bodyLayer, { width: bodyWidth, height: bodyHeight, transform: [{ scale: coreScale }] }]}> 
          <Svg width={bodyWidth} height={bodyHeight} viewBox="0 0 340 400">
            <Defs>
              <RadialGradient id="body" cx="50%" cy="30%" r="80%">
                <Stop offset="0%" stopColor="#f4ffff" stopOpacity={1} />
                <Stop offset="55%" stopColor="#cdfaff" stopOpacity={0.96} />
                <Stop offset="100%" stopColor={accent} stopOpacity={0.55} />
              </RadialGradient>
            </Defs>

            <Path d={FIGURE_D} fill={colors.pink} opacity={0.22} transform="translate(-2.4,0)" />
            <G transform="translate(2.0,0)">
              <Path d={FIGURE_D} fill={colors.cyan} opacity={0.24} />
            </G>
            <Path d={FIGURE_D} fill="url(#body)" />
            <Circle cx={170} cy={84} r={27} fill="#eafdff" />
            <Circle cx={150} cy={90} r={5.4} fill={colors.pink} opacity={0.5} />
            <Circle cx={190} cy={90} r={5.4} fill={colors.pink} opacity={0.5} />
            <Path d="M160 95c5.5 4.5 14 4.5 20 0" stroke="#0b1024" strokeWidth={2.6} fill="none" strokeLinecap="round" />
          </Svg>
        </Animated.View>

        <Animated.View
          style={[
            styles.eyeLayer,
            {
              width: bodyWidth,
              height: bodyHeight,
              transform: [{ scaleY: blinkScale }, { translateX: shimmerX }],
            },
          ]}
        >
          <Svg width={bodyWidth} height={bodyHeight} viewBox="0 0 340 400">
            <Ellipse cx={160} cy={84} rx={3.6} ry={5.2} fill="#0b1024" />
            <Ellipse cx={180} cy={84} rx={3.6} ry={5.2} fill="#0b1024" />
          </Svg>
        </Animated.View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { alignItems: 'center', justifyContent: 'center' },
  center: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  haloLayer: { position: 'absolute', alignItems: 'center', justifyContent: 'center', zIndex: 5 },
  wingLayer: { position: 'absolute', zIndex: 2 },
  bodyLayer: { zIndex: 4 },
  eyeLayer: { position: 'absolute', zIndex: 6 },
});

export default AgaAvatarZen;
