import { ScrollView, StyleSheet, Text, View } from 'react-native';
import type { ChatMessage } from '../db/schema';

export function TranscriptStrip({ messages, interim }: { messages: ChatMessage[]; interim: string }) {
  const visible = messages.slice(-5);
  return (
    <View style={styles.card}>
      <Text style={styles.title}>Conversation</Text>
      <ScrollView style={styles.list} contentContainerStyle={styles.listContent}>
        {visible.map((message) => (
          <View key={message.id} style={[styles.row, message.role === 'user' ? styles.userRow : styles.agaRow]}>
            <Text style={styles.role}>{message.role === 'assistant' ? 'AGA' : message.role === 'user' ? 'You' : 'System'}</Text>
            <Text style={styles.content}>{message.content}</Text>
          </View>
        ))}
        {!!interim && (
          <View style={[styles.row, styles.interimRow]}>
            <Text style={styles.role}>Hearing</Text>
            <Text style={styles.content}>{interim}</Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    minHeight: 210,
    padding: 14,
    borderRadius: 24,
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  title: { color: '#fef3c7', fontSize: 13, fontWeight: '900', textTransform: 'uppercase', letterSpacing: 1.2 },
  list: { marginTop: 10 },
  listContent: { gap: 10, paddingBottom: 10 },
  row: { padding: 12, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth },
  userRow: { backgroundColor: 'rgba(96,165,250,0.16)', borderColor: 'rgba(96,165,250,0.32)' },
  agaRow: { backgroundColor: 'rgba(249,168,212,0.12)', borderColor: 'rgba(249,168,212,0.28)' },
  interimRow: { backgroundColor: 'rgba(103,232,249,0.11)', borderColor: 'rgba(103,232,249,0.32)' },
  role: { color: '#67e8f9', fontSize: 11, fontWeight: '900', marginBottom: 4 },
  content: { color: '#f8fbff', fontSize: 14, lineHeight: 20 },
});
