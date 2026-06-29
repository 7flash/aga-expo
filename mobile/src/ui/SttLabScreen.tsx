import React, { useMemo, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import { createShortUtteranceRecorder, type ShortUtteranceAudio, type ShortUtteranceRecorder } from '../voice/shortUtteranceRecorder';
import { transcribeWithOpenAIDiagnostics, OpenAiSttError } from '../ai/openaiStt';
import { JsonBlock, LabButton, LabCard, LabLog, LabScreen, styles } from './LabShell';

function audioSummary(audio: ShortUtteranceAudio | null) {
  if (!audio) return null;
  return {
    kind: audio.kind,
    mimeType: audio.mimeType,
    durationMs: audio.durationMs,
    sizeBytes: audio.kind === 'web_blob' ? audio.blob.size : audio.kind === 'base64' ? Math.floor(audio.base64.length * 0.75) : undefined,
    uri: audio.kind === 'native_uri' ? audio.uri : undefined,
  };
}

export default function SttLabScreen() {
  const recorderRef = useRef<ShortUtteranceRecorder | null>(null);
  const [recording, setRecording] = useState(false);
  const [audio, setAudio] = useState<ShortUtteranceAudio | null>(null);
  const [logs, setLogs] = useState<LabLog[]>([]);

  const add = (title: string, details?: unknown, tone: LabLog['tone'] = 'info') => {
    setLogs((prev) => [{ at: Date.now(), title, details, tone }, ...prev].slice(0, 80));
  };

  const audioUrl = useMemo(() => {
    if (audio?.kind !== 'web_blob') return '';
    try { return URL.createObjectURL(audio.blob); } catch { return ''; }
  }, [audio]);

  async function start() {
    try {
      const recorder = createShortUtteranceRecorder();
      recorderRef.current = recorder;
      setAudio(null);
      await recorder.start();
      setRecording(true);
      add('recording started', recorder.getDiagnostics?.(), 'ok');
    } catch (error) {
      add('recording failed', error instanceof Error ? error.message : String(error), 'error');
    }
  }

  async function stop() {
    const recorder = recorderRef.current;
    recorderRef.current = null;
    if (!recorder) return;
    try {
      const captured = await recorder.stop();
      setRecording(false);
      setAudio(captured);
      add(captured ? 'recording captured' : 'no audio captured', audioSummary(captured), captured ? 'ok' : 'warn');
    } catch (error) {
      setRecording(false);
      add('stop recording failed', error instanceof Error ? error.message : String(error), 'error');
    }
  }

  async function cancel() {
    try { await recorderRef.current?.cancel?.(); } catch { /* ignore */ }
    recorderRef.current = null;
    setRecording(false);
    add('recording cancelled');
  }

  async function transcribe() {
    if (!audio) {
      add('no captured audio yet', 'Record first, then transcribe.', 'warn');
      return;
    }
    try {
      add('sending audio to OpenAI STT', audioSummary(audio));
      const result = await transcribeWithOpenAIDiagnostics(audio);
      add(`transcript: ${result.text || '(empty)'}`, { diagnostics: result.diagnostics, raw: result.raw }, result.text ? 'ok' : 'warn');
    } catch (error) {
      if (error instanceof OpenAiSttError) {
        add(`OpenAI STT failed: ${error.message}`, error.diagnostics, 'error');
      } else {
        add('OpenAI STT failed', error instanceof Error ? error.message : String(error), 'error');
      }
    }
  }

  return (
    <LabScreen
      title="AGA STT Lab"
      subtitle="Test only microphone recording → audio blob/native file → OpenAI /v1/audio/transcriptions. This page does not wake, route tools, start live agent, or speak."
      logs={logs}
    >
      <LabCard title="How this works">
        <Text style={styles.dim}>
          Browser records with MediaRecorder, sends multipart FormData with a file field and model field, then reads the JSON transcript. Android records a native file URI and sends that file shape through React Native FormData.
        </Text>
        <Text style={styles.dim}>
          A 400 means OpenAI rejected the request body: empty audio, invalid multipart file, unsupported/corrupt encoded audio, bad model/response_format combo, or account/key/model access issue.
        </Text>
      </LabCard>

      <LabCard title="Record and transcribe">
        <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
          <LabButton onPress={start} disabled={recording}>Start recording</LabButton>
          <LabButton onPress={stop} disabled={!recording}>Stop recording</LabButton>
          <LabButton onPress={cancel} disabled={!recording}>Cancel</LabButton>
          <LabButton onPress={transcribe} disabled={!audio || recording}>Send to OpenAI STT</LabButton>
        </View>
        <Text style={recording ? styles.warn : styles.dim}>{recording ? 'Recording… speak for 2–5 seconds.' : 'Not recording.'}</Text>
        {audio ? <JsonBlock value={audioSummary(audio)} /> : null}
        {audioUrl ? (
          <View>
            <Text style={styles.dim}>Playback preview:</Text>
            {/* @ts-ignore web-only element inside Expo web lab */}
            <audio controls src={audioUrl} style={{ width: '100%', marginTop: 8 }} />
          </View>
        ) : null}
      </LabCard>
    </LabScreen>
  );
}
