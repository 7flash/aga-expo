type RuntimeHandle = { stop?: () => Promise<void> | void; diagnostics?: unknown; runtimeKind?: string; [key: string]: unknown };

type State = {
  promise: Promise<RuntimeHandle> | null;
  handle: RuntimeHandle | null;
  key: string;
  starts: number;
  lastError: unknown;
};

const state: State = { promise: null, handle: null, key: '', starts: 0, lastError: null };

function root() { return typeof window !== 'undefined' ? (window as any) : globalThis as any; }

export async function getOrStartSherpaRuntime(key: string, starter: () => Promise<RuntimeHandle>) {
  const globalRoot = root();
  if (state.handle && state.key === key) return state.handle;
  if (state.promise && state.key === key) return state.promise;

  if (globalRoot.__AGA_SHERPA_RUNTIME_PROMISE__ && globalRoot.__AGA_SHERPA_RUNTIME_KEY__ === key) {
    state.promise = globalRoot.__AGA_SHERPA_RUNTIME_PROMISE__;
    return state.promise;
  }

  state.key = key;
  state.starts += 1;
  state.promise = starter()
    .then((handle) => {
      state.handle = handle;
      state.lastError = null;
      return handle;
    })
    .catch((error) => {
      state.lastError = error;
      state.promise = null;
      globalRoot.__AGA_SHERPA_RUNTIME_PROMISE__ = null;
      throw error;
    });

  globalRoot.__AGA_SHERPA_RUNTIME_PROMISE__ = state.promise;
  globalRoot.__AGA_SHERPA_RUNTIME_KEY__ = key;
  return state.promise;
}

export async function stopSharedSherpaRuntime() {
  const handle = state.handle || await state.promise?.catch(() => null);
  await handle?.stop?.();
  state.handle = null;
  state.promise = null;
  const globalRoot = root();
  globalRoot.__AGA_SHERPA_RUNTIME_PROMISE__ = null;
  globalRoot.__AGA_SHERPA_RUNTIME_KEY__ = '';
}

export function getSherpaRuntimeSingletonStatus() {
  return {
    running: !!state.handle,
    pending: !!state.promise,
    key: state.key,
    starts: state.starts,
    lastError: state.lastError,
  };
}
