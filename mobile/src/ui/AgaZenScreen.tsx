import React, { useEffect, useRef } from "react";
import {
  Animated,
  FlatList,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Link } from "expo-router";
import { useAgaBrain } from "../aga/useAgaBrain";
import { AgaAvatarZen } from "./AgaAvatarZen";
import { MessageBubble } from "./MessageBubble";
import { YouTubePlayer } from "./YouTubePlayer";
import { colors, radius, spacing } from "./theme";

export function AgaZenScreen() {
  const {
    mode,
    messages,
    interim,
    activeMedia,
    mediaCommand,
    speechStatus,
    error,
    lastMeasure,
    replay,
    closeMedia,
    onMediaEvent,
    rearmMic,
  } = useAgaBrain();
  const avatarShift = useRef(new Animated.Value(0)).current;
  const hasConversation = messages.length > 0 || !!activeMedia;

  useEffect(() => {
    Animated.spring(avatarShift, {
      toValue: hasConversation ? 1 : 0,
      useNativeDriver: true,
      damping: 18,
      stiffness: 120,
    }).start();
  }, [avatarShift, hasConversation]);

  const audioLevel =
    mode === "speaking"
      ? 0.82
      : interim
        ? 0.55
        : mode === "listening"
          ? 0.2
          : 0;
  const voiceUnavailable = /unavailable|unsupported|not available/i.test(
    speechStatus,
  );
  const status = voiceUnavailable
    ? "Voice fallback"
    : error
      ? "Needs attention"
      : mode === "sleeping" || mode === "listening"
        ? "Listening for AGA"
        : mode;

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.backgroundOrbOne} />
      <View style={styles.backgroundOrbTwo} />

      <View style={styles.header}>
        <View style={styles.brandPill}>
          <View style={styles.brandDot}>
            <Text style={styles.brandLetter}>A</Text>
          </View>
          <View>
            <Text style={styles.brand}>AGA</Text>
            <Text style={styles.brandSub}>guardian voice</Text>
          </View>
        </View>
        <View style={styles.statusPill}>
          <View
            style={[
              styles.statusDot,
              (mode === "listening" ||
                mode === "speaking" ||
                mode === "media") &&
                styles.statusDotLive,
            ]}
          />
          <Text style={styles.statusText}>{status}</Text>
        </View>
        <Link href="/settings" asChild>
          <Pressable
            style={styles.settingsButton}
            accessibilityRole="button"
            accessibilityLabel="Open settings"
          >
            <Text style={styles.settingsText}>⚙</Text>
          </Pressable>
        </Link>
      </View>

      <Animated.View
        pointerEvents="box-none"
        style={[
          styles.avatarWrap,
          {
            transform: [
              {
                translateY: avatarShift.interpolate({
                  inputRange: [0, 1],
                  outputRange: [40, -86],
                }),
              },
              {
                scale: avatarShift.interpolate({
                  inputRange: [0, 1],
                  outputRange: [1.08, 0.82],
                }),
              },
            ],
          },
        ]}
      >
        <Pressable
          onPress={rearmMic}
          accessibilityRole="button"
          accessibilityLabel="Restart AGA microphone"
        >
          <AgaAvatarZen
            mode={mode}
            audioLevel={audioLevel}
            compact={!!activeMedia}
            size={activeMedia ? 156 : 282}
          />
        </Pressable>
      </Animated.View>

      {!!interim && (
        <Animated.View style={styles.interimPill}>
          <Text style={styles.interimLabel}>AGA HEARS</Text>
          <Text numberOfLines={2} style={styles.interimText}>
            {interim}
          </Text>
        </Animated.View>
      )}

      <View style={styles.feedShell}>
        <FlatList
          inverted
          data={messages.slice(-10).reverse()}
          keyExtractor={(item, index) => `${item.createdAt ?? index}-${index}`}
          contentContainerStyle={styles.feedContent}
          renderItem={({ item }) => (
            <MessageBubble
              message={item}
              onReplay={item.role === "assistant" ? replay : undefined}
            />
          )}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyTitle}>Say “Hey AGA”</Text>
              <Text style={styles.emptyText}>
                Ask for advice, reminders, memory, translation, or YouTube.
              </Text>
              <Text style={styles.speechStatus}>{speechStatus}</Text>
              {!!lastMeasure && (
                <Text style={styles.measureStatus}>{lastMeasure}</Text>
              )}
            </View>
          }
        />
      </View>

      {activeMedia?.type === "youtube" && !!activeMedia.videoId && (
        <YouTubePlayer
          videoId={activeMedia.videoId}
          title={activeMedia.title}
          command={mediaCommand}
          onClose={closeMedia}
          onEvent={onMediaEvent}
        />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg, overflow: "hidden" },
  backgroundOrbOne: {
    position: "absolute",
    width: 360,
    height: 360,
    borderRadius: 180,
    backgroundColor: "rgba(103,232,249,0.13)",
    top: -90,
    right: -120,
  },
  backgroundOrbTwo: {
    position: "absolute",
    width: 320,
    height: 320,
    borderRadius: 160,
    backgroundColor: "rgba(167,139,250,0.12)",
    bottom: -120,
    left: -90,
  },
  header: {
    position: "absolute",
    top: spacing.lg,
    left: spacing.lg,
    right: spacing.lg,
    zIndex: 40,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  brandPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    padding: spacing.sm,
    paddingRight: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: colors.border,
  },
  brandDot: {
    width: 34,
    height: 34,
    borderRadius: 13,
    backgroundColor: "#bff7ff",
    alignItems: "center",
    justifyContent: "center",
  },
  brandLetter: { color: "#14172b", fontWeight: "900", fontSize: 16 },
  brand: {
    color: colors.text,
    fontWeight: "900",
    fontSize: 14,
    letterSpacing: 1.1,
  },
  brandSub: { color: colors.faint, fontSize: 10, fontWeight: "700" },
  statusPill: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    height: 45,
    borderRadius: radius.pill,
    backgroundColor: "rgba(255,255,255,0.07)",
    borderWidth: 1,
    borderColor: colors.border,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.faint,
  },
  statusDotLive: {
    backgroundColor: colors.cyan,
    shadowColor: colors.cyan,
    shadowOpacity: 0.85,
    shadowRadius: 10,
  },
  statusText: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "900",
    textTransform: "capitalize",
  },
  settingsButton: {
    width: 45,
    height: 45,
    borderRadius: 22.5,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: colors.border,
  },
  settingsText: { color: colors.text, fontSize: 18 },
  avatarWrap: {
    position: "absolute",
    top: "23%",
    left: 0,
    right: 0,
    zIndex: 5,
    alignItems: "center",
  },
  interimPill: {
    position: "absolute",
    top: "48%",
    alignSelf: "center",
    maxWidth: "86%",
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    borderRadius: radius.xl,
    backgroundColor: "rgba(103,232,249,0.13)",
    borderWidth: 1,
    borderColor: "rgba(103,232,249,0.28)",
    zIndex: 15,
  },
  interimLabel: {
    color: colors.cyan,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1.7,
    textAlign: "center",
    marginBottom: 4,
  },
  interimText: {
    color: colors.text,
    fontWeight: "800",
    textAlign: "center",
    fontSize: 16,
    lineHeight: 22,
  },
  feedShell: {
    position: "absolute",
    left: spacing.lg,
    right: spacing.lg,
    bottom: spacing.lg,
    top: "48%",
    zIndex: 10,
    borderRadius: radius.xl,
    backgroundColor: "rgba(255,255,255,0.045)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    overflow: "hidden",
  },
  feedContent: { padding: spacing.md, paddingTop: spacing.lg },
  emptyState: {
    minHeight: 160,
    alignItems: "center",
    justifyContent: "center",
    padding: spacing.lg,
  },
  emptyTitle: {
    color: colors.text,
    fontSize: 22,
    fontWeight: "900",
    letterSpacing: -0.4,
  },
  emptyText: {
    color: colors.muted,
    textAlign: "center",
    marginTop: spacing.sm,
    lineHeight: 20,
  },
  speechStatus: {
    color: colors.faint,
    textAlign: "center",
    marginTop: spacing.md,
    fontSize: 11,
    fontWeight: "700",
  },
  measureStatus: {
    color: "rgba(103,232,249,0.58)",
    textAlign: "center",
    marginTop: spacing.xs,
    fontSize: 10,
    fontWeight: "800",
  },
});
