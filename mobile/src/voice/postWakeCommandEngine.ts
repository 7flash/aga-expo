import { Platform } from 'react-native';
import { choicePromptHint, resolveChoicePhrase, type ChoiceLike } from './multilingualChoiceAliases';
import { normalizeSpeech } from '../aga/text';
import { createSherpaKeywordEngine, DevSherpaKeywordInjector } from './sherpaKeywordEngine';
import { postWakeKeywords } from './sherpaKeywordPhrases';
import type { KeywordEngine, KeywordEvent } from './keywordEngine';

export type PostWakeCommandResult =
  | { type: 'text'; text: string; source: 'dev' | 'sherpa_native' | 'sherpa_wasm' }
  | { type: 'choice'; text: string; choice: ReturnType<typeof resolveChoicePhrase>; source: 'dev' | 'sherpa_native' | 'sherpa_wasm' }
  | { type: 'control'; command: 'stop' | 'pause' | 'resume'; source: 'dev' | 'sherpa_native' | 'sherpa_wasm' }
  | { type: 'no_match'; reason: string; source: 'dev' | 'sherpa_native' | 'sherpa_wasm' };

export type PostWakeCommandCallbacks = {
  onResult: (result: PostWakeCommandResult) => void;
  onStatus?: (status: string) => void;
  onError?: (message: string) => void;
  getChoices?: () => ChoiceLike[];
};

declare global {
  // Browser/dev command window helper. It exists only while AGA is awake.
  // eslint-disable-next-line no-var
  var __AGA_SAY: undefined | ((text: string) => void);
  // eslint-disable-next-line no-var
  var __AGA_CHOOSE: undefined | ((choice: string | number) => void);
  // eslint-disable-next-line no-var
  var __AGA_REPEAT: undefined | (() => void);
}

function env(name: string) {
  return process.env?.[name] ?? '';
}

function engineName() {
  return String(env('EXPO_PUBLIC_AGA_POST_WAKE_COMMAND_ENGINE') || 'sherpa').toLowerCase();
}

