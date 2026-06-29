import { decideVoiceRoute, type ForcedRoute, type RouteDecision } from './routeDecision';
import { addTurnLog } from './turnLogStore';
import { markAssistantSpeaking, publishVoiceTelemetry } from './voiceTelemetryStore';

export type ExclusiveVoiceTurnOptions = {
  forceRoute?: ForcedRoute;
  allowAutoLive?: boolean;
  source?: string;
  speak?: boolean;
};

export type ExclusiveVoiceTurnResult = {
  turnId: string;
  decision: RouteDecision;
  text?: string;
  raw?: unknown;
};

type Deps = {
  speakText?: (text: string) => Promise<unknown> | unknown;
  stopTts?: () => Promise<unknown> | unknown;
  startLiveAgent?: (text: string, reason: string) => Promise<unknown> | unknown;
  stopLiveAgent?: () => Promise<unknown> | unknown;
  openSettingsMenu?: (category?: string) => Promise<string> | string;
  runWeather?: () => Promise<string> | string;
};

let deps: Deps = {};
let activeTurnId: string | null = null;
let lastText = '';
let lastAt = 0;
let seq = 0;

function turnId() {
  return `turn_${Date.now()}_${++seq}`;
}

function normalize(text: unknown) {
  return String(text ?? '').replace(/\s+/g, ' ').trim();
}

function isBrowser() {
  return typeof window !== 'undefined';
}

export function setExclusiveVoiceTurnDeps(next: Deps) {
  deps = { ...deps, ...next };
}

export function getActiveExclusiveTurnId() {
  return activeTurnId;
}

export function canStartVoiceTurn() {
  return !activeTurnId;
}

async function loadDefaultTts() {
  if (deps.speakText) return deps.speakText;
  try {
    const mod: any = await import('./tts');
    if (typeof mod.speakText === 'function') {
      deps.speakText = mod.speakText;
      return deps.speakText;
    }
  } catch {}
  return async (text: string) => {
    if (isBrowser() && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      await new Promise<void>((resolve) => {
        const utterance = new SpeechSynthesisUtterance(text);
        utterance.onend = () => resolve();
        utterance.onerror = () => resolve();
        window.speechSynthesis.speak(utterance);
      });
    }
  };
}

async function loadDefaultStopTts() {
  if (deps.stopTts) return deps.stopTts;
  try {
    const mod: any = await import('./tts');
    if (typeof mod.stopTts === 'function') {
      deps.stopTts = mod.stopTts;
      return deps.stopTts;
    }
  } catch {}
  return async () => {
    if (isBrowser() && 'speechSynthesis' in window) window.speechSynthesis.cancel();
  };
}

async function say(turnIdValue: string, text: string, enabled = true) {
  if (!enabled || !text) return;
  addTurnLog({ turnId: turnIdValue, stage: 'tts_started', speaker: 'assistant', text });
  publishVoiceTelemetry({ phase: 'speaking', assistantSpeaking: true, micOpen: false, canAcceptUserSpeech: false, reply: text, status: 'AGA speaking — mic paused' });
  markAssistantSpeaking(true, 'AGA speaking — mic paused');
  try {
    const speakText = await loadDefaultTts();
    await speakText(text);
  } finally {
    addTurnLog({ turnId: turnIdValue, stage: 'tts_done', speaker: 'assistant', text });
    markAssistantSpeaking(false, 'speech complete — settling');
    setTimeout(() => {
      if (!activeTurnId) publishVoiceTelemetry({ phase: 'wake_listening', micOpen: true, canAcceptUserSpeech: true, assistantSpeaking: false, status: 'your turn — mic open' });
    }, 350);
  }
}

function localTimeSpoken() {
  const now = new Date();
  return `It is ${now.toLocaleString(undefined, { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })}.`;
}

