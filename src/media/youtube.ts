export type YouTubeResult = {
  videoId: string;
  title: string;
  thumbnailUrl: string | null;
  url: string;
};

export function youtubeEmbedHtml(videoId: string) {
  return `<!doctype html>
<html><head><meta name="viewport" content="width=device-width, initial-scale=1" /><style>
html,body,#player{margin:0;width:100%;height:100%;background:#050817;overflow:hidden}
</style></head><body><div id="player"></div><script src="https://www.youtube.com/iframe_api"></script><script>
var player;
function onYouTubeIframeAPIReady(){player=new YT.Player('player',{videoId:'${videoId}',playerVars:{autoplay:1,playsinline:1,controls:1,rel:0},events:{onReady:function(e){e.target.playVideo();}}});}
document.addEventListener('message',function(event){handle(event.data)});
window.addEventListener('message',function(event){handle(event.data)});
function handle(raw){try{var msg=JSON.parse(raw); if(!player)return; if(msg.type==='pause')player.pauseVideo(); if(msg.type==='resume')player.playVideo(); if(msg.type==='stop')player.stopVideo(); if(msg.type==='volume')player.setVolume(msg.value||50);}catch(e){}}
</script></body></html>`;
}

export async function searchYouTube(query: string): Promise<YouTubeResult> {
  const encoded = encodeURIComponent(query);
  const response = await fetch(`https://www.youtube.com/results?search_query=${encoded}`);
  const html = await response.text();
  const match = html.match(/"videoId":"([a-zA-Z0-9_-]{11})"/);
  const videoId = match?.[1];
  if (!videoId) {
    return {
      videoId: '',
      title: query,
      thumbnailUrl: null,
      url: `https://www.youtube.com/results?search_query=${encoded}`,
    };
  }
  return {
    videoId,
    title: query,
    thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    url: `https://www.youtube.com/watch?v=${videoId}`,
  };
}
