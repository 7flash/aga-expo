import React, { memo, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useAgaBrain } from '../aga/useAgaBrain';
import { AngelVisual } from '../visual/AngelVisual';
import {
  EmbossedPanel,
  GaugeStatus,
  LedBank,
  MechanicalSwitch,
  MessagePlate,
  NeuralTrace,
  RotarySelector,
  TactileButton,
} from './tactile/TactilePrimitives';
import { glowForMode, tactileRelic as AGA } from './tactile/tokens';

const NO_POINTER_EVENTS = { pointerEvents: 'none' as const } as any;

function visibleMode(mode: string) {
  if (mode === 'awake') return 'listening';
  if (mode === 'recovering') return 'repairing';
  if (mode === 'sleeping') return 'wake gate';
  return mode || 'idle';
}

function normalizeMode(mode: string) {
  if (mode === 'awake') return 'listening';
  if (mode === 'sleeping') return 'idle';
  return mode || 'idle';
}

function recentPlates(messages: any[]) {
  return Array.isArray(messages) ? messages.slice(-2).map((message, i) => ({
    key: `${message?.createdAt || i}-${message?.role || 'turn'}`,
    role: String(message?.role || 'assistant'),
    text: String(message?.content || message?.text || '').replace(/\s+/g, ' ').trim(),
  })).filter((m) => m.text) : [];
}

/**
 * Voice Wake Console kiosk surface.
 *
 * No touch handlers, no text inputs, no router chrome, no soft translucent card aesthetic.
 * This is a physical-looking neuromorphic control deck projected behind glass.
 * Voice commands cause visual mechanical response: button travel, switch throw,
 * neural firing, gauges, and patina/wear emphasis.
 */
