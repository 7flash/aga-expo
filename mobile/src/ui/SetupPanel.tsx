import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { SetupReport, SetupSeverity } from '../setup/readiness';
import { VOICE_ONLY_QA_STEPS, phaseSummary } from '../setup/qaScripts';

function severityText(severity: SetupSeverity) {
  if (severity === 'ok') return 'Ready';
  if (severity === 'warn') return 'Check';
  return 'Fix';
}

export function SetupPanel({
  report,
  visible,
  onRefresh,
  onRunQa,
  onCompleteSetup,
}: {
  report: SetupReport | null;
  visible: boolean;
  onRefresh: () => void;
  onRunQa: () => void;
  onCompleteSetup: () => void;
}) {
  if (!visible && report?.readyForVoiceOnly) return null;

  const topItems = report?.items ?? [];

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.kicker}>First-run / production readiness</Text>
          <Text style={styles.title}>{report ? `${report.score}% ready` : 'Checking AGA…'}</Text>
          <Text style={styles.copy}>{report?.summary ?? 'Run setup status to check voice, brain, memory, notifications, and recovery.'}</Text>
        </View>
        <View style={[styles.scoreBubble, report?.readyForVoiceOnly ? styles.readyBubble : styles.warnBubble]}>
          <Text style={styles.scoreText}>{report?.readyForVoiceOnly ? 'GO' : 'QA'}</Text>
        </View>
      </View>

      <View style={styles.itemList}>
        {topItems.map((item) => (
          <View key={item.key} style={styles.item}>
            <Text style={[styles.badge, styles[`badge_${item.severity}` as const]]}>{severityText(item.severity)}</Text>
            <View style={styles.itemCopy}>
              <Text style={styles.itemTitle}>{item.label}</Text>
              <Text style={styles.itemDetail}>{item.detail}</Text>
              {!!item.fix && <Text style={styles.fix}>{item.fix}</Text>}
            </View>
          </View>
        ))}
      </View>

      <View style={styles.qaBox}>
        <Text style={styles.qaTitle}>Voice-only QA script</Text>
        <Text style={styles.qaText}>{VOICE_ONLY_QA_STEPS.length} steps · {phaseSummary()}</Text>
        <Text style={styles.qaCommand}>{VOICE_ONLY_QA_STEPS[0]?.command}</Text>
      </View>

      <View style={styles.actions}>
        <Pressable style={styles.ghostButton} onPress={onRefresh}>
          <Text style={styles.ghostButtonText}>Refresh</Text>
        </Pressable>
        <Pressable style={styles.ghostButton} onPress={onRunQa}>
          <Text style={styles.ghostButtonText}>QA script</Text>
        </Pressable>
        <Pressable style={styles.primaryButton} onPress={onCompleteSetup}>
          <Text style={styles.primaryButtonText}>Complete setup</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: 14, padding: 14, borderRadius: 24, backgroundColor: 'rgba(255,255,255,0.065)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.14)' },
  header: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  kicker: { color: '#fef3c7', fontSize: 11, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 1.2 },
  title: { color: '#fff7ed', fontSize: 24, fontWeight: '900', marginTop: 3 },
  copy: { color: '#cbd5e1', fontSize: 13, lineHeight: 19, marginTop: 4 },
  scoreBubble: { width: 54, height: 54, borderRadius: 18, alignItems: 'center', justifyContent: 'center', borderWidth: StyleSheet.hairlineWidth },
  readyBubble: { backgroundColor: 'rgba(103,232,249,0.16)', borderColor: '#67e8f9' },
  warnBubble: { backgroundColor: 'rgba(251,191,36,0.16)', borderColor: '#fbbf24' },
  scoreText: { color: '#fff7ed', fontSize: 15, fontWeight: '900' },
  itemList: { gap: 9 },
  item: { flexDirection: 'row', gap: 9, alignItems: 'flex-start' },
  badge: { minWidth: 44, textAlign: 'center', overflow: 'hidden', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 5, fontSize: 10, fontWeight: '900' },
  badge_ok: { color: '#06111c', backgroundColor: '#67e8f9' },
  badge_warn: { color: '#422006', backgroundColor: '#fef3c7' },
  badge_fail: { color: '#450a0a', backgroundColor: '#fecdd3' },
  itemCopy: { flex: 1, minWidth: 0 },
  itemTitle: { color: '#f8fbff', fontSize: 13, fontWeight: '900' },
  itemDetail: { color: '#cbd5e1', fontSize: 12, lineHeight: 17, marginTop: 2 },
  fix: { color: '#fef3c7', fontSize: 12, lineHeight: 17, marginTop: 2 },
  qaBox: { gap: 4, padding: 11, borderRadius: 18, backgroundColor: 'rgba(15,23,42,0.55)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.1)' },
  qaTitle: { color: '#f8fbff', fontSize: 13, fontWeight: '900' },
  qaText: { color: '#cbd5e1', fontSize: 12, lineHeight: 17 },
  qaCommand: { color: '#67e8f9', fontSize: 12, fontWeight: '900' },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  ghostButton: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', minHeight: 42, borderRadius: 14, backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.13)', paddingHorizontal: 12 },
  ghostButtonText: { color: '#f8fbff', fontSize: 12, fontWeight: '900' },
  primaryButton: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', minHeight: 42, borderRadius: 14, backgroundColor: '#67e8f9', paddingHorizontal: 12 },
  primaryButtonText: { color: '#06111c', fontSize: 12, fontWeight: '900' },
});
