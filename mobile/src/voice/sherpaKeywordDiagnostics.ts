export type SherpaKeywordHealth = {
  ok: boolean;
  realKeywordSpotting: boolean;
  fallbackOnly: boolean;
  manifestUrl: string;
  keywordUrl: string;
  reason: string;
  groups: Array<{ id: string; phrases: string[] }>;
  suggestedPhrases: string[];
  nextSteps: string[];
  rawManifest?: unknown;
};

const DEFAULT_MANIFEST = '/sherpa/kws-model/wake_alias_manifest.json';
const DEFAULT_KEYWORDS = '/sherpa/kws-model/keywords.txt';

async function readJson(url: string) {
  const response = await fetch(`${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.json();
}

async function readText(url: string) {
  const response = await fetch(`${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}`, { cache: 'no-store' });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.text();
}

function collectPhrases(manifest: any, keywordsText: string) {
  const groups = Array.isArray(manifest?.groups) ? manifest.groups.map((g: any) => ({
    id: String(g?.id || 'keyword'),
    phrases: Array.isArray(g?.phrases) ? g.phrases.map((p: any) => String(p)) : [],
  })) : [];

  if (groups.length) return groups;

  const phrases = keywordsText
    .split(/\r?\n/g)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith('#'));

  return phrases.length ? [{ id: 'keywords.txt', phrases }] : [];
}

export async function diagnoseSherpaKeywordHealth(options: {
  manifestUrl?: string;
  keywordUrl?: string;
} = {}): Promise<SherpaKeywordHealth> {
  const manifestUrl = options.manifestUrl || DEFAULT_MANIFEST;
  const keywordUrl = options.keywordUrl || DEFAULT_KEYWORDS;

  let manifest: any = null;
  let keywordsText = '';

  try {
    manifest = await readJson(manifestUrl);
  } catch (error) {
    return {
      ok: false,
      realKeywordSpotting: false,
      fallbackOnly: true,
      manifestUrl,
      keywordUrl,
      reason: `Could not load wake alias manifest: ${error instanceof Error ? error.message : String(error)}`,
      groups: [],
      suggestedPhrases: ['hey aga', 'guardian', 'hello aga'],
      nextSteps: [
        'Run the Sherpa setup script and mirror assets into public/sherpa/kws-model.',
        'Confirm wake_alias_manifest.json exists in the browser Network tab.',
        'Do not treat fallback wake events as real keyword spotting.',
      ],
    };
  }

  try {
    keywordsText = await readText(keywordUrl);
  } catch (_) {
    keywordsText = '';
  }

  const groups = collectPhrases(manifest, keywordsText);
  const tokenized = manifest?.tokenized === true;
  const fallback = manifest?.browserWakeFallback === true || tokenized === false;
  const reason = String(manifest?.reason || (tokenized ? 'tokenized keyword manifest is present' : 'keyword manifest is not tokenized'));

  return {
    ok: tokenized && !fallback,
    realKeywordSpotting: tokenized && !fallback,
    fallbackOnly: !tokenized || fallback,
    manifestUrl,
    keywordUrl,
    reason,
    groups,
    suggestedPhrases: [
      'hey aga',
      'hello aga',
      'guardian',
      'okay aga',
      'a ga',
      'ah ga',
    ],
    nextSteps: tokenized && !fallback ? [
      'Run a live smoke test and check confidence from the model, not fallback RMS.',
      'Verify false wake rate in a quiet room and while AGA is speaking.',
    ] : [
      'Run scripts/aga-sherpa-keyword-audit.js to inspect tokens/manifest.',
      'Try tokenizable wake phrases like "hey aga", "hello aga", or "guardian".',
      'Regenerate keywords.txt and wake_alias_manifest.json with a text2token tool compatible with this exact model.',
      'If text2token still creates no output, use a KWS model trained/exported for your wake phrases.',
      'Keep production UI label as "volume fallback" until real keyword spotting is verified.',
    ],
    rawManifest: manifest,
  };
}
