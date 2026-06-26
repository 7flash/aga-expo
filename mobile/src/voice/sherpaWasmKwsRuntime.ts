import { diagnoseSherpaWasmBrowserRuntime } from './sherpaWasmRuntimeDiagnostics';

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

const MODEL_BASE = '/sherpa/kws-model';
const WASM_MODEL_DIR = '/aga-kws-model';
const DEFAULT_RUNTIME_BASE =
  (typeof process !== 'undefined' && (process as any).env?.EXPO_PUBLIC_AGA_SHERPA_WASM_RUNTIME_BASE) ||
  '/sherpa/runtime/kws';

type EmscriptenModule = Record<string, any>;

function emitStatus(options: SherpaWasmKwsRuntimeOptions, status: string) {
  options.onStatus?.(status);
  console.log(`[aga:sherpa-wasm] ${status}`);
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

async function fetchBytes(url: string) {
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Failed to fetch ${url}: HTTP ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
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
    const moduleKeys = g.Module ? Object.keys(g.Module).filter((key) => /sherpa|onnx|kws|create|keyword|stream/i.test(key)).slice(0, 120) : [];
    throw new Error(
      `Sherpa helper loaded but createKws was not exposed. ` +
      `Global keys: ${keys.join(', ') || '(none)'}. Module keys: ${moduleKeys.join(', ') || '(none)'}.`
    );
  }

  return createKws as (module: EmscriptenModule, config: Record<string, unknown>) => any;
}

function ensureFsDir(module: EmscriptenModule, dir: string) {
  const FS = module.FS;
  if (!FS) throw new Error('Sherpa WASM Module has no FS API; cannot mount model assets.');

  try {
    FS.stat(dir);
    return;
  } catch {}

  if (typeof FS.mkdirTree === 'function') {
    FS.mkdirTree(dir);
    return;
  }

  const parts = dir.split('/').filter(Boolean);
  let current = '';
  for (const part of parts) {
    current += `/${part}`;
    try {
      FS.stat(current);
    } catch {
      FS.mkdir(current);
    }
  }
}

function writeFsFile(module: EmscriptenModule, fullPath: string, data: Uint8Array | string) {
  const FS = module.FS;
  if (FS?.writeFile) {
    FS.writeFile(fullPath, data);
    return;
  }

  if (typeof module.FS_createDataFile === 'function') {
    const slash = fullPath.lastIndexOf('/');
    const dir = fullPath.slice(0, slash) || '/';
    const name = fullPath.slice(slash + 1);
    module.FS_createDataFile(dir, name, data, true, true, true);
    return;
  }

  throw new Error('Sherpa WASM Module has neither FS.writeFile nor FS_createDataFile.');
}

