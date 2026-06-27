import React, { memo, useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { glowForMode, materialForWear, tactileRelic as AGA, type TactileMode } from './tokens';

const NO_POINTER_EVENTS = { pointerEvents: 'none' as const } as any;

type Modeish = TactileMode | string;

function clamp01(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0;
}

function pulseLoop(value: Animated.Value, active: boolean, duration = 860) {
  if (!active) {
    value.stopAnimation();
    value.setValue(0);
    return undefined;
  }
  const loop = Animated.loop(Animated.sequence([
    Animated.timing(value, { toValue: 1, duration, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
    Animated.timing(value, { toValue: 0, duration: Math.round(duration * 1.18), easing: Easing.in(Easing.quad), useNativeDriver: true }),
  ]));
  loop.start();
  return loop;
}

type PanelProps = {
  children?: React.ReactNode;
  title?: string;
  mode?: Modeish;
  active?: boolean;
  wear?: number;
  style?: StyleProp<ViewStyle>;
};

export const EmbossedPanel = memo(function EmbossedPanel({ children, title, mode = 'idle', active, wear = 0.14, style }: PanelProps) {
  const glow = glowForMode(mode);
  const mat = materialForWear(wear);
  return (
    <View style={[styles.panelShell, NO_POINTER_EVENTS, active && { shadowColor: glow, borderColor: `${glow}66` }, style]}>
      <View style={[styles.panelPatina, { opacity: mat.patinaOpacity }]} />
      <View style={styles.panelTopLip} />
      <View style={styles.panelBevel} />
      <View style={[styles.panelGrain, { opacity: mat.grainOpacity }]} />
      <View style={styles.rivetNW} />
      <View style={styles.rivetNE} />
      <View style={styles.rivetSW} />
      <View style={styles.rivetSE} />
      {title ? <Text style={styles.panelTitle}>{title}</Text> : null}
      {children}
    </View>
  );
});

type ButtonProps = {
  label: string;
  sublabel?: string;
  active?: boolean;
  pressed?: boolean;
  index?: string | number;
  mode?: Modeish;
  wear?: number;
  style?: StyleProp<ViewStyle>;
};

export const TactileButton = memo(function TactileButton({ label, sublabel, active, pressed, index, mode = 'idle', wear = 0.12, style }: ButtonProps) {
  const glow = glowForMode(active ? mode : 'idle');
  const press = useRef(new Animated.Value(pressed ? 1 : 0)).current;
  const pulse = useRef(new Animated.Value(0)).current;
  const mat = materialForWear(wear);

  useEffect(() => {
    Animated.spring(press, { toValue: pressed ? 1 : active ? 0.18 : 0, useNativeDriver: true, ...AGA.spring.press }).start();
  }, [active, press, pressed]);

  useEffect(() => {
    const loop = pulseLoop(pulse, !!active, 720);
    return () => loop?.stop();
  }, [active, pulse]);

  const translateY = press.interpolate({ inputRange: [0, 1], outputRange: [0, 7] });
  const scale = press.interpolate({ inputRange: [0, 1], outputRange: [1, 0.972] });
  const ledOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1] });

  return (
    <Animated.View style={[styles.buttonBody, NO_POINTER_EVENTS, active && { borderColor: `${glow}aa`, shadowColor: glow }, { transform: [{ translateY }, { scale }] }, style]}>
      <View style={[styles.buttonPatina, { opacity: mat.patinaOpacity }]} />
      <View style={styles.buttonSpecular} />
      <View style={styles.buttonBevel} />
      <View style={[styles.buttonGrain, { opacity: mat.grainOpacity }]} />
      {index != null ? <Text style={styles.buttonIndex}>{String(index)}</Text> : null}
      <Text numberOfLines={2} style={styles.buttonLabel}>{label}</Text>
      {sublabel ? <Text numberOfLines={2} style={styles.buttonSub}>{sublabel}</Text> : null}
      <Animated.View style={[styles.buttonLed, { backgroundColor: glow, shadowColor: glow, opacity: active ? ledOpacity : 0.18 }]} />
      {active ? <NeuralTrace active strength={0.52} mode={mode} style={styles.buttonTrace} /> : null}
    </Animated.View>
  );
});

