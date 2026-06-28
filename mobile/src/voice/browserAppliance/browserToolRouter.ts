import { runGpt5ToolTurn } from '../../ai/gpt5ToolTurn';
import { runGetTimeCapability, runGetWeatherCapability, type JsonObject } from '../../aga/capabilityRegistry';
import { addMemory, addMessage, initializeLocalStore, listMessages, loadPreferences, searchMemories, startNewConversationSession } from '../../db/localStore';
import { decideVoicePath } from '../voicePathPolicy';
import type { BrowserApplianceListener, BrowserCommandResult } from './types';

function clean(text: string) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function youtubeUrl(query: string) {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(clean(query) || 'relaxing music')}`;
}

function dispatchBrowserEvent(name: string, detail: Record<string, unknown>) {
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(name, { detail }));
}

function stripYoutubeWords(text: string) {
  return clean(text)
    .replace(/\b(can you|please|could you)\b/gi, '')
    .replace(/\b(play|open|start|pull up|show|youtube|video|music|song|on youtube)\b/gi, '')
    .trim();
}

export class BrowserToolRouter {
  constructor(private emit: BrowserApplianceListener = () => {}) {}

  classify(text: string) {
    return decideVoicePath(text);
  }

  async runShortToolTurn(text: string): Promise<BrowserCommandResult> {
    await initializeLocalStore();
    await addMessage('user', text).catch(() => undefined);
    const prefs = await loadPreferences().catch(() => null);
    const memories = await searchMemories(text, 4).catch(() => []);
    const responseText = await runGpt5ToolTurn({
      text,
      prefs,
      memories: memories.map((m) => m.text),
      runTool: (name, args) => this.runTool(name, args),
      maxToolCalls: 5,
    });
    await addMessage('assistant', responseText).catch(() => undefined);
    return { route: 'short-tools', text: responseText, shouldSpeak: true, handled: true };
  }

  async runLocalControl(text: string): Promise<BrowserCommandResult> {
    const t = clean(text).toLowerCase();
    if (/\b(stop|quiet|cancel|shush|hush)\b/.test(t)) {
      dispatchBrowserEvent('aga:stopAll', { source: 'browser-tool-router' });
      return { route: 'local-control', handled: true, shouldSpeak: false, text: '' };
    }
    if (/\b(pause|hold)\b/.test(t)) {
      dispatchBrowserEvent('aga:mediaControl', { command: 'pause', source: 'browser-tool-router' });
      return { route: 'local-control', handled: true, shouldSpeak: false, text: '' };
    }
    if (/\b(resume|continue)\b/.test(t)) {
      dispatchBrowserEvent('aga:mediaControl', { command: 'resume', source: 'browser-tool-router' });
      return { route: 'local-control', handled: true, shouldSpeak: true, text: 'Resuming.' };
    }
    return { route: 'local-control', handled: false, shouldSpeak: false };
  }

  private async runTool(name: string, args: JsonObject): Promise<string> {
    this.emit({ type: 'tool', name, args });
    let result = '';
    switch (name) {
      case 'get_time':
        result = await runGetTimeCapability(args);
        break;
      case 'get_weather': {
        const prefs = await loadPreferences().catch(() => null);
        result = await runGetWeatherCapability(args, prefs);
        break;
      }
      case 'play_youtube': {
        const query = clean(String(args.query || '')) || 'relaxing music';
        const forceYouTube = args.forceYouTube !== false;
        const url = youtubeUrl(stripYoutubeWords(query) || query);
        dispatchBrowserEvent('aga:openYouTube', { query, url, forceYouTube, source: 'browser-tool-router' });
        if (typeof window !== 'undefined') window.open(url, '_blank', 'noopener,noreferrer');
        result = `Opening YouTube for ${query}.`;
        break;
      }
      case 'media_control': {
        const command = clean(String(args.command || 'pause')).toLowerCase();
        dispatchBrowserEvent('aga:mediaControl', { command, source: 'browser-tool-router' });
        result = command === 'stop' ? 'Stopped.' : command === 'resume' ? 'Resuming.' : 'Paused.';
        break;
      }
      case 'remember': {
        const text = clean(String(args.text || ''));
        if (!text) result = 'Nothing to remember.';
        else {
          await addMemory(text, { source: 'browser-tool-router', confidence: 0.75 });
          result = 'I will remember that.';
        }
        break;
      }
      case 'recall': {
        const query = clean(String(args.query || '')) || undefined;
        const found = await searchMemories(query, 6);
        result = found.length ? found.map((m) => m.text).join('; ') : 'I do not have a matching memory yet.';
        break;
      }
      case 'start_new_conversation_session': {
        await startNewConversationSession(clean(String(args.reason || 'browser_request')) || 'browser_request', { clearTranscript: true, endActiveSession: args.endActiveSkill !== false });
        result = 'Fresh session started.';
        break;
      }
      case 'show_settings_menu': {
        const category = clean(String(args.category || 'main')) || 'main';
        dispatchBrowserEvent('aga:showSettingsMenu', { category, source: 'browser-tool-router' });
        result = `Settings menu: ${category}. Say voice, personality, listening, skills, or back.`;
        break;
      }
      case 'set_listening_mode': {
        const mode = clean(String(args.mode || 'strict')) || 'strict';
        dispatchBrowserEvent('aga:setListeningMode', { mode, allow_barge_in: !!args.allow_barge_in, source: 'browser-tool-router' });
        result = `Listening mode set to ${mode.replace('_', ' ')}.`;
        break;
      }
      case 'start_guided_session':
      case 'start_session':
      case 'start_skill': {
        dispatchBrowserEvent('aga:startSkill', { name, args, source: 'browser-tool-router' });
        result = 'Starting that session.';
        break;
      }
      default:
        result = `Tool ${name} is not wired in the browser lab yet.`;
    }
    this.emit({ type: 'tool', name, args, result });
    return result;
  }
}
