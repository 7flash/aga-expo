import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { youtubeEmbedHtml, youtubeSearchEmbedHtml, youtubeSearchPlayerUrl, youtubeVideoPlayerUrl } from '../media/youtube';
import { measureMark } from '../observability/measure';
import { colors, radius, spacing } from './theme';

let WebView: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  WebView = require('react-native-webview').WebView;
} catch {
  WebView = null;
}

export type MediaCommand = 'pause' | 'resume' | 'stop' | null;

type Props = {
  videoId?: string;
  title: string;
  query?: string;
  embedHtml?: string;
  playerUrl?: string;
  command?: MediaCommand;
  onClose?: () => void;
  onEvent?: (event: string) => void;
};

function directPlayerUrl(input: { videoId?: string; query?: string; playerUrl?: string; title: string }) {
  if (input.playerUrl) return input.playerUrl;
  if (input.videoId) return youtubeVideoPlayerUrl(input.videoId);
  return youtubeSearchPlayerUrl(input.query || input.title);
}

function htmlForNative(input: { videoId?: string; query?: string; embedHtml?: string; title: string }) {
  if (input.embedHtml) return input.embedHtml;
  if (input.videoId) return youtubeEmbedHtml(input.videoId);
  return youtubeSearchEmbedHtml(input.query || input.title);
}

function WebIframe({ url, title, onEvent }: { url: string; title: string; onEvent?: (event: string) => void }) {
  useEffect(() => {
    measureMark('youtube.iframe.mount', { url: url.slice(0, 120) });
    onEvent?.(JSON.stringify({ type: 'player.mount', provider: 'iframe' }));
  }, [onEvent, url]);

  return React.createElement('iframe', {
    src: url,
    title: `AGA YouTube player: ${title}`,
    allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen',
    allowFullScreen: true,
    referrerPolicy: 'strict-origin-when-cross-origin',
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
  playerUrl,
  command,
  onClose,
  onEvent,
}: Props) {
  const webviewRef = useRef<any>(null);
  const slide = useRef(new Animated.Value(0)).current;
  const url = useMemo(() => directPlayerUrl({ videoId, query, playerUrl, title }), [playerUrl, query, title, videoId]);
  const html = useMemo(() => htmlForNative({ videoId, query, embedHtml, title }), [embedHtml, query, title, videoId]);

  useEffect(() => {
    Animated.spring(slide, { toValue: 1, useNativeDriver: true, damping: 18, stiffness: 130 }).start();
  }, [slide]);

  useEffect(() => {
    if (!command) return;
    measureMark('youtube.command', { command });
    webviewRef.current?.postMessage?.(JSON.stringify({ type: command }));
  }, [command]);

  const isSearch = !videoId && !!query;

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
          <Text style={styles.kicker}>{isSearch ? 'YOUTUBE SEARCH' : 'NOW PLAYING'}</Text>
          <Text numberOfLines={1} style={styles.title}>{title}</Text>
        </View>
        <Pressable onPress={onClose} style={styles.closeButton} accessibilityRole="button" accessibilityLabel="Close YouTube player">
          <Text style={styles.closeText}>×</Text>
        </Pressable>
      </View>
      <View style={styles.webviewWrap}>
        {Platform.OS === 'web' ? (
          <WebIframe url={url} title={title} onEvent={onEvent} />
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
            onLoad={() => onEvent?.(JSON.stringify({ type: 'player.load' }))}
            onError={(event: any) => onEvent?.(JSON.stringify({ type: 'player.error', message: event?.nativeEvent?.description }))}
          />
        ) : (
          <View style={styles.fallback}>
            <Text style={styles.fallbackText}>WebView is not installed in this build.</Text>
          </View>
        )}
      </View>
      <Text style={styles.hint}>
        {Platform.OS === 'web'
          ? 'If browser autoplay blocks sound, the video is still opened here. Say “AGA close video” to dismiss.'
          : 'Say “AGA pause”, “AGA resume”, or “AGA close video”.'}
      </Text>
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
  webviewWrap: { height: 244, overflow: 'hidden', borderRadius: radius.lg, backgroundColor: '#050817' },
  webview: { flex: 1, backgroundColor: '#050817' },
  fallback: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  fallbackText: { color: colors.muted, textAlign: 'center', fontWeight: '700' },
  hint: { marginTop: spacing.sm, color: colors.faint, fontSize: 12, textAlign: 'center', fontWeight: '700' },
});
