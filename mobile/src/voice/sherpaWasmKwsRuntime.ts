import { diagnoseSherpaWasmBrowserRuntime } from './sherpaWasmRuntimeDiagnostics';
import { emitWakeDebug } from './wakeDebugBus';

import { browserVoiceShouldIgnoreWake, markWakeDetected } from './browserVoiceActivityState';

export type SherpaWasmKeywordEvent = {
  id: string;
  phrase: string;
  confidence?: number;
  raw?: unknown;
};

export type SherpaWasmKwsRuntimeOptions = {
  modelBaseUrl?: string;
  runtimeBaseUrl?: string;
  keywords?: string[];
  sampleRate?: number;
  onKeyword: (event: SherpaWasmKeywordEvent) => void;
  onStatus?: (status: string) => void;
};

type WakeAliasManifest = {
  tokenized?: boolean;
  browserWakeFallback?: boolean;
  selectedTrigger?: string | null;
  selectedCanonical?: string;
  reason?: string;
};

const MODEL_BASE = '/sherpa/kws-model';
const DEFAULT_RUNTIME_BASE =
  (typeof process !== 'undefined' && (process as any).env?.EXPO_PUBLIC_AGA_SHERPA_WASM_RUNTIME_BASE) ||
  '/sherpa/runtime/kws';

const RUNTIME_MARKER = 'aga-auto-trigger-v8-sherpa-or-audio-fallback';

const PRELOADED_PATH_SETS = [
  {
    encoder: '/encoder-epoch-12-avg-2-chunk-16-left-64.onnx',
    decoder: '/decoder-epoch-12-avg-2-chunk-16-left-64.onnx',
    joiner: '/joiner-epoch-12-avg-2-chunk-16-left-64.onnx',
    tokens: '/tokens.txt',
  },
  {
    encoder: 'encoder-epoch-12-avg-2-chunk-16-left-64.onnx',
    decoder: 'decoder-epoch-12-avg-2-chunk-16-left-64.onnx',
    joiner: 'joiner-epoch-12-avg-2-chunk-16-left-64.onnx',
    tokens: 'tokens.txt',
  },
  {
    encoder: './encoder-epoch-12-avg-2-chunk-16-left-64.onnx',
    decoder: './decoder-epoch-12-avg-2-chunk-16-left-64.onnx',
    joiner: './joiner-epoch-12-avg-2-chunk-16-left-64.onnx',
    tokens: './tokens.txt',
  },
];

type EmscriptenModule = Record<string, any>;

function emitStatus(options: SherpaWasmKwsRuntimeOptions, status: string) {
  options.onStatus?.(status);
  console.log(`[aga:sherpa-wasm] ${status}`);
  emitWakeDebug({ type: 'status', provider: 'sherpa-wasm', message: status });
}

async function loadScript(url: string) {
  await new Promise<void>((resolve, reject) => {
    const existing = document.querySelector(`script[data-aga-sherpa-kws="${url}"]`);
    if (existing) return resolve();
    const script = document.createElement('script');
    script.src = url;
    script.async = true;
    script.dataset.agaSherpaKws = url;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load Sherpa WASM script: ${url}`));
    document.head.appendChild(script);
  });
}

async function fetchText(url: string) {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Failed to fetch ${url}: HTTP ${response.status}`);
  return response.text();
}

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

function utf8ByteLength(text: string) {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text).length;
  return unescape(encodeURIComponent(text)).length;
}

function makeModule(runtimeBaseUrl: string) {
  let resolveReady!: (module: EmscriptenModule) => void;
  let rejectReady!: (error: Error) => void;
  const ready = new Promise<EmscriptenModule>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });

  const module: EmscriptenModule = {
    noInitialRun: true,
    locateFile: (file: string) => `${runtimeBaseUrl}/${file}`,
    print: (...args: unknown[]) => console.log('[aga:sherpa-wasm]', ...args),
    printErr: (...args: unknown[]) => console.warn('[aga:sherpa-wasm]', ...args),
    onRuntimeInitialized() {
      resolveReady(module);
    },
    onAbort(reason: unknown) {
      rejectReady(new Error(`Sherpa WASM aborted: ${String(reason)}`));
    },
  };

  (globalThis as any).Module = module;
  return { module, ready };
}

