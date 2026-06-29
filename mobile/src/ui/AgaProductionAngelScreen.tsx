import React from 'react';
import { Animated, SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useAgaBrain } from '../aga/useAgaBrain';
import { AngelVisual } from '../visual/AngelVisual';
import { getRecentWakeDebugEvents, subscribeWakeDebug, type WakeDebugEvent } from '../voice/wakeDebugBus';
import HolographicVoicePlatesOverlay from './HolographicVoicePlatesOverlay';

const BAR_COUNT = 48;

type WakeAliasManifest = {
  tokenized?: boolean;
  browserWakeFallback?: boolean;
  selectedTrigger?: string;
  selectedCanonical?: string;
  reason?: string;
  groups?: Array<{ id: string; phrases: string[] }>;
};

function clamp01(value: number) {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

function latest<T extends WakeDebugEvent['type']>(events: WakeDebugEvent[], type: T) {
  return [...events].reverse().find((event) => event.type === type) as Extract<WakeDebugEvent, { type: T }> | undefined;
}

function eventAge(event?: { at?: number }) {
  return event?.at ? Date.now() - event.at : Number.POSITIVE_INFINITY;
}

function displayState(mode: string, speechStatus?: string, sessionLabel?: string | null) {
  const status = String(speechStatus || '').toLowerCase();
  if (sessionLabel || mode === 'live_session' || status.includes('live')) {
    return {
      title: 'LIVE CONVERSATION',
      subtitle: 'Continuous talk mode is active. Say “stop live conversation” or “end session” to close it.',
      owner: 'shared',
      mic: 'live',
    };
  }
  if (mode === 'speaking' || status.includes('speak') || status.includes('tts')) {
    return {
      title: 'AGA SPEAKING',
      subtitle: 'Mic is paused so AGA does not hear its own voice. Say “stop” only if barge-in is enabled.',
      owner: 'aga',
      mic: 'paused',
    };
  }
  if (mode === 'thinking' || status.includes('think') || status.includes('tool')) {
    return {
      title: 'AGA THINKING',
      subtitle: 'Your command is being routed. Mic is paused during this turn.',
      owner: 'aga',
      mic: 'paused',
    };
  }
  if (mode === 'awake' || mode === 'listening' || status.includes('command')) {
    return {
      title: 'LISTENING FOR COMMAND',
      subtitle: 'Speak the command now. The command window will close automatically.',
      owner: 'user',
      mic: 'open',
    };
  }
  if (mode === 'media') {
    return {
      title: 'MEDIA MODE',
      subtitle: 'Say “pause”, “resume”, “stop”, or ask for a different sound/video.',
      owner: 'system',
      mic: 'control',
    };
  }
  return {
    title: 'SLEEPING',
    subtitle: 'Say a wake phrase to begin. AGA will start a fresh voice turn when it hears you.',
    owner: 'system',
    mic: 'wake-only',
  };
}

function uniquePhrases(manifest: WakeAliasManifest | null) {
  const manifestPhrases = manifest?.groups?.flatMap((group) => group.phrases || []) || [];
  const fallback = ['hey guardian', 'hello guardian', 'ok guardian', 'wake guardian', 'hey angel', 'stop', 'pause'];
  return Array.from(new Set((manifestPhrases.length ? manifestPhrases : fallback).map((phrase) => phrase.toLowerCase()))).slice(0, 10);
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

function Waveform({ level, active, speaking }: { level: number; active: boolean; speaking: boolean }) {
  const [tick, setTick] = React.useState(0);
  React.useEffect(() => {
    const timer = setInterval(() => setTick((value) => value + 1), 70);
    return () => clearInterval(timer);
  }, []);
  const bars = Array.from({ length: BAR_COUNT }, (_, index) => {
    const primary = Math.sin(index * 0.46 + tick * (speaking ? 0.82 : 0.48)) * 0.5 + 0.5;
    const secondary = Math.sin(index * 0.19 - tick * 0.29) * 0.5 + 0.5;
    const live = active ? level : 0.06;
    return 6 + Math.round((primary * 0.76 + secondary * 0.24) * (16 + live * 76));
  });
  return (
    <View style={styles.waveRows}>
      {bars.map((height, index) => (
        <View key={index} style={[styles.waveBar, { height, opacity: active ? 0.34 + level * 0.62 : 0.18 }]} />
      ))}
    </View>
  );
}

function WakeTransition({ keyword, manifest }: { keyword?: Extract<WakeDebugEvent, { type: 'keyword' }>; manifest: WakeAliasManifest | null }) {
  const fresh = !!keyword && eventAge(keyword) < 2600;
  const selected = manifest?.selectedTrigger || 'HEY GUARDIAN';
  const confidence = Math.round((keyword?.confidence ?? 0) * 100);
  return (
    <View style={[styles.transitionCard, fresh && styles.transitionActive]}>
      <Text style={styles.cardLabel}>WAKE MATCH</Text>
      <Text style={styles.transitionTitle}>{fresh ? `HEARD: ${keyword?.keyword || 'wake'}` : `Waiting for “${selected.toLowerCase()}”`}</Text>
      <View style={styles.confidenceTrack}>
        <View style={[styles.confidenceFill, { width: `${fresh ? Math.max(8, confidence) : 0}%` }]} />
      </View>
      <Text style={styles.transitionSub}>{fresh ? `${confidence}% match · starting command window` : 'Match confidence appears here when Sherpa detects a trigger.'}</Text>
    </View>
  );
}

async function fetchManifest(): Promise<WakeAliasManifest | null> {
  try {
    const response = await fetch('/sherpa/kws-model/wake_alias_manifest.json', { cache: 'no-store' });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

export default function AgaProductionAngelScreen() {
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
  const [manifest, setManifest] = React.useState<WakeAliasManifest | null>(null);
  React.useEffect(() => subscribeWakeDebug(() => setEvents(getRecentWakeDebugEvents())), []);
  React.useEffect(() => { fetchManifest().then(setManifest).catch(() => undefined); }, []);

  const audio = latest(events, 'audio');
  const keyword = latest(events, 'keyword');
  const wakeError = latest(events, 'error');
  const statusEvent = latest(events, 'status');
  const micAlive = !!audio && eventAge(audio) < 2200;
  const rms = audio?.rms ?? 0;
  const peak = audio?.peak ?? 0;
  const speaking = mode === 'speaking' || /speak|tts/i.test(String(speechStatus || ''));
  const liveMode = !!sessionLabel || mode === 'live_session';
  const wakeLevel = clamp01(Math.max(rms * 30, peak * 5.5, Number(audioLevel || 0), speaking ? 0.74 : 0));
  const state = displayState(String(mode), speechStatus, sessionLabel);
  const wakeWords = uniquePhrases(manifest);
  const showPlates = !!activeChoiceMenu || /choice|menu|settings|what can you do/i.test(String(speechStatus || ''));
  const recentMessages = [...messages].slice(-5);

  const scale = React.useRef(new Animated.Value(1)).current;
  React.useEffect(() => {
    const freshWake = keyword && eventAge(keyword) < 2600;
    Animated.sequence([
      Animated.timing(scale, { toValue: freshWake ? 1.12 : speaking ? 1.04 : 1.01, duration: 220, useNativeDriver: true }),
      Animated.spring(scale, { toValue: 1, damping: 12, stiffness: 90, useNativeDriver: true }),
    ]).start();
  }, [keyword?.at, speaking]);

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.backdropGlowOne} />
      <View style={styles.backdropGlowTwo} />
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>AGA</Text>
          <Text style={styles.subtitle}>Artificial Guardian Angel · voice-first appliance</Text>
        </View>
        <View style={styles.statePill}>
          <Text style={styles.stateLabel}>CURRENT TURN</Text>
          <Text style={styles.stateTitle}>{state.title}</Text>
          <Text style={styles.stateSub}>{state.subtitle}</Text>
        </View>
      </View>

      <View style={styles.body}>
        <View style={styles.angelColumn}>
          <Animated.View style={[styles.angelHalo, { transform: [{ scale }] }]}> 
            <AngelVisual mode={mode} audioLevel={wakeLevel} size={390} />
          </Animated.View>
          <Text style={styles.angelStatus}>{liveMode ? `Live: ${sessionLabel || 'conversation'}` : state.title}</Text>
          <Text style={styles.angelHint}>{liveMode ? 'Say “stop live conversation” to close. Say “pause” to pause media.' : 'Say “hey guardian” or another wake phrase.'}</Text>
        </View>

        <View style={styles.infoColumn}>
          <View style={styles.cardStrong}>
            <View style={styles.rowBetween}>
              <Text style={styles.cardLabel}>VOICE SIGNAL</Text>
              <Text style={[styles.badge, micAlive || speaking ? styles.badgeGood : styles.badgeDim]}>{micAlive ? 'MIC ACTIVE' : speaking ? 'AGA VOICE' : 'WAITING'}</Text>
            </View>
            <Waveform level={wakeLevel} active={micAlive || speaking} speaking={speaking} />
            <Text style={styles.meter}>rms {rms.toFixed(5)} · peak {peak.toFixed(5)} · level {Math.round(wakeLevel * 100)}%</Text>
            <Text style={styles.muted}>Wake engine: {manifest?.tokenized && !manifest?.browserWakeFallback ? 'Sherpa KWS tokenized' : 'fallback/unknown'} · {manifest?.reason || statusEvent?.message || 'waiting for status'}</Text>
          </View>

          <WakeTransition keyword={keyword} manifest={manifest} />

          <View style={styles.twoCol}>
            <View style={styles.cardHalf}>
              <Text style={styles.cardLabel}>WAKE / CONTROL PHRASES</Text>
              <ScrollView style={styles.miniScroll}>
                {wakeWords.map((word) => <Text key={word} style={styles.listItem}>“{word}”</Text>)}
              </ScrollView>
            </View>
            <View style={styles.cardHalf}>
              <Text style={styles.cardLabel}>LOADED COMMANDS</Text>
              <ScrollView style={styles.miniScroll}>
                {commandExamples().map((cmd) => <Text key={cmd} style={styles.listItem}>“{cmd}”</Text>)}
              </ScrollView>
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
            )) : <Text style={styles.muted}>No transcript yet. Wake AGA, then speak a command.</Text>}
            {!!wakeError && <Text style={styles.errorText}>Wake issue: {wakeError.message}</Text>}
            {!!error && <Text style={styles.errorText}>Error: {String(error)}</Text>}
          </View>
        </View>
      </View>

      <HolographicVoicePlatesOverlay menu={activeChoiceMenu} visible={showPlates} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#020808', padding: 24, overflow: 'hidden' },
  backdropGlowOne: { position: 'absolute', width: 540, height: 540, borderRadius: 270, left: -170, top: 120, backgroundColor: 'rgba(50,245,255,0.055)' },
  backdropGlowTwo: { position: 'absolute', width: 440, height: 440, borderRadius: 220, right: -130, bottom: -120, backgroundColor: 'rgba(255,210,92,0.045)' },
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 18, marginBottom: 16 },
  title: { color: '#f4ffff', fontSize: 62, fontWeight: '900', letterSpacing: -2.4 },
  subtitle: { color: '#a9c1c7', fontSize: 17, marginTop: 2 },
  statePill: { borderWidth: 1, borderColor: 'rgba(98,242,255,0.74)', backgroundColor: 'rgba(5,30,32,0.82)', borderRadius: 24, paddingVertical: 14, paddingHorizontal: 20, width: 430 },
  stateLabel: { color: '#8ef8ff', fontSize: 12, fontWeight: '900', letterSpacing: 4 },
  stateTitle: { color: '#ffffff', fontSize: 24, fontWeight: '900', marginTop: 8 },
  stateSub: { color: '#b9d2d8', fontSize: 13, marginTop: 5, lineHeight: 18 },
  body: { flex: 1, flexDirection: 'row', gap: 26 },
  angelColumn: { width: 440, alignItems: 'center', justifyContent: 'center', paddingBottom: 80 },
  angelHalo: { width: 420, height: 420, borderRadius: 210, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(98,242,255,0.25)', backgroundColor: 'rgba(4,22,24,0.32)', shadowColor: '#65f8ff', shadowOpacity: 0.17, shadowRadius: 38 },
  angelStatus: { color: '#f0ffff', fontSize: 22, fontWeight: '900', marginTop: 18, textAlign: 'center' },
  angelHint: { color: '#aac5cb', fontSize: 15, marginTop: 8, textAlign: 'center', maxWidth: 380, lineHeight: 21 },
  infoColumn: { flex: 1, gap: 13, justifyContent: 'center', paddingBottom: 72 },
  cardStrong: { borderWidth: 1, borderColor: 'rgba(98,242,255,0.22)', backgroundColor: 'rgba(4,15,25,0.78)', borderRadius: 24, padding: 20 },
  transitionCard: { borderWidth: 1, borderColor: 'rgba(98,242,255,0.20)', backgroundColor: 'rgba(4,15,25,0.66)', borderRadius: 22, padding: 18 },
  transitionActive: { borderColor: 'rgba(255,216,102,0.82)', backgroundColor: 'rgba(42,31,7,0.55)' },
  transitionTitle: { color: '#fff', fontSize: 22, fontWeight: '900', marginTop: 4 },
  transitionSub: { color: '#bdd1d7', fontSize: 13, marginTop: 8 },
  confidenceTrack: { height: 8, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.08)', marginTop: 12, overflow: 'hidden' },
  confidenceFill: { height: 8, borderRadius: 999, backgroundColor: '#ffd866' },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  cardLabel: { color: '#93f8ff', fontSize: 12, fontWeight: '900', letterSpacing: 4, marginBottom: 10 },
  badge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5, fontSize: 11, fontWeight: '900', overflow: 'hidden' },
  badgeGood: { color: '#071012', backgroundColor: '#75f6ff' },
  badgeDim: { color: '#a9bdc4', backgroundColor: 'rgba(255,255,255,0.08)' },
  waveRows: { height: 92, flexDirection: 'row', alignItems: 'center', gap: 6, marginVertical: 8 },
  waveBar: { width: 8, borderRadius: 999, backgroundColor: '#62f5ff', shadowColor: '#62f5ff', shadowOpacity: 0.8, shadowRadius: 8 },
  meter: { color: '#d6fbff', fontSize: 13, fontWeight: '800' },
  muted: { color: '#9fb4bb', fontSize: 13, lineHeight: 19 },
  twoCol: { flexDirection: 'row', gap: 13 },
  cardHalf: { flex: 1, borderWidth: 1, borderColor: 'rgba(98,242,255,0.18)', backgroundColor: 'rgba(5,22,28,0.72)', borderRadius: 22, padding: 18, minHeight: 170 },
  miniScroll: { maxHeight: 132 },
  listItem: { color: '#d7eeee', fontSize: 14, marginBottom: 8 },
  interim: { color: '#ffd866', fontSize: 15, fontWeight: '800', marginBottom: 10 },
  messageLine: { borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.06)', paddingTop: 10, marginTop: 10 },
  messageRole: { color: '#ffd866', fontSize: 11, fontWeight: '900', letterSpacing: 2, marginBottom: 3 },
  messageText: { color: '#eefcff', fontSize: 14, lineHeight: 19 },
  errorText: { color: '#ff8f8f', fontSize: 13, fontWeight: '800', marginTop: 8 },
});
