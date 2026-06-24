import { render } from 'tradjs/client';
import * as THREE from 'three';

type Role = 'user' | 'assistant';
type VoiceStyle = 'warm' | 'bright' | 'calm' | 'coach' | 'story';
type AssistantMode =
  | 'idle'
  | 'wake-listening'
  | 'command-listening'
  | 'thinking'
  | 'speaking'
  | 'translate'
  | 'youtube'
  | 'music'
  | 'config'
  | 'recovery'
  | 'agent';

type ChatMessage = {
  id: string;
  role: Role;
  content: string;
  createdAt: string;
};

type Preferences = {
  assistantName: string;
  wakeWord: string;
  voiceStyle: VoiceStyle;
  voiceName?: string | null;
  autoListen: boolean;
  spokenReplies: boolean;
  translationTarget: string;
  translationSource: string;
  youtubeAutoplay: boolean;
  musicAutoplay: boolean;
  confirmRiskyActions?: boolean;
  agentMode?: 'off' | 'assistive' | 'on_demand';
  recoveryVoicePrompts?: boolean;
};

type Track = {
  id: string;
  title: string;
  artist: string;
  album?: string | null;
  previewUrl: string;
  artworkUrl?: string | null;
  storeUrl?: string | null;
};

type Video = {
  id: string;
  title: string;
  channel: string;
  thumbnailUrl?: string | null;
  url: string;
};

type TranslationLine = {
  id: string;
  original: string;
  translated: string;
  targetLanguage: string;
  provider: string;
};

type ServerIntent = {
  name: string;
  confidence: number;
  command: string;
  normalized: string;
  args: Record<string, unknown>;
  needsConfirmation: boolean;
  spokenSummary: string;
};

type ChatState = {
  conversationId: number | null;
  messages: ChatMessage[];
  transcript: string;
  passiveHeard: string;
  loading: boolean;
  listening: boolean;
  speaking: boolean;
  speechSupported: boolean;
  error: string | null;
  mode: AssistantMode;
  awakeUntil: number;
  translationActive: boolean;
  translationLines: TranslationLine[];
  preferences: Preferences;
  musicQueue: Track[];
  musicIndex: number;
  musicQuery: string;
  video: Video | null;
  youtubeQuery: string;
  youtubeConfigured: boolean;
  availableVoices: string[];
  watchdogCount: number;
  lastRecovery: string | null;
  agentStatus: string | null;
  diagnostics: string | null;
};

declare global {
  interface Window {
    SpeechRecognition?: any;
    webkitSpeechRecognition?: any;
    YT?: any;
    onYouTubeIframeAPIReady?: () => void;
  }
}

const defaultPreferences: Preferences = {
  assistantName: 'AGA',
  wakeWord: 'aga',
  voiceStyle: 'warm',
  voiceName: null,
  autoListen: true,
  spokenReplies: true,
  translationTarget: 'English',
  translationSource: 'auto',
  youtubeAutoplay: true,
  musicAutoplay: true,
  confirmRiskyActions: true,
  agentMode: 'on_demand',
  recoveryVoicePrompts: true,
};

const state: ChatState = {
  conversationId: null,
  messages: [
    {
      id: 'welcome',
      role: 'assistant',
      createdAt: new Date().toISOString(),
      content:
        'Hi, I’m AGA. Say “AGA” and then ask a question, play music, open a YouTube video, or start live translation.',
    },
  ],
  transcript: '',
  passiveHeard: '',
  loading: false,
  listening: false,
  speaking: false,
  speechSupported: false,
  error: null,
  mode: 'idle',
  awakeUntil: 0,
  translationActive: false,
  translationLines: [],
  preferences: { ...defaultPreferences },
  musicQueue: [],
  musicIndex: -1,
  musicQuery: '',
  video: null,
  youtubeQuery: '',
  youtubeConfigured: true,
  availableVoices: [],
  watchdogCount: 0,
  lastRecovery: null,
  agentStatus: null,
  diagnostics: null,
};

let root: HTMLElement | null = null;
let recognition: any = null;
let shouldKeepListening = true;
let recognitionStarting = false;
let lastHandledTranscript = '';
let lastSpoken = '';
let ttsVolume = 1;
let watchdogTimer = 0;
let audioPlayer: HTMLAudioElement | null = null;
let youtubeApiPromise: Promise<void> | null = null;
let youtubePlayer: any = null;
let pendingVideoId: string | null = null;

let stageHost: HTMLElement | null = null;
let stageRenderer: THREE.WebGLRenderer | null = null;
let stageScene: THREE.Scene | null = null;
let stageCamera: THREE.PerspectiveCamera | null = null;
let avatarGroup: THREE.Group | null = null;
let faceGroup: THREE.Group | null = null;
let orbitGroup: THREE.Group | null = null;
let eyeLeft: THREE.Mesh | null = null;
let eyeRight: THREE.Mesh | null = null;
let mouthMesh: THREE.Mesh | null = null;
let heartMesh: THREE.Mesh | null = null;
let haloMesh: THREE.Mesh | null = null;
let resizeObserver: ResizeObserver | null = null;
let animationFrame = 0;
let clock: THREE.Clock | null = null;

const commandHints = [
  '“AGA, play calm music”',
  '“AGA, open YouTube lofi study”',
  '“AGA, translate to Indonesian”',
  '“AGA, health check”',
  '“AGA, run an agent to plan this”',
];

function createMessage(role: Role, content: string): ChatMessage {
  return {
    id: `${role}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    role,
    content,
    createdAt: new Date().toISOString(),
  };
}

function createLine(original: string, translated: string, targetLanguage: string, provider: string): TranslationLine {
  return {
    id: `translation-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    original,
    translated,
    targetLanguage,
    provider,
  };
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(
    new Date(value)
  );
}

function normalize(text: string) {
  return text
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9\s]+/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanCommand(text: string) {
  return text.replace(/^[,\s:;.!-]+/, '').replace(/\s+/g, ' ').trim();
}

function getRecognitionCtor() {
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

function getAudioPlayer() {
  if (!audioPlayer) {
    audioPlayer = new Audio();
    audioPlayer.preload = 'auto';
    audioPlayer.autoplay = false;
    audioPlayer.onplay = () => {
      state.mode = 'music';
      update();
    };
    audioPlayer.onpause = () => update();
    audioPlayer.onended = () => playNextTrack();
  }

  return audioPlayer;
}

function logVoiceEvent(kind: string, payload: unknown = {}) {
  void fetch('/api/voice/event', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind, payload }),
  }).catch(() => undefined);
}

async function loadPreferences() {
  try {
    const response = await fetch('/api/preferences');
    const data = await response.json();
    if (response.ok && data?.preferences) {
      state.preferences = { ...defaultPreferences, ...data.preferences };
      shouldKeepListening = state.preferences.autoListen;
    }
  } catch {
    state.preferences = { ...defaultPreferences };
  }

  updateVoiceList();
  update();
}

