import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import * as Speech from 'expo-speech';
import Voice, { SpeechErrorEvent, SpeechResultsEvent } from '@react-native-voice/voice';

type AgaStatus = 'starting' | 'listening' | 'awake' | 'thinking' | 'speaking' | 'error';

type ChatMessage = {
  id: string;
  role: 'aga' | 'you';
  text: string;
};

const WAKE_PATTERN = /\b(?:hey\s+aga|okay\s+aga|ok\s+aga|aga|angel)\b/i;
const ACTIVE_WINDOW_MS = 35_000;

function nowId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function stripWake(text: string) {
  return text.replace(/^.*?\b(?:hey\s+aga|okay\s+aga|ok\s+aga|aga|angel)\b[:,\s-]*/i, '').trim();
}

function getLocalReply(command: string) {
  const lower = command.toLowerCase().trim();

  if (!lower || /^(hi|hello|hey|yes|help)$/.test(lower)) {
    return 'I am here inside the APK now. Say, AGA help, AGA test voice, AGA status, or AGA stop.';
  }

  if (/\b(help|what can i say|commands)\b/.test(lower)) {
    return 'You can say: AGA help, AGA status, AGA test voice, AGA stop, AGA speak slower, or AGA remember that this is working. This screen does not need localhost or a TradJS server.';
  }

  if (/\b(status|setup status|health|diagnostics)\b/.test(lower)) {
    return 'AGA is running fully from the Expo APK screen. No localhost backend is required for this interface.';
  }

  if (/\b(test voice|voice test|say something)\b/.test(lower)) {
    return 'Voice output is working. If you can hear me, AGA can speak from inside the APK.';
  }

  if (/\b(stop|cancel|quiet|silence)\b/.test(lower)) {
    return 'Stopped. I am listening again.';
  }

  if (/\b(slower|slow down)\b/.test(lower)) {
    return 'Okay, I will speak more slowly for this session.';
  }

  if (/\bremember that\b/.test(lower)) {
    const memory = command.replace(/.*?remember that\s*/i, '').trim();
    return memory ? `I heard the memory: ${memory}. Local SQLite memory will be reconnected after this no-backend boot fix.` : 'Tell me what to remember after the words remember that.';
  }

  if (/\b(youtube|music|translate|agent|reminder|backup)\b/.test(lower)) {
    return 'That feature belongs to the native AGA modules. This hotfix proves the APK boots without the backend first, then we reconnect those modules one by one.';
  }

  return `I heard: ${command}. I am responding locally from the APK, not from localhost.`;
}

