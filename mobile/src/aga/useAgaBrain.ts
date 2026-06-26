import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CognitiveEngine, type AgaBrainSnapshot } from './CognitiveEngine';
import { RealtimeSession, type RealtimeSnapshot } from '../realtime/RealtimeSession';
import { WakeRealtimeController } from './WakeRealtimeController';
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

  // Wake scouting is the product shell. The selected post-wake engine can be
  // Gemini, OpenAI, or a fallback; but the mic scout itself must still boot.
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
    voiceSummary: snapshot.voiceSummary ?? 'wake/realtime voice',
    voiceCapability: snapshot.voiceCapability,
    activeChoiceMenu: snapshot.activeChoiceMenu ?? null,
    sessionLabel: snapshot.sessionLabel ?? null,
  } as AgaBrainSnapshot;
}

export function useAgaBrain() {
  const engineRef = useRef<BrainLike | null>(null);
  const [snapshot, setSnapshot] = useState<AgaBrainSnapshot>(INITIAL_SNAPSHOT);

  useEffect(() => {
    // The product runtime should still boot the local wake scout even when
    // WebRTC feature detection is late or missing at module-load time.
    // RealtimeSession itself will report a transport error if duplex cannot
    // start, but the mic should not silently fall back to a mismatched local brain.
    const selectedEngine = getAgaEngine();
    const useWakeRuntime = wantsWakeRuntime();
    const directRealtime = shouldUseDirectOpenAiRealtime();
    // Critical: EXPO_PUBLIC_AGA_ENGINE=gemini must override old lab flags like
    // EXPO_PUBLIC_AGA_REALTIME_DIRECT=1. Direct Realtime is OpenAI-only.
    const engine: BrainLike = useWakeRuntime
      ? (directRealtime ? new RealtimeSession() : new WakeRealtimeController())
      : new CognitiveEngine();
    try { console.info?.('[aga:engine]', agaEngineDiagnostics()); } catch { /* ignore */ }
    setSnapshot((prev) => ({
      ...prev,
      speechStatus: useWakeRuntime ? `starting wake scout → ${selectedEngine}` : 'starting local cognitive engine',
      voiceSummary: JSON.stringify(agaEngineDiagnostics()),
    }));
    engineRef.current = engine;
    const unsubscribe = engine.subscribe((next: any) => {
      setSnapshot(useWakeRuntime ? normalizeRealtimeSnapshot(next) : next);
    });
    void engine.start();
    return () => {
      unsubscribe();
      void engine.stop();
      engineRef.current = null;
    };
  }, []);

  // These callbacks must be stable. The YouTube iframe emits lifecycle events,
  // which update media state. If this hook returns a fresh onMediaEvent function
  // for every snapshot, child effects can loop: mount event -> setState -> new
  // callback -> mount event -> setState. Keep the imperative bridge stable.
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