async function patchPreferences(partial: Partial<Preferences>) {
  state.preferences = { ...state.preferences, ...partial };
  shouldKeepListening = state.preferences.autoListen;
  update();

  try {
    const response = await fetch('/api/preferences', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(partial),
    });
    const data = await response.json();
    if (response.ok && data?.preferences) state.preferences = { ...defaultPreferences, ...data.preferences };
  } catch {
    // Keep local preferences if the server is briefly unavailable.
  }

  update();
}

async function patchRuntimeState(partial: Record<string, unknown>) {
  try {
    await fetch('/api/runtime/state', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ state: partial }),
    });
  } catch {
    // Runtime persistence should never interrupt voice control.
  }
}

async function classifyOnServer(command: string): Promise<ServerIntent | null> {
  try {
    const response = await fetch('/api/assistant/intent', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command }),
    });
    const data = await response.json();
    return response.ok && data?.intent ? data.intent : null;
  } catch {
    return null;
  }
}

function lastAssistantText() {
  return [...state.messages].reverse().find((message) => message.role === 'assistant')?.content ?? '';
}

function setRecovery(reason: string) {
  state.mode = 'recovery';
  state.lastRecovery = reason;
  state.watchdogCount += 1;
  logVoiceEvent('recovery', { reason, count: state.watchdogCount });
  void patchRuntimeState({ mode: 'recovery', lastRecovery: reason });
  update();
}

function restartVoiceLoop(reason = 'manual restart') {
  setRecovery(reason);
  shouldKeepListening = true;
  try {
    recognition?.abort?.();
  } catch {
    try {
      recognition?.stop?.();
    } catch {
      // ignored
    }
  }
  recognitionStarting = false;
  window.setTimeout(() => startListening(), 500);
}

function handleRecoveryCommand(command: string) {
  const normalizedCommand = normalize(command);

  if (/\b(cancel|never mind|abort)\b/.test(normalizedCommand)) {
    state.loading = false;
    state.translationActive = false;
    window.speechSynthesis?.cancel?.();
    state.mode = 'idle';
    state.messages.push(createMessage('assistant', 'Cancelled. I am back in listening mode.'));
    speak('Cancelled. I am back in listening mode.', { force: true });
    update();
    return true;
  }

  if (/\b(repeat|say that again)\b/.test(normalizedCommand)) {
    const text = lastAssistantText() || 'I do not have anything to repeat yet.';
    speak(text, { force: true });
    return true;
  }

  if (/\b(louder|volume up|speak up)\b/.test(normalizedCommand)) {
    ttsVolume = Math.min(1, ttsVolume + 0.15);
    speak('I will speak louder.', { force: true });
    return true;
  }

  if (/\b(quieter|volume down|speak softer)\b/.test(normalizedCommand)) {
    ttsVolume = Math.max(0.25, ttsVolume - 0.15);
    speak('I will speak softer.', { force: true });
    return true;
  }

  if (/\b(restart listening|reset microphone|listen again)\b/.test(normalizedCommand)) {
    restartVoiceLoop('voice command restart');
    speak('Restarting listening.', { force: true });
    return true;
  }

  return false;
}

async function runHealthCheck() {
  state.loading = true;
  state.mode = 'thinking';
  update();

  try {
    const response = await fetch('/api/health');
    const data = await response.json();
    if (!response.ok) throw new Error(data?.error ?? 'Health check failed.');

    const missing = Object.entries(data.env ?? {})
      .filter(([key, value]) => ['openai', 'gemini', 'youtube'].includes(key) && !value)
      .map(([key]) => key);

    const reply = missing.length
      ? `Diagnostics complete. Core app is running, but ${missing.join(', ')} is not configured yet.`
      : 'Diagnostics complete. OpenAI, Gemini, YouTube, and SQLite checks look configured.';

    state.diagnostics = reply;
    state.messages.push(createMessage('assistant', reply));
    speak(reply, { force: true });
  } catch (error) {
    const reply = `Diagnostics failed: ${error instanceof Error ? error.message : 'unknown error'}.`;
    state.error = reply;
    state.messages.push(createMessage('assistant', reply));
    speak(reply, { force: true });
  } finally {
    state.loading = false;
    state.mode = state.translationActive ? 'translate' : 'idle';
    update();
  }
}

async function runAgent(command: string) {
  state.loading = true;
  state.mode = 'agent';
  state.agentStatus = 'Running an on-demand agent task';
  state.messages.push(createMessage('user', command));
  update();

  try {
    const context = state.messages.slice(-8).map((message) => `${message.role}: ${message.content}`);
    const response = await fetch('/api/agents/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ goal: command, context }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data?.error ?? 'Agent failed.');

    const reply = data.result || 'Agent task completed.';
    state.agentStatus = `${data.provider ?? 'agent'} completed`;
    state.messages.push(createMessage('assistant', reply));
    speak(reply);
  } catch (error) {
    const reply = `I could not run the agent task: ${error instanceof Error ? error.message : 'unknown error'}.`;
    state.agentStatus = 'Agent failed';
    state.error = reply;
    state.messages.push(createMessage('assistant', reply));
    speak(reply, { force: true });
  } finally {
    state.loading = false;
    state.mode = state.translationActive ? 'translate' : 'idle';
    update();
  }
}

function updateVoiceList() {
  if (!('speechSynthesis' in window)) return;
  state.availableVoices = window.speechSynthesis.getVoices().map((voice) => voice.name).slice(0, 12);
}

function chooseVoice() {
  if (!('speechSynthesis' in window)) return null;

  const voices = window.speechSynthesis.getVoices();
  const preferred = state.preferences.voiceName?.toLowerCase();
  if (preferred) {
    const exact = voices.find((voice) => voice.name.toLowerCase() === preferred);
    if (exact) return exact;
  }

  const style = state.preferences.voiceStyle;
  const preferredTerms =
    style === 'calm'
      ? ['samantha', 'serena', 'female', 'google uk english female']
      : style === 'bright'
        ? ['zira', 'susan', 'female', 'google us english']
        : ['female', 'samantha', 'zira', 'serena', 'google'];

  return (
    voices.find((voice) => preferredTerms.some((term) => voice.name.toLowerCase().includes(term))) ??
    voices.find((voice) => /^en[-_]/i.test(voice.lang)) ??
    voices[0] ??
    null
  );
}

function styleSpeech(utterance: SpeechSynthesisUtterance) {
  switch (state.preferences.voiceStyle) {
    case 'bright':
      utterance.rate = 1.08;
      utterance.pitch = 1.18;
      break;
    case 'calm':
      utterance.rate = 0.9;
      utterance.pitch = 0.96;
      break;
    case 'coach':
      utterance.rate = 1;
      utterance.pitch = 1.02;
      break;
    case 'story':
      utterance.rate = 0.98;
      utterance.pitch = 1.12;
      break;
    default:
      utterance.rate = 0.98;
      utterance.pitch = 1.08;
  }
}

function speak(text: string, options: { interrupt?: boolean; force?: boolean } = {}) {
  if (!state.preferences.spokenReplies && !options.force) return;
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;

  const spokenText = text.replace(/https?:\/\/\S+/g, '').trim();
  if (!spokenText) return;

  if (options.interrupt !== false) window.speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(spokenText);
  utterance.volume = ttsVolume;
  const voice = chooseVoice();
  if (voice) utterance.voice = voice;
  styleSpeech(utterance);

  utterance.onstart = () => {
    lastSpoken = normalize(spokenText);
    state.speaking = true;
    state.mode = state.translationActive ? 'translate' : 'speaking';
    update();
  };

  utterance.onend = () => {
    state.speaking = false;
    state.mode = state.translationActive ? 'translate' : 'idle';
    update();
  };

  utterance.onerror = () => {
    state.speaking = false;
    update();
  };

  window.speechSynthesis.speak(utterance);
}

function ensureRecognition() {
  if (recognition) return recognition;

  const RecognitionCtor = getRecognitionCtor();
  if (!RecognitionCtor) return null;

  recognition = new RecognitionCtor();
  recognition.lang = 'en-US';
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;

  recognition.onstart = () => {
    recognitionStarting = false;
    state.listening = true;
    state.error = null;
    if (state.mode === 'idle') state.mode = Date.now() < state.awakeUntil ? 'command-listening' : 'wake-listening';
    update();
  };

  recognition.onresult = (event: any) => {
    let interim = '';
    let finalText = '';

    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const phrase = event.results[index][0]?.transcript ?? '';
      if (event.results[index].isFinal) finalText += ` ${phrase}`;
      else interim += ` ${phrase}`;
    }

    state.transcript = interim.trim();
    update();

    const cleanFinal = finalText.trim();
    if (cleanFinal) void handleFinalTranscript(cleanFinal);
  };

  recognition.onerror = (event: any) => {
    recognitionStarting = false;
    state.listening = false;
    state.error =
      event?.error === 'not-allowed'
        ? 'Microphone permission was blocked. AGA needs microphone access to work hands-free.'
        : `Voice capture issue: ${event?.error ?? 'unknown'}.`;
    update();
  };

  recognition.onend = () => {
    recognitionStarting = false;
    state.listening = false;
    update();

    if (shouldKeepListening) {
      window.setTimeout(() => startListening(), 450);
    }
  };

  return recognition;
}

