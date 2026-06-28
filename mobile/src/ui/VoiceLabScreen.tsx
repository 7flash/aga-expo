import React, { useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { diagnoseSherpaWasmBrowserRuntime } from '../voice/sherpaWasmRuntimeDiagnostics';
import { startSherpaWasmKwsRuntime } from '../voice/sherpaWasmKwsRuntime';
import { BrowserVoiceAppliance, createLiveLayerFromEnv } from '../voice/browserAppliance/browserVoiceAppliance';
import { VolumeThresholdWakeLayer } from '../voice/browserAppliance/volumeThresholdWakeLayer';
import { BrowserToolRouter } from '../voice/browserAppliance/browserToolRouter';
import type { BrowserApplianceEvent } from '../voice/browserAppliance/types';

export type VoiceLabKind = 'voice' | 'wake' | 'command' | 'agent';

function stamp() {
  return new Date().toLocaleTimeString();
}

function stringify(value: unknown) {
  try { return JSON.stringify(value, null, 2); } catch { return String(value); }
}

export function VoiceLabScreen({ kind }: { kind: VoiceLabKind }) {
  const [logs, setLogs] = useState<string[]>([]);
  const [text, setText] = useState('what time is it');
  const [running, setRunning] = useState(false);
  const applianceRef = useRef<BrowserVoiceAppliance | null>(null);
  const sherpaRuntimeRef = useRef<{ stop?: () => Promise<void> | void } | null>(null);

  const title = useMemo(() => ({
    voice: 'AGA Browser Voice Lab',
    wake: 'AGA Wake Lab',
    command: 'AGA Command/Tool Lab',
    agent: 'AGA Live Agent Lab',
  }[kind]), [kind]);

  const log = (message: string, raw?: unknown) => {
    setLogs((prev) => [`${stamp()}  ${message}${raw === undefined ? '' : `\n${stringify(raw)}`}`, ...prev].slice(0, 80));
  };

  const onEvent = (event: BrowserApplianceEvent) => {
    if (event.type === 'audio-level') return;
    if (event.type === 'transcript') log(`transcript: ${event.text}`);
    else if (event.type === 'assistant') log(`assistant: ${event.text}`);
    else if (event.type === 'route') log(`route: ${event.route} (${event.reason})`);
    else if (event.type === 'tool') log(`tool: ${event.name}`, event);
    else if (event.type === 'error') log(`error: ${event.message}`, event.raw);
    else if ('message' in event) log(event.message, event.raw);
    else log(event.type, event);
  };

  const startFull = async () => {
    const app = new BrowserVoiceAppliance({ emit: onEvent });
    applianceRef.current = app;
    await app.start();
    setRunning(true);
  };

  const stopFull = async () => {
    await applianceRef.current?.stop();
    applianceRef.current = null;
    await sherpaRuntimeRef.current?.stop?.();
    sherpaRuntimeRef.current = null;
    setRunning(false);
  };

  const runCommand = async () => {
    const router = new BrowserToolRouter(onEvent);
    const local = await router.runLocalControl(text);
    if (local.handled) {
      log(`local result: ${local.text || '(silent)'}`);
      return;
    }
    const decision = router.classify(text);
    log(`classified: ${decision.path} (${decision.reason})`);
    const result = await router.runShortToolTurn(text);
    log(`short-tool result: ${result.text}`);
  };

  const runAgent = async () => {
    const agent = createLiveLayerFromEnv();
    log(`starting ${agent.name}`);
    await agent.startWithText(text);
    log(`${agent.name} started`);
  };

  const diagnoseSherpa = async () => {
    const diag = await diagnoseSherpaWasmBrowserRuntime();
    log(diag.message, diag);
  };

  const startSherpaSmoke = async () => {
    await sherpaRuntimeRef.current?.stop?.();
    log('starting Sherpa WASM keyword smoke test');
    sherpaRuntimeRef.current = await startSherpaWasmKwsRuntime({
      onStatus: (status) => log(`sherpa: ${status}`),
      onKeyword: (event) => log(`keyword: ${event.phrase}`, event),
    });
    setRunning(true);
  };

  const startVolumeOnly = async () => {
    const layer = new VolumeThresholdWakeLayer();
    await layer.start(onEvent);
    applianceRef.current = ({ stop: () => layer.stop() } as unknown as BrowserVoiceAppliance);
    setRunning(true);
  };

  return (
    <ScrollView contentContainerStyle={styles.root}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.subtitle}>Browser-only isolation page. Use this to test wake, Sherpa, command routing, STT/TTS, and live-agent delegation without touching the production angel screen.</Text>

      <View style={styles.row}>
        {kind === 'voice' ? <Button label={running ? 'Stop full voice appliance' : 'Start full voice appliance'} onPress={running ? stopFull : startFull} /> : null}
        {kind === 'wake' ? <Button label={running ? 'Stop wake tests' : 'Start volume wake test'} onPress={running ? stopFull : startVolumeOnly} /> : null}
        {kind === 'wake' ? <Button label="Diagnose Sherpa WASM" onPress={diagnoseSherpa} /> : null}
        {kind === 'wake' ? <Button label="Start Sherpa smoke test" onPress={startSherpaSmoke} /> : null}
      </View>

      {(kind === 'command' || kind === 'agent' || kind === 'voice') ? (
        <View style={styles.card}>
          <Text style={styles.label}>Test text</Text>
          <TextInput value={text} onChangeText={setText} style={styles.input} placeholder="say or type a command" placeholderTextColor="#7b8193" />
          <View style={styles.row}>
            {kind !== 'agent' ? <Button label="Run command/tool router" onPress={runCommand} /> : null}
            {kind !== 'command' ? <Button label="Send to live agent" onPress={runAgent} /> : null}
            {kind === 'voice' ? <Button label="Submit to appliance" onPress={() => applianceRef.current?.submitText(text)} /> : null}
          </View>
        </View>
      ) : null}

      <View style={styles.card}>
        <Text style={styles.label}>Logs</Text>
        {logs.length ? logs.map((item, index) => <Text key={`${index}-${item}`} style={styles.log}>{item}</Text>) : <Text style={styles.muted}>No logs yet.</Text>}
      </View>
    </ScrollView>
  );
}

