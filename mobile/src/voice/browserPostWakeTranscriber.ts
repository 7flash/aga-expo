import { emitWakeDebug } from './wakeDebugBus';
import { markCommandActive, markIdle, noteTranscript, muteWakeFor } from './browserVoiceActivityState';

export type BrowserPostWakeTranscriptEvent = {
  type: 'status' | 'partial' | 'final' | 'error' | 'timeout';
  text?: string;
  message?: string;
  raw?: unknown;
};

export type BrowserPostWakeTranscriberOptions = {
  lang?: string;
  windowMs?: number;
  silenceMs?: number;
  onEvent?: (event: BrowserPostWakeTranscriptEvent) => void;
  onFinalText?: (text: string, event: BrowserPostWakeTranscriptEvent) => void;
};

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onaudiostart: ((event: unknown) => void) | null;
  onsoundstart: ((event: unknown) => void) | null;
  onspeechstart: ((event: unknown) => void) | null;
  onspeechend: ((event: unknown) => void) | null;
  onresult: ((event: any) => void) | null;
  onerror: ((event: any) => void) | null;
  onend: ((event: unknown) => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

function RecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  const w = globalThis as any;
  return w.SpeechRecognition || w.webkitSpeechRecognition || null;
}

function clean(text: string) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function setPostWakeActive(active: boolean) {
  if (typeof window !== 'undefined') {
    (window as any).__AGA_POST_WAKE_ACTIVE = active;
  }
}

export function browserPostWakeSttSupported() {
  return typeof window !== 'undefined' && !!RecognitionCtor();
}

export function startBrowserPostWakeTranscriber(options: BrowserPostWakeTranscriberOptions = {}) {
  const Ctor = RecognitionCtor();
  const windowMs = Math.max(2500, Number(options.windowMs || (process as any)?.env?.EXPO_PUBLIC_AGA_POST_WAKE_COMMAND_WINDOW_MS || 11000));
  const silenceMs = Math.max(900, Number(options.silenceMs || (process as any)?.env?.EXPO_PUBLIC_AGA_POST_WAKE_SILENCE_MS || 1800));
  const lang = options.lang || String((process as any)?.env?.EXPO_PUBLIC_AGA_WEB_SPEECH_LANG || 'en-US');

  let stopped = false;
  let resolved = false;
  let bestText = '';
  let silenceTimer: ReturnType<typeof setTimeout> | null = null;
  let hardTimer: ReturnType<typeof setTimeout> | null = null;
  let recognition: SpeechRecognitionLike | null = null;

  const emit = (event: BrowserPostWakeTranscriptEvent) => {
    options.onEvent?.(event);

    if ((event.type === 'partial' || event.type === 'final') && event.text) {
      noteTranscript(event.text);
      emitWakeDebug({
        type: 'transcript',
        provider: 'browser-post-wake-stt',
        phase: 'post-wake',
        text: event.text,
        raw: event.raw,
      });
    }

    if (event.type === 'error') {
      emitWakeDebug({
        type: 'error',
        provider: 'browser-post-wake-stt',
        message: event.message || 'post wake STT error',
        raw: event.raw,
      });
    }
  };

  const clearTimers = () => {
    if (silenceTimer) clearTimeout(silenceTimer);
    if (hardTimer) clearTimeout(hardTimer);
    silenceTimer = null;
    hardTimer = null;
  };

  let resolvePromise!: (text: string) => void;
  let rejectPromise!: (error: Error) => void;
  const promise = new Promise<string>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });

  const finish = (text: string, raw?: unknown) => {
    if (resolved) return;

    const finalText = clean(text);
    if (!finalText) return;

    resolved = true;
    stopped = true;
    setPostWakeActive(false);
    clearTimers();

    try { recognition?.stop(); } catch {}
    try { recognition?.abort(); } catch {}

    const event: BrowserPostWakeTranscriptEvent = { type: 'final', text: finalText, raw };
    emit(event);
    options.onFinalText?.(finalText, event);
    resolvePromise(finalText);
  };

  const scheduleSilenceFinish = (raw?: unknown) => {
    if (silenceTimer) clearTimeout(silenceTimer);
    silenceTimer = setTimeout(() => {
      if (bestText) finish(bestText, raw);
    }, silenceMs);
  };

  if (!Ctor) {
    const message = 'Browser SpeechRecognition is unavailable. Use Chrome for web preview or enable OpenAI/Sherpa ASR.';
    emit({ type: 'error', message });
    rejectPromise(new Error(message));
    return { stop: () => {}, supported: false, promise };
  }

  try {
    setPostWakeActive(true);
    markCommandActive('post-wake STT', windowMs + 1200);
    muteWakeFor(windowMs + 1200, 'command capture active');

    recognition = new Ctor();
    recognition.lang = lang;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onaudiostart = () => emit({ type: 'status', message: 'post-wake mic open' });
    recognition.onsoundstart = () => emit({ type: 'status', message: 'post-wake sound detected' });
    recognition.onspeechstart = () => emit({ type: 'status', message: 'post-wake speech detected' });
    recognition.onspeechend = () => {
      if (bestText) scheduleSilenceFinish({ reason: 'speechend' });
    };

    recognition.onresult = (event: any) => {
      let interim = '';
      let final = '';

      for (let i = event.resultIndex || 0; i < event.results.length; i += 1) {
        const result = event.results[i];
        const text = clean(result?.[0]?.transcript || '');
        if (!text) continue;
        if (result.isFinal) final += `${text} `;
        else interim += `${text} `;
      }

      const combined = clean(final || interim || bestText);

      if (combined) {
        bestText = combined;
        emit({ type: final ? 'final' : 'partial', text: combined, raw: event });
        if (final) finish(combined, event);
        else scheduleSilenceFinish(event);
      }
    };

    recognition.onerror = (event: any) => {
      const message = String(event?.error || event?.message || 'SpeechRecognition error');

      if (message === 'no-speech' && bestText) {
        finish(bestText, event);
        return;
      }

      emit({ type: 'error', message, raw: event });

      if (!bestText && !resolved) {
        setPostWakeActive(false);
        markIdle('post-wake STT error');
        rejectPromise(new Error(message));
      }
    };

    recognition.onend = () => {
      if (resolved || stopped) return;

      setPostWakeActive(false);

      if (bestText) {
        finish(bestText, { reason: 'recognition-end' });
        return;
      }

      markIdle('post-wake STT timeout');
      emit({ type: 'timeout', message: 'No post-wake words heard.' });
      rejectPromise(new Error('No post-wake words heard.'));
    };

    hardTimer = setTimeout(() => {
      if (bestText) {
        finish(bestText, { reason: 'hard-timeout' });
      } else {
        stopped = true;
        setPostWakeActive(false);
        markIdle('post-wake hard timeout');

        try { recognition?.stop(); } catch {}

        emit({ type: 'timeout', message: 'Post-wake command window timed out.' });
        rejectPromise(new Error('Post-wake command window timed out.'));
      }
    }, windowMs);

    emit({ type: 'status', message: `listening for command (${Math.round(windowMs / 1000)}s)` });
    recognition.start();
  } catch (error) {
    setPostWakeActive(false);
    markIdle('post-wake STT failed');

    const message = error instanceof Error ? error.message : String(error);
    emit({ type: 'error', message, raw: error });
    rejectPromise(error instanceof Error ? error : new Error(message));
  }

  return {
    stop: () => {
      stopped = true;
      setPostWakeActive(false);
      markIdle('post-wake stopped');
      clearTimers();

      try { recognition?.stop(); } catch {}
      try { recognition?.abort(); } catch {}
    },
    supported: true,
    promise,
  };
}