function startListening() {
  const activeRecognition = ensureRecognition();
  if (!activeRecognition) {
    state.speechSupported = false;
    state.error = 'This WebView/browser does not expose Speech Recognition. Open AGA in Chrome or add native speech capture in Expo.';
    update();
    return;
  }

  if (state.listening || recognitionStarting) return;

  try {
    recognitionStarting = true;
    activeRecognition.start();
  } catch {
    recognitionStarting = false;
  }
}

function stopListening() {
  shouldKeepListening = false;
  recognitionStarting = false;
  try {
    recognition?.stop?.();
  } catch {
    // ignored
  }
  state.listening = false;
  update();
}

function toggleListening() {
  if (state.listening || recognitionStarting) {
    stopListening();
    void patchPreferences({ autoListen: false });
  } else {
    shouldKeepListening = true;
    void patchPreferences({ autoListen: true });
    startListening();
  }
}

function wakePattern() {
  const wake = normalize(state.preferences.wakeWord || 'aga').replace(/\s+/g, '\\s*');
  return new RegExp(`(?:^|\\b)(?:hey\\s+|okay\\s+|ok\\s+)?(?:${wake}|a\\s*ga|agar)(?:\\b|$)`, 'i');
}

function commandAfterWake(text: string) {
  const normalizedText = normalize(text);
  const pattern = wakePattern();
  const match = normalizedText.match(pattern);
  if (!match) return null;
  const index = match.index ?? 0;
  const after = normalizedText.slice(index + match[0].length);
  return cleanCommand(after || normalizedText.replace(pattern, ''));
}

function isEcho(text: string) {
  const normalizedText = normalize(text);
  if (!normalizedText || normalizedText.length < 4) return true;
  if (normalizedText === lastHandledTranscript) return true;
  if (state.speaking && lastSpoken && normalizedText.includes(lastSpoken.slice(0, 80))) return true;
  return false;
}

async function handleFinalTranscript(text: string) {
  const normalizedText = normalize(text);
  if (isEcho(text)) return;

  lastHandledTranscript = normalizedText;
  state.passiveHeard = text;
  logVoiceEvent('voice.final', { text, mode: state.mode, translationActive: state.translationActive });

  if (state.translationActive && !/\b(stop|end|cancel)\s+(translation|translate|interpreter)\b/i.test(normalizedText)) {
    await translateSegment(text);
    return;
  }

  const commandFromWake = commandAfterWake(text);
  const stillAwake = Date.now() < state.awakeUntil;

  if (commandFromWake === null && !stillAwake) {
    update();
    return;
  }

  const command = cleanCommand(commandFromWake ?? text);
  state.awakeUntil = Date.now() + 30_000;

  if (!command) {
    speak('I’m listening.', { force: true });
    update();
    return;
  }

  await runCommand(command);
}

function commandIncludes(command: string, words: string[]) {
  const normalizedCommand = normalize(command);
  return words.some((word) => normalizedCommand.includes(word));
}

function extractAfter(command: string, markers: string[]) {
  const normalizedCommand = normalize(command);
  for (const marker of markers) {
    const index = normalizedCommand.indexOf(marker);
    if (index >= 0) return cleanCommand(command.slice(index + marker.length));
  }
  return cleanCommand(command);
}

function parseLanguage(command: string) {
  const match = normalize(command).match(/(?:translate|translation|interpreter|interpret)(?:\s+everything)?\s+(?:to|into|in)\s+([a-z\s]{2,40})/);
  return match?.[1]?.replace(/\bmode\b/g, '').trim();
}

