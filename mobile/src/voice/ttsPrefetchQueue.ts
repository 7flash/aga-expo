import { prefetchElevenLabsAudio, speakWithElevenLabs, type ElevenLabsEmotion } from './elevenLabsTts';

type QueueItem = {
  id: string;
  text: string;
  emotion: ElevenLabsEmotion;
  uri: string | null;
  promise: Promise<string | null> | null;
};

const queue: QueueItem[] = [];
const MAX_PREFETCH = 3;

function idFor(text: string, index: number) {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  return `guided-${index}-${Math.abs(hash)}`;
}

export function clearTtsPrefetchQueue() {
  queue.splice(0, queue.length);
}

export function prefetchGuidedSegments(segments: string[], emotion: ElevenLabsEmotion = 'guided') {
  clearTtsPrefetchQueue();
  for (const [index, text] of segments.slice(0, MAX_PREFETCH).entries()) {
    const item: QueueItem = { id: idFor(text, index), text, emotion, uri: null, promise: null };
    item.promise = prefetchElevenLabsAudio(text, { emotion, cacheKey: item.id }).then((uri) => {
      item.uri = uri;
      return uri;
    }).catch(() => null);
    queue.push(item);
  }
}

export async function speakNextPrefetchedSegment(fallbackText?: string, emotion: ElevenLabsEmotion = 'guided') {
  const next = queue.shift();
  if (!next) {
    if (!fallbackText) return false;
    return speakWithElevenLabs(fallbackText, { emotion });
  }
  await next.promise?.catch(() => null);
  // The native player currently speaks by text so the same path handles
  // diagnostics and fallback uniformly. The prefetched URI is retained for the
  // future native zero-gap player; until then this still warms cache/network.
  return speakWithElevenLabs(next.text || fallbackText || '', { emotion: next.emotion, cacheKey: next.id });
}