type SwitchProps = {
  label: string;
  value: boolean;
  mode?: Modeish;
  wear?: number;
  style?: StyleProp<ViewStyle>;
};

export const MechanicalSwitch = memo(function MechanicalSwitch({ label, value, mode = 'idle', wear = 0.12, style }: SwitchProps) {
  const glow = glowForMode(value ? mode : 'idle');
  const throwAnim = useRef(new Animated.Value(value ? 1 : 0)).current;
  const mat = materialForWear(wear);
  useEffect(() => {
    Animated.spring(throwAnim, { toValue: value ? 1 : 0, useNativeDriver: true, ...AGA.spring.switchThrow }).start();
  }, [throwAnim, value]);
  const rotate = throwAnim.interpolate({ inputRange: [0, 1], outputRange: ['-31deg', '31deg'] });
  const tx = throwAnim.interpolate({ inputRange: [0, 1], outputRange: [-15, 15] });
  return (
    <View style={[styles.switchWrap, NO_POINTER_EVENTS, value && { borderColor: `${glow}77`, shadowColor: glow }, style]}>
      <View style={[styles.switchPatina, { opacity: mat.patinaOpacity }]} />
      <Text numberOfLines={1} style={styles.switchLabel}>{label}</Text>
      <View style={styles.switchSlot}>
        <Animated.View style={[styles.switchLever, { transform: [{ translateX: tx }, { rotate }] }, value && { backgroundColor: glow, shadowColor: glow }]} />
      </View>
    </View>
  );
});

type RotaryProps = {
  label: string;
  valueLabel: string;
  detent?: number;
  detents?: number;
  mode?: Modeish;
  active?: boolean;
  style?: StyleProp<ViewStyle>;
};

export const RotarySelector = memo(function RotarySelector({ label, valueLabel, detent = 0, detents = 5, mode = 'idle', active, style }: RotaryProps) {
  const glow = glowForMode(active ? mode : 'idle');
  const turn = useRef(new Animated.Value(detent)).current;
  useEffect(() => {
    Animated.spring(turn, { toValue: detent, useNativeDriver: true, ...AGA.spring.detent }).start();
  }, [detent, turn]);
  const rotate = turn.interpolate({ inputRange: [0, Math.max(1, detents - 1)], outputRange: ['-128deg', '128deg'] });
  const marks = useMemo(() => Array.from({ length: detents }, (_, i) => i), [detents]);
  return (
    <View style={[styles.rotaryWrap, NO_POINTER_EVENTS, active && { borderColor: `${glow}77`, shadowColor: glow }, style]}>
      <Text style={styles.rotaryLabel}>{label}</Text>
      <View style={styles.rotaryFace}>
        {marks.map((m) => <View key={m} style={[styles.rotaryMark, { transform: [{ rotate: `${-132 + (264 / Math.max(1, detents - 1)) * m}deg` }, { translateY: -34 }] }]} />)}
        <Animated.View style={[styles.rotaryKnob, { transform: [{ rotate }] }]}>
          <View style={[styles.rotaryNeedle, active && { backgroundColor: glow, shadowColor: glow }]} />
        </Animated.View>
      </View>
      <Text numberOfLines={1} style={styles.rotaryValue}>{valueLabel}</Text>
    </View>
  );
});

type TraceProps = {
  active?: boolean;
  strength?: number;
  mode?: Modeish;
  direction?: 'horizontal' | 'vertical' | 'diagonal' | 'diagonalUp';
  wear?: number;
  style?: StyleProp<ViewStyle>;
};

