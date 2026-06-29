import React from 'react';
import { View, Text, Pressable, ScrollView, StyleSheet } from 'react-native';
import { diagnoseSherpaKeywordHealth, type SherpaKeywordHealth } from '../voice/sherpaKeywordDiagnostics';

export function SherpaHealthPanel() {
  const [health, setHealth] = React.useState<SherpaKeywordHealth | null>(null);
  const [busy, setBusy] = React.useState(false);

  async function run() {
    setBusy(true);
    try {
      setHealth(await diagnoseSherpaKeywordHealth());
    } finally {
      setBusy(false);
    }
  }

  React.useEffect(() => { run().catch(() => {}); }, []);

  const status = health?.realKeywordSpotting
    ? 'REAL KEYWORD SPOTTING'
    : health?.fallbackOnly
      ? 'FALLBACK ONLY — NOT REAL SHERPA WAKE'
      : 'UNKNOWN';

  return (
    <View style={styles.card}>
      <View style={styles.row}>
        <Text style={styles.title}>Sherpa health</Text>
        <Pressable onPress={run} style={styles.button}><Text style={styles.buttonText}>{busy ? 'Checking…' : 'Recheck'}</Text></Pressable>
      </View>
      <Text style={[styles.status, health?.realKeywordSpotting ? styles.good : styles.bad]}>{status}</Text>
      {health ? (
        <ScrollView style={styles.body}>
          <Text style={styles.mono}>Reason: {health.reason}</Text>
          <Text style={styles.label}>Phrases</Text>
          {health.groups.map((group) => (
            <Text key={group.id} style={styles.mono}>{group.id}: {group.phrases.join(', ') || '(none)'}</Text>
          ))}
          <Text style={styles.label}>Next steps</Text>
          {health.nextSteps.map((step, index) => <Text key={index} style={styles.mono}>• {step}</Text>)}
        </ScrollView>
      ) : <Text style={styles.mono}>No Sherpa health result yet.</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderColor: '#243047', backgroundColor: '#08111d', borderRadius: 18, padding: 18, gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  title: { color: '#f4f7ff', fontSize: 20, fontWeight: '800' },
  button: { backgroundColor: '#e8eefc', borderRadius: 999, paddingHorizontal: 16, paddingVertical: 10 },
  buttonText: { color: '#08111d', fontWeight: '800' },
  status: { fontSize: 16, fontWeight: '900' },
  good: { color: '#77ffbd' },
  bad: { color: '#ffd166' },
  body: { maxHeight: 260 },
  label: { color: '#8eeaff', fontSize: 13, fontWeight: '900', letterSpacing: 1.3, marginTop: 12, textTransform: 'uppercase' },
  mono: { color: '#dbe5ff', fontFamily: 'monospace', fontSize: 13, lineHeight: 19 },
});
