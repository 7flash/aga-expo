import { Platform } from 'react-native';
import type { ShortUtteranceAudio } from '../voice/shortUtteranceRecorder';

export type OpenAiSttDiagnostics = {
  model: string;
  platform: string;
  kind: ShortUtteranceAudio['kind'];
  mimeType: string;
  filename: string;
  durationMs: number;
  sizeBytes?: number;
  status?: number;
  ok?: boolean;
  responseText?: string;
  errorMessage?: string;
};

export class OpenAiSttError extends Error {
  diagnostics: OpenAiSttDiagnostics;
  constructor(message: string, diagnostics: OpenAiSttDiagnostics) {
    super(message);
    this.name = 'OpenAiSttError';
    this.diagnostics = diagnostics;
  }
}

function env(name: string) {
  return process.env?.[name] ?? '';
}

function apiKey() {
  return env('EXPO_PUBLIC_OPENAI_API_KEY') || env('OPENAI_API_KEY');
}

function model() {
  return env('EXPO_PUBLIC_OPENAI_STT_MODEL') || 'gpt-4o-mini-transcribe';
}

function normalizedMime(type: string) {
  const clean = String(type || '').toLowerCase();
  if (clean.includes('webm')) return 'audio/webm';
  if (clean.includes('wav')) return 'audio/wav';
  if (clean.includes('mp4') || clean.includes('m4a') || clean.includes('aac')) return 'audio/mp4';
  if (clean.includes('mpeg') || clean.includes('mp3')) return 'audio/mpeg';
  if (clean.includes('ogg')) return 'audio/ogg';
  if (clean.includes('flac')) return 'audio/flac';
  return clean || 'audio/webm';
}

function extensionForMime(type: string) {
  const clean = normalizedMime(type);
  if (clean.includes('wav')) return 'wav';
  if (clean.includes('webm')) return 'webm';
  if (clean.includes('mp4') || clean.includes('m4a') || clean.includes('aac')) return 'm4a';
  if (clean.includes('mpeg') || clean.includes('mp3')) return 'mp3';
  if (clean.includes('ogg')) return 'ogg';
  if (clean.includes('flac')) return 'flac';
  return 'webm';
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

async function audioSize(audio: ShortUtteranceAudio) {
  if (audio.kind === 'web_blob') return audio.blob.size;
  if (audio.kind === 'base64') return Math.floor(audio.base64.length * 0.75);
  return undefined;
}

async function appendAudio(form: FormData, audio: ShortUtteranceAudio, diagnostics: OpenAiSttDiagnostics) {
  const mimeType = normalizedMime(audio.mimeType || diagnostics.mimeType);
  diagnostics.mimeType = mimeType;
  diagnostics.filename = `aga-utterance.${extensionForMime(mimeType)}`;

  if (audio.kind === 'web_blob') {
    if (!audio.blob || audio.blob.size < 128) {
      throw new OpenAiSttError('Captured browser audio blob is empty or too small for STT.', {
        ...diagnostics,
        sizeBytes: audio.blob?.size ?? 0,
      });
    }

    // Some browsers put codec details in the blob type. OpenAI accepts webm/mp4/wav/etc;
    // sending a normalized type avoids odd multipart metadata like audio/webm;codecs=opus.
    const normalizedBlob = audio.blob.type === mimeType ? audio.blob : audio.blob.slice(0, audio.blob.size, mimeType);
    const FileCtor = (globalThis as any).File;
    if (typeof FileCtor === 'function') {
      form.append('file', new FileCtor([normalizedBlob], diagnostics.filename, { type: mimeType }));
    } else {
      form.append('file', normalizedBlob as any, diagnostics.filename);
    }
    diagnostics.sizeBytes = normalizedBlob.size;
    return;
  }

  if (audio.kind === 'native_uri') {
    form.append('file', {
      uri: audio.uri,
      name: diagnostics.filename,
      type: mimeType,
    } as any);
    return;
  }

  const bytes = base64ToBytes(audio.base64);
  if (bytes.byteLength < 128) {
    throw new OpenAiSttError('Captured base64 audio is empty or too small for STT.', {
      ...diagnostics,
      sizeBytes: bytes.byteLength,
    });
  }
  const BlobCtor = (globalThis as any).Blob;
  if (typeof BlobCtor === 'function') {
    form.append('file', new BlobCtor([bytes], { type: mimeType }) as any, diagnostics.filename);
  } else if (Platform.OS !== 'web') {
    throw new Error('Base64 audio upload needs Blob support or a native file URI. Prefer native_uri recordings on Android.');
  }
  diagnostics.sizeBytes = bytes.byteLength;
}

function parseResponse(text: string) {
  try { return JSON.parse(text); } catch { return null; }
}

export async function transcribeWithOpenAI(audio: ShortUtteranceAudio): Promise<string> {
  const result = await transcribeWithOpenAIDiagnostics(audio);
  return result.text;
}

export async function transcribeWithOpenAIDiagnostics(audio: ShortUtteranceAudio): Promise<{ text: string; diagnostics: OpenAiSttDiagnostics; raw: unknown }> {
  const key = apiKey();
  const diagnostics: OpenAiSttDiagnostics = {
    model: model(),
    platform: Platform.OS,
    kind: audio.kind,
    mimeType: normalizedMime(audio.mimeType || 'audio/webm'),
    filename: `aga-utterance.${extensionForMime(audio.mimeType || 'audio/webm')}`,
    durationMs: Math.round(audio.durationMs || 0),
    sizeBytes: await audioSize(audio),
  };

  if (!key) {
    throw new OpenAiSttError('Missing EXPO_PUBLIC_OPENAI_API_KEY for OpenAI STT.', diagnostics);
  }
  if (diagnostics.durationMs < 250) {
    throw new OpenAiSttError('Captured audio is too short. Record at least 1 second for the STT lab.', diagnostics);
  }

  const form = new FormData();
  form.append('model', diagnostics.model);
  form.append('response_format', 'json');
  await appendAudio(form, audio, diagnostics);

  let response: Response;
  try {
    response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      body: form,
    });
  } catch (error) {
    diagnostics.errorMessage = error instanceof Error ? error.message : String(error);
    throw new OpenAiSttError(`OpenAI transcription network failure: ${diagnostics.errorMessage}`, diagnostics);
  }

  diagnostics.status = response.status;
  diagnostics.ok = response.ok;
  const responseText = await response.text().catch(() => '');
  diagnostics.responseText = responseText.slice(0, 2000);
  const data = parseResponse(responseText) || {};
  if (!response.ok) {
    const message = data?.error?.message || data?.message || responseText || `OpenAI transcription failed with HTTP ${response.status}.`;
    diagnostics.errorMessage = message;
    throw new OpenAiSttError(message, diagnostics);
  }
  const text = String((data as any)?.text || '').trim();
  return { text, diagnostics, raw: data };
}
