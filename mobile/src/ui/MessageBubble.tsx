import React, { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing } from './theme';

export type BubbleMessage = {
  role: string;
  content: string;
  createdAt?: string;
};

export function MessageBubble({ message, onReplay }: { message: BubbleMessage; onReplay?: (text: string) => void }) {
  const appear = useRef(new Animated.Value(0)).current;
  const isAga = message.role === 'assistant' || message.role === 'aga';

  useEffect(() => {
    Animated.timing(appear, { toValue: 1, duration: 260, useNativeDriver: true }).start();
  }, [appear]);

  const time = message.createdAt
    ? new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' }).format(new Date(message.createdAt))
    : '';

  return (
    <Animated.View
      style={[
        styles.wrap,
        isAga ? styles.left : styles.right,
        {
          opacity: appear,
          transform: [{ translateY: appear.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }],
        },
      ]}
    >
      <Pressable
        disabled={!isAga || !onReplay}
        onPress={() => onReplay?.(message.content)}
        style={[styles.bubble, isAga ? styles.agaBubble : styles.userBubble]}
      >
        <View style={styles.metaRow}>
          <Text style={[styles.name, isAga ? styles.agaName : styles.userName]}>{isAga ? 'AGA' : 'You'}</Text>
          {!!time && <Text style={styles.time}>{time}</Text>}
        </View>
        <Text style={styles.text}>{message.content}</Text>
        <View style={[styles.tail, isAga ? styles.agaTail : styles.userTail]} />
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { width: '100%', marginVertical: spacing.xs },
  left: { alignItems: 'flex-start' },
  right: { alignItems: 'flex-end' },
  bubble: {
    maxWidth: '86%',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    shadowOpacity: 0.26,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 10 },
  },
  agaBubble: {
    backgroundColor: 'rgba(103,232,249,0.13)',
    borderColor: 'rgba(103,232,249,0.28)',
    shadowColor: colors.cyan,
  },
  userBubble: {
    backgroundColor: 'rgba(167,139,250,0.15)',
    borderColor: 'rgba(167,139,250,0.28)',
    shadowColor: colors.lavender,
  },
  metaRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center', marginBottom: 4 },
  name: { fontSize: 10, letterSpacing: 1.4, fontWeight: '900', textTransform: 'uppercase' },
  agaName: { color: colors.cyan },
  userName: { color: colors.gold },
  time: { color: colors.faint, fontSize: 10, fontWeight: '700' },
  text: { color: colors.text, fontSize: 15, lineHeight: 21, fontWeight: '600' },
  tail: { position: 'absolute', bottom: 7, width: 14, height: 14, transform: [{ rotate: '45deg' }] },
  agaTail: { left: -4, backgroundColor: 'rgba(103,232,249,0.13)', borderLeftWidth: 1, borderBottomWidth: 1, borderColor: 'rgba(103,232,249,0.28)' },
  userTail: { right: -4, backgroundColor: 'rgba(167,139,250,0.15)', borderRightWidth: 1, borderTopWidth: 1, borderColor: 'rgba(167,139,250,0.28)' },
});
