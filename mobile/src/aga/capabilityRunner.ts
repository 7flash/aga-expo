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
  getForgetConfirmation,
  listPendingReminders,
  loadPreferences,
  logEvent,
  requestForgetConfirmation,
  resetAgaData,
  savePreferences,
  searchMemories,
  startNewConversationSession,
  type Preferences,
  type ResetScope,
} from '../db/localStore';
import {
  cancelAllNotifications,
  ensureNotificationPermission,
  scheduleAgaReminderNotification,
} from '../notifications/localNotifications';
import { searchYouTube } from '../media/youtube';
import { resolveLocalAmbient } from '../media/ambient';
import { buildGuidedSessionInstructions, findGuidedSession, guidedSessionOpening } from '../sessions/guidedSessions';
import { getUserProfile, profilePromptBlock, updateUserProfileFromSignal } from '../memory/userProfile';
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

function normalizeResetScope(value: unknown): ResetScope {
  const raw = String(value ?? 'everything').toLowerCase();
  if (raw === 'session' || raw === 'context' || raw === 'conversation') return 'session';
  if (raw === 'personalization' || raw === 'memory' || raw === 'memories' || raw === 'profile') return 'personalization';
  return 'everything';
}

function confirmedForget(value: unknown) {
  const clean = String(value ?? '').toLowerCase();
  return /\byes\b/.test(clean) && /\bforget\b/.test(clean);
}