async function runCommand(command: string) {
  const normalizedCommand = normalize(command);
  state.transcript = command;
  state.error = null;
  update();

  if (handleRecoveryCommand(command)) return;

  const serverIntent = await classifyOnServer(command);
  logVoiceEvent('command.received', { command, intent: serverIntent?.name, confidence: serverIntent?.confidence });

  if (serverIntent?.name === 'health_check') {
    await runHealthCheck();
    return;
  }

  if (serverIntent?.name === 'agent_task') {
    if (state.preferences.agentMode === 'off') {
      const reply = 'Agent mode is off. Say AGA, change personality, or enable agents in preferences when you want that back.';
      state.messages.push(createMessage('assistant', reply));
      speak(reply, { force: true });
      return;
    }
    await runAgent(String(serverIntent.args?.goal ?? command));
    return;
  }

  if (serverIntent?.name === 'stop_translation' || /\b(stop|end|cancel)\s+(translation|translate|interpreter)\b/.test(normalizedCommand)) {
    state.translationActive = false;
    state.mode = 'idle';
    void patchRuntimeState({ mode: 'idle', lastTranslationTarget: state.preferences.translationTarget });
    state.messages.push(createMessage('assistant', 'Translation mode is off.'));
    speak('Translation mode is off.');
    update();
    return;
  }

  const intentLanguage = serverIntent?.name === 'start_translation' ? String(serverIntent.args?.targetLanguage ?? '') : '';
  const language = intentLanguage || parseLanguage(command);
  if (language) {
    state.translationActive = true;
    state.mode = 'translate';
    await patchPreferences({ translationTarget: language });
    void patchRuntimeState({ mode: 'translate', lastTranslationTarget: language });
    const reply = `Live translation is on. I’ll translate incoming speech to ${language}. Say “AGA, stop translation” to end it.`;
    state.messages.push(createMessage('assistant', reply));
    speak(reply);
    update();
    return;
  }

  if (serverIntent?.name === 'stop_listening' || /\b(stop listening|sleep|go quiet|microphone off)\b/.test(normalizedCommand)) {
    stopListening();
    await patchPreferences({ autoListen: false });
    speak('I’ll stop listening now. Use the microphone button once to wake me again.', { force: true });
    return;
  }

  if (serverIntent?.name === 'start_listening' || /\b(start listening|keep listening|wake up|microphone on)\b/.test(normalizedCommand)) {
    shouldKeepListening = true;
    await patchPreferences({ autoListen: true });
    startListening();
    speak('I’m listening continuously again.', { force: true });
    return;
  }

  if (serverIntent?.name === 'media_control' || /\b(pause|resume|continue|stop|next|previous|volume|mute|unmute)\b/.test(normalizedCommand)) {
    const handled = controlMedia(normalizedCommand, Number(serverIntent?.args?.volume ?? Number.NaN));
    if (handled) return;
  }

  if (serverIntent?.name === 'youtube_search' || (/\b(open|watch|youtube|video)\b/.test(normalizedCommand) && !/\bmusic\b/.test(normalizedCommand))) {
    const queryFromIntent = typeof serverIntent?.args?.query === 'string' ? serverIntent.args.query : '';
    const query = queryFromIntent || extractAfter(command, ['open youtube', 'youtube', 'watch', 'play video', 'open video', 'video']);
    await playYouTube(query || command);
    return;
  }

  if (serverIntent?.name === 'play_music' || (/\b(play|start|open)\b/.test(normalizedCommand) && /\b(music|song|track|playlist|audio)\b/.test(normalizedCommand))) {
    const queryFromIntent = typeof serverIntent?.args?.query === 'string' ? serverIntent.args.query : '';
    const query = queryFromIntent || extractAfter(command, ['play music', 'play song', 'play track', 'music', 'song', 'track', 'playlist']);
    await playMusic(query || 'relaxing music');
    return;
  }

  if (serverIntent?.name === 'configure_voice' || (/\b(change|set|switch)\b/.test(normalizedCommand) && /\b(style|voice|personality)\b/.test(normalizedCommand))) {
    await configureVoice(command);
    return;
  }

  if (serverIntent?.name === 'configure_wake_word' || /\bwake word\b/.test(normalizedCommand)) {
    const fromIntent = typeof serverIntent?.args?.wakeWord === 'string' ? serverIntent.args.wakeWord : '';
    const match = command.match(/wake word\s+(?:to|is|as)\s+(.+)$/i);
    const wakeWord = cleanCommand(fromIntent || match?.[1] || 'aga').split(' ').slice(0, 3).join(' ');
    await patchPreferences({ wakeWord: wakeWord || 'aga' });
    const reply = `Done. My wake word is now ${wakeWord || 'AGA'}.`;
    state.messages.push(createMessage('assistant', reply));
    speak(reply);
    return;
  }

  if (serverIntent?.name === 'configure_name' || /\b(call yourself|your name|rename yourself)\b/.test(normalizedCommand)) {
    const fromIntent = typeof serverIntent?.args?.assistantName === 'string' ? serverIntent.args.assistantName : '';
    const match = command.match(/(?:call yourself|your name is|rename yourself)\s+(.+)$/i);
    const assistantName = cleanCommand(fromIntent || match?.[1] || 'AGA').split(' ')[0] || 'AGA';
    await patchPreferences({ assistantName });
    const reply = `Done. You can call me ${assistantName}.`;
    state.messages.push(createMessage('assistant', reply));
    speak(reply);
    return;
  }

  if (serverIntent?.name === 'help' || /\b(help|what can you do|commands|what can i say)\b/.test(normalizedCommand)) {
    const reply =
      'You can say: AGA, ask a question; AGA, play music; AGA, open YouTube; AGA, translate to Indonesian; AGA, pause; AGA, repeat; AGA, restart listening; AGA, health check; or AGA, run an agent task.';
    state.messages.push(createMessage('assistant', reply));
    speak(reply, { force: true });
    update();
    return;
  }

  if (serverIntent?.name === 'reset_conversation' || (/\b(clear|reset)\b/.test(normalizedCommand) && /\b(chat|conversation|screen)\b/.test(normalizedCommand))) {
    state.messages = [createMessage('assistant', 'Fresh conversation started. Say “AGA” whenever you need me.')];
    state.conversationId = null;
    speak('Fresh conversation started.');
    update();
    return;
  }

  await sendChatMessage(command);
}

async function configureVoice(command: string) {
  const normalizedCommand = normalize(command);
  let voiceStyle: VoiceStyle | null = null;

  if (normalizedCommand.includes('calm') || normalizedCommand.includes('soft')) voiceStyle = 'calm';
  if (normalizedCommand.includes('bright') || normalizedCommand.includes('happy')) voiceStyle = 'bright';
  if (normalizedCommand.includes('coach') || normalizedCommand.includes('direct')) voiceStyle = 'coach';
  if (normalizedCommand.includes('story') || normalizedCommand.includes('expressive')) voiceStyle = 'story';
  if (normalizedCommand.includes('warm') || normalizedCommand.includes('supportive')) voiceStyle = 'warm';

  const voices = 'speechSynthesis' in window ? window.speechSynthesis.getVoices() : [];
  const namedVoice = voices.find((voice) => normalizedCommand.includes(normalize(voice.name)));

  await patchPreferences({
    ...(voiceStyle ? { voiceStyle } : {}),
    ...(namedVoice ? { voiceName: namedVoice.name } : {}),
  });

  const reply = `Voice updated. Style is ${voiceStyle ?? state.preferences.voiceStyle}${namedVoice ? ` with ${namedVoice.name}` : ''}.`;
  state.mode = 'config';
  state.messages.push(createMessage('assistant', reply));
  speak(reply, { force: true });
}

