let lastConfigGetter: (() => any) | null = null;

function env(name: string) {
  return process.env?.[name] ?? '';
}

export function setObservabilityConfigGetter(getter: () => any) {
  lastConfigGetter = getter;
}

function endpoint() {
  try {
    const cfg = lastConfigGetter?.();
    return cfg?.observability?.endpoint || env('EXPO_PUBLIC_AGA_OBSERVABILITY_URL') || env('EXPO_PUBLIC_TRADJS_OBSERVABILITY_URL');
  } catch {
    return env('EXPO_PUBLIC_AGA_OBSERVABILITY_URL') || env('EXPO_PUBLIC_TRADJS_OBSERVABILITY_URL');
  }
}

export function emitObservation(kind: string, label: string, payload: Record<string, unknown> = {}) {
  const event = {
    app: 'AGA',
    kind,
    label,
    payload,
    createdAt: new Date().toISOString(),
  };
  try {
    // Keep local observability visible even when the server is offline.
    // eslint-disable-next-line no-console
    console.log('[aga:obs]', kind, label, JSON.stringify(payload).slice(0, 500));
  } catch {
    // ignore
  }
  const url = endpoint();
  if (!url) return;
  try {
    void fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(event),
      keepalive: true,
    } as any).catch(() => undefined);
  } catch {
    // ignore
  }
}
