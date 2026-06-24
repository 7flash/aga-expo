import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Link } from 'expo-router';
import { AgaAvatar } from './AgaAvatar';
import { colors, radius, spacing } from './theme';
import { hasWakeWord, parseVoiceCommand, type AgaAction, type AgaMode } from '../aga/actions';
import { askBrain, translatePhrase } from '../backend/brain';
import {
  addMemory,
  addMessage,
  addReminder,
  getDiagnostics,
  initializeLocalStore,
  listEvents,
  listMessages,
  loadPreferences,
  logEvent,
  savePreferences,
  searchMemories,
  type Preferences,
  clearMessages,
  clearReminders,
  drainDueReminders,
  listPendingReminders,
  type Reminder,
} from '../db/localStore';
import { NativeSpeechLoop } from '../voice/nativeSpeech';
import { speak, stopSpeaking } from '../voice/tts';

const initialPrefs: Preferences = {
  wakePhrase: 'hey aga',
  persona: 'warm',
  voiceLocale: 'en-US',
  openaiApiKey: process.env.EXPO_PUBLIC_OPENAI_API_KEY ?? '',
  geminiApiKey: process.env.EXPO_PUBLIC_GEMINI_API_KEY ?? '',
  brainMode: ((process.env.EXPO_PUBLIC_AGA_BRAIN_MODE as Preferences['brainMode']) || 'openai') as Preferences['brainMode'],
  translateTarget: null,
  showDiagnostics: false,
  proactiveReminders: true,
};

