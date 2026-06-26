function todayStamp() {
  return new Date().toISOString().slice(0, 10);
}

function storageGet(key: string): string | null {
  try {
    const storage = (globalThis as any)?.localStorage;
    if (storage?.getItem) return storage.getItem(key);
  } catch { /* no storage */ }
  return null;
}

function storageSet(key: string, value: string) {
  try {
    const storage = (globalThis as any)?.localStorage;
    if (storage?.setItem) storage.setItem(key, value);
  } catch { /* no storage */ }
}

function env(name: string) {
  return process.env?.[name] ?? '';
}

function numberEnv(name: string, fallback: number) {
  const raw = Number(env(name));
  return Number.isFinite(raw) && raw >= 0 ? raw : fallback;
}

export type GeminiBudget = {
  date: string;
  turns: number;
  inputChars: number;
  outputChars: number;
  liveTurns: number;
  liveAudioSeconds: number;
  startedAt?: number | null;
};

export function readGeminiBudget(): GeminiBudget {
  const fallback: GeminiBudget = {
    date: todayStamp(),
    turns: 0,
    inputChars: 0,
    outputChars: 0,
    liveTurns: 0,
    liveAudioSeconds: 0,
    startedAt: null,
  };
  try {
    const parsed = JSON.parse(storageGet('aga.gemini.dailyBudget.v2') || storageGet('aga.gemini.dailyBudget.v1') || 'null');
    if (!parsed || parsed.date !== fallback.date) return fallback;
    return {
      date: fallback.date,
      turns: Number(parsed.turns) || 0,
      inputChars: Number(parsed.inputChars) || 0,
      outputChars: Number(parsed.outputChars) || 0,
      liveTurns: Number(parsed.liveTurns) || 0,
      liveAudioSeconds: Number(parsed.liveAudioSeconds) || 0,
      startedAt: Number(parsed.startedAt) || null,
    };
  } catch {
    return fallback;
  }
}

export function writeGeminiBudget(next: GeminiBudget) {
  storageSet('aga.gemini.dailyBudget.v2', JSON.stringify(next));
}

export function geminiBudgetLimits() {
  return {
    maxTurns: numberEnv('EXPO_PUBLIC_AGA_GEMINI_DAILY_TURN_LIMIT', 80),
    maxChars: numberEnv('EXPO_PUBLIC_AGA_GEMINI_DAILY_CHAR_LIMIT', 60000),
    maxLiveAudioSeconds: numberEnv('EXPO_PUBLIC_AGA_GEMINI_DAILY_LIVE_AUDIO_SECONDS', 900),
    maxInputChars: numberEnv('EXPO_PUBLIC_AGA_GEMINI_MAX_INPUT_CHARS', 1200),
  };
}

export function geminiBudgetSummary(transport = 'text') {
  const budget = readGeminiBudget();
  const limits = geminiBudgetLimits();
  return `Gemini today: ${budget.turns}/${limits.maxTurns || '∞'} turns, ${budget.inputChars + budget.outputChars}/${limits.maxChars || '∞'} chars, ${Math.round(budget.liveAudioSeconds)}/${limits.maxLiveAudioSeconds || '∞'} live seconds. Current transport is ${transport}.`;
}

export function geminiBudgetSnapshot(transport = 'text') {
  const budget = readGeminiBudget();
  const limits = geminiBudgetLimits();
  return {
    ...budget,
    ...limits,
    transport,
    totalChars: budget.inputChars + budget.outputChars,
    label: `${transport} · ${budget.turns}/${limits.maxTurns || '∞'} turns · ${Math.round(budget.liveAudioSeconds)}s live`,
  };
}

export function canSpendGeminiInput(text: string) {
  const inputChars = String(text || '').length;
  const budget = readGeminiBudget();
  const limits = geminiBudgetLimits();
  if (inputChars > limits.maxInputChars) {
    return { ok: false, reason: `That was a bit long for cheap Gemini mode. Please say it in under ${limits.maxInputChars} characters.`, budget, limits };
  }
  if (limits.maxTurns > 0 && budget.turns >= limits.maxTurns) {
    return { ok: false, reason: `Gemini daily turn limit reached: ${budget.turns}/${limits.maxTurns}. Local controls still work.`, budget, limits };
  }
  if (limits.maxChars > 0 && budget.inputChars + budget.outputChars + inputChars >= limits.maxChars) {
    return { ok: false, reason: 'Gemini daily character budget is nearly used. Local controls still work.', budget, limits };
  }
  return { ok: true, reason: '', budget, limits };
}

export function canSpendLiveAudio() {
  const budget = readGeminiBudget();
  const limits = geminiBudgetLimits();
  if (limits.maxLiveAudioSeconds > 0 && budget.liveAudioSeconds >= limits.maxLiveAudioSeconds) {
    return { ok: false, reason: `Gemini live-audio budget reached: ${Math.round(budget.liveAudioSeconds)}/${limits.maxLiveAudioSeconds}s. Falling back to text mode.`, budget, limits };
  }
  return { ok: true, reason: '', budget, limits };
}

export function recordGeminiTurn(inputChars: number, outputText: string, transport: 'text' | 'live' | 'duplex') {
  if (!inputChars) return readGeminiBudget();
  const budget = readGeminiBudget();
  const next = {
    ...budget,
    turns: budget.turns + 1,
    inputChars: budget.inputChars + inputChars,
    outputChars: budget.outputChars + String(outputText || '').length,
    liveTurns: budget.liveTurns + (transport === 'text' ? 0 : 1),
  };
  writeGeminiBudget(next);
  return next;
}

export function addLiveAudioSeconds(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return readGeminiBudget();
  const budget = readGeminiBudget();
  const next = { ...budget, liveAudioSeconds: budget.liveAudioSeconds + seconds };
  writeGeminiBudget(next);
  return next;
}
