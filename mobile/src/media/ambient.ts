export type AmbientKind = 'calm' | 'rain' | 'ocean' | 'forest' | 'brown_noise' | 'pink_noise' | 'breathing';

export type AmbientResult = {
  type: 'ambient';
  kind: AmbientKind;
  title: string;
  query?: string;
  state: 'loading' | 'playing' | 'paused' | 'stopped';
  source: 'local_ambient';
};

function normalize(value: string) {
  return String(value || '').trim().toLowerCase();
}

export function classifyAmbientIntent(query: string): { kind: AmbientKind; title: string } | null {
  const clean = normalize(query);
  if (!clean) return null;

  const wantsMusic =
    /\b(play|start|put on|background|calm|soft|quiet|relaxing|ambient|lofi|lo-fi|sleep|study|focus|meditation|music|song|soundscape|noise|rain|ocean|forest|nature|breathing)\b/i.test(clean) ||
    /(музык|спокойн|космическ|эмбиент|амбиент|фон|фонов|релакс|успокаива|сон|медитац|дожд|океан|лес)/i.test(clean) ||
    /(musik|música|musique|音楽|音乐)/i.test(clean);

  if (!wantsMusic) return null;

  if (/\b(rain|storm|shower)\b/i.test(clean) || /дожд/i.test(clean)) {
    return { kind: 'rain', title: 'local rain soundscape' };
  }
  if (/\b(ocean|sea|waves|beach)\b/i.test(clean) || /(океан|море|волны)/i.test(clean)) {
    return { kind: 'ocean', title: 'local ocean soundscape' };
  }
  if (/\b(forest|birds|nature|jungle)\b/i.test(clean) || /(лес|природ)/i.test(clean)) {
    return { kind: 'forest', title: 'local forest soundscape' };
  }
  if (/\b(brown noise|deep noise)\b/i.test(clean)) {
    return { kind: 'brown_noise', title: 'local brown noise' };
  }
  if (/\b(pink noise)\b/i.test(clean)) {
    return { kind: 'pink_noise', title: 'local pink noise' };
  }
  if (/\b(breathing|breath|meditation|calm me|nervous system)\b/i.test(clean) || /(дых|медитац)/i.test(clean)) {
    return { kind: 'breathing', title: 'local breathing ambience' };
  }

  // Broad “play music / calm ambient music” should not use YouTube by default.
  // YouTube embed availability is not deterministic without the Data API/server.
  return { kind: 'calm', title: 'local calm ambient music' };
}

export function resolveLocalAmbient(query: string): AmbientResult | null {
  const preset = classifyAmbientIntent(query);
  if (!preset) return null;
  return {
    type: 'ambient',
    kind: preset.kind,
    title: preset.title,
    query,
    state: 'playing',
    source: 'local_ambient',
  };
}