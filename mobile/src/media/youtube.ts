export type YouTubeResult = {
  videoId: string;
  title: string;
  thumbnailUrl: string | null;
  url: string;
  query?: string;
  embedHtml?: string;
  /** Direct embeddable URL for WebView/iframe. Prefer this over srcdoc on web. */
  playerUrl?: string;
  source: 'preset' | 'youtube_api' | 'remote' | 'embed_search' | 'direct';
};

function env(name: string) {
  return process.env?.[name] ?? '';
}

function htmlEscape(value: string) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function jsString(value: string) {
  return JSON.stringify(String(value));
}

export function safeYouTubeVideoId(videoId: string) {
  const match = String(videoId || '').match(/^[a-zA-Z0-9_-]{11}$/);
  if (!match) throw new Error('Unsafe YouTube video id.');
  return match[0];
}

export function extractYouTubeVideoId(raw: string): string | null {
  const value = String(raw || '').trim();
  const direct = value.match(/^[a-zA-Z0-9_-]{11}$/)?.[0];
  if (direct) return safeYouTubeVideoId(direct);
  const patterns = [
    /(?:youtube\.com\/watch\?v=)([a-zA-Z0-9_-]{11})/i,
    /(?:youtu\.be\/)([a-zA-Z0-9_-]{11})/i,
    /(?:youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/i,
    /(?:youtube\.com\/shorts\/)([a-zA-Z0-9_-]{11})/i,
  ];
  for (const pattern of patterns) {
    const id = value.match(pattern)?.[1];
    if (id) return safeYouTubeVideoId(id);
  }
  return null;
}

function originParam() {
  if (typeof globalThis === 'undefined') return '';
  const location = (globalThis as any).location;
  if (!location?.origin) return '';
  return `&origin=${encodeURIComponent(location.origin)}`;
}

export function youtubeVideoPlayerUrl(videoId: string) {
  const safeId = safeYouTubeVideoId(videoId);
  return `https://www.youtube-nocookie.com/embed/${safeId}?autoplay=1&playsinline=1&controls=1&rel=0&modestbranding=1&enablejsapi=1${originParam()}`;
}

export function youtubeSearchPlayerUrl(query: string) {
  const clean = query.trim();
  return `https://www.youtube.com/embed?listType=search&list=${encodeURIComponent(clean)}&autoplay=1&playsinline=1&controls=1&rel=0&modestbranding=1&enablejsapi=1${originParam()}`;
}

type PlayerHtmlInput =
  | { videoId: string; query?: never; title?: string }
  | { videoId?: never; query: string; title?: string };

export function youtubePlayerHtml(input: PlayerHtmlInput) {
  const hasVideo = !!input.videoId;
  const safeId = hasVideo ? safeYouTubeVideoId(input.videoId) : '';
  const query = input.query?.trim() ?? '';
  const title = input.title?.trim() || query || 'YouTube';
  const fallbackUrl = hasVideo ? youtubeVideoPlayerUrl(safeId) : youtubeSearchPlayerUrl(query);

  return `<!doctype html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
html,body,#player,.fallback-frame{margin:0;width:100%;height:100%;background:#050817;overflow:hidden}
body{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;color:white}
.fallback{display:flex;align-items:center;justify-content:center;height:100%;padding:20px;text-align:center;background:linear-gradient(135deg,#050817,#10162f)}
.fallback a{color:#67e8f9;font-weight:800;text-decoration:none}
</style>
</head>
<body>
<div id="player"></div>
<script src="https://www.youtube.com/iframe_api"></script>
<script>
var player;
var fallbackUrl=${jsString(fallbackUrl)};
var mode=${jsString(hasVideo ? 'video' : 'search')};
function tell(type,payload){try{window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(JSON.stringify(Object.assign({type:type},payload||{})));}catch(e){}}
function makeFallback(){
  var el=document.getElementById('player');
  el.innerHTML='<iframe class="fallback-frame" src="'+fallbackUrl+'" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen frameborder="0"></iframe>';
  tell('player.playing',{fallback:true});
}
function onYouTubeIframeAPIReady(){
  try{
    var config={
      width:'100%',
      height:'100%',
      playerVars:{autoplay:1,playsinline:1,controls:1,rel:0,modestbranding:1,enablejsapi:1},
      events:{
        onReady:function(e){try{e.target.playVideo();}catch(err){} tell('player.ready')},
        onStateChange:function(e){if(e.data===0)tell('player.ended'); if(e.data===1)tell('player.playing'); if(e.data===2)tell('player.paused'); if(e.data===3)tell('player.buffering');},
        onError:function(e){tell('player.error',{code:e&&e.data}); makeFallback();}
      }
    };
    if(mode==='video') config.videoId=${jsString(safeId)};
    else config.playerVars=Object.assign(config.playerVars,{listType:'search',list:${jsString(query)}});
    player=new YT.Player('player',config);
  } catch(e) {
    tell('player.error',{message:String(e)});
    makeFallback();
  }
}
setTimeout(function(){ if(!player) makeFallback(); }, 2200);
document.addEventListener('message',function(event){handle(event.data)});
window.addEventListener('message',function(event){handle(event.data)});
function handle(raw){try{var msg=typeof raw==='string'?JSON.parse(raw):raw; if(!player)return; if(msg.type==='pause')player.pauseVideo(); if(msg.type==='resume')player.playVideo(); if(msg.type==='stop')player.stopVideo(); if(msg.type==='volume')player.setVolume(msg.value||50);}catch(e){}}
</script>
<noscript><div class="fallback"><a href="${htmlEscape(fallbackUrl)}">Open ${htmlEscape(title)} on YouTube</a></div></noscript>
</body>
</html>`;
}

export function youtubeEmbedHtml(videoId: string) {
  return youtubePlayerHtml({ videoId });
}

export function youtubeSearchEmbedHtml(query: string) {
  return youtubePlayerHtml({ query: query.trim(), title: query.trim() });
}

function normalizeRemoteResult(data: any, query: string, source: YouTubeResult['source']): YouTubeResult | null {
  const first = data?.video ?? data?.result ?? data?.items?.[0] ?? data?.videos?.[0] ?? data?.results?.[0];
  const videoId = first?.videoId ?? first?.id?.videoId ?? first?.id ?? first?.ref;
  if (!videoId || typeof videoId !== 'string') return null;
  const safeId = safeYouTubeVideoId(videoId);
  const title = first?.title ?? first?.snippet?.title ?? query;
  return {
    videoId: safeId,
    title,
    thumbnailUrl: first?.thumbnailUrl ?? first?.thumbnail ?? first?.artworkUrl ?? first?.snippet?.thumbnails?.high?.url ?? `https://i.ytimg.com/vi/${safeId}/hqdefault.jpg`,
    url: first?.url ?? `https://www.youtube.com/watch?v=${safeId}`,
    embedHtml: youtubePlayerHtml({ videoId: safeId, title }),
    playerUrl: youtubeVideoPlayerUrl(safeId),
    source,
  };
}

function remoteBackendConfig() {
  const base =
    env('EXPO_PUBLIC_AGA_YOUTUBE_BACKEND_URL') ||
    env('EXPO_PUBLIC_AGA_REMOTE_BACKEND_URL') ||
    env('EXPO_PUBLIC_ASSISTANT_WEB_URL');
  const token =
    env('EXPO_PUBLIC_AGA_YOUTUBE_BACKEND_TOKEN') ||
    env('EXPO_PUBLIC_AGA_REMOTE_BACKEND_TOKEN');
  return { base: base.replace(/\/$/, ''), token };
}

async function searchRemoteYouTube(query: string): Promise<YouTubeResult | null> {
  const { base, token } = remoteBackendConfig();
  if (!base || /localhost|127\.0\.0\.1/i.test(base)) return null;
  const response = await fetch(`${base}/api/youtube`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ query, limit: 1 }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) return null;
  return normalizeRemoteResult(data, query, 'remote');
}

