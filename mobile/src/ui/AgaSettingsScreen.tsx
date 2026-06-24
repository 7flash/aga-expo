import React, { useEffect, useState } from 'react';
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Link } from 'expo-router';
import { colors, radius, spacing } from './theme';
import { PERSONAS } from '../aga/personas';
import { loadPreferences, savePreferences, type Preferences } from '../db/localStore';

export function AgaSettingsScreen() {
  const [prefs, setPrefs] = useState<Preferences | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => { void loadPreferences().then(setPrefs); }, []);

  async function update(next: Partial<Preferences>) {
    const savedPrefs = await savePreferences(next);
    setPrefs(savedPrefs);
    setSaved(true);
    setTimeout(() => setSaved(false), 1200);
  }

  if (!prefs) {
    return <SafeAreaView style={styles.safe}><Text style={styles.loading}>Loading settings…</Text></SafeAreaView>;
  }

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>AGA Settings</Text>
            <Text style={styles.sub}>Stored locally inside the APK. No backend required.</Text>
          </View>
          <Link href="/" asChild><Pressable style={styles.back}><Text style={styles.backText}>Back</Text></Pressable></Link>
        </View>

        {saved && <Text style={styles.saved}>Saved.</Text>}

        <Field label="Wake phrase" value={prefs.wakePhrase} onChangeText={(wakePhrase) => update({ wakePhrase })} />
        <Field label="Voice locale" value={prefs.voiceLocale} onChangeText={(voiceLocale) => update({ voiceLocale })} />
        <Field label="OpenAI API key" value={prefs.openaiApiKey} onChangeText={(openaiApiKey) => update({ openaiApiKey })} secureTextEntry />
        <Field label="Gemini API key" value={prefs.geminiApiKey} onChangeText={(geminiApiKey) => update({ geminiApiKey })} secureTextEntry />

        <Text style={styles.sectionTitle}>Brain mode</Text>
        <View style={styles.choiceRow}>
          {(['offline', 'openai', 'gemini'] as const).map((brainMode) => (
            <Pressable key={brainMode} onPress={() => update({ brainMode })} style={[styles.choice, prefs.brainMode === brainMode && styles.choiceActive]}>
              <Text style={styles.choiceText}>{brainMode}</Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.sectionTitle}>Persona</Text>
        <View style={styles.personaGrid}>
          {Object.values(PERSONAS).map((persona) => (
            <Pressable key={persona.id} onPress={() => update({ persona: persona.id })} style={[styles.personaCard, prefs.persona === persona.id && styles.choiceActive]}>
              <Text style={styles.personaTitle}>{persona.label}</Text>
              <Text style={styles.personaDesc}>{persona.description}</Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Field({ label, value, onChangeText, secureTextEntry }: { label: string; value: string; onChangeText: (v: string) => void; secureTextEntry?: boolean }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        value={draft}
        onChangeText={setDraft}
        onBlur={() => onChangeText(draft)}
        onSubmitEditing={() => onChangeText(draft)}
        secureTextEntry={secureTextEntry}
        placeholderTextColor={colors.faint}
        style={styles.input}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.lg, paddingBottom: 80, gap: spacing.md },
  loading: { color: colors.text, padding: spacing.xl },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: spacing.md, backgroundColor: colors.panel, borderColor: colors.border, borderWidth: 1, padding: spacing.lg, borderRadius: radius.lg },
  title: { color: colors.text, fontSize: 28, fontWeight: '900' },
  sub: { color: colors.muted, marginTop: 4 },
  back: { borderColor: colors.border, borderWidth: 1, borderRadius: radius.pill, paddingHorizontal: 16, paddingVertical: 10, backgroundColor: colors.panelStrong },
  backText: { color: colors.text, fontWeight: '900' },
  saved: { color: colors.good, fontWeight: '900' },
  field: { backgroundColor: colors.panel, borderColor: colors.border, borderWidth: 1, padding: spacing.md, borderRadius: radius.lg },
  label: { color: colors.cyan, fontSize: 12, letterSpacing: 1.4, fontWeight: '900', marginBottom: 8, textTransform: 'uppercase' },
  input: { color: colors.text, minHeight: 48, borderRadius: radius.md, backgroundColor: 'rgba(255,255,255,0.07)', paddingHorizontal: spacing.md },
  sectionTitle: { color: colors.gold, fontWeight: '900', fontSize: 18, marginTop: spacing.sm },
  choiceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  choice: { paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderRadius: radius.pill, backgroundColor: colors.panel, borderWidth: 1, borderColor: colors.border },
  choiceActive: { borderColor: colors.cyan, backgroundColor: 'rgba(103,232,249,0.18)' },
  choiceText: { color: colors.text, fontWeight: '900' },
  personaGrid: { gap: spacing.md },
  personaCard: { backgroundColor: colors.panel, borderColor: colors.border, borderWidth: 1, padding: spacing.lg, borderRadius: radius.lg },
  personaTitle: { color: colors.text, fontSize: 17, fontWeight: '900' },
  personaDesc: { color: colors.muted, marginTop: 5 },
});
