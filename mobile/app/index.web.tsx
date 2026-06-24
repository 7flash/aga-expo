import React from 'react';
import { Linking, Pressable, SafeAreaView, StyleSheet, Text, View } from 'react-native';

const assistantUrl = process.env.EXPO_PUBLIC_ASSISTANT_WEB_URL ?? 'http://localhost:3000';

const iframeStyle: React.CSSProperties = {
  border: 0,
  width: '100%',
  flex: 1,
  minHeight: 0,
  backgroundColor: '#050817',
};

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
        <Pressable style={styles.openButton} onPress={() => Linking.openURL(assistantUrl)}>
          <Text style={styles.openButtonText}>Open direct</Text>
        </Pressable>
      </View>
      {React.createElement('iframe', {
        src: assistantUrl,
        title: 'AGA voice assistant',
        style: iframeStyle,
        allow: 'clipboard-write; microphone; camera; autoplay; fullscreen',
        sandbox: 'allow-scripts allow-same-origin allow-forms allow-popups allow-presentation',
      })}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#050817',
    minHeight: '100vh' as any,
  },
  notice: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    backgroundColor: '#080a20',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#273569',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
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
  openButton: {
    borderWidth: 1,
    borderColor: '#67e8f9',
    borderRadius: 999,
    paddingHorizontal: 13,
    paddingVertical: 8,
    backgroundColor: '#111733',
  },
  openButtonText: {
    color: '#f8fbff',
    fontSize: 12,
    fontWeight: '800',
  },
});
