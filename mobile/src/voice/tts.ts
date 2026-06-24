import { getPersona } from '../aga/personas';
import type { Preferences } from '../db/localStore';

let speaking = false;

async function importSpeech() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('expo-speech');
  } catch {
    return null;
  }
}

export async function stopSpeaking() {
  const Speech = await importSpeech();
  speaking = false;
  try {
    await Speech?.stop?.();
  } catch {
    // ignore native TTS teardown issues
  }
}

export async function speak(text: string, prefs: Preferences, callbacks?: { onStart?: () => void; onDone?: () => void }) {
  const clean = text.trim();
  if (!clean) return;
  const Speech = await importSpeech();
  if (!Speech?.speak) return;
  const persona = getPersona(prefs.persona);
  await stopSpeaking();
  speaking = true;
  callbacks?.onStart?.();
  Speech.speak(clean, {
    language: prefs.voiceLocale || 'en-US',
    rate: persona.rate,
    pitch: persona.pitch,
    onDone: () => {
      speaking = false;
      callbacks?.onDone?.();
    },
    onStopped: () => {
      speaking = false;
      callbacks?.onDone?.();
    },
    onError: () => {
      speaking = false;
      callbacks?.onDone?.();
    },
  });
}

export function isSpeaking() {
  return speaking;
}
