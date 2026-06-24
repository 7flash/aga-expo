import { SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { PERSONAS } from '../src/aga/personas';

export default function SettingsScreen() {
  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>AGA voice settings</Text>
        <Text style={styles.copy}>
          This screen is intentionally read-only for the first single-APK pass. In production, AGA changes these by voice: “Hey AGA, use calm voice”, “speak slower”, or “translate to Indonesian”.
        </Text>
        {PERSONAS.map((persona) => (
          <View style={styles.card} key={persona.id}>
            <Text style={styles.cardTitle}>{persona.label}</Text>
            <Text style={styles.cardCopy}>{persona.description}</Text>
            <Text style={styles.meta}>rate {persona.speechRate.toFixed(2)} · pitch {persona.pitch.toFixed(2)}</Text>
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#080b1d' },
  content: { padding: 20, gap: 14 },
  title: { color: '#fff7ed', fontSize: 28, fontWeight: '900', letterSpacing: -0.7 },
  copy: { color: '#cbd5e1', fontSize: 15, lineHeight: 22 },
  card: {
    padding: 16,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.16)',
  },
  cardTitle: { color: '#fef3c7', fontSize: 18, fontWeight: '900' },
  cardCopy: { color: '#dbeafe', marginTop: 6, fontSize: 14, lineHeight: 20 },
  meta: { color: '#67e8f9', marginTop: 10, fontSize: 12, fontWeight: '800' },
});
