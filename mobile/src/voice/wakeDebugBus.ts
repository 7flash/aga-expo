import {
  browserVoicePhaseLabel,
  browserVoiceShouldIgnoreWake,
  getBrowserVoiceState,
  markWakeDetected,
} from './browserVoiceActivityState';

export type WakeDebugEvent =
  | { type: 'status'; provider?: string; message: string; at: number }
  | { type: 'audio'; provider?: string; rms: number; peak: number; frames: number; at: number }
  | { type: 'keyword'; provider?: string; keyword: string; index?: number; confidence?: number; raw?: unknown; at: number }
  | { type: 'transcript'; provider?: string; text: string; phase: 'post-wake' | 'stt' | 'live' | 'debug'; raw?: unknown; at: number }
  | { type: 'error'; provider?: string; message: string; raw?: unknown; at: number };

type Listener = (event: WakeDebugEvent) => void;

const listeners = new Set<Listener>();
const recent: WakeDebugEvent[] = [];

let browserUiStarted = false;
let bridgePromise: Promise<void> | null = null;
let lastAudio: Extract<WakeDebugEvent, { type: 'audio' }> | null = null;
let lastKeyword: Extract<WakeDebugEvent, { type: 'keyword' }> | null = null;
let lastTranscript: Extract<WakeDebugEvent, { type: 'transcript' }> | null = null;
let lastError: Extract<WakeDebugEvent, { type: 'error' }> | null = null;

let audioGateLoudSince = 0;
let audioGateLastWakeAt = 0;
let audioGateLastStatusAt = 0;

const CLEAN_HINT = 'Speak clearly to wake AGA. Then say your command.';

function now() {
  return Date.now();
}

