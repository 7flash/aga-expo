type MeasureMeta = Record<string, unknown>;

type MaybeMeasureModule = {
  measure?: <T>(name: string, fn: () => Promise<T> | T, meta?: MeasureMeta) => Promise<T> | T;
  measureFn?: <T>(name: string, fn: () => Promise<T> | T, meta?: MeasureMeta) => Promise<T> | T;
  default?: unknown;
};

let measureModulePromise: Promise<MaybeMeasureModule | null> | null = null;

async function loadMeasureFn() {
  if (!measureModulePromise) {
    measureModulePromise = (async () => {
      try {
        const dynamicImport = new Function('specifier', 'return import(specifier)') as (
          specifier: string
        ) => Promise<MaybeMeasureModule>;
        return await dynamicImport('measure-fn');
      } catch {
        return null;
      }
    })();
  }

  return measureModulePromise;
}

function now() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

export async function measured<T>(name: string, fn: () => Promise<T> | T, meta: MeasureMeta = {}) {
  const loaded = await loadMeasureFn();
  const externalMeasure = loaded?.measure ?? loaded?.measureFn;

  if (externalMeasure) {
    return await externalMeasure(name, fn, meta);
  }

  const started = now();
  console.log(`[measure] ${name}:start`, meta);

  try {
    const result = await fn();
    console.log(`[measure] ${name}:ok`, { ...meta, ms: Math.round(now() - started) });
    return result;
  } catch (error) {
    console.error(`[measure] ${name}:error`, {
      ...meta,
      ms: Math.round(now() - started),
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}
