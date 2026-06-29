import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { getVoiceTelemetrySnapshot, subscribeVoiceTelemetry, type VoiceTelemetrySnapshot } from '../voice/voiceTelemetryStore';
import { getTurnLogs, subscribeTurnLogs, type TurnLogEntry } from '../voice/turnLogStore';
import { runExclusiveVoiceTurn } from '../voice/exclusiveVoiceTurn';

type Props = {
  mode?: string;
  messages?: any[];
  interim?: string;
  speechStatus?: string;
  ttsStatus?: string;
  error?: string | null;
  activeChoiceMenu?: any;
  sessionLabel?: string | null;
  activeMedia?: any;
  audioLevel?: number;
  voiceTurn?: any;
  showDebug?: boolean;
};

function useTelemetry() {
  const [snapshot, setSnapshot] = useState<VoiceTelemetrySnapshot>(() => getVoiceTelemetrySnapshot());
  useEffect(() => subscribeVoiceTelemetry(setSnapshot), []);
  return snapshot;
}

function useLogs() {
  const [logs, setLogs] = useState<TurnLogEntry[]>(() => getTurnLogs());
  useEffect(() => subscribeTurnLogs(setLogs), []);
  return logs;
}

function phaseFrom(props: Props, telemetry: VoiceTelemetrySnapshot) {
  if (props.error || telemetry.error) return 'error';
  const phase = String(props.voiceTurn?.phase || telemetry.phase || props.mode || 'wake_listening');
  if (telemetry.assistantSpeaking || phase === 'speaking') return 'speaking';
  if (phase === 'live_session' || props.mode === 'live' || props.mode === 'live_session') return 'live_session';
  if (props.activeChoiceMenu) return 'voice_menu';
  if (props.interim || telemetry.transcript) return telemetry.commandWindowActive ? 'command_window' : 'capturing_user';
  if (['thinking', 'tool_call', 'transcribing', 'guided_session', 'media', 'error'].includes(phase)) return phase;
  return 'wake_listening';
}

function phaseLabel(phase: string) {
  switch (phase) {
    case 'speaking': return 'AGA SPEAKING';
    case 'thinking': return 'AGA THINKING';
    case 'tool_call': return 'USING TOOL';
    case 'transcribing': return 'TRANSCRIBING';
    case 'capturing_user': return 'LISTENING TO YOU';
    case 'command_window': return 'COMMAND WINDOW';
    case 'live_session': return 'LIVE CONVERSATION';
    case 'guided_session': return 'GUIDED SESSION';
    case 'voice_menu': return 'VOICE MENU';
    case 'media': return 'MEDIA';
    case 'error': return 'NEEDS ATTENTION';
    default: return 'YOUR TURN';
  }
}

function phaseSubtitle(phase: string, telemetry: VoiceTelemetrySnapshot) {
  if (phase === 'speaking') return 'Mic paused so AGA does not hear its own voice.';
  if (phase === 'thinking') return 'Mic paused while AGA chooses exactly one route.';
  if (phase === 'tool_call') return 'Running the selected tool for this turn only.';
  if (phase === 'transcribing') return 'Converting speech to text.';
  if (phase === 'capturing_user') return 'Keep speaking naturally.';
  if (phase === 'command_window') return 'Say the command now.';
  if (phase === 'live_session') return 'Back-and-forth mode. Say stop to end.';
  if (phase === 'guided_session') return 'Guided skill is active. Say stop anytime.';
  if (phase === 'voice_menu') return 'Say the number, letter, or option name.';
  if (phase === 'error') return telemetry.error || 'Something needs recovery.';
  return 'Mic open. AGA is waiting for you.';
}

function micLabel(telemetry: VoiceTelemetrySnapshot) {
  if (telemetry.assistantSpeaking) return 'MIC PAUSED';
  if (!telemetry.micOpen || !telemetry.canAcceptUserSpeech) return 'MIC CLOSED';
  return 'MIC OPEN';
}

function Waveform({ telemetry }: { telemetry: VoiceTelemetrySnapshot }) {
  const bars = telemetry.waveform && telemetry.waveform.length ? telemetry.waveform : Array.from({ length: 48 }, () => telemetry.audioLevel || 0.03);
  return (
    <View style={styles.waveWrap}>
      <View style={styles.waveHeader}>
        <Text style={styles.kicker}>WAVEFORM</Text>
        <Text style={styles.smallMono}>rms {telemetry.rms.toFixed(3)} · peak {telemetry.peak.toFixed(3)}</Text>
      </View>
      <View style={styles.waveBars}>
        {bars.slice(-48).map((value, index) => {
          const height = 8 + Math.round(Math.max(0.02, value) * 52);
          return <View key={`${index}-${height}`} style={[styles.waveBar, { height }]} />;
        })}
      </View>
    </View>
  );
}