function numEnv(name: string, fallback: number) {
  const value = Number((process as any)?.env?.[name]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function dispatchBrowserEvent(name: string, detail: unknown) {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(new CustomEvent(name, { detail }));
  } catch {}
}

function bootBrowserBridge() {
  if (typeof window === 'undefined') return Promise.resolve();

  if (!bridgePromise) {
    bridgePromise = import('./browserWakeToTranscriptBridge')
      .then((mod) => {
        mod.ensureBrowserWakeToTranscriptBridge?.();
      })
      .catch((error) => {
        console.warn('[aga:wake-debug] failed to boot browser wake transcript bridge', error);
      });
  }

  return bridgePromise;
}

function autoWakeFromAudio(event: Extract<WakeDebugEvent, { type: 'audio' }>) {
  if (typeof window === 'undefined') return;

  // If the real KWS runtime also emits a keyword, fine. This fallback exists
  // because the current Sherpa KWS vocabulary cannot encode useful wake words,
  // but we still have reliable mic energy frames in browser preview.
  const t = now();

  const threshold = numEnv('EXPO_PUBLIC_AGA_WEB_AUDIO_WAKE_RMS', 0.028);
  const peakThreshold = numEnv('EXPO_PUBLIC_AGA_WEB_AUDIO_WAKE_PEAK', 0.18);
  const holdMs = numEnv('EXPO_PUBLIC_AGA_WEB_AUDIO_WAKE_HOLD_MS', 420);
  const cooldownMs = numEnv('EXPO_PUBLIC_AGA_WEB_AUDIO_WAKE_COOLDOWN_MS', 6500);

  const loud = event.rms >= threshold || event.peak >= peakThreshold;

  if (!loud) {
    audioGateLoudSince = 0;
    return;
  }

  if (!audioGateLoudSince) audioGateLoudSince = t;

  if (browserVoiceShouldIgnoreWake()) {
    if (t - audioGateLastStatusAt > 1600) {
      audioGateLastStatusAt = t;
      push({
        type: 'status',
        provider: 'wake-debug-audio-gate',
        message: 'audio wake muted while AGA is listening/thinking/speaking',
        at: t,
      });
    }
    return;
  }

  if (t - audioGateLoudSince < holdMs) return;
  if (t - audioGateLastWakeAt < cooldownMs) return;

  audioGateLastWakeAt = t;
  audioGateLoudSince = 0;

  const confidence = Math.max(
    0.1,
    Math.min(1, Math.max(event.rms / Math.max(0.001, threshold), event.peak / Math.max(0.001, peakThreshold)) / 3),
  );

  markWakeDetected('browser audio gate');

  push({
    type: 'keyword',
    provider: 'wake-debug-audio-gate',
    keyword: 'aga',
    confidence,
    raw: {
      rms: event.rms,
      peak: event.peak,
      frames: event.frames,
      note: 'browser preview uses loud/sustained audio wake until Sherpa ASR replaces KWS',
    },
    at: t,
  });
}

function push(event: WakeDebugEvent) {
  recent.push(event);
  if (recent.length > 180) recent.shift();

  if (event.type === 'audio') {
    lastAudio = event;
    // Run after lastAudio is updated. This emits a synthetic keyword when the
    // waveform proves the user is speaking loudly enough.
    autoWakeFromAudio(event);
  }

  if (event.type === 'keyword') {
    lastKeyword = event;
    bootBrowserBridge().then(() => {
      dispatchBrowserEvent('aga:wakeKeyword', event);
      // Replay once to avoid async import race.
      setTimeout(() => dispatchBrowserEvent('aga:wakeKeyword', event), 120);
    });
  }

  if (event.type === 'transcript') {
    lastTranscript = event;
    dispatchBrowserEvent('aga:wakeTranscript', event);
  }

  if (event.type === 'error') lastError = event;

  dispatchBrowserEvent('aga:wakeDebug', event);
  startBrowserWakeUi();

  for (const listener of Array.from(listeners)) {
    try {
      listener(event);
    } catch (error) {
      console.warn('[aga:wake-debug] listener failed', error);
    }
  }
}

export function emitWakeDebug(event: Omit<WakeDebugEvent, 'at'> & { at?: number }) {
  push({ ...event, at: event.at || now() } as WakeDebugEvent);
}

export function subscribeWakeDebug(listener: Listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getRecentWakeDebugEvents() {
  return recent.slice();
}

function startBrowserWakeUi() {
  if (browserUiStarted) return;
  if (typeof document === 'undefined') return;

  browserUiStarted = true;
  bootBrowserBridge();

  document.querySelectorAll('[data-aga-wake-ui-style]').forEach((el) => el.remove());
  document.getElementById('aga-wake-waveform-root')?.remove();

  const style = document.createElement('style');
  style.setAttribute('data-aga-wake-ui-style', '1');
  style.textContent = `
    #aga-wake-waveform-root {
      position: fixed;
      left: 18px;
      right: 18px;
      bottom: 18px;
      min-height: 174px;
      z-index: 2147483647;
      box-sizing: border-box;
      padding: 14px 18px 15px;
      border: 1px solid rgba(90, 245, 255, 0.84);
      border-radius: 20px;
      background: linear-gradient(180deg, rgba(2, 17, 20, 0.97), rgba(0, 7, 9, 0.97));
      box-shadow: 0 0 26px rgba(70, 245, 255, 0.38), inset 0 0 18px rgba(80, 245, 255, 0.08);
      color: #d9ffff;
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      pointer-events: none;
    }
    #aga-wake-waveform-root * { box-sizing: border-box; }
    .aga-wake-top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 10px; }
    .aga-wake-title { color: #66f7ff; font-size: 12px; font-weight: 950; letter-spacing: 4px; text-transform: uppercase; }
    .aga-wake-badge {
      border-radius: 999px;
      padding: 5px 12px;
      background: rgba(100, 230, 240, 0.14);
      color: #9cecf4;
      font-size: 11px;
      font-weight: 950;
      letter-spacing: 1.3px;
      text-transform: uppercase;
    }
    .aga-wake-badge.on { background: #66f7ff; color: #031416; }
    .aga-wake-badge.command { background: #ffd06e; color: #141006; }
    .aga-wake-badge.thinking { background: #b594ff; color: #11091d; }
    .aga-wake-badge.speaking { background: #ffcb66; color: #150f04; }
    .aga-wake-bars { height: 76px; display: flex; align-items: center; justify-content: space-between; gap: 5px; margin-bottom: 9px; }
    .aga-wake-bar {
      flex: 1 1 auto;
      max-width: 7px;
      min-width: 3px;
      border-radius: 999px;
      background: #5df5ff;
      box-shadow: 0 0 10px rgba(93,245,255,.85);
      opacity: .42;
      transition: height 80ms linear, opacity 80ms linear;
    }
    .aga-wake-meter { height: 7px; border-radius: 999px; overflow: hidden; background: rgba(120, 220, 230, 0.17); margin-bottom: 9px; }
    .aga-wake-fill { height: 100%; width: 0%; border-radius: 999px; background: #5df5ff; box-shadow: 0 0 10px rgba(93,245,255,.95); transition: width 80ms linear; }
    .aga-wake-primary { color: #ffd06e; font-size: 15px; font-weight: 950; margin-bottom: 5px; }
    .aga-wake-detail { color: #bdf8ff; font-size: 12px; font-weight: 850; margin-top: 2px; }
    .aga-wake-transcript { color: #ffffff; font-size: 13px; font-weight: 900; margin-top: 4px; }
    .aga-wake-reply { color: #ffd06e; font-size: 13px; font-weight: 950; margin-top: 4px; }
    .aga-wake-error { color: #ff6b83; font-size: 12px; font-weight: 900; margin-top: 4px; }
  `;
  document.head.appendChild(style);

  const root = document.createElement('div');
  root.id = 'aga-wake-waveform-root';
  root.innerHTML = `
    <div class="aga-wake-top">
      <div class="aga-wake-title">MIC LIVE</div>
      <div class="aga-wake-badge">WAITING FOR VOICE</div>
    </div>
    <div class="aga-wake-bars"></div>
    <div class="aga-wake-meter"><div class="aga-wake-fill"></div></div>
    <div class="aga-wake-primary" data-aga-wake-hint>${CLEAN_HINT}</div>
    <div class="aga-wake-detail" data-aga-wake-stats>no mic frames yet</div>
    <div class="aga-wake-detail" data-aga-wake-keyword>wake trigger starts command capture; full words appear after wake/STT</div>
    <div class="aga-wake-transcript" data-aga-wake-transcript style="display:none"></div>
    <div class="aga-wake-reply" data-aga-wake-reply style="display:none"></div>
    <div class="aga-wake-error" data-aga-wake-error style="display:none"></div>
  `;

  const bars = root.querySelector('.aga-wake-bars') as HTMLElement;
  for (let i = 0; i < 36; i += 1) {
    const bar = document.createElement('div');
    bar.className = 'aga-wake-bar';
    bar.style.height = '8px';
    bars.appendChild(bar);
  }

  document.body.appendChild(root);

  let tick = 0;
  const render = () => {
    tick += 1;
    scrubOldText();

    const t = now();
    const state = getBrowserVoiceState();
    const phase = browserVoicePhaseLabel();
    const audioAlive = !!lastAudio && t - lastAudio.at < 1800;
    const rms = lastAudio?.rms ?? 0;
    const peak = lastAudio?.peak ?? 0;
    const level = Math.max(0, Math.min(1, Math.max(rms * 18, peak * 4)));

    const badge = root.querySelector('.aga-wake-badge') as HTMLElement;

    badge.classList.remove('on', 'command', 'thinking', 'speaking');

    if (phase === 'COMMAND WINDOW') {
      badge.textContent = 'COMMAND WINDOW';
      badge.classList.add('command');
    } else if (phase === 'THINKING') {
      badge.textContent = 'THINKING';
      badge.classList.add('thinking');
    } else if (phase === 'SPEAKING') {
      badge.textContent = 'SPEAKING';
      badge.classList.add('speaking');
    } else if (audioAlive) {
      badge.textContent = 'HEARING AUDIO';
      badge.classList.add('on');
    } else {
      badge.textContent = 'WAITING FOR VOICE';
    }

    const barEls = Array.from(root.querySelectorAll('.aga-wake-bar')) as HTMLElement[];
    barEls.forEach((bar, i) => {
      const wave = Math.sin((i / barEls.length) * Math.PI * 2 + tick * 0.25) * 0.5 + 0.5;
      const pulse = Math.sin((i / barEls.length) * Math.PI * 5 - tick * 0.17) * 0.5 + 0.5;
      const h = 8 + Math.round((wave * 0.72 + pulse * 0.28) * (16 + level * 62));
      bar.style.height = `${h}px`;
      bar.style.opacity = String(0.28 + Math.min(1, level + 0.24 + i / barEls.length * 0.16) * 0.72);
    });

    const fill = root.querySelector('.aga-wake-fill') as HTMLElement;
    fill.style.width = `${Math.round(level * 100)}%`;

    const stats = root.querySelector('[data-aga-wake-stats]') as HTMLElement;
    stats.textContent = lastAudio
      ? `rms ${(rms * 100).toFixed(1)} · peak ${(peak * 100).toFixed(1)} · frames ${lastAudio.frames}`
      : 'no mic frames yet';

    const keyword = root.querySelector('[data-aga-wake-keyword]') as HTMLElement;
    if (phase) {
      const reason = state.reason ? ` · ${state.reason}` : '';
      keyword.textContent = `${phase.toLowerCase()}${reason}`;
    } else if (lastKeyword && t - lastKeyword.at < 14000) {
      keyword.textContent = `wake detected · ${phase === 'COMMAND WINDOW' ? 'say your command now' : 'ready'}`;
    } else {
      keyword.textContent = 'sustained voice wakes AGA; full words appear after wake/STT';
    }

    const transcript = root.querySelector('[data-aga-wake-transcript]') as HTMLElement;
    const transcriptText = lastTranscript?.text || state.lastTranscript;

    if (transcriptText && (lastTranscript ? t - lastTranscript.at < 20000 : true)) {
      transcript.style.display = 'block';
      transcript.textContent = `heard: ${transcriptText}`;
    } else {
      transcript.style.display = 'none';
    }

    const reply = root.querySelector('[data-aga-wake-reply]') as HTMLElement;
    if (state.lastReply) {
      reply.style.display = 'block';
      reply.textContent = `AGA: ${state.lastReply.slice(0, 150)}`;
    } else {
      reply.style.display = 'none';
    }

    const err = root.querySelector('[data-aga-wake-error]') as HTMLElement;

    if (lastError && t - lastError.at < 7000) {
      err.style.display = 'block';
      err.textContent = lastError.message;
    } else {
      err.style.display = 'none';
    }

    requestAnimationFrame(render);
  };

  requestAnimationFrame(render);
}

function scrubOldText() {
  if (typeof document === 'undefined') return;

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const replacements: Array<[RegExp, string]> = [
    [/Current Sherpa vocab cannot encode HEY\/AGA. Speak clearly to wake browser preview./g, CLEAN_HINT],
    [/Current Sherpa vocabulary cannot encode HEY\/AGA. Speak clearly to wake browser preview./g, CLEAN_HINT],
    [/TACTILE NEURAL RELIC/g, 'VOICE WAKE CONSOLE'],
    [/Tactile Neural Relic/g, 'Voice Wake Console'],
    [/tactile neural relic/g, 'voice wake console'],
    [/relic core/g, 'AGA'],
    [/develop patina/g, 'show live mic activity'],
    [/Voice commands mechanically actuate[^.]+./g, 'Microphone is live. Wake trigger starts AGA; full words appear after wake.'],
  ];

  let node: Node | null;

  while ((node = walker.nextNode())) {
    const textNode = node as Text;
    let value = textNode.nodeValue || '';
    const before = value;

    for (const [pattern, replacement] of replacements) value = value.replace(pattern, replacement);

    if (value !== before) textNode.nodeValue = value;
  }
}

declare global {
  interface Window {
    __AGA_WAKE_DEBUG?: () => WakeDebugEvent[];
    __AGA_FORCE_AUDIO_WAKE?: () => void;
  }
}

if (typeof window !== 'undefined') {
  window.__AGA_WAKE_DEBUG = getRecentWakeDebugEvents;
  window.__AGA_FORCE_AUDIO_WAKE = () => {
    push({
      type: 'keyword',
      provider: 'manual',
      keyword: 'aga',
      confidence: 1,
      raw: { manual: true },
      at: now(),
    });
  };
  setTimeout(startBrowserWakeUi, 0);
}