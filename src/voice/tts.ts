import * as Speech from 'expo-speech';
import type { Persona } from '../aga/personas';

export async function stopSpeaking() {
  try {
    Speech.stop();
  } catch {
    // best effort
  }
}

export function speak(text: string, persona: Persona, onDone?: () => void) {
  Speech.stop();
  Speech.speak(text.slice(0, Speech.maxSpeechInputLength || 4000), {
    rate: persona.speechRate,
    pitch: persona.pitch,
    onDone,
    onStopped: onDone,
    onError: onDone,
  });
}

export async function isSpeaking() {
  try {
    return Speech.isSpeakingAsync();
  } catch {
    return false;
  }
}
