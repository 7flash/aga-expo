import React, { useEffect, useMemo, useState } from 'react';
import { SafeAreaView, ScrollView, StyleSheet, Text, View } from 'react-native';
import { loadPreferences, type Preferences } from '../db/localStore';
import { EmbossedPanel, GaugeStatus, MechanicalSwitch, RotarySelector, TactileButton } from './tactile/TactilePrimitives';
import { tactileRelic as relic } from './tactile/tokens';

function listenDetent(mode?: string | null) {
  if (mode === 'handsfree') return 4;
  if (mode === 'answer_window') return 2;
  return 0;
}

/**
 * Voice-only relic settings surface.
 *
 * No direct editing widgets, sliders, or manual touch affordances. The device
 * is behind glass; this screen only displays the state of the physical-looking
 * control bay. Settings change by voice commands or remote/companion config.
 */
export function AgaSettingsScreen() {
  const [prefs, setPrefs] = useState<Preferences | null>(null);

  useEffect(() => {
    let alive = true;
    const read = () => loadPreferences().then((next) => { if (alive) setPrefs(next); }).catch(() => undefined);
    void read();
    const timer = setInterval(read, 5000);
    return () => { alive = false; clearInterval(timer); };
  }, []);

  const listeningMode = prefs?.realtimeListenMode ?? 'strict';
  const wakePhrase = prefs?.wakePhrase ?? 'aga';
  const voice = prefs?.realtimeVoice || 'default';
  const persona = prefs?.persona || 'warm';
  const remoteRevision = prefs?.remoteConfigRevision || 'local';
  const wear = useMemo(() => Math.min(0.62, 0.18 + (prefs?.activeSession ? 0.12 : 0) + (prefs?.showDiagnostics ? 0.06 : 0)), [prefs?.activeSession, prefs?.showDiagnostics]);

  return (
    <SafeAreaView style={styles.root} pointerEvents="none">
      <ScrollView contentContainerStyle={styles.content} pointerEvents="none">
        <Text style={styles.kicker}>TACTILE NEURAL RELIC</Text>
        <Text style={styles.title}>Voice-only mechanical control bay</Text>
        <Text style={styles.subtitle}>This unit is behind glass. Say “AGA settings”, “AGA choose one”, “AGA change voice”, or update remote config. The controls below are rendered as tactile hardware, but they are not touch targets.</Text>

        <View style={styles.gauges}>
          <GaugeStatus label="Wake" value={wakePhrase} mode="listening" active level={0.78} />
          <GaugeStatus label="Voice" value={voice} mode="speaking" active level={0.58} />
          <GaugeStatus label="Config" value={remoteRevision} mode="thinking" active level={remoteRevision === 'local' ? 0.35 : 0.75} />
        </View>

        <EmbossedPanel title="listening hardware" mode="listening" active wear={wear} style={styles.panel}>
          <View style={styles.hardwareGrid}>
            <MechanicalSwitch label="Wake phrase gate" value mode="listening" wear={wear} />
            <MechanicalSwitch label="Barge-in relay" value={!!prefs?.allowBargeIn} mode="speaking" wear={wear} />
            <MechanicalSwitch label="Media ducking bus" value={prefs?.mediaDuckingEnabled !== false} mode="media" wear={wear} />
            <RotarySelector label="Listen mode" valueLabel={listeningMode} detent={listenDetent(listeningMode)} detents={5} mode="listening" active style={styles.rotary} />
          </View>
        </EmbossedPanel>

        <EmbossedPanel title="engraved spoken selector bank" mode="speaking" active wear={wear} style={styles.panel}>
          <View style={styles.grid}>
            <TactileButton index="1" label="Persona" sublabel={persona} active mode="speaking" wear={wear} />
            <TactileButton index="2" label="Listening" sublabel={listeningMode} active mode="listening" wear={wear} />
            <TactileButton index="3" label="Diagnostics" sublabel={prefs?.showDiagnostics ? 'visible' : 'sealed'} active={!!prefs?.showDiagnostics} mode="thinking" wear={wear} />
            <TactileButton index="4" label="Remote skill bay" sublabel="synced by config server" active={!!prefs?.remoteConfigRevision} mode="guided" wear={wear} />
          </View>
        </EmbossedPanel>

        <EmbossedPanel title="voice command engravings" mode="guided" wear={wear} style={styles.panel}>
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
  kicker: { color: relic.colors.amber, fontSize: 11, fontWeight: '900', letterSpacing: 2.9, textTransform: 'uppercase' },
  title: { color: relic.colors.coolWhite, fontSize: 32, fontWeight: '900', letterSpacing: 0.4 },
  subtitle: { color: relic.colors.engraved, fontSize: 15, lineHeight: 22, maxWidth: 780, fontWeight: '700' },
  gauges: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  panel: { marginTop: 4 },
  hardwareGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, alignItems: 'stretch' },
  rotary: { width: 155 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  command: { color: relic.colors.coolWhite, fontSize: 15, lineHeight: 25, fontWeight: '800' },
});

export default AgaSettingsScreen;
