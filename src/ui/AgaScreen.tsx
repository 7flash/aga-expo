import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { WebView } from 'react-native-webview';
import type { WebView as WebViewType } from 'react-native-webview';
import { AgaAvatar } from './AgaAvatar';
import { StateRail } from './StateRail';
import { TranscriptStrip } from './TranscriptStrip';
import { NowPlaying } from './NowPlaying';
import { DebugPanel } from './DebugPanel';
import { MemoryReminderPanel } from './MemoryReminderPanel';
import { migrate } from '../db/migrations';
import { createConversation, getOrCreateConversation, listMessages, saveMessage } from '../db/conversations';
import { getPreferences, updatePreferences } from '../db/preferences';
import { logEvent, recentEvents } from '../db/eventLog';
import type { ChatMessage, Conversation, EventLog, MemoryFact, Reminder, UserPreferences } from '../db/schema';
import type { AgaAction } from '../aga/actions';
import type { AgaState } from '../aga/stateMachine';
import { stateLabel, transition } from '../aga/stateMachine';
import { getPersona } from '../aga/personas';
import { createAgaTurn } from '../aga/turn';
import { measureAsync } from '../aga/measure';
import { extendActiveWindow, extractWakeCommand, isActiveWindow } from '../voice/wakeWindow';
import { NativeSpeechLoop, isNativeSpeechAvailable } from '../voice/nativeSpeech';
import { speak, stopSpeaking } from '../voice/tts';
import { EMPTY_NOW_PLAYING, type NowPlaying as NowPlayingState } from '../media/nowPlaying';
import { saveMediaSession, updateLatestMediaState } from '../db/mediaSessions';
import { clearMemoryFacts, listMemoryFacts, saveMemoryFact, searchMemoryFacts } from '../db/memory';
import { cancelPendingReminders, createReminder, dueReminders, enqueueProactiveEvent, listPendingReminders, markProactiveEventSpoken, markReminderFired, nextQueuedProactiveEvent } from '../db/reminders';
import { audioPreviewHtml, searchMusic } from '../media/music';
import { searchYouTube, youtubeEmbedHtml } from '../media/youtube';
import { translateWithGemini } from '../backend/geminiDirect';

function webviewCommand(type: string, value?: number) {
  return JSON.stringify({ type, value });
}

function actionProducesOwnSpeech(action: AgaAction) {
  return action.type === 'media.status' || action.type === 'memory.recall' || action.type === 'reminder.list' || action.type === 'system.health';
}

