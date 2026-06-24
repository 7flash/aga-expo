import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { EventLog, MediaFavorite, MediaQueueItem, Routine, TranslationHistoryItem, UserPreferences } from '../db/schema';
import type { StorageSummary } from '../db/backup';
import type { AgaState } from '../aga/stateMachine';
import type { NowPlaying } from '../media/nowPlaying';
import type { VoiceDiagnostics } from '../voice/voiceDiagnostics';

export function DebugPanel({
  visible,
  state,
  prefs,
  voiceAvailable,
  voiceDiagnostics,
  nowPlaying,
  events,
  queue,
  routines = [],
  favorites = [],
  translations = [],
  notificationStatus,
  harnessSummary,
  storageSummary,
  backupStatus,
  factoryResetArmed,
}: {
  visible: boolean;
  state: AgaState;
  prefs: UserPreferences | null;
  voiceAvailable: boolean;
  voiceDiagnostics?: VoiceDiagnostics | null;
  nowPlaying: NowPlaying;
  events: EventLog[];
  queue?: MediaQueueItem[];
  routines?: Routine[];
  favorites?: MediaFavorite[];
  translations?: TranslationHistoryItem[];
  notificationStatus?: string;
  harnessSummary?: string;
  storageSummary?: StorageSummary | null;
  backupStatus?: string;
  factoryResetArmed?: boolean;
}) {
  if (!visible) return null;

  return (
    <View style={styles.card}>
      <Text style={styles.title}>AGA diagnostics</Text>
      <Text style={styles.line}>state: {state}</Text>
      <Text style={styles.line}>voice: {voiceAvailable ? 'native module ready' : 'native STT missing'} · locale {prefs?.voiceLocale ?? 'en-US'} · watchdog {prefs?.speechWatchdogEnabled ? 'on' : 'off'}</Text>
      {!!voiceDiagnostics && (
        <Text style={styles.line}>speech loop: starts {voiceDiagnostics.starts} · restarts {voiceDiagnostics.restarts} · finals {voiceDiagnostics.finals} · errors {voiceDiagnostics.errors}{voiceDiagnostics.lastError ? ` · last ${voiceDiagnostics.lastError}` : ''}</Text>
      )}
      <Text style={styles.line}>persona: {prefs?.activePersona ?? 'unknown'} · wake: {prefs?.wakePhrase ?? 'hey aga'}</Text>
      <Text style={styles.line}>brain: {prefs?.backendMode ?? 'unknown'} · translate: {prefs?.translateTargetLang ?? 'off'} · proactive: {prefs?.proactiveEnabled ? 'on' : 'off'}</Text>
      <Text style={styles.line}>remote: {prefs?.remoteBackendUrl || 'not configured'} · setup {prefs?.firstRunComplete ? 'complete' : 'open'}</Text>
      <Text style={styles.line}>notifications: {notificationStatus ?? (prefs?.localNotificationsEnabled ? 'enabled' : 'off')}</Text>
      <Text style={styles.line}>media: {nowPlaying.kind === null ? 'none' : `${nowPlaying.kind} · ${nowPlaying.state} · ${nowPlaying.title}`}</Text>
      <Text style={styles.line}>queue: {queue?.length ?? 0} · routines {routines.length} · favorites {favorites.length} · translations {translations.length}</Text>
      {!!storageSummary && (
        <Text style={styles.line}>
          storage: {storageSummary.conversations} conv · {storageSummary.messages} msg · {storageSummary.memories} mem · {Math.max(1, Math.round(storageSummary.backupBytes / 1024))}KB backup
        </Text>
      )}
      {!!backupStatus && <Text style={styles.line}>backup: {backupStatus}</Text>}
      {!!factoryResetArmed && <Text style={styles.danger}>factory reset is armed for 30 seconds</Text>}
      {!!harnessSummary && <Text style={styles.line}>command harness: {harnessSummary}</Text>}
      <Text style={styles.subtitle}>Recent events</Text>
      {events.slice(0, 8).map((event) => (
        <Text style={styles.event} key={event.id}>[{event.kind}] {event.label}{event.durationMs ? ` · ${event.durationMs.toFixed(0)}ms` : ''}</Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: 6,
    padding: 14,
    borderRadius: 22,
    backgroundColor: 'rgba(15,23,42,0.78)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(103,232,249,0.35)',
  },
  title: { color: '#67e8f9', fontSize: 16, fontWeight: '900' },
  subtitle: { color: '#fef3c7', fontSize: 12, fontWeight: '900', marginTop: 8, textTransform: 'uppercase', letterSpacing: 1.2 },
  line: { color: '#dbeafe', fontSize: 12, lineHeight: 17 },
  danger: { color: '#fecdd3', fontSize: 12, lineHeight: 17, fontWeight: '900' },
  event: { color: 'rgba(231,238,255,0.7)', fontSize: 11, lineHeight: 16 },
});
