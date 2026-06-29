import React from 'react';
import { SafeAreaView, ScrollView, StyleSheet, View } from 'react-native';
import { useAgaBrain } from '../aga/useAgaBrain';
import { AmbientPlayer } from './AmbientPlayer';
import { YouTubePlayer } from './YouTubePlayer';
import { AgaUnifiedConsole } from './AgaUnifiedConsole';

function envFlag(name: string, fallback = false) {
  const raw = String((process as any)?.env?.[name] ?? '').trim().toLowerCase();
  if (!raw) return fallback;
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

export function AgaZenScreen() {
  const brain = useAgaBrain() as any;
  const media: any = brain.activeMedia;

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <AgaUnifiedConsole
          mode={brain.mode}
          messages={brain.messages}
          interim={brain.interim}
          speechStatus={brain.speechStatus}
          ttsStatus={brain.ttsStatus}
          error={brain.error}
          activeChoiceMenu={brain.activeChoiceMenu}
          sessionLabel={brain.sessionLabel}
          activeMedia={brain.activeMedia}
          audioLevel={brain.audioLevel}
          voiceTurn={brain.voiceTurn}
          showDebug={envFlag('EXPO_PUBLIC_AGA_SHOW_DEBUG_BUTTONS', false)}
        />

        {media?.kind === 'ambient' ? (
          <View style={styles.mediaShell}>
            <AmbientPlayer command={brain.mediaCommand} media={media} onEvent={brain.onMediaEvent} onClose={brain.closeMedia} />
          </View>
        ) : null}

        {media?.kind === 'youtube' ? (
          <View style={styles.mediaShell}>
            <YouTubePlayer command={brain.mediaCommand} media={media} onEvent={brain.onMediaEvent} onClose={brain.closeMedia} />
          </View>
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

export default AgaZenScreen;

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#02070b' },
  scroll: { flex: 1 },
  content: { padding: 12, paddingBottom: 40 },
  mediaShell: { marginHorizontal: 16, marginTop: 14 },
});
