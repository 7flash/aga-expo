import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { diagnoseSherpaWasmBrowserRuntime } from '../voice/sherpaWasmRuntimeDiagnostics';
import { startSherpaWasmKwsRuntime } from '../voice/sherpaWasmKwsRuntime';
import { publishVoiceTelemetry, getVoiceTelemetrySnapshot, subscribeVoiceTelemetry, type VoiceTelemetrySnapshot } from '../voice/voiceTelemetryStore';
import { addTurnLog, clearTurnLogs, getTurnLogs, subscribeTurnLogs, type TurnLogEntry } from '../voice/turnLogStore';
import { runExclusiveVoiceTurn } from '../voice/exclusiveVoiceTurn';
import { emitWakeDebug } from '../voice/wakeDebugBus';
import { stopSharedSherpaRuntime } from '../voice/sherpaRuntimeSingleton';

export type VoiceLabKind = 'voice' | 'wake' | 'command' | 'agent';

type SherpaHandle = { stop?: () => Promise<void> | void };

function stamp() { return new Date().toLocaleTimeString(); }
function stringify(value: unknown) { try { return JSON.stringify(value, null, 2); } catch { return String(value); } }

function useTelemetry() {
  const [snapshot, setSnapshot] = useState<VoiceTelemetrySnapshot>(() => getVoiceTelemetrySnapshot());
  useEffect(() => subscribeVoiceTelemetry(setSnapshot), []);
  return snapshot;
}

function useTurnLogs() {
  const [entries, setEntries] = useState<TurnLogEntry[]>(() => getTurnLogs());
  useEffect(() => subscribeTurnLogs(setEntries), []);
  return entries;
}

function LabWaveform({ telemetry }: { telemetry: VoiceTelemetrySnapshot }) {
  const bars = telemetry.waveform?.length ? telemetry.waveform.slice(-64) : Array.from({ length: 64 }, () => telemetry.audioLevel || 0.04);
  return (
    <View style={styles.waveBox}>
      <View style={styles.rowBetween}>
        <Text style={styles.panelTitle}>Waveform</Text>
        <Text style={styles.meta}>rms {telemetry.rms.toFixed(3)} · peak {telemetry.peak.toFixed(3)} · {telemetry.wakeEngine}</Text>
      </View>
      <View style={styles.waveBars}>
        {bars.map((v, i) => <View key={`${i}-${Math.round(v * 1000)}`} style={[styles.waveBar, { height: 8 + Math.max(1, Math.round(v * 58)) }]} />)}
      </View>
      <Text style={styles.meta}>{telemetry.status}</Text>
    </View>
  );
}