async function mountModelAssets(module: EmscriptenModule, modelBaseUrl: string, options: SherpaWasmKwsRuntimeOptions) {
  const mountedFlag = '__AGA_KWS_MODEL_ASSETS_MOUNTED';
  if ((module as any)[mountedFlag]) return;

  emitStatus(options, 'mounting kws model assets into wasm fs');
  ensureFsDir(module, WASM_MODEL_DIR);

  const binaryFiles = [
    'encoder.onnx',
    'decoder.onnx',
    'joiner.onnx',
    'bpe.model',
  ];

  const textFiles = [
    'tokens.txt',
    'keywords.txt',
  ];

  await Promise.all(binaryFiles.map(async (file) => {
    const bytes = await fetchBytes(`${modelBaseUrl}/${file}`);
    writeFsFile(module, `${WASM_MODEL_DIR}/${file}`, bytes);
  }));

  await Promise.all(textFiles.map(async (file) => {
    const text = await fetchText(`${modelBaseUrl}/${file}`);
    writeFsFile(module, `${WASM_MODEL_DIR}/${file}`, text);
  }));

  (module as any)[mountedFlag] = true;
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

function keywordIdFromResult(result: any) {
  const keyword = String(result?.keyword || result?.text || result?.id || '').trim();
  if (!keyword) return '';
  const alias = keyword.includes('@') ? keyword.split('@').pop() : keyword;
  return String(alias || keyword).replace(/^@/, '').trim();
}

function normalizeKeywordResult(result: any): SherpaWasmKeywordEvent {
  if (typeof result === 'string') return { id: result, phrase: result, raw: result };
  const phrase = keywordIdFromResult(result);
  return {
    id: String(result?.id || phrase),
    phrase,
    confidence: typeof result?.confidence === 'number' ? result.confidence : undefined,
    raw: result,
  };
}

/**
 * Browser Path A runtime wrapper using Sherpa's generated browser KWS API:
 *
 *   sherpa-onnx-wasm-kws-main.js  -> Emscripten Module
 *   sherpa-onnx-kws.js            -> global createKws(Module, config)
 *
 * Important: createKws expects model paths inside Emscripten's virtual FS.
 * Browser URLs like `/sherpa/kws-model/tokens.txt` are not valid FS paths.
 * This wrapper fetches the assets and writes them to `/aga-kws-model/...`.
 */
export async function startSherpaWasmKwsRuntime(options: SherpaWasmKwsRuntimeOptions) {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    throw new Error('Sherpa WASM KWS runtime only runs in browser.');
  }

  const diagnostics = await diagnoseSherpaWasmBrowserRuntime();
  if (!diagnostics.ok) throw new Error(diagnostics.message);

  const runtimeBaseUrl = options.runtimeBaseUrl || diagnostics.runtimeBaseUrl || DEFAULT_RUNTIME_BASE;
  const modelBaseUrl = options.modelBaseUrl || MODEL_BASE;
  const expectedSampleRate = options.sampleRate || 16000;

  emitStatus(options, 'loading sherpa wasm module');
  const module = await initModule(runtimeBaseUrl);

  emitStatus(options, 'loading sherpa createKws bridge');
  const createKws = await loadCreateKws(runtimeBaseUrl);

  await mountModelAssets(module, modelBaseUrl, options);

  const keywords = await fetchText(`${modelBaseUrl}/keywords.txt`);
  emitStatus(options, 'creating sherpa kws recognizer');

  const recognizer = createKws(module, {
    featConfig: {
      samplingRate: expectedSampleRate,
      featureDim: 80,
    },
    modelConfig: {
      transducer: {
        encoder: `${WASM_MODEL_DIR}/encoder.onnx`,
        decoder: `${WASM_MODEL_DIR}/decoder.onnx`,
        joiner: `${WASM_MODEL_DIR}/joiner.onnx`,
      },
      tokens: `${WASM_MODEL_DIR}/tokens.txt`,
      provider: 'cpu',
      modelType: '',
      numThreads: 1,
      debug: 0,
      modelingUnit: 'bpe',
      bpeVocab: `${WASM_MODEL_DIR}/bpe.model`,
    },
    maxActivePaths: 4,
    numTrailingBlanks: 1,
    keywordsScore: Number((process as any)?.env?.EXPO_PUBLIC_AGA_SHERPA_KEYWORDS_SCORE || 1.0),
    keywordsThreshold: Number((process as any)?.env?.EXPO_PUBLIC_AGA_SHERPA_KEYWORDS_THRESHOLD || 0.25),
    keywords,
  });

  if (!recognizer?.createStream) {
    throw new Error(`createKws returned unexpected recognizer. Keys: ${Object.keys(recognizer || {}).join(', ')}`);
  }

  const nav: any = navigator;
  if (!nav.mediaDevices?.getUserMedia) throw new Error('Browser does not expose getUserMedia microphone access.');

  emitStatus(options, 'requesting microphone');
  const mediaStream: MediaStream = await nav.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      channelCount: 1,
      sampleRate: expectedSampleRate,
    },
    video: false,
  });

  const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext;
  const audioContext = new AudioCtx({ sampleRate: expectedSampleRate });
  const source = audioContext.createMediaStreamSource(mediaStream);
  const processor = audioContext.createScriptProcessor(4096, 1, 1);

  let stopped = false;
  let stream: any = recognizer.createStream();

  processor.onaudioprocess = (event) => {
    if (stopped) return;
    let samples = new Float32Array(event.inputBuffer.getChannelData(0));
    samples = downsampleBuffer(samples, audioContext.sampleRate, expectedSampleRate);

    stream.acceptWaveform(expectedSampleRate, samples);

    while (recognizer.isReady(stream)) {
      recognizer.decode(stream);
      const result = recognizer.getResult(stream);
      if (result?.keyword && String(result.keyword).length > 0) {
        const normalized = normalizeKeywordResult(result);
        options.onKeyword(normalized);
        recognizer.reset(stream);
        try { stream.free?.(); } catch {}
        stream = recognizer.createStream();
      }
    }
  };

  source.connect(processor);
  processor.connect(audioContext.destination);

  emitStatus(options, 'listening');

  return {
    stop: async () => {
      stopped = true;
      try { processor.disconnect(); } catch {}
      try { source.disconnect(); } catch {}
      try { stream?.free?.(); } catch {}
      try { recognizer?.free?.(); } catch {}
      for (const track of mediaStream.getTracks()) track.stop();
      try { await audioContext.close(); } catch {}
    },
    diagnostics,
    runtimeKind: 'sherpa-createKws-fs-mounted',
    exportKeys: Object.keys(globalThis as any).filter((key) => /sherpa|onnx|kws|create/i.test(key)).slice(0, 80),
  };
}
