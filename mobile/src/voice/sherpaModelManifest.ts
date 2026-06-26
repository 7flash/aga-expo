import { Platform } from 'react-native';

export type SherpaRuntimeTarget = 'native' | 'wasm';
export type SherpaRuntimeMode = 'wake' | 'menu' | 'stt';

export type SherpaAssetManifest = {
  target: SherpaRuntimeTarget;
  mode: SherpaRuntimeMode;
  modelDir?: string;
  modelUrl?: string;
  tokens?: string;
  encoder?: string;
  decoder?: string;
  joiner?: string;
  paraformer?: string;
  provider: 'xnnpack' | 'nnapi' | 'cpu' | string;
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
  return env('EXPO_PUBLIC_AGA_SHERPA_EXECUTION_PROVIDER') || (Platform.OS === 'android' ? 'xnnpack' : 'cpu');
}

function targetDefault(): SherpaRuntimeTarget {
  return Platform.OS === 'web' ? 'wasm' : 'native';
}

function modePrefix(mode: SherpaRuntimeMode) {
  return mode === 'wake' ? 'WAKE' : mode === 'menu' ? 'MENU' : 'STT';
}

function resolvePath(mode: SherpaRuntimeMode, target: SherpaRuntimeTarget, key: string, fallback = '') {
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

export function resolveSherpaManifest(mode: SherpaRuntimeMode, target: SherpaRuntimeTarget = targetDefault()): SherpaAssetManifest {
  const nativeDefault = mode === 'stt' ? 'assets/sherpa/stt' : 'assets/sherpa/kws';
  const wasmDefault = mode === 'stt' ? '/sherpa/stt' : '/sherpa/kws';
  return {
    target,
    mode,
    modelDir: target === 'native' ? resolvePath(mode, target, 'MODEL_DIR', nativeDefault) : undefined,
    modelUrl: target === 'wasm' ? resolvePath(mode, target, 'MODEL_URL', wasmDefault) : undefined,
    tokens: resolvePath(mode, target, 'TOKENS', ''),
    encoder: resolvePath(mode, target, 'ENCODER', ''),
    decoder: resolvePath(mode, target, 'DECODER', ''),
    joiner: resolvePath(mode, target, 'JOINER', ''),
    paraformer: resolvePath(mode, target, 'PARAFORMER', ''),
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
    hasTokens: !!manifest.tokens,
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

  // Some wrappers accept one modelDir/modelUrl, while others need explicit model files.
  // Do not require every file here; report actionable diagnostics without blocking wrappers
  // that bundle config under a directory.
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
