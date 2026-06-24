import { z } from 'sqlite-zod-orm';
import { getAssistantPreferences, saveAssistantPreferences } from '../db';

export const personaNameSchema = z.enum(['warm', 'bright', 'calm', 'coach', 'story']);
export type PersonaName = z.infer<typeof personaNameSchema>;

export type Persona = {
  name: PersonaName;
  label: string;
  systemPrompt: string;
  rate: number;
  pitch: number;
  hue: number;
  mood: 'supportive' | 'playful' | 'grounded' | 'focused' | 'expressive';
};

export const personas: Record<PersonaName, Persona> = {
  warm: {
    name: 'warm',
    label: 'Warm supportive',
    systemPrompt: 'Speak as AGA: warm, feminine, supportive, wise, and lightly playful. Be concise enough for voice.',
    rate: 0.98,
    pitch: 1.08,
    hue: 315,
    mood: 'supportive',
  },
  bright: {
    name: 'bright',
    label: 'Bright playful',
    systemPrompt: 'Speak as AGA: energetic, encouraging, bright, and optimistic. Keep answers crisp and upbeat.',
    rate: 1.08,
    pitch: 1.18,
    hue: 190,
    mood: 'playful',
  },
  calm: {
    name: 'calm',
    label: 'Calm wise',
    systemPrompt: 'Speak as AGA: calm, grounding, wise, and gentle. Slow down and make the user feel safe.',
    rate: 0.9,
    pitch: 0.96,
    hue: 220,
    mood: 'grounded',
  },
  coach: {
    name: 'coach',
    label: 'Focused coach',
    systemPrompt: 'Speak as AGA: practical, direct, and encouraging. Prefer clear next steps and brief check-ins.',
    rate: 1,
    pitch: 1.02,
    hue: 42,
    mood: 'focused',
  },
  story: {
    name: 'story',
    label: 'Expressive storyteller',
    systemPrompt: 'Speak as AGA: expressive, vivid, friendly, and emotionally intelligent. Still stay useful and clear.',
    rate: 0.98,
    pitch: 1.12,
    hue: 270,
    mood: 'expressive',
  },
};

export function getActivePersona() {
  const prefs = getAssistantPreferences();
  return personas[prefs.voiceStyle] ?? personas.warm;
}

export function inferPersonaFromText(text: string): PersonaName | null {
  const lower = text.toLowerCase();
  if (/calm|soft|gentle|slow|quiet|wise/.test(lower)) return 'calm';
  if (/bright|happy|playful|fun|cheer/.test(lower)) return 'bright';
  if (/coach|direct|focused|practical|strict/.test(lower)) return 'coach';
  if (/story|expressive|dramatic|vivid/.test(lower)) return 'story';
  if (/warm|supportive|kind|sweet|angel/.test(lower)) return 'warm';
  return null;
}

export function applyPersonaCommand(text: string) {
  const persona = inferPersonaFromText(text) ?? getAssistantPreferences().voiceStyle;
  return saveAssistantPreferences({ voiceStyle: persona });
}
