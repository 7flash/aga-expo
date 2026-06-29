import React from 'react';
import { ScrollView, Text, View, Pressable, TextInput, StyleSheet } from 'react-native';

export type LabLog = {
  at: number;
  title: string;
  details?: unknown;
  tone?: 'ok' | 'warn' | 'error' | 'info';
};

export function nowLabel(at = Date.now()) {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' }).format(new Date(at));
}

export function LabButton({ children, onPress, disabled }: { children: React.ReactNode; onPress?: () => void; disabled?: boolean }) {
  return (
    <Pressable onPress={disabled ? undefined : onPress} style={[styles.button, disabled && styles.buttonDisabled]}>
      <Text style={styles.buttonText}>{children}</Text>
    </Pressable>
  );
}

export function LabInput(props: React.ComponentProps<typeof TextInput>) {
  return <TextInput {...props} placeholderTextColor="#8792aa" style={[styles.input, props.style]} />;
}

export function LabScreen({ title, subtitle, children, logs }: { title: string; subtitle: string; children?: React.ReactNode; logs?: LabLog[] }) {
  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.subtitle}>{subtitle}</Text>
      {children}
      {logs ? <LabLogs logs={logs} /> : null}
    </ScrollView>
  );
}

export function LabCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{title}</Text>
      {children}
    </View>
  );
}

export function LabLogs({ logs }: { logs: LabLog[] }) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Logs</Text>
      {logs.length === 0 ? <Text style={styles.dim}>No logs yet.</Text> : null}
      {logs.map((log, index) => (
        <View key={`${log.at}-${index}`} style={styles.logRow}>
          <Text style={styles.logTime}>{nowLabel(log.at)}</Text>
          <View style={{ flex: 1 }}>
            <Text style={[styles.logTitle, log.tone === 'error' && styles.err, log.tone === 'warn' && styles.warn, log.tone === 'ok' && styles.ok]}>{log.title}</Text>
            {log.details != null ? <Text selectable style={styles.pre}>{typeof log.details === 'string' ? log.details : JSON.stringify(log.details, null, 2)}</Text> : null}
          </View>
        </View>
      ))}
    </View>
  );
}

export function JsonBlock({ value }: { value: unknown }) {
  return <Text selectable style={styles.pre}>{typeof value === 'string' ? value : JSON.stringify(value, null, 2)}</Text>;
}

export const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#05070d' },
  content: { padding: 24, gap: 18 },
  title: { color: '#f7f8ff', fontSize: 36, fontWeight: '900' },
  subtitle: { color: '#aeb8d2', fontSize: 18, lineHeight: 28, maxWidth: 1100 },
  card: { backgroundColor: '#0a101c', borderColor: '#1f2a42', borderWidth: 1, borderRadius: 18, padding: 20, gap: 14 },
  cardTitle: { color: '#eef3ff', fontSize: 20, fontWeight: '800' },
  dim: { color: '#8290aa', fontSize: 15 },
  button: { backgroundColor: '#edf2ff', borderRadius: 999, paddingVertical: 13, paddingHorizontal: 22, alignSelf: 'flex-start', marginRight: 10, marginBottom: 10, borderWidth: 2, borderColor: '#58d8ff' },
  buttonDisabled: { opacity: 0.45 },
  buttonText: { color: '#0b1020', fontWeight: '900', fontSize: 16 },
  input: { color: '#fff', borderColor: '#303b55', borderWidth: 1, borderRadius: 14, padding: 14, fontSize: 17, backgroundColor: '#050912', minWidth: 320 },
  logRow: { flexDirection: 'row', borderTopColor: '#1e2a41', borderTopWidth: 1, paddingTop: 12, gap: 18 },
  logTime: { color: '#b5c0db', width: 92, fontWeight: '700' },
  logTitle: { color: '#e9edff', fontSize: 16, fontWeight: '800' },
  pre: { color: '#dfe5ff', fontFamily: 'monospace', fontSize: 13, lineHeight: 19, marginTop: 8 },
  err: { color: '#ff8b8b' },
  warn: { color: '#ffd36b' },
  ok: { color: '#76f2b4' },
});
