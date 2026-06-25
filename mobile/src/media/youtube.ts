import { getPreferences } from '../db/preferences';

export type YouTubeResult = {
  videoId: string;
  title: string;
  thumbnailUrl: string | null;
  url: string;
};

export function safeYouTubeVideoId(videoId: string) {
  const match = String(videoId || '').match(/^[a-zA-Z0-9_-]{11}$/);
  if (!match) throw new Error('Unsafe YouTube video id.');
  return match[0];
}

export function youtubeEmbedHtml(videoId: string) {
  const safeId = safeYouTubeVideoId(videoId);
  return `<!doctype html>
<html>
<head>
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
html,body,#player{margin:0;width:100%;height:100%;background:#050817;overflow:hidden}
body{font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif}
</style>
</head>
<body>
<div id="player"></div>
<script src="https://www.youtube.com/iframe_api"></script>
<script>
var player;
function tell(type,payload){try{window.ReactNativeWebView&&window.ReactNativeWebView.postMessage(JSON.stringify(Object.assign({type:type},payload||{})));}catch(e){}}
function onYouTubeIframeAPIReady(){
  player=new YT.Player('player',{
    videoId:'${safeId}',
    playerVars:{autoplay:1,playsinline:1,controls:1,rel:0,modestbranding:1},
    events:{
      onReady:function(e){e.target.playVideo();tell('player.playing')},
      onStateChange:function(e){if(e.data===0)tell('player.ended'); if(e.data===1)tell('player.playing'); if(e.data===2)tell('player.paused');},
      onError:function(){tell('player.error')}
    }
  });
}
document.addEventListener('message',function(event){handle(event.data)});
window.addEventListener('message',function(event){handle(event.data)});
function handle(raw){try{var msg=JSON.parse(raw); if(!player)return; if(msg.type==='pause')player.pauseVideo(); if(msg.type==='resume')player.playVideo(); if(msg.type==='stop')player.stopVideo(); if(msg.type==='volume')player.setVolume(msg.value||50);}catch(e){}}
</script>
</body>
</html>`;
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
  };
}

async function searchRemoteYouTube(query: string): Promise<YouTubeResult | null> {
  const prefs = await getPreferences();
  if (!prefs.remoteBackendUrl) return null;
  const base = prefs.remoteBackendUrl.replace(/\/$/, '');
  const response = await fetch(`${base}/api/youtube`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(prefs.remoteBackendToken ? { Authorization: `Bearer ${prefs.remoteBackendToken}` } : {}),
    },
    body: JSON.stringify({ query, limit: 1 }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) return null;
  return normalizeRemoteResult(data, query);
}

async function searchHtmlFallback(query: string): Promise<YouTubeResult> {
  const encoded = encodeURIComponent(query);
  const response = await fetch(`https://www.youtube.com/results?search_query=${encoded}`);
  const html = await response.text();
  const matches = [...html.matchAll(/"videoId":"([a-zA-Z0-9_-]{11})"/g)].map((match) => match[1]);
  const videoId = matches.find((id, index) => matches.indexOf(id) === index) ?? '';
  if (!videoId) {
    return { videoId: '', title: query, thumbnailUrl: null, url: `https://www.youtube.com/results?search_query=${encoded}` };
  }
  const safeId = safeYouTubeVideoId(videoId);
  return {
    videoId: safeId,
    title: query,
    thumbnailUrl: `https://i.ytimg.com/vi/${safeId}/hqdefault.jpg`,
    url: `https://www.youtube.com/watch?v=${safeId}`,
  };
}

export async function searchYouTube(query: string): Promise<YouTubeResult> {
  const clean = query.trim();
  if (!clean) throw new Error('YouTube search query is empty.');
  const remote = await searchRemoteYouTube(clean).catch(() => null);
  if (remote?.videoId) return remote;
  return searchHtmlFallback(clean);
}