function resetWarning(scope: ResetScope) {
  if (scope === 'session') return 'I can start a fresh session now. Permanent memories, reminders, voice, personality, and server settings will stay.';
  if (scope === 'personalization') return 'This will forget your saved memories, evolving profile, custom personality, and current skill, but keep reminders and technical settings.';
  return 'This will forget personal memories, profile, custom personality, reminders, event logs, and the current transcript. API keys, server config, wake phrase, and device settings will stay.';
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
    start_new_conversation_session: async ({ reason, endActiveSkill }) => {
      const shouldEndSkill = endActiveSkill !== false;
      const conversation = await startNewConversationSession(String(reason || 'user_requested'), {
        clearTranscript: true,
        endActiveSession: shouldEndSkill,
      });
      const prefs = await loadPreferences();
      ctx.setPrefs(prefs);
      ctx.publish({ messages: [], activeChoiceMenu: null, sessionLabel: prefs.activeSession?.label ?? null, speechStatus: 'fresh session started' });
      ctx.updateRealtimeSession();
      ctx.requestReconnect(`new_session:${conversation.id}`);
      await logEvent('conversation.new_session', `${conversation.id} reason=${reason || 'user_requested'}`);
      return shouldEndSkill
        ? 'Fresh session started. I kept permanent memories, reminders, voice, personality, and server settings.'
        : 'Fresh conversation context started. I kept the active skill and all permanent settings.';
    },
    forget_user_data: async ({ scope, confirmation }) => {
      const cleanScope = normalizeResetScope(scope);
      if (cleanScope === 'session') {
        const conversation = await startNewConversationSession('forget_session_tool', { clearTranscript: true, endActiveSession: true });
        const prefs = await loadPreferences();
        ctx.setPrefs(prefs);
        ctx.publish({ messages: [], activeChoiceMenu: null, sessionLabel: null, speechStatus: 'fresh session started' });
        ctx.updateRealtimeSession();
        ctx.requestReconnect(`forget_session:${conversation.id}`);
        await logEvent('conversation.forget_session', conversation.id);
        return 'Done. I cleared only this conversation session. Permanent memories and settings remain.';
      }

      const pending = await getForgetConfirmation(cleanScope);
      const ok = !!pending && confirmedForget(confirmation);
      if (!ok) {
        await requestForgetConfirmation(cleanScope);
        return `${resetWarning(cleanScope)} To confirm, say: AGA yes forget everything.`;
      }

      if (cleanScope === 'everything') {
        await cancelAllNotifications().catch(() => undefined);
      }
      const result = await resetAgaData(cleanScope);
      const prefs = await loadPreferences();
      ctx.setPrefs(prefs);
      const patch: CapabilityPatch = {
        messages: [],
        activeChoiceMenu: null,
        sessionLabel: null,
        activeMedia: null,
        mediaCommand: 'stop',
        speechStatus: cleanScope === 'everything' ? 'everything forgotten' : 'personalization reset',
      };
      if (cleanScope === 'everything') patch.reminders = [];
      ctx.publish(patch);
      ctx.updateRealtimeSession();
      ctx.requestReconnect(`forget:${cleanScope}`);
      await logEvent('conversation.forget_confirmed', `${cleanScope} ${(result as any).conversation?.id ?? ''}`);
      return cleanScope === 'everything'
        ? 'I forgot everything personal and started clean. Technical device settings stayed.'
        : 'I forgot saved personalization and started clean. Reminders and technical device settings stayed.';
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
    play_youtube: async ({ query, forceYouTube }) => {
      const q = String(query ?? 'music').trim() || 'music';
      const explicitYouTube = /(?:youtube\.com|youtu\.be|watch\?v=|youtube video|on youtube|search youtube)/i.test(q);

      // Broad background music is a local ambient capability by default. YouTube
      // embed availability is not deterministic without a server/Data API check;
      // a broken iframe is worse than a simple local soundscape.
      if (!forceYouTube && !explicitYouTube) {
        const ambient = resolveLocalAmbient(q);
        if (ambient) {
          ctx.publish({ activeMedia: { ...ambient, state: 'playing' }, mediaCommand: null });
          ctx.setMode('media');
          await logEvent('ambient.play', `${ambient.kind}: ${q}`);
          await ctx.refresh();
          return `Playing ${ambient.title}. This is generated locally, so it keeps working even when YouTube embeds fail.`;
        }
      }

      ctx.publish({ activeMedia: { type: 'youtube', videoId: '', title: q, url: '', thumbnailUrl: null, query: q, state: 'loading' } });
      ctx.setMode('media');
      const result = await searchYouTube(q);
      ctx.publish({ activeMedia: { ...result, type: 'youtube', state: 'playing' }, mediaCommand: null });
      await logEvent('youtube.play', `${result.title} ${result.url}`);
      await ctx.refresh();
      return `Opening ${result.title}. If YouTube blocks this embed, ask for local ambient music instead.`;
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

    start_guided_session: async ({ kind, goal, durationMinutes }) => {
      const preset = findGuidedSession(kind) ?? findGuidedSession(goal) ?? findGuidedSession('breathing');
      if (!preset) return 'I could not find that guided session.';
      const instructions = [
        buildGuidedSessionInstructions(preset),
        goal ? `User goal/theme for this run: ${String(goal)}.` : '',
        durationMinutes ? `Target duration: about ${Number(durationMinutes)} minutes.` : '',
        profilePromptBlock(await getUserProfile()),
      ].filter(Boolean).join('\n\n');
      const activeSession = {
        kind: 'remote' as SessionKind,
        label: preset.label,
        skillId: preset.id,
        instructions,
        targetLanguage: null,
        theme: goal ? String(goal) : preset.theme ?? null,
        iconUrl: null,
        imageUrl: null,
        toolNames: ['guided_session_control', 'reflect_session', 'update_user_profile', 'get_user_profile'],
        startedAt: new Date().toISOString(),
      };
      await setPrefs({ activeSession } as Partial<Preferences>);
      ctx.publish({ sessionLabel: activeSession.label });
      ctx.updateRealtimeSession();
      await logEvent('guided_session.start', `${preset.id}${goal ? ` goal=${goal}` : ''}`);
      return guidedSessionOpening(preset);
    },
    guided_session_control: async ({ command }) => {
      const cmd = String(command ?? '').toLowerCase();
      if (cmd === 'end') {
        await setPrefs({ activeSession: null } as Partial<Preferences>);
        ctx.publish({ sessionLabel: null });
        ctx.updateRealtimeSession();
        await logEvent('guided_session.end');
        return 'Session ended. I will remember what helped if you want to tell me.';
      }
      await logEvent('guided_session.control', cmd);
      if (cmd === 'pause') return 'Paused. Say AGA resume when you are ready.';
      if (cmd === 'resume') return 'Resuming gently.';
      if (cmd === 'deeper') return 'Going a little deeper, only as much as feels safe.';
      if (cmd === 'skip') return 'Skipping to the next part.';
      if (cmd === 'repeat') return 'Repeating the last cue more slowly.';
      return 'Okay.';
    },
    get_user_profile: async () => profilePromptBlock(await getUserProfile()),
    update_user_profile: async ({ note, goal, technique, emotionalPattern, ritual, communicationStyle }) => {
      const profile = await updateUserProfileFromSignal({
        note: note ? String(note) : undefined,
        goal: goal ? String(goal) : undefined,
        technique: technique ? String(technique) : undefined,
        emotionalPattern: emotionalPattern ? String(emotionalPattern) : undefined,
        ritual: ritual ? String(ritual) : undefined,
        communicationStyle: communicationStyle ? String(communicationStyle) : undefined,
      });
      await ctx.refresh();
      return `Profile updated. ${profile.goals.length} goals, ${profile.effectiveTechniques.length} helpful techniques, ${profile.emotionalPatterns.length} patterns.`;
    },
    reflect_session: async ({ summary, technique, goal, emotionalPattern, nextRitual }) => {
      const profile = await updateUserProfileFromSignal({
        note: summary ? String(summary) : undefined,
        goal: goal ? String(goal) : undefined,
        technique: technique ? String(technique) : undefined,
        emotionalPattern: emotionalPattern ? String(emotionalPattern) : undefined,
        ritual: nextRitual ? String(nextRitual) : undefined,
      });
      await logEvent('profile.reflect_session', String(summary ?? ''));
      await ctx.refresh();
      return `Reflection saved. I will use this to guide you better next time.`;
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
    set_ui_language: async ({ locale, label }) => {
      const cleanLocale = String(locale || 'en-US');
      const cleanLabel = String(label || cleanLocale);
      await setPrefs({
        voiceLocale: cleanLocale,
        translateTarget: null,
        activeSession: null,
      } as Partial<Preferences>);
      ctx.publish({ sessionLabel: null, activeChoiceMenu: null, speechStatus: `language set: ${cleanLabel}` });
      ctx.updateRealtimeSession();
      await logEvent('settings.language', `${cleanLabel} ${cleanLocale}`);
      return `Okay. I will answer in ${cleanLabel} unless you speak another language or ask for translation.`;
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
