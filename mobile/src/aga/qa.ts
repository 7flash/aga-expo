import { parseVoiceCommand } from './actions';
import { localControlIntent } from './localControls';
import { detectWake, normalizeSpeech } from './text';

export type AgaQaCase = {
  name: string;
  input: string;
  expectAction: string;
};

export type AgaLocalControlQaCase = {
  name: string;
  input: string;
  expectTool: string;
};

export const AGA_VOICE_QA_CASES: AgaQaCase[] = [
  { name: 'help', input: 'Hey AGA help', expectAction: 'speak' },
  { name: 'memory save', input: 'Hey AGA remember that my project is AGA', expectAction: 'remember' },
  { name: 'memory recall', input: 'Hey AGA what do you remember', expectAction: 'recall' },
  { name: 'relative reminder digit', input: 'Hey AGA remind me to stretch in 1 minute', expectAction: 'add_reminder' },
  { name: 'relative reminder word', input: 'Hey AGA remind me to stretch in one minute', expectAction: 'add_reminder' },
  { name: 'tomorrow reminder', input: 'Hey AGA remind me to breathe tomorrow at 9:30', expectAction: 'add_reminder' },
  { name: 'youtube explicit', input: 'Hey AGA pull up relaxing piano on YouTube', expectAction: 'play_youtube' },
  { name: 'youtube generic play', input: 'Hey AGA play lo-fi study music', expectAction: 'play_youtube' },
  { name: 'pause media', input: 'Hey AGA pause', expectAction: 'media_pause' },
  { name: 'resume media', input: 'Hey AGA resume', expectAction: 'media_resume' },
  { name: 'stop media', input: 'Hey AGA close the video', expectAction: 'media_stop' },
  { name: 'translation', input: 'Hey AGA translate to Indonesian', expectAction: 'translate_start' },
  { name: 'status repair', input: 'Hey AGA repair yourself', expectAction: 'status' },
];

export const AGA_LOCAL_CONTROL_QA_CASES: AgaLocalControlQaCase[] = [
  { name: 'forget confirmation', input: 'AGA yes forget everything', expectTool: 'forget_user_data' },
  { name: 'new session', input: 'AGA start over', expectTool: 'start_new_conversation_session' },
  { name: 'body scan skill', input: 'AGA start body scan', expectTool: 'start_guided_session' },
  { name: 'hypnosis skill', input: 'AGA guide self hypnosis', expectTool: 'start_guided_session' },
  { name: 'conflict skill', input: 'AGA help resolve conflict', expectTool: 'start_guided_session' },
  { name: 'volume', input: 'AGA louder', expectTool: 'media_control' },
  { name: 'voice menu', input: 'AGA show voice settings', expectTool: 'show_settings_menu' },
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

export function runAgaLocalControlQa(cases = AGA_LOCAL_CONTROL_QA_CASES) {
  return cases.map((test) => {
    const intent = localControlIntent(test.input);
    return {
      ...test,
      pass: intent?.tool === test.expectTool,
      actual: intent?.tool ?? null,
    };
  });
}

export function runAgaWakeQa() {
  const cases = ['Hey AGA', 'AGA status', 'hey agar', 'hey angel'];
  return cases.map((input) => {
    const result = detectWake(normalizeSpeech(input), 'aga');
    return { input, pass: result.woke, result };
  });
}

export function assertAgaParserQa() {
  const parserResults = runAgaParserQa();
  const localResults = runAgaLocalControlQa();
  const wakeResults = runAgaWakeQa();
  const failed = [...parserResults, ...localResults, ...wakeResults].filter((result) => !result.pass);
  if (failed.length) {
    throw new Error(`AGA voice QA failed: ${failed.map((item: any) => `${item.name ?? item.input} expected ${item.expectAction ?? item.expectTool ?? 'wake'}, got ${Array.isArray(item.actual) ? item.actual.join(',') : item.actual ?? JSON.stringify(item.result)}`).join('; ')}`);
  }
  return { parserResults, localResults, wakeResults };
}
