import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Platform, StyleSheet, Text, View } from 'react-native';
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
  /**
   * True while AGA is speaking over background media.
   * We keep playback running, but duck the player volume so AGA's voice remains clear.
   */
  ducked?: boolean;
  normalVolume?: number;
  duckedVolume?: number;
  onClose?: () => void;
  onEvent?: (event: string) => void;
};

function directPlayerUrl(input: { videoId?: string; query?: string; playerUrl?: string; title: string }) {
  if (input.playerUrl) return input.playerUrl;
  if (input.videoId) return youtubeVideoPlayerUrl(input.videoId);
  return youtubeSearchPlayerUrl(input.query || input.title);
}

function htmlForPlayer(input: { videoId?: string; query?: string; embedHtml?: string; title: string }) {
  if (input.embedHtml) return input.embedHtml;
  if (input.videoId) return youtubeEmbedHtml(input.videoId);
  return youtubeSearchEmbedHtml(input.query || input.title);
}

function eventJson(type: string, payload: Record<string, unknown> = {}) {
  return JSON.stringify({ type, ...payload });
}

function playerMessage(type: string, payload: Record<string, unknown> = {}) {
  return JSON.stringify({ type, ...payload });
}

function WebIframe({
  url,
  html,
  title,
  command,
  volume,
  onEvent,
}: {
  url: string;
  html: string;
  title: string;
  command?: MediaCommand;
  volume: number;
  onEvent?: (event: string) => void;
}) {
  const iframeRef = useRef<any>(null);
  const onEventRef = useRef(onEvent);
  const mountedKeyRef = useRef<string | null>(null);
  const lastCommandRef = useRef<string>('');
  const lastVolumeRef = useRef<number | null>(null);

  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    const key = `${url}|${html.slice(0, 120)}`;
    if (mountedKeyRef.current === key) return;
    mountedKeyRef.current = key;
    lastCommandRef.current = '';
    lastVolumeRef.current = null;
    measureMark('youtube.iframe.mount', { url: url.slice(0, 140), controlled: true });
    // Do not emit parent-changing events repeatedly; emit only when actual media changes.
    onEventRef.current?.(eventJson('player.mount', { provider: 'iframe', url }));
  }, [html, url]);

  useEffect(() => {
    const cw = iframeRef.current?.contentWindow;
    if (!cw || !command) return;
    const key = `${command}:${Date.now()}`;
    lastCommandRef.current = key;
    measureMark('youtube.iframe.command', { command });
    cw.postMessage(playerMessage(command), '*');
    // Settle parent command state once. The iframe will also emit a player.* event when possible.
    onEventRef.current?.(eventJson(`player.${command}`));
  }, [command]);

  useEffect(() => {
    const safeVolume = Math.max(0, Math.min(100, Math.round(volume)));
    if (lastVolumeRef.current === safeVolume) return;
    lastVolumeRef.current = safeVolume;
    const send = () => {
      iframeRef.current?.contentWindow?.postMessage(playerMessage('volume', { value: safeVolume }), '*');
    };
    send();
    const timer = setTimeout(send, 450);
    measureMark('youtube.iframe.volume', { value: safeVolume });
    return () => clearTimeout(timer);
  }, [volume]);

  return React.createElement('iframe', {
    ref: iframeRef,
    title: `AGA YouTube player: ${title}`,
    srcDoc: html,
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
  ducked = false,
  normalVolume = Number(process.env.EXPO_PUBLIC_AGA_MEDIA_VOLUME ?? 42),
  duckedVolume = Number(process.env.EXPO_PUBLIC_AGA_MEDIA_DUCK_VOLUME ?? 14),
  onEvent,
}: Props) {
  const webviewRef = useRef<any>(null);
  const onEventRef = useRef(onEvent);
  const slide = useRef(new Animated.Value(0)).current;
  const url = useMemo(() => directPlayerUrl({ videoId, query, playerUrl, title }), [playerUrl, query, title, videoId]);
  const html = useMemo(() => htmlForPlayer({ videoId, query, embedHtml, title }), [embedHtml, query, title, videoId]);
  const targetVolume = ducked ? duckedVolume : normalVolume;

  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    Animated.spring(slide, { toValue: 1, useNativeDriver: Platform.OS !== 'web', damping: 18, stiffness: 130 }).start();
  }, [slide]);

  useEffect(() => {
    if (!command) return;
    measureMark('youtube.command', { command });
    webviewRef.current?.postMessage?.(JSON.stringify({ type: command }));
    if (Platform.OS !== 'web') return;
    // Web iframe command handling lives inside WebIframe so it can post to contentWindow.
  }, [command]);

  useEffect(() => {
    const safeVolume = Math.max(0, Math.min(100, Math.round(targetVolume)));
    measureMark('youtube.volume', { ducked, value: safeVolume });
    webviewRef.current?.postMessage?.(JSON.stringify({ type: 'volume', value: safeVolume }));
  }, [ducked, targetVolume]);

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
          <Text style={styles.kicker}>{isSearch ? 'YOUTUBE SEARCH' : ducked ? 'BACKGROUND MUSIC · AGA SPEAKING' : 'NOW PLAYING'}</Text>
          <Text numberOfLines={1} style={styles.title}>{title}</Text>
        </View>
        <View style={styles.voiceOnlyClose}>
          <Text style={styles.voiceOnlyCloseText}>say “AGA close video”</Text>
        </View>
      </View>
      <View style={styles.webviewWrap}>
        {Platform.OS === 'web' ? (
          <WebIframe url={url} html={html} title={title} command={command} volume={targetVolume} onEvent={onEvent} />
        ) : WebView ? (
          <WebView
            ref={(ref: any) => { webviewRef.current = ref; }}
            style={styles.webview}
            source={{ html }}
            allowsInlineMediaPlayback
            mediaPlaybackRequiresUserAction={false}
            javaScriptEnabled
            domStorageEnabled
            onMessage={(event: any) => onEventRef.current?.(event.nativeEvent.data)}
            onLoad={() => onEventRef.current?.(eventJson('player.load'))}
            onError={(event: any) => onEventRef.current?.(eventJson('player.error', { message: event?.nativeEvent?.description }))}
          />
        ) : (
          <View style={styles.fallback}>
            <Text style={styles.fallbackText}>WebView is not installed in this build.</Text>
          </View>
        )}
      </View>
      <Text style={styles.hint}>
        {ducked
          ? 'Music keeps playing quietly while AGA speaks.'
          : videoId
            ? 'Say “AGA pause”, “AGA resume”, or “AGA close video”.'
            : 'Search playback needs a YouTube API key or backend for exact videos. AGA will use safe presets for music.'}
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
  voiceOnlyClose: { paddingHorizontal: 10, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: 'rgba(255,255,255,0.08)' },
  voiceOnlyCloseText: { color: colors.faint, fontSize: 10, fontWeight: '900' },
  webviewWrap: { height: 244, overflow: 'hidden', borderRadius: radius.lg, backgroundColor: '#050817' },
  webview: { flex: 1, backgroundColor: '#050817' },
  fallback: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  fallbackText: { color: colors.muted, textAlign: 'center', fontWeight: '700' },
  hint: { marginTop: spacing.sm, color: colors.faint, fontSize: 12, textAlign: 'center', fontWeight: '700' },
});
