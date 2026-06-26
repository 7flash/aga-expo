import { runGpt5ToolTurn } from '../ai/gpt5ToolTurn';
import { transcribeWithOpenAI } from '../ai/openaiStt';
import { createShortUtteranceRecorder, shortUtteranceCaptureMs, type ShortUtteranceRecorder } from '../voice/shortUtteranceRecorder';
import { speakShortReply } from '../voice/speechOut';
import { subconsciousRecall } from '../memory/subconsciousRag';
import { logEvent, type Preferences } from '../db/localStore';
import type { JsonObject } from './capabilityRegistry';

export type ShortReasoningTurnContext = {
  getPrefs: () => Preferences | null;
  runCapability: (name: string, args: JsonObject) => Promise<string>;
  publish?: (patch: Record<string, unknown>) => void;
};

function env(name: string) {
  return process.env?.[name] ?? '';
}

function numberEnv(name: string, fallback: number) {
  const n = Number(env(name));
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function truncateForVoice(text: string) {
  const max = numberEnv('EXPO_PUBLIC_AGA_SHORT_REPLY_MAX_CHARS', 420);
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1).trim()}…`;
}

export async function answerShortTextWithGpt5(text: string, ctx: ShortReasoningTurnContext) {
  const clean = String(text || '').trim();
  if (!clean) return '';
  ctx.publish?.({ mode: 'thinking', speechStatus: 'thinking with tools', heardText: clean });
  const recall = await subconsciousRecall(clean).catch(() => null);
  const memories = recall?.memories?.map((m: any) => String(m.text || m)) || [];
  await logEvent('turn.gpt5_tools.start', clean.slice(0, 240)).catch(() => undefined);
  const reply = await runGpt5ToolTurn({
    text: clean,
    prefs: ctx.getPrefs(),
    memories,
    runTool: ctx.runCapability,
  });
  const spoken = truncateForVoice(reply);
  ctx.publish?.({ mode: 'speaking', speechStatus: spoken.slice(0, 96), interim: '', heardText: clean });
  await speakShortReply(spoken, 'warm');
  await logEvent('turn.gpt5_tools.reply', spoken.slice(0, 240)).catch(() => undefined);
  return spoken;
}

export class ShortReasoningAudioTurn {
  private recorder: ShortUtteranceRecorder | null = null;
  private ctx: ShortReasoningTurnContext;
  private stopped = false;

  constructor(ctx: ShortReasoningTurnContext) {
    this.ctx = ctx;
  }

  getDiagnostics() {
    return { recorder: this.recorder?.getDiagnostics?.(), captureMs: shortUtteranceCaptureMs() };
  }

  async start() {
    if (this.recorder) return;
    this.stopped = false;
    this.recorder = createShortUtteranceRecorder();
    this.ctx.publish?.({ mode: 'listening', speechStatus: 'listening for short request' });
    await this.recorder.start();
  }

  async cancel() {
    this.stopped = true;
    const recorder = this.recorder;
    this.recorder = null;
    await recorder?.cancel?.();
  }

  async stopAndAnswer() {
    if (this.stopped) return '';
    this.stopped = true;
    const recorder = this.recorder;
    this.recorder = null;
    if (!recorder) return '';
    this.ctx.publish?.({ mode: 'thinking', speechStatus: 'transcribing short request' });
    const audio = await recorder.stop();
    if (!audio) throw new Error('No short utterance audio was captured.');
    const text = await transcribeWithOpenAI(audio);
    this.ctx.publish?.({ heardText: text, interim: text, speechStatus: `heard: ${text.slice(0, 54)}` });
    return answerShortTextWithGpt5(text, this.ctx);
  }
}
