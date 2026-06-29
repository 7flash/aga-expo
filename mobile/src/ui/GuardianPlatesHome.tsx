import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

type Plate = {
  key: string;
  title: string;
  subtitle: string;
  examples: string[];
  route?: string;
  voice?: string;
};

const PLATES: Plate[] = [
  { key: 'A', title: 'Ask AGA', subtitle: 'time, weather, simple answers', examples: ['what time is it', 'what is the weather'], voice: 'Say A' },
  { key: 'B', title: 'Play YouTube', subtitle: 'videos and music by voice', examples: ['open youtube calm music', 'play lo-fi on YouTube'], voice: 'Say B' },
  { key: 'C', title: 'Live conversation', subtitle: 'continuous talk mode', examples: ['start live conversation', 'conversation mode'], voice: 'Say C' },
  { key: 'D', title: 'Guided session', subtitle: 'breathing, meditation, hypnosis', examples: ['start breathing reset', 'safe self hypnosis'], voice: 'Say D' },
  { key: 'E', title: 'Settings', subtitle: 'voice, personality, sensitivity', examples: ['open settings', 'change voice'], voice: 'Say E' },
  { key: 'F', title: 'STT Lab', subtitle: 'test OpenAI transcription alone', examples: ['/stt-lab'], route: '/stt-lab', voice: 'Say F' },
  { key: 'G', title: 'Sherpa Lab', subtitle: 'test wake model alone', examples: ['/sherpa-lab'], route: '/sherpa-lab', voice: 'Say G' },
  { key: 'H', title: 'Voice Lab', subtitle: 'test full browser appliance', examples: ['/voice-lab'], route: '/voice-lab', voice: 'Say H' },
];

function go(route: string) {
  if (typeof window !== 'undefined') window.location.href = route;
}

function inferChoice(text: string) {
  const clean = text.trim().toLowerCase();
  if (!clean) return null;
  const letter = clean.match(/^([a-h])$/)?.[1]?.toUpperCase();
  if (letter) return PLATES.find((p) => p.key === letter) || null;
  return PLATES.find((p) => clean.includes(p.title.toLowerCase()) || p.examples.some((ex) => clean.includes(ex.toLowerCase()))) || null;
}