export function AgaScreen() {
  const [ready, setReady] = useState(false);
  const [prefs, setPrefs] = useState<Preferences>(initialPrefs);
  const [mode, setMode] = useState<AgaMode>('sleeping');
  const [interim, setInterim] = useState('');
  const [messages, setMessages] = useState<Array<{ role: string; content: string; createdAt?: string }>>([]);
  const [events, setEvents] = useState<Array<{ label: string; detail: string; createdAt: string }>>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [diagnostics, setDiagnostics] = useState<any>(null);
  const [manualText, setManualText] = useState('');
  const [speechStatus, setSpeechStatus] = useState('starting');
  const loopRef = useRef<NativeSpeechLoop | null>(null);
  const prefsRef = useRef(prefs);
  const processingRef = useRef(false);
  const activeUntilRef = useRef(0);
  const proactiveBusyRef = useRef(false);

  prefsRef.current = prefs;

  const refresh = useCallback(async () => {
    setMessages(await listMessages(12));
    setEvents(await listEvents(8));
    setDiagnostics(await getDiagnostics());
    setReminders(await listPendingReminders(5));
  }, []);

  const say = useCallback(async (text: string) => {
    const currentPrefs = prefsRef.current;
    setMode('speaking');
    await addMessage('assistant', text);
    setMessages(await listMessages(12));
    await speak(text, currentPrefs, {
      onDone: () => setMode(currentPrefs.translateTarget ? 'translating' : 'sleeping'),
    });
  }, []);

  const applyAction = useCallback(async (action: AgaAction) => {
    const currentPrefs = prefsRef.current;
    switch (action.type) {
      case 'speak':
        await say(action.text);
        return;
      case 'stop_speaking':
        await stopSpeaking();
        setMode('listening');
        await logEvent('voice.stop', 'Stopped TTS by command');
        return;
      case 'remember':
        await addMemory(action.text);
        await logEvent('memory.add', action.text);
        await refresh();
        return;
      case 'recall': {
        const found = await searchMemories(action.query, 6);
        const speech = found.length
          ? `I remember ${found.map((m) => m.text).join('; ')}`
          : action.query
            ? `I do not have a memory about ${action.query} yet.`
            : 'I do not have saved memories yet.';
        await say(speech);
        return;
      }
      case 'set_persona': {
        const next = await savePreferences({ persona: action.persona });
        setPrefs(next);
        await logEvent('prefs.persona', action.persona);
        return;
      }
      case 'set_wake_phrase': {
        const next = await savePreferences({ wakePhrase: action.phrase.toLowerCase() });
        setPrefs(next);
        await logEvent('prefs.wakePhrase', action.phrase);
        return;
      }
      case 'translate_start': {
        const next = await savePreferences({ translateTarget: action.target });
        setPrefs(next);
        setMode('translating');
        await logEvent('translate.start', action.target);
        return;
      }
      case 'translate_stop': {
        const next = await savePreferences({ translateTarget: null });
        setPrefs(next);
        setMode('sleeping');
        await logEvent('translate.stop');
        return;
      }
      case 'show_diagnostics': {
        const next = await savePreferences({ showDiagnostics: !currentPrefs.showDiagnostics });
        setPrefs(next);
        await refresh();
        return;
      }
      case 'add_reminder': {
        const reminder = await addReminder(action.text, action.dueAt);
        await logEvent('reminder.add', `${reminder.text} @ ${reminder.dueAt}`);
        await refresh();
        await say(`Okay, I will remind you about ${action.text}.`);
        return;
      }
      case 'list_reminders': {
        const pending = await listPendingReminders(6);
        if (!pending.length) {
          await say('You have no pending reminders.');
        } else {
          await say(`You have ${pending.length} reminder${pending.length === 1 ? '' : 's'}: ${pending.map((item) => item.text).join('; ')}.`);
        }
        await refresh();
        return;
      }
      case 'clear_reminders': {
        await clearReminders();
        await logEvent('reminder.clear');
        await refresh();
        await say('I cleared your reminders.');
        return;
      }
      case 'test_voice':
        await say('My voice is working. I am listening from the APK, without localhost.');
        return;
      case 'status': {
        const diag = await getDiagnostics();
        await say(`I am running locally. Speech status is ${speechStatus}. I have ${diag.messages} messages, ${diag.memories} memories, and ${diag.pendingReminders} pending reminders.`);
        await refresh();
        return;
      }
      case 'open_settings':
        await say('Use the settings link on screen. I am ready without any backend.');
        return;
      case 'reset_conversation':
        await clearMessages();
        setMessages([]);
        await refresh();
        return;
      case 'chat':
        return;
    }
  }, [refresh, say]);

  const handleRecognizedText = useCallback(async (recognized: string) => {
    const text = recognized.trim();
    if (!text || processingRef.current) return;
    const currentPrefs = prefsRef.current;
    const now = Date.now();
    const woke = hasWakeWord(text, currentPrefs.wakePhrase);
    const active = now < activeUntilRef.current;

    if (!woke && !active && !currentPrefs.translateTarget) {
      setInterim(text);
      return;
    }

    activeUntilRef.current = Date.now() + 35000;
    processingRef.current = true;
    setMode(currentPrefs.translateTarget ? 'translating' : 'thinking');
    setInterim(text);
    await addMessage('user', text);
    await logEvent('voice.final', text);
    setMessages(await listMessages(12));

    try {
      if (currentPrefs.translateTarget && !woke) {
        const translated = await translatePhrase(text, currentPrefs.translateTarget, currentPrefs);
        await say(translated);
        return;
      }

      const parsed = parseVoiceCommand(text, currentPrefs.wakePhrase);
      for (const action of parsed.actions) {
        if (action.type !== 'chat') await applyAction(action);
      }

      const chatAction = parsed.actions.find((action) => action.type === 'chat') as AgaAction | undefined;
      if (chatAction?.type === 'chat') {
        const [history, memories] = await Promise.all([listMessages(20), searchMemories(undefined, 8)]);
        const reply = await askBrain({ text: chatAction.text, prefs: currentPrefs, history, memories });
        await say(reply);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'I hit a local error.';
      await logEvent('turn.error', message);
      await say(`I hit a small glitch, but I am still here. ${message}`);
    } finally {
      processingRef.current = false;
      await refresh();
    }
  }, [applyAction, refresh, say]);

  const handlersRef = useRef({ onFinal: handleRecognizedText });
  handlersRef.current.onFinal = handleRecognizedText;

  useEffect(() => {
    let mounted = true;
    (async () => {
      await initializeLocalStore();
      const loaded = await loadPreferences();
      if (!mounted) return;
      setPrefs(loaded);
      await refresh();
      setReady(true);
    })();
    return () => { mounted = false; };
  }, [refresh]);

  useEffect(() => {
    if (!ready) return;
    const loop = new NativeSpeechLoop({
      onPartial: setInterim,
      onFinal: (text) => handlersRef.current.onFinal(text),
      onError: async (message) => {
        setSpeechStatus(`mic error: ${message}`);
        await logEvent('voice.error', message);
        await refresh();
      },
      onStatus: (status) => setSpeechStatus(status),
    }, prefs.voiceLocale || 'en-US');
    loopRef.current = loop;
    void loop.start();
    return () => { void loop.destroy(); loopRef.current = null; };
  }, [ready, prefs.voiceLocale, refresh]);

  useEffect(() => {
    if (!ready || !prefs.proactiveReminders) return;
    const timer = setInterval(() => {
      if (proactiveBusyRef.current || processingRef.current) return;
      proactiveBusyRef.current = true;
      (async () => {
        try {
          const due = await drainDueReminders();
          for (const reminder of due) {
            await logEvent('reminder.due', reminder.text);
            await say(`Reminder: ${reminder.text}`);
          }
          if (due.length) await refresh();
        } finally {
          proactiveBusyRef.current = false;
        }
      })();
    }, 15000);
    return () => clearInterval(timer);
  }, [ready, prefs.proactiveReminders, refresh, say]);

  async function submitManual() {
    const text = manualText.trim();
    if (!text) return;
    setManualText('');
    await handleRecognizedText(text);
  }

  const reminderBody = reminders.length
    ? reminders.map((item) => `• ${item.text} — ${new Date(item.dueAt).toLocaleString()}`).join('\n')
    : 'No pending reminders. Try: Hey AGA, remind me to stretch in one minute.';

  const statusText = mode === 'sleeping'
    ? `Listening for “${prefs.wakePhrase}”`
    : mode === 'thinking'
      ? 'Thinking…'
      : mode === 'speaking'
        ? 'Speaking — say AGA stop'
        : mode === 'translating'
          ? `Phrase translating to ${prefs.translateTarget}`
          : 'Listening now';

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.topBar}>
          <View style={styles.brandDot}><Text style={styles.brandLetter}>A</Text></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.brand}>AGA</Text>
            <Text style={styles.brandSub}>single APK • no backend required</Text>
          </View>
          <Link href="/settings" asChild><Pressable style={styles.settingsButton}><Text style={styles.settingsText}>Settings</Text></Pressable></Link>
        </View>

        <AgaAvatar mode={mode} />

        <View style={styles.statusPanel}>
          <Text style={styles.kicker}>VOICE STATUS</Text>
          <Text style={styles.status}>{statusText}</Text>
          <Text style={styles.statusSub}>Speech module: {speechStatus}. The app does not load localhost or TradJS to boot.</Text>
        </View>

        <View style={styles.hearsPanel}>
          <Text style={styles.kicker}>AGA HEARS</Text>
          <Text style={styles.hears}>{interim || 'Say “Hey AGA, help” or type below while testing.'}</Text>
        </View>

        <View style={styles.manualRow}>
          <TextInput
            value={manualText}
            onChangeText={setManualText}
            placeholder="Type a test command, e.g. Hey AGA, remember that this works"
            placeholderTextColor={colors.faint}
            style={styles.input}
            onSubmitEditing={submitManual}
          />
          <Pressable style={styles.sendButton} onPress={submitManual}><Text style={styles.sendText}>Send</Text></Pressable>
        </View>

        <View style={styles.cardsRow}>
          <InfoCard title="Try" body={`“${prefs.wakePhrase}, help”\n“${prefs.wakePhrase}, remember that this boots”\n“${prefs.wakePhrase}, what do you remember?”`} />
          <InfoCard title="Brain" body={`${prefs.brainMode}\nOpenAI key: ${prefs.openaiApiKey ? 'set' : 'not set'}\nGemini key: ${prefs.geminiApiKey ? 'set' : 'not set'}`} />
          <InfoCard title="Reminders" body={reminderBody} />
        </View>

        <View style={styles.messagesPanel}>
          <Text style={styles.kicker}>RECENT CONVERSATION</Text>
          {messages.length === 0 ? <Text style={styles.empty}>No local messages yet.</Text> : messages.map((message, index) => (
            <View key={`${message.createdAt ?? index}-${index}`} style={styles.messageBubble}>
              <Text style={styles.messageRole}>{message.role === 'assistant' ? 'AGA' : 'You'}</Text>
              <Text style={styles.messageText}>{message.content}</Text>
            </View>
          ))}
        </View>

        {prefs.showDiagnostics && (
          <View style={styles.diagnosticsPanel}>
            <Text style={styles.kicker}>DIAGNOSTICS</Text>
            <Text style={styles.diagText}>{JSON.stringify({ diagnostics, speech: loopRef.current?.diagnostics }, null, 2)}</Text>
            {events.map((event, index) => <Text key={`${event.createdAt}-${index}`} style={styles.eventText}>[{event.label}] {event.detail}</Text>)}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function InfoCard({ title, body }: { title: string; body: string }) {
  return (
    <View style={styles.infoCard}>
      <Text style={styles.infoTitle}>{title}</Text>
      <Text style={styles.infoBody}>{body}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.lg, paddingBottom: 64, gap: spacing.md },
  topBar: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, backgroundColor: colors.panel, borderColor: colors.border, borderWidth: 1, padding: spacing.md, borderRadius: radius.lg },
  brandDot: { width: 44, height: 44, borderRadius: 16, backgroundColor: colors.cyan, alignItems: 'center', justifyContent: 'center' },
  brandLetter: { color: '#0f172a', fontWeight: '900', fontSize: 20 },
  brand: { color: colors.text, fontSize: 20, fontWeight: '900' },
  brandSub: { color: colors.muted, fontSize: 12, marginTop: 2 },
  settingsButton: { paddingHorizontal: 14, paddingVertical: 9, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.panelStrong },
  settingsText: { color: colors.text, fontWeight: '800' },
  statusPanel: { backgroundColor: colors.panel, borderColor: colors.border, borderWidth: 1, padding: spacing.lg, borderRadius: radius.lg },
  kicker: { color: colors.cyan, letterSpacing: 2, fontSize: 11, fontWeight: '900', marginBottom: 7 },
  status: { color: colors.text, fontSize: 30, fontWeight: '900', letterSpacing: -1 },
  statusSub: { color: colors.muted, fontSize: 13, lineHeight: 20, marginTop: 8 },
  hearsPanel: { backgroundColor: 'rgba(103, 232, 249, 0.1)', borderColor: 'rgba(103, 232, 249, 0.35)', borderWidth: 1, padding: spacing.lg, borderRadius: radius.lg },
  hears: { color: colors.text, fontSize: 21, fontWeight: '800', lineHeight: 30 },
  manualRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
  input: { flex: 1, minHeight: 52, color: colors.text, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.panel, borderRadius: radius.md, paddingHorizontal: spacing.md },
  sendButton: { minHeight: 52, paddingHorizontal: spacing.lg, borderRadius: radius.md, backgroundColor: colors.lavender, alignItems: 'center', justifyContent: 'center' },
  sendText: { color: colors.text, fontWeight: '900' },
  cardsRow: { flexDirection: 'row', gap: spacing.md, flexWrap: 'wrap' },
  infoCard: { flex: 1, minWidth: 240, backgroundColor: colors.panel, borderColor: colors.border, borderWidth: 1, padding: spacing.lg, borderRadius: radius.lg },
  infoTitle: { color: colors.gold, fontWeight: '900', fontSize: 16, marginBottom: 8 },
  infoBody: { color: colors.muted, lineHeight: 22 },
  messagesPanel: { backgroundColor: colors.panel, borderColor: colors.border, borderWidth: 1, padding: spacing.lg, borderRadius: radius.lg, gap: spacing.sm },
  empty: { color: colors.faint },
  messageBubble: { padding: spacing.md, borderRadius: radius.md, backgroundColor: 'rgba(255,255,255,0.07)' },
  messageRole: { color: colors.cyan, fontWeight: '900', marginBottom: 4 },
  messageText: { color: colors.text, lineHeight: 21 },
  diagnosticsPanel: { backgroundColor: 'rgba(15, 23, 42, 0.88)', borderColor: colors.border, borderWidth: 1, padding: spacing.lg, borderRadius: radius.lg },
  diagText: { color: colors.good, fontFamily: 'monospace', fontSize: 11 },
  eventText: { color: colors.muted, fontSize: 11, marginTop: 4 },
});

export default AgaScreen;
