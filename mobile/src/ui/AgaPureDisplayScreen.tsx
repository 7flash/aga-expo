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
import { glowForMode, tactileRelic as relic } from './tactile/tokens';

function visibleMode(mode: string) {
  if (mode === 'awake') return 'awake';
  if (mode === 'recovering') return 'repair';
  if (mode === 'sleeping') return 'armed';
  return mode || 'idle';
}

function normalizeMode(mode: string) {
  if (mode === 'awake') return 'listening';
  if (mode === 'sleeping') return 'idle';
  return mode || 'idle';
}

function oneLine(value: unknown, fallback = '') {
  return String(value || fallback).replace(/\s+/g, ' ').trim();
}

function compactStatus(status: string) {
  const s = oneLine(status, 'ready');
  if (/web preview listening/i.test(s)) return 'web mic armed';
  if (/porcupine listening/i.test(s)) return 'porcupine armed';
  if (/live session starting/i.test(s)) return 'live opening';
  if (/heard:/i.test(s)) return 'phrase captured';
  if (/hearing:/i.test(s)) return 'hearing words';
  if (/wake engine failed/i.test(s)) return 'wake fault';
  if (/starting/i.test(s)) return 'starting wake';
  return s.length > 24 ? `${s.slice(0, 21)}…` : s;
}

function recentPlates(messages: any[]) {
  return Array.isArray(messages) ? messages.slice(-2).map((message, i) => ({
    key: `${message?.createdAt || i}-${message?.role || 'turn'}`,
    role: String(message?.role || 'assistant'),
    text: oneLine(message?.content || message?.text),
  })).filter((m) => m.text) : [];
}

function providerLabel(brain: any) {
  const provider = oneLine(brain.wakeProvider || brain.voiceCapability?.wakeProvider || brain.voiceCapability?.wakeDiagnostics?.provider);
  if (!provider) return 'wake';
  if (provider === 'web-speech-dev') return 'web mic';
  if (provider === 'porcupine') return 'porcupine';
  return provider.length > 14 ? `${provider.slice(0, 12)}…` : provider;
}

/**
 * Tactile Neural Relic kiosk surface.
 *
 * This is still display-only; it now exposes the practical debugging state the
 * appliance needs: wake provider, captured words, and whether the post-wake live
 * ear is opening. No touch handlers, no text inputs, no flat app chrome.
 */
