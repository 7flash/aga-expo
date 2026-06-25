import { parseVoiceCommand } from './actions';

export type AgaQaCase = {
  name: string;
  input: string;
  expectAction: string;
};

export const AGA_VOICE_QA_CASES: AgaQaCase[] = [
  { name: 'help', input: 'Hey AGA help', expectAction: 'speak' },
  { name: 'memory save', input: 'Hey AGA remember that my project is AGA', expectAction: 'remember' },
  { name: 'memory recall', input: 'Hey AGA what do you remember', expectAction: 'recall' },
  { name: 'relative reminder', input: 'Hey AGA remind me to stretch in one minute', expectAction: 'add_reminder' },
  { name: 'youtube explicit', input: 'Hey AGA pull up relaxing piano on YouTube', expectAction: 'play_youtube' },
  { name: 'youtube generic play', input: 'Hey AGA play lo-fi study music', expectAction: 'play_youtube' },
  { name: 'pause media', input: 'Hey AGA pause', expectAction: 'media_pause' },
  { name: 'resume media', input: 'Hey AGA resume', expectAction: 'media_resume' },
  { name: 'stop media', input: 'Hey AGA close the video', expectAction: 'media_stop' },
  { name: 'translation', input: 'Hey AGA translate to Indonesian', expectAction: 'translate_start' },
];

export function runAgaParserQa(cases = AGA_VOICE_QA_CASES) {
  return cases.map((test) => {
    const turn = parseVoiceCommand(test.input);
    const actionTypes = turn.actions.map((action) => action.type);
    return {
      ...test,
      pass: actionTypes.includes(test.expectAction as any),
      actual: actionTypes,
      speech: turn.speech,
    };
  });
}

export function assertAgaParserQa() {
  const results = runAgaParserQa();
  const failed = results.filter((result) => !result.pass);
  if (failed.length) {
    throw new Error(`AGA parser QA failed: ${failed.map((item) => `${item.name} expected ${item.expectAction}, got ${item.actual.join(',')}`).join('; ')}`);
  }
  return results;
}
