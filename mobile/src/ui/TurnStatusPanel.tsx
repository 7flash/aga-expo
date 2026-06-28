import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { normalizeVoiceTurnPhase, shouldShowMicOpen, turnPhaseHint, turnPhaseLabel, type VoiceTurnPhase } from '../voice/voiceTurnState';
import { getSpeakListenGateSnapshot } from '../voice/speakListenGate';

function phaseTone(phase: VoiceTurnPhase) {
  if (phase === 'speaking') return styles.toneSpeaking;
  if (phase === 'capturing_user' || phase === 'wake_listening' || phase === 'live_session') return styles.toneListening;
  if (phase === 'thinking' || phase === 'routing' || phase === 'tool_running' || phase === 'transcribing') return styles.toneThinking;
  if (phase === 'error' || phase === 'recovering') return styles.toneError;
  return styles.toneIdle;
}

export function TurnStatusPanel({ snapshot, allowBargeIn = false }: { snapshot: any; allowBargeIn?: boolean }) {
  const phase = normalizeVoiceTurnPhase(snapshot);
  const gate = getSpeakListenGateSnapshot();
  const micOpen = shouldShowMicOpen(phase, allowBargeIn) && !gate.outputActive;
  const gateReason = gate.outputActive ? 'speaker active' : Date.now() < gate.captureBlockedUntil ? gate.reason : '';

  return (
    <View style={[styles.card, phaseTone(phase)]}>
      <View style={styles.topRow}>
        <Text style={styles.kicker}>VOICE TURN</Text>
        <View style={[styles.micPill, micOpen ? styles.micOpen : styles.micClosed]}>
          <Text style={styles.micText}>{micOpen ? 'MIC OPEN' : 'MIC PAUSED'}</Text>
        </View>
      </View>
      <Text style={styles.title}>{turnPhaseLabel(phase)}</Text>
      <Text style={styles.hint}>{turnPhaseHint(phase)}</Text>
      {!!snapshot?.speechStatus && <Text style={styles.status}>{String(snapshot.speechStatus)}</Text>}
      {!!gateReason && <Text style={styles.gate}>Gate: {gateReason}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 24, padding: 18, gap: 8, backgroundColor: 'rgba(5,8,14,0.88)' },
  topRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  kicker: { color: '#9aa6c6', fontSize: 11, letterSpacing: 2.4, fontWeight: '900' },
  title: { color: '#f8fbff', fontSize: 26, fontWeight: '900' },
  hint: { color: '#c9d2ef', fontSize: 14, lineHeight: 20 },
  status: { color: '#8fa2c9', fontSize: 12, marginTop: 2 },
  gate: { color: '#f8d88d', fontSize: 12, marginTop: 2 },
  micPill: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7, borderWidth: 1 },
  micOpen: { borderColor: '#66f2c2', backgroundColor: 'rgba(102,242,194,0.14)' },
  micClosed: { borderColor: '#f8d88d', backgroundColor: 'rgba(248,216,141,0.14)' },
  micText: { color: '#f8fbff', fontSize: 11, fontWeight: '900', letterSpacing: 1.2 },
  toneListening: { borderColor: 'rgba(102,242,194,0.72)' },
  toneSpeaking: { borderColor: 'rgba(248,216,141,0.8)' },
  toneThinking: { borderColor: 'rgba(111,197,255,0.72)' },
  toneError: { borderColor: 'rgba(255,108,108,0.8)' },
  toneIdle: { borderColor: 'rgba(120,135,170,0.46)' },
});
