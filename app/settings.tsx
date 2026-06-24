import { useEffect, useState } from 'react';
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { PERSONAS } from '../src/aga/personas';
import { migrate } from '../src/db/migrations';
import { getPreferences, updatePreferences } from '../src/db/preferences';
import type { UserPreferences } from '../src/db/schema';
import { createBackupJson, getStorageSummary, summarizeStorage } from '../src/db/backup';
import { copyOrShareText } from '../src/platform/optionalShare';

export default function SettingsScreen() {
  const [prefs, setPrefs] = useState<UserPreferences | null>(null);
  const [wakePhrase, setWakePhrase] = useState('hey aga');
  const [voiceLocale, setVoiceLocale] = useState('en-US');
  const [openaiKey, setOpenaiKey] = useState('');
  const [geminiKey, setGeminiKey] = useState('');
  const [remoteUrl, setRemoteUrl] = useState('');
  const [remoteToken, setRemoteToken] = useState('');
  const [saved, setSaved] = useState(false);
  const [storageNote, setStorageNote] = useState('');

  useEffect(() => {
    let mounted = true;
    void (async () => {
      await migrate();
      const next = await getPreferences();
      if (!mounted) return;
      syncLocalState(next);
    })();
    return () => { mounted = false; };
  }, []);

  function syncLocalState(next: UserPreferences) {
    setPrefs(next);
    setWakePhrase(next.wakePhrase);
    setVoiceLocale(next.voiceLocale ?? 'en-US');
    setOpenaiKey(next.openaiApiKey ?? '');
    setGeminiKey(next.geminiApiKey ?? '');
    setRemoteUrl(next.remoteBackendUrl ?? '');
    setRemoteToken(next.remoteBackendToken ?? '');
  }

  async function savePatch(patch: Partial<UserPreferences>) {
    const next = await updatePreferences(patch);
    syncLocalState(next);
    setSaved(true);
    setTimeout(() => setSaved(false), 1400);
  }

  async function exportBackup() {
    const json = await createBackupJson();
    const result = await copyOrShareText(`aga-backup-${Date.now()}.json`, json);
    setStorageNote(`Backup ${result.note}. Size ${Math.max(1, Math.round(json.length / 1024))} KB.`);
  }

  async function summarizeLocalStorage() {
    const summary = await getStorageSummary();
    setStorageNote(summarizeStorage(summary));
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
        <Text style={styles.copy}>Single-APK controls for voice, memory, media, routines, direct model calls, and optional remote TradJS brain.</Text>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>First-run status</Text>
          <Text style={styles.copy}>Current setup is {prefs.firstRunComplete ? 'complete' : 'open'}. You can also say “complete setup”.</Text>
          <Pressable style={styles.button} onPress={() => savePatch({ firstRunComplete: 1 })}>
            <Text style={styles.buttonText}>Mark setup complete</Text>
          </Pressable>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Wake phrase and language</Text>
          <TextInput value={wakePhrase} onChangeText={setWakePhrase} style={styles.input} placeholder="Wake phrase" placeholderTextColor="rgba(231,238,255,0.42)" />
          <TextInput value={voiceLocale} onChangeText={setVoiceLocale} style={styles.input} placeholder="Voice locale, e.g. en-US" placeholderTextColor="rgba(231,238,255,0.42)" />
          <View style={styles.row}>
            <Pressable style={styles.buttonSmall} onPress={() => savePatch({ wakePhrase: wakePhrase.trim().toLowerCase() || 'hey aga', voiceLocale: voiceLocale.trim() || 'en-US' })}>
              <Text style={styles.buttonText}>Save voice setup</Text>
            </Pressable>
            <Pressable style={[styles.chip, prefs.speechWatchdogEnabled ? styles.chipActive : null]} onPress={() => savePatch({ speechWatchdogEnabled: prefs.speechWatchdogEnabled ? 0 : 1 })}>
              <Text style={[styles.chipText, prefs.speechWatchdogEnabled ? styles.chipTextActive : null]}>watchdog {prefs.speechWatchdogEnabled ? 'on' : 'off'}</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Proactive reminders</Text>
          <Text style={styles.copy}>When on, AGA checks local reminders and routines while the app is open and speaks due events without a wake phrase.</Text>
          <View style={styles.row}>
            <Pressable style={[styles.chip, prefs.proactiveEnabled ? styles.chipActive : null]} onPress={() => savePatch({ proactiveEnabled: 1 })}>
              <Text style={[styles.chipText, prefs.proactiveEnabled ? styles.chipTextActive : null]}>on</Text>
            </Pressable>
            <Pressable style={[styles.chip, !prefs.proactiveEnabled ? styles.chipActive : null]} onPress={() => savePatch({ proactiveEnabled: 0 })}>
              <Text style={[styles.chipText, !prefs.proactiveEnabled ? styles.chipTextActive : null]}>off</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Local notifications</Text>
          <Text style={styles.copy}>When on, new reminders are also scheduled as native local notifications. Foreground spoken reminders still work without notifications.</Text>
          <View style={styles.row}>
            <Pressable style={[styles.chip, prefs.localNotificationsEnabled ? styles.chipActive : null]} onPress={() => savePatch({ localNotificationsEnabled: 1 })}>
              <Text style={[styles.chipText, prefs.localNotificationsEnabled ? styles.chipTextActive : null]}>on</Text>
            </Pressable>
            <Pressable style={[styles.chip, !prefs.localNotificationsEnabled ? styles.chipActive : null]} onPress={() => savePatch({ localNotificationsEnabled: 0 })}>
              <Text style={[styles.chipText, !prefs.localNotificationsEnabled ? styles.chipTextActive : null]}>off</Text>
            </Pressable>
          </View>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Brain mode</Text>
          <View style={styles.row}>
            {(['offline', 'openai-direct', 'gemini-direct', 'tradjs-remote'] as const).map((mode) => (
              <Pressable key={mode} style={[styles.chip, prefs.backendMode === mode && styles.chipActive]} onPress={() => savePatch({ backendMode: mode })}>
                <Text style={[styles.chipText, prefs.backendMode === mode && styles.chipTextActive]}>{mode}</Text>
              </Pressable>
            ))}
          </View>
          <TextInput value={openaiKey} onChangeText={setOpenaiKey} style={styles.input} placeholder="OpenAI key" placeholderTextColor="rgba(231,238,255,0.42)" secureTextEntry />
          <TextInput value={geminiKey} onChangeText={setGeminiKey} style={styles.input} placeholder="Gemini key" placeholderTextColor="rgba(231,238,255,0.42)" secureTextEntry />
          <TextInput value={remoteUrl} onChangeText={setRemoteUrl} style={styles.input} placeholder="Remote TradJS URL, optional" placeholderTextColor="rgba(231,238,255,0.42)" autoCapitalize="none" />
          <TextInput value={remoteToken} onChangeText={setRemoteToken} style={styles.input} placeholder="Remote token, optional" placeholderTextColor="rgba(231,238,255,0.42)" secureTextEntry />
          <Pressable style={styles.button} onPress={() => savePatch({ openaiApiKey: openaiKey || null, geminiApiKey: geminiKey || null, remoteBackendUrl: remoteUrl || null, remoteBackendToken: remoteToken || null })}>
            <Text style={styles.buttonText}>Save brain credentials</Text>
          </Pressable>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>Backup and local storage</Text>
          <Text style={styles.copy}>Create a JSON backup of AGA's local conversations, memories, reminders, routines, favorites, media state, preferences, and diagnostics.</Text>
          <View style={styles.row}>
            <Pressable style={styles.chip} onPress={summarizeLocalStorage}>
              <Text style={styles.chipText}>summary</Text>
            </Pressable>
            <Pressable style={styles.chip} onPress={exportBackup}>
              <Text style={styles.chipText}>export backup</Text>
            </Pressable>
          </View>
          {!!storageNote && <Text style={styles.meta}>{storageNote}</Text>}
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
  buttonSmall: { alignItems: 'center', justifyContent: 'center', minHeight: 38, borderRadius: 999, paddingHorizontal: 14, backgroundColor: '#67e8f9' },
  buttonText: { color: '#06111c', fontWeight: '900' },
  persona: { padding: 12, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.05)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.12)' },
  personaActive: { borderColor: '#fef3c7', backgroundColor: 'rgba(254,243,199,0.1)' },
  personaTitle: { color: '#f8fbff', fontSize: 15, fontWeight: '900' },
  personaCopy: { color: '#dbeafe', marginTop: 4, fontSize: 13, lineHeight: 18 },
  meta: { color: '#67e8f9', marginTop: 7, fontSize: 11, fontWeight: '800' },
  saved: { color: '#bbf7d0', fontWeight: '900', textAlign: 'center' },
});
