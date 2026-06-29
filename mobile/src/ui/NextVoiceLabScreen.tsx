import React from 'react';
import { View, Text, TextInput, Pressable, ScrollView, StyleSheet } from 'react-native';
import { runExclusiveVoiceTurnNext } from '../voice/exclusiveVoiceTurnNext';
import { SherpaHealthPanel } from './SherpaHealthPanel';
import { AndroidWakeReadinessPanel } from './AndroidWakeReadinessPanel';

type Log = { at: string; message: string; raw?: unknown };

export function NextVoiceLabScreen() {
  const [text, setText] = React.useState('open youtube calm music');
  const [logs, setLogs] = React.useState<Log[]>([]);

  function log(event: Record<string, unknown>) {
    setLogs((prev) => [{ at: new Date().toLocaleTimeString(), message: `${event.stage || 'event'}${event.route ? `: ${event.route}` : ''}${event.tool ? ` ${event.tool}` : ''}`, raw: event }, ...prev].slice(0, 80));
  }

  async function run(forceRoute?: 'short_gpt' | 'live_agent') {
    await runExclusiveVoiceTurnNext(text, {
      log,
      speak: async (reply) => log({ stage: 'speak', reply }),
      startLiveAgent: async (_text, reason) => log({ stage: 'live_agent_start_stub', reason }),
      runShortGpt: async (input) => `Short GPT would answer: ${input}`,
    }, forceRoute ? { forceRoute } : {});
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.h1}>AGA Next Voice Lab</Text>
      <Text style={styles.p}>Tests exclusive routing, direct YouTube execution, live-agent gating, Sherpa health, and Android wake readiness.</Text>

      <View style={styles.card}>
        <Text style={styles.title}>Test text</Text>
        <TextInput style={styles.input} value={text} onChangeText={setText} />
        <View style={styles.buttons}>
          <Pressable style={styles.button} onPress={() => run()}><Text style={styles.buttonText}>Run exclusive auto route</Text></Pressable>
          <Pressable style={styles.button} onPress={() => run('live_agent')}><Text style={styles.buttonText}>Force live gate</Text></Pressable>
          <Pressable style={styles.button} onPress={() => run('short_gpt')}><Text style={styles.buttonText}>Force short GPT</Text></Pressable>
        </View>
      </View>

      <SherpaHealthPanel />
      <AndroidWakeReadinessPanel />

      <View style={styles.card}>
        <Text style={styles.title}>Exclusive turn logs</Text>
        {logs.map((entry, index) => (
          <View key={`${entry.at}-${index}`} style={styles.logRow}>
            <Text style={styles.logText}>{entry.at}   {entry.message}</Text>
            {entry.raw ? <Text style={styles.raw}>{JSON.stringify(entry.raw, null, 2)}</Text> : null}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#030712' },
  content: { padding: 24, gap: 18 },
  h1: { color: '#f8fbff', fontSize: 34, fontWeight: '900' },
  p: { color: '#b8c5df', fontSize: 16, lineHeight: 24 },
  card: { borderWidth: 1, borderColor: '#243047', backgroundColor: '#08111d', borderRadius: 18, padding: 18, gap: 12 },
  title: { color: '#f4f7ff', fontSize: 20, fontWeight: '800' },
  input: { color: '#fff', borderColor: '#32405c', borderWidth: 1, borderRadius: 12, padding: 14, fontSize: 16 },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  button: { backgroundColor: '#e8eefc', borderRadius: 999, paddingHorizontal: 18, paddingVertical: 12 },
  buttonText: { color: '#08111d', fontWeight: '900' },
  logRow: { borderTopWidth: 1, borderTopColor: '#1d273a', paddingTop: 10, gap: 6 },
  logText: { color: '#dbe5ff', fontFamily: 'monospace', fontSize: 14 },
  raw: { color: '#aebde0', fontFamily: 'monospace', fontSize: 12 },
});
