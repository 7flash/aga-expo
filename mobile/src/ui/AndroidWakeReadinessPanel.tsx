import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

export type AndroidWakeReadiness = {
  nativeSherpaMapped?: boolean;
  nativeCaptureMapped?: boolean;
  foregroundServiceMapped?: boolean;
  aecAvailable?: boolean;
  wakeTelemetryContract?: boolean;
};

export function AndroidWakeReadinessPanel({ readiness = {} as AndroidWakeReadiness }) {
  const rows = [
    ['Native Sherpa adapter', readiness.nativeSherpaMapped],
    ['Native mic capture', readiness.nativeCaptureMapped],
    ['Foreground microphone service', readiness.foregroundServiceMapped],
    ['AEC / noise suppression', readiness.aecAvailable],
    ['Shared telemetry contract', readiness.wakeTelemetryContract ?? true],
  ] as const;

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Android wake readiness</Text>
      {rows.map(([label, ok]) => (
        <View key={label} style={styles.row}>
          <Text style={styles.dot}>{ok ? '●' : '○'}</Text>
          <Text style={styles.label}>{label}</Text>
          <Text style={[styles.value, ok ? styles.good : styles.warn]}>{ok ? 'ready' : 'needs native wiring'}</Text>
        </View>
      ))}
      <Text style={styles.note}>Browser waveform and Android waveform should feed the same VoiceTelemetry shape. The UI should not depend on WebAudio.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderColor: '#243047', backgroundColor: '#08111d', borderRadius: 18, padding: 18, gap: 10 },
  title: { color: '#f4f7ff', fontSize: 20, fontWeight: '800' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dot: { color: '#8eeaff', fontSize: 16 },
  label: { flex: 1, color: '#dbe5ff', fontWeight: '700' },
  value: { fontWeight: '900', fontSize: 12, textTransform: 'uppercase' },
  good: { color: '#77ffbd' },
  warn: { color: '#ffd166' },
  note: { color: '#9aa9c7', lineHeight: 20, marginTop: 8 },
});
