const ALLOWED_AUDIO_HOSTS = new Set([
  'audio-ssl.itunes.apple.com',
  'audio.itunes.apple.com',
  'aod.itunes.apple.com',
]);

export async function GET(req: Request) {
  const requestUrl = new URL(req.url);
  const rawUrl = requestUrl.searchParams.get('url');

  if (!rawUrl) {
    return Response.json({ error: 'Missing audio URL.' }, { status: 400 });
  }

  let sourceUrl: URL;

  try {
    sourceUrl = new URL(rawUrl);
  } catch {
    return Response.json({ error: 'Invalid audio URL.' }, { status: 400 });
  }

  if (sourceUrl.protocol !== 'https:' || !ALLOWED_AUDIO_HOSTS.has(sourceUrl.hostname)) {
    return Response.json({ error: 'Audio source is not allowed.' }, { status: 400 });
  }

  const upstreamHeaders = new Headers({
    Accept: 'audio/*,*/*;q=0.8',
    'User-Agent': 'GeeksyMusicPreview/1.0',
  });

  const range = req.headers.get('range');
  if (range) upstreamHeaders.set('Range', range);

  const upstream = await fetch(sourceUrl, {
    headers: upstreamHeaders,
  });

  if (!upstream.ok || !upstream.body) {
    return Response.json({ error: 'Could not load audio preview.' }, { status: 502 });
  }

  const headers = new Headers();
  headers.set('Content-Type', upstream.headers.get('content-type') ?? 'audio/mp4');
  headers.set('Cache-Control', 'public, max-age=86400');
  headers.set('Accept-Ranges', upstream.headers.get('accept-ranges') ?? 'bytes');

  const contentLength = upstream.headers.get('content-length');
  if (contentLength) headers.set('Content-Length', contentLength);

  const contentRange = upstream.headers.get('content-range');
  if (contentRange) headers.set('Content-Range', contentRange);

  return new Response(upstream.body, { status: upstream.status, headers });
}