export function VoiceLabScreen({ kind }: { kind: VoiceLabKind }) {
  const telemetry = useTelemetry();
  const turnLogs = useTurnLogs();
  const [logs, setLogs] = useState<string[]>([]);
  const [text, setText] = useState(kind === 'command' ? 'open youtube calm music' : 'what time is it');
  const [running, setRunning] = useState(false);
  const sherpaRuntimeRef = useRef<SherpaHandle | null>(null);
  const volumeLoopRef = useRef<{ stop: () => void } | null>(null);

  const title = useMemo(() => ({
    voice: 'AGA Browser Voice Lab',
    wake: 'AGA Wake Lab',
    command: 'AGA Command/Tool Lab',
    agent: 'AGA Live Agent Lab',
  }[kind]), [kind]);

  const log = (message: string, raw?: unknown) => setLogs((prev) => [`${stamp()}  ${message}${raw === undefined ? '' : `\n${stringify(raw)}`}`, ...prev].slice(0, 100));

  const diagnoseSherpa = async () => {
    try {
      const result = await diagnoseSherpaWasmBrowserRuntime();
      log('Sherpa diagnostics', result);
      const text2tokenFailed = /text2token did not create output/i.test(JSON.stringify(result));
      if (text2tokenFailed) {
        publishVoiceTelemetry({ phase: 'error', wakeEngine: 'sherpa_wasm', status: 'Sherpa text2token failed — fallback only', error: 'text2token did not create output', raw: result });
      }
    } catch (error) {
      log('Sherpa diagnostics failed', error);
      publishVoiceTelemetry({ phase: 'error', wakeEngine: 'sherpa_wasm', error: error instanceof Error ? error.message : String(error) });
    }
  };

  const startSherpaSmoke = async () => {
    await stopSherpaSmoke();
    log('starting Sherpa smoke test');
    publishVoiceTelemetry({ phase: 'wake_listening', wakeEngine: 'sherpa_wasm', status: 'starting Sherpa smoke test' });
    const runtime = await startSherpaWasmKwsRuntime({
      onAudio: (audio: any) => {
        emitWakeDebug({ type: 'audio', provider: 'sherpa-smoke', rms: Number(audio.rms || 0), peak: Number(audio.peak || 0), frames: Number(audio.frames || 0), raw: audio });
      },
      onKeyword: (event: any) => {
        const fallback = !!event.fallback || /text2token did not create output/i.test(String(event.reason || event.raw?.reason || ''));
        log(fallback ? 'fallback wake: aga (not Sherpa)' : `keyword: ${event.keyword || event.phrase || 'aga'}`, event);
        emitWakeDebug({ type: 'keyword', provider: 'sherpa-smoke', keyword: event.keyword || event.phrase || 'aga', confidence: fallback ? 0.25 : Number(event.confidence || 1), raw: { ...event, fallback } });
      },
      onStatus: (status: any) => log('Sherpa status', status),
      onError: (error: any) => log('Sherpa error', error),
    } as any);
    sherpaRuntimeRef.current = runtime;
    setRunning(true);
  };

  const stopSherpaSmoke = async () => {
    await sherpaRuntimeRef.current?.stop?.();
    sherpaRuntimeRef.current = null;
    await stopSharedSherpaRuntime().catch(() => {});
    setRunning(false);
    publishVoiceTelemetry({ phase: 'wake_listening', status: 'wake tests stopped', micOpen: true, canAcceptUserSpeech: true });
  };

  const startVolumeWake = async () => {
    await stopVolumeWake();
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      log('volume wake unavailable in this browser');
      return;
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext;
    const ctx = new AudioCtx();
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);
    const data = new Uint8Array(analyser.fftSize);
    let loudSince = 0;
    let lastWakeAt = 0;
    let raf = 0;
    const threshold = Number((process as any)?.env?.EXPO_PUBLIC_AGA_VOLUME_WAKE_RMS || 0.035);
    const holdMs = Number((process as any)?.env?.EXPO_PUBLIC_AGA_VOLUME_WAKE_HOLD_MS || 420);
    const tick = () => {
      analyser.getByteTimeDomainData(data);
      let sum = 0; let peak = 0;
      for (let i = 0; i < data.length; i++) {
        const v = (data[i] - 128) / 128;
        sum += v * v;
        peak = Math.max(peak, Math.abs(v));
      }
      const rms = Math.sqrt(sum / data.length);
      emitWakeDebug({ type: 'audio', provider: 'volume-lab', rms, peak, frames: data.length });
      const now = Date.now();
      if (rms >= threshold) loudSince = loudSince || now;
      else loudSince = 0;
      if (loudSince && now - loudSince > holdMs && now - lastWakeAt > 4000) {
        lastWakeAt = now;
        emitWakeDebug({ type: 'keyword', provider: 'volume-lab', keyword: 'aga', confidence: 0.22, raw: { fallback: true, rms, peak, reason: 'volume threshold smoke wake' } });
      }
      raf = requestAnimationFrame(tick);
    };
    tick();
    volumeLoopRef.current = { stop: () => { cancelAnimationFrame(raf); stream.getTracks().forEach((t) => t.stop()); ctx.close?.(); } };
    log('volume wake started');
  };

  const stopVolumeWake = async () => {
    volumeLoopRef.current?.stop();
    volumeLoopRef.current = null;
  };

  const runAuto = async () => {
    const result = await runExclusiveVoiceTurn(text, { source: `${kind}-lab`, forceRoute: 'auto' });
    log(`exclusive result: ${result.decision.kind}`, result);
  };

  const runDirect = async () => {
    const result = await runExclusiveVoiceTurn(text, { source: `${kind}-lab`, forceRoute: 'direct_tool' });
    log(`direct-tool result: ${result.decision.kind}`, result);
  };

  const runShort = async () => {
    const result = await runExclusiveVoiceTurn(text, { source: `${kind}-lab`, forceRoute: 'short_gpt' });
    log(`short-gpt result: ${result.decision.kind}`, result);
  };

  const runLive = async () => {
    const result = await runExclusiveVoiceTurn(text, { source: `${kind}-lab`, forceRoute: 'live_agent' });
    log(`live-agent result: ${result.decision.kind}`, result);
  };

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.subtitle}>Isolation page. All buttons go through the same exclusive turn executor, so tool/GPT/live cannot overlap.</Text>

      <LabWaveform telemetry={telemetry} />

      {kind === 'wake' ? (
        <View style={styles.panel}>
          <Text style={styles.panelTitle}>Wake tests</Text>
          <Text style={styles.warning}>If you see “fallback wake”, Sherpa is not recognizing keywords. It is volume threshold only.</Text>
          <View style={styles.buttonRow}>
            <Pressable style={styles.button} onPress={stopSherpaSmoke}><Text style={styles.buttonText}>Stop wake tests</Text></Pressable>
            <Pressable style={styles.button} onPress={diagnoseSherpa}><Text style={styles.buttonText}>Diagnose Sherpa WASM</Text></Pressable>
            <Pressable style={styles.button} onPress={startSherpaSmoke}><Text style={styles.buttonText}>Start Sherpa smoke</Text></Pressable>
            <Pressable style={styles.button} onPress={startVolumeWake}><Text style={styles.buttonText}>Start volume wake</Text></Pressable>
            <Pressable style={styles.button} onPress={stopVolumeWake}><Text style={styles.buttonText}>Stop volume wake</Text></Pressable>
          </View>
          <Text style={styles.meta}>running: {running ? 'yes' : 'no'}</Text>
        </View>
      ) : (
        <View style={styles.panel}>
          <Text style={styles.panelTitle}>Test text</Text>
          <TextInput value={text} onChangeText={setText} style={styles.input} multiline />
          <View style={styles.buttonRow}>
            <Pressable style={styles.button} onPress={runAuto}><Text style={styles.buttonText}>Run exclusive auto</Text></Pressable>
            <Pressable style={styles.button} onPress={runDirect}><Text style={styles.buttonText}>Force direct tool</Text></Pressable>
            <Pressable style={styles.button} onPress={runShort}><Text style={styles.buttonText}>Force short GPT</Text></Pressable>
            <Pressable style={styles.button} onPress={runLive}><Text style={styles.buttonText}>Force live agent</Text></Pressable>
          </View>
        </View>
      )}

      <View style={styles.panel}>
        <View style={styles.rowBetween}>
          <Text style={styles.panelTitle}>Exclusive turn logs</Text>
          <Pressable style={styles.smallButton} onPress={clearTurnLogs}><Text style={styles.smallButtonText}>clear</Text></Pressable>
        </View>
        {turnLogs.slice(0, 30).map((entry) => (
          <View key={entry.id} style={styles.logEntry}>
            <Text style={styles.logMeta}>{new Date(entry.at).toLocaleTimeString()} · {entry.turnId} · {entry.stage}</Text>
            <Text style={styles.logText}>{entry.toolName ? `[${entry.toolName}] ` : ''}{entry.text || entry.route || ''}</Text>
          </View>
        ))}
      </View>

      <View style={styles.panel}>
        <Text style={styles.panelTitle}>Lab logs</Text>
        {logs.map((line, index) => <Text key={`${index}-${line.slice(0, 20)}`} style={styles.logText}>{line}</Text>)}
      </View>
    </ScrollView>
  );
}

