import React from 'react';
import { SafeAreaView, ScrollView, StyleSheet, Text, View, Pressable } from 'react-native';
import { startSherpaWasmKwsRuntime, type SherpaWasmKeywordEvent } from '../voice/sherpaWasmKwsRuntime';
import { getRecentWakeDebugEvents, subscribeWakeDebug, type WakeDebugEvent } from '../voice/wakeDebugBus';

const BAR_COUNT = 36;

type RuntimeHandle = { stop: () => Promise<void>; runtimeKind?: string; diagnostics?: unknown; exportKeys?: string[] };

type Manifest = {
  generatedAt?: string;
  tokenized?: boolean;
  browserWakeFallback?: boolean;
  selectedCanonical?: string;
  selectedTrigger?: string;
  reason?: string;
  groups?: Array<{ id: string; phrases: string[] }>;
  nativeKeywords?: string;
  webKeywords?: string;
};

function clamp01(value: number) {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
}

async function fetchText(path: string) {
  const res = await fetch(path, { cache: 'no-store' });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${path}: ${text.slice(0, 200)}`);
  return text;
}

function latest<T extends WakeDebugEvent['type']>(events: WakeDebugEvent[], type: T) {
  return [...events].reverse().find((event) => event.type === type) as Extract<WakeDebugEvent, { type: T }> | undefined;
}

function Wave({ level, active }: { level: number; active: boolean }) {
  const [tick, setTick] = React.useState(0);
  React.useEffect(() => {
    const timer = setInterval(() => setTick((v) => v + 1), 80);
    return () => clearInterval(timer);
  }, []);
  const bars = Array.from({ length: BAR_COUNT }, (_, index) => {
    const a = Math.sin(index * 0.48 + tick * 0.55) * 0.5 + 0.5;
    const b = Math.sin(index * 0.23 - tick * 0.31) * 0.5 + 0.5;
    const h = 8 + Math.round((a * 0.75 + b * 0.25) * (18 + level * 74));
    return h;
  });
  return (
    <View style={styles.wave}>
      {bars.map((height, index) => (
        <View key={index} style={[styles.bar, { height, opacity: active ? 0.35 + level * 0.65 : 0.18 }]} />
      ))}
    </View>
  );
}

export default function SherpaInteractiveLabScreen() {
  const [manifest, setManifest] = React.useState<Manifest | null>(null);
  const [keywordsRaw, setKeywordsRaw] = React.useState('');
  const [keywords, setKeywords] = React.useState('');
  const [status, setStatus] = React.useState('idle');
  const [running, setRunning] = React.useState(false);
  const [runtimeInfo, setRuntimeInfo] = React.useState<any>(null);
  const [detections, setDetections] = React.useState<Array<{ at: number; event: SherpaWasmKeywordEvent }>>([]);
  const runtimeRef = React.useRef<RuntimeHandle | null>(null);
  const [events, setEvents] = React.useState<WakeDebugEvent[]>(() => getRecentWakeDebugEvents());

  const reloadFiles = React.useCallback(async () => {
    setStatus('loading manifest and keyword files');
    const [manifestText, rawText, tokenText] = await Promise.all([
      fetchText('/sherpa/kws-model/wake_alias_manifest.json'),
      fetchText('/sherpa/kws-model/keywords_raw.txt').catch((e) => `missing keywords_raw.txt: ${e.message}`),
      fetchText('/sherpa/kws-model/keywords.txt').catch((e) => `missing keywords.txt: ${e.message}`),
    ]);
    setManifest(JSON.parse(manifestText));
    setKeywordsRaw(rawText);
    setKeywords(tokenText);
    setStatus('files loaded');
  }, []);

  React.useEffect(() => {
    reloadFiles().catch((error) => setStatus(`file load failed: ${error instanceof Error ? error.message : String(error)}`));
    return subscribeWakeDebug(() => setEvents(getRecentWakeDebugEvents()));
  }, [reloadFiles]);

  async function stop() {
    const handle = runtimeRef.current;
    runtimeRef.current = null;
    setRunning(false);
    if (handle) await handle.stop().catch(() => undefined);
    setStatus('stopped');
  }

  async function start() {
    await stop();
    setDetections([]);
    setRuntimeInfo(null);
    setStatus('starting real Sherpa WASM KWS… allow microphone, then say the selected trigger');
    try {
      const handle = await startSherpaWasmKwsRuntime({
        modelBaseUrl: '/sherpa/kws-model',
        keywords: ['aga', 'stop', 'pause'],
        onStatus: (next) => setStatus(next),
        onKeyword: (event) => {
          setDetections((prev) => [{ at: Date.now(), event }, ...prev].slice(0, 12));
          setStatus(`DETECTED ${event.id || event.phrase} — ${Math.round((event.confidence ?? 0) * 100)}%`);
        },
      });
      runtimeRef.current = handle;
      setRunning(true);
      setRuntimeInfo({ runtimeKind: handle.runtimeKind, diagnostics: handle.diagnostics, exportKeys: handle.exportKeys });
      setStatus(`listening with ${handle.runtimeKind || 'sherpa runtime'}`);
    } catch (error) {
      setRunning(false);
      setStatus(`start failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  React.useEffect(() => () => { void stop(); }, []);

  const audio = latest(events, 'audio');
  const keyword = latest(events, 'keyword');
  const error = latest(events, 'error');
  const now = Date.now();
  const micAlive = !!audio && now - audio.at < 2200;
  const rms = audio?.rms ?? 0;
  const peak = audio?.peak ?? 0;
  const level = clamp01(Math.max(rms * 28, peak * 5));
  const isRealReady = !!manifest?.tokenized && !manifest?.browserWakeFallback;
  const trigger = manifest?.selectedTrigger || 'HEY GUARDIAN';
  const phrases = manifest?.groups?.flatMap((g) => g.phrases.map((phrase) => ({ id: g.id, phrase }))) || [];

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>AGA Sherpa Lab</Text>
        <Text style={styles.subtitle}>Real KWS isolation test. This page must prove Sherpa detects a spoken trigger before production wake depends on it.</Text>

        <View style={[styles.health, isRealReady ? styles.good : styles.bad]}>
          <Text style={styles.healthLabel}>SHERPA STATUS</Text>
          <Text style={styles.healthText}>{isRealReady ? 'TOKENIZED — REAL KWS CAN BE TESTED' : 'FALLBACK ONLY — NOT REAL SHERPA WAKE'}</Text>
          <Text style={styles.healthSub}>{manifest?.reason || 'manifest not loaded'} · selected trigger: {trigger}</Text>
        </View>

        <View style={styles.controls}>
          <Pressable style={[styles.button, running && styles.buttonDim]} onPress={start}>
            <Text style={styles.buttonText}>{running ? 'Restart real Sherpa test' : 'Start real Sherpa test'}</Text>
          </Pressable>
          <Pressable style={styles.buttonSecondary} onPress={stop}>
            <Text style={styles.buttonText}>Stop</Text>
          </Pressable>
          <Pressable style={styles.buttonSecondary} onPress={reloadFiles}>
            <Text style={styles.buttonText}>Reload files</Text>
          </Pressable>
        </View>

        <View style={styles.panel}>
          <View style={styles.rowBetween}>
            <Text style={styles.panelLabel}>LIVE MIC / WAKE MATCH</Text>
            <Text style={[styles.badge, micAlive ? styles.badgeGood : styles.badgeDim]}>{micAlive ? 'MIC MOVING' : 'NO MIC DATA'}</Text>
          </View>
          <Wave level={level} active={micAlive || running} />
          <Text style={styles.meter}>rms {rms.toFixed(5)} · peak {peak.toFixed(5)} · level {Math.round(level * 100)}%</Text>
          <Text style={styles.bigInstruction}>Say exactly: “{trigger.toLowerCase()}”</Text>
          <Text style={styles.status}>{status}</Text>
          {!!keyword && <Text style={styles.lastKeyword}>Last wakeDebug keyword: {keyword.keyword} · {Math.round((keyword.confidence ?? 0) * 100)}%</Text>}
          {!!error && <Text style={styles.error}>Last wakeDebug error: {error.message}</Text>}
        </View>

        <View style={styles.columns}>
          <View style={styles.panelHalf}>
            <Text style={styles.panelLabel}>TRIGGERS TO SAY</Text>
            {phrases.map(({ id, phrase }) => (
              <Text key={`${id}:${phrase}`} style={styles.phrase}>“{phrase}” → {id}</Text>
            ))}
          </View>
          <View style={styles.panelHalf}>
            <Text style={styles.panelLabel}>DETECTIONS</Text>
            {detections.length ? detections.map(({ at, event }) => (
              <View key={`${at}:${event.id}:${event.phrase}`} style={styles.detection}>
                <Text style={styles.detectTitle}>{new Date(at).toLocaleTimeString()} · {event.id || event.phrase}</Text>
                <Text style={styles.detectText}>phrase: {event.phrase || 'n/a'} · confidence: {Math.round((event.confidence ?? 0) * 100)}%</Text>
                <Text style={styles.raw}>{JSON.stringify(event.raw || {}, null, 2).slice(0, 700)}</Text>
              </View>
            )) : <Text style={styles.muted}>No keyword detected yet. Start test and say the exact trigger.</Text>}
          </View>
        </View>

        <View style={styles.panel}>
          <Text style={styles.panelLabel}>MANIFEST</Text>
          <Text style={styles.raw}>{JSON.stringify(manifest, null, 2)}</Text>
        </View>

        <View style={styles.columns}>
          <View style={styles.panelHalf}>
            <Text style={styles.panelLabel}>keywords_raw.txt</Text>
            <Text style={styles.raw}>{keywordsRaw}</Text>
          </View>
          <View style={styles.panelHalf}>
            <Text style={styles.panelLabel}>keywords.txt</Text>
            <Text style={styles.raw}>{keywords}</Text>
          </View>
        </View>

        {!!runtimeInfo && <View style={styles.panel}>
          <Text style={styles.panelLabel}>RUNTIME INFO</Text>
          <Text style={styles.raw}>{JSON.stringify(runtimeInfo, null, 2).slice(0, 2000)}</Text>
        </View>}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#03070b' },
  content: { padding: 24, gap: 18 },
  title: { color: '#fff', fontSize: 44, fontWeight: '900', letterSpacing: -1.5 },
  subtitle: { color: '#b9c2d8', fontSize: 17, lineHeight: 26, maxWidth: 1100 },
  health: { borderWidth: 1, borderRadius: 22, padding: 18 },
  good: { backgroundColor: 'rgba(28,80,58,0.35)', borderColor: '#5cf7aa' },
  bad: { backgroundColor: 'rgba(96,43,43,0.35)', borderColor: '#ff7a8a' },
  healthLabel: { color: '#9ffaff', fontSize: 12, fontWeight: '900', letterSpacing: 4 },
  healthText: { color: '#fff', fontSize: 28, fontWeight: '900', marginTop: 8 },
  healthSub: { color: '#d0dde8', fontSize: 15, marginTop: 6 },
  controls: { flexDirection: 'row', gap: 12, flexWrap: 'wrap' },
  button: { backgroundColor: '#eaf0ff', paddingHorizontal: 24, paddingVertical: 14, borderRadius: 999, borderWidth: 2, borderColor: '#48f0ff' },
  buttonDim: { opacity: 0.8 },
  buttonSecondary: { backgroundColor: '#1e2c38', paddingHorizontal: 24, paddingVertical: 14, borderRadius: 999, borderWidth: 1, borderColor: '#3a5265' },
  buttonText: { color: '#0a1020', fontSize: 16, fontWeight: '900' },
  panel: { borderWidth: 1, borderColor: '#223044', backgroundColor: '#08101b', borderRadius: 22, padding: 20 },
  panelHalf: { flex: 1, borderWidth: 1, borderColor: '#223044', backgroundColor: '#08101b', borderRadius: 22, padding: 20, minWidth: 360 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  panelLabel: { color: '#9ffaff', fontSize: 12, fontWeight: '900', letterSpacing: 4, marginBottom: 10 },
  badge: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 999, overflow: 'hidden', fontSize: 12, fontWeight: '900' },
  badgeGood: { color: '#031217', backgroundColor: '#58f4ff' },
  badgeDim: { color: '#a5b7c5', backgroundColor: 'rgba(255,255,255,0.08)' },
  wave: { height: 112, flexDirection: 'row', alignItems: 'center', gap: 7 },
  bar: { width: 9, borderRadius: 9, backgroundColor: '#58f4ff', shadowColor: '#58f4ff', shadowOpacity: 0.8, shadowRadius: 8 },
  meter: { color: '#b5c1ce', fontSize: 14 },
  bigInstruction: { color: '#ffe073', fontSize: 22, fontWeight: '900', marginTop: 12 },
  status: { color: '#fff', fontSize: 17, marginTop: 10 },
  lastKeyword: { color: '#ffe073', fontSize: 16, marginTop: 8 },
  error: { color: '#ff7286', fontSize: 15, marginTop: 8 },
  columns: { flexDirection: 'row', gap: 18, flexWrap: 'wrap' },
  phrase: { color: '#e5f4ff', fontSize: 16, lineHeight: 26 },
  detection: { borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.1)', paddingTop: 10, marginTop: 10 },
  detectTitle: { color: '#ffe073', fontWeight: '900', fontSize: 15 },
  detectText: { color: '#e9f3f8', fontSize: 14, marginTop: 4 },
  muted: { color: '#8da0ad', fontSize: 15 },
  raw: { color: '#d9dff2', fontFamily: 'monospace', fontSize: 13, lineHeight: 19 },
});