function numberEnv(name: string, fallback: number) {
  const n = Number(env(name));
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function sourceFromProvider(provider: string): 'dev' | 'sherpa_native' | 'sherpa_wasm' {
  if (provider === 'dev_keyword') return 'dev';
  if (provider === 'sherpa_wasm') return 'sherpa_wasm';
  return 'sherpa_native';
}

function controlFromIntent(intent: string, value?: string): 'stop' | 'pause' | 'resume' | null {
  if (intent === 'control.stop' || value === 'stop') return 'stop';
  if (intent === 'control.pause' || value === 'pause') return 'pause';
  if (intent === 'control.resume' || value === 'resume') return 'resume';
  return null;
}

function controlFromText(text: string): 'stop' | 'pause' | 'resume' | null {
  if (/\b(stop|quiet|cancel|shush|hush|berhenti|стоп)\b/i.test(text)) return 'stop';
  if (/\b(pause|hold|jeda|пауза)\b/i.test(text)) return 'pause';
  if (/\b(resume|continue|unpause|lanjut|продолжить)\b/i.test(text)) return 'resume';
  return null;
}

function root(): any {
  return globalThis as any;
}

class DevPostWakeCommandEngine {
  private callbacks: PostWakeCommandCallbacks;
  private engine: KeywordEngine;
  private running = false;

  constructor(callbacks: PostWakeCommandCallbacks) {
    this.callbacks = callbacks;
    this.engine = new DevSherpaKeywordInjector({
      onKeyword: (event) => this.routeKeyword(event),
      onText: (text) => this.routeText(text, 'dev'),
      onNoMatch: (reason) => this.callbacks.onResult({ type: 'no_match', reason, source: 'dev' }),
      onStatus: (status) => this.callbacks.onStatus?.(status),
      onError: (message) => this.callbacks.onError?.(message),
    });
  }

  getDiagnostics() {
    return { provider: 'dev-post-wake-command', command: '__AGA_SAY("two") / __AGA_CHOOSE(2)', running: this.running, engine: this.engine.getDiagnostics?.() };
  }

  async start() {
    if (this.running) return;
    this.running = true;
    await this.engine.start({
      mode: 'menu',
      provider: 'dev_keyword',
      keywords: postWakeKeywords(this.callbacks.getChoices?.() || []),
      // The controller owns the post-wake timeout because it also owns the
      // buffered utterance recorder. Letting both layers timeout creates
      // duplicate STT requests.
      timeoutMs: 0,
      allowTextFallback: true,
    });
    root().__AGA_CHOOSE = (choice: string | number) => root().__AGA_SAY?.(`choose ${choice}`);
    root().__AGA_REPEAT = () => root().__AGA_SAY?.('repeat options');
    this.callbacks.onStatus?.(`post-wake dev command window ready. ${choicePromptHint(this.callbacks.getChoices?.() || [])}`);
  }

  async stop() {
    this.running = false;
    await this.engine.stop('post_wake_dev_stop');
    if (root().__AGA_CHOOSE) root().__AGA_CHOOSE = undefined;
    if (root().__AGA_REPEAT) root().__AGA_REPEAT = undefined;
    this.callbacks.onStatus?.('post-wake command window closed');
  }

  private routeKeyword(event: KeywordEvent) {
    const source = sourceFromProvider(event.provider);
    const control = controlFromIntent(String(event.intent), event.value);
    if (control) return this.callbacks.onResult({ type: 'control', command: control, source });
    if (event.intent === 'choice.select') {
      const choice = resolveChoicePhrase(String(event.value || event.phrase), this.callbacks.getChoices?.() || []);
      return this.callbacks.onResult({ type: 'choice', text: String(event.value || event.phrase), choice, source });
    }
    if (event.intent === 'menu.repeat') return this.routeText('repeat options', source);
    if (event.intent === 'menu.close') return this.routeText('close menu', source);
    if (event.intent === 'menu.back') return this.routeText('back', source);
    this.routeText(String(event.value || event.phrase), source);
  }

  private routeText(text: string, source: 'dev' | 'sherpa_native' | 'sherpa_wasm') {
    const clean = normalizeSpeech(text).trim();
    if (!clean) return;
    const control = controlFromText(clean);
    if (control) return this.callbacks.onResult({ type: 'control', command: control, source });
    const choice = resolveChoicePhrase(clean, this.callbacks.getChoices?.() || []);
    if (choice) return this.callbacks.onResult({ type: 'choice', text: clean, choice, source });
    this.callbacks.onResult({ type: 'text', text: clean, source });
  }
}

class SherpaPostWakeCommandEngine {
  private callbacks: PostWakeCommandCallbacks;
  private engine: KeywordEngine;
  private provider: 'sherpa_native' | 'sherpa_wasm';
  private running = false;

  constructor(callbacks: PostWakeCommandCallbacks, provider: 'sherpa_native' | 'sherpa_wasm') {
    this.callbacks = callbacks;
    this.provider = provider;
    this.engine = createSherpaKeywordEngine({
      onKeyword: (event) => this.routeKeyword(event),
      onText: (text, providerName) => this.routeText(text, sourceFromProvider(providerName)),
      onNoMatch: (reason) => this.callbacks.onResult({ type: 'no_match', reason, source: sourceFromProvider(this.provider) }),
      onStatus: (status) => this.callbacks.onStatus?.(status),
      onError: (message) => this.callbacks.onError?.(message),
    }, provider);
  }

  getDiagnostics() {
    return { provider: this.provider, running: this.running, engine: this.engine.getDiagnostics?.() };
  }

  async start() {
    if (this.running) return;
    this.running = true;
    await this.engine.start({
      mode: 'menu',
      provider: this.provider,
      keywords: postWakeKeywords(this.callbacks.getChoices?.() || []),
      // The controller owns the post-wake timeout because it also owns the
      // buffered utterance recorder. Letting both layers timeout creates
      // duplicate STT requests.
      timeoutMs: 0,
      allowTextFallback: true,
    });
    this.callbacks.onStatus?.(`${this.provider} post-wake command window listening. ${choicePromptHint(this.callbacks.getChoices?.() || [])}`);
  }

  async stop() {
    this.running = false;
    await this.engine.stop('post_wake_stop');
    this.callbacks.onStatus?.(`${this.provider} command window closed`);
  }

  private routeKeyword(event: KeywordEvent) {
    const source = sourceFromProvider(event.provider);
    const control = controlFromIntent(String(event.intent), event.value);
    if (control) return this.callbacks.onResult({ type: 'control', command: control, source });
    if (event.intent === 'choice.select') {
      const choice = resolveChoicePhrase(String(event.value || event.phrase), this.callbacks.getChoices?.() || []);
      return this.callbacks.onResult({ type: 'choice', text: String(event.value || event.phrase), choice, source });
    }
    if (event.intent === 'menu.repeat') return this.routeText('repeat options', source);
    if (event.intent === 'menu.close') return this.routeText('close menu', source);
    if (event.intent === 'menu.back') return this.routeText('back', source);
    this.routeText(String(event.value || event.phrase), source);
  }

  private routeText(text: string, source: 'dev' | 'sherpa_native' | 'sherpa_wasm') {
    const clean = normalizeSpeech(text).trim();
    if (!clean) return;
    const control = controlFromText(clean);
    if (control) return this.callbacks.onResult({ type: 'control', command: control, source });
    const choice = resolveChoicePhrase(clean, this.callbacks.getChoices?.() || []);
    if (choice) return this.callbacks.onResult({ type: 'choice', text: clean, choice, source });
    this.callbacks.onResult({ type: 'text', text: clean, source });
  }
}

export function createPostWakeCommandEngine(callbacks: PostWakeCommandCallbacks) {
  const requested = engineName();
  if (requested === 'dev') return new DevPostWakeCommandEngine(callbacks);
  if (requested === 'none' || requested === 'off') return null;
  if (requested === 'speech' || requested === 'web_speech' || requested === 'android_speech') {
    throw new Error('SpeechRecognition engines are not allowed. Use Sherpa native/WASM for post-wake commands, or set EXPO_PUBLIC_AGA_ALLOW_DEV_KEYWORD_INJECTOR=1 with engine=dev for browser harness testing.');
  }
  if (requested === 'sherpa_wasm') return new SherpaPostWakeCommandEngine(callbacks, 'sherpa_wasm');
  if (requested === 'sherpa_native') return new SherpaPostWakeCommandEngine(callbacks, 'sherpa_native');
  if (requested === 'sherpa' || requested === 'auto') {
    return new SherpaPostWakeCommandEngine(callbacks, Platform.OS === 'web' ? 'sherpa_wasm' : 'sherpa_native');
  }
  return new SherpaPostWakeCommandEngine(callbacks, Platform.OS === 'web' ? 'sherpa_wasm' : 'sherpa_native');
}

export function postWakeWindowMs() {
  return numberEnv('EXPO_PUBLIC_AGA_POST_WAKE_COMMAND_WINDOW_MS', 8000);
}