export const AgaPureDisplayScreen = memo(function AgaPureDisplayScreen() {
  const brain = useAgaBrain() as any;
  const rawMode = String(brain.mode || 'sleeping');
  const mode = normalizeMode(rawMode);
  const glow = glowForMode(mode);
  const activeChoiceMenu = brain.activeChoiceMenu;
  const choices = Array.isArray(activeChoiceMenu?.options) ? activeChoiceMenu.options.slice(0, 6) : [];
  const status = oneLine(brain.speechStatus || brain.ttsStatus || visibleMode(rawMode));
  const statusShort = compactStatus(status);
  const session = oneLine(brain.sessionLabel || 'guardian');
  const heardText = oneLine(brain.heardText || brain.interim || '');
  const wakeProvider = providerLabel(brain);
  const error = oneLine(brain.error || '');
  const audioLevel = typeof brain.audioLevel === 'number' ? brain.audioLevel : mode === 'speaking' ? 0.72 : mode === 'listening' ? 0.24 : 0.05;
  const interactionPulse = heardText ? 0.92 : choices.length ? 0.85 : mode === 'speaking' || mode === 'thinking' ? 0.62 : 0.18;
  const messages = useMemo(() => recentPlates(brain.messages || []), [brain.messages]);
  const wear = Math.min(0.72, 0.18 + (brain.reminders?.length || 0) * 0.025 + (brain.messages?.length || 0) * 0.004 + (brain.sessionLabel ? 0.08 : 0));

  return (
    <View pointerEvents="none" style={styles.root}>
      <View style={styles.deepVoid} />
      <View style={styles.relicDeck}>
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
        <NeuralTrace active={!!activeChoiceMenu || !!heardText} mode="guided" direction="diagonalUp" wear={wear} style={styles.traceChoiceA} />
        <NeuralTrace active={mode === 'media'} mode="media" wear={wear} style={styles.traceMedia} />
        <NeuralTrace active={mode === 'speaking' || !!heardText} mode="speaking" direction="vertical" wear={wear} style={styles.traceVoice} />
      </View>

      <View style={styles.topRail}>
        <GaugeStatus label="state" value={visibleMode(rawMode)} mode={mode as any} active level={mode === 'idle' ? 0.25 : 0.72} style={styles.gauge} />
        <GaugeStatus label="ear" value={wakeProvider} mode={mode as any} active level={mode === 'listening' ? 0.82 : 0.42} style={styles.gauge} />
        <GaugeStatus label="voice" value={statusShort} mode={mode as any} active level={Math.max(0.18, audioLevel)} style={styles.flexGauge} />
        <GaugeStatus label="skill" value={session} mode={brain.sessionLabel ? 'guided' : mode as any} active level={brain.sessionLabel ? 0.78 : 0.32} style={styles.gauge} />
        <View style={styles.ledBox}>
          <Text style={styles.ledLabel}>load</Text>
          <LedBank mode={mode as any} level={Math.max(audioLevel, interactionPulse * 0.65)} />
        </View>
      </View>

      <View style={styles.coreBay}>
        <View style={[styles.coreAura, { shadowColor: glow }]} />
        <AngelVisual mode={brain.mode} audioLevel={audioLevel} size={360} wear={wear} interactionPulse={interactionPulse} />
      </View>

      <View style={styles.sideControlsLeft}>
        <MechanicalSwitch label="WAKE" value={mode !== 'idle'} mode="listening" wear={wear} />
        <MechanicalSwitch label="BARGE" value={!!brain.voiceCapability?.allowBargeIn} mode="speaking" wear={wear} style={styles.controlGap} />
        <RotarySelector label="sensitivity" valueLabel={String(brain.voiceCapability?.listenMode || 'strict')} detent={mode === 'listening' ? 2 : mode === 'speaking' ? 4 : 1} mode="listening" active={mode === 'listening'} style={styles.controlGap} />
      </View>

      <View style={styles.sideControlsRight}>
        <RotarySelector label="cadence" valueLabel={brain.sessionLabel ? 'guided' : 'guardian'} detent={brain.sessionLabel ? 4 : 2} mode={brain.sessionLabel ? 'guided' : mode as any} active style={styles.controlGap} />
        <MechanicalSwitch label="SOUND" value={!!brain.activeMedia || mode === 'media'} mode="media" wear={wear} style={styles.controlGap} />
      </View>

      {heardText || error ? (
        <EmbossedPanel title={error ? 'fault plate' : 'captured phrase'} mode={error ? 'warning' : mode as any} active wear={wear} style={styles.livePhrasePanel}>
          <MessagePlate role={error ? 'fault' : 'heard'} text={error || heardText} mode={error ? 'warning' : mode as any} active />
        </EmbossedPanel>
      ) : null}

      {choices.length ? (
        <EmbossedPanel title={oneLine(activeChoiceMenu?.title || 'spoken selector')} mode="guided" active wear={wear} style={styles.choicePanel}>
          <View style={styles.choiceGrid}>
            {choices.map((option: any, index: number) => (
              <TactileButton
                key={option.key || option.label || index}
                index={option.key || index + 1}
                label={oneLine(option.label || option.title || `Option ${index + 1}`)}
                sublabel={oneLine(option.description || 'Say the number, letter, or name')}
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
            <TactileButton
              index={wakeProvider === 'web mic' ? 'WEB' : 'AGA'}
              label={heardText ? 'phrase locked' : 'wake word'}
              sublabel={heardText || (wakeProvider === 'web mic' ? 'Web preview: allow microphone, then say “AGA stop pause”.' : 'Android: Porcupine listens for AGA / stop / pause.')}
              active={mode === 'listening' || rawMode === 'awake' || !!heardText}
              pressed={!!heardText && mode === 'thinking'}
              mode="listening"
              wear={wear}
              style={styles.wakeButton}
            />
            <View style={styles.wakeCopyBox}>
              <Text style={styles.wakeTitle}>TACTILE NEURAL RELIC</Text>
              <Text style={styles.wakeCopy}>{status}</Text>
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
  backgroundColor: relic.colors.wornEdge,
  shadowColor: '#000',
  shadowOpacity: 0.9,
  shadowRadius: 8,
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  deepVoid: { ...StyleSheet.absoluteFillObject, backgroundColor: '#000' },
  relicDeck: { position: 'absolute', width: '94%', height: '90%', borderRadius: 34, backgroundColor: relic.colors.panelBase, borderWidth: 1, borderColor: '#203235', shadowColor: '#000', shadowOpacity: 0.96, shadowRadius: 34, overflow: 'hidden' },
  deckPatina: { ...StyleSheet.absoluteFillObject, backgroundColor: relic.colors.oxidizedCopper, opacity: 0.045 },
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
  gauge: { width: 104 },
  flexGauge: { flex: 1, minWidth: 180 },
  ledBox: { borderRadius: 15, padding: 10, minWidth: 96, backgroundColor: '#0d1516', borderWidth: 1, borderColor: '#26383a' },
  ledLabel: { color: relic.colors.engraved, fontSize: 9, fontWeight: '900', letterSpacing: 1.3, textTransform: 'uppercase', marginBottom: 8 },
  coreBay: { alignItems: 'center', justifyContent: 'center', marginTop: -18 },
  coreAura: { position: 'absolute', width: 340, height: 340, borderRadius: 340, shadowOpacity: 0.32, shadowRadius: 44 },
  sideControlsLeft: { position: 'absolute', left: 24, top: 112, width: 150 },
  sideControlsRight: { position: 'absolute', right: 24, top: 128, width: 150, alignItems: 'stretch' },
  controlGap: { marginTop: 12 },
  livePhrasePanel: { position: 'absolute', left: 210, right: 210, bottom: 166 },
  choicePanel: { position: 'absolute', left: 24, right: 24, bottom: 24 },
  choiceGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  choiceButton: { flexGrow: 1, flexBasis: 178 },
  wakeRow: { flexDirection: 'row', gap: 14, alignItems: 'stretch' },
  wakeButton: { width: 230 },
  wakeCopyBox: { flex: 1, justifyContent: 'center', paddingRight: 8 },
  wakeTitle: { color: relic.colors.amber, fontSize: 12, fontWeight: '900', letterSpacing: 2.2, textTransform: 'uppercase', marginBottom: 6 },
  wakeCopy: { color: relic.colors.engraved, fontSize: 13, lineHeight: 18, fontWeight: '700' },
  messagePanel: { position: 'absolute', right: 24, bottom: 194, width: 310, maxHeight: 230 },
  messageGap: { marginTop: 10 },
  holographicOverlay: { ...StyleSheet.absoluteFillObject, borderWidth: 1, borderColor: 'rgba(72,240,255,0.045)', transform: [{ translateY: -1 }] },
  scanlineOverlay: { ...StyleSheet.absoluteFillObject, opacity: 0.028, backgroundColor: 'rgba(120,245,255,0.34)' },
});

export default AgaPureDisplayScreen;
