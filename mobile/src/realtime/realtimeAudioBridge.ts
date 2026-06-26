import { PcmLiveStreamer, type PcmLiveTarget } from '../voice/pcmLiveStream';

export function createRealtimePcmBridge(target: PcmLiveTarget, sendJson: (value: unknown) => boolean | void, onStatus?: (status: string) => void, onError?: (message: string) => void) {
  return new PcmLiveStreamer({ target, sendJson, onStatus, onError });
}
