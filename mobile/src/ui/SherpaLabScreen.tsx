import React, { useEffect, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';

type Probe = { url: string; ok: boolean; status?: number; text?: string; json?: any; error?: string };

const ASSETS = [
  '/sherpa/kws-model/encoder.onnx',
  '/sherpa/kws-model/decoder.onnx',
  '/sherpa/kws-model/joiner.onnx',
  '/sherpa/kws-model/tokens.txt',
  '/sherpa/kws-model/bpe.model',
  '/sherpa/kws-model/keywords_raw.txt',
  '/sherpa/kws-model/keywords.txt',
  '/sherpa/kws-model/wake_alias_manifest.json',
];

async function probe(url: string): Promise<Probe> {
  try {
    const response = await fetch(`${url}?t=${Date.now()}`, { cache: 'no-store' });
    const isJson = url.endsWith('.json');
    const isText = /\.(txt|json|model)$/.test(url) && !url.endsWith('.onnx') && !url.endsWith('.model');
    let text = '';
    let json: any = null;
    if (isJson) {
      text = await response.text();
      try { json = JSON.parse(text); } catch {}
    } else if (isText) {
      text = await response.text();
    }
    return { url, ok: response.ok, status: response.status, text, json };
  } catch (error) {
    return { url, ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

function isTokenizedKeywordText(text: string) {
  const clean = String(text || '').trim();
  if (!clean) return false;
  if (/text2token did not create output/i.test(clean)) return false;
  if (/^[A-Z\s]+\s+@/m.test(clean) && !/[▁]/.test(clean)) return false;
  return /@/.test(clean) && /▁|<unk>|[A-Za-z]\s+[A-Za-z]/.test(clean);
}

export default function SherpaLabScreen() {
  const [results, setResults] = useState<Probe[]>([]);
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    try {
      const next = [] as Probe[];
      for (const url of ASSETS) next.push(await probe(url));
      setResults(next);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => { run(); }, []);

  const manifest = results.find((r) => r.url.endsWith('wake_alias_manifest.json'))?.json;
  const keywords = results.find((r) => r.url.endsWith('keywords.txt'))?.text || '';
  const raw = results.find((r) => r.url.endsWith('keywords_raw.txt'))?.text || '';
  const tokenized = Boolean(manifest?.tokenized) && !manifest?.browserWakeFallback && isTokenizedKeywordText(keywords);
  const missing = results.filter((r) => !r.ok).map((r) => r.url);

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Text style={styles.h1}>AGA Sherpa Lab</Text>
      <Text style={styles.p}>Isolated wake-model asset and keyword-tokenization test. This page should not trigger GPT, TTS, tools, or live agent.</Text>
      <View style={[styles.status, tokenized ? styles.good : styles.bad]}>
        <Text style={styles.statusTitle}>{tokenized ? 'REAL SHERPA KEYWORDS READY' : 'FALLBACK ONLY — NOT REAL SHERPA WAKE'}</Text>
        <Text style={styles.statusText}>{tokenized ? 'keywords.txt is tokenized and fallback is off.' : (manifest?.reason || 'keywords.txt is missing, raw, empty, or text2token failed.')}</Text>
      </View>
      <Pressable style={styles.btn} onPress={run} disabled={busy}>
        <Text style={styles.btnText}>{busy ? 'Checking…' : 'Re-check Sherpa assets'}</Text>
      </Pressable>
      {missing.length ? <View style={styles.card}><Text style={styles.label}>Missing / failing URLs</Text>{missing.map((m) => <Text key={m} style={styles.badText}>{m}</Text>)}</View> : null}
      <View style={styles.card}>
        <Text style={styles.label}>Manifest</Text>
        <Text style={styles.pre}>{JSON.stringify(manifest || null, null, 2)}</Text>
      </View>
      <View style={styles.card}>
        <Text style={styles.label}>keywords_raw.txt</Text>
        <Text style={styles.pre}>{raw || '(missing)'}</Text>
      </View>
      <View style={styles.card}>
        <Text style={styles.label}>keywords.txt</Text>
        <Text style={styles.pre}>{keywords || '(missing)'}</Text>
      </View>
      <View style={styles.card}>
        <Text style={styles.label}>Files</Text>
        {results.map((r) => <Text key={r.url} style={r.ok ? styles.okText : styles.badText}>{r.ok ? 'OK' : 'FAIL'} {r.status || ''} {r.url} {r.error || ''}</Text>)}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#02050a' },
  content: { padding: 26, gap: 18 },
  h1: { color: '#f8fbff', fontSize: 36, fontWeight: '900' },
  p: { color: '#b8c2d6', fontSize: 17, lineHeight: 26 },
  status: { borderWidth: 1, borderRadius: 18, padding: 18 },
  good: { backgroundColor: '#071d17', borderColor: '#1edb8d' },
  bad: { backgroundColor: '#201018', borderColor: '#ff7a99' },
  statusTitle: { color: '#fff', fontSize: 20, fontWeight: '900' },
  statusText: { color: '#dbe7ff', fontSize: 15, marginTop: 8 },
  btn: { alignSelf: 'flex-start', backgroundColor: '#e9eefc', paddingHorizontal: 22, paddingVertical: 14, borderRadius: 24 },
  btnText: { color: '#08101c', fontSize: 16, fontWeight: '900' },
  card: { backgroundColor: '#07101c', borderWidth: 1, borderColor: '#1c3248', borderRadius: 18, padding: 20, gap: 12 },
  label: { color: '#8ff8ff', fontSize: 13, fontWeight: '900', letterSpacing: 5, textTransform: 'uppercase' },
  pre: { color: '#dbe7ff', fontFamily: 'monospace', fontSize: 13, lineHeight: 18 },
  okText: { color: '#9fffc8', fontSize: 14, fontFamily: 'monospace' },
  badText: { color: '#ffb4c6', fontSize: 14, fontFamily: 'monospace' },
});
