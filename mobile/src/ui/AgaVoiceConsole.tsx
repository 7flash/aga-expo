import React from 'react';
import { StyleSheet, View } from 'react-native';
import { TurnStatusPanel } from './TurnStatusPanel';
import { RecentTranscriptPanel } from './RecentTranscriptPanel';

export function AgaVoiceConsole({ snapshot, allowBargeIn = false }: { snapshot: any; allowBargeIn?: boolean }) {
  return (
    <View style={styles.wrap}>
      <TurnStatusPanel snapshot={snapshot} allowBargeIn={allowBargeIn} />
      <RecentTranscriptPanel snapshot={snapshot} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 14, width: '100%' },
});
