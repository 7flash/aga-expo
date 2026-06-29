import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

export type VoicePlateOption = {
  key?: string;
  label: string;
  description?: string;
  examples?: string[];
};

export type VoicePlatesMenu = {
  title?: string;
  subtitle?: string;
  options?: VoicePlateOption[];
};

const DEFAULT_OPTIONS: VoicePlateOption[] = [
  { key: 'A', label: 'Ask AGA', description: 'time, weather, simple answers', examples: ['what time is it', 'what is the weather'] },
  { key: 'B', label: 'Play YouTube', description: 'videos and music by voice', examples: ['open youtube calm music', 'play lo-fi on YouTube'] },
  { key: 'C', label: 'Live conversation', description: 'continuous talk mode', examples: ['start live conversation', 'conversation mode'] },
  { key: 'D', label: 'Guided session', description: 'breathing, meditation, hypnosis', examples: ['start breathing reset', 'safe self hypnosis'] },
  { key: 'E', label: 'Settings', description: 'voice, personality, sensitivity', examples: ['open settings', 'change voice'] },
];

export function normalizePlatesMenu(menu?: VoicePlatesMenu | null): Required<VoicePlatesMenu> {
  const raw = Array.isArray(menu?.options) && menu!.options!.length ? menu!.options! : DEFAULT_OPTIONS;
  return {
    title: menu?.title || 'Voice choices',
    subtitle: menu?.subtitle || 'Say the letter, number, or option name. Say “cancel” to close choices.',
    options: raw.slice(0, 8).map((option, index) => ({
      key: option.key || String.fromCharCode(65 + index),
      label: option.label,
      description: option.description || '',
      examples: option.examples || [],
    })),
  };
}

export default function HolographicVoicePlatesOverlay({ menu, visible = true }: { menu?: VoicePlatesMenu | null; visible?: boolean }) {
  if (!visible) return null;
  const normalized = normalizePlatesMenu(menu);
  return (
    <View style={styles.wrap} pointerEvents="none">
      <View style={styles.header}>
        <Text style={styles.title}>{normalized.title}</Text>
        <Text style={styles.subtitle}>{normalized.subtitle}</Text>
      </View>
      <View style={styles.grid}>
        {normalized.options.map((option) => (
          <View key={`${option.key}:${option.label}`} style={styles.plate}>
            <Text style={styles.key}>{option.key}</Text>
            <Text style={styles.label}>{option.label}</Text>
            {!!option.description && <Text style={styles.desc}>{option.description}</Text>}
            {!!option.examples?.[0] && <Text style={styles.example}>“{option.examples[0]}”</Text>}
          </View>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 32,
    right: 32,
    bottom: 28,
    borderRadius: 28,
    borderWidth: 1,
    borderColor: 'rgba(106,246,255,0.34)',
    backgroundColor: 'rgba(4,18,22,0.78)',
    padding: 16,
    shadowColor: '#5ff7ff',
    shadowOpacity: 0.25,
    shadowRadius: 22,
  },
  header: { marginBottom: 12 },
  title: { color: '#eaffff', fontSize: 20, fontWeight: '900' },
  subtitle: { color: '#a8cbd2', fontSize: 13, marginTop: 3 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  plate: {
    flexGrow: 1,
    flexBasis: 180,
    minHeight: 92,
    borderWidth: 1,
    borderColor: 'rgba(106,246,255,0.22)',
    borderRadius: 20,
    backgroundColor: 'rgba(12,39,43,0.68)',
    padding: 14,
  },
  key: { color: '#ffd866', fontSize: 17, fontWeight: '900', marginBottom: 6 },
  label: { color: '#ffffff', fontSize: 18, fontWeight: '900' },
  desc: { color: '#c1d4d8', fontSize: 13, marginTop: 4 },
  example: { color: '#8cf7ff', fontSize: 12, marginTop: 9, fontWeight: '700' },
});
