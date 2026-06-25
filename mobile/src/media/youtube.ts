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
  | { videoId: string; query?: never; title?: string; fallbackVideoIds?: string[] }
  | { videoId?: never; query: string; title?: string; fallbackVideoIds?: string[] };

export function youtubePlayerHtml(input: PlayerHtmlInput) {
  const hasVideo = !!input.videoId;
  const safeId = hasVideo ? safeYouTubeVideoId(input.videoId) : '';
  const query = input.query?.trim() ?? '';
  const title = input.title?.trim() || query || 'YouTube';
  const fallbackUrl = hasVideo ? youtubeVideoPlayerUrl(safeId) : youtubeSearchPlayerUrl(query);
  const fallbackVideoIds = Array.from(new Set((input.fallbackVideoIds ?? fallbackIdsFor(safeId || '')).filter((id) => /^[a-zA-Z0-9_-]{11}$/.test(id)))).slice(0, 4);

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
var pendingVolume=null;
var hasPlayed=false;
var fallbackUrl=${jsString(fallbackUrl)};
var mode=${jsString(hasVideo ? 'video' : 'search')};
var primaryVideoId=${jsString(safeId)};
var fallbackVideoIds=${JSON.stringify(fallbackVideoIds)};
var fallbackIndex=0;
function tell(type,payload){try{window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(JSON.stringify(Object.assign({type:type},payload||{})));}catch(e){}}
function tryVideoFallback(reason){
  try{
    while(fallbackIndex<fallbackVideoIds.length && fallbackVideoIds[fallbackIndex]===primaryVideoId) fallbackIndex++;
    if(!player || !player.loadVideoById || fallbackIndex>=fallbackVideoIds.length) return false;
    var next=fallbackVideoIds[fallbackIndex++];
    primaryVideoId=next;
    hasPlayed=false;
    tell('player.fallback',{reason:reason,videoId:next});
    player.loadVideoById(next);
    if(pendingVolume!==null && player.setVolume) player.setVolume(pendingVolume);
    setTimeout(function(){try{if(player && !hasPlayed) player.playVideo();}catch(e){}}, 450);
    return true;
  }catch(e){return false;}
}
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
        onReady:function(e){try{if(pendingVolume!==null)e.target.setVolume(pendingVolume); e.target.playVideo();}catch(err){} tell('player.ready')},
        onStateChange:function(e){if(e.data===0)tell('player.ended'); if(e.data===1){hasPlayed=true; tell('player.playing');} if(e.data===2)tell('player.paused'); if(e.data===3)tell('player.buffering');},
        onError:function(e){tell('player.error',{code:e&&e.data}); if(!tryVideoFallback('error')) makeFallback();}
      }
    };
    if(mode==='video') config.videoId=${jsString(safeId)};
    else config.playerVars=Object.assign(config.playerVars,{listType:'search',list:${jsString(query)}});
    player=new YT.Player('player',config);
    setTimeout(function(){ if(player && !hasPlayed) tryVideoFallback('no_playback_watchdog'); }, 6500);
  } catch(e) {
    tell('player.error',{message:String(e)});
    makeFallback();
  }
}
setTimeout(function(){ if(!player) makeFallback(); }, 2200);
document.addEventListener('message',function(event){handle(event.data)});
window.addEventListener('message',function(event){handle(event.data)});
function handle(raw){try{var msg=typeof raw==='string'?JSON.parse(raw):raw; if(msg.type==='volume'){pendingVolume=Math.max(0,Math.min(100,Number(msg.value)||50)); if(player&&player.setVolume)player.setVolume(pendingVolume); return;} if(!player)return; if(msg.type==='pause')player.pauseVideo(); if(msg.type==='resume')player.playVideo(); if(msg.type==='stop')player.stopVideo();}catch(e){}}
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



const KNOWN_BAD_YOUTUBE_IDS = new Set([
  // 24/7/live IDs or IDs seen returning “live stream recording is not available”.
  'jfKfPfyJRdk',
  '2OEL4P1Rz04',
  '5qap5aO4i9A',
  'GMrwWG1KjdU',
  'CFGLoQIhmow',
  'lTRiuFIWV54',
  'n61ULEU7CO0',
]);

const SAFE_MUSIC_PRESETS: Record<'music' | 'lofi' | 'ambient' | 'sleep', { env: string; fallback: string; title: string; alternates: string[] }> = {
  // Broad music intent must never use live streams. One broken embed makes the
  // whole voice product feel broken, so use stable normal videos first.
  music: { env: 'EXPO_PUBLIC_AGA_DEFAULT_MUSIC_VIDEO_ID', fallback: 'MNBq0pP3jHA', title: 'calm music', alternates: ['UfcAVejslrU', '1ZYbU82GVz4', 'zJ7hUvU-d2Q'] },
  ambient: { env: 'EXPO_PUBLIC_AGA_AMBIENT_VIDEO_ID', fallback: 'MNBq0pP3jHA', title: 'calm ambient music', alternates: ['UfcAVejslrU', '1ZYbU82GVz4', 'zJ7hUvU-d2Q'] },
  sleep: { env: 'EXPO_PUBLIC_AGA_SLEEP_MUSIC_VIDEO_ID', fallback: 'MNBq0pP3jHA', title: 'soft sleep music', alternates: ['UfcAVejslrU', '1ZYbU82GVz4', 'zJ7hUvU-d2Q'] },
  lofi: { env: 'EXPO_PUBLIC_AGA_LOFI_VIDEO_ID', fallback: 'UfcAVejslrU', title: 'lofi focus music', alternates: ['MNBq0pP3jHA', '1ZYbU82GVz4', 'zJ7hUvU-d2Q'] },
};

