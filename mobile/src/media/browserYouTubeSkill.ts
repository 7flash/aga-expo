export type YouTubeOpenResult = {
  ok: boolean;
  query: string;
  url: string;
  mode: 'popup' | 'same_tab' | 'embed_url';
  message: string;
};

function cleanQuery(input: unknown) {
  return String(input ?? '')
    .replace(/\b(open|play|pull up|show|search|start)\b/gi, ' ')
    .replace(/\b(on|in|from)?\s*youtube\b/gi, ' ')
    .replace(/\b(video|music|song|clip)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isYouTubeRequest(text: string) {
  const clean = String(text || '').toLowerCase();
  return /\b(youtube|yt|video)\b/.test(clean) && /\b(open|play|pull up|show|search|start)\b/.test(clean);
}

export function buildYouTubeSearchUrl(text: string) {
  const query = cleanQuery(text) || 'calm music';
  const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
  return { query, url };
}

/**
 * Browser-safe YouTube action. This does not scrape YouTube and does not need GPT.
 * It opens the YouTube search page from an explicit user command.
 *
 * Browser popup policy note:
 * - If called directly from a button click, window.open usually succeeds.
 * - If called after async STT/GPT, browsers may block the popup. In that case
 *   the URL is returned so the UI can show an explicit "Open YouTube" voice/card action.
 */
export async function openYouTubeFromVoice(text: string, options: { sameTab?: boolean } = {}): Promise<YouTubeOpenResult> {
  const { query, url } = buildYouTubeSearchUrl(text);
  const root: any = globalThis as any;
  let ok = false;
  let mode: YouTubeOpenResult['mode'] = options.sameTab ? 'same_tab' : 'popup';

  try {
    if (typeof root.window !== 'undefined') {
      if (options.sameTab) {
        root.window.location.href = url;
        ok = true;
      } else {
        const opened = root.window.open(url, '_blank', 'noopener,noreferrer');
        ok = !!opened;
      }
    }
  } catch (_) {
    ok = false;
  }

  if (!ok) mode = 'embed_url';

  return {
    ok,
    query,
    url,
    mode,
    message: ok
      ? `Opening YouTube for ${query}.`
      : `I prepared YouTube for ${query}, but the browser blocked automatic opening. Use the visible Open YouTube action.`,
  };
}