export const AgaPureDisplayScreen = memo(function AgaPureDisplayScreen() {
  const brain = useAgaBrain() as any;
  const rawMode = String(brain.mode || 'sleeping');
  const mode = normalizeMode(rawMode);
  const glow = glowForMode(mode);
  const activeChoiceMenu = brain.activeChoiceMenu;
  const choices = Array.isArray(activeChoiceMenu?.options) ? activeChoiceMenu.options.slice(0, 6) : [];
  const status = String(brain.speechStatus || brain.ttsStatus || visibleMode(rawMode));
  const session = String(brain.sessionLabel || 'guardian');
  const audioLevel = typeof brain.audioLevel === 'number' ? brain.audioLevel : mode === 'speaking' ? 0.72 : mode === 'listening' ? 0.24 : 0.05;
  const interactionPulse = choices.length ? 0.85 : mode === 'speaking' || mode === 'thinking' ? 0.62 : 0.18;
  const messages = useMemo(() => recentPlates(brain.messages || []), [brain.messages]);
  const wear = Math.min(0.72, 0.18 + (brain.reminders?.length || 0) * 0.025 + (brain.messages?.length || 0) * 0.004 + (brain.sessionLabel ? 0.08 : 0));

  return (
    <View style={[styles.root, NO_POINTER_EVENTS]}>
      <View style={styles.deepVoid} />
      <View style={styles.AGADeck}>
        <View style={styles.deckPatina} />
        <View style={styles.deckBevel} />
        <View style={styles.deckGrain} />
        <View style={styles.cornerRivetA} />
        <View style={styles.cornerRivetB} />
        <View style={styles.cornerRivetC} />
        <View style={styles.cornerRivetD} />
      </View>

      <View style={styles.neuralPlane}>
        <NeuralTrace active={mode !== 'idle'} mode={mode as any} wear={wear} style={styles.traceTopLeft} />
        <NeuralTrace active={mode === 'thinking' || mode === 'speaking'} mode={mode as any} direction="diagonal" wear={wear} style={styles.traceTopRight} />
        <NeuralTrace active={!!activeChoiceMenu} mode="guided" direction="diagonalUp" wear={wear} style={styles.traceChoiceA} />
        <NeuralTrace active={mode === 'media'} mode="media" wear={wear} style={styles.traceMedia} />
        <NeuralTrace active={mode === 'speaking'} mode="speaking" direction="vertical" wear={wear} style={styles.traceVoice} />
      </View>

      <View style={styles.topRail}>
        <GaugeStatus label="state" value={visibleMode(rawMode)} mode={mode as any} active level={mode === 'idle' ? 0.25 : 0.72} />
        <GaugeStatus label="voice" value={status} mode={mode as any} active level={Math.max(0.18, audioLevel)} style={styles.flexGauge} />
        <GaugeStatus label="skill" value={session} mode={brain.sessionLabel ? 'guided' : mode as any} active level={brain.sessionLabel ? 0.78 : 0.32} />
        <View style={styles.ledBox}>
          <Text style={styles.ledLabel}>neural load</Text>
          <LedBank mode={mode as any} level={Math.max(audioLevel, interactionPulse * 0.65)} />
        </View>
      </View>

      <View style={styles.coreBay}>
        <View style={[styles.coreAura, { shadowColor: glow }]} />
        <AngelVisual mode={brain.mode} audioLevel={audioLevel} size={360} wear={wear} interactionPulse={interactionPulse} />
      </View>

      <View style={styles.sideControlsLeft}>
        <MechanicalSwitch label="wake gate" value={mode !== 'idle'} mode="listening" wear={wear} />
        <MechanicalSwitch label="barge-in relay" value={!!brain.voiceCapability?.allowBargeIn} mode="speaking" wear={wear} style={styles.controlGap} />
        <RotarySelector label="sensitivity" valueLabel={String(brain.voiceCapability?.listenMode || 'strict')} detent={mode === 'listening' ? 2 : mode === 'speaking' ? 4 : 1} mode="listening" active={mode === 'listening'} style={styles.controlGap} />
      </View>

      <View style={styles.sideControlsRight}>
        <RotarySelector label="cadence" valueLabel={brain.sessionLabel ? 'guided' : 'guardian'} detent={brain.sessionLabel ? 4 : 2} mode={brain.sessionLabel ? 'guided' : mode as any} active style={styles.controlGap} />
        <MechanicalSwitch label="soundscape bus" value={!!brain.activeMedia || mode === 'media'} mode="media" wear={wear} style={styles.controlGap} />
      </View>

      {choices.length ? (
        <EmbossedPanel title={activeChoiceMenu?.title || 'spoken mechanical selector'} mode="guided" active wear={wear} style={styles.choicePanel}>
          <View style={styles.choiceGrid}>
            {choices.map((option: any, index: number) => (
              <TactileButton
                key={option.key || option.label || index}
                index={option.key || index + 1}
                label={String(option.label || option.title || `Option ${index + 1}`)}
                sublabel={String(option.description || 'Say the number, letter, or name')}
                active={index === 0}
                pressed={index === 0 && mode === 'thinking'}
                mode="guided"
                wear={wear}
                style={styles.choiceButton}
              />
            ))}
          </View>
        </EmbossedPanel>
      ) : (
        <EmbossedPanel title="wake console" mode={mode as any} active={mode !== 'idle'} wear={wear} style={styles.choicePanel}>
          <View style={styles.wakeRow}>
            <TactileButton index="AGA" label="wake word" sublabel="Say “AGA” to wake AGA" active={mode === 'listening' || rawMode === 'awake'} mode="listening" wear={wear} style={styles.wakeButton} />
            <View style={styles.wakeCopyBox}>
              <Text style={styles.wakeTitle}>VOICE MIC CONSOLE</Text>
              <Text style={styles.wakeCopy}>Microphone is live. The waveform shows audio. Wake keywords trigger AGA; full words appear after wake through STT.</Text>
            </View>
          </View>
        </EmbossedPanel>
      )}

      {messages.length ? (
        <EmbossedPanel title="etched turn plates" mode={mode as any} wear={wear} style={styles.messagePanel}>
          {messages.map((message, i) => <MessagePlate key={message.key} role={message.role} text={message.text} mode={mode as any} active={i === messages.length - 1} style={i ? styles.messageGap : undefined} />)}
        </EmbossedPanel>
      ) : null}

      <View style={styles.holographicOverlay} />
      <View style={styles.scanlineOverlay} />
</View>
  );
});

