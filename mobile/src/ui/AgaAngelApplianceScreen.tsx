import React from 'react';
import { Animated, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useAgaBrain } from '../aga/useAgaBrain';
import { AngelVisual } from '../visual/AngelVisual';
import { getRecentWakeDebugEvents, subscribeWakeDebug, type WakeDebugEvent } from '../voice/wakeDebugBus';

const BAR_COUNT = 42;

function clamp01(value: number) {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function latest<T extends WakeDebugEvent['type']>(events: WakeDebugEvent[], type: T) {
  return [...events].reverse().find((event) => event.type === type) as Extract<WakeDebugEvent, { type: T }> | undefined;
}

function env(name: string, fallback = '') {
  return String(process.env?.[name] ?? fallback).trim();
}

function displayPhase(mode: string, speechStatus?: string, sessionLabel?: string | null) {
  const status = String(speechStatus || '').toLowerCase();
  if (sessionLabel || mode === 'live_session') return 'LIVE CONVERSATION';
  if (mode === 'speaking' || status.includes('speak') || status.includes('tts')) return 'AGA SPEAKING — MIC PAUSED';
  if (mode === 'thinking' || status.includes('think')) return 'AGA THINKING — MIC PAUSED';
  if (mode === 'awake' || mode === 'listening') return 'LISTENING FOR COMMAND';
  if (mode === 'media') return 'MEDIA MODE — SAY STOP OR PAUSE';
  return 'SLEEPING — SAY A WAKE PHRASE';
}

function wakePhrasesFromEnv() {
  const configured = env('EXPO_PUBLIC_AGA_SHERPA_WAKE_KEYWORDS');
  if (configured && !configured.includes('aga,stop,pause')) return configured.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 8);
  return ['hey guardian', 'hello guardian', 'ok guardian', 'wake guardian', 'hey angel', 'stop', 'pause'];
}

function commandExamples() {
  return [
    'what time is it',
    'what is the weather',
    'open youtube calm music',
    'start live conversation',
    'start breathing reset',
    'safe self hypnosis',
    'open settings',
    'stop',
  ];
}

function Waveform({ level, micAlive }: { level: number; micAlive: boolean }) {
  const [tick, setTick] = React.useState(0);
  React.useEffect(() => {
    const timer = setInterval(() => setTick((value) => value + 1), 90);
    return () => clearInterval(timer);
  }, []);
  const bars = Array.from({ length: BAR_COUNT }, (_, index) => {
    const wave = Math.sin(index * 0.55 + tick * 0.5) * 0.5 + 0.5;
    const pulse = Math.sin(index * 0.18 - tick * 0.33) * 0.5 + 0.5;
    const live = micAlive ? level : 0.08;
    return 8 + Math.round((wave * 0.7 + pulse * 0.3) * (18 + live * 70));
  });
  return (
    <View style={styles.waveRows}>
      {bars.map((height, index) => (
        <View key={index} style={[styles.waveBar, { height, opacity: micAlive ? 0.38 + level * 0.62 : 0.2 }]} />
      ))}
    </View>
  );
}

function VoicePlatesOverlay({ menu }: { menu: any }) {
  const defaultOptions = [
    { key: 'A', label: 'Ask AGA', description: 'time, weather, simple answers' },
    { key: 'B', label: 'Play YouTube', description: 'videos and music by voice' },
    { key: 'C', label: 'Live conversation', description: 'continuous talk mode' },
    { key: 'D', label: 'Guided session', description: 'breathing, meditation, hypnosis' },
    { key: 'E', label: 'Settings', description: 'voice, personality, sensitivity' },
  ];
  const options = Array.isArray(menu?.options) && menu.options.length ? menu.options : defaultOptions;
  return (
    <View style={styles.platesOverlay} pointerEvents="none">
      <Text style={styles.platesTitle}>{menu?.title || 'Voice choices'}</Text>
      <View style={styles.platesGrid}>
        {options.slice(0, 6).map((option: any, index: number) => (
          <View key={option.key || index} style={styles.plate}>
            <Text style={styles.plateKey}>{option.key || String.fromCharCode(65 + index)}</Text>
            <Text style={styles.plateLabel}>{option.label}</Text>
            {!!option.description && <Text style={styles.plateDesc}>{option.description}</Text>}
          </View>
        ))}
      </View>
      <Text style={styles.platesFooter}>Say the letter, number, or option name. Say “cancel” to close choices.</Text>
    </View>
  );
}