export const NeuralTrace = memo(function NeuralTrace({ active, strength = 0.35, mode = 'idle', direction = 'horizontal', wear = 0.08, style }: TraceProps) {
  const glow = glowForMode(mode);
  const pulse = useRef(new Animated.Value(0)).current;
  const mat = materialForWear(wear);
  useEffect(() => {
    const loop = pulseLoop(pulse, !!active, 620);
    return () => loop?.stop();
  }, [active, pulse]);
  const opacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [strength * mat.neuralBoost, 0.98] });
  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1.06] });
  const translateX = pulse.interpolate({ inputRange: [0, 1], outputRange: [-8, 8] });
  const rotate = direction === 'diagonal' ? '-18deg' : direction === 'diagonalUp' ? '18deg' : '0deg';
  return (
    <Animated.View style={[styles.traceBase, NO_POINTER_EVENTS, direction === 'vertical' && styles.traceVertical, { backgroundColor: glow, shadowColor: glow, opacity, transform: [{ rotate }, { translateX }, { scale }] }, style]}>
      <View style={styles.traceCore} />
    </Animated.View>
  );
});

type GaugeProps = {
  label: string;
  value?: string;
  mode?: Modeish;
  active?: boolean;
  level?: number;
  style?: StyleProp<ViewStyle>;
};

export const GaugeStatus = memo(function GaugeStatus({ label, value, mode = 'idle', active, level = 0.56, style }: GaugeProps) {
  const glow = glowForMode(mode);
  const marks = useMemo(() => Array.from({ length: 7 }, (_, i) => i), []);
  const lit = Math.round(clamp01(level) * marks.length);
  return (
    <View style={[styles.gauge, NO_POINTER_EVENTS, active && { borderColor: `${glow}66`, shadowColor: glow }, style]}>
      <Text style={styles.gaugeLabel}>{label}</Text>
      <View style={styles.gaugeMarks}>{marks.map((mark) => <View key={mark} style={[styles.gaugeMark, active && mark < lit && { backgroundColor: glow, shadowColor: glow }]} />)}</View>
      {value ? <Text numberOfLines={1} style={styles.gaugeValue}>{value}</Text> : null}
    </View>
  );
});

type PlateProps = {
  role?: string;
  text: string;
  mode?: Modeish;
  active?: boolean;
  style?: StyleProp<ViewStyle>;
};

export const MessagePlate = memo(function MessagePlate({ role = 'assistant', text, mode = 'idle', active, style }: PlateProps) {
  const glow = glowForMode(active ? mode : role === 'user' ? 'listening' : 'speaking');
  return (
    <View style={[styles.messagePlate, NO_POINTER_EVENTS, active && { borderColor: `${glow}66`, shadowColor: glow }, style]}>
      <View style={styles.messagePlateLip} />
      <Text style={styles.messageRole}>{role}</Text>
      <Text numberOfLines={3} style={styles.messageText}>{text}</Text>
    </View>
  );
});

export const LedBank = memo(function LedBank({ mode = 'idle', level = 0.5 }: { mode?: Modeish; level?: number }) {
  const glow = glowForMode(mode);
  const marks = useMemo(() => Array.from({ length: 12 }, (_, i) => i), []);
  const lit = Math.round(clamp01(level) * marks.length);
  return <View style={[styles.ledBank, NO_POINTER_EVENTS]}>{marks.map((m) => <View key={m} style={[styles.led, m < lit && { backgroundColor: glow, shadowColor: glow }]} />)}</View>;
});

const rivet = {
  position: 'absolute' as const,
  width: 7,
  height: 7,
  borderRadius: 7,
  backgroundColor: AGA.colors.wornEdge,
  shadowColor: AGA.colors.shadow,
  shadowOpacity: 0.8,
  shadowRadius: 5,
};

