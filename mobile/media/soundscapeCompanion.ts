import { resolveLocalAmbient, type AmbientResult } from './ambient';
import { listSoundscapePreferences, saveSoundscapePreference } from '../db/localStore';

export type SoundscapePlan = AmbientResult & {
  companion: true;
  ducking: 'conversation' | 'guided' | 'none';
  volume: number;
  spokenLabel: string;
};

function inferVolume(useCase: string) {
  const clean = useCase.toLowerCase();
  if (/sleep|bedtime|hypnosis/.test(clean)) return 28;
  if (/conversation|conflict|talk/.test(clean)) return 24;
  if (/focus|study|work/.test(clean)) return 38;
  return 34;
}

export async function resolveSoundscapeCompanion(query: string, useCase = 'conversation'): Promise<SoundscapePlan | null> {
  const prefs = await listSoundscapePreferences(useCase, 1).catch(() => [] as any[]);
  const preferred = prefs[0];
  const ambient = resolveLocalAmbient(preferred?.kind ? `${preferred.kind} ${query}` : query) ?? resolveLocalAmbient(`${query} ambient soundscape`);
  if (!ambient) return null;
  const volume = preferred?.volume != null ? Number(preferred.volume) : inferVolume(useCase);
  return {
    ...ambient,
    companion: true,
    ducking: /guided|hypnosis|meditation|breath/.test(useCase) ? 'guided' : 'conversation',
    volume,
    spokenLabel: `${ambient.title} companion`,
  };
}

export async function rememberSoundscapeUse(kind: string, label: string, useCase: string, volume?: number) {
  return saveSoundscapePreference({ kind, label, useCase, volume: volume ?? inferVolume(useCase), confidence: 0.66 });
}
