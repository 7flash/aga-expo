export type NowPlaying = {
  kind: 'youtube' | 'music' | null;
  title: string;
  subtitle?: string | null;
  artworkUrl?: string | null;
  ref?: string | null;
  query?: string | null;
  state: 'idle' | 'playing' | 'paused' | 'stopped';
};

export const EMPTY_NOW_PLAYING: NowPlaying = {
  kind: null,
  title: 'Nothing playing',
  state: 'idle',
};
