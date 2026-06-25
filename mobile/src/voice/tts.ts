import { Platform } from "react-native";
import { getPersona } from "../aga/personas";
import type { Preferences } from "../db/localStore";
import { measureAsync, measureMark } from "../observability/measure";

declare function require(name: string): any;

type TtsProvider = "expo-speech" | "web-speech" | "none";

type TtsCallbacks = {
  onStart?: () => void;
  onDone?: () => void;
  onError?: (message: string) => void;
};

type TtsDiagnostics = {
  provider: TtsProvider;
  available: boolean;
  unlocked: boolean;
  speaking: boolean;
  starts: number;
  finishes: number;
  errors: number;
  lastError: string | null;
  lastStartedAt: string | null;
  lastFinishedAt: string | null;
  lastTextChars: number;
};

let speaking = false;
let currentUtterance: any | null = null;
let cachedSpeech: any | null | undefined;

const diagnostics: TtsDiagnostics = {
  provider: "none",
  available: false,
  unlocked: false,
  speaking: false,
  starts: 0,
  finishes: 0,
  errors: 0,
  lastError: null,
  lastStartedAt: null,
  lastFinishedAt: null,
  lastTextChars: 0,
};

async function importSpeech() {
  if (cachedSpeech !== undefined) return cachedSpeech;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    cachedSpeech = require("expo-speech");
  } catch {
    cachedSpeech = null;
  }
  return cachedSpeech;
}

function getWebSpeech() {
  if (Platform.OS !== "web") return null;
  const root: any = globalThis as any;
  const synth = root.speechSynthesis;
  const Utterance = root.SpeechSynthesisUtterance;
  if (!synth || !Utterance) return null;
  return { synth, Utterance };
}

function finish(callbacks?: TtsCallbacks, error?: string) {
  speaking = false;
  diagnostics.speaking = false;
  diagnostics.lastFinishedAt = new Date().toISOString();
  diagnostics.finishes += 1;
  if (error) {
    diagnostics.errors += 1;
    diagnostics.lastError = error;
    callbacks?.onError?.(error);
    measureMark("voice.tts.error", { message: error });
  }
  callbacks?.onDone?.();
}

function chooseWebVoice(locale: string) {
  const web = getWebSpeech();
  if (!web?.synth?.getVoices) return null;
  const voices: any[] = web.synth.getVoices?.() ?? [];
  const wanted = locale.toLowerCase();
  return (
    voices.find((voice) => voice.lang?.toLowerCase() === wanted) ??
    voices.find((voice) => voice.lang?.toLowerCase().startsWith(wanted.split("-")[0])) ??
    voices[0] ??
    null
  );
}

export function getTtsDiagnostics(): TtsDiagnostics {
  return { ...diagnostics, speaking };
}

export async function isTtsAvailable() {
  const web = getWebSpeech();
  if (web) return true;
  const Speech = await importSpeech();
  return !!Speech?.speak;
}

/**
 * Best-effort browser audio unlock. Must be called from a user gesture on web.
 * It intentionally speaks a silent space so AGA can speak later without failing
 * silently under browser autoplay / speech-synthesis policies.
 */
export async function primeTts(locale = "en-US") {
  return measureAsync("voice.tts.prime", async () => {
    const web = getWebSpeech();
    if (web) {
      diagnostics.provider = "web-speech";
      diagnostics.available = true;
      try {
        const utterance = new web.Utterance(" ");
        utterance.lang = locale;
        utterance.volume = 0;
        utterance.rate = 1;
        utterance.pitch = 1;
        web.synth.cancel?.();
        web.synth.speak(utterance);
        diagnostics.unlocked = true;
        diagnostics.lastError = null;
        measureMark("voice.tts.unlocked", { provider: "web-speech" });
        return true;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error ?? "web speech prime failed");
        diagnostics.lastError = message;
        diagnostics.errors += 1;
        measureMark("voice.tts.prime.error", { provider: "web-speech", message });
        return false;
      }
    }

    const Speech = await importSpeech();
    if (Speech?.speak) {
      diagnostics.provider = "expo-speech";
      diagnostics.available = true;
      diagnostics.unlocked = true;
      return true;
    }

    diagnostics.provider = "none";
    diagnostics.available = false;
    diagnostics.lastError = "No speech synthesis provider is available.";
    return false;
  }, { platform: Platform.OS, locale });
}

