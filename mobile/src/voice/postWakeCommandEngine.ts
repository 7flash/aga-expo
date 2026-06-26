import { Platform } from 'react-native';
import { choicePromptHint, resolveChoicePhrase, type ChoiceLike } from './multilingualChoiceAliases';
import { normalizeSpeech } from '../aga/text';

export type PostWakeCommandResult =
  | { type: 'text'; text: string; source: 'dev' | 'rhino' | 'cheetah' }
  | { type: 'choice'; text: string; choice: ReturnType<typeof resolveChoicePhrase>; source: 'dev' | 'rhino' | 'cheetah' }
  | { type: 'control'; command: 'stop' | 'pause' | 'resume'; source: 'dev' | 'rhino' | 'cheetah' };

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
}

function env(name: string) {
  return process.env?.[name] ?? '';
}

function engineName() {
  return String(env('EXPO_PUBLIC_AGA_POST_WAKE_COMMAND_ENGINE') || 'auto').toLowerCase();
}

function numberEnv(name: string, fallback: number) {
  const n = Number(env(name));
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

async function optionalImport(specifier: string): Promise<any | null> {
  try {
    return await (Function('s', 'return import(s)') as any)(specifier);
  } catch {
    return null;
  }
}

function controlFromText(text: string): 'stop' | 'pause' | 'resume' | null {
  if (/\b(stop|quiet|cancel|shush|hush)\b/i.test(text)) return 'stop';
  if (/\b(pause|hold)\b/i.test(text)) return 'pause';
  if (/\b(resume|continue|unpause)\b/i.test(text)) return 'resume';
  return null;
}

function root(): any {
  return globalThis as any;
}

class DevPostWakeCommandEngine {
  private callbacks: PostWakeCommandCallbacks;
  private running = false;

  constructor(callbacks: PostWakeCommandCallbacks) {
    this.callbacks = callbacks;
  }

  getDiagnostics() {
    return { provider: 'dev-post-wake-command', command: '__AGA_SAY("two")', running: this.running };
  }

  async start() {
    if (this.running) return;
    this.running = true;
    root().__AGA_SAY = (text: string) => this.accept(text, 'dev');
    this.callbacks.onStatus?.(`post-wake dev command window ready. ${choicePromptHint(this.callbacks.getChoices?.() || [])}`);
  }

  async stop() {
    this.running = false;
    if (root().__AGA_SAY) root().__AGA_SAY = undefined;
    this.callbacks.onStatus?.('post-wake command window closed');
  }

  private accept(text: string, source: 'dev') {
    if (!this.running) return;
    const clean = normalizeSpeech(text).trim();
    if (!clean) return;
    const control = controlFromText(clean);
    if (control) {
      this.callbacks.onResult({ type: 'control', command: control, source });
      return;
    }
    const choice = resolveChoicePhrase(clean, this.callbacks.getChoices?.() || []);
    if (choice) {
      this.callbacks.onResult({ type: 'choice', text: clean, choice, source });
      return;
    }
    this.callbacks.onResult({ type: 'text', text: clean, source });
  }
}

class OptionalPicovoiceCommandEngine {
  private callbacks: PostWakeCommandCallbacks;
  private provider: 'rhino' | 'cheetah';
  private manager: any | null = null;
  private running = false;

  constructor(provider: 'rhino' | 'cheetah', callbacks: PostWakeCommandCallbacks) {
    this.provider = provider;
    this.callbacks = callbacks;
  }

  getDiagnostics() {
    return { provider: this.provider, running: this.running, manager: !!this.manager };
  }

  async start() {
    if (this.running) return;
    const accessKey = env('EXPO_PUBLIC_PICOVOICE_ACCESS_KEY');
    if (!accessKey) throw new Error(`Missing EXPO_PUBLIC_PICOVOICE_ACCESS_KEY for ${this.provider}.`);
    if (this.provider === 'rhino') await this.startRhino(accessKey);
    else await this.startCheetah(accessKey);
    this.running = true;
    this.callbacks.onStatus?.(`${this.provider} post-wake command window listening`);
  }

  async stop() {
    this.running = false;
    try { await this.manager?.delete?.(); } catch { /* ignore */ }
    try { await this.manager?.stop?.(); } catch { /* ignore */ }
    this.manager = null;
    this.callbacks.onStatus?.(`${this.provider} command window closed`);
  }

  private routeText(text: string, source: 'rhino' | 'cheetah') {
    const clean = normalizeSpeech(text).trim();
    if (!clean) return;
    const control = controlFromText(clean);
    if (control) return this.callbacks.onResult({ type: 'control', command: control, source });
    const choice = resolveChoicePhrase(clean, this.callbacks.getChoices?.() || []);
    if (choice) return this.callbacks.onResult({ type: 'choice', text: clean, choice, source });
    this.callbacks.onResult({ type: 'text', text: clean, source });
  }

  private async startRhino(accessKey: string) {
    const mod = await optionalImport('@picovoice/rhino-react-native');
    if (!mod?.RhinoManager?.fromContextPaths) throw new Error('Missing @picovoice/rhino-react-native or RhinoManager.fromContextPaths.');
    const contexts = String(env('EXPO_PUBLIC_AGA_RHINO_CONTEXTS') || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (!contexts.length) throw new Error('Missing EXPO_PUBLIC_AGA_RHINO_CONTEXTS for post-wake command menus.');
    this.manager = await mod.RhinoManager.fromContextPaths(accessKey, contexts, (inference: any) => {
      const text = String(inference?.intent || inference?.slots?.choice || inference?.slots?.text || '');
      this.routeText(text, 'rhino');
    });
    await this.manager?.start?.();
  }

  private async startCheetah(accessKey: string) {
    const mod = await optionalImport('@picovoice/cheetah-react-native');
    const CheetahManager = mod?.CheetahManager || mod?.default;
    if (!CheetahManager?.create && !CheetahManager?.fromBuiltInLanguage) throw new Error('Missing @picovoice/cheetah-react-native.');
    const callback = (partial: string, isEndpoint?: boolean) => {
      if (isEndpoint || /\S/.test(String(partial || ''))) this.routeText(String(partial || ''), 'cheetah');
    };
    this.manager = CheetahManager.create
      ? await CheetahManager.create(accessKey, callback)
      : await CheetahManager.fromBuiltInLanguage(accessKey, env('EXPO_PUBLIC_AGA_CHEETAH_LANGUAGE') || 'en', callback);
    await this.manager?.start?.();
  }
}

export function createPostWakeCommandEngine(callbacks: PostWakeCommandCallbacks) {
  const requested = engineName();
  const devAllowed = requested === 'dev' || (requested === 'auto' && Platform.OS === 'web');
  if (devAllowed) return new DevPostWakeCommandEngine(callbacks);
  if (requested === 'rhino') return new OptionalPicovoiceCommandEngine('rhino', callbacks);
  if (requested === 'cheetah') return new OptionalPicovoiceCommandEngine('cheetah', callbacks);
  if (requested === 'none' || requested === 'live') return null;
  if (requested === 'auto') return null;
  return new DevPostWakeCommandEngine(callbacks);
}

export function postWakeWindowMs() {
  return numberEnv('EXPO_PUBLIC_AGA_POST_WAKE_COMMAND_WINDOW_MS', 8000);
}
