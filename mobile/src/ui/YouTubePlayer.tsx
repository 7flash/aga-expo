import React, { useEffect, useRef } from 'react';
import { Animated, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { youtubeEmbedHtml, youtubeSearchEmbedHtml } from '../media/youtube';
import { colors, radius, spacing } from './theme';

let WebView: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  WebView = require('react-native-webview').WebView;
} catch {
  WebView = null;
}

export type MediaCommand = 'pause' | 'resume' | 'stop' | null;

function WebHtmlFrame({ html, command, onEvent }: { html: string; command?: MediaCommand; onEvent?: (event: string) => void }) {
  const iframeRef = useRef<any>(null);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const root: any = globalThis as any;
    const listener = (event: any) => {
      if (typeof event?.data === 'string') onEvent?.(event.data);
    };
    root.addEventListener?.('message', listener);
    return () => root.removeEventListener?.('message', listener);
  }, [onEvent]);

  useEffect(() => {
    if (!command || Platform.OS !== 'web') return;
    try {
      iframeRef.current?.contentWindow?.postMessage(JSON.stringify({ type: command }), '*');
    } catch {
      // ignore iframe teardown / browser restrictions
    }
  }, [command]);

  return React.createElement('iframe', {
    ref: iframeRef,
    srcDoc: html,
    title: 'AGA YouTube player',
    allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen',
    allowFullScreen: true,
    style: {
      width: '100%',
      height: '100%',
      border: 0,
      background: '#050817',
      display: 'block',
    },
  });
}

export function YouTubePlayer({
  videoId,
  title,
  query,
  embedHtml,
  command,
  onClose,
  onEvent,
}: {
  videoId?: string;
  title: string;
  query?: string;
  embedHtml?: string;
  command?: MediaCommand;
  onClose?: () => void;
  onEvent?: (event: string) => void;
}) {
  const webviewRef = useRef<any>(null);
  const slide = useRef(new Animated.Value(0)).current;
  const html = embedHtml || (videoId ? youtubeEmbedHtml(videoId) : youtubeSearchEmbedHtml(query || title));

  useEffect(() => {
    Animated.spring(slide, { toValue: 1, useNativeDriver: true, damping: 18, stiffness: 130 }).start();
  }, [slide]);

  useEffect(() => {
    if (!command) return;
    webviewRef.current?.postMessage?.(JSON.stringify({ type: command }));
  }, [command]);

  return (
    <Animated.View
      style={[
        styles.card,
        {
          opacity: slide,
          transform: [{ translateY: slide.interpolate({ inputRange: [0, 1], outputRange: [42, 0] }) }],
        },
      ]}
    >
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.kicker}>{videoId ? 'NOW PLAYING' : 'YOUTUBE SEARCH'}</Text>
          <Text numberOfLines={1} style={styles.title}>{title}</Text>
        </View>
        <Pressable onPress={onClose} style={styles.closeButton} accessibilityRole="button" accessibilityLabel="Close YouTube player">
          <Text style={styles.closeText}>×</Text>
        </Pressable>
      </View>
      <View style={styles.webviewWrap}>
        {Platform.OS === 'web' ? (
          <WebHtmlFrame html={html} command={command} onEvent={onEvent} />
        ) : WebView ? (
          <WebView
            ref={(ref: any) => { webviewRef.current = ref; }}
            style={styles.webview}
            source={{ html }}
            allowsInlineMediaPlayback
            mediaPlaybackRequiresUserAction={false}
            javaScriptEnabled
            domStorageEnabled
            onMessage={(event: any) => onEvent?.(event.nativeEvent.data)}
          />
        ) : (
          <View style={styles.fallback}>
            <Text style={styles.fallbackText}>WebView is not installed in this build.</Text>
          </View>
        )}
      </View>
      <Text style={styles.hint}>Say “AGA pause”, “AGA resume”, or “AGA close video”.</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    bottom: spacing.xl,
    zIndex: 30,
    borderRadius: radius.xl,
    padding: spacing.md,
    backgroundColor: 'rgba(8,11,31,0.96)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
    shadowColor: colors.cyan,
    shadowOpacity: 0.35,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 16 },
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.sm },
  kicker: { color: colors.pink, fontSize: 10, fontWeight: '900', letterSpacing: 1.8, marginBottom: 2 },
  title: { color: colors.text, fontSize: 16, fontWeight: '900' },
  closeButton: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.12)' },
  closeText: { color: colors.text, fontSize: 25, lineHeight: 27, fontWeight: '700' },
  webviewWrap: { height: 224, overflow: 'hidden', borderRadius: radius.lg, backgroundColor: '#050817' },
  webview: { flex: 1, backgroundColor: '#050817' },
  fallback: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  fallbackText: { color: colors.muted, textAlign: 'center', fontWeight: '700' },
  hint: { marginTop: spacing.sm, color: colors.faint, fontSize: 12, textAlign: 'center', fontWeight: '700' },
});
