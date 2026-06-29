import React from 'react';
import { SafeAreaView, ScrollView, StyleSheet, Text, View, Pressable } from 'react-native';
import { startSherpaWasmKwsRuntime, type SherpaWasmKeywordEvent } from '../voice/sherpaWasmKwsRuntime';
import { getRecentWakeDebugEvents, subscribeWakeDebug, type WakeDebugEvent } from '../voice/wakeDebugBus';

const BAR_COUNT = 44;

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

function clamp01(value: number) { return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0)); }
function latest<T extends WakeDebugEvent['type']>(events: WakeDebugEvent[], type: T) { return [...events].reverse().find((event) => event.type === type) as Extract<WakeDebugEvent, { type: T }> | undefined; }
async function fetchText(path: string) {
  const res = await fetch(path, { cache: 'no-store' });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${path}: ${text.slice(0, 240)}`);
  return text;
}
function nowTime(at = Date.now()) { return new Date(at).toLocaleTimeString(); }

function Wave({ level, active }: { level: number; active: boolean }) {
  const [tick, setTick] = React.useState(0);
  React.useEffect(() => { const t = setInterval(() => setTick((v) => v + 1), 70); return () => clearInterval(t); }, []);
  const bars = Array.from({ length: BAR_COUNT }, (_, i) => {
    const a = Math.sin(i * 0.48 + tick * 0.58) * 0.5 + 0.5;
    const b = Math.sin(i * 0.22 - tick * 0.27) * 0.5 + 0.5;
    return 7 + Math.round((a * 0.75 + b * 0.25) * (18 + level * 82));
  });
  return <View style={styles.wave}>{bars.map((height, i) => <View key={i} style={[styles.bar, { height, opacity: active ? 0.34 + level * 0.64 : 0.16 }]} />)}</View>;
}

export default function SherpaVerificationLabScreen() {
  const [manifest, setManifest] = React.useState<Manifest | null>(null);
  const [keywordsRaw, setKeywordsRaw] = React.useState('');
  const [keywords, setKeywords] = React.useState('');
  const [status, setStatus] = React.useState('idle — load files, then start test');
  const [running, setRunning] = React.useState(false);
  const [runtimeInfo, setRuntimeInfo] = React.useState<any>(null);
  const [detections, setDetections] = React.useState<Array<{ at: number; event: SherpaWasmKeywordEvent }>>([]);
  const [events, setEvents] = React.useState<WakeDebugEvent[]>(() => getRecentWakeDebugEvents());
  const runtimeRef = React.useRef<RuntimeHandle | null>(null);

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
    setStatus('files loaded — press Start, then speak the exact trigger');
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
    setStatus('starting Sherpa WASM KWS — allow microphone');
    try {
      const handle = await startSherpaWasmKwsRuntime({
        modelBaseUrl: '/sherpa/kws-model',
        keywords: ['aga', 'stop', 'pause'],
        onStatus: (next) => setStatus(next),
        onKeyword: (event) => {
          setDetections((prev) => [{ at: Date.now(), event }, ...prev].slice(0, 20));
          setStatus(`DETECTED ${event.id || event.phrase} — ${Math.round((event.confidence ?? 0) * 100)}%`);
        },
      });
      runtimeRef.current = handle;
      setRunning(true);
      setRuntimeInfo({ runtimeKind: handle.runtimeKind, diagnostics: handle.diagnostics, exportKeys: handle.exportKeys });
      setStatus(`listening with ${handle.runtimeKind || 'Sherpa WASM runtime'}`);
    } catch (error) {
      setRunning(false);
      setStatus(`start failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  React.useEffect(() => () => { void stop(); }, []);

  const audio = latest(events, 'audio');
  const keywordDebug = latest(events, 'keyword');
  const error = latest(events, 'error');
  const statusDebug = latest(events, 'status');
  const micAlive = !!audio && Date.now() - audio.at < 2200;
  const rms = audio?.rms ?? 0;
  const peak = audio?.peak ?? 0;
  const level = clamp01(Math.max(rms * 30, peak * 5.5));
  const realReady = !!manifest?.tokenized && !manifest?.browserWakeFallback;
  const selected = manifest?.selectedTrigger || 'HEY GUARDIAN';
  const phrases = manifest?.groups?.flatMap((group) => group.phrases.map((phrase) => ({ id: group.id, phrase }))) || [];
  const success = detections.length > 0;

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>AGA Sherpa Verification Lab</Text>
        <Text style={styles.subtitle}>This page answers one question: can the browser Sherpa runtime hear a real keyword from the microphone?</Text>

        <View style={[styles.statusCard, realReady ? styles.good : styles.bad]}>
          <Text style={styles.kicker}>STATUS</Text>
          <Text style={styles.statusBig}>{realReady ? 'TOKENIZED — REAL SHERPA TEST READY' : 'FALLBACK ONLY — NOT REAL SHERPA WAKE'}</Text>
          <Text style={styles.statusSmall}>{manifest?.reason || 'manifest not loaded'} · selected trigger: {selected}</Text>
        </View>

        <View style={styles.controls}>
          <Pressable style={styles.primary} onPress={start}><Text style={styles.buttonText}>{running ? 'Restart real test' : 'Start real test'}</Text></Pressable>
          <Pressable style={styles.secondary} onPress={stop}><Text style={styles.buttonText}>Stop</Text></Pressable>
          <Pressable style={styles.secondary} onPress={reloadFiles}><Text style={styles.buttonText}>Reload files</Text></Pressable>
        </View>

        <View style={styles.panel}>
          <View style={styles.rowBetween}>
            <Text style={styles.kicker}>LIVE TEST</Text>
            <Text style={[styles.badge, micAlive ? styles.badgeGood : styles.badgeDim]}>{micAlive ? 'MIC SIGNAL' : running ? 'WAITING FOR MIC DATA' : 'STOPPED'}</Text>
          </View>
          <Wave level={level} active={running || micAlive} />
          <Text style={styles.instruction}>Say exactly: “{selected.toLowerCase()}”</Text>
          <Text style={styles.meter}>rms {rms.toFixed(5)} · peak {peak.toFixed(5)} · level {Math.round(level * 100)}%</Text>
          <Text style={success ? styles.success : styles.statusLine}>{success ? `PASS — last detection at ${nowTime(detections[0].at)}` : status}</Text>
          {!!statusDebug && <Text style={styles.muted}>runtime status: {statusDebug.message}</Text>}
          {!!keywordDebug && <Text style={styles.muted}>wakeDebug keyword: {keywordDebug.keyword} · {Math.round((keywordDebug.confidence ?? 0) * 100)}%</Text>}
          {!!error && <Text style={styles.error}>error: {error.message}</Text>}
        </View>

        <View style={styles.columns}>
          <View style={styles.panelHalf}>
            <Text style={styles.kicker}>PHRASES TO TEST</Text>
            {phrases.map(({ id, phrase }) => <Text key={`${id}:${phrase}`} style={styles.phrase}>“{phrase}” → {id}</Text>)}
          </View>
          <View style={styles.panelHalf}>
            <Text style={styles.kicker}>DETECTIONS</Text>
            {detections.length ? detections.map(({ at, event }) => (
              <View key={`${at}:${event.id}:${event.phrase}`} style={styles.detection}>
                <Text style={styles.detectTitle}>{nowTime(at)} · {event.id || event.phrase}</Text>
                <Text style={styles.detectText}>phrase: {event.phrase || 'n/a'} · confidence: {Math.round((event.confidence ?? 0) * 100)}%</Text>
                <Text style={styles.raw}>{JSON.stringify(event.raw || {}, null, 2).slice(0, 900)}</Text>
              </View>
            )) : <Text style={styles.muted}>No detections yet. Start test and say the exact trigger slowly.</Text>}
          </View>
        </View>

        <View style={styles.columns}>
          <View style={styles.panelHalf}>
            <Text style={styles.kicker}>keywords_raw.txt</Text>
            <Text style={styles.raw}>{keywordsRaw}</Text>
          </View>
          <View style={styles.panelHalf}>
            <Text style={styles.kicker}>keywords.txt</Text>
            <Text style={styles.raw}>{keywords}</Text>
          </View>
        </View>

        <View style={styles.panel}>
          <Text style={styles.kicker}>MANIFEST</Text>
          <Text style={styles.raw}>{JSON.stringify(manifest, null, 2)}</Text>
        </View>

        {!!runtimeInfo && <View style={styles.panel}>
          <Text style={styles.kicker}>RUNTIME INFO</Text>
          <Text style={styles.raw}>{JSON.stringify(runtimeInfo, null, 2).slice(0, 2600)}</Text>
        </View>}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#03070b' },
  content: { padding: 24, gap: 18 },
  title: { color: '#fff', fontSize: 42, fontWeight: '900', letterSpacing: -1.2 },
  subtitle: { color: '#b9c2d8', fontSize: 18, lineHeight: 27 },
  statusCard: { borderRadius: 24, padding: 22, borderWidth: 1 },
  good: { backgroundColor: 'rgba(9,42,32,0.74)', borderColor: 'rgba(100,255,190,0.7)' },
  bad: { backgroundColor: 'rgba(50,22,22,0.78)', borderColor: 'rgba(255,115,115,0.75)' },
  kicker: { color: '#92f7ff', fontSize: 12, fontWeight: '900', letterSpacing: 4, marginBottom: 8 },
  statusBig: { color: '#fff', fontSize: 24, fontWeight: '900' },
  statusSmall: { color: '#d3dde8', fontSize: 14, marginTop: 8 },
  controls: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  primary: { backgroundColor: '#eaf0ff', borderRadius: 999, paddingHorizontal: 24, paddingVertical: 14, borderWidth: 2, borderColor: '#65b8ff' },
  secondary: { backgroundColor: '#192533', borderRadius: 999, paddingHorizontal: 22, paddingVertical: 14, borderWidth: 1, borderColor: '#31445e' },
  buttonText: { color: '#0a1020', fontSize: 17, fontWeight: '900' },
  panel: { borderWidth: 1, borderColor: '#1e2b42', backgroundColor: '#08101c', borderRadius: 24, padding: 22 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  badge: { borderRadius: 999, overflow: 'hidden', paddingHorizontal: 10, paddingVertical: 5, fontSize: 11, fontWeight: '900' },
  badgeGood: { backgroundColor: '#7af7ff', color: '#071014' },
  badgeDim: { backgroundColor: 'rgba(255,255,255,0.08)', color: '#b8c2d0' },
  wave: { height: 112, flexDirection: 'row', alignItems: 'center', gap: 6, marginVertical: 12 },
  bar: { width: 8, borderRadius: 999, backgroundColor: '#63f5ff', shadowColor: '#63f5ff', shadowOpacity: 0.7, shadowRadius: 8 },
  instruction: { color: '#ffd866', fontSize: 24, fontWeight: '900', marginTop: 4 },
  meter: { color: '#dce7f7', fontSize: 14, marginTop: 8, fontWeight: '800' },
  statusLine: { color: '#fff', fontSize: 16, marginTop: 10, fontWeight: '800' },
  success: { color: '#85ffbf', fontSize: 18, marginTop: 10, fontWeight: '900' },
  error: { color: '#ff8d8d', fontSize: 14, marginTop: 8, fontWeight: '800' },
  muted: { color: '#aeb8ca', fontSize: 13, lineHeight: 20, marginTop: 8 },
  columns: { flexDirection: 'row', gap: 16 },
  panelHalf: { flex: 1, borderWidth: 1, borderColor: '#1e2b42', backgroundColor: '#08101c', borderRadius: 24, padding: 20 },
  phrase: { color: '#e9f3ff', fontSize: 15, marginBottom: 8 },
  detection: { borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.08)', paddingTop: 12, marginTop: 12 },
  detectTitle: { color: '#fff', fontSize: 16, fontWeight: '900' },
  detectText: { color: '#cfe0ee', fontSize: 13, marginTop: 4 },
  raw: { color: '#d8def0', fontFamily: 'monospace', fontSize: 13, lineHeight: 18 },
});
