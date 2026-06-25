/*
 * AGA measurement adapter.
 *
 * Uses the optional `measure-fn` package when present, but never requires it.
 * In Expo/web/native builds where that package is missing, this falls back to
 * performance.now()/Date.now() and keeps a small in-memory ring buffer.
 */

declare const process: { env?: Record<string, string | undefined> } | undefined;
declare function require(name: string): any;

type Meta = Record<string, unknown> | undefined;

export type AgaMeasureEvent = {
  id: string;
  label: string;
  ok: boolean;
  durationMs: number;
  startedAt: string;
  endedAt: string;
  meta?: Meta;
  error?: string;
};

type Listener = (event: AgaMeasureEvent) => void;

const MAX_EVENTS = 180;
let sequence = 0;
let enabled =
  (typeof process === "undefined"
    ? undefined
    : process.env?.EXPO_PUBLIC_AGA_MEASURE) !== "0";
let optionalMeasureFn: any | undefined;
let optionalLoaded = false;
const listeners = new Set<Listener>();
const recent: AgaMeasureEvent[] = [];

function nowMs() {
  const perf = globalThis?.performance;
  return typeof perf?.now === "function" ? perf.now() : Date.now();
}

function isoNow() {
  return new Date().toISOString();
}

function safeError(error: unknown) {
  if (error instanceof Error) return error.message;
  return String(error ?? "unknown error");
}

function loadOptionalMeasureFn() {
  if (optionalLoaded) return optionalMeasureFn;
  optionalLoaded = true;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    optionalMeasureFn = require("measure-fn");
  } catch {
    optionalMeasureFn = null;
  }
  return optionalMeasureFn;
}

function emit(event: AgaMeasureEvent) {
  if (!enabled) return;
  recent.push(event);
  while (recent.length > MAX_EVENTS) recent.shift();

  const prefix = event.ok ? "✓" : "✕";
  const meta = event.meta ? ` ${JSON.stringify(event.meta)}` : "";
  // Console output is intentionally compact; it gives us a live trace without UI clutter.
  // eslint-disable-next-line no-console
  console.info(
    `[aga:measure] ${prefix} ${event.label} ${Math.round(event.durationMs)}ms${meta}${event.error ? ` — ${event.error}` : ""}`,
  );

  for (const listener of listeners) {
    try {
      listener(event);
    } catch {
      /* ignore observer errors */
    }
  }
}

export function setAgaMeasureEnabled(next: boolean) {
  enabled = next;
}

export function isAgaMeasureEnabled() {
  return enabled;
}

export function subscribeAgaMeasures(listener: Listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function getRecentAgaMeasures() {
  return [...recent];
}

export function clearAgaMeasures() {
  recent.length = 0;
}

export async function measureAsync<T>(
  label: string,
  fn: () => Promise<T>,
  meta?: Meta,
): Promise<T> {
  if (!enabled) return fn();
  const id = `${++sequence}`;
  const startedAt = isoNow();
  const start = nowMs();
  try {
    const result = await fn();
    emit({
      id,
      label,
      ok: true,
      durationMs: nowMs() - start,
      startedAt,
      endedAt: isoNow(),
      meta,
    });
    return result;
  } catch (error) {
    emit({
      id,
      label,
      ok: false,
      durationMs: nowMs() - start,
      startedAt,
      endedAt: isoNow(),
      meta,
      error: safeError(error),
    });
    throw error;
  }
}

export function measureSync<T>(label: string, fn: () => T, meta?: Meta): T {
  if (!enabled) return fn();
  const id = `${++sequence}`;
  const startedAt = isoNow();
  const start = nowMs();
  try {
    const result = fn();
    emit({
      id,
      label,
      ok: true,
      durationMs: nowMs() - start,
      startedAt,
      endedAt: isoNow(),
      meta,
    });
    return result;
  } catch (error) {
    emit({
      id,
      label,
      ok: false,
      durationMs: nowMs() - start,
      startedAt,
      endedAt: isoNow(),
      meta,
      error: safeError(error),
    });
    throw error;
  }
}

export function measureMark(label: string, meta?: Meta) {
  emit({
    id: `${++sequence}`,
    label,
    ok: true,
    durationMs: 0,
    startedAt: isoNow(),
    endedAt: isoNow(),
    meta,
  });
}

export function measureWrap<TArgs extends unknown[], TResult>(
  label: string,
  fn: (...args: TArgs) => TResult,
  meta?: Meta,
): (...args: TArgs) => TResult {
  const external = loadOptionalMeasureFn();
  if (external?.wrap && enabled) {
    try {
      return external.wrap(label, fn);
    } catch {
      // Fall through to the safe local wrapper.
    }
  }
  return (...args: TArgs) => measureSync(label, () => fn(...args), meta);
}
