import { useEffect, useMemo, useRef, useState } from "react";
import { CognitiveEngine, type AgaBrainSnapshot } from "./CognitiveEngine";

const INITIAL_SNAPSHOT: AgaBrainSnapshot = {
  ready: false,
  mode: "sleeping",
  interim: "",
  messages: [],
  reminders: [],
  activeMedia: null,
  mediaCommand: null,
  speechStatus: "starting",
  error: null,
  lastMeasure: undefined,
  ttsStatus: undefined,
};

export function useAgaBrain() {
  const engineRef = useRef<CognitiveEngine | null>(null);
  const [snapshot, setSnapshot] = useState<AgaBrainSnapshot>(INITIAL_SNAPSHOT);

  useEffect(() => {
    const engine = new CognitiveEngine();
    engineRef.current = engine;
    const unsubscribe = engine.subscribe(setSnapshot);
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
      replay: (text: string) => engineRef.current?.replay(text),
      closeMedia: () => engineRef.current?.closeMedia(),
      onMediaEvent: (event: string) => engineRef.current?.onMediaEvent(event),
      rearmMic: () => engineRef.current?.rearmMic(),
    }),
    [snapshot],
  );
}