async function initModule(runtimeBaseUrl: string) {
  const cached = (globalThis as any).__AGA_SHERPA_KWS_MODULE as EmscriptenModule | undefined;
  if (cached && (cached as any).calledRun) return cached;
  const { module, ready } = makeModule(runtimeBaseUrl);
  await loadScript(`${runtimeBaseUrl}/sherpa-onnx-wasm-kws-main.js`);
  const initialized = await ready;
  (globalThis as any).__AGA_SHERPA_KWS_MODULE = initialized;
  return initialized;
}

async function loadCreateKws(runtimeBaseUrl: string) {
  await loadScript(`${runtimeBaseUrl}/sherpa-onnx-kws.js`);
  const g: any = globalThis as any;
  const createKws = g.createKws || g.Module?.createKws;
  if (typeof createKws !== 'function') {
    const keys = Object.keys(g).filter((key) => /sherpa|onnx|kws|create|module/i.test(key)).slice(0, 120);
    throw new Error(`Sherpa helper loaded but createKws was not exposed. Global keys: ${keys.join(', ') || '(none)'}.`);
  }
  return createKws as (module: EmscriptenModule, config: Record<string, unknown>) => any;
}

function audioStats(samples: Float32Array) {
  let sum = 0;
  let peak = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const abs = Math.abs(samples[i]);
    peak = Math.max(peak, abs);
    sum += samples[i] * samples[i];
  }
  return { rms: Math.sqrt(sum / Math.max(1, samples.length)), peak };
}

function downsampleBuffer(buffer: Float32Array, inputSampleRate: number, outputSampleRate: number) {
  if (outputSampleRate === inputSampleRate) return buffer;
  const ratio = inputSampleRate / outputSampleRate;
  const length = Math.round(buffer.length / ratio);
  const result = new Float32Array(length);
  let offsetResult = 0;
  let offsetBuffer = 0;
  while (offsetResult < result.length) {
    const nextOffsetBuffer = Math.round((offsetResult + 1) * ratio);
    let accum = 0;
    let count = 0;
    for (let i = offsetBuffer; i < nextOffsetBuffer && i < buffer.length; i += 1) {
      accum += buffer[i];
      count += 1;
    }
    result[offsetResult] = count ? accum / count : 0;
    offsetResult += 1;
    offsetBuffer = nextOffsetBuffer;
  }
  return result;
}

function normalizeKeywordResult(result: any, manifest: WakeAliasManifest | null): SherpaWasmKeywordEvent {
  const rawKeyword = String(result?.keyword || result?.text || result?.id || '').trim();
  const alias = rawKeyword.includes('@') ? rawKeyword.split('@').pop() : rawKeyword;
  const phrase = manifest?.selectedCanonical || String(alias || rawKeyword).replace(/^@/, '').trim() || 'aga';
  return {
    id: phrase,
    phrase,
    confidence: typeof result?.confidence === 'number' ? result.confidence : undefined,
    raw: result,
  };
}

function looksRawKeywordFile(text: string) {
  return /\b(hey|hi|hello|yo|ok|okay|yes|go|start|wake|listen|aga|guardian|angel|stop|cancel|abort|quiet|pause|wait|hold)\s+@/i.test(text);
}

