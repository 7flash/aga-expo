export type MusicTrack = {
  id: string;
  title: string;
  artist: string;
  album?: string | null;
  previewUrl: string;
  artworkUrl?: string | null;
};

export function audioPreviewHtml(url: string) {
  const safe = url.replace(/"/g, '%22');
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1" /><style>
html,body{margin:0;width:100%;height:100%;background:#050817;color:white;font-family:system-ui;display:grid;place-items:center} audio{width:92%}.label{font-size:12px;opacity:.72;margin-bottom:8px;text-align:center}</style></head><body><div><div class="label">AGA music preview</div><audio id="audio" src="${safe}" controls autoplay></audio></div><script>
var audio=document.getElementById('audio');
document.addEventListener('message',function(event){handle(event.data)}); window.addEventListener('message',function(event){handle(event.data)});
function handle(raw){try{var msg=JSON.parse(raw); if(msg.type==='pause')audio.pause(); if(msg.type==='resume')audio.play(); if(msg.type==='stop'){audio.pause();audio.currentTime=0;} if(msg.type==='volume')audio.volume=Math.max(0,Math.min(1,(msg.value||50)/100));}catch(e){}}
</script></body></html>`;
}

export async function searchMusic(query: string): Promise<MusicTrack | null> {
  const url = new URL('https://itunes.apple.com/search');
  url.searchParams.set('term', query);
  url.searchParams.set('media', 'music');
  url.searchParams.set('entity', 'song');
  url.searchParams.set('limit', '1');
  const response = await fetch(url.toString());
  const data = await response.json();
  const track = data?.results?.find((item: any) => item.previewUrl && item.trackName && item.artistName);
  if (!track) return null;
  return {
    id: String(track.trackId ?? `${track.artistName}-${track.trackName}`),
    title: track.trackName,
    artist: track.artistName,
    album: track.collectionName ?? null,
    previewUrl: track.previewUrl,
    artworkUrl: typeof track.artworkUrl100 === 'string' ? track.artworkUrl100.replace('100x100bb', '512x512bb') : null,
  };
}
