import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, ScrollView, StyleSheet, Text, View } from 'react-native';
import { getVoiceTelemetrySnapshot, subscribeVoiceTelemetry, type VoiceTelemetrySnapshot } from '../voice/voiceTelemetryStore';
import { colors, radius, spacing } from './theme';

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
};

function useVoiceTelemetry() {
  const [snapshot, setSnapshot] = useState<VoiceTelemetrySnapshot>(() => getVoiceTelemetrySnapshot());
  useEffect(() => subscribeVoiceTelemetry(setSnapshot), []);
  return snapshot;
}

function normalizePhase(props: Props, telemetry: VoiceTelemetrySnapshot) {
  const voiceTurn = props.voiceTurn;
  const phase = String(voiceTurn?.phase || telemetry.phase || props.mode || 'wake_listening');
  if (props.error || telemetry.error) return 'error';
  if (phase === 'speaking' || props.mode === 'speaking' || telemetry.assistantSpeaking) return 'speaking';
  if (phase === 'live_session' || props.mode === 'live' || props.mode === 'live_session') return 'live_session';
  if (props.activeChoiceMenu) return 'voice_menu';
  if (props.activeMedia && props.mode === 'media') return 'media';
  if (props.interim || telemetry.transcript) return telemetry.commandWindowActive ? 'command_window' : 'capturing_user';
  if (['thinking', 'tool_call', 'transcribing'].includes(phase)) return phase;
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
    case 'voice_menu': return 'VOICE MENU';
    case 'media': return 'MEDIA';
    case 'error': return 'NEEDS ATTENTION';
    default: return 'YOUR TURN';
  }
}

function phaseSubtitle(phase: string, props: Props, telemetry: VoiceTelemetrySnapshot) {
  if (phase === 'speaking') return 'Mic paused so AGA does not hear its own voice.';
  if (phase === 'thinking') return 'Mic paused while AGA decides the next action.';
  if (phase === 'tool_call') return 'Running one selected tool for this turn.';
  if (phase === 'transcribing') return 'Converting speech to text.';
  if (phase === 'capturing_user') return 'Keep speaking naturally.';
  if (phase === 'command_window') return 'Say the command now.';
  if (phase === 'live_session') return 'Back-and-forth mode. Say stop to end.';
  if (phase === 'voice_menu') return 'Say one, two, A, B, or the option name.';
  if (phase === 'media') return 'Voice media controls are active.';
  if (phase === 'error') return String(props.error || telemetry.error || 'Something failed. Say try again.');
  return telemetry.wakeEngine === 'sherpa_wasm'
    ? 'Waiting for AGA wake detection.'
    : 'Mic is open. Speak to wake AGA.';
}

function normalizeMessages(messages: any[] = [], interim?: string, telemetry?: VoiceTelemetrySnapshot) {
  const rows = messages.slice(-30).map((message, index) => ({
    id: String(message.id || message.createdAt || index),
    role: String(message.role || 'system'),
    text: String(message.content || message.text || message.message || '').trim(),
    at: message.createdAt || message.at || '',
    pending: false,
  })).filter((row) => row.text);

  const heard = String(interim || telemetry?.transcript || telemetry?.sttText || '').trim();
  if (heard) {
    rows.push({ id: 'current-interim', role: 'user', text: heard, at: '', pending: true });
  }

  const reply = String(telemetry?.reply || '').trim();
  if (reply && !rows.some((row) => row.role === 'assistant' && row.text === reply)) {
    rows.push({ id: 'telemetry-reply', role: 'assistant', text: reply, at: '', pending: false });
  }

  return rows.slice(-24);
}

function Bar({ value, index }: { value: number; index: number }) {
  const h = 8 + Math.round(value * (18 + (index % 6) * 6));
  return <View style={[styles.waveBar, { height: h, opacity: 0.32 + Math.min(1, value + 0.25) * 0.68 }]} />;
}

function IntegratedWaveform({ telemetry, audioLevel, phase }: { telemetry: VoiceTelemetrySnapshot; audioLevel?: number; phase: string }) {
  const tick = useRef(new Animated.Value(0)).current;
  const level = Math.max(0, Math.min(1, typeof audioLevel === 'number' && audioLevel > 0 ? audioLevel : telemetry.audioLevel));

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(tick, { toValue: 1, duration: 900, useNativeDriver: false }),
        Animated.timing(tick, { toValue: 0, duration: 900, useNativeDriver: false }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [tick]);

  const values = useMemo(() => {
    const base = phase === 'speaking' ? 0.55 : phase === 'thinking' ? 0.28 : level;
    return Array.from({ length: 40 }, (_, i) => {
      const wave = Math.sin((i / 40) * Math.PI * 2 + Date.now() / 260) * 0.5 + 0.5;
      const pulse = Math.sin((i / 40) * Math.PI * 6 - Date.now() / 380) * 0.5 + 0.5;
      return Math.max(0.08, Math.min(1, base * 0.78 + wave * 0.12 + pulse * 0.10));
    });
  }, [level, phase, telemetry.at]);

  return (
    <View style={styles.waveShell}>
      <View style={styles.waveHeader}>
        <Text style={styles.waveTitle}>VOICE WAVEFORM</Text>
        <Text style={styles.waveMeta}>{telemetry.wakeEngine || telemetry.provider || 'wake'} · rms {(telemetry.rms * 100).toFixed(1)} · peak {(telemetry.peak * 100).toFixed(1)}</Text>
      </View>
      <View style={styles.waveBars}>{values.map((value, index) => <Bar key={index} value={value} index={index} />)}</View>
      <View style={styles.levelRail}><View style={[styles.levelFill, { width: `${Math.round(level * 100)}%` }]} /></View>
      {!!telemetry.wakeKeyword && (
        <Text style={styles.wakeLine}>wake: {telemetry.wakeKeyword} {telemetry.wakeConfidence ? `· ${(telemetry.wakeConfidence * 100).toFixed(0)}%` : ''}</Text>
      )}
      {!!telemetry.status && <Text style={styles.telemetryStatus}>{telemetry.status}</Text>}
    </View>
  );
}

