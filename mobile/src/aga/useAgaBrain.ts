import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AgaBrainSnapshot } from './CognitiveEngine';
import type { RealtimeSnapshot } from '../realtime/RealtimeSession';
import { agaEngineDiagnostics, getAgaEngine, isLocalEngine, shouldUseDirectOpenAiRealtime } from './engine';

const INITIAL_SNAPSHOT: AgaBrainSnapshot = {
  ready: false,
  mode: 'sleeping',
  interim: '',
  messages: [],
  reminders: [],
  activeMedia: null,
  mediaCommand: null,
  speechStatus: 'starting',
  error: null,
  lastMeasure: undefined,
  ttsStatus: undefined,
  voiceSummary: undefined,
  voiceCapability: undefined,
  activeChoiceMenu: null,
  sessionLabel: null,
};

function env(name: string) {
  return process.env?.[name] ?? '';
}

function wantsWakeRuntime() {
  const runtime = env('EXPO_PUBLIC_AGA_RUNTIME').trim().toLowerCase();
  if (runtime === 'offline' || runtime === 'local' || runtime === 'cognitive') return false;
  if (isLocalEngine()) return false;
  if (env('EXPO_PUBLIC_AGA_WAKE_SCOUT_ENABLED') === '0') return false;
  return true;
}

type BrainLike = {
  start(): Promise<void> | void;
  stop(): Promise<void> | void;
  subscribe(listener: (snapshot: any) => void): () => void;
  replay?(text: string): void;
  closeMedia?(): void;
  onMediaEvent?(event: string): void;
  rearmMic?(): void;
};

function normalizeRealtimeSnapshot(snapshot: RealtimeSnapshot): AgaBrainSnapshot {
  return {
    ...INITIAL_SNAPSHOT,
    ...snapshot,
    lastMeasure: snapshot.lastMeasure,
    ttsStatus: undefined,
    voiceSummary: snapshot.voiceSummary ?? 'wake voice runtime',
    voiceCapability: snapshot.voiceCapability,
    activeChoiceMenu: snapshot.activeChoiceMenu ?? null,
    sessionLabel: snapshot.sessionLabel ?? null,
  } as AgaBrainSnapshot;
}

async function createSelectedBrain(): Promise<{ engine: BrainLike; useWakeRuntime: boolean }> {
  const selectedEngine = getAgaEngine();
  const useWakeRuntime = wantsWakeRuntime();
  const directRealtime = shouldUseDirectOpenAiRealtime();

  // Engine firewall: do not import the OpenAI Realtime module unless the
  // selected engine is actually OpenAI direct mode. This prevents side effects,
  // stale lab flags, or accidental constructor paths from touching OpenAI when
  // EXPO_PUBLIC_AGA_ENGINE=gemini.
  if (useWakeRuntime) {
    if (directRealtime && selectedEngine === 'openai') {
      const mod = await import('../realtime/RealtimeSession');
      return { engine: new mod.RealtimeSession(), useWakeRuntime };
    }
    const mod = await import('./WakeRealtimeController');
    return { engine: new mod.WakeRealtimeController(), useWakeRuntime };
  }

  const mod = await import('./CognitiveEngine');
  return { engine: new mod.CognitiveEngine(), useWakeRuntime };
}

export function useAgaBrain() {
  const engineRef = useRef<BrainLike | null>(null);
  const [snapshot, setSnapshot] = useState<AgaBrainSnapshot>(INITIAL_SNAPSHOT);

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;

    const boot = async () => {
      const selectedEngine = getAgaEngine();
      const diagnostics = agaEngineDiagnostics();
      try { console.info?.('[aga:engine]', diagnostics); } catch { /* ignore */ }
      setSnapshot((prev) => ({
        ...prev,
        speechStatus: wantsWakeRuntime() ? `starting wake scout → ${selectedEngine}` : 'starting local cognitive engine',
        voiceSummary: JSON.stringify(diagnostics),
        voiceCapability: diagnostics,
      }));

      let created: { engine: BrainLike; useWakeRuntime: boolean };
      try {
        created = await createSelectedBrain();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error || 'Engine failed to load.');
        if (!cancelled) {
          setSnapshot((prev) => ({ ...prev, ready: true, mode: 'recovering', speechStatus: 'engine load failed', error: message }));
        }
        return;
      }

      if (cancelled) {
        void created.engine.stop();
        return;
      }

      engineRef.current = created.engine;
      unsubscribe = created.engine.subscribe((next: any) => {
        setSnapshot(created.useWakeRuntime ? normalizeRealtimeSnapshot(next) : next);
      });
      try {
        await created.engine.start();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error || 'Engine failed to start.');
        if (!cancelled) {
          setSnapshot((prev) => ({ ...prev, ready: true, mode: 'recovering', speechStatus: 'engine start failed', error: message }));
        }
      }
    };

    void boot();
    return () => {
      cancelled = true;
      unsubscribe?.();
      const engine = engineRef.current;
      engineRef.current = null;
      void engine?.stop();
    };
  }, []);

  const replay = useCallback((text: string) => engineRef.current?.replay?.(text), []);
  const closeMedia = useCallback(() => engineRef.current?.closeMedia?.(), []);
  const onMediaEvent = useCallback((event: string) => engineRef.current?.onMediaEvent?.(event), []);
  const rearmMic = useCallback(() => engineRef.current?.rearmMic?.(), []);

  return useMemo(
    () => ({
      ...snapshot,
      replay,
      closeMedia,
      onMediaEvent,
      rearmMic,
    }),
    [snapshot, replay, closeMedia, onMediaEvent, rearmMic],
  );
}
