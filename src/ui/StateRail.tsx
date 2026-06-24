import { StyleSheet, Text, View } from 'react-native';
import type { AgaState } from '../aga/stateMachine';

const STEPS: { key: AgaState; label: string }[] = [
  { key: 'armed', label: 'Wake' },
  { key: 'listening', label: 'Listen' },
  { key: 'thinking', label: 'Think' },
  { key: 'speaking', label: 'Speak' },
  { key: 'playing_media', label: 'Media' },
  { key: 'translating', label: 'Translate' },
];

export function StateRail({ state }: { state: AgaState }) {
  return (
    <View style={styles.rail}>
      {STEPS.map((step) => {
        const active = step.key === state || (state === 'wake_confirmed' && step.key === 'armed');
        return (
          <View key={step.key} style={[styles.step, active && styles.activeStep]}>
            <View style={[styles.dot, active && styles.activeDot]} />
            <Text style={[styles.label, active && styles.activeLabel]}>{step.label}</Text>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  rail: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  step: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  activeStep: { backgroundColor: 'rgba(103,232,249,0.16)', borderColor: '#67e8f9' },
  dot: { width: 7, height: 7, borderRadius: 7, backgroundColor: 'rgba(255,255,255,0.28)' },
  activeDot: { backgroundColor: '#fef3c7' },
  label: { color: 'rgba(231,238,255,0.7)', fontSize: 11, fontWeight: '800' },
  activeLabel: { color: '#fff7ed' },
});
