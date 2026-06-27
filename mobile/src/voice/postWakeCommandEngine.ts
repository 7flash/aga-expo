import { Platform } from 'react-native';
import { startBrowserPostWakeTranscriber, browserPostWakeSttSupported, type BrowserPostWakeTranscriptEvent } from './browserPostWakeTranscriber';
import { emitWakeDebug } from './wakeDebugBus';

export type PostWakeCommandEvent =
  | { type: 'status'; message: string; raw?: unknown }
  | { type: 'partial'; text: string; transcript: string; raw?: unknown }
  | { type: 'final'; text: string; transcript: string; finalText: string; command: string; raw?: unknown }
  | { type: 'timeout'; message: string; raw?: unknown }
  | { type: 'error'; message: string; raw?: unknown };

type Listener = (event: PostWakeCommandEvent) => void;

type CallbackBag = {
  onEvent?: (event: PostWakeCommandEvent) => void;
  onFinal?: (text: string, event: PostWakeCommandEvent) => void;
  onFinalText?: (text: string, event: PostWakeCommandEvent) => void;
  onTranscript?: (text: string, event: PostWakeCommandEvent) => void;
  onText?: (text: string, event: PostWakeCommandEvent) => void;
  onCommand?: (text: string, event: PostWakeCommandEvent) => void;
};

function envNumber(name: string, fallback: number) {
  const value = Number((process as any)?.env?.[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function postWakeWindowMs() {
  return envNumber('EXPO_PUBLIC_AGA_POST_WAKE_COMMAND_WINDOW_MS', 6500);
}

function collectCallbacks(args: unknown[], config: unknown): CallbackBag {
  const bag: CallbackBag = {};

  const absorb = (value: any) => {
    if (!value) return;
    if (typeof value === 'function') {
      bag.onFinalText = value;
      return;
    }
    for (const key of ['onEvent', 'onFinal', 'onFinalText', 'onTranscript', 'onText', 'onCommand'] as const) {
      if (typeof value[key] === 'function') (bag as any)[key] = value[key];
    }
  };

  absorb(config);
  for (const arg of args) absorb(arg);
  return bag;
}

function toPostWakeEvent(event: BrowserPostWakeTranscriptEvent): PostWakeCommandEvent {
  if (event.type === 'partial' && event.text) {
    return { type: 'partial', text: event.text, transcript: event.text, raw: event.raw };
  }
  if (event.type === 'final' && event.text) {
    return { type: 'final', text: event.text, transcript: event.text, finalText: event.text, command: event.text, raw: event.raw };
  }
  if (event.type === 'error') return { type: 'error', message: event.message || 'Post-wake STT error', raw: event.raw };
  if (event.type === 'timeout') return { type: 'timeout', message: event.message || 'Post-wake command timed out.', raw: event.raw };
  return { type: 'status', message: event.message || 'post-wake status', raw: event.raw };
}

/**
 * Single post-wake command engine.
 *
 * Browser preview:
 *   wake keyword/audio gate -> Web Speech command capture -> final transcript
 *
 * Android:
 *   this file intentionally does not resurrect Android SpeechRecognizer as the
 *   always-on wake loop. Native post-wake should be Sherpa ASR / OpenAI STT /
 *   live session depending on tier.
 */
export function createPostWakeCommandEngine(config: CallbackBag = {}) {
  const listeners = new Set<Listener>();
  let active: { stop: () => void; promise?: Promise<string> } | null = null;

  const emit = (event: PostWakeCommandEvent) => {
    config.onEvent?.(event);
    for (const listener of Array.from(listeners)) {
      try {
        listener(event);
      } catch (error) {
        console.warn('[aga:post-wake] listener failed', error);
      }
    }
  };

  const deliverFinal = (text: string, event: PostWakeCommandEvent, callbacks: CallbackBag) => {
    callbacks.onFinal?.(text, event);
    callbacks.onFinalText?.(text, event);
    callbacks.onTranscript?.(text, event);
    callbacks.onText?.(text, event);
    callbacks.onCommand?.(text, event);

    config.onFinal?.(text, event);
    config.onFinalText?.(text, event);
    config.onTranscript?.(text, event);
    config.onText?.(text, event);
    config.onCommand?.(text, event);
  };

  const start = (...args: unknown[]) => {
    stop();

    const callbacks = collectCallbacks(args, config);
    const windowMs = postWakeWindowMs();

    if (Platform.OS === 'web') {
      if (!browserPostWakeSttSupported()) {
        const event: PostWakeCommandEvent = {
          type: 'error',
          message: 'Browser post-wake STT is unavailable. Use Chrome or enable OpenAI/Sherpa ASR.',
        };
        emit(event);
        return Promise.reject(new Error(event.message));
      }

      emit({ type: 'status', message: 'post-wake command capture starting' });
      emitWakeDebug({ type: 'status', provider: 'post-wake', message: 'command capture starting' });

      const transcriber = startBrowserPostWakeTranscriber({
        windowMs,
        onEvent: (browserEvent) => {
          const event = toPostWakeEvent(browserEvent);
          emit(event);
          callbacks.onEvent?.(event);

          if (event.type === 'final') {
            deliverFinal(event.text, event, callbacks);
          }
        },
      });

      active = transcriber;
      return transcriber.promise;
    }

    const event: PostWakeCommandEvent = {
      type: 'error',
      message: 'Native post-wake STT is not wired here. Use Sherpa ASR/OpenAI STT/live transport on device.',
    };
    emit(event);
    return Promise.reject(new Error(event.message));
  };

  const stop = () => {
    const current = active;
    active = null;
    if (current) {
      try { current.stop(); } catch {}
    }
  };

  return {
    start,
    arm: start,
    capture: start,
    listen: start,
    stop,
    reset: stop,
    isSupported: () => Platform.OS === 'web' ? browserPostWakeSttSupported() : false,
    subscribe(listener: Listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    on(listener: Listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
