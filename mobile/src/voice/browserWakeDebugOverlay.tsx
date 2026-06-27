import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { subscribeWakeDebug, getRecentWakeDebugEvents, type WakeDebugEvent } from './wakeDebugBus';

function labelFor(event: WakeDebugEvent) {
  if (event.type === 'audio') {
    return `mic rms ${(event.rms * 100).toFixed(1)} peak ${(event.peak * 100).toFixed(1)} frames ${event.frames}`;
  }
  if (event.type === 'keyword') return `keyword detected: ${event.keyword}`;
  if (event.type === 'transcript') return `transcript: ${event.text}`;
  if (event.type === 'error') return `error: ${event.message}`;
  return event.message;
}

export function BrowserWakeDebugOverlay() {
  const [events, setEvents] = React.useState<WakeDebugEvent[]>(() => getRecentWakeDebugEvents().slice(-6));

  React.useEffect(() => {
    return subscribeWakeDebug(() => {
      setEvents(getRecentWakeDebugEvents().slice(-6));
    });
  }, []);

  const lastAudio = [...events].reverse().find((event) => event.type === 'audio') as Extract<WakeDebugEvent, { type: 'audio' }> | undefined;
  const lastKeyword = [...events].reverse().find((event) => event.type === 'keyword') as Extract<WakeDebugEvent, { type: 'keyword' }> | undefined;
  const lastTranscript = [...events].reverse().find((event) => event.type === 'transcript') as Extract<WakeDebugEvent, { type: 'transcript' }> | undefined;

  return (
    <View style={styles.root} pointerEvents="none">
      <Text style={styles.title}>VOICE DEBUG</Text>
      <Text style={styles.line}>
        {lastAudio ? `mic is hearing audio · rms ${(lastAudio.rms * 100).toFixed(1)} · peak ${(lastAudio.peak * 100).toFixed(1)}` : 'waiting for mic frames'}
      </Text>
      <Text style={styles.line}>
        {lastKeyword ? `last keyword: ${lastKeyword.keyword}` : 'wake mode only shows configured keywords, not every word'}
      </Text>
      <Text style={styles.line}>
        {lastTranscript ? `last transcript: ${lastTranscript.text}` : 'after AGA wake, transcript comes from STT/live path'}
      </Text>
      {events.slice(-3).map((event, index) => (
        <Text key={`${event.at}-${index}`} style={styles.event}>{labelFor(event)}</Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    right: 16,
    bottom: 16,
    width: 360,
    borderWidth: 1,
    borderColor: 'rgba(80, 255, 255, 0.55)',
    backgroundColor: 'rgba(0, 18, 20, 0.86)',
    borderRadius: 12,
    padding: 12,
    zIndex: 1000,
  },
  title: {
    color: '#60f7ff',
    fontSize: 10,
    fontWeight: '800',
    letterSpacing: 3,
    marginBottom: 6,
  },
  line: {
    color: '#d7ffff',
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 4,
  },
  event: {
    color: '#8fe9ef',
    fontSize: 11,
    marginTop: 3,
  },
});
