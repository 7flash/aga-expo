import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { VOICE_ONLY_QA_STEPS } from '../setup/qaScripts';

export function QaScriptPanel({ visible }: { visible: boolean }) {
  if (!visible) return null;

  return (
    <View style={styles.card}>
      <Text style={styles.kicker}>Manual voice-only QA</Text>
      <Text style={styles.title}>Run these commands without touching the screen</Text>
      {VOICE_ONLY_QA_STEPS.map((step, index) => (
        <View key={step.id} style={styles.row}>
          <Text style={styles.number}>{index + 1}</Text>
          <View style={styles.copy}>
            <Text style={styles.command}>{step.command}</Text>
            <Text style={styles.expected}>{step.expected}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: 12, padding: 14, borderRadius: 24, backgroundColor: 'rgba(15,23,42,0.62)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.14)' },
  kicker: { color: '#67e8f9', fontSize: 11, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 1.2 },
  title: { color: '#fff7ed', fontSize: 18, fontWeight: '900', lineHeight: 23 },
  row: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  number: { width: 26, height: 26, borderRadius: 10, textAlign: 'center', textAlignVertical: 'center', color: '#06111c', backgroundColor: '#fef3c7', fontSize: 12, fontWeight: '900', overflow: 'hidden' },
  copy: { flex: 1, minWidth: 0 },
  command: { color: '#f8fbff', fontSize: 13, fontWeight: '900' },
  expected: { color: '#cbd5e1', fontSize: 12, lineHeight: 17, marginTop: 2 },
});
