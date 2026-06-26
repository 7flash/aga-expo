import React, { memo, useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { glowForMode, tactile, type TactileMode } from './tokens';

type PanelProps = {
  children?: React.ReactNode;
  title?: string;
  mode?: TactileMode | string;
  active?: boolean;
  style?: StyleProp<ViewStyle>;
};

export const EmbossedPanel = memo(function EmbossedPanel({ children, title, mode = 'idle', active, style }: PanelProps) {
  const glow = glowForMode(mode);
  return (
    <View pointerEvents="none" style={[styles.panelOuter, active && { shadowColor: glow, borderColor: `${glow}66` }, style]}>
      <View style={styles.topSpecular} />
      <View style={styles.panelInset} />
      <View style={styles.grain} />
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
  mode?: TactileMode | string;
  style?: StyleProp<ViewStyle>;
};

export const TactileButton = memo(function TactileButton({ label, sublabel, active, pressed, index, mode = 'idle', style }: ButtonProps) {
  const glow = glowForMode(active ? mode : 'idle');
  const press = useRef(new Animated.Value(pressed ? 1 : 0)).current;

  useEffect(() => {
    Animated.spring(press, { toValue: pressed ? 1 : 0, useNativeDriver: true, ...tactile.spring.press }).start();
  }, [press, pressed]);

  const translateY = press.interpolate({ inputRange: [0, 1], outputRange: [0, 5] });
  const scale = press.interpolate({ inputRange: [0, 1], outputRange: [1, 0.985] });

  return (
    <Animated.View pointerEvents="none" style={[styles.button, active && { borderColor: `${glow}aa`, shadowColor: glow }, { transform: [{ translateY }, { scale }] }, style]}>
      <View style={[styles.buttonTop, active && { backgroundColor: `${glow}18` }]} />
      <View style={styles.buttonBevel} />
      <View style={styles.buttonGrain} />
      {index != null ? <Text style={styles.buttonIndex}>{String(index)}</Text> : null}
      <Text style={styles.buttonLabel}>{label}</Text>
      {sublabel ? <Text style={styles.buttonSub}>{sublabel}</Text> : null}
      {active ? <View style={[styles.buttonLED, { backgroundColor: glow, shadowColor: glow }]} /> : null}
    </Animated.View>
  );
});

type SwitchProps = {
  label: string;
  value: boolean;
  mode?: TactileMode | string;
  style?: StyleProp<ViewStyle>;
};

export const MechanicalSwitch = memo(function MechanicalSwitch({ label, value, mode = 'idle', style }: SwitchProps) {
  const glow = glowForMode(value ? mode : 'idle');
  const throwAnim = useRef(new Animated.Value(value ? 1 : 0)).current;
  useEffect(() => {
    Animated.spring(throwAnim, { toValue: value ? 1 : 0, useNativeDriver: true, ...tactile.spring.switchThrow }).start();
  }, [throwAnim, value]);
  const rotate = throwAnim.interpolate({ inputRange: [0, 1], outputRange: ['-28deg', '28deg'] });
  const tx = throwAnim.interpolate({ inputRange: [0, 1], outputRange: [-12, 12] });
  return (
    <View pointerEvents="none" style={[styles.switchWrap, value && { borderColor: `${glow}77`, shadowColor: glow }, style]}>
      <Text style={styles.switchLabel}>{label}</Text>
      <View style={styles.switchSlot}>
        <Animated.View style={[styles.switchLever, { transform: [{ translateX: tx }, { rotate }] }, value && { backgroundColor: glow, shadowColor: glow }]} />
      </View>
    </View>
  );
});

type TraceProps = {
  active?: boolean;
  strength?: number;
  mode?: TactileMode | string;
  direction?: 'horizontal' | 'vertical' | 'diagonal';
  style?: StyleProp<ViewStyle>;
};

export const NeuralTrace = memo(function NeuralTrace({ active, strength = 0.35, mode = 'idle', direction = 'horizontal', style }: TraceProps) {
  const glow = glowForMode(mode);
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!active) {
      pulse.setValue(0);
      return;
    }
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(pulse, { toValue: 1, duration: 620, easing: Easing.out(Easing.cubic), useNativeDriver: true }),
      Animated.timing(pulse, { toValue: 0, duration: 760, easing: Easing.in(Easing.quad), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [active, pulse]);
  const opacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [strength, 0.95] });
  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1.04] });
  const rotate = direction === 'diagonal' ? '-18deg' : '0deg';
  return <Animated.View pointerEvents="none" style={[styles.trace, direction === 'vertical' && styles.traceVertical, { backgroundColor: glow, shadowColor: glow, opacity, transform: [{ rotate }, { scale }] }, style]} />;
});

type GaugeProps = { label: string; value?: string; mode?: TactileMode | string; active?: boolean; };
export const GaugeStatus = memo(function GaugeStatus({ label, value, mode = 'idle', active }: GaugeProps) {
  const glow = glowForMode(mode);
  const marks = useMemo(() => Array.from({ length: 5 }, (_, i) => i), []);
  return (
    <View pointerEvents="none" style={[styles.gauge, active && { borderColor: `${glow}66` }]}>
      <Text style={styles.gaugeLabel}>{label}</Text>
      <View style={styles.gaugeMarks}>{marks.map((mark) => <View key={mark} style={[styles.gaugeMark, active && mark < 3 && { backgroundColor: glow, shadowColor: glow }]} />)}</View>
      {value ? <Text style={styles.gaugeValue}>{value}</Text> : null}
    </View>
  );
});

