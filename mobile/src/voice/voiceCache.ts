import { measureMark } from '../observability/measure';

declare function require(name: string): any;

type FileSystemModule = {
  cacheDirectory?: string;
  documentDirectory?: string;
  EncodingType?: { Base64?: string };
  getInfoAsync?: (uri: string) => Promise<{ exists: boolean; size?: number; modificationTime?: number }>;
  writeAsStringAsync?: (uri: string, contents: string, options?: Record<string, unknown>) => Promise<void>;
  readAsStringAsync?: (uri: string, options?: Record<string, unknown>) => Promise<string>;
  deleteAsync?: (uri: string, options?: Record<string, unknown>) => Promise<void>;
  makeDirectoryAsync?: (uri: string, options?: Record<string, unknown>) => Promise<void>;
  readDirectoryAsync?: (uri: string) => Promise<string[]>;
};

let cachedFs: FileSystemModule | null | undefined;

async function fsModule(): Promise<FileSystemModule | null> {
  if (cachedFs !== undefined) return cachedFs;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    cachedFs = require('expo-file-system');
  } catch {
    cachedFs = null;
  }
  return cachedFs;
}

function hashText(value: string) {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < value.length; i += 1) {
    const c = value.charCodeAt(i);
    h1 ^= c;
    h1 = Math.imul(h1, 0x01000193);
    h2 = Math.imul(h2 ^ c, 0x85ebca6b);
  }
  return `${(h1 >>> 0).toString(36)}${(h2 >>> 0).toString(36)}`;
}

function safePart(value: string) {
  return String(value || 'x').replace(/[^a-z0-9._-]+/gi, '-').slice(0, 60) || 'x';
}

export type VoiceCacheKey = {
  text: string;
  voiceId?: string | null;
  modelId?: string | null;
  emotion?: string | null;
  outputFormat?: string | null;
};

export async function voiceCacheDir() {
  const fs = await fsModule();
  const root = fs?.cacheDirectory || fs?.documentDirectory;
  if (!fs || !root) return null;
  const dir = `${root.replace(//$/, '')}/aga-voice-cache/`;
  try { await fs.makeDirectoryAsync?.(dir, { intermediates: true }); } catch { /* directory may exist */ }
  return dir;
}

export function voiceCacheFilename(key: VoiceCacheKey) {
  const raw = [
    key.voiceId || 'default',
    key.modelId || 'model',
    key.emotion || 'neutral',
    key.outputFormat || 'mp3',
    key.text.replace(/\s+/g, ' ').trim(),
  ].join('|');
  return `${safePart(key.emotion || 'voice')}-${hashText(raw)}.mp3`;
}

export async function voiceCacheUri(key: VoiceCacheKey) {
  const dir = await voiceCacheDir();
  if (!dir) return null;
  return `${dir}${voiceCacheFilename(key)}`;
}

export async function getCachedVoiceUri(key: VoiceCacheKey, maxAgeMs = 7 * 24 * 60 * 60_000) {
  const fs = await fsModule();
  const uri = await voiceCacheUri(key);
  if (!fs?.getInfoAsync || !uri) return null;
  const info = await fs.getInfoAsync(uri).catch(() => ({ exists: false }));
  if (!info?.exists) return null;
  const modifiedMs = typeof (info as any).modificationTime === 'number' ? (info as any).modificationTime * 1000 : Date.now();
  if (maxAgeMs > 0 && Date.now() - modifiedMs > maxAgeMs) {
    await fs.deleteAsync?.(uri, { idempotent: true }).catch(() => undefined);
    return null;
  }
  measureMark('voice.cache.hit', { uri: uri.split('/').pop() });
  return uri;
}

export async function writeVoiceCacheBase64(key: VoiceCacheKey, base64: string) {
  const fs = await fsModule();
  const uri = await voiceCacheUri(key);
  if (!fs?.writeAsStringAsync || !uri) return null;
  await fs.writeAsStringAsync(uri, base64, { encoding: fs.EncodingType?.Base64 ?? 'base64' });
  measureMark('voice.cache.write', { uri: uri.split('/').pop(), bytesApprox: Math.round(base64.length * 0.75) });
  return uri;
}

export async function pruneVoiceCache(maxFiles = 80) {
  const fs = await fsModule();
  const dir = await voiceCacheDir();
  if (!fs?.readDirectoryAsync || !fs?.getInfoAsync || !fs?.deleteAsync || !dir) return 0;
  const files = await fs.readDirectoryAsync(dir).catch(() => []);
  const infos = await Promise.all(files.map(async (name) => {
    const uri = `${dir}${name}`;
    const info = await fs.getInfoAsync!(uri).catch(() => ({ exists: false }));
    return { name, uri, exists: info.exists, modified: (info as any).modificationTime ?? 0 };
  }));
  const stale = infos.filter((x) => x.exists).sort((a, b) => b.modified - a.modified).slice(maxFiles);
  await Promise.all(stale.map((x) => fs.deleteAsync!(x.uri, { idempotent: true }).catch(() => undefined)));
  if (stale.length) measureMark('voice.cache.prune', { deleted: stale.length });
  return stale.length;
}