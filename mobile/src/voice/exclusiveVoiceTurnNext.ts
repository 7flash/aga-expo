import { openYouTubeFromVoice, isYouTubeRequest } from '../media/browserYouTubeSkill';
import { startLiveAgentExclusively } from './liveAgentGate';

export type ExclusiveRouteDecision =
  | { kind: 'direct_tool'; tool: 'play_youtube' | 'get_time' | 'media_control'; args: Record<string, unknown> }
  | { kind: 'short_gpt'; text: string }
  | { kind: 'live_agent'; text: string; reason: string }
  | { kind: 'ignore'; reason: string };

export type ExclusiveTurnHooks = {
  log?: (event: Record<string, unknown>) => void;
  speak?: (text: string) => Promise<void>;
  startLiveAgent?: (text: string, reason: string) => Promise<void>;
  runShortGpt?: (text: string) => Promise<string>;
};

let activeTurn: string | null = null;

export function decideExclusiveRoute(text: string): ExclusiveRouteDecision {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  const lower = clean.toLowerCase();

  if (!clean) return { kind: 'ignore', reason: 'empty_text' };

  if (/\b(stop|quiet|cancel|shush|hush)\b/.test(lower)) {
    return { kind: 'direct_tool', tool: 'media_control', args: { command: 'stop' } };
  }

  if (/\b(pause|hold)\b/.test(lower)) {
    return { kind: 'direct_tool', tool: 'media_control', args: { command: 'pause' } };
  }

  if (/\b(resume|continue)\b/.test(lower)) {
    return { kind: 'direct_tool', tool: 'media_control', args: { command: 'resume' } };
  }

  if (isYouTubeRequest(clean)) {
    return { kind: 'direct_tool', tool: 'play_youtube', args: { query: clean, forceYouTube: true } };
  }

  if (/\b(what time is it|current time|time now|tell me the time)\b/.test(lower)) {
    return { kind: 'direct_tool', tool: 'get_time', args: { format: 'spoken' } };
  }

  if (/\b(start live conversation|live conversation|conversation mode|let'?s talk|stay with me|talk with me)\b/.test(lower)) {
    return { kind: 'live_agent', text: clean, reason: 'explicit_user_request' };
  }

  return { kind: 'short_gpt', text: clean };
}

function localTime() {
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  }).format(new Date());
}

export async function runExclusiveVoiceTurnNext(text: string, hooks: ExclusiveTurnHooks = {}, options: { forceRoute?: ExclusiveRouteDecision['kind'] } = {}) {
  const turnId = `turn_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  if (activeTurn) {
    hooks.log?.({ turnId, stage: 'rejected', reason: 'active_turn', activeTurn, text });
    return { ok: false, turnId, reason: 'Another turn is already active.' };
  }

  activeTurn = turnId;
  hooks.log?.({ turnId, stage: 'received', text });

  try {
    let decision = decideExclusiveRoute(text);
    if (options.forceRoute === 'live_agent') decision = { kind: 'live_agent', text, reason: 'forced_lab_button' };
    if (options.forceRoute === 'short_gpt') decision = { kind: 'short_gpt', text };

    hooks.log?.({ turnId, stage: 'route_decided', route: decision.kind, decision });

    if (decision.kind === 'ignore') {
      hooks.log?.({ turnId, stage: 'ignored', reason: decision.reason });
      return { ok: true, turnId, decision };
    }

    if (decision.kind === 'direct_tool') {
      if (decision.tool === 'play_youtube') {
        const result = await openYouTubeFromVoice(String(decision.args.query || text));
        hooks.log?.({ turnId, stage: 'tool_executed', tool: 'play_youtube', result });
        await hooks.speak?.(result.message);
        return { ok: true, turnId, decision, result };
      }

      if (decision.tool === 'get_time') {
        const result = `It is ${localTime()}.`;
        hooks.log?.({ turnId, stage: 'tool_executed', tool: 'get_time', result });
        await hooks.speak?.(result);
        return { ok: true, turnId, decision, result };
      }

      if (decision.tool === 'media_control') {
        const result = `Media ${decision.args.command || 'control'} requested.`;
        hooks.log?.({ turnId, stage: 'tool_executed', tool: 'media_control', result });
        await hooks.speak?.(result);
        return { ok: true, turnId, decision, result };
      }
    }

    if (decision.kind === 'live_agent') {
      await startLiveAgentExclusively(turnId, decision.reason, async () => {
        if (!hooks.startLiveAgent) throw new Error('No live-agent starter is wired in this lab/screen.');
        await hooks.startLiveAgent(decision.text, decision.reason);
      });
      hooks.log?.({ turnId, stage: 'live_started', reason: decision.reason });
      return { ok: true, turnId, decision };
    }

    if (decision.kind === 'short_gpt') {
      const reply = hooks.runShortGpt ? await hooks.runShortGpt(decision.text) : `Short GPT route selected for: ${decision.text}`;
      hooks.log?.({ turnId, stage: 'short_gpt_result', reply });
      await hooks.speak?.(reply);
      return { ok: true, turnId, decision, result: reply };
    }

    return { ok: false, turnId, reason: 'Unhandled decision.' };
  } finally {
    activeTurn = null;
    hooks.log?.({ turnId, stage: 'turn_released' });
  }
}
