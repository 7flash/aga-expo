import { saveAgentRun } from './db';
import { measured } from './measure';
import { askAssistant } from './openai';

type MaybeJsxlm = {
  spawnAgent?: (input: any) => Promise<any> | any;
  createAgent?: (input: any) => Promise<any> | any;
  run?: (input: any) => Promise<any> | any;
  default?: any;
};

let jsxlmPromise: Promise<MaybeJsxlm | null> | null = null;

async function loadJsxlm() {
  if (!jsxlmPromise) {
    jsxlmPromise = (async () => {
      try {
        const dynamicImport = new Function('specifier', 'return import(specifier)') as (
          specifier: string
        ) => Promise<MaybeJsxlm>;
        return await dynamicImport('jsxlm');
      } catch {
        return null;
      }
    })();
  }

  return jsxlmPromise;
}

function stringifyResult(value: unknown) {
  if (typeof value === 'string') return value.trim();
  if (!value) return '';
  try {
    return JSON.stringify(value, null, 2).slice(0, 8_000);
  } catch {
    return String(value).slice(0, 8_000);
  }
}

async function runWithJsxlm(goal: string, context: string[]) {
  const jsxlm = await loadJsxlm();
  if (!jsxlm) return null;

  const agentInput = {
    name: 'aga-on-demand',
    goal,
    context,
    policy: {
      voiceOnly: true,
      confirmBeforeExternalActions: true,
      conciseSpokenOutput: true,
    },
  };

  if (typeof jsxlm.spawnAgent === 'function') return stringifyResult(await jsxlm.spawnAgent(agentInput));
  if (typeof jsxlm.createAgent === 'function') {
    const agent = await jsxlm.createAgent(agentInput);
    if (typeof agent?.run === 'function') return stringifyResult(await agent.run(goal));
    return stringifyResult(agent);
  }
  if (typeof jsxlm.run === 'function') return stringifyResult(await jsxlm.run(agentInput));
  if (typeof jsxlm.default?.spawnAgent === 'function') return stringifyResult(await jsxlm.default.spawnAgent(agentInput));
  if (typeof jsxlm.default?.run === 'function') return stringifyResult(await jsxlm.default.run(agentInput));

  return null;
}

export async function runAgentTask(goal: string, context: string[] = []) {
  return measured('agent.run', async () => {
    saveAgentRun({ goal, agentName: 'aga-on-demand', status: 'running', payload: { context } as any });

    try {
      const jsxlmResult = await runWithJsxlm(goal, context);
      if (jsxlmResult) {
        saveAgentRun({ goal, agentName: 'aga-on-demand', status: 'completed', result: jsxlmResult });
        return {
          provider: 'jsxlm',
          result: jsxlmResult,
        };
      }

      const fallback = await askAssistant([
        {
          role: 'user',
          content: [
            'Handle this as an on-demand agent task for a voice-only assistant.',
            'Break it into concrete next steps. Mention any limits. Keep it concise enough to read aloud.',
            context.length ? `Context:\n${context.join('\n')}` : '',
            `Goal: ${goal}`,
          ]
            .filter(Boolean)
            .join('\n\n'),
        },
      ]);

      saveAgentRun({ goal, agentName: 'aga-fallback', status: 'fallback', result: fallback });
      return {
        provider: 'openai-fallback',
        result: fallback,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Agent task failed.';
      saveAgentRun({ goal, agentName: 'aga-on-demand', status: 'failed', result: message });
      throw error;
    }
  });
}
