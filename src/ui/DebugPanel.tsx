import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { EventLog, UserPreferences } from '../db/schema';
import type { AgaState } from '../aga/stateMachine';
import type { NowPlaying } from '../media/nowPlaying';

export function DebugPanel({
  visible,
  state,
  prefs,
  voiceAvailable,
  nowPlaying,
  events,
}: {
  visible: boolean;
  state: AgaState;
  prefs: UserPreferences | null;
  voiceAvailable: boolean;
  nowPlaying: NowPlaying;
  events: EventLog[];
}) {
  if (!visible) return null;

  return (
    <View style={styles.card}>
      <Text style={styles.title}>AGA diagnostics</Text>
      <Text style={styles.line}>state: {state}</Text>
      <Text style={styles.line}>voice: {voiceAvailable ? 'native module ready' : 'native STT missing'}</Text>
      <Text style={styles.line}>persona: {prefs?.activePersona ?? 'unknown'} · wake: {prefs?.wakePhrase ?? 'hey aga'}</Text>
      <Text style={styles.line}>brain: {prefs?.backendMode ?? 'unknown'} · translate: {prefs?.translateTargetLang ?? 'off'} · proactive: {prefs?.proactiveEnabled ? 'on' : 'off'}</Text>
      <Text style={styles.line}>media: {nowPlaying.kind === null ? 'none' : `${nowPlaying.kind} · ${nowPlaying.state} · ${nowPlaying.title}`}</Text>
      <Text style={styles.subtitle}>Recent events</Text>
      {events.slice(0, 8).map((event) => (
        <Text style={styles.event} key={event.id}>[{event.kind}] {event.label}{event.durationMs ? ` · ${event.durationMs.toFixed(0)}ms` : ''}</Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: 6,
    padding: 14,
    borderRadius: 22,
    backgroundColor: 'rgba(15,23,42,0.78)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(103,232,249,0.35)',
  },
  title: { color: '#67e8f9', fontSize: 16, fontWeight: '900' },
  subtitle: { color: '#fef3c7', fontSize: 12, fontWeight: '900', marginTop: 8, textTransform: 'uppercase', letterSpacing: 1.2 },
  line: { color: '#dbeafe', fontSize: 12, lineHeight: 17 },
  event: { color: 'rgba(231,238,255,0.7)', fontSize: 11, lineHeight: 16 },
});
