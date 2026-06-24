import { StyleSheet, Text, View } from 'react-native';
import type { MediaQueueItem } from '../db/schema';

export function MediaQueuePanel({ queue }: { queue: MediaQueueItem[] }) {
  if (!queue.length) return null;

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.kicker}>Queue</Text>
        <Text style={styles.count}>{queue.length} item{queue.length === 1 ? '' : 's'}</Text>
      </View>
      {queue.slice(0, 5).map((item, index) => (
        <View key={item.id} style={styles.row}>
          <Text style={styles.index}>{index + 1}</Text>
          <View style={styles.copy}>
            <Text style={styles.title} numberOfLines={1}>{item.title || item.query}</Text>
            <Text style={styles.meta}>{item.kind} · {item.status}</Text>
          </View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { gap: 10, padding: 12, borderRadius: 20, backgroundColor: 'rgba(255,255,255,0.055)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(255,255,255,0.12)' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  kicker: { color: '#fef3c7', fontSize: 12, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 1.2 },
  count: { color: '#67e8f9', fontSize: 11, fontWeight: '900' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  index: { width: 24, height: 24, borderRadius: 999, textAlign: 'center', textAlignVertical: 'center', color: '#06111c', backgroundColor: '#67e8f9', fontSize: 12, fontWeight: '900', overflow: 'hidden' },
  copy: { flex: 1, minWidth: 0 },
  title: { color: '#f8fbff', fontSize: 13, fontWeight: '900' },
  meta: { color: '#cbd5e1', fontSize: 11, marginTop: 2 },
});
