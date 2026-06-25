import type { AgaMode } from './turn';
import {
  buildChoiceMenu,
  findChoice,
  type ChoiceMenu,
  type ChoiceOption,
  type ChoiceAction,
  type SessionKind,
} from './choiceMenus';
import { runGetTimeCapability, runGetWeatherCapability, type JsonObject } from './capabilityRegistry';
import {
  addMemory,
  addReminder,
  clearReminders,
  listPendingReminders,
  logEvent,
  savePreferences,
  searchMemories,
  type Preferences,
} from '../db/localStore';
import {
  cancelAllNotifications,
  ensureNotificationPermission,
  scheduleAgaReminderNotification,
} from '../notifications/localNotifications';
import { searchYouTube } from '../media/youtube';
import {
  executeRemoteTool,
  getRemoteConfigRevision,
  getRemoteTools,
} from '../remote/config';

export type CapabilityPatch = Record<string, unknown>;
export type CapabilityHandler = (args: JsonObject) => Promise<string>;

export type CapabilityRunnerContext = {
  getPrefs: () => Preferences | null;
  setPrefs: (prefs: Preferences) => void;
  publish: (patch: CapabilityPatch) => void;
  setMode: (mode: AgaMode) => void;
  refresh: () => Promise<void>;
  updateRealtimeSession: () => void;
  applyRemoteConfig: (reason: string) => Promise<void>;
  requestReconnect: (reason: string) => void;
  getActiveChoiceMenu: () => ChoiceMenu | null | undefined;
  defaultVoice: string;
};

function listeningModeLabel(mode: string, bargeIn: boolean) {
  const clean = mode === 'handsfree' ? 'hands-free' : mode === 'answer_window' ? 'question-window' : 'wake-word';
  return `${clean}${bargeIn ? ' + interruption' : ''}`;
}

function generatedPersonality(style: string) {
  const clean = String(style || 'fresh guardian blend').trim();
  return `Personality overlay: AGA is a ${clean}. Keep replies short, warm, curious, and voice-first. Offer choices when changing modes. Never mention buttons, tapping, or text input.`;
}

function menuSpokenSummary(menu: ChoiceMenu) {
  const options = menu.options.map((option) => `${option.key}: ${option.label}`).join('; ');
  return `${menu.title}. ${options}. Say the number, letter, or option name.`;
}

function normalizeListenMode(value: unknown): 'strict' | 'answer_window' | 'handsfree' {
  const raw = String(value ?? 'strict').toLowerCase();
  if (raw === 'handsfree' || raw === 'hands-free' || raw === 'conversation') return 'handsfree';
  if (raw === 'answer_window' || raw === 'answer-window' || raw === 'question' || raw === 'question_window') return 'answer_window';
  return 'strict';
}