export default function GuardianPlatesHome() {
  const [text, setText] = useState('');
  const [phase, setPhase] = useState('YOUR TURN — choose a plate by voice');
  const [level, setLevel] = useState(0.08);
  const raf = useRef<number | null>(null);

  useEffect(() => {
    let t = 0;
    const tick = () => {
      t += 0.06;
      setLevel(0.07 + Math.abs(Math.sin(t)) * 0.18);
      raf.current = requestAnimationFrame(tick);
    };
    tick();
    return () => { if (raf.current) cancelAnimationFrame(raf.current); };
  }, []);

  const bars = useMemo(() => Array.from({ length: 54 }, (_, i) => {
    const wave = Math.abs(Math.sin(i * 0.42 + Date.now() / 650));
    return Math.max(0.08, Math.min(1, level * (0.8 + wave * 2.6)));
  }), [level]);

  function runChoice(value = text) {
    const choice = inferChoice(value);
    if (!choice) {
      setPhase('NOT UNDERSTOOD — say a plate letter, like “A” or “F”');
      return;
    }
    setPhase(`SELECTED ${choice.key}: ${choice.title}`);
    if (choice.route) go(choice.route);
  }

  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.content}>
      <View style={styles.topRow}>
        <View>
          <Text style={styles.title}>AGA Guardian Console</Text>
          <Text style={styles.subtitle}>Voice-first main menu. Choose a plate by saying its letter or name.</Text>
        </View>
        <View style={styles.statusPlate}>
          <Text style={styles.statusLabel}>CURRENT TURN</Text>
          <Text style={styles.statusText}>{phase}</Text>
        </View>
      </View>

      <View style={styles.hero}>
        <View style={styles.angelRing}>
          <Text style={styles.angel}>👻</Text>
          <Text style={styles.angelLabel}>guardian</Text>
        </View>
        <View style={styles.waveBox}>
          <Text style={styles.statusLabel}>VOICE WAVEFORM</Text>
          <View style={styles.waveBars}>
            {bars.map((h, i) => <View key={i} style={[styles.bar, { height: 8 + h * 62 }]} />)}
          </View>
          <Text style={styles.dim}>This is the visual contract: mic/listening/speaking state must always be shown here, not hidden in dev overlays.</Text>
        </View>
      </View>

      <View style={styles.plateGrid}>
        {PLATES.map((plate) => (
          <Pressable key={plate.key} style={styles.plate} onPress={() => plate.route ? go(plate.route) : runChoice(plate.key)}>
            <Text style={styles.plateKey}>{plate.key}</Text>
            <Text style={styles.plateTitle}>{plate.title}</Text>
            <Text style={styles.plateSubtitle}>{plate.subtitle}</Text>
            <Text style={styles.plateVoice}>{plate.voice}</Text>
            {plate.examples.map((ex) => <Text key={ex} style={styles.example}>“{ex}”</Text>)}
          </Pressable>
        ))}
      </View>

      <View style={styles.commandBox}>
        <Text style={styles.statusLabel}>SIMULATE VOICE CHOICE</Text>
        <View style={{ flexDirection: 'row', gap: 12, flexWrap: 'wrap' }}>
          <TextInput value={text} onChangeText={setText} placeholder="say A, Sherpa Lab, open youtube calm music…" placeholderTextColor="#8695aa" style={styles.input} onSubmitEditing={() => runChoice()} />
          <Pressable style={styles.button} onPress={() => runChoice()}><Text style={styles.buttonText}>Choose</Text></Pressable>
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#050806' },
  content: { padding: 24, gap: 20 },
  topRow: { flexDirection: 'row', justifyContent: 'space-between', gap: 18, flexWrap: 'wrap' },
  title: { color: '#f9fff8', fontSize: 34, fontWeight: '900' },
  subtitle: { color: '#b7c8d0', fontSize: 17, marginTop: 6 },
  statusPlate: { borderColor: '#4feaff', borderWidth: 1, backgroundColor: 'rgba(18,34,34,0.78)', borderRadius: 18, padding: 16, minWidth: 320 },
  statusLabel: { color: '#93f4ff', letterSpacing: 3, fontSize: 11, fontWeight: '900' },
  statusText: { color: '#fff', fontSize: 18, fontWeight: '900', marginTop: 8 },
  hero: { flexDirection: 'row', gap: 20, alignItems: 'stretch', flexWrap: 'wrap' },
  angelRing: { width: 270, height: 270, borderRadius: 140, borderWidth: 1, borderColor: '#285c66', backgroundColor: 'rgba(50,80,100,0.18)', alignItems: 'center', justifyContent: 'center' },
  angel: { fontSize: 96 },
  angelLabel: { color: '#e9feff', fontWeight: '900', marginTop: 10 },
  waveBox: { flex: 1, minWidth: 420, borderColor: '#22374d', borderWidth: 1, backgroundColor: '#081018', borderRadius: 20, padding: 18, justifyContent: 'center' },
  waveBars: { flexDirection: 'row', alignItems: 'flex-end', height: 92, gap: 5, marginVertical: 14 },
  bar: { width: 7, borderRadius: 6, backgroundColor: '#59eaff', shadowColor: '#59eaff', shadowOpacity: 0.8, shadowRadius: 10 },
  dim: { color: '#91a2b5', fontSize: 14 },
  plateGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
  plate: { width: 250, minHeight: 165, borderRadius: 18, borderWidth: 1, borderColor: '#315363', backgroundColor: 'rgba(21,35,38,0.92)', padding: 16 },
  plateKey: { color: '#ffd86b', fontWeight: '900', fontSize: 16 },
  plateTitle: { color: '#ffffff', fontWeight: '900', fontSize: 19, marginTop: 6 },
  plateSubtitle: { color: '#bcd2dc', fontSize: 14, marginTop: 3 },
  plateVoice: { color: '#80f6ff', fontSize: 13, fontWeight: '900', marginTop: 10 },
  example: { color: '#a8b6c8', fontSize: 12, marginTop: 4 },
  commandBox: { borderColor: '#293d50', borderWidth: 1, borderRadius: 18, backgroundColor: '#080e16', padding: 16, gap: 12 },
  input: { color: '#fff', borderColor: '#30445c', borderWidth: 1, borderRadius: 14, padding: 13, fontSize: 16, minWidth: 420, flex: 1 },
  button: { backgroundColor: '#edf2ff', borderRadius: 999, paddingVertical: 13, paddingHorizontal: 22, alignSelf: 'flex-start' },
  buttonText: { color: '#0b1020', fontWeight: '900', fontSize: 16 },
});