export function AgaScreen() {
  const [ready, setReady] = useState(false);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [prefs, setPrefs] = useState<UserPreferences | null>(null);
  const [agaState, setAgaState] = useState<AgaState>('idle');
  const [interim, setInterim] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [nowPlaying, setNowPlaying] = useState<NowPlayingState>(EMPTY_NOW_PLAYING);
  const [playerHtml, setPlayerHtml] = useState<string | null>(null);
  const [devText, setDevText] = useState('');
  const [voiceAvailable, setVoiceAvailable] = useState(false);
  const [debugVisible, setDebugVisible] = useState(false);
  const [recentLog, setRecentLog] = useState<EventLog[]>([]);
  const [memories, setMemories] = useState<MemoryFact[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);

  const speechLoopRef = useRef<NativeSpeechLoop | null>(null);
  const activeUntilRef = useRef(0);
  const webviewRef = useRef<WebViewType>(null);
  const processingRef = useRef(false);
  const agaStateRef = useRef<AgaState>('idle');

  useEffect(() => {
    agaStateRef.current = agaState;
  }, [agaState]);

  const persona = useMemo(() => {
    const base = getPersona(prefs?.activePersona);
    return prefs ? { ...base, speechRate: prefs.speechRate ?? base.speechRate, pitch: prefs.pitch ?? base.pitch } : base;
  }, [prefs]);

  const sendMachine = useCallback((event: Parameters<typeof transition>[1]) => {
    setAgaState((state) => transition(state, event));
  }, []);

  const refreshMessages = useCallback(async (conversationId: number) => {
    setMessages(await listMessages(conversationId));
  }, []);

  const refreshLog = useCallback(async () => {
    setRecentLog(await recentEvents(24));
  }, []);

  const refreshLocalContext = useCallback(async () => {
    const [nextMemories, nextReminders] = await Promise.all([listMemoryFacts(8), listPendingReminders(8)]);
    setMemories(nextMemories);
    setReminders(nextReminders);
  }, []);

  useEffect(() => {
    let mounted = true;
    void (async () => {
      try {
        await migrate();
        const [nextConversation, nextPrefs] = await Promise.all([getOrCreateConversation(), getPreferences()]);
        if (!mounted) return;
        setConversation(nextConversation);
        setPrefs(nextPrefs);
        setMessages(await listMessages(nextConversation.id));
        setVoiceAvailable(isNativeSpeechAvailable());
        setReady(true);
        sendMachine({ type: 'boot' });
        await logEvent('system', 'apk_boot', { mode: 'single-apk' });
        await refreshLog();
        await refreshLocalContext();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Could not start AGA.');
        setAgaState('recovering');
      }
    })();
    return () => { mounted = false; };
  }, [refreshLocalContext, refreshLog, refreshMessages, sendMachine]);

  const speakAga = useCallback((text: string) => {
    sendMachine({ type: 'reply' });
    speak(text, persona, () => sendMachine({ type: 'speak_done' }));
  }, [persona, sendMachine]);

  const postPlayer = useCallback((type: string, value?: number) => {
    webviewRef.current?.postMessage(webviewCommand(type, value));
  }, []);

  const drainProactiveQueue = useCallback(async () => {
    if (!prefs?.proactiveEnabled || processingRef.current) return;
    const state = agaStateRef.current;
    if (state === 'thinking' || state === 'speaking' || state === 'listening' || state === 'wake_confirmed') return;

    const due = await dueReminders();
    for (const reminder of due) {
      await markReminderFired(reminder.id);
      await enqueueProactiveEvent({
        kind: 'reminder',
        speech: `Reminder: ${reminder.title}.`,
        payload: { reminderId: reminder.id, dueAt: reminder.dueAt },
      });
    }

    const event = await nextQueuedProactiveEvent();
    if (!event) {
      if (due.length) await refreshLocalContext();
      return;
    }

    await markProactiveEventSpoken(event.id);
    await logEvent('proactive', event.kind, { eventId: event.id });
    if (conversation) {
      const assistantMessage = await saveMessage(conversation.id, 'assistant', event.speech);
      setMessages((current) => [...current, assistantMessage].slice(-100));
    }
    speakAga(event.speech);
    await Promise.all([refreshLocalContext(), refreshLog()]);
  }, [conversation, prefs?.proactiveEnabled, refreshLocalContext, refreshLog, speakAga]);

  useEffect(() => {
    if (!ready) return;
    const interval = setInterval(() => {
      void drainProactiveQueue();
    }, 15_000);
    void drainProactiveQueue();
    return () => clearInterval(interval);
  }, [drainProactiveQueue, ready]);

  const applyAction = useCallback(async (action: AgaAction) => {
    await logEvent('action', action.type, action);
    switch (action.type) {

      case 'diagnostics.show': {
        setDebugVisible(true);
        await refreshLog();
        return;
      }
      case 'diagnostics.hide': {
        setDebugVisible(false);
        return;
      }
      case 'voice.rate': {
        const nextPrefs = await updatePreferences({ speechRate: Math.max(0.5, Math.min(2, action.value)) });
        setPrefs(nextPrefs);
        return;
      }
      case 'voice.pitch': {
        const nextPrefs = await updatePreferences({ pitch: Math.max(0.5, Math.min(2, action.value)) });
        setPrefs(nextPrefs);
        return;
      }
      case 'wake.set': {
        const nextPrefs = await updatePreferences({ wakePhrase: action.phrase });
        setPrefs(nextPrefs);
        return;
      }
      case 'media.status': {
        if (nowPlaying.kind === null || nowPlaying.state === 'stopped') {
          speakAga('Nothing is playing right now.');
        } else {
          speakAga(`${nowPlaying.title} is ${nowPlaying.state}.`);
        }
        return;
      }
      case 'proactive.toggle': {
        const nextPrefs = await updatePreferences({ proactiveEnabled: action.enabled ? 1 : 0 });
        setPrefs(nextPrefs);
        await refreshLocalContext();
        return;
      }
      case 'memory.save': {
        await saveMemoryFact(action.text, 'voice');
        await refreshLocalContext();
        return;
      }
      case 'memory.recall': {
        const facts = await searchMemoryFacts(action.query ?? '', 6);
        const reply = facts.length
          ? `I remember: ${facts.map((fact) => fact.text).join('; ')}.`
          : action.query
            ? `I do not have a memory note about ${action.query} yet.`
            : 'I do not have memory notes yet.';
        speakAga(reply);
        return;
      }
      case 'memory.clear': {
        await clearMemoryFacts();
        await refreshLocalContext();
        return;
      }
      case 'reminder.create': {
        await createReminder({ title: action.title, dueAt: action.dueAt, source: 'voice' });
        await refreshLocalContext();
        return;
      }
      case 'reminder.list': {
        const pending = await listPendingReminders(8);
        const reply = pending.length
          ? `Pending reminders: ${pending.map((item) => `${item.title} at ${new Date(item.dueAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`).join('; ')}.`
          : 'You do not have pending reminders.';
        speakAga(reply);
        return;
      }
      case 'reminder.clear': {
        await cancelPendingReminders();
        await refreshLocalContext();
        return;
      }
      case 'conversation.reset': {
        const next = await createConversation('AGA chat');
        setConversation(next);
        setMessages([]);
        return;
      }
      case 'system.health': {
        const status = `Voice ${voiceAvailable ? 'ready' : 'not installed'}, SQLite ready, persona ${persona.label}, ${memories.length} memories, ${reminders.length} reminders.`;
        speakAga(status);
        return;
      }
      case 'system.help': {
        return;
      }
      case 'persona.set': {
        const nextPrefs = await updatePreferences({ activePersona: action.persona as any });
        setPrefs(nextPrefs);
        return;
      }
      case 'translate.start': {
        const nextPrefs = await updatePreferences({ translateTargetLang: action.to });
        setPrefs(nextPrefs);
        sendMachine({ type: 'translate_start' });
        return;
      }
      case 'translate.stop': {
        const nextPrefs = await updatePreferences({ translateTargetLang: null });
        setPrefs(nextPrefs);
        sendMachine({ type: 'translate_stop' });
        return;
      }
      case 'youtube.play': {
        sendMachine({ type: 'media_start' });
        const result = await measureAsync('media:youtube:search', () => searchYouTube(action.query), { query: action.query });
        if (result.videoId) {
          setPlayerHtml(youtubeEmbedHtml(result.videoId));
        }
        const session = {
          kind: 'youtube' as const,
          title: result.title,
          subtitle: 'YouTube',
          artworkUrl: result.thumbnailUrl,
          ref: result.videoId || result.url,
          query: action.query,
          state: 'playing' as const,
        };
        setNowPlaying(session);
        await saveMediaSession({ kind: 'youtube', title: result.title, query: action.query, ref: result.videoId || result.url, artworkUrl: result.thumbnailUrl, state: 'playing' });
        await refreshLog();
        return;
      }
      case 'music.play': {
        sendMachine({ type: 'media_start' });
        const track = await measureAsync('media:music:search', () => searchMusic(action.query), { query: action.query });
        if (!track) {
          speakAga(`I could not find a playable preview for ${action.query}.`);
          return;
        }
        setPlayerHtml(audioPreviewHtml(track.previewUrl));
        const session = {
          kind: 'music' as const,
          title: track.title,
          subtitle: track.artist,
          artworkUrl: track.artworkUrl,
          ref: track.id,
          query: action.query,
          state: 'playing' as const,
        };
        setNowPlaying(session);
        await saveMediaSession({ kind: 'music', title: track.title, artist: track.artist, query: action.query, ref: track.id, artworkUrl: track.artworkUrl, state: 'playing' });
        await refreshLog();
        return;
      }
      case 'youtube.control':
      case 'music.control': {
        const command = action.command === 'resume' ? 'resume' : action.command === 'pause' ? 'pause' : action.command === 'volume' ? 'volume' : 'stop';
        postPlayer(command, action.value);
        if (command === 'stop') {
          setNowPlaying((item) => ({ ...item, state: 'stopped' }));
          await updateLatestMediaState(action.type === 'youtube.control' ? 'youtube' : 'music', 'stopped');
          sendMachine({ type: 'media_stop' });
        } else if (command === 'pause') {
          setNowPlaying((item) => ({ ...item, state: 'paused' }));
          await updateLatestMediaState(action.type === 'youtube.control' ? 'youtube' : 'music', 'paused');
        } else if (command === 'resume') {
          setNowPlaying((item) => ({ ...item, state: 'playing' }));
          await updateLatestMediaState(action.type === 'youtube.control' ? 'youtube' : 'music', 'playing');
          sendMachine({ type: 'media_start' });
        }
        return;
      }
      case 'agent.spawn': {
        sendMachine({ type: 'agent_start' });
        speakAga('I can spawn agents after the local agent runtime is added. I saved the goal for now.');
        await logEvent('agent', 'queued', { goal: action.goal });
        return;
      }
    }
  }, [memories.length, nowPlaying, persona.label, postPlayer, refreshLocalContext, refreshLog, reminders.length, sendMachine, speakAga, voiceAvailable]);

  const handleCommand = useCallback(async (rawText: string) => {
    const text = rawText.trim();
    if (!text || !conversation || !prefs || processingRef.current) return;

    processingRef.current = true;
    setError(null);
    setInterim('');
    sendMachine({ type: 'speech_end', text });

    try {
      await stopSpeaking();
      const userMessage = await saveMessage(conversation.id, 'user', text);
      const history = [...messages, userMessage];
      setMessages(history);

      let speechText: string;
      let actions: AgaAction[] = [];

      if (prefs.translateTargetLang) {
        const translated = prefs.geminiApiKey
          ? await measureAsync('translate:gemini-direct', () => translateWithGemini({
              apiKey: prefs.geminiApiKey!,
              model: prefs.geminiModel,
              text,
              to: prefs.translateTargetLang!,
            }))
          : text;
        speechText = translated;
      } else {
        const turn = await measureAsync('assistant:turn', () => createAgaTurn({
          text,
          history,
          persona,
          translateTarget: prefs.translateTargetLang,
        }));
        speechText = turn.speech;
        actions = turn.actions;
      }

      const assistantMessage = await saveMessage(conversation.id, 'assistant', speechText);
      setMessages((current) => [...current.filter((item) => item.id !== assistantMessage.id), assistantMessage]);

      let actionSpoke = false;
      for (const action of actions) {
        if (actionProducesOwnSpeech(action)) actionSpoke = true;
        await applyAction(action);
      }

      if (!actionSpoke) speakAga(speechText);
      await Promise.all([refreshMessages(conversation.id), refreshLocalContext()]);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'I hit a local glitch.';
      setError(message);
      sendMachine({ type: 'recover' });
      speakAga(`I hit a glitch: ${message}`);
      await logEvent('error', 'command_failed', { message, text });
      await refreshLog();
    } finally {
      processingRef.current = false;
    }
  }, [applyAction, conversation, messages, persona, prefs, refreshLocalContext, refreshLog, refreshMessages, sendMachine, speakAga]);

  const handleRecognizedText = useCallback((text: string) => {
    const wake = extractWakeCommand(text, [prefs?.wakePhrase ?? 'hey aga', 'okay aga', 'aga', 'angel']);
    const active = isActiveWindow(activeUntilRef.current);

    if (wake.woke) {
      activeUntilRef.current = extendActiveWindow();
      sendMachine({ type: 'wake', phrase: wake.phrase ?? undefined });
      if (wake.command.length > 1) {
        void handleCommand(wake.command);
      } else {
        speakAga('Yes, I am listening.');
        sendMachine({ type: 'listen' });
      }
      return;
    }

    if (active) {
      activeUntilRef.current = extendActiveWindow();
      void handleCommand(text);
    }
  }, [handleCommand, prefs?.wakePhrase, sendMachine, speakAga]);

  useEffect(() => {
    if (!ready) return;
    const loop = new NativeSpeechLoop({
      onStart: () => sendMachine({ type: 'listen' }),
      onPartial: setInterim,
      onFinal: handleRecognizedText,
      onError: (message) => {
        setError(message);
        void logEvent('voice', 'speech_error', { message }).then(refreshLog);
      },
    });
    speechLoopRef.current = loop;
    void loop.start();
    return () => {
      void loop.destroy();
      speechLoopRef.current = null;
    };
  }, [handleRecognizedText, ready, refreshLog, sendMachine]);

  const devSubmit = useCallback(() => {
    const text = devText.trim();
    if (!text) return;
    setDevText('');
    activeUntilRef.current = extendActiveWindow();
    void handleCommand(text);
  }, [devText, handleCommand]);

  if (!ready) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loading}>
          <ActivityIndicator color="#67e8f9" />
          <Text style={styles.loadingText}>Starting AGA local APK…</Text>
          {error && <Text style={styles.error}>{error}</Text>}
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <View>
            <Text style={styles.kicker}>Single APK · local-first</Text>
            <Text style={styles.title}>AGA</Text>
            <Text style={styles.status}>{stateLabel(agaState)} · {persona.label}</Text>
          </View>
          <View style={[styles.voicePill, voiceAvailable ? styles.voiceReady : styles.voiceMissing]}>
            <Text style={styles.voicePillText}>{voiceAvailable ? 'Voice armed' : 'Install voice module'}</Text>
          </View>
        </View>

        <AgaAvatar state={agaState} persona={persona} />
        <StateRail state={agaState} />
        <NowPlaying item={nowPlaying} />
        <MemoryReminderPanel memories={memories} reminders={reminders} />

        {playerHtml && (
          <View style={styles.playerCard}>
            <WebView
              ref={webviewRef}
              source={{ html: playerHtml }}
              originWhitelist={['*']}
              allowsInlineMediaPlayback
              mediaPlaybackRequiresUserAction={false}
              javaScriptEnabled
              domStorageEnabled
              style={styles.player}
            />
          </View>
        )}

        <TranscriptStrip messages={messages} interim={interim} />

        {!!error && <Text style={styles.error}>Recovery note: {error}</Text>}

        <DebugPanel
          visible={debugVisible}
          state={agaState}
          prefs={prefs}
          voiceAvailable={voiceAvailable}
          nowPlaying={nowPlaying}
          events={recentLog}
        />

        <View style={styles.devBox}>
          <Text style={styles.devLabel}>Dev voice fallback</Text>
          <TextInput
            value={devText}
            onChangeText={setDevText}
            placeholder="Type a command while native STT is not installed"
            placeholderTextColor="rgba(231,238,255,0.42)"
            style={styles.input}
            returnKeyType="send"
            onSubmitEditing={devSubmit}
          />
          <Pressable style={styles.sendButton} onPress={devSubmit}>
            <Text style={styles.sendButtonText}>Send to AGA</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#080b1d' },
  content: { padding: 18, gap: 14, paddingBottom: 32 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  loadingText: { color: '#f8fbff', fontWeight: '800' },
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  kicker: { color: '#67e8f9', fontSize: 11, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 1.4 },
  title: { color: '#fff7ed', fontSize: 42, fontWeight: '900', letterSpacing: -1.4, marginTop: 2 },
  status: { color: '#cbd5e1', fontSize: 14, marginTop: 2 },
  voicePill: { paddingHorizontal: 12, paddingVertical: 9, borderRadius: 999, borderWidth: StyleSheet.hairlineWidth },
  voiceReady: { backgroundColor: 'rgba(103,232,249,0.16)', borderColor: '#67e8f9' },
  voiceMissing: { backgroundColor: 'rgba(251,113,133,0.14)', borderColor: '#fb7185' },
  voicePillText: { color: '#fff7ed', fontSize: 11, fontWeight: '900' },
  playerCard: { height: 210, borderRadius: 24, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.16)' },
  player: { flex: 1, backgroundColor: '#050817' },
  error: { color: '#fecdd3', fontSize: 13, lineHeight: 19 },
  devBox: { gap: 8, padding: 12, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.055)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.12)' },
  devLabel: { color: '#fef3c7', fontSize: 11, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 1.2 },
  input: { minHeight: 44, color: '#f8fbff', paddingHorizontal: 12, borderRadius: 14, backgroundColor: 'rgba(15,23,42,0.75)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.14)' },
  sendButton: { alignItems: 'center', justifyContent: 'center', minHeight: 44, borderRadius: 14, backgroundColor: '#67e8f9' },
  sendButtonText: { color: '#06111c', fontWeight: '900' },
});
