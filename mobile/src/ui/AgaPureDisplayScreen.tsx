import React, { memo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useAgaBrain } from '../aga/useAgaBrain';
import { AngelVisual } from '../visual/AngelVisual';
import { EmbossedPanel, GaugeStatus, NeuralTrace, TactileButton } from './tactile/TactilePrimitives';
import { tactile } from './tactile/tokens';

function visibleMode(mode: string) {
  if (mode === 'awake') return 'listening';
  if (mode === 'recovering') return 'repairing';
  return mode || 'idle';
}

/**
 * Minimal kiosk/behind-glass screen.
 *
 * This surface deliberately contains no direct-manipulation controls, links, or routing
 * controls. It is a display-only mechanical panel driven by brain state.
 */
export const AgaPureDisplayScreen = memo(function AgaPureDisplayScreen() {
  const brain = useAgaBrain() as any;
  const mode = String(brain.mode || 'idle');
  const activeChoiceMenu = brain.activeChoiceMenu;
  const choices = Array.isArray(activeChoiceMenu?.options) ? activeChoiceMenu.options.slice(0, 4) : [];
  const status = brain.speechStatus || brain.ttsStatus || visibleMode(mode);
  const audioLevel = typeof brain.audioLevel === 'number' ? brain.audioLevel : mode === 'speaking' ? 0.72 : mode === 'listening' ? 0.22 : 0;

  return (
    <View pointerEvents="none" style={styles.root}>
      <View style={styles.backPlate} />
      <View style={styles.neuralMesh}>
        <NeuralTrace active={mode !== 'idle'} mode={mode as any} style={styles.traceA} />
        <NeuralTrace active={!!activeChoiceMenu} mode="guided" direction="diagonal" style={styles.traceB} />
        <NeuralTrace active={mode === 'speaking'} mode="speaking" style={styles.traceC} />
      </View>

      <View style={styles.coreBay}>
        <AngelVisual mode={brain.mode} audioLevel={audioLevel} size={360} wear={0.22} />
      </View>

      <View style={styles.statusRail}>
        <GaugeStatus label="state" value={visibleMode(mode)} mode={mode as any} active />
        <GaugeStatus label="voice" value={status} mode={mode as any} active />
        {brain.sessionLabel ? <GaugeStatus label="skill" value={brain.sessionLabel} mode="guided" active /> : null}
      </View>

      {choices.length ? (
        <EmbossedPanel title={activeChoiceMenu?.title || 'spoken selector'} mode="guided" active style={styles.choicePanel}>
          <View style={styles.choiceGrid}>
            {choices.map((option: any, index: number) => (
              <TactileButton
                key={option.key || option.label || index}
                index={option.key || index + 1}
                label={String(option.label || option.title || `Option ${index + 1}`)}
                sublabel={String(option.description || 'Say the number or name')}
                active={index === 0}
                mode="guided"
              />
            ))}
          </View>
        </EmbossedPanel>
      ) : (
        <EmbossedPanel title="wake console" mode={mode as any} active={mode !== 'idle'} style={styles.choicePanel}>
          <Text style={styles.wakeText}>Say “AGA”</Text>
          <Text style={styles.wakeSub}>The physical interface is voice-driven. Controls press, flip, and fire internally when commands are understood.</Text>
        </EmbossedPanel>
      )}
    </View>
  );
});

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  backPlate: { position: 'absolute', width: '92%', height: '88%', borderRadius: 30, backgroundColor: '#060b0d', borderWidth: 1, borderColor: '#1b2c32', shadowColor: '#000', shadowOpacity: 0.95, shadowRadius: 30 },
  neuralMesh: { ...StyleSheet.absoluteFillObject },
  traceA: { position: 'absolute', top: '34%', left: '12%', width: '25%' },
  traceB: { position: 'absolute', top: '62%', left: '18%', width: '24%' },
  traceC: { position: 'absolute', top: '41%', right: '11%', width: '27%' },
  coreBay: { alignItems: 'center', justifyContent: 'center', marginTop: -40 },
  statusRail: { position: 'absolute', top: 28, left: 24, right: 24, flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
  choicePanel: { position: 'absolute', left: 24, right: 24, bottom: 24 },
  choiceGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  wakeText: { color: tactile.colors.text, fontSize: 26, fontWeight: '900', letterSpacing: 1.2 },
  wakeSub: { color: tactile.colors.etched, marginTop: 8, fontSize: 14, lineHeight: 20, maxWidth: 760 },
});

export default AgaPureDisplayScreen;