export default VoiceLabScreen;

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#02050b' },
  content: { padding: 18, paddingBottom: 60, gap: 18 },
  title: { color: '#f6f8ff', fontSize: 38, fontWeight: '900' },
  subtitle: { color: '#b9bfd4', fontSize: 18, lineHeight: 28, maxWidth: 1180 },
  panel: { borderWidth: 1, borderColor: '#1e293b', backgroundColor: '#08111d', borderRadius: 22, padding: 22, gap: 14 },
  panelTitle: { color: '#f6f8ff', fontSize: 22, fontWeight: '900' },
  input: { color: '#ffffff', backgroundColor: '#030712', borderColor: '#2b3751', borderWidth: 1, borderRadius: 16, padding: 14, fontSize: 18, minHeight: 56 },
  buttonRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  button: { backgroundColor: '#eaf0ff', borderRadius: 999, paddingVertical: 14, paddingHorizontal: 22 },
  buttonText: { color: '#111827', fontWeight: '900', fontSize: 16 },
  smallButton: { borderRadius: 999, backgroundColor: '#182235', paddingHorizontal: 12, paddingVertical: 8 },
  smallButtonText: { color: '#dbeafe', fontWeight: '800' },
  logEntry: { borderTopColor: '#1e293b', borderTopWidth: 1, paddingTop: 10, marginTop: 10 },
  logMeta: { color: '#8be8ff', fontFamily: 'monospace' as any, fontSize: 12 },
  logText: { color: '#e8eeff', fontFamily: 'monospace' as any, fontSize: 16, lineHeight: 24, marginVertical: 4 },
  warning: { color: '#ffd580', fontWeight: '900', fontSize: 15 },
  meta: { color: '#9aa6c2', fontFamily: 'monospace' as any },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 16 },
  waveBox: { borderWidth: 1, borderColor: '#1bdee8', backgroundColor: '#031016', borderRadius: 22, padding: 18, gap: 12 },
  waveBars: { height: 82, flexDirection: 'row', alignItems: 'center', gap: 5 },
  waveBar: { flex: 1, minWidth: 3, maxWidth: 12, borderRadius: 999, backgroundColor: '#55f6ff', shadowColor: '#55f6ff', shadowOpacity: 0.8, shadowRadius: 8 },
});
