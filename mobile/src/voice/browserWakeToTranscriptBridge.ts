import { emitWakeDebug, submitWakeFinalTranscript } from './wakeDebugBus';

let installed = false;

function normalize(text: unknown) {
  return String(text ?? '').replace(/\s+/g, ' ').trim();
}

export function ensureBrowserWakeToTranscriptBridge() {
  if (typeof window === 'undefined' || installed) return;
  installed = true;

  const onPostWakeTranscript = (event: Event) => {
    const detail = (event as CustomEvent)?.detail || {};
    const text = normalize(detail.text || detail.transcript || detail.finalText || '');
    if (!text) return;
    submitWakeFinalTranscript(text, detail).catch((error) => {
      emitWakeDebug({ type: 'error', provider: 'post-wake-bridge', message: error instanceof Error ? error.message : String(error), raw: error });
    });
  };

  window.addEventListener('aga:postWakeTranscript', onPostWakeTranscript as EventListener);

  const root = window as any;
  root.__AGA_SUBMIT_TEXT = (text: string, raw?: unknown) => submitWakeFinalTranscript(text, raw);
  root.__AGA_HANDLE_USER_TEXT = root.__AGA_SUBMIT_TEXT;
  root.__AGA_HANDLE_TEXT = root.__AGA_SUBMIT_TEXT;

  emitWakeDebug({ type: 'status', provider: 'post-wake-bridge', message: 'installed exclusive post-wake transcript bridge' });
}

export function uninstallBrowserWakeToTranscriptBridge() {
  // Intentionally not implemented for hot reload safety. Installing twice is guarded.
  installed = false;
}
