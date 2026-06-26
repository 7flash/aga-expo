import { describeArchitectureFlags } from '../runtime/architectureFlags';
import { getRuntimeContractIssues } from '../runtime/runtimeContract';
import { describeKeywordContract } from '../wake/keywordContract';
import { describeTtsOrder } from '../voice/ttsProviderOrder';

export type ApplianceDiagnosticReport = {
  ok: boolean;
  lines: string[];
};

export function buildApplianceDiagnosticReport(): ApplianceDiagnosticReport {
  const issues = getRuntimeContractIssues();
  const lines = [
    describeArchitectureFlags(),
    describeKeywordContract(),
    describeTtsOrder(),
    ...issues.map((issue) => `${issue.severity.toUpperCase()} ${issue.code}: ${issue.message}`),
  ];
  return { ok: !issues.some((issue) => issue.severity === 'error'), lines };
}

export function speakableApplianceDiagnostic(report = buildApplianceDiagnosticReport()) {
  if (report.ok) return 'AGA appliance diagnostics passed. Wake, voice, display, and guided-session policies are aligned.';
  const firstError = report.lines.find((line) => line.startsWith('ERROR'));
  return firstError ? `AGA diagnostics found a blocking issue. ${firstError}` : 'AGA diagnostics found warnings.';
}
