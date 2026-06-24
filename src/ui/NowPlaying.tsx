import { Image, StyleSheet, Text, View } from 'react-native';
import type { NowPlaying as NowPlayingState } from '../media/nowPlaying';

export function NowPlaying({ item }: { item: NowPlayingState }) {
  if (!item.kind) return null;
  return (
    <View style={styles.card}>
      {item.artworkUrl ? <Image source={{ uri: item.artworkUrl }} style={styles.artwork} /> : <View style={styles.placeholder}><Text style={styles.placeholderText}>♪</Text></View>}
      <View style={styles.copy}>
        <Text style={styles.kicker}>{item.kind === 'youtube' ? 'YouTube' : 'Music'} · {item.state}</Text>
        <Text style={styles.title} numberOfLines={1}>{item.title}</Text>
        {!!item.subtitle && <Text style={styles.subtitle} numberOfLines={1}>{item.subtitle}</Text>}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 22,
    backgroundColor: 'rgba(15,23,42,0.74)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(103,232,249,0.32)',
  },
  artwork: { width: 54, height: 54, borderRadius: 16, backgroundColor: '#0f172a' },
  placeholder: { width: 54, height: 54, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(103,232,249,0.16)' },
  placeholderText: { color: '#fef3c7', fontSize: 24, fontWeight: '900' },
  copy: { flex: 1, minWidth: 0 },
  kicker: { color: '#67e8f9', fontSize: 11, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 1 },
  title: { color: '#fff7ed', fontSize: 16, fontWeight: '900', marginTop: 3 },
  subtitle: { color: '#cbd5e1', fontSize: 12, marginTop: 2 },
});
