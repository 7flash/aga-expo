import { startBrowserPostWakeTranscriber, browserPostWakeSttSupported } from './browserPostWakeTranscriber';
import { handleBrowserVoiceCommand, installBrowserVoiceCommandRuntime } from './browserVoiceCommandRuntime';
import { markWakeDetected, markCommandActive, browserVoiceShouldIgnoreWake } from './browserVoiceActivityState';
import { emitWakeDebug, getRecentWakeDebugEvents } from './wakeDebugBus';

let installed = false;
let active: { stop: () => void; promise?: Promise<string> } | null = null;
let lastStartAt = 0;

function dispatchTranscript(text: string, raw?: unknown) {
  if (typeof window === 'undefined') return;

  window.dispatchEvent(new CustomEvent('aga:postWakeTranscript', {
    detail: {
      text,
      transcript: text,
      finalText: text,
      source: 'browser-wake-to-transcript',
      at: Date.now(),
      raw,
    },
  }));
}

function startCommandCapture(reason: string, raw?: unknown) {
  const now = Date.now();

  if (active || now - lastStartAt < 1400) return;

  if (browserVoiceShouldIgnoreWake() && !reason.includes('manual')) {
    emitWakeDebug({
      type: 'status',
      provider: 'browser-wake-to-transcript',
      message: `wake ignored while busy (${reason})`,
      raw,
    });
    return;
  }

  lastStartAt = now;

  if (!browserPostWakeSttSupported()) {
    emitWakeDebug({
      type: 'error',
      provider: 'browser-wake-to-transcript',
      message: 'Wake detected, but browser post-wake STT is unavailable. Use Chrome or wire OpenAI/Sherpa ASR.',
      raw,
    });
    return;
  }

  markWakeDetected(reason);
  markCommandActive('command capture', 12000);

  emitWakeDebug({
    type: 'status',
    provider: 'browser-wake-to-transcript',
    message: `wake detected; command capture starting (${reason})`,
  });

  active = startBrowserPostWakeTranscriber({
    windowMs: 11000,
    silenceMs: 1800,
    onFinalText: async (text, event) => {
      dispatchTranscript(text, event.raw);
      await handleBrowserVoiceCommand(text, event.raw);
    },
    onEvent: (event) => {
      if (event.type === 'error' || event.type === 'timeout') active = null;
    },
  });

  active.promise
    ?.catch((error) => {
      emitWakeDebug({
        type: 'error',
        provider: 'browser-wake-to-transcript',
        message: error instanceof Error ? error.message : String(error),
        raw: error,
      });
    })
    .finally(() => {
      active = null;
    });
}

function replayRecentWakeIfAny() {
  const recent = getRecentWakeDebugEvents();
  const last = [...recent].reverse().find((event) => event.type === 'keyword') as any;

  if (!last) return;
  if (Date.now() - last.at > 3500) return;

  startCommandCapture(`replay:${last.keyword || 'wake'}`, last);
}

export function ensureBrowserWakeToTranscriptBridge() {
  installBrowserVoiceCommandRuntime();

  if (installed || typeof window === 'undefined') {
    replayRecentWakeIfAny();
    return;
  }

  installed = true;

  const w = window as any;
  if (w.__AGA_WAKE_TO_TRANSCRIPT_BRIDGE_CLEANUP) {
    try { w.__AGA_WAKE_TO_TRANSCRIPT_BRIDGE_CLEANUP(); } catch {}
  }

  const listener = ((event: CustomEvent) => {
    const detail = event.detail || {};
    const keyword = String(detail.keyword || '').toLowerCase();

    if (keyword !== 'aga' && keyword !== 'wake' && keyword !== 'hey' && keyword !== 'hi') return;

    startCommandCapture(`keyword:${keyword}`, detail);
  }) as EventListener;

  window.addEventListener('aga:wakeKeyword', listener);

  w.__AGA_START_POST_WAKE_CAPTURE = () => startCommandCapture('manual-debug');
  w.__AGA_WAKE_TO_TRANSCRIPT_BRIDGE_CLEANUP = () => {
    window.removeEventListener('aga:wakeKeyword', listener);
    installed = false;
  };

  emitWakeDebug({
    type: 'status',
    provider: 'browser-wake-to-transcript',
    message: 'browser wake-to-transcript bridge installed',
  });

  replayRecentWakeIfAny();
}

if (typeof window !== 'undefined') {
  setTimeout(ensureBrowserWakeToTranscriptBridge, 0);
}