export async function stopSpeaking() {
  return measureAsync("voice.tts.stop", async () => {
    speaking = false;
    diagnostics.speaking = false;
    currentUtterance = null;

    const web = getWebSpeech();
    try {
      web?.synth?.cancel?.();
    } catch {
      // ignore browser teardown issues
    }

    const Speech = await importSpeech();
    try {
      await Speech?.stop?.();
    } catch {
      // ignore native/web TTS teardown issues
    }
  });
}

async function speakWithWebSpeech(clean: string, prefs: Preferences, callbacks?: TtsCallbacks) {
  const web = getWebSpeech();
  if (!web) return false;
  diagnostics.provider = "web-speech";
  diagnostics.available = true;

  const persona = getPersona(prefs.persona);
  await stopSpeaking();

  return new Promise<boolean>((resolve) => {
    let settled = false;
    const done = (ok: boolean, error?: string) => {
      if (settled) return;
      settled = true;
      currentUtterance = null;
      finish(callbacks, error);
      resolve(ok);
    };

    try {
      const utterance = new web.Utterance(clean);
      currentUtterance = utterance;
      utterance.lang = prefs.voiceLocale || "en-US";
      utterance.rate = persona.rate;
      utterance.pitch = persona.pitch;
      utterance.volume = 1;
      const selectedVoice = chooseWebVoice(utterance.lang);
      if (selectedVoice) utterance.voice = selectedVoice;

      utterance.onstart = () => {
        diagnostics.unlocked = true;
        measureMark("voice.tts.web.start", { chars: clean.length, voice: selectedVoice?.name ?? null });
      };
      utterance.onend = () => done(true);
      utterance.onerror = (event: any) => {
        const message = String(event?.error || event?.message || "web speech synthesis error");
        done(false, message);
      };

      speaking = true;
      diagnostics.speaking = true;
      diagnostics.starts += 1;
      diagnostics.lastStartedAt = new Date().toISOString();
      diagnostics.lastTextChars = clean.length;
      diagnostics.lastError = null;
      callbacks?.onStart?.();
      web.synth.cancel?.();
      web.synth.speak(utterance);

      // Some browsers fail silently when speech synthesis is locked. Resolve so
      // the engine can recover instead of staying in speaking mode forever.
      setTimeout(() => {
        if (!settled && speaking && web.synth.paused) {
          done(false, "Browser speech synthesis appears paused or locked. AGA will still show replies in the feed.");
        }
      }, 1200);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error ?? "web speech synthesis failed");
      done(false, message);
    }
  });
}

async function speakWithExpoSpeech(clean: string, prefs: Preferences, callbacks?: TtsCallbacks) {
  const Speech = await importSpeech();
  if (!Speech?.speak) return false;
  diagnostics.provider = "expo-speech";
  diagnostics.available = true;

  const persona = getPersona(prefs.persona);
  await stopSpeaking();

  return new Promise<boolean>((resolve) => {
    let settled = false;
    const done = (ok: boolean, error?: string) => {
      if (settled) return;
      settled = true;
      finish(callbacks, error);
      resolve(ok);
    };

    try {
      speaking = true;
      diagnostics.speaking = true;
      diagnostics.starts += 1;
      diagnostics.lastStartedAt = new Date().toISOString();
      diagnostics.lastTextChars = clean.length;
      diagnostics.lastError = null;
      callbacks?.onStart?.();
      Speech.speak(clean, {
        language: prefs.voiceLocale || "en-US",
        rate: persona.rate,
        pitch: persona.pitch,
        onDone: () => done(true),
        onStopped: () => done(true),
        onError: (error: any) => done(false, String(error?.message || error || "expo speech error")),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error ?? "expo speech failed");
      done(false, message);
    }
  });
}

export async function speak(text: string, prefs: Preferences, callbacks?: TtsCallbacks) {
  return measureAsync("voice.tts.speak", async () => {
    const clean = text.trim();
    if (!clean) {
      callbacks?.onDone?.();
      return false;
    }

    // Prefer direct Web Speech on web because it gives us start/end/error events
    // and better visibility than the expo-speech web shim.
    if (Platform.OS === "web") {
      const webOk = await speakWithWebSpeech(clean, prefs, callbacks);
      if (webOk) return true;
      // Fall through to expo-speech if the browser provider is absent/locked.
    }

    const expoOk = await speakWithExpoSpeech(clean, prefs, callbacks);
    if (expoOk) return true;

    const message = "No speech synthesis provider is available. On native, install/rebuild expo-speech.";
    diagnostics.provider = "none";
    diagnostics.available = false;
    finish(callbacks, message);
    return false;
  }, { chars: text.length, platform: Platform.OS });
}

export function isSpeaking() {
  return speaking;
}