export function createCapabilityRunner(ctx: CapabilityRunnerContext) {
  async function setPrefs(patch: Partial<Preferences>) {
    const next = await savePreferences(patch);
    ctx.setPrefs(next);
    return next;
  }

  async function applyChoice(option: ChoiceOption): Promise<string> {
    const action = option.action as ChoiceAction;

    if (action.type === 'show_menu') {
      const menu = buildChoiceMenu(action.menu);
      ctx.publish({ activeChoiceMenu: menu });
      await logEvent('settings.menu', menu.id);
      return menuSpokenSummary(menu);
    }

    ctx.publish({ activeChoiceMenu: null });

    if (action.type === 'set_voice') {
      await setPrefs({ realtimeVoice: action.voice } as Partial<Preferences>);
      ctx.updateRealtimeSession();
      ctx.requestReconnect(`voice:${action.voice}`);
      ctx.publish({ speechStatus: `voice set: ${action.label}` });
      await logEvent('settings.voice', action.voice);
      return `Voice changed to ${action.label}. I will use it from my next reply.`;
    }

    if (action.type === 'set_persona') {
      await setPrefs({ persona: action.persona, personalityPrompt: null } as Partial<Preferences>);
      ctx.updateRealtimeSession();
      await logEvent('settings.persona', action.persona);
      return `Personality changed to ${action.label}.`;
    }

    if (action.type === 'regenerate_personality') {
      const prompt = generatedPersonality(action.style);
      await setPrefs({ personalityPrompt: prompt } as Partial<Preferences>);
      ctx.updateRealtimeSession();
      await logEvent('settings.personality.regenerate', action.style);
      return 'I regenerated my personality blend for this device.';
    }

    if (action.type === 'start_remote_skill') {
      const activeSession = {
        kind: 'remote' as SessionKind,
        label: action.label,
        skillId: action.skillId,
        instructions: action.instructions,
        targetLanguage: action.targetLanguage ?? null,
        theme: action.theme ?? null,
        iconUrl: action.iconUrl ?? null,
        imageUrl: action.imageUrl ?? null,
        toolNames: action.toolNames ?? [],
        startedAt: new Date().toISOString(),
      };
      await setPrefs({ activeSession } as Partial<Preferences>);
      ctx.publish({ sessionLabel: activeSession.label });
      ctx.updateRealtimeSession();
      await logEvent('settings.remote_skill.start', `${action.skillId}: ${action.label}`);
      return `Starting ${activeSession.label}.`;
    }

    if (action.type === 'start_session') {
      const activeSession = {
        kind: action.kind,
        label: action.label,
        targetLanguage: action.targetLanguage ?? null,
        theme: action.theme ?? null,
        startedAt: new Date().toISOString(),
      };
      await setPrefs({ activeSession } as Partial<Preferences>);
      ctx.publish({ sessionLabel: activeSession.label });
      ctx.updateRealtimeSession();
      await logEvent('settings.session.start', activeSession.label);
      return `Starting ${activeSession.label}.`;
    }

    if (action.type === 'end_session') {
      await setPrefs({ activeSession: null } as Partial<Preferences>);
      ctx.publish({ sessionLabel: null });
      ctx.updateRealtimeSession();
      return 'Session ended. Back to normal guardian mode.';
    }

    if (action.type === 'set_listening_mode') {
      const nextMode = normalizeListenMode(action.mode);
      const allowBargeIn = !!action.allowBargeIn;
      await setPrefs({ realtimeListenMode: nextMode, allowBargeIn } as Partial<Preferences>);
      ctx.publish({ listeningMode: listeningModeLabel(nextMode, allowBargeIn) });
      ctx.updateRealtimeSession();
      await logEvent('settings.listening', listeningModeLabel(nextMode, allowBargeIn));
      return `Listening mode set to ${listeningModeLabel(nextMode, allowBargeIn)}.`;
    }

    return 'Done.';
  }

  const handlers: Record<string, CapabilityHandler> = {
    get_time: async (args) => runGetTimeCapability(args),
    get_weather: async (args) => runGetWeatherCapability(args, ctx.getPrefs()),
    remember: async ({ text }) => {
      await addMemory(String(text ?? ''));
      await logEvent('memory.add', String(text ?? ''));
      await ctx.refresh();
      return `Saved: ${text}`;
    },
    recall: async ({ query }) => {
      const found = await searchMemories(query ? String(query) : undefined, 6);
      return found.length ? found.map((memory) => memory.text).join('; ') : 'No memories yet.';
    },
    set_reminder: async ({ text, when_iso }) => {
      const dueAt = String(when_iso ?? new Date(Date.now() + 60_000).toISOString());
      const body = String(text ?? '');
      const notificationId = await scheduleAgaReminderNotification({
        body,
        dueAt,
        data: { kind: 'aga.reminder' },
      }).catch(() => null);
      const reminder = await addReminder(body, dueAt, notificationId);
      await ensureNotificationPermission();
      await logEvent('reminder.add', `${reminder.text} @ ${dueAt}${notificationId ? ` n=${notificationId}` : ''}`);
      await ctx.refresh();
      return `Reminder set for ${new Date(dueAt).toLocaleString()}.`;
    },
    list_reminders: async () => {
      const pending = await listPendingReminders(8);
      return pending.length ? pending.map((reminder) => `${reminder.text} (${reminder.dueAt})`).join('; ') : 'No pending reminders.';
    },
    clear_reminders: async () => {
      await clearReminders();
      await cancelAllNotifications();
      await ctx.refresh();
      return 'All reminders cleared.';
    },
    play_youtube: async ({ query }) => {
      const q = String(query ?? 'music').trim() || 'music';
      ctx.publish({ activeMedia: { type: 'youtube', videoId: '', title: q, url: '', thumbnailUrl: null, query: q, state: 'loading' } });
      ctx.setMode('media');
      const result = await searchYouTube(q);
      ctx.publish({ activeMedia: { ...result, type: 'youtube', state: 'playing' }, mediaCommand: null });
      await logEvent('youtube.play', `${result.title} ${result.url}`);
      await ctx.refresh();
      return `Playing ${result.title}. I can still speak over the music; say pause, resume, or close video any time.`;
    },
    media_control: async ({ command }) => {
      const cmd = String(command ?? '') as 'pause' | 'resume' | 'stop';
      if (cmd === 'stop') {
        ctx.publish({ activeMedia: null, mediaCommand: 'stop' });
        ctx.setMode('listening');
        return 'Stopped playback.';
      }
      const state = cmd === 'pause' ? 'paused' : 'playing';
      ctx.publish({ mediaCommand: cmd, mediaState: state });
      return cmd === 'pause' ? 'Paused.' : 'Resuming.';
    },
    set_listening_mode: async ({ mode, allow_barge_in }) => {
      const nextMode = normalizeListenMode(mode);
      const currentBarge = !!(ctx.getPrefs() as any)?.allowBargeIn;
      const nextBargeIn = typeof allow_barge_in === 'boolean' ? allow_barge_in : currentBarge;
      await setPrefs({ realtimeListenMode: nextMode, allowBargeIn: nextBargeIn } as Partial<Preferences>);
      ctx.publish({ listeningMode: listeningModeLabel(nextMode, nextBargeIn) });
      ctx.updateRealtimeSession();
      await logEvent('settings.listening', listeningModeLabel(nextMode, nextBargeIn));
      return `Listening mode set to ${listeningModeLabel(nextMode, nextBargeIn)}.`;
    },
    refresh_remote_config: async () => {
      await ctx.applyRemoteConfig('tool');
      return `Pulled server configuration revision ${getRemoteConfigRevision()}.`;
    },
    set_persona: async ({ persona }) => {
      await setPrefs({ persona: String(persona ?? 'warm') } as Partial<Preferences>);
      ctx.updateRealtimeSession();
      await logEvent('prefs.persona', String(persona ?? ''));
      return `Persona set to ${persona}.`;
    },
    set_translate: async ({ target }) => {
      const value = target == null ? null : String(target);
      await setPrefs({ translateTarget: value } as Partial<Preferences>);
      ctx.updateRealtimeSession();
      ctx.setMode(value ? 'translating' : 'listening');
      return value ? `Translating to ${value}.` : 'Translation off.';
    },
    show_settings_menu: async ({ category }) => {
      const menu = buildChoiceMenu(String(category ?? 'main'));
      ctx.publish({ activeChoiceMenu: menu });
      await logEvent('settings.menu', menu.id);
      return menuSpokenSummary(menu);
    },
    choose_option: async ({ choice }) => {
      const option = findChoice(ctx.getActiveChoiceMenu() ?? null, String(choice ?? ''));
      if (!option) return `I could not match ${choice} to the visible options. Say the number, letter, or option name again.`;
      return applyChoice(option);
    },
    set_voice: async ({ voice }) => applyChoice({
      key: 'voice',
      label: String(voice ?? ctx.defaultVoice),
      action: { type: 'set_voice', voice: String(voice ?? ctx.defaultVoice), label: String(voice ?? ctx.defaultVoice) },
    }),
    regenerate_personality: async ({ style }) => applyChoice({
      key: 'personality',
      label: 'Regenerated personality',
      action: { type: 'regenerate_personality', style: String(style ?? 'fresh guardian blend'), label: 'Regenerated personality' },
    }),
    start_session: async ({ kind, label, targetLanguage, theme }) => applyChoice({
      key: 'session',
      label: String(label ?? kind ?? 'New session'),
      action: { type: 'start_session', kind: String(kind ?? 'general') as SessionKind, label: String(label ?? kind ?? 'New session'), targetLanguage: targetLanguage ? String(targetLanguage) : undefined, theme: theme ? String(theme) : undefined },
    }),
    end_session: async () => applyChoice({
      key: 'end',
      label: 'End current session',
      action: { type: 'end_session' },
    }),
  };

  for (const tool of getRemoteTools()) {
    handlers[tool.name] = async (args) => executeRemoteTool(tool.name, args, {
      deviceLabel: (ctx.getPrefs() as any)?.deviceLabel,
      revision: getRemoteConfigRevision(),
      activeSession: ctx.getPrefs()?.activeSession ?? null,
    });
  }

  return {
    handlers,
    run: async (name: string, args: JsonObject = {}) => {
      const handler = handlers[name];
      if (!handler) return `Unknown tool: ${name}`;
      return handler(args);
    },
    chooseFromText: async (text: string) => {
      const option = findChoice(ctx.getActiveChoiceMenu() ?? null, text);
      if (!option) return null;
      return applyChoice(option);
    },
    applyChoice,
  };
}