function AngelAvatar({ status, mouth }: { status: AgaStatus; mouth: Animated.Value }) {
  const breathe = useRef(new Animated.Value(0)).current;
  const halo = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const breathingLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(breathe, {
          toValue: 1,
          duration: 2400,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(breathe, {
          toValue: 0,
          duration: 2400,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ])
    );
    const haloLoop = Animated.loop(
      Animated.timing(halo, {
        toValue: 1,
        duration: 4200,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );
    breathingLoop.start();
    haloLoop.start();
    return () => {
      breathingLoop.stop();
      haloLoop.stop();
    };
  }, [breathe, halo]);

  const scale = breathe.interpolate({ inputRange: [0, 1], outputRange: [1, 1.035] });
  const haloRotate = halo.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
  const mouthScale = mouth.interpolate({ inputRange: [0, 1], outputRange: [0.35, 1.35] });
  const isLive = status === 'listening' || status === 'awake';

  return (
    <View style={styles.avatarStage}>
      <Animated.View style={[styles.halo, { transform: [{ rotate: haloRotate }] }]} />
      <View style={[styles.wing, styles.leftWing]} />
      <View style={[styles.wing, styles.rightWing]} />
      <Animated.View style={[styles.face, { transform: [{ scale }] }]}>
        <View style={[styles.cheek, styles.leftCheek]} />
        <View style={[styles.cheek, styles.rightCheek]} />
        <View style={[styles.eye, styles.leftEye, isLive && styles.eyeLive]} />
        <View style={[styles.eye, styles.rightEye, isLive && styles.eyeLive]} />
        <Animated.View style={[styles.mouth, { transform: [{ scaleY: mouthScale }] }]} />
      </Animated.View>
      <View style={[styles.statusOrb, isLive && styles.statusOrbLive]} />
    </View>
  );
}

export default function AgaScreen() {
  const [status, setStatus] = useState<AgaStatus>('starting');
  const [heard, setHeard] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'aga',
      text: 'I booted from the APK. No localhost backend is required for this screen.',
    },
  ]);
  const activeUntilRef = useRef(0);
  const finalGuardRef = useRef('');
  const startingRef = useRef(false);
  const mouth = useRef(new Animated.Value(0)).current;

  const addMessage = useCallback((role: ChatMessage['role'], text: string) => {
    setMessages((current) => [{ id: nowId(role), role, text }, ...current].slice(0, 8));
  }, []);

  const pulseMouth = useCallback((duration = 1200) => {
    mouth.stopAnimation();
    mouth.setValue(0.15);
    Animated.loop(
      Animated.sequence([
        Animated.timing(mouth, { toValue: 1, duration: 140, easing: Easing.out(Easing.quad), useNativeDriver: true }),
        Animated.timing(mouth, { toValue: 0.2, duration: 180, easing: Easing.in(Easing.quad), useNativeDriver: true }),
      ]),
      { iterations: Math.max(2, Math.round(duration / 320)) }
    ).start(() => mouth.setValue(0));
  }, [mouth]);

  const speak = useCallback(
    async (text: string) => {
      setStatus('speaking');
      pulseMouth(Math.min(4200, Math.max(900, text.length * 45)));
      try {
        await Speech.stop();
        Speech.speak(text, {
          language: 'en-US',
          pitch: 1.08,
          rate: /slowly|slower/.test(text.toLowerCase()) ? 0.82 : 0.96,
          onDone: () => setStatus('listening'),
          onStopped: () => setStatus('listening'),
          onError: () => setStatus('listening'),
        });
      } catch {
        setStatus('listening');
      }
    },
    [pulseMouth]
  );

  const handleText = useCallback(
    (rawText: string) => {
      const text = rawText.trim();
      if (!text) return;

      const guardKey = text.toLowerCase();
      if (guardKey === finalGuardRef.current) return;
      finalGuardRef.current = guardKey;
      setTimeout(() => {
        if (finalGuardRef.current === guardKey) finalGuardRef.current = '';
      }, 2500);

      setHeard(text);
      const now = Date.now();
      const hasWake = WAKE_PATTERN.test(text);
      const active = now < activeUntilRef.current;

      if (!hasWake && !active) {
        setStatus('listening');
        return;
      }

      activeUntilRef.current = now + ACTIVE_WINDOW_MS;
      const command = hasWake ? stripWake(text) : text;
      setStatus('awake');
      addMessage('you', command || text);

      const reply = getLocalReply(command || 'help');
      addMessage('aga', reply);
      void speak(reply);
    },
    [addMessage, speak]
  );

  const startListening = useCallback(async () => {
    if (startingRef.current) return;
    startingRef.current = true;
    setError(null);

    try {
      await Voice.stop().catch(() => undefined);
      await Voice.cancel().catch(() => undefined);
      await Voice.start('en-US');
      setStatus('listening');
    } catch (err) {
      setStatus('error');
      setError(err instanceof Error ? err.message : 'Speech recognition did not start. Check microphone and speech recognition permissions.');
    } finally {
      startingRef.current = false;
    }
  }, []);

  useEffect(() => {
    Voice.onSpeechStart = () => {
      setStatus((current) => (current === 'speaking' ? 'awake' : 'listening'));
      setError(null);
    };
    Voice.onSpeechPartialResults = (event: SpeechResultsEvent) => {
      const value = event.value?.[0]?.trim();
      if (value) setHeard(value);
    };
    Voice.onSpeechResults = (event: SpeechResultsEvent) => {
      const value = event.value?.[0]?.trim();
      if (value) handleText(value);
    };
    Voice.onSpeechError = (event: SpeechErrorEvent) => {
      const message = event.error?.message || event.error?.code || 'Speech recognition error.';
      setError(message);
      setStatus('error');
      setTimeout(() => void startListening(), 900);
    };
    Voice.onSpeechEnd = () => {
      setTimeout(() => void startListening(), 350);
    };

    const timer = setTimeout(() => void startListening(), 550);
    return () => {
      clearTimeout(timer);
      Voice.destroy().then(Voice.removeAllListeners).catch(() => undefined);
    };
  }, [handleText, startListening]);

  const statusCopy = useMemo(() => {
    if (status === 'starting') return 'Starting local APK voice loop';
    if (status === 'listening') return 'Listening for “Hey AGA”';
    if (status === 'awake') return 'AGA is awake';
    if (status === 'thinking') return 'Thinking locally';
    if (status === 'speaking') return 'Speaking — say AGA stop';
    return 'Voice needs attention';
  }, [status]);

  return (
    <SafeAreaView style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.page}>
        <View style={styles.headerRow}>
          <View style={styles.brandPill}>
            <View style={styles.brandMark}><Text style={styles.brandMarkText}>A</Text></View>
            <View>
              <Text style={styles.brandTitle}>AGA</Text>
              <Text style={styles.brandSub}>Angel companion · APK local mode</Text>
            </View>
          </View>
          <View style={styles.statusPill}>
            <View style={[styles.dot, status === 'listening' || status === 'awake' ? styles.dotLive : null]} />
            <Text style={styles.statusPillText}>{statusCopy}</Text>
          </View>
        </View>

        <View style={styles.hero}>
          <AngelAvatar status={status} mouth={mouth} />
          <View style={styles.controlCard}>
            <Text style={styles.kicker}>NO BACKEND REQUIRED</Text>
            <Text style={styles.title}>{status === 'listening' ? 'AGA is listening' : status === 'speaking' ? 'AGA is speaking' : 'AGA is awake'}</Text>
            <Text style={styles.subtitle}>This screen is rendered by React Native inside the APK. It does not load http://localhost:3000.</Text>

            <View style={styles.hearsCard}>
              <Text style={styles.hearsLabel}>AGA HEARS</Text>
              <Text style={styles.hearsText}>{heard || 'Say “Hey AGA, help” or tap Start listening.'}</Text>
            </View>

            {error ? <Text style={styles.errorText}>{error}</Text> : null}

            <View style={styles.buttonRow}>
              <Pressable style={styles.primaryButton} onPress={startListening}>
                <Text style={styles.primaryButtonText}>Start listening</Text>
              </Pressable>
              <Pressable style={styles.secondaryButton} onPress={() => handleText('Hey AGA help')}>
                <Text style={styles.secondaryButtonText}>Test reply</Text>
              </Pressable>
              <Pressable
                style={styles.secondaryButton}
                onPress={() => {
                  Speech.stop();
                  setStatus('listening');
                }}
              >
                <Text style={styles.secondaryButtonText}>Stop speech</Text>
              </Pressable>
            </View>
          </View>
        </View>

        <View style={styles.messagesCard}>
          <Text style={styles.kicker}>RECENT LOCAL CONVERSATION</Text>
          {messages.map((message) => (
            <View key={message.id} style={[styles.message, message.role === 'you' ? styles.userMessage : styles.agaMessage]}>
              <Text style={styles.messageRole}>{message.role === 'you' ? 'You' : 'AGA'}</Text>
              <Text style={styles.messageText}>{message.text}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#070b1d' },
  page: { minHeight: '100%' as any, padding: 18, gap: 18 },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  brandPill: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)' },
  brandMark: { width: 42, height: 42, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: '#bff6ff' },
  brandMarkText: { color: '#14172b', fontWeight: '900', fontSize: 18 },
  brandTitle: { color: '#fff', fontWeight: '900', fontSize: 18 },
  brandSub: { color: 'rgba(238,244,255,0.72)', fontSize: 12, marginTop: 2 },
  statusPill: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingVertical: 11, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.08)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)' },
  dot: { width: 9, height: 9, borderRadius: 9, backgroundColor: '#f9a8d4' },
  dotLive: { backgroundColor: '#67e8f9' },
  statusPillText: { color: '#fff', fontWeight: '800', fontSize: 12 },
  hero: { flex: 1, minHeight: 620, justifyContent: 'center', alignItems: 'center', gap: 18 },
  avatarStage: { width: 310, height: 270, alignItems: 'center', justifyContent: 'center' },
  halo: { position: 'absolute', top: 4, width: 128, height: 34, borderRadius: 64, borderWidth: 7, borderColor: '#fef3c7', opacity: 0.84 },
  wing: { position: 'absolute', width: 112, height: 150, borderRadius: 80, backgroundColor: 'rgba(255,255,255,0.18)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.28)' },
  leftWing: { left: 20, transform: [{ rotate: '-22deg' }] },
  rightWing: { right: 20, transform: [{ rotate: '22deg' }] },
  face: { width: 190, height: 190, borderRadius: 96, backgroundColor: '#bff6ff', borderWidth: 1, borderColor: 'rgba(255,255,255,0.55)', shadowColor: '#67e8f9', shadowOpacity: 0.5, shadowRadius: 24, shadowOffset: { width: 0, height: 14 } },
  cheek: { position: 'absolute', bottom: 60, width: 30, height: 18, borderRadius: 18, backgroundColor: 'rgba(249,168,212,0.42)' },
  leftCheek: { left: 36 },
  rightCheek: { right: 36 },
  eye: { position: 'absolute', top: 78, width: 18, height: 24, borderRadius: 18, backgroundColor: '#15172a' },
  eyeLive: { height: 30, backgroundColor: '#0f172a' },
  leftEye: { left: 58 },
  rightEye: { right: 58 },
  mouth: { position: 'absolute', left: 84, bottom: 48, width: 22, height: 12, borderRadius: 10, backgroundColor: '#8b5cf6' },
  statusOrb: { position: 'absolute', bottom: 18, width: 18, height: 18, borderRadius: 18, backgroundColor: '#f9a8d4' },
  statusOrbLive: { backgroundColor: '#67e8f9', shadowColor: '#67e8f9', shadowOpacity: 0.9, shadowRadius: 16 },
  controlCard: { width: '100%', maxWidth: 720, padding: 22, borderRadius: 30, backgroundColor: 'rgba(255,255,255,0.1)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.16)' },
  kicker: { color: '#67e8f9', fontSize: 11, fontWeight: '900', letterSpacing: 2, marginBottom: 8 },
  title: { color: '#fff', fontSize: 34, fontWeight: '900', letterSpacing: -1.2 },
  subtitle: { color: 'rgba(238,244,255,0.78)', marginTop: 8, lineHeight: 20 },
  hearsCard: { marginTop: 18, padding: 16, borderRadius: 22, backgroundColor: 'rgba(103,232,249,0.12)', borderWidth: 1, borderColor: 'rgba(103,232,249,0.28)' },
  hearsLabel: { color: '#67e8f9', fontSize: 11, fontWeight: '900', letterSpacing: 1.8, marginBottom: 6 },
  hearsText: { color: '#fff', fontSize: 18, fontWeight: '800', lineHeight: 25 },
  errorText: { marginTop: 12, color: '#fecdd3', fontWeight: '700' },
  buttonRow: { flexDirection: 'row', gap: 10, flexWrap: 'wrap', marginTop: 18 },
  primaryButton: { paddingHorizontal: 18, paddingVertical: 14, borderRadius: 18, backgroundColor: '#67e8f9' },
  primaryButtonText: { color: '#0f172a', fontWeight: '900' },
  secondaryButton: { paddingHorizontal: 18, paddingVertical: 14, borderRadius: 18, backgroundColor: 'rgba(255,255,255,0.1)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)' },
  secondaryButtonText: { color: '#fff', fontWeight: '900' },
  messagesCard: { width: '100%', maxWidth: 920, alignSelf: 'center', padding: 18, borderRadius: 26, backgroundColor: 'rgba(255,255,255,0.07)', borderWidth: 1, borderColor: 'rgba(255,255,255,0.12)' },
  message: { padding: 14, borderRadius: 18, marginTop: 10 },
  agaMessage: { backgroundColor: 'rgba(255,255,255,0.08)' },
  userMessage: { backgroundColor: 'rgba(103,232,249,0.14)' },
  messageRole: { color: '#fef3c7', fontSize: 11, fontWeight: '900', marginBottom: 5, textTransform: 'uppercase' },
  messageText: { color: '#fff', lineHeight: 20 },
});