function openYoutube(query: unknown) {
  const q = normalize(query) || 'calm music';
  if (isBrowser()) {
    const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(q)}`;
    window.open(url, '_blank', 'noopener,noreferrer');
  }
  return `Opening YouTube for ${q}.`;
}

async function runDirectTool(turnIdValue: string, decision: Extract<RouteDecision, { kind: 'direct_tool' }>) {
  addTurnLog({ turnId: turnIdValue, stage: 'tool_selected', route: 'direct_tool', toolName: decision.tool, raw: decision });
  publishVoiceTelemetry({ phase: 'tool_call', micOpen: false, canAcceptUserSpeech: false, status: `using ${decision.tool}` });

  let result = 'Done.';

  if (decision.tool === 'stop') {
    await (await loadDefaultStopTts())();
    await deps.stopLiveAgent?.();
    result = 'Stopped.';
  } else if (decision.tool === 'get_time') {
    result = localTimeSpoken();
  } else if (decision.tool === 'play_youtube') {
    result = openYoutube(decision.args.query);
  } else if (decision.tool === 'media_control') {
    result = `${decision.args.command ?? 'media'} command sent.`;
    try {
      const mod: any = await import('../media/mediaController');
      if (decision.args.command === 'pause') await mod.pauseMedia?.();
      if (decision.args.command === 'resume') await mod.resumeMedia?.();
      if (decision.args.command === 'stop') await mod.stopMedia?.();
    } catch {}
  } else if (decision.tool === 'show_settings_menu') {
    result = await Promise.resolve(deps.openSettingsMenu?.(String(decision.args.category || 'main')) ?? 'Opening settings menu.');
  } else if (decision.tool === 'get_weather') {
    result = await Promise.resolve(deps.runWeather?.() ?? 'Weather is not connected in this lab yet.');
  }

  addTurnLog({ turnId: turnIdValue, stage: 'tool_executed', route: 'direct_tool', toolName: decision.tool, text: result, raw: decision });
  return result;
}

async function runShortGpt(turnIdValue: string, text: string) {
  addTurnLog({ turnId: turnIdValue, stage: 'short_gpt_started', route: 'short_gpt', speaker: 'user', text });
  publishVoiceTelemetry({ phase: 'thinking', micOpen: false, canAcceptUserSpeech: false, status: 'thinking with short GPT route' });

  try {
    const apiKey = String((process as any)?.env?.EXPO_PUBLIC_OPENAI_API_KEY || '').trim();
    const endpoint = String((process as any)?.env?.EXPO_PUBLIC_AGA_REASONING_ENDPOINT || '').trim();

    if (endpoint) {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, turnId: turnIdValue }),
      });
      const data = await res.json().catch(() => ({}));
      const reply = normalize(data.reply || data.text || data.output || 'I heard you, but I did not get a clean response.');
      addTurnLog({ turnId: turnIdValue, stage: 'short_gpt_done', route: 'short_gpt', speaker: 'assistant', text: reply, raw: data });
      return reply;
    }

    if (!apiKey) {
      const reply = 'I can route tools locally, but the short GPT endpoint is not configured.';
      addTurnLog({ turnId: turnIdValue, stage: 'short_gpt_done', route: 'short_gpt', speaker: 'assistant', text: reply });
      return reply;
    }

    const res = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: String((process as any)?.env?.EXPO_PUBLIC_OPENAI_REASONING_MODEL || 'gpt-4.1-mini'),
        input: [
          { role: 'system', content: 'You are AGA. Keep replies short, voice-first, helpful, and clear.' },
          { role: 'user', content: text },
        ],
      }),
    });
    const data = await res.json().catch(() => ({}));
    const reply = normalize(data.output_text || data.text || data.output?.[0]?.content?.[0]?.text || data.error?.message || 'I could not get a clean response.');
    addTurnLog({ turnId: turnIdValue, stage: 'short_gpt_done', route: 'short_gpt', speaker: 'assistant', text: reply, raw: data });
    return reply;
  } catch (error) {
    const reply = `Short GPT route failed: ${error instanceof Error ? error.message : String(error)}`;
    addTurnLog({ turnId: turnIdValue, stage: 'error', route: 'short_gpt', text: reply, raw: error });
    return reply;
  }
}

async function startLiveAgent(turnIdValue: string, text: string, reason: string) {
  addTurnLog({ turnId: turnIdValue, stage: 'live_started', route: 'live_agent', speaker: 'user', text, raw: { reason } });
  publishVoiceTelemetry({ phase: 'live_session', micOpen: true, canAcceptUserSpeech: true, status: `live conversation started: ${reason}` });
  if (deps.startLiveAgent) {
    await deps.startLiveAgent(text, reason);
    return 'Live conversation started.';
  }
  try {
    const mod: any = await import('./browserAppliance/browserVoiceAppliance');
    const agent = mod.createLiveLayerFromEnv?.();
    if (agent?.startWithText) {
      await agent.startWithText(text);
      return 'Live conversation started.';
    }
  } catch {}
  return 'Live conversation is selected, but the live agent layer is not configured.';
}

async function startGuided(turnIdValue: string, decision: Extract<RouteDecision, { kind: 'guided_session' }>) {
  addTurnLog({ turnId: turnIdValue, stage: 'tool_selected', route: 'guided_session', toolName: decision.session, text: decision.goal });
  publishVoiceTelemetry({ phase: 'guided_session', micOpen: true, canAcceptUserSpeech: true, status: `guided session: ${decision.session}` });
  return `Starting ${String(decision.session).replace(/_/g, ' ')}. Say stop anytime.`;
}

export async function runExclusiveVoiceTurn(input: unknown, options: ExclusiveVoiceTurnOptions = {}): Promise<ExclusiveVoiceTurnResult> {
  const text = normalize(input);
  const now = Date.now();

  if (!text) {
    const id = activeTurnId ?? turnId();
    addTurnLog({ turnId: id, stage: 'ignored', text: '', raw: { reason: 'empty_text' } });
    return { turnId: id, decision: { kind: 'ignore', reason: 'empty_text' } };
  }

  if (text === lastText && now - lastAt < 1500) {
    const id = activeTurnId ?? turnId();
    addTurnLog({ turnId: id, stage: 'deduped', text, raw: { previousText: lastText, ageMs: now - lastAt } });
    return { turnId: id, decision: { kind: 'ignore', reason: 'duplicate_final_transcript' } };
  }

  if (activeTurnId) {
    addTurnLog({ turnId: activeTurnId, stage: 'ignored', text, raw: { reason: 'turn_already_active' } });
    return { turnId: activeTurnId, decision: { kind: 'ignore', reason: 'turn_already_active' } };
  }

  lastText = text;
  lastAt = now;
  const id = turnId();
  activeTurnId = id;

  addTurnLog({ turnId: id, stage: 'received', speaker: 'user', text, raw: { source: options.source || 'unknown' } });
  publishVoiceTelemetry({ phase: 'thinking', transcript: text, micOpen: false, canAcceptUserSpeech: false, assistantSpeaking: false, status: 'turn received — deciding route' });

  const decision = decideVoiceRoute(text, { forceRoute: options.forceRoute, allowAutoLive: options.allowAutoLive });
  addTurnLog({ turnId: id, stage: 'route_decided', route: decision.kind, text, raw: decision });

  let output = '';
  try {
    if (decision.kind === 'ignore') return { turnId: id, decision };
    if (decision.kind === 'direct_tool') output = await runDirectTool(id, decision);
    else if (decision.kind === 'short_gpt') output = await runShortGpt(id, decision.text);
    else if (decision.kind === 'live_agent') output = await startLiveAgent(id, decision.text, decision.reason);
    else if (decision.kind === 'guided_session') output = await startGuided(id, decision);

    if (decision.kind !== 'live_agent') await say(id, output, options.speak !== false);
    return { turnId: id, decision, text: output };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    addTurnLog({ turnId: id, stage: 'error', route: decision.kind, text: message, raw: error });
    publishVoiceTelemetry({ phase: 'error', error: message, status: message, micOpen: true, canAcceptUserSpeech: true });
    if (options.speak !== false) await say(id, `Something broke: ${message}`);
    return { turnId: id, decision, text: message, raw: error };
  } finally {
    activeTurnId = null;
    if (decision.kind !== 'live_agent') {
      publishVoiceTelemetry({ phase: 'wake_listening', micOpen: true, canAcceptUserSpeech: true, assistantSpeaking: false, commandWindowActive: false, status: 'your turn — mic open' });
    }
  }
}