const cornerRivet = {
  position: 'absolute' as const,
  width: 10,
  height: 10,
  borderRadius: 10,
  backgroundColor: AGA.colors.wornEdge,
  shadowColor: '#000',
  shadowOpacity: 0.9,
  shadowRadius: 8,
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  deepVoid: { ...StyleSheet.absoluteFillObject, backgroundColor: '#000' },
  AGADeck: { position: 'absolute', width: '94%', height: '90%', borderRadius: 34, backgroundColor: AGA.colors.panelBase, borderWidth: 1, borderColor: '#203235', shadowColor: '#000', shadowOpacity: 0.96, shadowRadius: 34, overflow: 'hidden' },
  deckPatina: { ...StyleSheet.absoluteFillObject, backgroundColor: AGA.colors.oxidizedCopper, opacity: 0.045 },
  deckBevel: { ...StyleSheet.absoluteFillObject, borderRadius: 34, borderTopWidth: 3, borderLeftWidth: 2, borderTopColor: 'rgba(255,255,255,0.10)', borderLeftColor: 'rgba(255,255,255,0.05)', borderBottomWidth: 8, borderRightWidth: 6, borderBottomColor: 'rgba(0,0,0,0.82)', borderRightColor: 'rgba(0,0,0,0.66)' },
  deckGrain: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(255,255,255,0.55)', opacity: 0.025 },
  cornerRivetA: { ...cornerRivet, top: 18, left: 18 },
  cornerRivetB: { ...cornerRivet, top: 18, right: 18 },
  cornerRivetC: { ...cornerRivet, bottom: 18, left: 18 },
  cornerRivetD: { ...cornerRivet, bottom: 18, right: 18 },
  neuralPlane: { ...StyleSheet.absoluteFillObject },
  traceTopLeft: { position: 'absolute', top: '30%', left: '9%', width: '27%' },
  traceTopRight: { position: 'absolute', top: '28%', right: '8%', width: '25%' },
  traceChoiceA: { position: 'absolute', bottom: '25%', left: '17%', width: '28%' },
  traceMedia: { position: 'absolute', bottom: '31%', right: '17%', width: '23%' },
  traceVoice: { position: 'absolute', top: '40%', right: '32%' },
  topRail: { position: 'absolute', top: 22, left: 24, right: 24, flexDirection: 'row', gap: 10, alignItems: 'stretch' },
  flexGauge: { flex: 1 },
  ledBox: { borderRadius: 15, padding: 10, minWidth: 130, backgroundColor: '#0d1516', borderWidth: 1, borderColor: '#26383a' },
  ledLabel: { color: AGA.colors.engraved, fontSize: 9, fontWeight: '900', letterSpacing: 1.3, textTransform: 'uppercase', marginBottom: 8 },
  coreBay: { alignItems: 'center', justifyContent: 'center', marginTop: -18 },
  coreAura: { position: 'absolute', width: 340, height: 340, borderRadius: 340, shadowOpacity: 0.32, shadowRadius: 44 },
  sideControlsLeft: { position: 'absolute', left: 24, top: 112, width: 178 },
  sideControlsRight: { position: 'absolute', right: 24, top: 128, width: 168, alignItems: 'stretch' },
  controlGap: { marginTop: 12 },
  choicePanel: { position: 'absolute', left: 24, right: 24, bottom: 24 },
  choiceGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  choiceButton: { flexGrow: 1, flexBasis: 178 },
  wakeRow: { flexDirection: 'row', gap: 14, alignItems: 'stretch' },
  wakeButton: { width: 190 },
  wakeCopyBox: { flex: 1, justifyContent: 'center', paddingRight: 8 },
  wakeTitle: { color: AGA.colors.amber, fontSize: 12, fontWeight: '900', letterSpacing: 2.2, textTransform: 'uppercase', marginBottom: 6 },
  wakeCopy: { color: AGA.colors.engraved, fontSize: 14, lineHeight: 20, fontWeight: '700' },
  messagePanel: { position: 'absolute', right: 24, bottom: 186, width: 310, maxHeight: 230 },
  messageGap: { marginTop: 10 },
  holographicOverlay: { ...StyleSheet.absoluteFillObject, borderWidth: 1, borderColor: 'rgba(72,240,255,0.045)', transform: [{ translateY: -1 }] },
  scanlineOverlay: { ...StyleSheet.absoluteFillObject, opacity: 0.028, backgroundColor: 'rgba(120,245,255,0.34)' },
});

export default AgaPureDisplayScreen;
