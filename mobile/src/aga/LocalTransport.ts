import type { RealtimeSnapshot } from '../realtime/RealtimeSession';
import { speakShortReply } from '../voice/speechOut';
import { initializeLocalStore, listMessages, listPendingReminders, logEvent } from '../db/localStore';

type Listener = (snapshot: RealtimeSnapshot) => void;

export class LocalTransport {
  private listeners = new Set<Listener>();
  private snapshot: RealtimeSnapshot = {
    ready: false,
    mode: 'sleeping',
    interim: '',
    messages: [],
    reminders: [],
    activeMedia: null,
    mediaCommand: null,
    audioLevel: 0,
    speechStatus: 'local transport starting',
    error: null,
    activeChoiceMenu: null,
    sessionLabel: null,
  } as RealtimeSnapshot;
  private options: { onTurnDone?: () => void };

  constructor(options: { onTurnDone?: () => void } = {}) {
    this.options = options;
  }

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => this.listeners.delete(listener);
  }

  private publish(patch: Partial<RealtimeSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch } as RealtimeSnapshot;
    for (const listener of this.listeners) listener(this.snapshot);
  }

  async start() {
    await initializeLocalStore();
    await this.refresh();
    this.publish({ ready: true, mode: 'listening', speechStatus: 'local short-reply transport ready' });
  }

  async stop() {
    this.publish({ mode: 'sleeping', speechStatus: 'local transport stopped' });
  }

  async replay(text: string) {
    const clean = String(text || '').trim();
    if (!clean) return;
    this.publish({ mode: 'speaking', speechStatus: 'local short reply' });
    await logEvent('localTransport.turn', clean.slice(0, 240)).catch(() => undefined);
    if (/\b(status|there|working)\b/i.test(clean)) await speakShortReply('I am here. Porcupine is listening locally, and I will open live voice only when needed.', 'warm');
    else await speakShortReply('I heard you. I will open a live session if this needs deeper help.', 'warm');
    await this.refresh();
    this.publish({ mode: 'listening', speechStatus: 'local turn done' });
    this.options.onTurnDone?.();
  }

  closeMedia() { this.publish({ activeMedia: null, mediaCommand: 'stop' }); }
  onMediaEvent(event: string) { this.publish({ mediaCommand: event as any }); }
  rearmMic() { this.publish({ speechStatus: 'local transport ready' }); }

  private async refresh() {
    const [messages, reminders] = await Promise.all([
      listMessages(10).catch(() => []),
      listPendingReminders(8).catch(() => []),
    ]);
    this.publish({ messages, reminders } as any);
  }
}