export default function AgaAngelApplianceScreen() {
  const brain = useAgaBrain() as any;
  const {
    mode = 'sleeping',
    messages = [],
    interim = '',
    audioLevel = 0,
    speechStatus = '',
    error = null,
    activeChoiceMenu = null,
    sessionLabel = null,
  } = brain || {};

  const [events, setEvents] = React.useState<WakeDebugEvent[]>(() => getRecentWakeDebugEvents());
  React.useEffect(() => subscribeWakeDebug(() => setEvents(getRecentWakeDebugEvents())), []);

  const audio = latest(events, 'audio');
  const keyword = latest(events, 'keyword');
  const wakeError = latest(events, 'error');
  const now = Date.now();
  const micAlive = !!audio && now - audio.at < 2200;
  const rms = audio?.rms ?? 0;
  const peak = audio?.peak ?? 0;
  const wakeLevel = clamp01(Math.max(rms * 26, peak * 5, Number(audioLevel || 0)));
  const phase = displayPhase(String(mode), speechStatus, sessionLabel);
  const wakeWords = wakePhrasesFromEnv();
  const showPlates = !!activeChoiceMenu || /choice|menu|settings/i.test(String(speechStatus || ''));

  const scale = React.useRef(new Animated.Value(1)).current;
  React.useEffect(() => {
    Animated.sequence([
      Animated.timing(scale, { toValue: keyword && now - keyword.at < 2200 ? 1.09 : 1.02, duration: 220, useNativeDriver: true }),
      Animated.spring(scale, { toValue: 1, useNativeDriver: true, damping: 12, stiffness: 90 }),
    ]).start();
  }, [keyword?.at]);

  const recentMessages = [...messages].slice(-4);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.backdropGlow} />
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>AGA</Text>
          <Text style={styles.subtitle}>Artificial Guardian Angel · voice first · no touch required</Text>
        </View>
        <View style={styles.phasePill}>
          <Text style={styles.phaseLabel}>CURRENT STATE</Text>
          <Text style={styles.phaseText}>{phase}</Text>
        </View>
      </View>

      <View style={styles.mainRow}>
        <View style={styles.angelColumn}>
          <Animated.View style={[styles.angelHalo, { transform: [{ scale }] }]}>
            <AngelVisual mode={mode} audioLevel={Math.max(wakeLevel, mode === 'speaking' ? 0.82 : 0)} size={360} />
          </Animated.View>
          <Text style={styles.angelCaption}>{sessionLabel ? `session: ${sessionLabel}` : phase}</Text>
          <Text style={styles.exitHint}>{sessionLabel ? 'Say “stop live conversation” or “end session” anytime.' : 'Say a wake phrase to begin.'}</Text>
        </View>

        <View style={styles.infoColumn}>
          <View style={styles.cardStrong}>
            <View style={styles.cardTopLine}>
              <Text style={styles.cardLabel}>WAKE + VOICE WAVEFORM</Text>
              <Text style={[styles.smallBadge, micAlive ? styles.badgeGood : styles.badgeDim]}>{micAlive ? 'MIC SIGNAL' : 'WAITING'}</Text>
            </View>
            <Waveform level={wakeLevel} micAlive={micAlive || mode === 'speaking'} />
            <Text style={styles.waveText}>
              rms {rms.toFixed(4)} · peak {peak.toFixed(4)} · match {Math.round((keyword?.confidence ?? 0) * 100)}%
            </Text>
            {!!keyword && <Text style={styles.keywordText}>Last wake/control: {keyword.keyword} · {Math.round((keyword.confidence ?? 0) * 100)}%</Text>}
            {!!wakeError && <Text style={styles.errorText}>Wake issue: {wakeError.message}</Text>}
          </View>

          <View style={styles.cardRow}>
            <View style={styles.cardHalf}>
              <Text style={styles.cardLabel}>WAKE PHRASES</Text>
              {wakeWords.map((word) => <Text key={word} style={styles.listItem}>“{word}”</Text>)}
            </View>
            <View style={styles.cardHalf}>
              <Text style={styles.cardLabel}>LOADED COMMANDS</Text>
              {commandExamples().map((cmd) => <Text key={cmd} style={styles.listItem}>“{cmd}”</Text>)}
            </View>
          </View>

          <View style={styles.cardStrong}>
            <Text style={styles.cardLabel}>RECENT TURN</Text>
            {!!interim && <Text style={styles.interim}>Hearing: {interim}</Text>}
            {recentMessages.length ? recentMessages.map((message: any, index: number) => (
              <View key={`${message.createdAt || index}-${message.role}`} style={styles.messageLine}>
                <Text style={styles.messageRole}>{String(message.role || 'turn').toUpperCase()}</Text>
                <Text style={styles.messageText}>{String(message.content || '')}</Text>
              </View>
            )) : <Text style={styles.muted}>No transcript yet. Say “hey guardian” then speak your command.</Text>}
            {!!error && <Text style={styles.errorText}>Error: {String(error)}</Text>}
          </View>
        </View>
      </View>

      {showPlates && <VoicePlatesOverlay menu={activeChoiceMenu} />}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#020808', padding: 24, overflow: 'hidden' },
  backdropGlow: { position: 'absolute', width: 520, height: 520, borderRadius: 260, left: -160, top: 120, backgroundColor: 'rgba(52,244,255,0.06)' },
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 20, marginBottom: 18 },
  title: { color: '#f2ffff', fontSize: 54, fontWeight: '900', letterSpacing: -2 },
  subtitle: { color: '#afc5cc', fontSize: 16, marginTop: 2 },
  phasePill: { borderWidth: 1, borderColor: 'rgba(72,240,255,0.8)', backgroundColor: 'rgba(5,30,32,0.86)', borderRadius: 22, paddingVertical: 14, paddingHorizontal: 20, minWidth: 320 },
  phaseLabel: { color: '#8ef8ff', fontSize: 12, fontWeight: '900', letterSpacing: 4 },
  phaseText: { color: '#fff', fontSize: 21, fontWeight: '900', marginTop: 8 },
  mainRow: { flex: 1, flexDirection: 'row', gap: 24 },
  angelColumn: { width: 410, alignItems: 'center', justifyContent: 'center' },
  angelHalo: { width: 390, height: 390, borderRadius: 195, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(72,240,255,0.24)', backgroundColor: 'rgba(4,22,24,0.34)' },
  angelCaption: { color: '#eaffff', fontSize: 20, fontWeight: '800', marginTop: 18, textAlign: 'center' },
  exitHint: { color: '#9fb6bd', fontSize: 15, marginTop: 8, textAlign: 'center' },
  infoColumn: { flex: 1, gap: 14, justifyContent: 'center' },
  cardStrong: { borderWidth: 1, borderColor: 'rgba(72,240,255,0.22)', backgroundColor: 'rgba(4,15,25,0.78)', borderRadius: 24, padding: 22 },
  cardTopLine: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  cardLabel: { color: '#93f8ff', fontSize: 13, fontWeight: '900', letterSpacing: 4, marginBottom: 12 },
  smallBadge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, fontSize: 11, fontWeight: '900', overflow: 'hidden' },
  badgeGood: { color: '#021013', backgroundColor: '#63f5ff' },
  badgeDim: { color: '#9cb4ba', backgroundColor: 'rgba(255,255,255,0.08)' },
  waveRows: { height: 104, flexDirection: 'row', alignItems: 'center', gap: 6 },
  waveBar: { width: 8, borderRadius: 8, backgroundColor: '#55f1ff', shadowColor: '#55f1ff', shadowOpacity: 0.8, shadowRadius: 9 },
  waveText: { color: '#a6bbc2', fontSize: 14, marginTop: 10 },
  keywordText: { color: '#f7d66e', fontSize: 15, marginTop: 6, fontWeight: '800' },
  errorText: { color: '#ff7286', fontSize: 14, marginTop: 8 },
  cardRow: { flexDirection: 'row', gap: 14 },
  cardHalf: { flex: 1, borderWidth: 1, borderColor: 'rgba(72,240,255,0.18)', backgroundColor: 'rgba(6,26,26,0.62)', borderRadius: 22, padding: 18 },
  listItem: { color: '#d7ebf0', fontSize: 15, lineHeight: 23 },
  interim: { color: '#f7d66e', fontSize: 16, marginBottom: 10 },
  muted: { color: '#8aa0a7', fontSize: 15 },
  messageLine: { borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.08)', paddingTop: 10, marginTop: 10 },
  messageRole: { color: '#f7d66e', fontSize: 11, fontWeight: '900', letterSpacing: 2 },
  messageText: { color: '#e8f6f8', fontSize: 15, marginTop: 4 },
  platesOverlay: { position: 'absolute', left: 32, right: 32, bottom: 24, borderWidth: 1, borderColor: 'rgba(247,214,110,0.55)', backgroundColor: 'rgba(7,18,22,0.93)', borderRadius: 24, padding: 18 },
  platesTitle: { color: '#fff', fontSize: 20, fontWeight: '900', marginBottom: 12 },
  platesGrid: { flexDirection: 'row', gap: 12, flexWrap: 'wrap' },
  plate: { flex: 1, minWidth: 160, borderWidth: 1, borderColor: 'rgba(72,240,255,0.25)', borderRadius: 18, padding: 14, backgroundColor: 'rgba(255,255,255,0.04)' },
  plateKey: { color: '#f7d66e', fontWeight: '900', fontSize: 17 },
  plateLabel: { color: '#fff', fontSize: 16, fontWeight: '900', marginTop: 4 },
  plateDesc: { color: '#a9bfc5', fontSize: 13, marginTop: 4 },
  platesFooter: { color: '#93f8ff', fontSize: 14, fontWeight: '800', marginTop: 12 },
});