function createConfig(paths: typeof PRELOADED_PATH_SETS[number], expectedSampleRate: number, keywordsText: string) {
  return {
    featConfig: { samplingRate: expectedSampleRate, featureDim: 80 },
    modelConfig: {
      transducer: { encoder: paths.encoder, decoder: paths.decoder, joiner: paths.joiner },
      tokens: paths.tokens,
      provider: 'cpu',
      modelType: '',
      numThreads: 1,
      debug: 0,
      modelingUnit: 'bpe',
    },
    maxActivePaths: 4,
    numTrailingBlanks: 1,
    keywordsScore: Number((process as any)?.env?.EXPO_PUBLIC_AGA_SHERPA_KEYWORDS_SCORE || 1.5),
    keywordsThreshold: Number((process as any)?.env?.EXPO_PUBLIC_AGA_SHERPA_KEYWORDS_THRESHOLD || 0.12),
    keywords: '',
    keywordsBuf: keywordsText,
    keywordsBufSize: utf8ByteLength(keywordsText),
  };
}

function createRecognizerWithPreloadedPaths(
  createKws: (module: EmscriptenModule, config: Record<string, unknown>) => any,
  module: EmscriptenModule,
  expectedSampleRate: number,
  keywordsText: string,
) {
  if (!keywordsText.trim()) throw new Error('keywords.txt is empty');
  if (looksRawKeywordFile(keywordsText)) throw new Error('keywords.txt is raw, not tokenized');
  const errors: string[] = [];
  for (const paths of PRELOADED_PATH_SETS) {
    try {
      const recognizer = createKws(module, createConfig(paths, expectedSampleRate, keywordsText));
      if (!recognizer?.createStream) {
        throw new Error(`createKws returned unexpected recognizer. Keys: ${Object.keys(recognizer || {}).join(', ')}`);
      }
      return { recognizer, paths };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${paths.tokens}: ${message}`);
      console.warn('[aga:sherpa-wasm] preloaded path set failed', paths, error);
    }
  }
  throw new Error(`Sherpa createKws failed for every preloaded model path. Failures: ${errors.join(' | ')}`);
}

async function openMicrophone(expectedSampleRate: number) {
  const nav: any = navigator;
  if (!nav.mediaDevices?.getUserMedia) throw new Error('Browser does not expose getUserMedia microphone access.');
  const mediaStream: MediaStream = await nav.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1, sampleRate: expectedSampleRate },
    video: false,
  });
  const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext;
  const audioContext = new AudioCtx({ sampleRate: expectedSampleRate });
  const source = audioContext.createMediaStreamSource(mediaStream);
  const processor = audioContext.createScriptProcessor(4096, 1, 1);
  return { mediaStream, audioContext, source, processor };
}

function startAudioWakeFallbackLoop(
  options: SherpaWasmKwsRuntimeOptions,
  audioContext: AudioContext,
  source: MediaStreamAudioSourceNode,
  processor: ScriptProcessorNode,
  mediaStream: MediaStream,
  expectedSampleRate: number,
  reason: string,
) {
  emitStatus(options, `using browser audio wake fallback: ${reason}`);
  emitWakeDebug({
    type: 'status',
    provider: 'web-audio-wake',
    message: `fallback threshold=${Number((process as any)?.env?.EXPO_PUBLIC_AGA_WEB_AUDIO_WAKE_RMS || 0.018)} holdMs=${Number((process as any)?.env?.EXPO_PUBLIC_AGA_WEB_AUDIO_WAKE_HOLD_MS || 650)} cooldownMs=${Number((process as any)?.env?.EXPO_PUBLIC_AGA_WEB_AUDIO_WAKE_COOLDOWN_MS || 4500)}`,
  });
  let stopped = false;
  let frames = 0;
  let lastAudioDebugAt = 0;
  let zeroGain: GainNode | null = null;
  let aboveSince = 0;
  let lastWakeAt = 0;
  const threshold = Number((process as any)?.env?.EXPO_PUBLIC_AGA_WEB_AUDIO_WAKE_RMS || 0.018);
  const holdMs = Number((process as any)?.env?.EXPO_PUBLIC_AGA_WEB_AUDIO_WAKE_HOLD_MS || 650);
  const cooldownMs = Number((process as any)?.env?.EXPO_PUBLIC_AGA_WEB_AUDIO_WAKE_COOLDOWN_MS || 4500);

  processor.onaudioprocess = (event) => {
    if (stopped) return;
    if ((globalThis as any)?.window?.__AGA_POST_WAKE_ACTIVE || (globalThis as any).__AGA_POST_WAKE_ACTIVE) return;
    if (browserVoiceShouldIgnoreWake()) return;
    let samples = new Float32Array(event.inputBuffer.getChannelData(0));
    samples = downsampleBuffer(samples, audioContext.sampleRate, expectedSampleRate);
    frames += 1;
    const stats = audioStats(samples);
    const now = Date.now();
    if (now - lastAudioDebugAt > 750) {
      lastAudioDebugAt = now;
      emitWakeDebug({ type: 'audio', provider: 'web-audio-wake', rms: stats.rms, peak: stats.peak, frames });
    }
    if (stats.rms >= threshold || stats.peak >= threshold * 3.5) {
      if (!aboveSince) aboveSince = now;
      if (now - aboveSince >= holdMs && now - lastWakeAt >= cooldownMs) {
        lastWakeAt = now;
        aboveSince = 0;
        const wake = { id: 'aga', phrase: 'aga', confidence: Math.min(1, stats.rms / Math.max(0.001, threshold)), raw: { fallback: true, rms: stats.rms, peak: stats.peak, reason } };
        markWakeDetected('web audio wake fallback');
        emitWakeDebug({ type: 'keyword', provider: 'web-audio-wake', keyword: 'aga', confidence: wake.confidence, raw: wake.raw });
        options.onKeyword(wake);
      }
    } else {
      aboveSince = 0;
    }
  };
  source.connect(processor);
  // ScriptProcessor must be connected to run in older browsers, but routing the
  // microphone graph directly to destination can create accidental monitor audio
  // in web preview. Use a silent gain node instead.
  zeroGain = audioContext.createGain();
  zeroGain.gain.value = 0;
  processor.connect(zeroGain);
  zeroGain.connect(audioContext.destination);
  emitStatus(options, 'listening');
  return {
    stop: async () => {
      stopped = true;
      try { processor.disconnect(); } catch {}
      try { zeroGain?.disconnect(); } catch {}
      zeroGain = null;
      try { source.disconnect(); } catch {}
      for (const track of mediaStream.getTracks()) track.stop();
      try { await audioContext.close(); } catch {}
    },
    diagnostics: null,
    runtimeKind: 'web-audio-wake-fallback',
    exportKeys: [],
  };
}

function startSherpaDecodeLoop(
  options: SherpaWasmKwsRuntimeOptions,
  recognizer: any,
  manifest: WakeAliasManifest | null,
  audioContext: AudioContext,
  source: MediaStreamAudioSourceNode,
  processor: ScriptProcessorNode,
  mediaStream: MediaStream,
  expectedSampleRate: number,
) {
  let stopped = false;
  let stream: any = recognizer.createStream();
  let frames = 0;
  let lastAudioDebugAt = 0;
  let zeroGain: GainNode | null = null;
  processor.onaudioprocess = (event) => {
    if (stopped) return;
    if (browserVoiceShouldIgnoreWake()) return;
    let samples = new Float32Array(event.inputBuffer.getChannelData(0));
    samples = downsampleBuffer(samples, audioContext.sampleRate, expectedSampleRate);
    frames += 1;
    const now = Date.now();
    if (now - lastAudioDebugAt > 750) {
      lastAudioDebugAt = now;
      const stats = audioStats(samples);
      emitWakeDebug({ type: 'audio', provider: 'sherpa-wasm', rms: stats.rms, peak: stats.peak, frames });
    }
    stream.acceptWaveform(expectedSampleRate, samples);
    while (recognizer.isReady(stream)) {
      recognizer.decode(stream);
      const result = recognizer.getResult(stream);
      if (result?.keyword && String(result.keyword).length > 0) {
        const normalized = normalizeKeywordResult(result, manifest);
        markWakeDetected('sherpa wasm keyword');
        emitWakeDebug({ type: 'keyword', provider: 'sherpa-wasm', keyword: normalized.phrase, confidence: normalized.confidence, raw: result });
        options.onKeyword(normalized);
        recognizer.reset(stream);
        try { stream.free?.(); } catch {}
        stream = recognizer.createStream();
      }
    }
  };
  source.connect(processor);
  // ScriptProcessor must be connected to run in older browsers, but routing the
  // microphone graph directly to destination can create accidental monitor audio
  // in web preview. Use a silent gain node instead.
  zeroGain = audioContext.createGain();
  zeroGain.gain.value = 0;
  processor.connect(zeroGain);
  zeroGain.connect(audioContext.destination);
  emitStatus(options, 'listening');
  return {
    stop: async () => {
      stopped = true;
      try { processor.disconnect(); } catch {}
      try { zeroGain?.disconnect(); } catch {}
      zeroGain = null;
      try { source.disconnect(); } catch {}
      try { stream?.free?.(); } catch {}
      try { recognizer?.free?.(); } catch {}
      for (const track of mediaStream.getTracks()) track.stop();
      try { await audioContext.close(); } catch {}
    },
    diagnostics: null,
    runtimeKind: 'sherpa-auto-selected-trigger',
    exportKeys: Object.keys(globalThis as any).filter((key) => /sherpa|onnx|kws|create/i.test(key)).slice(0, 80),
  };
}

export async function startSherpaWasmKwsRuntime(options: SherpaWasmKwsRuntimeOptions) {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    throw new Error('Sherpa WASM KWS runtime only runs in browser.');
  }
  console.log(`[aga:sherpa-wasm] runtime marker ${RUNTIME_MARKER}`);
  emitWakeDebug({ type: 'status', provider: 'sherpa-wasm', message: `runtime marker ${RUNTIME_MARKER}` });
  const diagnostics = await diagnoseSherpaWasmBrowserRuntime();
  if (!diagnostics.ok) throw new Error(diagnostics.message);
  const runtimeBaseUrl = options.runtimeBaseUrl || diagnostics.runtimeBaseUrl || DEFAULT_RUNTIME_BASE;
  const modelBaseUrl = options.modelBaseUrl || MODEL_BASE;
  const expectedSampleRate = options.sampleRate || 16000;
  const manifest = await fetchJson<WakeAliasManifest>(`${modelBaseUrl}/wake_alias_manifest.json`);
  const keywordsText = await fetchText(`${modelBaseUrl}/keywords.txt`);
  emitStatus(options, 'requesting microphone');
  const mic = await openMicrophone(expectedSampleRate);
  const fallbackReason = manifest?.browserWakeFallback
    ? manifest.reason || 'No encodable trigger in current Sherpa vocabulary'
    : (!keywordsText.trim() || looksRawKeywordFile(keywordsText))
      ? 'keywords.txt is empty/raw'
      : '';
  if (fallbackReason) {
    return startAudioWakeFallbackLoop(options, mic.audioContext, mic.source, mic.processor, mic.mediaStream, expectedSampleRate, fallbackReason);
  }
  emitStatus(options, `selected Sherpa trigger: ${manifest?.selectedTrigger || 'unknown'} -> aga`);
  emitStatus(options, 'loading sherpa wasm module');
  const module = await initModule(runtimeBaseUrl);
  emitStatus(options, 'loading sherpa createKws bridge');
  const createKws = await loadCreateKws(runtimeBaseUrl);
  emitStatus(options, 'creating sherpa kws recognizer with auto-selected trigger');
  const { recognizer, paths } = createRecognizerWithPreloadedPaths(createKws, module, expectedSampleRate, keywordsText);
  emitStatus(options, `using preloaded sherpa assets: ${paths.tokens}`);
  return startSherpaDecodeLoop(options, recognizer, manifest, mic.audioContext, mic.source, mic.processor, mic.mediaStream, expectedSampleRate);
}