const styles = StyleSheet.create({
  panelOuter: {
    borderRadius: tactile.material.panelRadius,
    backgroundColor: tactile.colors.panelRaised,
    borderWidth: 1,
    borderColor: '#27383f',
    padding: 16,
    overflow: 'hidden',
    shadowColor: tactile.colors.shadow,
    shadowOpacity: 0.8,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 9 },
  },
  topSpecular: { position: 'absolute', left: 3, right: 3, top: 2, height: 2, borderRadius: 99, backgroundColor: 'rgba(255,255,255,0.22)' },
  panelInset: { ...StyleSheet.absoluteFillObject, borderRadius: tactile.material.panelRadius, borderTopWidth: 2, borderLeftWidth: 2, borderTopColor: 'rgba(255,255,255,0.09)', borderLeftColor: 'rgba(255,255,255,0.05)', borderBottomWidth: 3, borderRightWidth: 3, borderBottomColor: 'rgba(0,0,0,0.55)', borderRightColor: 'rgba(0,0,0,0.42)' },
  grain: { ...StyleSheet.absoluteFillObject, opacity: tactile.material.grainOpacity, backgroundColor: 'rgba(255,255,255,0.55)' },
  panelTitle: { color: tactile.colors.etched, fontSize: 11, letterSpacing: 1.9, textTransform: 'uppercase', fontWeight: '900', marginBottom: 10 },
  button: { minHeight: 78, borderRadius: tactile.material.controlRadius, backgroundColor: '#142126', borderWidth: 1, borderColor: '#33474f', paddingVertical: 12, paddingHorizontal: 14, overflow: 'hidden', shadowOpacity: 0.6, shadowRadius: 10, shadowOffset: { width: 0, height: 6 } },
  buttonTop: { position: 'absolute', left: 2, right: 2, top: 2, height: '48%', borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.06)' },
  buttonBevel: { ...StyleSheet.absoluteFillObject, borderTopWidth: 2, borderLeftWidth: 2, borderTopColor: 'rgba(255,255,255,0.18)', borderLeftColor: 'rgba(255,255,255,0.09)', borderBottomWidth: 4, borderRightWidth: 3, borderBottomColor: 'rgba(0,0,0,0.72)', borderRightColor: 'rgba(0,0,0,0.52)', borderRadius: tactile.material.controlRadius },
  buttonGrain: { ...StyleSheet.absoluteFillObject, opacity: 0.05, backgroundColor: tactile.colors.copper },
  buttonIndex: { color: tactile.colors.amber, fontWeight: '900', fontSize: 12, letterSpacing: 1, marginBottom: 2 },
  buttonLabel: { color: tactile.colors.text, fontWeight: '900', fontSize: 17, letterSpacing: 0.3 },
  buttonSub: { color: tactile.colors.etched, fontSize: 12, lineHeight: 16, marginTop: 5 },
  buttonLED: { position: 'absolute', top: 12, right: 12, width: 8, height: 8, borderRadius: 8, shadowOpacity: 0.9, shadowRadius: 10 },
  switchWrap: { minHeight: 68, borderRadius: 16, backgroundColor: '#111b1f', borderWidth: 1, borderColor: '#2a3b42', padding: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', shadowOpacity: 0.55, shadowRadius: 10, shadowOffset: { width: 0, height: 6 } },
  switchLabel: { color: tactile.colors.text, fontWeight: '900', fontSize: 14, flex: 1, paddingRight: 12 },
  switchSlot: { width: 70, height: 26, borderRadius: 20, backgroundColor: '#040708', borderWidth: 1, borderColor: '#314148', justifyContent: 'center', alignItems: 'center' },
  switchLever: { width: 42, height: 16, borderRadius: 10, backgroundColor: '#617078', shadowOpacity: 0.85, shadowRadius: 8 },
  trace: { height: 3, minWidth: 42, borderRadius: 99, shadowOpacity: 0.95, shadowRadius: 12 },
  traceVertical: { width: 3, minWidth: 3, height: 48 },
  gauge: { minWidth: 92, borderRadius: 14, padding: 10, backgroundColor: '#0e1518', borderWidth: 1, borderColor: '#26343a' },
  gaugeLabel: { color: tactile.colors.etched, fontSize: 9, fontWeight: '900', letterSpacing: 1.2, textTransform: 'uppercase' },
  gaugeMarks: { flexDirection: 'row', gap: 4, marginTop: 8, marginBottom: 6 },
  gaugeMark: { width: 8, height: 18, borderRadius: 3, backgroundColor: '#23343a', shadowOpacity: 0.8, shadowRadius: 6 },
  gaugeValue: { color: tactile.colors.text, fontSize: 13, fontWeight: '800' },
});
