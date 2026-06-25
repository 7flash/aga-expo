import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius, spacing } from './theme';

type Props = { children: React.ReactNode };
type State = { error: Error | null };

export class AgaErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    console.warn('AGA UI crashed safely:', error.message);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <View style={styles.root}>
        <View style={styles.card}>
          <Text style={styles.title}>AGA is recovering</Text>
          <Text style={styles.body}>The interface hit a small glitch, but your local data should still be safe.</Text>
          <Text style={styles.detail} numberOfLines={3}>{this.state.error.message}</Text>
          <Pressable style={styles.button} onPress={() => this.setState({ error: null })}>
            <Text style={styles.buttonText}>Try again</Text>
          </Pressable>
        </View>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, backgroundColor: colors.bg },
  card: { width: '100%', maxWidth: 520, padding: spacing.xl, borderRadius: radius.xl, backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 1, borderColor: colors.border },
  title: { color: colors.text, fontSize: 26, fontWeight: '900', marginBottom: spacing.sm },
  body: { color: colors.muted, fontSize: 15, lineHeight: 22 },
  detail: { color: colors.faint, marginTop: spacing.md, fontSize: 12, lineHeight: 18 },
  button: { alignSelf: 'flex-start', marginTop: spacing.lg, paddingHorizontal: spacing.lg, paddingVertical: spacing.md, borderRadius: radius.pill, backgroundColor: colors.cyan },
  buttonText: { color: '#09111f', fontWeight: '900' },
});
