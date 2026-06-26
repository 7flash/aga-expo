import React, { useEffect, useRef } from 'react';
import {
  Animated,
  FlatList,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useAgaBrain } from '../aga/useAgaBrain';
import { AngelVisual } from '../visual/AngelVisual';
import { MessageBubble } from './MessageBubble';
import { AmbientPlayer } from './AmbientPlayer';
import { YouTubePlayer } from './YouTubePlayer';
import { colors, radius, spacing } from './theme';
import { AGA_APP_VERSION } from '../config/appVersion';

function envFlag(name: string, fallback = false) {
  const raw = String(process.env?.[name] ?? '').trim().toLowerCase();
  if (!raw) return fallback;
  return raw === '1' || raw === 'true' || raw === 'yes' || raw === 'on';
}

function displayMode() {
  return String(process.env?.EXPO_PUBLIC_AGA_DISPLAY_MODE ?? '').trim().toLowerCase();
}

export function AgaZenScreen() {
  const brain = useAgaBrain() as any;
  const {
    mode,
    messages,
    interim,
    activeMedia,
    mediaCommand,
    audioLevel: realtimeAudioLevel,
    speechStatus,
    error,
    lastMeasure,
    ttsStatus,
    voiceSummary,
    voiceCapability,
    activeChoiceMenu,
    sessionLabel,
    replay,
    closeMedia,
    onMediaEvent,
  } = brain;
  const snapshotGeminiCost = brain.geminiCost;

  const avatarShift = useRef(new Animated.Value(0)).current;
  const hasConversation = messages.length > 0 || !!activeMedia || !!activeChoiceMenu;

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

  const voiceUnavailable = /unavailable|unsupported|not available/i.test(speechStatus);
  const status = voiceUnavailable
    ? 'Voice fallback'
    : error
      ? 'Needs attention'
      : mode === 'sleeping' || mode === 'listening'
        ? (activeMedia ? 'Media voice controls' : 'Listening for AGA')
        : mode;
  const media: any = activeMedia;
  const menu = activeChoiceMenu as any;
  const debugUi = envFlag('EXPO_PUBLIC_AGA_DEBUG_UI', false);
  const hologramMode = displayMode() === 'hologram';
  const geminiCost = snapshotGeminiCost ?? (voiceCapability as any)?.geminiCost ?? (voiceCapability as any)?.cost ?? (voiceCapability as any)?.budget;

  return (
    <SafeAreaView style={[styles.safe, hologramMode && styles.safeHologram]}>
      {!hologramMode && <View style={styles.backgroundOrbOne} />}
      {!hologramMode && <View style={styles.backgroundOrbTwo} />}

      {!hologramMode && <View style={styles.header}>
        <View style={styles.brandPill}>
          <View style={styles.brandDot}>
            <Text style={styles.brandLetter}>A</Text>
          </View>
          <View>
            <Text style={styles.brand}>AGA</Text>
            <Text style={styles.brandSub}>{sessionLabel ? sessionLabel : 'guardian voice'} · v{AGA_APP_VERSION}</Text>
          </View>
        </View>
        <View style={styles.statusPill}>
          <View
            style={[
              styles.statusDot,
              (mode === 'listening' || mode === 'speaking' || mode === 'media') && styles.statusDotLive,
            ]}
          />
          <Text style={styles.statusText}>{status}</Text>
        </View>
      </View>}

      {!hologramMode && !!geminiCost && (
        <View style={styles.costPill}>
          <Text style={styles.costLabel}>Gemini</Text>
          <Text style={styles.costText}>{geminiCost.label ?? `${geminiCost.transport ?? 'text'} · ${geminiCost.turns ?? 0} turns`}</Text>
        </View>
      )}

      <Animated.View
        pointerEvents="box-none"
        style={[
          styles.avatarWrap,
          {
            transform: [
              {
                translateY: avatarShift.interpolate({
                  inputRange: [0, 1],
                  outputRange: [40, -96],
                }),
              },
              {
                scale: avatarShift.interpolate({
                  inputRange: [0, 1],
                  outputRange: [1.08, 0.72],
                }),
              },
            ],
          },
        ]}
      >
        <AngelVisual
          mode={mode}
          audioLevel={audioLevel}
          compact={!hologramMode && (!!activeMedia || !!activeChoiceMenu)}
          size={hologramMode ? 340 : (activeMedia || activeChoiceMenu ? 156 : 282)}
        />
      </Animated.View>

      {!hologramMode && !!interim && !activeChoiceMenu && (
        <Animated.View style={styles.interimPill}>
          <Text style={styles.interimLabel}>AGA HEARS</Text>
          <Text numberOfLines={2} style={styles.interimText}>{interim}</Text>
        </Animated.View>
      )}

      {!!menu && (
        <View style={styles.choiceStage}>
          <Text style={styles.choiceTitle}>{menu.title}</Text>
          {!!menu.subtitle && <Text style={styles.choiceSubtitle}>{menu.subtitle}</Text>}
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.choiceScroll}>
            <View style={styles.choiceGrid}>
              {menu.options.map((option: any) => (
                <View key={option.key} style={styles.choiceOption}>
                  <Text style={styles.choiceKey}>{option.key}</Text>
                  <View style={styles.choiceCopy}>
                    <Text style={styles.choiceLabel}>{option.label}</Text>
                    {!!option.description && <Text style={styles.choiceDescription}>{option.description}</Text>}
                  </View>
                </View>
              ))}
            </View>
          </ScrollView>
          <Text style={styles.choiceFooter}>Reply by voice: “one”, “two”, “A”, or the option name.</Text>
        </View>
      )}

      {(!hologramMode || debugUi || activeChoiceMenu || activeMedia) && (
      <View style={[styles.feedShell, activeChoiceMenu ? styles.feedShellWithChoice : null, activeMedia ? styles.feedShellWithMedia : null, hologramMode && styles.feedShellHologram]}>
        <FlatList
          inverted
          data={messages.slice(-12).reverse()}
          keyExtractor={(item, index) => `${item.createdAt ?? index}-${index}`}
          contentContainerStyle={styles.feedContent}
          renderItem={({ item }) => (
            <MessageBubble
              message={item}
              onReplay={item.role === 'assistant' ? replay : undefined}
            />
          )}
          ListEmptyComponent={
            <View style={[styles.emptyState, hologramMode && styles.emptyStateHologram]}>
              <Text style={[styles.emptyTitle, hologramMode && styles.emptyTitleHologram]}>Say “Hey AGA”</Text>
              {!hologramMode && (
                <>
                  <Text style={styles.emptyText}>Ask for advice, reminders, memory, translation, YouTube, or a skill — all by voice.</Text>
                  <Text style={styles.versionText}>v{AGA_APP_VERSION}</Text>
                </>
              )}
              {debugUi ? (
                <>
                  <Text style={styles.speechStatus}>{speechStatus}</Text>
                  {!!voiceSummary && <Text style={styles.measureStatus}>{voiceSummary}</Text>}
                  {!!ttsStatus && <Text style={styles.measureStatus}>TTS {ttsStatus}</Text>}
                  {!!lastMeasure && <Text style={styles.measureStatus}>{lastMeasure}</Text>}
                </>
              ) : (
                <Text style={[styles.speechStatus, hologramMode && styles.speechStatusHologram]}>
                  {hologramMode
                    ? (voiceUnavailable ? 'Voice standby' : 'Listening')
                    : (voiceUnavailable ? 'Voice standby' : 'Listening locally')}
                </Text>
              )}
            </View>
          }
        />
      </View>
      )}

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
    width: 360,
    height: 360,
    borderRadius: 180,
    backgroundColor: 'rgba(103,232,249,0.13)',
    top: -90,
    right: -120,
  },
  backgroundOrbTwo: {
    position: 'absolute',
    width: 320,
    height: 320,
    borderRadius: 160,
    backgroundColor: 'rgba(167,139,250,0.12)',
    bottom: -120,
    left: -90,
  },
  header: {
    position: 'absolute',
    top: spacing.lg,
    left: spacing.lg,
    right: spacing.lg,
    zIndex: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  brandPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.sm,
    paddingRight: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: colors.border,
  },
  brandDot: { width: 34, height: 34, borderRadius: 13, backgroundColor: '#bff7ff', alignItems: 'center', justifyContent: 'center' },
  brandLetter: { color: '#14172b', fontWeight: '900', fontSize: 16 },
  brand: { color: colors.text, fontWeight: '900', fontSize: 14, letterSpacing: 1.1 },
  brandSub: { color: colors.faint, fontSize: 10, fontWeight: '700' },
  statusPill: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    height: 45,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.07)',
    borderWidth: 1,
    borderColor: colors.border,
  },
  statusDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.faint },
  statusDotLive: { backgroundColor: colors.cyan, shadowColor: colors.cyan, shadowOpacity: 0.85, shadowRadius: 10 },
  statusText: { color: colors.text, fontSize: 12, fontWeight: '900', textTransform: 'capitalize' },
  costPill: {
    position: 'absolute',
    top: 70,
    right: spacing.lg,
    zIndex: 45,
    paddingHorizontal: spacing.md,
    paddingVertical: 7,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(0,0,0,0.36)',
    borderWidth: 1,
    borderColor: 'rgba(103,232,249,0.25)',
    alignItems: 'flex-end',
  },
  costLabel: { color: colors.cyan, fontSize: 9, fontWeight: '900', letterSpacing: 1.4, textTransform: 'uppercase' },
  costText: { color: colors.text, fontSize: 10, fontWeight: '800', marginTop: 1 },
  avatarWrap: { position: 'absolute', top: '23%', left: 0, right: 0, zIndex: 5, alignItems: 'center' },
  interimPill: {
    position: 'absolute',
    top: '48%',
    alignSelf: 'center',
    maxWidth: '86%',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.xl,
    backgroundColor: 'rgba(103,232,249,0.13)',
    borderWidth: 1,
    borderColor: 'rgba(103,232,249,0.28)',
    zIndex: 15,
  },
  interimLabel: { color: colors.cyan, fontSize: 10, fontWeight: '900', letterSpacing: 1.7, textAlign: 'center', marginBottom: 4 },
  interimText: { color: colors.text, fontWeight: '800', textAlign: 'center', fontSize: 16, lineHeight: 22 },

  choiceStage: {
    position: 'absolute',
    top: '16%',
    left: spacing.lg,
    right: spacing.lg,
    maxHeight: '36%',
    zIndex: 25,
    padding: spacing.md,
    borderRadius: radius.xl,
    backgroundColor: 'rgba(8,11,31,0.88)',
    borderWidth: 1,
    borderColor: 'rgba(103,232,249,0.35)',
    shadowColor: colors.cyan,
    shadowOpacity: 0.28,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 14 },
  },
  choiceTitle: { color: colors.text, fontSize: 18, fontWeight: '900', textAlign: 'center' },
  choiceSubtitle: { color: colors.muted, fontSize: 12, fontWeight: '700', textAlign: 'center', marginTop: 4, marginBottom: spacing.sm },
  choiceScroll: { paddingBottom: spacing.xs },
  choiceGrid: { gap: spacing.xs },
  choiceOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: 5,
    paddingHorizontal: spacing.xs,
    borderRadius: radius.md,
    backgroundColor: 'rgba(255,255,255,0.045)',
  },
  choiceKey: {
    width: 30,
    height: 30,
    borderRadius: 15,
    textAlign: 'center',
    textAlignVertical: 'center' as any,
    overflow: 'hidden',
    color: '#0b1024',
    backgroundColor: colors.cyan,
    fontWeight: '900',
    lineHeight: 30,
  },
  choiceCopy: { flex: 1, minWidth: 0 },
  choiceLabel: { color: colors.text, fontSize: 13, fontWeight: '900' },
  choiceDescription: { color: colors.muted, fontSize: 11, fontWeight: '700', marginTop: 1 },
  choiceFooter: { color: colors.faint, fontSize: 11, textAlign: 'center', fontWeight: '800', marginTop: spacing.sm },

  feedShell: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    bottom: spacing.lg,
    top: '48%',
    zIndex: 10,
    borderRadius: radius.xl,
    backgroundColor: 'rgba(255,255,255,0.045)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    overflow: 'hidden',
  },
  feedShellWithChoice: { top: '56%' },
  feedShellHologram: {
    backgroundColor: 'transparent',
    borderColor: 'transparent',
  },
  feedShellWithMedia: { bottom: 370 },
  feedContent: { padding: spacing.md, paddingTop: spacing.lg },
  emptyState: { minHeight: 160, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  emptyStateHologram: { minHeight: 118, padding: spacing.sm },
  emptyTitle: { color: colors.text, fontSize: 22, fontWeight: '900', letterSpacing: -0.4 },
  emptyTitleHologram: { fontSize: 24, letterSpacing: 0.2, textShadowColor: 'rgba(103,232,249,0.75)', textShadowRadius: 18 },
  emptyText: { color: colors.muted, textAlign: 'center', marginTop: spacing.sm, lineHeight: 20 },
  versionText: { color: colors.faint, fontSize: 11, fontWeight: '800', marginTop: spacing.xs },
  speechStatus: { color: colors.faint, textAlign: 'center', marginTop: spacing.md, fontSize: 11, fontWeight: '700' },
  speechStatusHologram: { marginTop: 5, fontSize: 10, color: 'rgba(185,255,255,0.62)' },
  measureStatus: { color: 'rgba(103,232,249,0.58)', textAlign: 'center', marginTop: spacing.xs, fontSize: 10, fontWeight: '800' },
});