function Transcript({ rows }: { rows: ReturnType<typeof normalizeMessages> }) {
  return (
    <View style={styles.transcriptShell}>
      <Text style={styles.transcriptTitle}>RECENT TRANSCRIPT</Text>
      <ScrollView showsVerticalScrollIndicator contentContainerStyle={styles.transcriptContent}>
        {rows.length ? rows.map((row) => (
          <View key={row.id} style={[styles.turnRow, row.role === 'assistant' ? styles.assistantRow : styles.userRow]}>
            <Text style={styles.turnRole}>{row.role === 'assistant' ? 'AGA' : row.role.toUpperCase()}{row.pending ? ' · LIVE' : ''}</Text>
            <Text style={styles.turnText}>{row.text}</Text>
          </View>
        )) : (
          <View style={styles.emptyTranscript}>
            <Text style={styles.emptyTranscriptTitle}>No turns yet</Text>
            <Text style={styles.emptyTranscriptText}>Speak to wake AGA. Full turns will stay here in one place.</Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

function MenuPanel({ menu }: { menu: any }) {
  if (!menu) return null;
  return (
    <View style={styles.menuPanel}>
      <Text style={styles.menuTitle}>{menu.title || 'Voice menu'}</Text>
      {!!menu.subtitle && <Text style={styles.menuSubtitle}>{menu.subtitle}</Text>}
      {(menu.options || []).slice(0, 8).map((option: any) => (
        <View key={option.key || option.label} style={styles.menuOption}>
          <Text style={styles.menuKey}>{option.key}</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.menuLabel}>{option.label}</Text>
            {!!option.description && <Text style={styles.menuDescription}>{option.description}</Text>}
          </View>
        </View>
      ))}
      <Text style={styles.menuFooter}>Choose by voice.</Text>
    </View>
  );
}

export function AgaUnifiedConsole(props: Props) {
  const telemetry = useVoiceTelemetry();
  const phase = normalizePhase(props, telemetry);
  const rows = normalizeMessages(props.messages, props.interim, telemetry);
  const micLabel = telemetry.canAcceptUserSpeech && phase !== 'speaking' ? 'MIC OPEN' : 'MIC PAUSED';

  return (
    <View pointerEvents="box-none" style={styles.consoleRoot}>
      <View style={[styles.turnBanner, phase === 'speaking' && styles.turnBannerSpeaking, phase === 'error' && styles.turnBannerError]}>
        <View style={styles.turnHeaderRow}>
          <Text style={styles.phaseLabel}>{phaseLabel(phase)}</Text>
          <Text style={[styles.micBadge, telemetry.canAcceptUserSpeech ? styles.micOpen : styles.micPaused]}>{micLabel}</Text>
        </View>
        <Text style={styles.phaseSubtitle}>{phaseSubtitle(phase, props, telemetry)}</Text>
        {!!props.sessionLabel && <Text style={styles.sessionLine}>session: {props.sessionLabel}</Text>}
      </View>

      <View style={styles.middleGrid}>
        <IntegratedWaveform telemetry={telemetry} audioLevel={props.audioLevel} phase={phase} />
        <MenuPanel menu={props.activeChoiceMenu} />
      </View>

      <Transcript rows={rows} />
    </View>
  );
}

const GLASS = 'rgba(0, 15, 18, 0.72)';
const LINE = 'rgba(101, 245, 255, 0.34)';

const styles = StyleSheet.create({
  consoleRoot: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    top: spacing.md,
    bottom: spacing.md,
    zIndex: 30,
    justifyContent: 'space-between',
  },
  turnBanner: {
    borderRadius: 22,
    borderWidth: 1,
    borderColor: LINE,
    backgroundColor: GLASS,
    padding: spacing.md,
    shadowColor: colors.cyan,
    shadowOpacity: 0.25,
    shadowRadius: 16,
  },
  turnBannerSpeaking: { borderColor: 'rgba(255, 208, 110, 0.65)' },
  turnBannerError: { borderColor: 'rgba(255, 107, 131, 0.8)' },
  turnHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm },
  phaseLabel: { color: '#dfffff', fontSize: 22, fontWeight: '950', letterSpacing: 2.2 },
  phaseSubtitle: { color: 'rgba(220,255,255,0.78)', fontSize: 13, fontWeight: '800', marginTop: 6 },
  sessionLine: { color: '#ffd06e', fontSize: 11, fontWeight: '900', marginTop: 4, textTransform: 'uppercase', letterSpacing: 1.2 },
  micBadge: { overflow: 'hidden', borderRadius: radius.pill, paddingHorizontal: 12, paddingVertical: 7, fontSize: 11, fontWeight: '950', letterSpacing: 1.2 },
  micOpen: { backgroundColor: '#5df5ff', color: '#031416' },
  micPaused: { backgroundColor: '#ffd06e', color: '#151006' },
  middleGrid: { flex: 1, justifyContent: 'flex-end', gap: spacing.sm, marginVertical: spacing.sm },
  waveShell: { borderRadius: 22, borderWidth: 1, borderColor: LINE, backgroundColor: GLASS, padding: spacing.md },
  waveHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.sm, marginBottom: spacing.sm },
  waveTitle: { color: '#5df5ff', fontSize: 11, fontWeight: '950', letterSpacing: 2.4 },
  waveMeta: { color: 'rgba(220,255,255,0.62)', fontSize: 10, fontWeight: '800' },
  waveBars: { height: 70, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 4 },
  waveBar: { flex: 1, maxWidth: 7, minWidth: 3, borderRadius: 999, backgroundColor: '#5df5ff', shadowColor: '#5df5ff', shadowOpacity: 0.8, shadowRadius: 8 },
  levelRail: { height: 7, borderRadius: 999, backgroundColor: 'rgba(120,220,230,0.17)', marginTop: spacing.sm, overflow: 'hidden' },
  levelFill: { height: '100%', borderRadius: 999, backgroundColor: '#5df5ff' },
  wakeLine: { color: '#ffd06e', fontSize: 12, fontWeight: '950', marginTop: 7 },
  telemetryStatus: { color: 'rgba(220,255,255,0.76)', fontSize: 11, fontWeight: '800', marginTop: 4 },
  menuPanel: { borderRadius: 22, borderWidth: 1, borderColor: 'rgba(255,208,110,0.45)', backgroundColor: 'rgba(16, 12, 2, 0.76)', padding: spacing.md },
  menuTitle: { color: '#fff7df', fontSize: 17, fontWeight: '950', textAlign: 'center' },
  menuSubtitle: { color: 'rgba(255,247,223,0.75)', fontSize: 12, fontWeight: '800', textAlign: 'center', marginTop: 4, marginBottom: 8 },
  menuOption: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center', paddingVertical: 5 },
  menuKey: { width: 30, height: 30, borderRadius: 15, overflow: 'hidden', textAlign: 'center', lineHeight: 30, color: '#100b02', backgroundColor: '#ffd06e', fontWeight: '950' },
  menuLabel: { color: '#fff7df', fontSize: 13, fontWeight: '950' },
  menuDescription: { color: 'rgba(255,247,223,0.62)', fontSize: 11, fontWeight: '750' },
  menuFooter: { color: 'rgba(255,247,223,0.62)', textAlign: 'center', fontSize: 11, fontWeight: '850', marginTop: 6 },
  transcriptShell: { height: '32%', minHeight: 210, borderRadius: 22, borderWidth: 1, borderColor: LINE, backgroundColor: 'rgba(0, 10, 12, 0.82)', overflow: 'hidden' },
  transcriptTitle: { color: '#5df5ff', fontSize: 11, fontWeight: '950', letterSpacing: 2.4, paddingHorizontal: spacing.md, paddingTop: spacing.md, paddingBottom: 4 },
  transcriptContent: { padding: spacing.md, paddingTop: 4, gap: spacing.sm },
  turnRow: { borderRadius: 14, padding: spacing.sm, borderWidth: 1 },
  userRow: { backgroundColor: 'rgba(93,245,255,0.10)', borderColor: 'rgba(93,245,255,0.24)' },
  assistantRow: { backgroundColor: 'rgba(255,208,110,0.10)', borderColor: 'rgba(255,208,110,0.24)' },
  turnRole: { color: '#5df5ff', fontSize: 9, fontWeight: '950', letterSpacing: 1.7, marginBottom: 4 },
  turnText: { color: '#f4ffff', fontSize: 13, lineHeight: 18, fontWeight: '800' },
  emptyTranscript: { alignItems: 'center', justifyContent: 'center', minHeight: 120 },
  emptyTranscriptTitle: { color: '#eaffff', fontSize: 18, fontWeight: '950' },
  emptyTranscriptText: { color: 'rgba(220,255,255,0.65)', marginTop: 6, fontSize: 12, fontWeight: '800', textAlign: 'center' },
});
