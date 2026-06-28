import React, { useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { getRecentTranscript, subscribeRecentTranscript } from '../voice/recentTranscriptStore';
import { transcriptFromSnapshot } from '../voice/voiceTurnState';
import type { VoiceTranscriptLine } from '../voice/voiceTurnMachine';

function roleLabel(role: string) {
  if (role === 'assistant') return 'AGA';
  if (role === 'user') return 'You';
  if (role === 'tool') return 'Tool';
  return 'System';
}

function timeLabel(iso?: string) {
  const date = iso ? new Date(iso) : new Date();
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function mergeById(a: VoiceTranscriptLine[], b: VoiceTranscriptLine[]) {
  const map = new Map<string, VoiceTranscriptLine>();
  for (const line of [...a, ...b]) {
    const key = line.id || `${line.turnId}:${line.role}:${line.text}`;
    map.set(key, line);
  }
  return Array.from(map.values()).sort((x, y) => String(x.createdAt).localeCompare(String(y.createdAt))).slice(-120);
}

export function FullRecentTranscriptPanel({ snapshot, max = 80 }: { snapshot?: any; max?: number }) {
  const [stored, setStored] = useState<VoiceTranscriptLine[]>(() => getRecentTranscript(max));

  useEffect(() => subscribeRecentTranscript((lines) => setStored(lines.slice(-max))), [max]);

  const lines = useMemo(() => {
    const live = transcriptFromSnapshot(snapshot, max);
    return mergeById(stored, live).slice(-max);
  }, [snapshot, stored, max]);

  return (
    <View style={styles.panel}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Recent transcript</Text>
        <Text style={styles.count}>{lines.length} lines</Text>
      </View>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        {lines.length === 0 ? (
          <Text style={styles.empty}>No transcript yet. Wake AGA and speak.</Text>
        ) : lines.map((line) => (
          <View key={line.id} style={[styles.line, line.role === 'user' ? styles.userLine : line.role === 'assistant' ? styles.assistantLine : styles.systemLine]}>
            <View style={styles.metaRow}>
              <Text style={styles.role}>{roleLabel(line.role)}</Text>
              <Text style={styles.time}>{timeLabel(line.createdAt)}</Text>
              {!line.final && <Text style={styles.interim}>live</Text>}
            </View>
            <Text style={styles.text}>{line.text}</Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    width: '100%',
    maxHeight: 360,
    borderRadius: 24,
    borderWidth: 1,
    borderColor: 'rgba(152, 220, 255, 0.25)',
    backgroundColor: 'rgba(2, 8, 18, 0.72)',
    padding: 14,
  },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  title: { color: '#dff8ff', fontSize: 14, fontWeight: '900', letterSpacing: 1.1, textTransform: 'uppercase' },
  count: { color: 'rgba(223,248,255,0.55)', fontSize: 12, fontWeight: '700' },
  scroll: { maxHeight: 292 },
  content: { gap: 10, paddingBottom: 6 },
  empty: { color: 'rgba(223,248,255,0.58)', fontSize: 14, lineHeight: 21, fontWeight: '700' },
  line: { borderRadius: 18, padding: 12, borderWidth: 1 },
  userLine: { borderColor: 'rgba(120,220,255,0.25)', backgroundColor: 'rgba(32,86,120,0.18)' },
  assistantLine: { borderColor: 'rgba(255,214,126,0.22)', backgroundColor: 'rgba(90,60,18,0.20)' },
  systemLine: { borderColor: 'rgba(190,190,210,0.16)', backgroundColor: 'rgba(90,90,120,0.10)' },
  metaRow: { flexDirection: 'row', gap: 8, alignItems: 'center', marginBottom: 5 },
  role: { color: '#ffffff', fontSize: 11, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 0.9 },
  time: { color: 'rgba(223,248,255,0.48)', fontSize: 11, fontWeight: '700' },
  interim: { color: '#9ee8ff', fontSize: 10, fontWeight: '900', textTransform: 'uppercase' },
  text: { color: '#f4fbff', fontSize: 15, lineHeight: 21, fontWeight: '700' },
});

export default FullRecentTranscriptPanel;