function controlMedia(command: string, volumePercent = Number.NaN) {
  const audio = audioPlayer;

  if (command.includes('pause')) {
    youtubePlayer?.pauseVideo?.();
    audio?.pause();
    speak('Paused.');
    return true;
  }

  if (command.includes('resume') || command.includes('continue')) {
    if (state.video && youtubePlayer?.playVideo) youtubePlayer.playVideo();
    else if (audio) void audio.play().catch(() => undefined);
    speak('Resuming.');
    return true;
  }

  if (command.includes('stop')) {
    youtubePlayer?.stopVideo?.();
    audio?.pause();
    if (audio) audio.currentTime = 0;
    speak('Stopped.');
    return true;
  }

  if (command.includes('next')) {
    playNextTrack();
    return true;
  }

  if (command.includes('previous') || command.includes('back')) {
    playPreviousTrack();
    return true;
  }

  if (Number.isFinite(volumePercent)) {
    const nextVolume = Math.max(0, Math.min(1, volumePercent / 100));
    if (youtubePlayer?.setVolume) youtubePlayer.setVolume(Math.round(nextVolume * 100));
    if (audio) audio.volume = nextVolume;
    ttsVolume = Math.max(0.25, nextVolume);
    speak(`Volume set to ${Math.round(nextVolume * 100)} percent.`);
    return true;
  }

  if (command.includes('volume up')) {
    if (youtubePlayer?.setVolume && youtubePlayer?.getVolume) youtubePlayer.setVolume(Math.min(100, youtubePlayer.getVolume() + 15));
    if (audio) audio.volume = Math.min(1, audio.volume + 0.15);
    speak('Volume up.');
    return true;
  }

  if (command.includes('volume down')) {
    if (youtubePlayer?.setVolume && youtubePlayer?.getVolume) youtubePlayer.setVolume(Math.max(0, youtubePlayer.getVolume() - 15));
    if (audio) audio.volume = Math.max(0, audio.volume - 0.15);
    speak('Volume down.');
    return true;
  }

  if (command.includes('mute')) {
    youtubePlayer?.mute?.();
    if (audio) audio.muted = true;
    speak('Muted.');
    return true;
  }

  if (command.includes('unmute')) {
    youtubePlayer?.unMute?.();
    if (audio) audio.muted = false;
    speak('Unmuted.');
    return true;
  }

  return false;
}

async function sendChatMessage(text: string) {
  const cleanText = text.trim();
  if (!cleanText || state.loading) return;

  state.messages.push(createMessage('user', cleanText));
  state.transcript = '';
  state.loading = true;
  state.mode = 'thinking';
  state.error = null;
  update();

  try {
    const response = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        conversationId: state.conversationId,
        message: cleanText,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data?.error ?? 'AGA could not reply.');
    }

    state.conversationId = data.conversationId;
    state.messages.push(createMessage('assistant', data.reply));
    speak(data.reply);
  } catch (error) {
    state.error = error instanceof Error ? error.message : 'Something went wrong.';
    const fallback = `Sorry, I hit a glitch: ${state.error}`;
    state.messages.push(createMessage('assistant', fallback));
    speak(fallback);
  } finally {
    state.loading = false;
    state.mode = state.translationActive ? 'translate' : 'idle';
    update();
  }
}

async function translateSegment(text: string) {
  const cleanText = cleanCommand(text);
  if (!cleanText || state.loading) return;

  state.loading = true;
  state.mode = 'translate';
  update();

  try {
    const response = await fetch('/api/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: cleanText,
        targetLanguage: state.preferences.translationTarget,
        sourceLanguage: state.preferences.translationSource,
        style: 'natural',
      }),
    });
    const data = await response.json();

    if (!response.ok) throw new Error(data?.error ?? 'Translation failed.');

    state.translationLines.push(
      createLine(cleanText, data.translated, data.targetLanguage, data.provider ?? 'unknown')
    );
    state.translationLines = state.translationLines.slice(-6);
    speak(data.translated, { interrupt: false, force: true });
  } catch (error) {
    state.error = error instanceof Error ? error.message : 'Translation failed.';
    speak('Translation failed. I will keep listening.');
  } finally {
    state.loading = false;
    state.mode = 'translate';
    update();
  }
}

async function playMusic(query: string) {
  state.mode = 'music';
  state.loading = true;
  state.musicQuery = query;
  state.error = null;
  update();

  try {
    const response = await fetch('/api/music', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, limit: 8 }),
    });
    const data = await response.json();

    if (!response.ok) throw new Error(data?.error ?? 'Music search failed.');

    state.musicQueue = data.tracks ?? [];
    state.musicIndex = state.musicQueue.length ? 0 : -1;

    if (!state.musicQueue.length) {
      const reply = `I could not find a playable preview for ${query}.`;
      state.messages.push(createMessage('assistant', reply));
      speak(reply);
      return;
    }

    await playCurrentTrack();
  } catch (error) {
    state.error = error instanceof Error ? error.message : 'Music failed.';
    speak(`I could not play music: ${state.error}`);
  } finally {
    state.loading = false;
    update();
  }
}

async function playCurrentTrack() {
  const track = state.musicQueue[state.musicIndex];
  if (!track) return;

  const audio = getAudioPlayer();
  audio.src = track.previewUrl;
  audio.currentTime = 0;

  const reply = `Playing ${track.title} by ${track.artist}.`;
  state.messages.push(createMessage('assistant', reply));
  update();

  if (state.preferences.musicAutoplay) {
    try {
      await audio.play();
    } catch {
      state.error = 'Autoplay was blocked. Say AGA, resume after the first user interaction.';
    }
  }

  speak(reply);
}

function playNextTrack() {
  if (!state.musicQueue.length) {
    speak('There is no music queue yet.');
    return;
  }
  state.musicIndex = (state.musicIndex + 1) % state.musicQueue.length;
  void playCurrentTrack();
}

function playPreviousTrack() {
  if (!state.musicQueue.length) {
    speak('There is no music queue yet.');
    return;
  }
  state.musicIndex = (state.musicIndex - 1 + state.musicQueue.length) % state.musicQueue.length;
  void playCurrentTrack();
}

async function loadYouTubeApi() {
  if (window.YT?.Player) return;

  if (!youtubeApiPromise) {
    youtubeApiPromise = new Promise<void>((resolve) => {
      window.onYouTubeIframeAPIReady = () => resolve();
      const tag = document.createElement('script');
      tag.src = 'https://www.youtube.com/iframe_api';
      tag.async = true;
      document.head.appendChild(tag);
    });
  }

  await youtubeApiPromise;
}

async function syncYouTubePlayer() {
  const videoId = state.video?.id ?? pendingVideoId;
  const host = document.getElementById('youtube-player');
  if (!host || !videoId) return;

  await loadYouTubeApi();

  if (youtubePlayer?.loadVideoById) {
    if (pendingVideoId) {
      youtubePlayer.loadVideoById(videoId);
      pendingVideoId = null;
    }
    return;
  }

  youtubePlayer = new window.YT.Player('youtube-player', {
    videoId,
    playerVars: {
      autoplay: state.preferences.youtubeAutoplay ? 1 : 0,
      controls: 1,
      playsinline: 1,
      rel: 0,
      modestbranding: 1,
    },
    events: {
      onReady: (event: any) => {
        pendingVideoId = null;
        if (state.preferences.youtubeAutoplay) event.target.playVideo();
      },
      onStateChange: () => update(),
    },
  });
}

