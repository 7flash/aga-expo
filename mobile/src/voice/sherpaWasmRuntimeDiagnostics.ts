export type SherpaWasmDiagnostic = {
  ok: boolean;
  platform: 'web' | 'native-or-unknown';
  modelAssets: Record<string, boolean>;
  runtimeAssets: Record<string, boolean>;
  runtimeBaseUrl: string;
  crossOriginIsolated: boolean;
  micPermission?: 'granted' | 'denied' | 'prompt' | 'unknown';
  message: string;
};

const MODEL_BASE = '/sherpa/kws-model';
const RUNTIME_BASE =
  (typeof process !== 'undefined' && (process as any).env?.EXPO_PUBLIC_AGA_SHERPA_WASM_RUNTIME_BASE) ||
  '/sherpa/runtime/kws';

const modelFiles = [
  'encoder.onnx',
  'decoder.onnx',
  'joiner.onnx',
  'tokens.txt',
  'bpe.model',
  'keywords.txt',
  'manifest.json',
];

const runtimeFiles = [
  'sherpa-onnx-kws.js',
  'sherpa-onnx-wasm-kws-main.js',
  'sherpa-onnx-wasm-kws-main.wasm',
  'sherpa-onnx-wasm-kws-main.data',
  'aga-kws-runtime-manifest.json',
];

async function exists(url: string) {
  try {
    const response = await fetch(url, { method: 'HEAD', cache: 'no-store' });
    if (response.ok) return true;
    const fallback = await fetch(url, { method: 'GET', cache: 'no-store' });
    return fallback.ok;
  } catch {
    return false;
  }
}

async function micState(): Promise<SherpaWasmDiagnostic['micPermission']> {
  const nav: any = globalThis.navigator;
  if (!nav) return 'unknown';
  try {
    const permissions = nav.permissions;
    if (permissions?.query) {
      const status = await permissions.query({ name: 'microphone' as PermissionName });
      return status.state as any;
    }
  } catch {}
  if (nav.mediaDevices?.getUserMedia) return 'prompt';
  return 'unknown';
}

export async function diagnoseSherpaWasmBrowserRuntime(): Promise<SherpaWasmDiagnostic> {
  const isWeb = typeof window !== 'undefined' && typeof document !== 'undefined';
  if (!isWeb) {
    return {
      ok: false,
      platform: 'native-or-unknown',
      modelAssets: {},
      runtimeAssets: {},
      runtimeBaseUrl: RUNTIME_BASE,
      crossOriginIsolated: false,
      message: 'Sherpa WASM diagnostics only run in browser preview.',
    };
  }

  const modelAssets: Record<string, boolean> = {};
  await Promise.all(modelFiles.map(async (file) => {
    modelAssets[file] = await exists(`${MODEL_BASE}/${file}`);
  }));

  const runtimeAssets: Record<string, boolean> = {};
  await Promise.all(runtimeFiles.map(async (file) => {
    runtimeAssets[file] = await exists(`${RUNTIME_BASE}/${file}`);
  }));

  const missingModels = Object.entries(modelAssets).filter(([, ok]) => !ok).map(([file]) => file);
  const missingRuntime = Object.entries(runtimeAssets).filter(([, ok]) => !ok).map(([file]) => file);
  const micPermission = await micState();
  const isolated = typeof (globalThis as any).crossOriginIsolated === 'boolean'
    ? Boolean((globalThis as any).crossOriginIsolated)
    : false;

  const ok = missingModels.length === 0 &&
    missingRuntime.length === 0 &&
    micPermission !== 'denied' &&
    isolated;

  const message = ok
    ? 'Sherpa WASM browser runtime is ready.'
    : [
        missingModels.length ? `Missing model assets: ${missingModels.join(', ')}` : '',
        missingRuntime.length ? `Missing WASM runtime assets: ${missingRuntime.join(', ')}` : '',
        !isolated
          ? 'Browser is not cross-origin isolated. Start web with: node scripts/aga-start-isolated-web.js and open http://localhost:19006, not the raw Expo URL.'
          : '',
        micPermission === 'denied' ? 'Microphone permission is denied.' : '',
      ].filter(Boolean).join(' ');

  return {
    ok,
    platform: 'web',
    modelAssets,
    runtimeAssets,
    runtimeBaseUrl: RUNTIME_BASE,
    crossOriginIsolated: isolated,
    micPermission,
    message,
  };
}

declare global {
  interface Window {
    __AGA_SHERPA_DIAG?: () => Promise<SherpaWasmDiagnostic>;
  }
}

if (typeof window !== 'undefined') {
  window.__AGA_SHERPA_DIAG = diagnoseSherpaWasmBrowserRuntime;
}
