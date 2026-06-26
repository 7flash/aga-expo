import { Platform } from 'react-native';
import type { ShortUtteranceAudio } from '../voice/shortUtteranceRecorder';

function env(name: string) {
  return process.env?.[name] ?? '';
}

function apiKey() {
  return env('EXPO_PUBLIC_OPENAI_API_KEY') || env('OPENAI_API_KEY');
}

function model() {
  return env('EXPO_PUBLIC_OPENAI_STT_MODEL') || 'gpt-4o-mini-transcribe';
}

function extensionForMime(type: string) {
  if (/wav/i.test(type)) return 'wav';
  if (/webm/i.test(type)) return 'webm';
  if (/mp4|m4a|aac/i.test(type)) return 'm4a';
  if (/mpeg|mp3/i.test(type)) return 'mp3';
  return 'wav';
}

function base64ToBytes(base64: string) {
  const atobFn = (globalThis as any).atob;
  if (typeof atobFn === 'function') {
    const bin = atobFn(base64);
    return Uint8Array.from(bin, (c: string) => c.charCodeAt(0));
  }
  const BufferCtor = (globalThis as any).Buffer;
  if (BufferCtor) return Uint8Array.from(BufferCtor.from(base64, 'base64'));
  throw new Error('No base64 decoder is available for OpenAI STT upload.');
}

function appendAudio(form: FormData, audio: ShortUtteranceAudio) {
  if (audio.kind === 'web_blob') {
    const name = `aga-utterance.${extensionForMime(audio.mimeType)}`;
    const FileCtor = (globalThis as any).File;
    if (typeof FileCtor === 'function') {
      form.append('file', new FileCtor([audio.blob], name, { type: audio.mimeType }));
    } else {
      form.append('file', audio.blob as any, name);
    }
    return;
  }

  if (audio.kind === 'native_uri') {
    // React Native FormData expects the file-like object shape. Avoid reading the
    // full audio file into JS memory when running on the Android appliance.
    form.append('file', {
      uri: audio.uri,
      name: `aga-utterance.${extensionForMime(audio.mimeType)}`,
      type: audio.mimeType,
    } as any);
    return;
  }

  const bytes = base64ToBytes(audio.base64);
  const mimeType = audio.mimeType || 'audio/wav';
  const name = `aga-utterance.${extensionForMime(mimeType)}`;
  const BlobCtor = (globalThis as any).Blob;
  if (typeof BlobCtor === 'function') {
    form.append('file', new BlobCtor([bytes], { type: mimeType }) as any, name);
  } else if (Platform.OS !== 'web') {
    throw new Error('Base64 audio upload needs Blob support or a native file URI. Prefer native_uri recordings on Android.');
  }
}

export async function transcribeWithOpenAI(audio: ShortUtteranceAudio): Promise<string> {
  const key = apiKey();
  if (!key) throw new Error('Missing EXPO_PUBLIC_OPENAI_API_KEY for OpenAI STT.');
  const form = new FormData();
  form.append('model', model());
  form.append('response_format', 'json');
  appendAudio(form, audio);
  const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error?.message || data?.message || 'OpenAI transcription failed.');
  return String(data?.text || '').trim();
}
