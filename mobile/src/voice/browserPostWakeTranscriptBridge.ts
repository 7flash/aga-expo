import { emitWakeDebug } from './wakeDebugBus';

export type BrowserPostWakeBridgeHandler = (text: string, detail?: unknown) => void | Promise<void>;

let installed = false;

export function installBrowserPostWakeTranscriptBridge(handler: BrowserPostWakeBridgeHandler) {
  if (typeof window === 'undefined' || installed) return () => {};
  installed = true;

  const listener = (event: Event) => {
    const detail = (event as CustomEvent).detail || {};
    const text = String(detail.text || detail.transcript || detail.finalText || '').trim();
    if (!text) return;

    emitWakeDebug({ type: 'transcript', provider: 'browser-post-wake-bridge', phase: 'post-wake', text, raw: detail });
    Promise.resolve(handler(text, detail)).catch((error) => {
      emitWakeDebug({
        type: 'error',
        provider: 'browser-post-wake-bridge',
        message: error instanceof Error ? error.message : String(error),
        raw: error,
      });
    });
  };

  window.addEventListener('aga:postWakeTranscript', listener as EventListener);
  return () => {
    installed = false;
    window.removeEventListener('aga:postWakeTranscript', listener as EventListener);
  };
}
