import { useEffect, useMemo, useRef, useState } from 'react';
import { CognitiveEngine, type AgaBrainSnapshot } from './CognitiveEngine';
import { RealtimeSession, shouldUseRealtimeSession, type RealtimeSnapshot } from '../realtime/RealtimeSession';
import { WakeRealtimeController } from './WakeRealtimeController';

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
    voiceSummary: 'realtime WebRTC',
    voiceCapability: undefined,
    activeChoiceMenu: snapshot.activeChoiceMenu ?? null,
    sessionLabel: snapshot.sessionLabel ?? null,
  } as AgaBrainSnapshot;
}

export function useAgaBrain() {
  const engineRef = useRef<BrainLike | null>(null);
  const [snapshot, setSnapshot] = useState<AgaBrainSnapshot>(INITIAL_SNAPSHOT);

  useEffect(() => {
    const useRealtime = shouldUseRealtimeSession();
    const directRealtime = process.env.EXPO_PUBLIC_AGA_REALTIME_DIRECT === '1';
    const engine: BrainLike = useRealtime
      ? (directRealtime ? new RealtimeSession() : new WakeRealtimeController())
      : new CognitiveEngine();
    engineRef.current = engine;
    const unsubscribe = engine.subscribe((next: any) => {
      setSnapshot(useRealtime ? normalizeRealtimeSnapshot(next) : next);
    });
    void engine.start();
    return () => {
      unsubscribe();
      void engine.stop();
      engineRef.current = null;
    };
  }, []);

  return useMemo(
    () => ({
      ...snapshot,
      replay: (text: string) => engineRef.current?.replay?.(text),
      closeMedia: () => engineRef.current?.closeMedia?.(),
      onMediaEvent: (event: string) => engineRef.current?.onMediaEvent?.(event),
      rearmMic: () => engineRef.current?.rearmMic?.(),
    }),
    [snapshot],
  );
}
