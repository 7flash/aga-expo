import { emitWakeDebug } from '../voice/wakeDebugBus';

type AnyController = Record<string, any>;

const METHOD_CANDIDATES = [
  // Most explicit text-turn names first.
  'handleTextTurn',
  'runTextTurn',
  'submitText',
  'handleUserText',
  'processUserText',
  'handleText',
  'onUserText',

  // Likely voice/post-wake names.
  'handlePostWakeText',
  'handlePostWakeCommand',
  'processPostWakeCommand',
  'handleRecognizedText',
  'handleTranscript',
  'onTranscript',
  'onFinalTranscript',

  // Common internal turn/utterance names.
  'handleTurnText',
  'processTurn',
  'runTurn',
  'enqueueTurn',
  'handleUtterance',
  'onUtterance',
];

function clean(text: string) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function isCallable(controller: AnyController, name: string) {
  return controller && typeof controller[name] === 'function';
}

function findCallable(controller: AnyController) {
  for (const name of METHOD_CANDIDATES) {
    if (isCallable(controller, name)) return name;
  }

  // Last-resort discovery for renamed methods. Avoid start/stop/publish methods.
  const names = new Set<string>();
  let cursor: any = controller;

  while (cursor && cursor !== Object.prototype) {
    for (const name of Object.getOwnPropertyNames(cursor)) names.add(name);
    cursor = Object.getPrototypeOf(cursor);
  }

  for (const name of Array.from(names)) {
    if (
      /text|transcript|utterance|command|turn/i.test(name) &&
      !/start|stop|reset|subscribe|publish|snapshot|get|set/i.test(name) &&
      typeof controller[name] === 'function'
    ) {
      return name;
    }
  }

  return '';
}

async function routeViaController(controller: AnyController, text: string, raw?: unknown) {
  const method = findCallable(controller);
  if (!method) {
    emitWakeDebug({
      type: 'error',
      provider: 'wake-realtime-controller-sink',
      message: 'WakeRealtimeController has no known text-turn method to receive post-wake transcript.',
      raw: { available: Object.keys(controller || {}).slice(0, 80), raw },
    });
    return false;
  }

  emitWakeDebug({
    type: 'status',
    provider: 'wake-realtime-controller-sink',
    message: `routing post-wake transcript through WakeRealtimeController.${method}`,
  });

  await controller[method](text, {
    source: 'browser-post-wake',
    origin: 'voice',
    raw,
  });

  return true;
}

/**
 * Registers WakeRealtimeController as the only browser post-wake text sink.
 *
 * Browser/dev wake path:
 *   audio/KWS wake -> post-wake transcript -> window.__AGA_SUBMIT_TEXT
 *   -> WakeRealtimeController -> normal router/capabilityRunner/cloud/TTS path
 */
export function registerWakeRealtimeControllerBrowserSink(controller: AnyController) {
  if (typeof window === 'undefined' || !controller) return () => {};

  const sink = async (input: string, raw?: unknown) => {
    const text = clean(input);
    if (!text) return false;

    try {
      return await routeViaController(controller, text, raw);
    } catch (error) {
      emitWakeDebug({
        type: 'error',
        provider: 'wake-realtime-controller-sink',
        message: error instanceof Error ? error.message : String(error),
        raw: error,
      });
      throw error;
    }
  };

  const w = window as any;
  w.__AGA_WAKE_REALTIME_CONTROLLER = controller;
  w.__AGA_CONTROLLER = controller;
  w.__AGA_SUBMIT_TEXT = sink;
  w.__AGA_HANDLE_USER_TEXT = sink;
  w.__AGA_HANDLE_TEXT = sink;
  w.__AGA_TEXT_TURN = sink;

  const listener = ((event: CustomEvent) => {
    const detail = event.detail || {};
    const text = clean(detail.text || detail.transcript || detail.finalText || '');
    if (!text) return;
    sink(text, detail).catch(() => {});
  }) as EventListener;

  window.addEventListener('aga:postWakeTranscript', listener);

  emitWakeDebug({
    type: 'status',
    provider: 'wake-realtime-controller-sink',
    message: 'WakeRealtimeController registered as browser post-wake sink',
  });

  return () => {
    window.removeEventListener('aga:postWakeTranscript', listener);
    if (w.__AGA_WAKE_REALTIME_CONTROLLER === controller) delete w.__AGA_WAKE_REALTIME_CONTROLLER;
    if (w.__AGA_CONTROLLER === controller) delete w.__AGA_CONTROLLER;
    if (w.__AGA_SUBMIT_TEXT === sink) delete w.__AGA_SUBMIT_TEXT;
    if (w.__AGA_HANDLE_USER_TEXT === sink) delete w.__AGA_HANDLE_USER_TEXT;
    if (w.__AGA_HANDLE_TEXT === sink) delete w.__AGA_HANDLE_TEXT;
    if (w.__AGA_TEXT_TURN === sink) delete w.__AGA_TEXT_TURN;
  };
}
