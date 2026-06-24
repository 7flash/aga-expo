import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { MediaFavorite, MemoryFact, Reminder, Routine, TranslationHistoryItem } from '../db/schema';

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

export function MemoryReminderPanel({
  memories,
  reminders,
  routines = [],
  favorites = [],
  translations = [],
}: {
  memories: MemoryFact[];
  reminders: Reminder[];
  routines?: Routine[];
  favorites?: MediaFavorite[];
  translations?: TranslationHistoryItem[];
}) {
  if (!memories.length && !reminders.length && !routines.length && !favorites.length && !translations.length) return null;

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
      {routines.length > 0 && (
        <View style={styles.block}>
          <Text style={styles.subtitle}>Routines</Text>
          {routines.slice(0, 3).map((routine) => (
            <Text style={styles.line} key={routine.id}>• {routine.title} · {routine.timeOfDay}{routine.enabled ? '' : ' · off'}</Text>
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
      {favorites.length > 0 && (
        <View style={styles.block}>
          <Text style={styles.subtitle}>Favorites</Text>
          {favorites.slice(0, 3).map((favorite) => (
            <Text style={styles.line} key={favorite.id}>• {favorite.title}{favorite.artist ? ` · ${favorite.artist}` : ''}</Text>
          ))}
        </View>
      )}
      {translations.length > 0 && (
        <View style={styles.block}>
          <Text style={styles.subtitle}>Recent translation</Text>
          <Text style={styles.line}>• {translations[0].translatedText}</Text>
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
