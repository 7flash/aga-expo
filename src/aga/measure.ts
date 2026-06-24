export type MeasureMeta = Record<string, string | number | boolean | null | undefined>;

export async function measureAsync<T>(label: string, fn: () => Promise<T>, meta: MeasureMeta = {}): Promise<T> {
  const start = globalThis.performance?.now?.() ?? Date.now();
  try {
    const result = await fn();
    const end = globalThis.performance?.now?.() ?? Date.now();
    console.info(`[measure:${label}] ${(end - start).toFixed(1)}ms`, meta);
    return result;
  } catch (error) {
    const end = globalThis.performance?.now?.() ?? Date.now();
    console.warn(`[measure:${label}:error] ${(end - start).toFixed(1)}ms`, { ...meta, error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

export function measureSync<T>(label: string, fn: () => T, meta: MeasureMeta = {}): T {
  const start = globalThis.performance?.now?.() ?? Date.now();
  try {
    const result = fn();
    const end = globalThis.performance?.now?.() ?? Date.now();
    console.info(`[measure:${label}] ${(end - start).toFixed(1)}ms`, meta);
    return result;
  } catch (error) {
    const end = globalThis.performance?.now?.() ?? Date.now();
    console.warn(`[measure:${label}:error] ${(end - start).toFixed(1)}ms`, { ...meta, error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}
