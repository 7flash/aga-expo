import { getRuntimeContractIssues, summarizeRuntimeContract } from './runtimeContract';

export type StartupSelfTestResult = {
  ok: boolean;
  summary: string;
  issues: ReturnType<typeof getRuntimeContractIssues>;
};

export async function runStartupSelfTest(): Promise<StartupSelfTestResult> {
  const issues = getRuntimeContractIssues();
  const ok = !issues.some((issue) => issue.severity === 'error');
  return { ok, summary: summarizeRuntimeContract(), issues };
}

export function spokenStartupSelfTest(result: StartupSelfTestResult) {
  if (result.ok) return 'AGA appliance checks passed.';
  const first = result.issues.find((issue) => issue.severity === 'error');
  return first ? `AGA needs attention. ${first.message}` : 'AGA checks completed with warnings.';
}
