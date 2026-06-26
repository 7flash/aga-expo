import React, { useEffect, useState } from 'react';
import { SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { loadPreferences, type Preferences } from '../db/localStore';
import { EmbossedPanel, GaugeStatus, MechanicalSwitch, TactileButton } from './tactile/TactilePrimitives';
import { tactile } from './tactile/tokens';

/**
 * Behind-glass settings display.
 *
 * No direct-manipulation controls. Settings are changed by voice
 * commands or remote config; this screen only visualizes the current state as a
 * tactile control panel so a kiosk/glass build remains 100% voice-first.
 */
export function AgaSettingsScreen() {
  const [prefs, setPrefs] = useState<Preferences | null>(null);

  useEffect(() => {
    let alive = true;
    loadPreferences().then((next) => { if (alive) setPrefs(next); }).catch(() => undefined);
    const timer = setInterval(() => {
      loadPreferences().then((next) => { if (alive) setPrefs(next); }).catch(() => undefined);
    }, 5000);
    return () => { alive = false; clearInterval(timer); };
  }, []);

  const listeningMode = prefs?.realtimeListenMode ?? 'strict';
  const wakePhrase = prefs?.wakePhrase ?? 'aga';
  const voice = prefs?.realtimeVoice || 'default';
  const persona = prefs?.persona || 'warm';
  const remoteRevision = prefs?.remoteConfigRevision || 'local';

  return (
    <SafeAreaView style={styles.root} pointerEvents="none">
      <ScrollView contentContainerStyle={styles.content} pointerEvents="none">
        <Text style={styles.kicker}>AGA MECHANICAL CONTROL BAY</Text>
        <Text style={styles.title}>Voice-only settings</Text>
        <Text style={styles.subtitle}>Say “AGA settings”, “AGA change voice”, “AGA listening mode”, or manage this unit from remote config. There are no touch controls in the behind-glass build.</Text>

        <View style={styles.gauges}>
          <GaugeStatus label="Wake" value={wakePhrase} mode="listening" active />
          <GaugeStatus label="Voice" value={voice} mode="speaking" active />
          <GaugeStatus label="Config" value={remoteRevision} mode="thinking" active />
        </View>

        <EmbossedPanel title="listening hardware" mode="listening" active style={styles.panel}>
          <MechanicalSwitch label="Wake phrase gate" value mode="listening" />
          <MechanicalSwitch label="Barge-in / interruption" value={!!prefs?.allowBargeIn} mode="speaking" style={styles.rowGap} />
          <MechanicalSwitch label="Media ducking" value={prefs?.mediaDuckingEnabled !== false} mode="media" style={styles.rowGap} />
        </EmbossedPanel>

        <EmbossedPanel title="spoken selector bank" mode="speaking" active style={styles.panel}>
          <View style={styles.grid}>
            <TactileButton index="1" label="Persona" sublabel={persona} active mode="speaking" />
            <TactileButton index="2" label="Listen mode" sublabel={listeningMode} active mode="listening" />
            <TactileButton index="3" label="Diagnostics" sublabel={prefs?.showDiagnostics ? 'visible' : 'hidden'} active={!!prefs?.showDiagnostics} mode="thinking" />
            <TactileButton index="4" label="Remote skill bay" sublabel="synced by config server" active mode="guided" />
          </View>
        </EmbossedPanel>

        <EmbossedPanel title="voice commands" mode="guided" style={styles.panel}>
          <Text style={styles.command}>“AGA open settings menu”</Text>
          <Text style={styles.command}>“AGA choose one”</Text>
          <Text style={styles.command}>“AGA switch to hands-free mode”</Text>
          <Text style={styles.command}>“AGA refresh remote config”</Text>
        </EmbossedPanel>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000' },
  content: { padding: 22, gap: 16 },
  kicker: { color: tactile.colors.amber, fontSize: 11, fontWeight: '900', letterSpacing: 2.6, textTransform: 'uppercase' },
  title: { color: tactile.colors.text, fontSize: 32, fontWeight: '900', letterSpacing: 0.4 },
  subtitle: { color: tactile.colors.etched, fontSize: 15, lineHeight: 22, maxWidth: 720 },
  gauges: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  panel: { marginTop: 4 },
  rowGap: { marginTop: 10 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  command: { color: tactile.colors.text, fontSize: 15, lineHeight: 24, fontWeight: '700' },
});

export default AgaSettingsScreen;