const styles = StyleSheet.create({
  panelShell: {
    borderRadius: AGA.material.panelRadius,
    backgroundColor: AGA.colors.panelRaised,
    borderWidth: 1,
    borderColor: '#29383a',
    padding: 16,
    overflow: 'hidden',
    shadowColor: AGA.colors.shadow,
    shadowOpacity: 0.86,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
  },
  panelPatina: { ...StyleSheet.absoluteFillObject, backgroundColor: AGA.colors.oxidizedCopper },
  panelTopLip: { position: 'absolute', left: 5, right: 5, top: 3, height: 2, borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.25)' },
  panelBevel: { ...StyleSheet.absoluteFillObject, borderRadius: AGA.material.panelRadius, borderTopWidth: 2, borderLeftWidth: 2, borderTopColor: 'rgba(255,255,255,0.11)', borderLeftColor: 'rgba(255,255,255,0.06)', borderBottomWidth: 5, borderRightWidth: 4, borderBottomColor: 'rgba(0,0,0,0.76)', borderRightColor: 'rgba(0,0,0,0.58)' },
  panelGrain: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(255,255,255,0.72)' },
  rivetNW: { ...rivet, left: 9, top: 9 },
  rivetNE: { ...rivet, right: 9, top: 9 },
  rivetSW: { ...rivet, left: 9, bottom: 9 },
  rivetSE: { ...rivet, right: 9, bottom: 9 },
  panelTitle: { color: AGA.colors.engraved, fontSize: 10, letterSpacing: 2.3, textTransform: 'uppercase', fontWeight: '900', marginBottom: 12, paddingLeft: 8 },

  buttonBody: { minHeight: 82, borderRadius: AGA.material.controlRadius, backgroundColor: '#132022', borderWidth: 1, borderColor: '#344648', paddingVertical: 13, paddingHorizontal: 15, overflow: 'hidden', shadowColor: '#000', shadowOpacity: 0.62, shadowRadius: 12, shadowOffset: { width: 0, height: 7 }, minWidth: 160 },
  buttonPatina: { ...StyleSheet.absoluteFillObject, backgroundColor: AGA.colors.copperDark },
  buttonSpecular: { position: 'absolute', left: 3, right: 3, top: 3, height: '42%', borderTopLeftRadius: 14, borderTopRightRadius: 14, backgroundColor: 'rgba(255,255,255,0.075)' },
  buttonBevel: { ...StyleSheet.absoluteFillObject, borderTopWidth: 3, borderLeftWidth: 2, borderTopColor: 'rgba(255,255,255,0.22)', borderLeftColor: 'rgba(255,255,255,0.10)', borderBottomWidth: 5, borderRightWidth: 4, borderBottomColor: 'rgba(0,0,0,0.82)', borderRightColor: 'rgba(0,0,0,0.62)', borderRadius: AGA.material.controlRadius },
  buttonGrain: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(255,255,255,0.7)' },
  buttonIndex: { color: AGA.colors.amber, fontWeight: '900', fontSize: 12, letterSpacing: 1.7, marginBottom: 2, textShadowColor: 'rgba(240,174,63,0.45)', textShadowRadius: 8 },
  buttonLabel: { color: AGA.colors.coolWhite, fontWeight: '900', fontSize: 17, letterSpacing: 0.3 },
  buttonSub: { color: AGA.colors.engraved, fontSize: 12, lineHeight: 16, marginTop: 5, fontWeight: '700' },
  buttonLed: { position: 'absolute', top: 12, right: 12, width: 8, height: 8, borderRadius: 8, shadowOpacity: 0.95, shadowRadius: 11 },
  buttonTrace: { position: 'absolute', left: 10, right: 30, bottom: 8, minWidth: 0 },

  switchWrap: { minHeight: 70, borderRadius: 16, backgroundColor: '#10191a', borderWidth: 1, borderColor: '#2b3d3f', padding: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', overflow: 'hidden', shadowColor: '#000', shadowOpacity: 0.55, shadowRadius: 10, shadowOffset: { width: 0, height: 6 } },
  switchPatina: { ...StyleSheet.absoluteFillObject, backgroundColor: AGA.colors.oxidizedCopper },
  switchLabel: { color: AGA.colors.coolWhite, fontWeight: '900', fontSize: 14, flex: 1, paddingRight: 12 },
  switchSlot: { width: 78, height: 28, borderRadius: 20, backgroundColor: '#030606', borderWidth: 1, borderColor: '#334548', justifyContent: 'center', alignItems: 'center', shadowColor: '#000', shadowOpacity: 0.8, shadowRadius: 7, shadowOffset: { width: 0, height: -2 } },
  switchLever: { width: 45, height: 17, borderRadius: 10, backgroundColor: '#5f6f70', shadowOpacity: 0.9, shadowRadius: 9 },

  rotaryWrap: { width: 150, minHeight: 160, borderRadius: 18, backgroundColor: '#0f1819', borderWidth: 1, borderColor: '#2a3c3e', padding: 12, alignItems: 'center', overflow: 'hidden', shadowColor: '#000', shadowOpacity: 0.6, shadowRadius: 12, shadowOffset: { width: 0, height: 6 } },
  rotaryLabel: { color: AGA.colors.engraved, fontWeight: '900', fontSize: 10, letterSpacing: 1.6, textTransform: 'uppercase' },
  rotaryFace: { width: 92, height: 92, borderRadius: 92, backgroundColor: '#050808', marginTop: 10, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#344649' },
  rotaryMark: { position: 'absolute', width: 3, height: 11, borderRadius: 2, backgroundColor: '#526063' },
  rotaryKnob: { width: 64, height: 64, borderRadius: 64, backgroundColor: '#1a2527', borderWidth: 1, borderColor: '#576467', alignItems: 'center', justifyContent: 'flex-start', paddingTop: 7, shadowColor: '#000', shadowOpacity: 0.85, shadowRadius: 12 },
  rotaryNeedle: { width: 6, height: 24, borderRadius: 4, backgroundColor: AGA.colors.wornEdge, shadowOpacity: 0.9, shadowRadius: 8 },
  rotaryValue: { color: AGA.colors.coolWhite, fontSize: 12, fontWeight: '900', marginTop: 9 },

  traceBase: { height: 4, minWidth: 48, borderRadius: 99, shadowOpacity: 0.98, shadowRadius: 14, overflow: 'hidden' },
  traceVertical: { width: 4, minWidth: 4, height: 54 },
  traceCore: { ...StyleSheet.absoluteFillObject, left: '18%', right: '18%', backgroundColor: 'rgba(255,255,255,0.42)', borderRadius: 99 },

  gauge: { minWidth: 102, maxWidth: 200, borderRadius: 15, padding: 10, backgroundColor: '#0d1516', borderWidth: 1, borderColor: '#27383a', shadowColor: '#000', shadowOpacity: 0.52, shadowRadius: 9, overflow: 'hidden' },
  gaugeLabel: { color: AGA.colors.engraved, fontSize: 9, fontWeight: '900', letterSpacing: 1.4, textTransform: 'uppercase' },
  gaugeMarks: { flexDirection: 'row', gap: 4, marginTop: 8, marginBottom: 7 },
  gaugeMark: { width: 7, height: 19, borderRadius: 3, backgroundColor: '#233335', shadowOpacity: 0.8, shadowRadius: 6 },
  gaugeValue: { color: AGA.colors.coolWhite, fontSize: 13, fontWeight: '900' },

  messagePlate: { borderRadius: 15, padding: 12, paddingTop: 13, backgroundColor: '#101a1b', borderWidth: 1, borderColor: '#2b3c3e', overflow: 'hidden', shadowColor: '#000', shadowOpacity: 0.55, shadowRadius: 11, shadowOffset: { width: 0, height: 6 } },
  messagePlateLip: { position: 'absolute', top: 2, left: 4, right: 4, height: 2, borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.16)' },
  messageRole: { color: AGA.colors.amber, fontSize: 9, fontWeight: '900', letterSpacing: 1.6, textTransform: 'uppercase', marginBottom: 5 },
  messageText: { color: AGA.colors.coolWhite, fontSize: 13, lineHeight: 18, fontWeight: '700' },

  ledBank: { flexDirection: 'row', gap: 4, alignItems: 'center' },
  led: { width: 5, height: 16, borderRadius: 3, backgroundColor: '#233335', shadowOpacity: 0.85, shadowRadius: 5 },
});
