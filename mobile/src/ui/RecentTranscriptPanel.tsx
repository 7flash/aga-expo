import React, { useEffect, useRef } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { transcriptFromSnapshot, type TranscriptLine } from '../voice/voiceTurnState';

function roleLabel(role: TranscriptLine['role']) {
  if (role === 'user') return 'YOU';
  if (role === 'assistant') return 'AGA';
  if (role === 'tool') return 'TOOL';
  return 'SYSTEM';
}

function roleStyle(role: TranscriptLine['role']) {
  if (role === 'user') return styles.user;
  if (role === 'assistant') return styles.assistant;
  if (role === 'tool') return styles.tool;
  return styles.system;
}

export function RecentTranscriptPanel({ snapshot, max = 40 }: { snapshot: any; max?: number }) {
  const rows = transcriptFromSnapshot(snapshot, max);
  const scrollRef = useRef<ScrollView | null>(null);

  useEffect(() => {
    const t = setTimeout(() => scrollRef.current?.scrollToEnd?.({ animated: true }), 80);
    return () => clearTimeout(t);
  }, [rows.length, rows[rows.length - 1]?.text]);

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.title}>RECENT TRANSCRIPT</Text>
        <Text style={styles.count}>{rows.length}</Text>
      </View>
      <ScrollView ref={scrollRef} style={styles.scroll} contentContainerStyle={styles.scrollInner}>
        {rows.length ? rows.map((row) => (
          <View key={row.id} style={[styles.row, roleStyle(row.role)]}>
            <Text style={styles.role}>{roleLabel(row.role)}</Text>
            <Text selectable style={styles.text}>{row.text}</Text>
            {!!row.createdAt && <Text style={styles.meta}>{row.createdAt}</Text>}
          </View>
        )) : <Text style={styles.empty}>No transcript yet. Say AGA and speak.</Text>}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderColor: 'rgba(142,164,220,0.34)', borderRadius: 24, backgroundColor: 'rgba(4,6,12,0.86)', overflow: 'hidden' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, borderBottomColor: 'rgba(142,164,220,0.22)', borderBottomWidth: 1 },
  title: { color: '#dce6ff', fontWeight: '900', letterSpacing: 1.8, fontSize: 12 },
  count: { color: '#8fa2c9', fontWeight: '900' },
  scroll: { maxHeight: 360 },
  scrollInner: { padding: 12, gap: 10 },
  row: { borderLeftWidth: 3, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.045)' },
  user: { borderLeftColor: '#66f2c2' },
  assistant: { borderLeftColor: '#f8d88d' },
  tool: { borderLeftColor: '#6fc5ff' },
  system: { borderLeftColor: '#a2adc8' },
  role: { color: '#91a0c5', fontSize: 10, letterSpacing: 1.6, fontWeight: '900', marginBottom: 5 },
  text: { color: '#f7f9ff', fontSize: 15, lineHeight: 21 },
  meta: { color: '#6f7c9d', fontSize: 10, marginTop: 6 },
  empty: { color: '#8491b2', padding: 12 },
});
