import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { getRecentWakeDebugEvents, subscribeWakeDebug, type WakeDebugEvent } from '../voice/wakeDebugBus';
import { wakePhraseHint } from '../voice/wakePhraseAliases';

const BAR_COUNT = 34;

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

function latest<T extends WakeDebugEvent['type']>(events: WakeDebugEvent[], type: T) {
  return [...events].reverse().find((event) => event.type === type) as Extract<WakeDebugEvent, { type: T }> | undefined;
}

function barHeight(index: number, tick: number, level: number) {
  const wave = Math.sin((index / BAR_COUNT) * Math.PI * 2 + tick * 0.33) * 0.5 + 0.5;
  const pulse = Math.sin((index / BAR_COUNT) * Math.PI * 5 - tick * 0.22) * 0.5 + 0.5;
  return 8 + Math.round((wave * 0.72 + pulse * 0.28) * (18 + level * 62));
}

export function WakeWaveformOverlay() {
  const [events, setEvents] = React.useState<WakeDebugEvent[]>(() => getRecentWakeDebugEvents());
  const [tick, setTick] = React.useState(0);

  React.useEffect(() => subscribeWakeDebug(() => {
    setEvents(getRecentWakeDebugEvents());
    setTick((value) => value + 1);
  }), []);

  const audio = latest(events, 'audio');
  const keyword = latest(events, 'keyword');
  const error = latest(events, 'error');
  const transcript = latest(events, 'transcript');

  const now = Date.now();
  const micAlive = !!audio && now - audio.at < 1800;
  const rms = audio?.rms ?? 0;
  const peak = audio?.peak ?? 0;
  const level = clamp01(Math.max(rms * 24, peak * 5));

  const bars = Array.from({ length: BAR_COUNT }, (_, index) => barHeight(index, tick, level));

  return (
    <View style={styles.root} pointerEvents="none">
      <View style={styles.top}>
        <Text style={styles.title}>MIC LIVE</Text>
        <Text style={[styles.badge, micAlive ? styles.badgeOn : styles.badgeOff]}>
          {micAlive ? 'HEARING AUDIO' : 'WAITING FOR MIC'}
        </Text>
      </View>

      <View style={styles.waveform}>
        {bars.map((height, index) => (
          <View
            key={index}
            style={[
              styles.bar,
              {
                height,
                opacity: 0.22 + clamp01(level + 0.2 + index / BAR_COUNT * 0.2) * 0.78,
              },
            ]}
          />
        ))}
      </View>

      <View style={styles.meterTrack}>
        <View style={[styles.meterFill, { width: `${Math.round(level * 100)}%` }]} />
      </View>

      <Text style={styles.primary}>{wakePhraseHint()}</Text>

      <View style={styles.row}>
        <Text style={styles.stat}>rms {(rms * 100).toFixed(1)}</Text>
        <Text style={styles.stat}>peak {(peak * 100).toFixed(1)}</Text>
        <Text style={styles.stat}>frames {audio?.frames ?? 0}</Text>
      </View>

      <Text style={styles.secondary}>
        {keyword ? `keyword detected: ${keyword.keyword}` : 'Wake mode shows keywords only. Full words appear after wake/STT.'}
      </Text>

      {transcript ? <Text style={styles.secondary}>last words: {transcript.text}</Text> : null}
      {error ? <Text style={styles.error}>{error.message}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    left: 18,
    right: 18,
    bottom: 18,
    minHeight: 158,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(80, 245, 255, 0.78)',
    backgroundColor: 'rgba(1, 10, 12, 0.96)',
    paddingHorizontal: 18,
    paddingVertical: 14,
    zIndex: 9999,
    shadowColor: '#4df8ff',
    shadowOpacity: 0.5,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 0 },
  },
  top: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  title: {
    color: '#6cf7ff',
    fontSize: 12,
    fontWeight: '900',
    letterSpacing: 4,
  },
  badge: {
    borderRadius: 999,
    overflow: 'hidden',
    paddingHorizontal: 12,
    paddingVertical: 5,
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 1.4,
  },
  badgeOn: {
    color: '#041315',
    backgroundColor: '#6af7ff',
  },
  badgeOff: {
    color: '#94c2c8',
    backgroundColor: 'rgba(120, 180, 190, 0.18)',
  },
  waveform: {
    height: 76,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginVertical: 4,
  },
  bar: {
    width: 5,
    borderRadius: 999,
    backgroundColor: '#5df5ff',
    shadowColor: '#5df5ff',
    shadowOpacity: 0.9,
    shadowRadius: 9,
    shadowOffset: { width: 0, height: 0 },
  },
  meterTrack: {
    height: 7,
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: 'rgba(110, 200, 210, 0.18)',
    marginBottom: 9,
  },
  meterFill: {
    height: 7,
    borderRadius: 999,
    backgroundColor: '#5df5ff',
  },
  primary: {
    color: '#ffd06c',
    fontSize: 15,
    fontWeight: '900',
    marginBottom: 5,
  },
  secondary: {
    color: '#b9f8ff',
    fontSize: 12,
    fontWeight: '800',
  },
  row: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 4,
  },
  stat: {
    color: '#7eeef7',
    fontSize: 11,
    fontWeight: '900',
    letterSpacing: 0.6,
  },
  error: {
    color: '#ff6b83',
    fontSize: 12,
    fontWeight: '900',
    marginTop: 5,
  },
});
