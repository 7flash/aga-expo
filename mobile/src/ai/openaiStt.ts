import type { ShortUtteranceAudio } from '../voice/shortUtteranceRecorder';

function env(name: string) {
  return process.env?.[name] ?? '';
}

async function optionalImport(specifier: string): Promise<any | null> {
  try { return await (Function('s', 'return import(s)') as any)(specifier); } catch { return null; }
}

function apiKey() {
  return env('EXPO_PUBLIC_OPENAI_API_KEY') || env('OPENAI_API_KEY');
}

function model() {
  return env('EXPO_PUBLIC_OPENAI_STT_MODEL') || 'gpt-4o-mini-transcribe';
}

async function fileFromNativeUri(audio: Extract<ShortUtteranceAudio, { kind: 'native_uri' }>) {
  const fs = await optionalImport('expo-file-system');
  if (!fs?.readAsStringAsync) throw new Error('expo-file-system is required to upload native recorded audio.');
  const base64 = await fs.readAsStringAsync(audio.uri, { encoding: fs.EncodingType?.Base64 || 'base64' });
  const bytes = Uint8Array.from(globalThis.atob(base64), (c) => c.charCodeAt(0));
  return new File([bytes], `aga-utterance.${audio.mimeType.includes('wav') ? 'wav' : 'm4a'}`, { type: audio.mimeType });
}

async function audioToFile(audio: ShortUtteranceAudio) {
  if (audio.kind === 'web_blob') return new File([audio.blob], 'aga-utterance.webm', { type: audio.mimeType });
  if (audio.kind === 'native_uri') return fileFromNativeUri(audio);
  const bytes = Uint8Array.from(globalThis.atob(audio.base64), (c) => c.charCodeAt(0));
  return new File([bytes], 'aga-utterance.wav', { type: audio.mimeType });
}

export async function transcribeWithOpenAI(audio: ShortUtteranceAudio): Promise<string> {
  const key = apiKey();
  if (!key) throw new Error('Missing EXPO_PUBLIC_OPENAI_API_KEY for OpenAI STT.');
  const form = new FormData();
  form.append('model', model());
  form.append('file', await audioToFile(audio));
  form.append('response_format', 'json');
  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || data?.message || 'OpenAI transcription failed.');
  return String(data?.text || '').trim();
}
