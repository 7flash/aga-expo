import { emitWakeDebug } from './wakeDebugBus';
import { markThinking, markIdle, noteTranscript } from './browserVoiceActivityState';

type RuntimeResult = {
  handled: boolean;
  route?: string;
};

function clean(text: string) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function stripWakeWords(text: string) {
  return clean(text)
    .replace(/^(aga|hey aga|okay aga|ok aga|guardian|angel|hey|hi|hello)[,.\s]+/i, '')
    .trim();
}

async function tryControllerSinks(text: string, raw?: unknown) {
  const w = globalThis as any;

  const controller = w.__AGA_WAKE_REALTIME_CONTROLLER || w.__AGA_CONTROLLER;

  const sinks = [
    w.__AGA_SUBMIT_TEXT,
    w.__AGA_HANDLE_USER_TEXT,
    w.__AGA_HANDLE_TEXT,
    w.__AGA_TEXT_TURN,
    controller?.handleTextTurn?.bind(controller),
    controller?.runTextTurn?.bind(controller),
    controller?.submitText?.bind(controller),
    controller?.handleUserText?.bind(controller),
    controller?.handlePostWakeCommand?.bind(controller),
    controller?.handleTranscript?.bind(controller),
  ].filter((fn, index, array) => typeof fn === 'function' && array.indexOf(fn) === index);

  for (const sink of sinks) {
    try {
      await sink(text, { source: 'browser-post-wake', origin: 'voice', raw });

      emitWakeDebug({
        type: 'status',
        provider: 'browser-command-runtime',
        message: 'post-wake transcript delivered to WakeRealtimeController',
      });

      return true;
    } catch (error) {
      emitWakeDebug({
        type: 'error',
        provider: 'browser-command-runtime',
        message: error instanceof Error ? error.message : String(error),
        raw: error,
      });
    }
  }

  return false;
}

async function fallbackYouTube(text: string) {
  const t = clean(text).toLowerCase();
  if (!/\b(play|open|youtube|music|song|lofi|ambient)\b/.test(t)) return false;

  const query = clean(
    t
      .replace(/\b(can you|please|could you)\b/g, '')
      .replace(/\b(play|open|start|youtube|music|on youtube)\b/g, '')
  ) || 'relaxing music';

  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('aga:openYouTube', {
      detail: { query, url, source: 'browser-command-runtime-fallback' },
    }));

    const w = window as any;
    if (typeof w.__AGA_OPEN_YOUTUBE === 'function') {
      await w.__AGA_OPEN_YOUTUBE(query, { url, source: 'browser-command-runtime-fallback' });
    } else {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
  }

  emitWakeDebug({
    type: 'status',
    provider: 'browser-command-runtime',
    message: `fallback opened YouTube for: ${query}`,
  });

  return true;
}

/**
 * Browser post-wake command runtime.
 *
 * Primary route is WakeRealtimeController. Fallback is intentionally tiny and
 * only exists so browser testing can prove voice -> action while the controller
 * method name is still being wired.
 */
export async function handleBrowserVoiceCommand(input: string, raw?: unknown): Promise<RuntimeResult> {
  const text = stripWakeWords(input);

  if (!text) return { handled: false };

  noteTranscript(text);

  emitWakeDebug({
    type: 'status',
    provider: 'browser-command-runtime',
    message: `routing command into WakeRealtimeController: ${text}`,
    raw,
  });

  markThinking('routing command', 16000);

  try {
    const delivered = await tryControllerSinks(text, raw);

    if (delivered) {
      return { handled: true, route: 'wake-realtime-controller' };
    }

    const fallbackHandled = await fallbackYouTube(text);

    if (fallbackHandled) {
      markIdle('fallback action complete');
      return { handled: true, route: 'youtube-fallback' };
    }

    emitWakeDebug({
      type: 'error',
      provider: 'browser-command-runtime',
      message: 'No WakeRealtimeController text sink registered. Voice transcript works, but controller routing is not wired.',
      raw: { text },
    });

    return { handled: false, route: 'missing-controller-sink' };
  } finally {
    // TTS will set speaking state if the controller replies. If no TTS starts,
    // release thinking shortly.
    setTimeout(() => markIdle('command route done'), 1800);
  }
}

let installed = false;

export function installBrowserVoiceCommandRuntime() {
  if (typeof window === 'undefined') return;

  const w = window as any;

  if (w.__AGA_BROWSER_VOICE_RUNTIME_CLEANUP) {
    try { w.__AGA_BROWSER_VOICE_RUNTIME_CLEANUP(); } catch {}
  }

  installed = true;

  const listener = ((event: CustomEvent) => {
    const detail = event.detail || {};
    const text = clean(detail.text || detail.transcript || detail.finalText || '');

    if (!text) return;

    handleBrowserVoiceCommand(text, detail).catch((error) => {
      emitWakeDebug({
        type: 'error',
        provider: 'browser-command-runtime',
        message: error instanceof Error ? error.message : String(error),
        raw: error,
      });
    });
  }) as EventListener;

  window.addEventListener('aga:postWakeTranscript', listener);

  w.__AGA_HANDLE_BROWSER_VOICE_COMMAND = handleBrowserVoiceCommand;
  w.__AGA_BROWSER_VOICE_RUNTIME_CLEANUP = () => {
    window.removeEventListener('aga:postWakeTranscript', listener);
    installed = false;
  };

  emitWakeDebug({
    type: 'status',
    provider: 'browser-command-runtime',
    message: 'browser voice command runtime installed',
  });
}

if (typeof window !== 'undefined') {
  setTimeout(installBrowserVoiceCommandRuntime, 0);
}
