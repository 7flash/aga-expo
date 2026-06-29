import React, { useMemo, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, ScrollView } from 'react-native';

type Log = { at: string; title: string; body?: unknown };

function env(name: string, fallback = '') {
  return (process as any)?.env?.[name] || fallback;
}

function stamp() {
  return new Date().toLocaleTimeString();
}

function pretty(value: unknown) {
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value, null, 2); } catch { return String(value); }
}

function fileExtForMime(mime: string) {
  if (/webm/i.test(mime)) return 'webm';
  if (/ogg/i.test(mime)) return 'ogg';
  if (/mp4/i.test(mime)) return 'mp4';
  if (/mpeg|mp3/i.test(mime)) return 'mp3';
  if (/wav/i.test(mime)) return 'wav';
  return 'webm';
}

function chooseMime() {
  const MR: any = typeof MediaRecorder !== 'undefined' ? MediaRecorder : null;
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
  ];
  if (!MR?.isTypeSupported) return '';
  return candidates.find((m) => MR.isTypeSupported(m)) || '';
}

export default function SttLabScreen() {
  const [logs, setLogs] = useState<Log[]>([]);
  const [recording, setRecording] = useState(false);
  const [blobUrl, setBlobUrl] = useState<string>('');
  const [blobInfo, setBlobInfo] = useState<any>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const startRef = useRef(0);
  const mime = useMemo(() => chooseMime(), []);

  const add = (title: string, body?: unknown) => setLogs((prev) => [{ at: stamp(), title, body }, ...prev].slice(0, 80));

  async function start() {
    try {
      setBlobUrl('');
      setBlobInfo(null);
      chunksRef.current = [];
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
      streamRef.current = stream;
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      recorderRef.current = recorder;
      startRef.current = Date.now();
      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const type = recorder.mimeType || mime || 'audio/webm';
        const blob = new Blob(chunksRef.current, { type });
        const durationMs = Date.now() - startRef.current;
        const url = URL.createObjectURL(blob);
        setBlobUrl(url);
        setBlobInfo({ type, size: blob.size, durationMs, chunks: chunksRef.current.length });
        add('recording ready', { type, size: blob.size, durationMs, chunks: chunksRef.current.length });
        stream.getTracks().forEach((t) => t.stop());
      };
      recorder.start(250);
      setRecording(true);
      add('recording started', { mime: recorder.mimeType || mime || '(browser default)' });
    } catch (error) {
      add('recording failed', error instanceof Error ? error.message : String(error));
    }
  }

  async function stop() {
    try {
      recorderRef.current?.stop();
    } finally {
      setRecording(false);
    }
  }

  async function transcribe() {
    const key = env('EXPO_PUBLIC_OPENAI_API_KEY');
    const model = env('EXPO_PUBLIC_OPENAI_STT_MODEL', 'gpt-4o-mini-transcribe');
    if (!key) {
      add('missing EXPO_PUBLIC_OPENAI_API_KEY', 'STT lab cannot call OpenAI without a key or gateway.');
      return;
    }
    const chunks = chunksRef.current;
    if (!chunks.length || !blobInfo) {
      add('no audio blob', 'Record first, then preview the audio, then transcribe.');
      return;
    }
    const blob = new Blob(chunks, { type: blobInfo.type || 'audio/webm' });
    if (blob.size < 1024) {
      add('audio blob too small', { size: blob.size, hint: 'Record at least 1–2 seconds.' });
      return;
    }

    const ext = fileExtForMime(blob.type);
    const file = new File([blob], `aga-stt-lab.${ext}`, { type: blob.type || 'audio/webm' });
    const form = new FormData();
    form.append('file', file);
    form.append('model', model);
    form.append('response_format', 'json');

    add('sending to OpenAI STT', { model, fileName: file.name, mime: file.type, size: file.size, durationMs: blobInfo.durationMs });
    const started = Date.now();
    try {
      const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}` },
        body: form,
      });
      const raw = await response.text();
      let parsed: any = raw;
      try { parsed = JSON.parse(raw); } catch {}
      if (!response.ok) {
        add(`OpenAI STT ${response.status} ${response.statusText}`, { elapsedMs: Date.now() - started, response: parsed });
        return;
      }
      add('transcription result', { elapsedMs: Date.now() - started, result: parsed });
    } catch (error) {
      add('transcription request failed', error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Text style={styles.h1}>AGA STT Lab</Text>
      <Text style={styles.p}>Isolated browser transcription test. No wake, no GPT, no TTS, no live agent.</Text>
      <View style={styles.card}>
        <Text style={styles.label}>Recorder</Text>
        <Text style={styles.small}>Selected MIME: {mime || 'browser default'}</Text>
        <View style={styles.row}>
          <Pressable style={[styles.btn, recording && styles.btnDanger]} onPress={recording ? stop : start}>
            <Text style={styles.btnText}>{recording ? 'Stop recording' : 'Start recording'}</Text>
          </Pressable>
          <Pressable style={styles.btn} onPress={transcribe}>
            <Text style={styles.btnText}>Send to OpenAI STT</Text>
          </Pressable>
        </View>
        {blobInfo ? <Text style={styles.small}>Blob: {blobInfo.size} bytes · {blobInfo.type} · {Math.round(blobInfo.durationMs / 1000)}s</Text> : null}
        {blobUrl ? <audio controls src={blobUrl} style={{ width: '100%', marginTop: 14 }} /> : null}
      </View>
      <View style={styles.card}>
        <Text style={styles.label}>Logs</Text>
        {logs.map((log, i) => (
          <View key={`${log.at}-${i}`} style={styles.log}>
            <Text style={styles.logTitle}>{log.at}  {log.title}</Text>
            {log.body != null ? <Text style={styles.pre}>{pretty(log.body)}</Text> : null}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#02050a' },
  content: { padding: 26, gap: 18 },
  h1: { color: '#f8fbff', fontSize: 36, fontWeight: '900' },
  p: { color: '#b8c2d6', fontSize: 17, lineHeight: 26 },
  card: { backgroundColor: '#07101c', borderWidth: 1, borderColor: '#1c3248', borderRadius: 18, padding: 20, gap: 12 },
  label: { color: '#8ff8ff', fontSize: 13, fontWeight: '900', letterSpacing: 5, textTransform: 'uppercase' },
  small: { color: '#c8d2e6', fontSize: 14, lineHeight: 21 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  btn: { backgroundColor: '#e9eefc', paddingHorizontal: 22, paddingVertical: 14, borderRadius: 24 },
  btnDanger: { backgroundColor: '#ffcfda' },
  btnText: { color: '#08101c', fontSize: 16, fontWeight: '900' },
  log: { borderTopWidth: 1, borderTopColor: '#213247', paddingTop: 12, paddingBottom: 8 },
  logTitle: { color: '#eef4ff', fontSize: 15, fontWeight: '800' },
  pre: { color: '#dbe7ff', fontFamily: 'monospace', fontSize: 13, marginTop: 8, lineHeight: 18 },
});