async function searchYouTubeDataApi(query: string): Promise<YouTubeResult | null> {
  const key = env('EXPO_PUBLIC_YOUTUBE_API_KEY') || env('EXPO_PUBLIC_GOOGLE_API_KEY');
  if (!key) return null;
  const params = new URLSearchParams({
    key,
    part: 'snippet',
    type: 'video',
    maxResults: '1',
    safeSearch: 'moderate',
    q: query,
  });
  const response = await fetch(`https://www.googleapis.com/youtube/v3/search?${params.toString()}`);
  const data = await response.json().catch(() => null);
  if (!response.ok) return null;
  return normalizeRemoteResult(data, query, 'youtube_api');
}

function genericPreset(query: string): YouTubeResult | null {
  const lower = query.toLowerCase().trim();
  const explicitId = extractYouTubeVideoId(query);
  if (explicitId) {
    return {
      videoId: explicitId,
      title: query,
      thumbnailUrl: `https://i.ytimg.com/vi/${explicitId}/hqdefault.jpg`,
      url: `https://www.youtube.com/watch?v=${explicitId}`,
      embedHtml: youtubePlayerHtml({ videoId: explicitId, title: query }),
      playerUrl: youtubeVideoPlayerUrl(explicitId),
      source: 'direct',
    };
  }

  const configured = env('EXPO_PUBLIC_AGA_DEFAULT_MUSIC_VIDEO_ID');
  const defaultMusicId = configured && /^[a-zA-Z0-9_-]{11}$/.test(configured) ? configured : 'jfKfPfyJRdk';
  const looksGenericMusic = /^(some\s+)?(music|songs?|lofi|lo-fi|chill|focus music|relaxing music|study music)( please| for me)?$/.test(lower)
    || /\b(lofi|lo-fi|chill beats|focus music|study music)\b/.test(lower);
  if (!looksGenericMusic) return null;

  const title = lower.includes('lofi') || lower.includes('study') || lower.includes('focus')
    ? 'lofi focus music'
    : 'calm music';
  return {
    videoId: safeYouTubeVideoId(defaultMusicId),
    title,
    thumbnailUrl: `https://i.ytimg.com/vi/${defaultMusicId}/hqdefault.jpg`,
    url: `https://www.youtube.com/watch?v=${defaultMusicId}`,
    embedHtml: youtubePlayerHtml({ videoId: defaultMusicId, title }),
    playerUrl: youtubeVideoPlayerUrl(defaultMusicId),
    source: 'preset',
  };
}

function searchEmbedFallback(query: string): YouTubeResult {
  const clean = query.trim();
  const encoded = encodeURIComponent(clean);
  return {
    videoId: '',
    title: clean,
    thumbnailUrl: null,
    url: `https://www.youtube.com/results?search_query=${encoded}`,
    query: clean,
    embedHtml: youtubeSearchEmbedHtml(clean),
    playerUrl: youtubeSearchPlayerUrl(clean),
    source: 'embed_search',
  };
}

export async function searchYouTube(query: string): Promise<YouTubeResult> {
  const clean = query.trim();
  if (!clean) throw new Error('YouTube search query is empty.');

  const preset = genericPreset(clean);
  if (preset) return preset;

  const api = await searchYouTubeDataApi(clean).catch(() => null);
  if (api?.videoId) return api;

  const remote = await searchRemoteYouTube(clean).catch(() => null);
  if (remote?.videoId) return remote;

  // Never scrape youtube.com/results in the client. Web blocks it with CORS and
  // mobile WebView scraping is fragile. Fall back to an embeddable search player.
  return searchEmbedFallback(clean);
}
