export type YouTubeResult = {
  videoId: string;
  title: string;
  thumbnailUrl: string | null;
  url: string;
  /** Present when we cannot resolve a single video id locally, especially on web because YouTube search blocks CORS. */
  query?: string;
  /** Ready-to-render player HTML. Allows search playback without scraping YouTube. */
  embedHtml?: string;
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

type PlayerHtmlInput =
  | { videoId: string; query?: never; title?: string }
  | { videoId?: never; query: string; title?: string };

export function youtubePlayerHtml(input: PlayerHtmlInput) {
  const hasVideo = !!input.videoId;
  const safeId = hasVideo ? safeYouTubeVideoId(input.videoId) : '';
  const query = input.query?.trim() ?? '';
  const title = input.title?.trim() || query || 'YouTube';
  const searchEmbedUrl = `https://www.youtube.com/embed?listType=search&list=${encodeURIComponent(query)}&autoplay=1&playsinline=1&controls=1&rel=0&modestbranding=1&enablejsapi=1`;

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
var searchUrl=${jsString(searchEmbedUrl)};
var mode=${jsString(hasVideo ? 'video' : 'search')};
function tell(type,payload){try{window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(JSON.stringify(Object.assign({type:type},payload||{})));}catch(e){}}
function makeFallback(){
  var el=document.getElementById('player');
  el.innerHTML='<iframe class="fallback-frame" src="'+searchUrl+'" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen frameborder="0"></iframe>';
  tell('player.playing',{fallback:true});
}
function onYouTubeIframeAPIReady(){
  try{
    var config={
      width:'100%',
      height:'100%',
      playerVars:{autoplay:1,playsinline:1,controls:1,rel:0,modestbranding:1,enablejsapi:1},
      events:{
        onReady:function(e){try{e.target.playVideo();}catch(err){} tell('player.playing')},
        onStateChange:function(e){if(e.data===0)tell('player.ended'); if(e.data===1)tell('player.playing'); if(e.data===2)tell('player.paused');},
        onError:function(e){tell('player.error',{code:e&&e.data}); if(mode==='search') makeFallback();}
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
setTimeout(function(){ if(!player && mode==='search') makeFallback(); }, 2500);
document.addEventListener('message',function(event){handle(event.data)});
window.addEventListener('message',function(event){handle(event.data)});
function handle(raw){try{var msg=typeof raw==='string'?JSON.parse(raw):raw; if(!player)return; if(msg.type==='pause')player.pauseVideo(); if(msg.type==='resume')player.playVideo(); if(msg.type==='stop')player.stopVideo(); if(msg.type==='volume')player.setVolume(msg.value||50);}catch(e){}}
</script>
<noscript><div class="fallback"><a href="https://www.youtube.com/results?search_query=${encodeURIComponent(query || title)}">Open ${htmlEscape(title)} on YouTube</a></div></noscript>
</body>
</html>`;
}

export function youtubeEmbedHtml(videoId: string) {
  return youtubePlayerHtml({ videoId });
}

export function youtubeSearchEmbedHtml(query: string) {
  return youtubePlayerHtml({ query: query.trim(), title: query.trim() });
}

function normalizeRemoteResult(data: any, query: string): YouTubeResult | null {
  const first = data?.video ?? data?.result ?? data?.items?.[0] ?? data?.videos?.[0] ?? data?.results?.[0];
  const videoId = first?.videoId ?? first?.id ?? first?.ref;
  if (!videoId || typeof videoId !== 'string') return null;
  const safeId = safeYouTubeVideoId(videoId);
  return {
    videoId: safeId,
    title: first?.title ?? query,
    thumbnailUrl: first?.thumbnailUrl ?? first?.thumbnail ?? first?.artworkUrl ?? `https://i.ytimg.com/vi/${safeId}/hqdefault.jpg`,
    url: first?.url ?? `https://www.youtube.com/watch?v=${safeId}`,
    embedHtml: youtubePlayerHtml({ videoId: safeId, title: first?.title ?? query }),
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
  return normalizeRemoteResult(data, query);
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
  };
}

export async function searchYouTube(query: string): Promise<YouTubeResult> {
  const clean = query.trim();
  if (!clean) throw new Error('YouTube search query is empty.');
  const remote = await searchRemoteYouTube(clean).catch(() => null);
  if (remote?.videoId) return remote;

  // Do not scrape YouTube search pages from the client. It is blocked by CORS on web
  // and fragile on device. The search embed lets YouTube resolve/play results itself.
  return searchEmbedFallback(clean);
}