async function playYouTube(query: string) {
  state.mode = 'youtube';
  state.loading = true;
  state.youtubeQuery = query;
  state.error = null;
  update();

  try {
    const response = await fetch('/api/youtube', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, limit: 4 }),
    });
    const data = await response.json();

    if (!response.ok) throw new Error(data?.error ?? 'YouTube search failed.');

    state.youtubeConfigured = Boolean(data.configured);
    const firstVideo = data.videos?.[0] as Video | undefined;

    if (!firstVideo) {
      const reply = data.error ?? 'YouTube search is not configured yet. Add YOUTUBE_API_KEY to let AGA choose and control videos by voice.';
      state.messages.push(createMessage('assistant', reply));
      speak(reply);
      return;
    }

    state.video = firstVideo;
    pendingVideoId = firstVideo.id;
    state.messages.push(createMessage('assistant', `Opening ${firstVideo.title} from ${firstVideo.channel}.`));
    update();
    await syncYouTubePlayer();
    speak(`Opening ${firstVideo.title}.`);
  } catch (error) {
    state.error = error instanceof Error ? error.message : 'YouTube failed.';
    speak(`I could not open YouTube: ${state.error}`);
  } finally {
    state.loading = false;
    update();
  }
}

function statusLabel() {
  if (state.mode === 'recovery') return 'Recovering';
  if (state.mode === 'agent') return 'Agent';
  if (state.translationActive) return 'Translating';
  if (state.loading) return 'Thinking';
  if (state.speaking) return 'Speaking';
  if (state.listening) return Date.now() < state.awakeUntil ? 'Awake' : 'Wake listening';
  return 'Sleeping';
}

function scrollMessagesToBottom() {
  const list = document.querySelector('.message-strip');
  if (list) list.scrollTop = list.scrollHeight;
}

function update() {
  if (!root) return;
  render(<AssistantOverlay />, root);
  requestAnimationFrame(() => {
    scrollMessagesToBottom();
    initThreeStage();
    void syncYouTubePlayer();
  });
}

function MiniAvatar({ role }: { role: Role }) {
  return (
    <div class={`mini-avatar ${role === 'assistant' ? 'assistant-avatar' : 'user-avatar'}`} aria-hidden="true">
      <span>{role === 'assistant' ? state.preferences.assistantName.slice(0, 1).toUpperCase() : 'You'}</span>
    </div>
  );
}

function TypingBubble() {
  return (
    <div class="message-row assistant typing-row">
      <MiniAvatar role="assistant" />
      <div class="message-stack">
        <div class="bubble typing-bubble" aria-label="AGA is thinking">
          <span class="typing-dot" />
          <span class="typing-dot" />
          <span class="typing-dot" />
        </div>
        <span class="message-meta">AGA is working…</span>
      </div>
    </div>
  );
}

