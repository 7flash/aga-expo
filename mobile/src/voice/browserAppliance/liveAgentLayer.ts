import { ElevenLabsAgentSession } from '../../elevenlabs/ElevenLabsAgentSession';
import type { BrowserLiveAgentLayer } from './types';

export class ElevenLabsLiveAgentLayer implements BrowserLiveAgentLayer {
  readonly name = 'elevenlabs-agent';
  private session: ElevenLabsAgentSession | null = null;
  private active = false;

  async startWithText(text: string) {
    if (!this.session) this.session = new ElevenLabsAgentSession({ onTurnDone: () => { this.active = false; } });
    this.active = true;
    await this.session.start();
    await this.session.replay(text);
  }

  async stop() {
    this.active = false;
    await this.session?.stop();
    this.session = null;
  }

  isActive() {
    return this.active;
  }
}

export class NoopLiveAgentLayer implements BrowserLiveAgentLayer {
  readonly name = 'noop-live-agent';
  async startWithText(text: string) {
    throw new Error(`Live agent is not configured. Text was: ${text}`);
  }
  stop() {}
  isActive() { return false; }
}
