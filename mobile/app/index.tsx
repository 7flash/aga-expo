import { SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';

const assistantUrl = process.env.EXPO_PUBLIC_ASSISTANT_WEB_URL ?? 'http://localhost:3000';

export default function HomeScreen() {
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.notice}>
        <View style={styles.logoBubble}>
          <Text style={styles.logoText}>A</Text>
        </View>
        <View style={styles.noticeCopy}>
          <Text style={styles.noticeText}>AGA</Text>
          <Text style={styles.urlText}>voice-only assistant · {assistantUrl}</Text>
        </View>
        <View style={styles.onlinePill}>
          <View style={styles.onlineDot} />
          <Text style={styles.onlineText}>Hands-free</Text>
        </View>
      </View>
      <WebView
        source={{ uri: assistantUrl }}
        originWhitelist={['*']}
        javaScriptEnabled
        domStorageEnabled
        pullToRefreshEnabled={false}
        startInLoadingState
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        javaScriptCanOpenWindowsAutomatically
        setSupportMultipleWindows={false}
        allowsFullscreenVideo
        thirdPartyCookiesEnabled
        sharedCookiesEnabled
        mixedContentMode="compatibility"
        androidLayerType="hardware"
        style={styles.webview}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#050817',
  },
  notice: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: '#080a20',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#273569',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  logoBubble: {
    width: 42,
    height: 42,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f9a8d4',
  },
  logoText: {
    fontSize: 22,
    fontWeight: '900',
    color: '#07111f',
  },
  noticeCopy: {
    flex: 1,
    minWidth: 0,
  },
  noticeText: {
    color: '#f8fbff',
    fontSize: 18,
    fontWeight: '900',
    letterSpacing: -0.4,
  },
  urlText: {
    color: '#c9d7ff',
    fontSize: 11,
    marginTop: 2,
  },
  onlinePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 10,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: '#111733',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#67e8f9',
  },
  onlineDot: {
    width: 7,
    height: 7,
    borderRadius: 7,
    backgroundColor: '#67e8f9',
  },
  onlineText: {
    color: '#f8fbff',
    fontSize: 11,
    fontWeight: '800',
  },
  webview: {
    flex: 1,
    backgroundColor: '#050817',
  },
});
