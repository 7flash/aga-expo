import { z } from 'sqlite-zod-orm';
import { saveMediaSession } from '../../../src/db';
import { measured } from '../../../src/measure';

const youtubeRequestSchema = z.object({
  query: z.string().trim().min(1).max(240),
  limit: z.number().int().min(1).max(8).optional().default(4),
});

type YouTubeSearchItem = {
  id?: { videoId?: string };
  snippet?: {
    title?: string;
    channelTitle?: string;
    description?: string;
    thumbnails?: { medium?: { url?: string }; high?: { url?: string } };
  };
};

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const parsed = youtubeRequestSchema.safeParse(body);

  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid YouTube search request.' },
      { status: 400 }
    );
  }

  return measured('youtube.search', async () => {
    const apiKey = process.env.YOUTUBE_API_KEY;
    const searchUrl = `https://www.youtube.com/results?search_query=${encodeURIComponent(parsed.data.query)}`;

    if (!apiKey) {
      saveMediaSession({ provider: 'youtube', query: parsed.data.query, status: 'failed', title: 'YouTube API key missing' });
      return Response.json({
        query: parsed.data.query,
        configured: false,
        searchUrl,
        videos: [],
        error: 'YOUTUBE_API_KEY is not set, so AGA cannot reliably auto-select and control the top video yet.',
      });
    }

    const url = new URL('https://www.googleapis.com/youtube/v3/search');
    url.searchParams.set('part', 'snippet');
    url.searchParams.set('type', 'video');
    url.searchParams.set('videoEmbeddable', 'true');
    url.searchParams.set('safeSearch', 'moderate');
    url.searchParams.set('maxResults', String(parsed.data.limit));
    url.searchParams.set('q', parsed.data.query);
    url.searchParams.set('key', apiKey);

    const response = await fetch(url, { headers: { Accept: 'application/json' } });
    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      return Response.json(
        { error: data?.error?.message ?? 'YouTube search failed.' },
        { status: response.status >= 400 && response.status < 500 ? response.status : 502 }
      );
    }

    const videos = (data.items ?? [])
      .filter((item: YouTubeSearchItem) => item.id?.videoId && item.snippet?.title)
      .map((item: YouTubeSearchItem) => ({
        id: item.id!.videoId!,
        title: item.snippet!.title!,
        channel: item.snippet?.channelTitle ?? 'YouTube',
        description: item.snippet?.description ?? '',
        thumbnailUrl: item.snippet?.thumbnails?.high?.url ?? item.snippet?.thumbnails?.medium?.url ?? null,
        url: `https://www.youtube.com/watch?v=${item.id!.videoId!}`,
      }));

    saveMediaSession({
      provider: 'youtube',
      query: parsed.data.query,
      status: videos.length ? 'started' : 'failed',
      title: videos[0]?.title ?? '',
      payload: JSON.stringify({ count: videos.length, searchUrl }),
    });

    return Response.json({ query: parsed.data.query, configured: true, searchUrl, videos });
  });
}
