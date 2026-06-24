import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { MemoryFact, Reminder } from '../db/schema';

function formatDue(dueAt: string) {
  const date = new Date(dueAt);
  const now = Date.now();
  const ms = date.getTime() - now;
  if (ms > 0 && ms < 90 * 60 * 1000) {
    const minutes = Math.max(1, Math.round(ms / 60_000));
    return `in ${minutes}m`;
  }
  return date.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function MemoryReminderPanel({ memories, reminders }: { memories: MemoryFact[]; reminders: Reminder[] }) {
  if (!memories.length && !reminders.length) return null;

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Local context</Text>
      {reminders.length > 0 && (
        <View style={styles.block}>
          <Text style={styles.subtitle}>Pending reminders</Text>
          {reminders.slice(0, 3).map((reminder) => (
            <Text style={styles.line} key={reminder.id}>• {reminder.title} · {formatDue(reminder.dueAt)}</Text>
          ))}
        </View>
      )}
      {memories.length > 0 && (
        <View style={styles.block}>
          <Text style={styles.subtitle}>Memory notes</Text>
          {memories.slice(0, 3).map((memory) => (
            <Text style={styles.line} key={memory.id}>• {memory.text}</Text>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: 10,
    padding: 14,
    borderRadius: 22,
    backgroundColor: 'rgba(254,243,199,0.075)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(254,243,199,0.25)',
  },
  title: { color: '#fef3c7', fontSize: 15, fontWeight: '900' },
  block: { gap: 5 },
  subtitle: { color: '#67e8f9', fontSize: 11, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 1.1 },
  line: { color: '#f8fbff', fontSize: 12, lineHeight: 17 },
});
