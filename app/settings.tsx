import { useEffect, useState } from 'react';
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { PERSONAS } from '../src/aga/personas';
import { migrate } from '../src/db/migrations';
import { getPreferences, updatePreferences } from '../src/db/preferences';
import type { UserPreferences } from '../src/db/schema';

export default function SettingsScreen() {
  const [prefs, setPrefs] = useState<UserPreferences | null>(null);
  const [wakePhrase, setWakePhrase] = useState('hey aga');
  const [openaiKey, setOpenaiKey] = useState('');
  const [geminiKey, setGeminiKey] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      await migrate();
      const next = await getPreferences();
      if (!mounted) return;
      setPrefs(next);
      setWakePhrase(next.wakePhrase);
      setOpenaiKey(next.openaiApiKey ?? '');
      setGeminiKey(next.geminiApiKey ?? '');
    })();
    return () => { mounted = false; };
  }, []);

  async function savePatch(patch: Partial<UserPreferences>) {
    const next = await updatePreferences(patch);
    setPrefs(next);
    setWakePhrase(next.wakePhrase);
    setOpenaiKey(next.openaiApiKey ?? '');
    setGeminiKey(next.geminiApiKey ?? '');
    setSaved(true);
    setTimeout(() => setSaved(false), 1400);
  }

  if (!prefs) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.content}><Text style={styles.copy}>Loading AGA settings…</Text></View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>AGA settings</Text>
        <Text style={styles.copy}>Voice commands still control these, but this screen gives you a no-server way to configure the single APK build during development.</Text>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Wake phrase</Text>
          <TextInput value={wakePhrase} onChangeText={setWakePhrase} style={styles.input} placeholderTextColor="rgba(231,238,255,0.42)" />
          <Pressable style={styles.button} onPress={() => savePatch({ wakePhrase: wakePhrase.trim().toLowerCase() || 'hey aga' })}>
            <Text style={styles.buttonText}>Save wake phrase</Text>
          </Pressable>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Brain mode</Text>
          <View style={styles.row}>
            {(['offline', 'openai-direct', 'gemini-direct'] as const).map((mode) => (
              <Pressable key={mode} style={[styles.chip, prefs.backendMode === mode && styles.chipActive]} onPress={() => savePatch({ backendMode: mode })}>
                <Text style={[styles.chipText, prefs.backendMode === mode && styles.chipTextActive]}>{mode}</Text>
              </Pressable>
            ))}
          </View>
          <TextInput value={openaiKey} onChangeText={setOpenaiKey} style={styles.input} placeholder="OpenAI key" placeholderTextColor="rgba(231,238,255,0.42)" secureTextEntry />
          <TextInput value={geminiKey} onChangeText={setGeminiKey} style={styles.input} placeholder="Gemini key" placeholderTextColor="rgba(231,238,255,0.42)" secureTextEntry />
          <Pressable style={styles.button} onPress={() => savePatch({ openaiApiKey: openaiKey || null, geminiApiKey: geminiKey || null })}>
            <Text style={styles.buttonText}>Save API keys</Text>
          </Pressable>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Personas</Text>
          {PERSONAS.map((persona) => (
            <Pressable key={persona.id} style={[styles.persona, prefs.activePersona === persona.id && styles.personaActive]} onPress={() => savePatch({ activePersona: persona.id, speechRate: persona.speechRate, pitch: persona.pitch })}>
              <Text style={styles.personaTitle}>{persona.label}</Text>
              <Text style={styles.personaCopy}>{persona.description}</Text>
              <Text style={styles.meta}>rate {persona.speechRate.toFixed(2)} · pitch {persona.pitch.toFixed(2)}</Text>
            </Pressable>
          ))}
        </View>

        {saved && <Text style={styles.saved}>Saved.</Text>}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#080b1d' },
  content: { padding: 20, gap: 14, paddingBottom: 34 },
  title: { color: '#fff7ed', fontSize: 30, fontWeight: '900', letterSpacing: -0.7 },
  copy: { color: '#cbd5e1', fontSize: 15, lineHeight: 22 },
  card: { gap: 10, padding: 16, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.07)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.16)' },
  cardTitle: { color: '#fef3c7', fontSize: 18, fontWeight: '900' },
  input: { minHeight: 46, color: '#f8fbff', paddingHorizontal: 12, borderRadius: 14, backgroundColor: 'rgba(15,23,42,0.75)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.14)' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 8, backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.14)' },
  chipActive: { backgroundColor: '#67e8f9', borderColor: '#67e8f9' },
  chipText: { color: '#dbeafe', fontSize: 11, fontWeight: '900' },
  chipTextActive: { color: '#06111c' },
  button: { alignItems: 'center', justifyContent: 'center', minHeight: 44, borderRadius: 14, backgroundColor: '#67e8f9' },
  buttonText: { color: '#06111c', fontWeight: '900' },
  persona: { padding: 12, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.12)' },
  personaActive: { borderColor: '#fef3c7', backgroundColor: 'rgba(254,243,199,0.1)' },
  personaTitle: { color: '#f8fbff', fontSize: 15, fontWeight: '900' },
  personaCopy: { color: '#dbeafe', marginTop: 4, fontSize: 13, lineHeight: 18 },
  meta: { color: '#67e8f9', marginTop: 7, fontSize: 11, fontWeight: '800' },
  saved: { color: '#bbf7d0', fontWeight: '900', textAlign: 'center' },
});
