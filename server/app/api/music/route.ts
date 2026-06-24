import { z } from 'sqlite-zod-orm';

const musicRequestSchema = z.object({
  query: z.string().trim().min(1).max(200),
  limit: z.number().int().min(1).max(12).optional().default(6),
});

type ITunesTrack = {
  trackId?: number;
  trackName?: string;
  artistName?: string;
  collectionName?: string;
  previewUrl?: string;
  artworkUrl100?: string;
  trackViewUrl?: string;
};

function upgradeArtwork(url?: string) {
  return url?.replace('100x100bb', '512x512bb') ?? null;
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = musicRequestSchema.safeParse(body);

  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid music search request.' },
      { status: 400 }
    );
  }

  const url = new URL('https://itunes.apple.com/search');
  url.searchParams.set('term', parsed.data.query);
  url.searchParams.set('media', 'music');
  url.searchParams.set('entity', 'song');
  url.searchParams.set('limit', String(parsed.data.limit));
  url.searchParams.set('country', process.env.ITUNES_COUNTRY ?? 'US');

  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/json',
      },
    });

    if (!response.ok) {
      return Response.json({ error: 'Music search failed.' }, { status: 502 });
    }

    const data = await response.json();
    const tracks = (data.results ?? [])
      .filter((track: ITunesTrack) => track.previewUrl && track.trackName && track.artistName)
      .map((track: ITunesTrack) => ({
        id: String(track.trackId ?? `${track.artistName}-${track.trackName}`),
        title: track.trackName,
        artist: track.artistName,
        album: track.collectionName ?? null,
        previewUrl: `/api/music/audio?url=${encodeURIComponent(track.previewUrl!)}`,
        sourcePreviewUrl: track.previewUrl,
        artworkUrl: upgradeArtwork(track.artworkUrl100),
        storeUrl: track.trackViewUrl ?? null,
      }));

    return Response.json({ query: parsed.data.query, tracks });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : 'Could not search music.' },
      { status: 500 }
    );
  }
}
