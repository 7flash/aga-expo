import { Platform } from 'react-native';

export type SherpaRuntimeTarget = 'native' | 'wasm';
export type SherpaRuntimeMode = 'wake' | 'menu' | 'stt';

export type SherpaAssetManifest = {
  target: SherpaRuntimeTarget;
  mode: SherpaRuntimeMode;
  /** Native filesystem/asset directory, normally assets/kws-model for Expo/RN. */
  modelDir?: string;
  /** Browser public URL directory, normally /sherpa/kws-model. */
  modelUrl?: string;
  keywords?: string;
  keywordsRaw?: string;
  tokens?: string;
  bpe?: string;
  encoder?: string;
  decoder?: string;
  joiner?: string;
  paraformer?: string;
  provider: 'xnnpack' | 'nnapi' | 'coreml' | 'cpu' | string;
  sampleRate: number;
  featureDim: number;
  numThreads: number;
  debug: boolean;
};

function env(name: string) {
  return process.env?.[name] ?? '';
}

function boolEnv(name: string, fallback = false) {
  const raw = env(name).trim().toLowerCase();
  if (!raw) return fallback;
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

function intEnv(name: string, fallback: number) {
  const value = Number(env(name));
  return Number.isFinite(value) && value > 0 ? Math.round(value) : fallback;
}

function provider() {
  const explicit = env('EXPO_PUBLIC_AGA_SHERPA_EXECUTION_PROVIDER');
  if (explicit) return explicit;
  if (Platform.OS === 'android') return env('EXPO_PUBLIC_AGA_SHERPA_ANDROID_EXECUTION_PROVIDER') || 'xnnpack';
  if (Platform.OS === 'ios') return env('EXPO_PUBLIC_AGA_SHERPA_IOS_EXECUTION_PROVIDER') || 'coreml';
  return env('EXPO_PUBLIC_AGA_SHERPA_WASM_EXECUTION_PROVIDER') || 'wasm';
}

function targetDefault(): SherpaRuntimeTarget {
  return Platform.OS === 'web' ? 'wasm' : 'native';
}

function modePrefix(mode: SherpaRuntimeMode) {
  return mode === 'wake' ? 'WAKE' : mode === 'menu' ? 'MENU' : 'STT';
}

function resolveValue(mode: SherpaRuntimeMode, target: SherpaRuntimeTarget, key: string, fallback = '') {
  const prefix = modePrefix(mode);
  const targetPrefix = target === 'wasm' ? 'WASM' : 'NATIVE';
  return (
    env(`EXPO_PUBLIC_AGA_SHERPA_${prefix}_${targetPrefix}_${key}`) ||
    env(`EXPO_PUBLIC_AGA_SHERPA_${prefix}_${key}`) ||
    env(`EXPO_PUBLIC_AGA_SHERPA_${targetPrefix}_${key}`) ||
    env(`EXPO_PUBLIC_AGA_SHERPA_${key}`) ||
    fallback
  );
}

function joinUrl(base: string, file: string) {
  const cleanBase = String(base || '').replace(/\/+$/, '');
  const cleanFile = String(file || '').replace(/^\/+/, '');
  if (!cleanBase) return cleanFile;
  return `${cleanBase}/${cleanFile}`;
}

function joinPath(base: string, file: string) {
  const cleanBase = String(base || '').replace(/[\\/]+$/, '');
  const cleanFile = String(file || '').replace(/^[\\/]+/, '');
  if (!cleanBase) return cleanFile;
  return `${cleanBase}/${cleanFile}`;
}

function withBase(target: SherpaRuntimeTarget, base: string, file: string) {
  return target === 'wasm' ? joinUrl(base, file) : joinPath(base, file);
}

export function resolveSherpaManifest(mode: SherpaRuntimeMode, target: SherpaRuntimeTarget = targetDefault()): SherpaAssetManifest {
  // Keep these aligned with scripts/aga-sherpa-kws-setup.js.
  // Native/RN build reads from assets/kws-model.
  // Browser preview fetches from public/sherpa/kws-model.
  const nativeDefault = mode === 'stt' ? 'assets/stt-model' : 'assets/kws-model';
  const wasmDefault = mode === 'stt' ? '/sherpa/stt-model' : '/sherpa/kws-model';
  const base = target === 'native'
    ? resolveValue(mode, target, 'MODEL_DIR', nativeDefault)
    : resolveValue(mode, target, 'MODEL_URL', wasmDefault);

  const file = (key: string, fallbackName: string) =>
    resolveValue(mode, target, key, withBase(target, base, fallbackName));

  return {
    target,
    mode,
    modelDir: target === 'native' ? base : undefined,
    modelUrl: target === 'wasm' ? base : undefined,
    encoder: file('ENCODER', 'encoder.onnx'),
    decoder: file('DECODER', 'decoder.onnx'),
    joiner: file('JOINER', 'joiner.onnx'),
    tokens: file('TOKENS', 'tokens.txt'),
    bpe: file('BPE', 'bpe.model'),
    keywords: file('KEYWORDS', 'keywords.txt'),
    keywordsRaw: file('KEYWORDS_RAW', 'keywords_raw.txt'),
    paraformer: resolveValue(mode, target, 'PARAFORMER', ''),
    provider: provider(),
    sampleRate: intEnv('EXPO_PUBLIC_AGA_SHERPA_SAMPLE_RATE', 16000),
    featureDim: intEnv('EXPO_PUBLIC_AGA_SHERPA_FEATURE_DIM', 80),
    numThreads: intEnv('EXPO_PUBLIC_AGA_SHERPA_THREADS', 2),
    debug: boolEnv('EXPO_PUBLIC_AGA_SHERPA_DEBUG', false),
  };
}

export function sherpaManifestSummary(manifest: SherpaAssetManifest) {
  return {
    target: manifest.target,
    mode: manifest.mode,
    provider: manifest.provider,
    modelDir: manifest.modelDir,
    modelUrl: manifest.modelUrl,
    hasKeywords: !!manifest.keywords,
    hasTokens: !!manifest.tokens,
    hasBpe: !!manifest.bpe,
    hasEncoder: !!manifest.encoder,
    hasDecoder: !!manifest.decoder,
    hasJoiner: !!manifest.joiner,
    hasParaformer: !!manifest.paraformer,
    sampleRate: manifest.sampleRate,
    featureDim: manifest.featureDim,
    numThreads: manifest.numThreads,
  };
}

export function validateSherpaManifest(manifest: SherpaAssetManifest) {
  const missing: string[] = [];
  if (manifest.target === 'native' && !manifest.modelDir) missing.push('native modelDir');
  if (manifest.target === 'wasm' && !manifest.modelUrl) missing.push('WASM modelUrl');
  if (!manifest.tokens) missing.push('tokens');
  if (!manifest.keywords && manifest.mode !== 'stt') missing.push('keywords');

  const hasExplicitGraph = !!(manifest.paraformer || (manifest.encoder && manifest.decoder && manifest.joiner));
  const hasDirectory = !!(manifest.target === 'native' ? manifest.modelDir : manifest.modelUrl);
  if (!hasExplicitGraph && !hasDirectory) missing.push('model graph or model directory');

  return {
    ok: missing.length === 0,
    missing,
    message: missing.length
      ? `Sherpa ${manifest.target}/${manifest.mode} assets are incomplete: ${missing.join(', ')}.`
      : `Sherpa ${manifest.target}/${manifest.mode} assets configured.`,
  };
}

export function shouldAllowDevKeywordFallback() {
  const raw = env('EXPO_PUBLIC_AGA_ALLOW_DEV_KEYWORD_INJECTOR').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}