function isUsablePresetId(id: string) {
  return /^[a-zA-Z0-9_-]{11}$/.test(id) && !KNOWN_BAD_YOUTUBE_IDS.has(id);
}

function presetId(kind: 'music' | 'lofi' | 'ambient' | 'sleep') {
  const preset = SAFE_MUSIC_PRESETS[kind];
  const configured = env(preset.env) || env('EXPO_PUBLIC_AGA_DEFAULT_MUSIC_VIDEO_ID') || '';
  const id = isUsablePresetId(configured) ? configured : preset.fallback;
  return safeYouTubeVideoId(id);
}

function fallbackIdsFor(videoId: string, kind?: 'music' | 'lofi' | 'ambient' | 'sleep') {
  const candidates = [
    ...(kind ? SAFE_MUSIC_PRESETS[kind].alternates : []),
    SAFE_MUSIC_PRESETS.ambient.fallback,
    SAFE_MUSIC_PRESETS.sleep.fallback,
    SAFE_MUSIC_PRESETS.music.fallback,
    SAFE_MUSIC_PRESETS.lofi.fallback,
  ];
  return Array.from(new Set(candidates))
    .filter((id) => isUsablePresetId(id) && id !== videoId)
    .slice(0, 4);
}

function classifyBroadMusicPreset(query: string): { kind: 'music' | 'lofi' | 'ambient' | 'sleep'; title: string } | null {
  const lower = query.toLowerCase().trim();
  // Realtime often expands “play music” into user-language searches such as
  // “спокойная космическая музыка ambient”. Search-list embeds are unreliable
  // and often show “This video is unavailable”, so broad music intent should be
  // resolved to known embeddable presets unless a YouTube API/backend is set.
  const broadMusicIntent = /^(?:play|put on|start|some|background|calm|soft|quiet|relaxing|ambient|lofi|lo-fi|sleep|study|focus|meditation|music|songs?|soundscape|youtube music|calm music|play music)\b/i.test(lower)
    || /\b(background music|calm music|soft music|relaxing music|ambient music|sleep music|study music|focus music|lofi music|lo-fi music|music companion)\b/i.test(lower)
    || /(спокойн|космическ|эмбиент|амбиент|фон|фонов|релакс|успокаива|сон|медитац)/i.test(lower)
    || /^(?:music|musik|música|musique|音楽|音乐)$/i.test(lower);
  if (!broadMusicIntent) return null;
  if (/\b(lofi|lo-fi|study|focus|beats)\b/i.test(lower)) return { kind: 'lofi', title: 'lofi focus music' };
  if (/\b(ambient|cosmic|space|soundscape|meditation|calm|relax|relaxing)\b/i.test(lower) || /(спокойн|космическ|эмбиент|амбиент|медитац|релакс|успокаива)/i.test(lower)) {
    return { kind: 'ambient', title: 'calm ambient music' };
  }
  if (/\b(sleep|bedtime|night)\b/i.test(lower) || /(сон|ноч)/i.test(lower)) return { kind: 'sleep', title: 'soft sleep music' };
  return { kind: 'music', title: 'calm music' };
}

function genericPreset(query: string): YouTubeResult | null {
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

  const preset = classifyBroadMusicPreset(query);
  if (!preset) return null;
  const id = presetId(preset.kind);
  return {
    videoId: safeYouTubeVideoId(id),
    title: preset.title,
    thumbnailUrl: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
    url: `https://www.youtube.com/watch?v=${id}`,
    embedHtml: youtubePlayerHtml({ videoId: id, title: preset.title, fallbackVideoIds: fallbackIdsFor(id, preset.kind) }),
    playerUrl: youtubeVideoPlayerUrl(id),
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

  const explicitId = extractYouTubeVideoId(clean);
  if (explicitId) return genericPreset(explicitId)!;

  // Broad music intent should be deterministic. Let explicit URLs/IDs and exact
  // searches use API/server, but plain “play music/calm music” uses local safe
  // presets immediately so the model cannot expand it into a broken search.
  const broadPreset = genericPreset(clean);
  if (broadPreset && broadPreset.source === 'preset') return broadPreset;

  const api = await searchYouTubeDataApi(clean).catch(() => null);
  if (api?.videoId && !KNOWN_BAD_YOUTUBE_IDS.has(api.videoId)) return api;

  const remote = await searchRemoteYouTube(clean).catch(() => null);
  if (remote?.videoId && !KNOWN_BAD_YOUTUBE_IDS.has(remote.videoId)) return remote;

  if (broadPreset) return broadPreset;

  // Never scrape youtube.com/results in the client. Web blocks it with CORS and
  // mobile WebView scraping is fragile. Fall back to an embeddable search player.
  return searchEmbedFallback(clean);
}
