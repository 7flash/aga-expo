import React, { useEffect, useRef } from 'react';
import { Animated, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { useAgaBrain } from '../aga/useAgaBrain';
import { AngelVisual } from '../visual/AngelVisual';
import { AmbientPlayer } from './AmbientPlayer';
import { YouTubePlayer } from './YouTubePlayer';
import { AgaUnifiedConsole } from './AgaUnifiedConsole';
import { colors, spacing } from './theme';
import { AGA_APP_VERSION } from '../config/appVersion';

function displayMode() {
  return String(process.env?.EXPO_PUBLIC_AGA_DISPLAY_MODE ?? '').trim().toLowerCase();
}

export function AgaZenScreen() {
  const brain = useAgaBrain() as any;
  const {
    mode,
    messages = [],
    interim,
    activeMedia,
    mediaCommand,
    audioLevel: realtimeAudioLevel,
    speechStatus,
    error,
    ttsStatus,
    activeChoiceMenu,
    sessionLabel,
    closeMedia,
    onMediaEvent,
    voiceTurn,
  } = brain;

  const avatarShift = useRef(new Animated.Value(0)).current;
  const hasConversation = messages.length > 0 || !!activeMedia || !!activeChoiceMenu || !!interim;
  const hologramMode = displayMode() === 'hologram' || displayMode() === 'true_hologram';

  useEffect(() => {
    Animated.spring(avatarShift, {
      toValue: hasConversation ? 1 : 0,
      useNativeDriver: true,
      damping: 18,
      stiffness: 120,
    }).start();
  }, [avatarShift, hasConversation]);

  const audioLevel =
    typeof realtimeAudioLevel === 'number' && realtimeAudioLevel > 0
      ? realtimeAudioLevel
      : mode === 'speaking'
        ? 0.82
        : interim
          ? 0.55
          : mode === 'listening'
            ? 0.2
            : 0;

  const media: any = activeMedia;

  return (
    <SafeAreaView style={[styles.safe, hologramMode && styles.safeHologram]}>
      <View style={styles.backgroundOrbOne} />
      <View style={styles.backgroundOrbTwo} />

      <View pointerEvents="none" style={styles.topBrand}>
        <Text style={styles.brand}>AGA</Text>
        <Text style={styles.brandSub}>{sessionLabel ? sessionLabel : 'guardian voice'} · v{AGA_APP_VERSION}</Text>
      </View>

      <Animated.View
        pointerEvents="none"
        style={[
          styles.avatarWrap,
          {
            transform: [
              {
                translateY: avatarShift.interpolate({
                  inputRange: [0, 1],
                  outputRange: [34, -58],
                }),
              },
              {
                scale: avatarShift.interpolate({
                  inputRange: [0, 1],
                  outputRange: [1.06, 0.84],
                }),
              },
            ],
          },
        ]}
      >
        <AngelVisual
          mode={mode}
          audioLevel={audioLevel}
          compact={!!activeMedia || !!activeChoiceMenu}
          size={hologramMode ? 330 : (activeMedia || activeChoiceMenu ? 190 : 292)}
        />
      </Animated.View>

      <AgaUnifiedConsole
        mode={mode}
        messages={messages}
        interim={interim}
        speechStatus={speechStatus}
        ttsStatus={ttsStatus}
        error={error}
        activeChoiceMenu={activeChoiceMenu}
        sessionLabel={sessionLabel}
        activeMedia={activeMedia}
        audioLevel={audioLevel}
        voiceTurn={voiceTurn}
      />

      {media?.type === 'ambient' && (
        <AmbientPlayer
          kind={media.kind}
          title={media.title}
          command={mediaCommand}
          ducked={mode === 'speaking' || mode === 'thinking'}
          onEvent={onMediaEvent}
        />
      )}

      {media?.type === 'youtube' && (media.videoId || media.playerUrl || media.embedHtml || media.query) && (
        <YouTubePlayer
          videoId={media.videoId || undefined}
          title={media.title}
          query={media.query}
          embedHtml={media.embedHtml}
          playerUrl={media.playerUrl}
          command={mediaCommand}
          ducked={mode === 'speaking' || mode === 'thinking'}
          onClose={closeMedia}
          onEvent={onMediaEvent}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg, overflow: 'hidden' },
  safeHologram: { backgroundColor: '#000' },
  backgroundOrbOne: {
    position: 'absolute',
    width: 390,
    height: 390,
    borderRadius: 195,
    backgroundColor: 'rgba(103,232,249,0.10)',
    top: -110,
    right: -140,
  },
  backgroundOrbTwo: {
    position: 'absolute',
    width: 360,
    height: 360,
    borderRadius: 180,
    backgroundColor: 'rgba(167,139,250,0.10)',
    bottom: -135,
    left: -110,
  },
  topBrand: {
    position: 'absolute',
    top: spacing.md,
    left: 0,
    right: 0,
    zIndex: 8,
    alignItems: 'center',
  },
  brand: { color: '#dfffff', fontWeight: '950', fontSize: 16, letterSpacing: 4, textShadowColor: 'rgba(93,245,255,0.55)', textShadowRadius: 12 },
  brandSub: { color: 'rgba(220,255,255,0.58)', fontSize: 10, fontWeight: '800', marginTop: 2, letterSpacing: 1.1 },
  avatarWrap: {
    position: 'absolute',
    top: '23%',
    left: 0,
    right: 0,
    zIndex: 5,
    alignItems: 'center',
  },
});

export default AgaZenScreen;