function Transcript({ logs }: { logs: TurnLogEntry[] }) {
  const shown = logs.filter((l) => ['received', 'route_decided', 'tool_executed', 'short_gpt_done', 'live_started', 'tts_started', 'error'].includes(l.stage)).slice(0, 18);
  return (
    <View style={styles.transcriptBox}>
      <Text style={styles.sectionTitle}>Recent turn transcript</Text>
      <ScrollView style={styles.transcriptScroll} nestedScrollEnabled>
        {shown.length === 0 ? <Text style={styles.dim}>No turns yet.</Text> : shown.map((entry) => (
          <View key={entry.id} style={styles.logRow}>
            <Text style={styles.logMeta}>{new Date(entry.at).toLocaleTimeString()} · {entry.turnId.split('_').slice(-2).join('_')} · {entry.stage}</Text>
            <Text style={styles.logText}>{entry.toolName ? `[${entry.toolName}] ` : ''}{entry.text || entry.route || ''}</Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

export function AgaUnifiedConsole(props: Props) {
  const telemetry = useTelemetry();
  const logs = useLogs();
  const phase = phaseFrom(props, telemetry);
  const label = phaseLabel(phase);
  const subtitle = phaseSubtitle(phase, telemetry);
  const directStatus = telemetry.status || props.speechStatus || props.ttsStatus || 'ready';
  const wakeFallback = telemetry.wakeEngine === 'volume' || /fallback/i.test(directStatus);

  const latestUserText = useMemo(() => logs.find((l) => l.stage === 'received')?.text || telemetry.transcript || props.interim || '', [logs, telemetry.transcript, props.interim]);

  return (
    <View style={styles.root}>
      <View style={styles.banner}>
        <View style={styles.bannerText}>
          <Text style={styles.kicker}>AGA TURN</Text>
          <Text style={styles.title}>{label}</Text>
          <Text style={styles.subtitle}>{subtitle}</Text>
        </View>
        <View style={[styles.micPill, telemetry.micOpen && !telemetry.assistantSpeaking ? styles.micOpen : styles.micClosed]}>
          <Text style={styles.micPillText}>{micLabel(telemetry)}</Text>
        </View>
      </View>

      <View style={styles.grid}>
        <View style={styles.visualCard}>
          <View style={[styles.orb, phase === 'speaking' && styles.orbSpeaking, phase === 'live_session' && styles.orbLive]}>
            <Text style={styles.angel}>◡̈</Text>
            <View style={[styles.halo, { opacity: Math.max(0.18, telemetry.audioLevel) }]} />
          </View>
          <Text style={styles.statusText}>{directStatus}</Text>
          {latestUserText ? <Text style={styles.latestText}>heard: {latestUserText}</Text> : null}
        </View>

        <View style={styles.telemetryCard}>
          <Text style={styles.sectionTitle}>Wake engine</Text>
          <Text style={styles.statusLine}>engine: {telemetry.wakeEngine}</Text>
          <Text style={styles.statusLine}>provider: {telemetry.provider}</Text>
          <Text style={styles.statusLine}>command window: {telemetry.commandWindowActive ? 'yes' : 'no'}</Text>
          <Text style={styles.statusLine}>confidence: {telemetry.wakeConfidence.toFixed(2)} {telemetry.wakeKeyword ? `(${telemetry.wakeKeyword})` : ''}</Text>
          {wakeFallback ? <Text style={styles.warning}>Sherpa fallback/volume mode — not real keyword spotting.</Text> : null}
        </View>
      </View>

      <Waveform telemetry={telemetry} />

      {props.activeChoiceMenu ? (
        <View style={styles.menuBox}>
          <Text style={styles.sectionTitle}>{props.activeChoiceMenu.title || 'Voice menu'}</Text>
          {(props.activeChoiceMenu.options || []).slice(0, 8).map((option: any) => (
            <Text key={option.key || option.label} style={styles.menuOption}>{option.key || ''}. {option.label || String(option)}</Text>
          ))}
        </View>
      ) : null}

      <Transcript logs={logs} />

      {props.showDebug ? (
        <View style={styles.debugButtons}>
          <Pressable style={styles.debugButton} onPress={() => runExclusiveVoiceTurn('what time is it', { source: 'debug_button' })}><Text style={styles.debugButtonText}>test time</Text></Pressable>
          <Pressable style={styles.debugButton} onPress={() => runExclusiveVoiceTurn('open youtube calm music', { source: 'debug_button' })}><Text style={styles.debugButtonText}>test youtube</Text></Pressable>
          <Pressable style={styles.debugButton} onPress={() => runExclusiveVoiceTurn('start live conversation', { source: 'debug_button' })}><Text style={styles.debugButtonText}>test live</Text></Pressable>
        </View>
      ) : null}
    </View>
  );
}

export default AgaUnifiedConsole;

const styles = StyleSheet.create({
  root: { width: '100%', gap: 14, padding: 16 },
  banner: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderWidth: 1, borderColor: '#1bdee8', backgroundColor: 'rgba(3,18,22,0.88)', borderRadius: 24, padding: 18, shadowColor: '#00f5ff', shadowOpacity: 0.25, shadowRadius: 18 },
  bannerText: { flex: 1, paddingRight: 12 },
  kicker: { color: '#81faff', fontSize: 11, letterSpacing: 2.4, fontWeight: '800', textTransform: 'uppercase' },
  title: { color: '#f3ffff', fontSize: 34, lineHeight: 38, fontWeight: '900', marginTop: 4 },
  subtitle: { color: '#b9d9de', fontSize: 15, marginTop: 6 },
  micPill: { borderRadius: 999, paddingHorizontal: 16, paddingVertical: 12, borderWidth: 1 },
  micOpen: { borderColor: '#51f6ff', backgroundColor: 'rgba(0,255,240,0.16)' },
  micClosed: { borderColor: '#ffce68', backgroundColor: 'rgba(255,206,104,0.16)' },
  micPillText: { color: '#ffffff', fontWeight: '900', fontSize: 13, letterSpacing: 1.3 },
  grid: { flexDirection: 'row', gap: 14, flexWrap: 'wrap' },
  visualCard: { flexGrow: 1, flexBasis: 360, minHeight: 260, borderRadius: 28, borderWidth: 1, borderColor: 'rgba(116,250,255,0.32)', backgroundColor: 'rgba(3,12,18,0.76)', alignItems: 'center', justifyContent: 'center', padding: 18 },
  telemetryCard: { flexGrow: 1, flexBasis: 260, borderRadius: 24, borderWidth: 1, borderColor: 'rgba(116,250,255,0.22)', backgroundColor: 'rgba(3,12,18,0.70)', padding: 18 },
  orb: { width: 168, height: 168, borderRadius: 84, borderWidth: 1, borderColor: 'rgba(114,246,255,0.52)', backgroundColor: 'rgba(154,255,255,0.12)', alignItems: 'center', justifyContent: 'center' },
  orbSpeaking: { borderColor: 'rgba(255,220,138,0.8)', backgroundColor: 'rgba(255,220,138,0.18)' },
  orbLive: { borderColor: 'rgba(168,120,255,0.9)', backgroundColor: 'rgba(168,120,255,0.16)' },
  angel: { color: '#f5ffff', fontSize: 72, fontWeight: '900' },
  halo: { position: 'absolute', bottom: 46, width: 86, height: 18, borderRadius: 18, borderWidth: 3, borderColor: '#66faff' },
  statusText: { color: '#d9ffff', fontWeight: '700', marginTop: 16, textAlign: 'center' },
  latestText: { color: '#a8cace', marginTop: 8, textAlign: 'center' },
  sectionTitle: { color: '#f2ffff', fontSize: 18, fontWeight: '900', marginBottom: 10 },
  statusLine: { color: '#cfe9ed', fontSize: 14, marginBottom: 7 },
  warning: { color: '#ffcf72', fontWeight: '800', marginTop: 10 },
  waveWrap: { borderRadius: 24, borderWidth: 1, borderColor: 'rgba(116,250,255,0.26)', backgroundColor: 'rgba(1,10,16,0.82)', padding: 16 },
  waveHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  smallMono: { color: '#a9c9cc', fontFamily: 'monospace' as any, fontSize: 12 },
  waveBars: { height: 72, flexDirection: 'row', alignItems: 'center', gap: 6 },
  waveBar: { flex: 1, maxWidth: 12, minWidth: 4, borderRadius: 999, backgroundColor: '#5cf8ff', shadowColor: '#5cf8ff', shadowOpacity: 0.75, shadowRadius: 10 },
  transcriptBox: { borderRadius: 24, borderWidth: 1, borderColor: 'rgba(116,250,255,0.22)', backgroundColor: 'rgba(2,9,14,0.84)', padding: 16, maxHeight: 360 },
  transcriptScroll: { maxHeight: 280 },
  dim: { color: '#839ca2' },
  logRow: { paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.07)' },
  logMeta: { color: '#7cdde8', fontFamily: 'monospace' as any, fontSize: 11, marginBottom: 3 },
  logText: { color: '#effcff', fontSize: 14, lineHeight: 20 },
  menuBox: { borderRadius: 24, borderWidth: 1, borderColor: 'rgba(255,220,138,0.35)', backgroundColor: 'rgba(24,19,4,0.72)', padding: 16 },
  menuOption: { color: '#ffe3a2', fontSize: 15, marginTop: 5 },
  debugButtons: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  debugButton: { borderRadius: 999, backgroundColor: '#eaf0ff', paddingHorizontal: 16, paddingVertical: 12 },
  debugButtonText: { color: '#111827', fontWeight: '900' },
});
