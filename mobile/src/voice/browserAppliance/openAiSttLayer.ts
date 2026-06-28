import { transcribeWithOpenAI } from '../../ai/openaiStt';
import type { ShortUtteranceAudio } from '../shortUtteranceRecorder';
import type { BrowserSttLayer } from './types';

export class OpenAiSttLayer implements BrowserSttLayer {
  readonly name = 'openai-stt';

  async transcribe(audio: ShortUtteranceAudio) {
    return transcribeWithOpenAI(audio);
  }
}