function MediaPanel() {
  const track = state.musicQueue[state.musicIndex];

  if (state.translationActive || state.translationLines.length) {
    const last = state.translationLines[state.translationLines.length - 1];
    return (
      <div class="media-panel translate-panel">
        <div class="media-copy">
          <span class="panel-label">Live translation</span>
          <strong>Target: {state.preferences.translationTarget}</strong>
          <p>{last ? last.translated : 'Listening for speech to translate while voice output continues.'}</p>
        </div>
        <div class="translation-log">
          {state.translationLines.slice(-3).map((line) => (
            <div class="translation-line" key={line.id}>
              <span>{line.original}</span>
              <strong>{line.translated}</strong>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (state.mode === 'youtube' || state.video || !state.youtubeConfigured) {
    return (
      <div class="media-panel youtube-panel">
        <div class="media-copy">
          <span class="panel-label">YouTube</span>
          <strong>{state.video?.title ?? 'Voice-controlled video player'}</strong>
          <p>{state.video ? state.video.channel : 'Set YOUTUBE_API_KEY for reliable top-result playback and IFrame controls.'}</p>
        </div>
        <div class="youtube-frame-shell">
          {state.video ? <div id="youtube-player" /> : <div class="empty-player">Waiting for a configured video search…</div>}
        </div>
      </div>
    );
  }

  if (state.mode === 'music' || track) {
    return (
      <div class="media-panel music-panel">
        <div class="album-art">
          {track?.artworkUrl ? <img src={track.artworkUrl} alt="Album artwork" /> : <span>♪</span>}
        </div>
        <div class="media-copy">
          <span class="panel-label">Music previews</span>
          <strong>{track ? track.title : 'No track selected'}</strong>
          <p>{track ? `${track.artist}${track.album ? ` · ${track.album}` : ''}` : 'Say “AGA, play music ...”'}</p>
        </div>
        <div class="media-commands">pause · resume · next · volume up</div>
      </div>
    );
  }

  return (
    <div class="media-panel ready-panel">
      <div class="media-copy">
        <span class="panel-label">Voice-first reliability</span>
        <strong>Say “{state.preferences.wakeWord.toUpperCase()}” before commands</strong>
        <p>{state.agentStatus || state.diagnostics || state.lastRecovery || 'After the wake word, AGA stays awake briefly so follow-up questions feel natural.'}</p>
      </div>
      <div class="media-commands">ask · YouTube · music · translate · agent · health check</div>
    </div>
  );
}

function AssistantOverlay() {
  const visibleMessages = state.messages.slice(-5);
  const awake = Date.now() < state.awakeUntil;

  return (
    <section class="dock" aria-label="AGA voice chat dock">
      <div class="dock-header">
        <div>
          <p class="dock-kicker">Voice-only assistant</p>
          <h2>{state.preferences.assistantName} is {statusLabel().toLowerCase()}</h2>
          <p class="dock-copy">
Always-listening wake word, recovery commands, voice media controls, SQLite memory, health checks, on-demand agents, and translation mode.
          </p>
        </div>
        <div class={`status-badge ${state.listening ? 'is-live' : ''} ${awake ? 'is-awake' : ''}`}>
          <span class="status-badge-dot" />
          <span>{statusLabel()}</span>
        </div>
      </div>

      <MediaPanel />

      <div class="message-strip" aria-live="polite">
        {visibleMessages.map((message) => (
          <div class={`message-row ${message.role}`} key={message.id}>
            <MiniAvatar role={message.role} />
            <div class="message-stack">
              <div class="bubble">{message.content}</div>
              <span class="message-meta">
                {message.role === 'assistant' ? state.preferences.assistantName : 'You'} · {formatTime(message.createdAt)}
              </span>
            </div>
          </div>
        ))}
        {state.loading && <TypingBubble />}
      </div>

      {state.error && <p class="error-note">{state.error}</p>}

      <div class="voice-bar">
        <button
          type="button"
          class={`mic-button ${state.listening ? 'listening' : ''}`}
          aria-label={state.listening ? 'Stop listening' : 'Start listening'}
          onClick={toggleListening}
        >
          <span class="mic-ripple ripple-one" aria-hidden="true" />
          <span class="mic-ripple ripple-two" aria-hidden="true" />
          <span class="mic-icon" aria-hidden="true">🎙</span>
        </button>

        <div class="transcript-card">
          <span class="transcript-label">
            {state.translationActive
              ? `Translating to ${state.preferences.translationTarget}`
              : state.listening
                ? `Wake word: ${state.preferences.wakeWord.toUpperCase()}`
                : state.speechSupported
                  ? 'Tap once or say commands after listening starts'
                  : 'Speech recognition unavailable'}
          </span>
          <strong>
            {state.transcript ||
              state.passiveHeard ||
              (state.speechSupported
                ? 'Say “AGA, help” for commands.'
                : 'Use Chrome/WebView speech support or wire native Expo speech recognition.')}
          </strong>
          <div class="hint-row" aria-hidden="true">
            {commandHints.map((hint) => (
              <span key={hint}>{hint}</span>
            ))}
          </div>
        </div>

        <div class="config-card">
          <span>Style</span>
          <strong>{state.preferences.voiceStyle}</strong>
          <small>{state.preferences.spokenReplies ? 'spoken replies on' : 'spoken replies off'}</small>
        </div>
      </div>
    </section>
  );
}

function destroyStage() {
  cancelAnimationFrame(animationFrame);
  resizeObserver?.disconnect();
  resizeObserver = null;

  if (stageRenderer) {
    stageRenderer.dispose();
    const canvas = stageRenderer.domElement;
    canvas.remove();
  }

  stageRenderer = null;
  stageScene = null;
  stageCamera = null;
  avatarGroup = null;
  faceGroup = null;
  orbitGroup = null;
  eyeLeft = null;
  eyeRight = null;
  mouthMesh = null;
  heartMesh = null;
  haloMesh = null;
  clock = null;
}

function fitStage() {
  if (!stageHost || !stageRenderer || !stageCamera) return;

  const width = stageHost.clientWidth || 1;
  const height = stageHost.clientHeight || 1;

  stageCamera.aspect = width / height;
  stageCamera.updateProjectionMatrix();
  stageRenderer.setSize(width, height, false);
  stageRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
}

function animateStage() {
  if (!stageRenderer || !stageScene || !stageCamera || !avatarGroup || !clock) return;

  const t = clock.getElapsedTime();
  const active = state.listening || state.loading || state.speaking || state.translationActive;
  const talkWave = state.speaking || state.loading ? Math.abs(Math.sin(t * 12)) : 0;

  avatarGroup.rotation.y = Math.sin(t * 0.5) * 0.36;
  avatarGroup.rotation.z = Math.sin(t * 0.7) * 0.035;
  avatarGroup.position.y = Math.sin(t * 1.05) * 0.16;
  avatarGroup.scale.setScalar(active ? 1 + Math.sin(t * 4.8) * 0.014 : 1);

  if (faceGroup) {
    faceGroup.rotation.y = Math.sin(t * 0.9) * 0.055;
    faceGroup.position.y = 0.25 + Math.sin(t * 1.4) * 0.025;
  }

  const blink = Math.sin(t * 1.2) > 0.982 ? 0.12 : 1;
  if (eyeLeft) eyeLeft.scale.set(1, blink, 1);
  if (eyeRight) eyeRight.scale.set(1, blink, 1);

  if (mouthMesh) {
    mouthMesh.scale.x = state.speaking || state.loading ? 1 + talkWave * 1.25 : 1;
    mouthMesh.scale.y = state.speaking || state.loading ? 0.45 + talkWave * 1.9 : state.listening ? 0.34 : 0.2;
  }

  if (heartMesh) {
    const material = heartMesh.material as THREE.MeshStandardMaterial;
    material.emissiveIntensity = state.translationActive ? 1.6 + Math.sin(t * 7) * 0.35 : state.listening ? 1.35 : 0.85;
    heartMesh.scale.setScalar(1 + Math.sin(t * 3.2) * 0.055);
  }

  if (haloMesh) {
    haloMesh.rotation.z = t * 0.24;
    haloMesh.scale.setScalar(active ? 1.04 + Math.sin(t * 4.4) * 0.035 : 1 + Math.sin(t * 1.7) * 0.018);
  }

  if (orbitGroup) {
    orbitGroup.rotation.y = -t * (state.translationActive ? 1.1 : state.listening ? 0.85 : 0.46);
    orbitGroup.rotation.x = Math.sin(t * 0.62) * 0.2;
  }

  stageRenderer.render(stageScene, stageCamera);
  animationFrame = requestAnimationFrame(animateStage);
}

function initThreeStage() {
  const nextHost = document.getElementById('three-stage');
  if (!nextHost) return;

  if (stageHost === nextHost && stageRenderer) {
    fitStage();
    return;
  }

  destroyStage();
  stageHost = nextHost;
  stageHost.innerHTML = '';

  stageScene = new THREE.Scene();
  stageCamera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
  stageCamera.position.set(0, 0.38, 7.2);

  stageRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  stageRenderer.setClearAlpha(0);
  stageRenderer.outputColorSpace = THREE.SRGBColorSpace;
  stageHost.appendChild(stageRenderer.domElement);

  clock = new THREE.Clock();

  const ambientLight = new THREE.AmbientLight(0xffffff, 1.35);
  const keyLight = new THREE.DirectionalLight(0xe0f2fe, 2.55);
  keyLight.position.set(4, 5, 5);
  const faceLight = new THREE.PointLight(0xf9a8d4, 32, 18, 1.7);
  faceLight.position.set(-2.8, 0.6, 4.2);
  const blueRim = new THREE.PointLight(0x67e8f9, 30, 22, 1.65);
  blueRim.position.set(3.8, -0.8, 3.8);
  stageScene.add(ambientLight, keyLight, faceLight, blueRim);

  avatarGroup = new THREE.Group();
  stageScene.add(avatarGroup);

  const shell = new THREE.Mesh(
    new THREE.SphereGeometry(2.04, 72, 72),
    new THREE.MeshPhysicalMaterial({
      color: 0xffd6ec,
      transmission: 0.85,
      transparent: true,
      opacity: 0.38,
      thickness: 0.85,
      roughness: 0.04,
      metalness: 0.02,
      clearcoat: 1,
      clearcoatRoughness: 0.08,
    })
  );
  shell.scale.set(0.95, 1.08, 0.95);
  avatarGroup.add(shell);

  const body = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.76, 0.86, 18, 42),
    new THREE.MeshStandardMaterial({
      color: 0x7c3aed,
      emissive: 0x312e81,
      emissiveIntensity: 0.38,
      roughness: 0.24,
      metalness: 0.14,
    })
  );
  body.position.set(0, -0.82, 0.02);
  body.scale.set(1.06, 1, 0.7);
  avatarGroup.add(body);

  const head = new THREE.Mesh(
    new THREE.SphereGeometry(1.16, 64, 64),
    new THREE.MeshStandardMaterial({
      color: 0xa5f3fc,
      emissive: 0x2563eb,
      emissiveIntensity: 0.18,
      roughness: 0.16,
      metalness: 0.05,
    })
  );
  head.position.set(0, 0.42, 0.02);
  head.scale.set(1.08, 1.0, 0.86);
  avatarGroup.add(head);

  faceGroup = new THREE.Group();
  faceGroup.position.set(0, 0.25, 0.94);
  avatarGroup.add(faceGroup);

  const visor = new THREE.Mesh(
    new THREE.SphereGeometry(0.88, 48, 48),
    new THREE.MeshPhysicalMaterial({
      color: 0xfdf2f8,
      transmission: 0.64,
      transparent: true,
      opacity: 0.82,
      thickness: 0.16,
      roughness: 0.035,
    })
  );
  visor.scale.set(1.08, 0.62, 0.24);
  faceGroup.add(visor);

  const glassesMaterial = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0xf9a8d4,
    emissiveIntensity: 0.3,
    metalness: 0.35,
    roughness: 0.2,
  });
  const leftFrame = new THREE.Mesh(new THREE.TorusGeometry(0.25, 0.032, 18, 54), glassesMaterial);
  leftFrame.position.set(-0.33, 0.1, 0.18);
  leftFrame.scale.set(1.05, 0.84, 1);
  const rightFrame = new THREE.Mesh(new THREE.TorusGeometry(0.25, 0.032, 18, 54), glassesMaterial.clone());
  rightFrame.position.set(0.33, 0.1, 0.18);
  rightFrame.scale.set(1.05, 0.84, 1);
  const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.17, 0.035, 0.045), glassesMaterial.clone());
  bridge.position.set(0, 0.1, 0.2);
  faceGroup.add(leftFrame, rightFrame, bridge);

  eyeLeft = new THREE.Mesh(new THREE.SphereGeometry(0.066, 20, 20), new THREE.MeshBasicMaterial({ color: 0x07111f }));
  eyeLeft.position.set(-0.33, 0.1, 0.24);
  eyeRight = new THREE.Mesh(new THREE.SphereGeometry(0.066, 20, 20), new THREE.MeshBasicMaterial({ color: 0x07111f }));
  eyeRight.position.set(0.33, 0.1, 0.24);
  faceGroup.add(eyeLeft, eyeRight);

  mouthMesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.035, 0.22, 10, 18), new THREE.MeshBasicMaterial({ color: 0x7c3aed }));
  mouthMesh.rotation.z = Math.PI / 2;
  mouthMesh.position.set(0, -0.2, 0.245);
  mouthMesh.scale.set(1, 0.2, 1);
  faceGroup.add(mouthMesh);

  const blushMaterial = new THREE.MeshBasicMaterial({ color: 0xf9a8d4, transparent: true, opacity: 0.38 });
  const blushLeft = new THREE.Mesh(new THREE.CircleGeometry(0.12, 24), blushMaterial);
  blushLeft.position.set(-0.6, -0.1, 0.21);
  const blushRight = new THREE.Mesh(new THREE.CircleGeometry(0.12, 24), blushMaterial.clone());
  blushRight.position.set(0.6, -0.1, 0.21);
  faceGroup.add(blushLeft, blushRight);

  const earMaterial = new THREE.MeshStandardMaterial({
    color: 0xf9a8d4,
    emissive: 0xec4899,
    emissiveIntensity: 0.32,
    roughness: 0.18,
    metalness: 0.08,
  });
  const leftEar = new THREE.Mesh(new THREE.SphereGeometry(0.23, 32, 32), earMaterial);
  leftEar.position.set(-1.17, 0.5, 0.02);
  leftEar.scale.set(0.6, 1, 0.5);
  const rightEar = new THREE.Mesh(new THREE.SphereGeometry(0.23, 32, 32), earMaterial.clone());
  rightEar.position.set(1.17, 0.5, 0.02);
  rightEar.scale.set(0.6, 1, 0.5);
  avatarGroup.add(leftEar, rightEar);

  const antenna = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.043, 0.56, 8, 18),
    new THREE.MeshStandardMaterial({ color: 0xfdf2f8, emissive: 0xf9a8d4, emissiveIntensity: 0.32 })
  );
  antenna.position.set(0, 1.6, 0.02);
  avatarGroup.add(antenna);

  heartMesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.155, 28, 28),
    new THREE.MeshStandardMaterial({ color: 0xfef08a, emissive: 0xfacc15, emissiveIntensity: 0.95 })
  );
  heartMesh.position.set(0, 2.0, 0.02);
  heartMesh.scale.set(1.08, 0.9, 1);
  avatarGroup.add(heartMesh);

  haloMesh = new THREE.Mesh(
    new THREE.TorusGeometry(1.42, 0.042, 20, 96),
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0x67e8f9,
      emissiveIntensity: 0.9,
      transparent: true,
      opacity: 0.7,
    })
  );
  haloMesh.rotation.x = Math.PI / 2;
  haloMesh.position.y = -1.78;
  avatarGroup.add(haloMesh);

  orbitGroup = new THREE.Group();
  avatarGroup.add(orbitGroup);
  const orbitColors = [0x67e8f9, 0xf9a8d4, 0xa78bfa, 0xfef08a];
  for (let index = 0; index < 10; index += 1) {
    const color = orbitColors[index % orbitColors.length];
    const orb = new THREE.Mesh(
      new THREE.SphereGeometry(index % 2 ? 0.052 : 0.072, 16, 16),
      new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.08 })
    );
    const angle = (Math.PI * 2 * index) / 10;
    orb.position.set(Math.cos(angle) * 2.55, Math.sin(angle * 1.4) * 0.86, Math.sin(angle) * 1.16);
    orbitGroup.add(orb);
  }

  const floorGlow = new THREE.Mesh(
    new THREE.CircleGeometry(3.5, 72),
    new THREE.MeshBasicMaterial({ color: 0xf9a8d4, transparent: true, opacity: 0.12 })
  );
  floorGlow.rotation.x = -Math.PI / 2;
  floorGlow.position.set(0, -2.18, 0);
  stageScene.add(floorGlow);

  fitStage();
  resizeObserver = new ResizeObserver(() => fitStage());
  resizeObserver.observe(stageHost);
  animateStage();
}

function startWatchdog() {
  if (watchdogTimer) window.clearInterval(watchdogTimer);
  watchdogTimer = window.setInterval(() => {
    if (!state.speechSupported || !state.preferences.autoListen) return;
    if (!shouldKeepListening) return;
    if (!state.listening && !recognitionStarting && !state.speaking && !state.loading) {
      restartVoiceLoop('watchdog detected stopped recognition');
    }
  }, 8_000);
}

export default function mount() {
  root = document.getElementById('assistant-root');
  state.speechSupported = typeof window !== 'undefined' && !!getRecognitionCtor();

  if ('speechSynthesis' in window) {
    window.speechSynthesis.onvoiceschanged = () => {
      updateVoiceList();
      update();
    };
    updateVoiceList();
  }

  void loadPreferences().then(() => {
    if (state.preferences.autoListen) startListening();
    startWatchdog();
  });

  initThreeStage();
  update();
}
