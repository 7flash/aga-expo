export type AgaKeywordIndex = 0 | 1 | 2;
export type AgaKeywordAction = 'wake' | 'stop' | 'pause';

export const AGA_KEYWORD_FILES = ['aga.ppn', 'stop.ppn', 'pause.ppn'] as const;

export const AGA_KEYWORD_INDEX: Record<AgaKeywordAction, AgaKeywordIndex> = {
  wake: 0,
  stop: 1,
  pause: 2,
};

export function keywordActionFromIndex(index: number): AgaKeywordAction | null {
  if (index === 0) return 'wake';
  if (index === 1) return 'stop';
  if (index === 2) return 'pause';
  return null;
}

export function parseKeywordPaths(raw = process.env.EXPO_PUBLIC_AGA_PORCUPINE_KEYWORDS || AGA_KEYWORD_FILES.join(',')) {
  const paths = String(raw).split(',').map((p) => p.trim()).filter(Boolean);
  if (paths.length < 3) return [...AGA_KEYWORD_FILES];
  return paths.slice(0, 3);
}

export function describeKeywordContract() {
  const paths = parseKeywordPaths();
  return `Porcupine keyword contract: 0=${paths[0]} wake, 1=${paths[1]} stop, 2=${paths[2]} pause.`;
}