function Button({ label, onPress }: { label: string; onPress: () => void | Promise<void> }) {
  const [busy, setBusy] = useState(false);
  return (
    <Pressable
      style={[styles.button, busy && styles.buttonBusy]}
      onPress={async () => {
        if (busy) return;
        setBusy(true);
        try { await onPress(); } finally { setBusy(false); }
      }}
    >
      <Text style={styles.buttonText}>{busy ? 'Working…' : label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { minHeight: '100%' as any, padding: 24, backgroundColor: '#05060a', gap: 16 },
  title: { color: '#f5f7ff', fontSize: 28, fontWeight: '700' },
  subtitle: { color: '#a7aec4', maxWidth: 900, lineHeight: 22 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, alignItems: 'center' },
  card: { borderWidth: 1, borderColor: '#20263a', backgroundColor: '#0b0f19', borderRadius: 18, padding: 16, gap: 12 },
  label: { color: '#e4e8ff', fontWeight: '700', fontSize: 16 },
  input: { color: '#f6f7ff', borderColor: '#333b57', borderWidth: 1, borderRadius: 12, padding: 12, minWidth: 320, backgroundColor: '#070a12' },
  button: { backgroundColor: '#e8edff', paddingHorizontal: 16, paddingVertical: 11, borderRadius: 999 },
  buttonBusy: { opacity: 0.6 },
  buttonText: { color: '#0b1020', fontWeight: '700' },
  log: { color: '#d7dcf1', fontFamily: 'monospace', paddingVertical: 8, borderTopColor: '#20263a', borderTopWidth: 1 },
  muted: { color: '#7b8193' },
});
