import React, { useEffect, useMemo, useRef } from 'react';
import { Animated, Platform, StyleSheet, Text, View } from 'react-native';
import type { AmbientKind } from '../media/ambient';
import { measureMark } from '../observability/measure';
import { colors, radius, spacing } from './theme';
import type { MediaCommand } from './YouTubePlayer';

let WebView: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  WebView = require('react-native-webview').WebView;
} catch {
  WebView = null;
}

type Props = {
  kind: AmbientKind;
  title: string;
  command?: MediaCommand;
  ducked?: boolean;
  normalVolume?: number;
  duckedVolume?: number;
  onEvent?: (event: string) => void;
};

function eventJson(type: string, payload: Record<string, unknown> = {}) {
  return JSON.stringify({ type, ...payload });
}

function htmlEscape(value: string) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function jsString(value: string) {
  return JSON.stringify(String(value));
}

function ambientHtml(kind: AmbientKind, title: string) {
  return `<!doctype html>
<html><head><meta name="viewport" content="width=device-width,initial-scale=1" />
<style>
html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#050817;color:white;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif}
.stage{height:100%;display:flex;align-items:center;justify-content:center;background:radial-gradient(circle at 50% 35%,rgba(103,232,249,.22),transparent 32%),linear-gradient(135deg,#050817,#10162f 62%,#090b21)}
.core{width:120px;height:120px;border-radius:999px;background:radial-gradient(circle,rgba(255,255,255,.9),rgba(103,232,249,.28) 35%,rgba(167,139,250,.12) 68%,transparent 72%);filter:blur(.2px);animation:pulse 4.8s ease-in-out infinite;box-shadow:0 0 58px rgba(103,232,249,.34)}
.ring{position:absolute;width:220px;height:220px;border-radius:999px;border:1px solid rgba(103,232,249,.26);animation:spin 18s linear infinite}.ring.two{width:310px;height:310px;border-color:rgba(251,113,133,.16);animation-duration:31s;animation-direction:reverse}.label{position:absolute;left:18px;right:18px;bottom:18px;text-align:center;color:rgba(226,232,240,.74);font-weight:800;font-size:12px;letter-spacing:.08em;text-transform:uppercase}
@keyframes pulse{0%,100%{transform:scale(.94);opacity:.72}50%{transform:scale(1.08);opacity:1}}@keyframes spin{to{transform:rotate(360deg)}}
</style></head>
<body><div class="stage"><div class="ring"></div><div class="ring two"></div><div class="core"></div><div class="label">${htmlEscape(title)}</div></div>
<script>
var ctx=null, master=null, nodes=[], started=false, paused=false, pendingVolume=42, kind=${jsString(kind)};
function tell(type,payload){try{var msg=JSON.stringify(Object.assign({type:type},payload||{})); if(window.ReactNativeWebView)window.ReactNativeWebView.postMessage(msg); if(window.parent&&window.parent!==window)window.parent.postMessage(msg,'*');}catch(e){}}
function noiseBuffer(color){
  var len=(ctx.sampleRate||44100)*2, buffer=ctx.createBuffer(1,len,ctx.sampleRate||44100), data=buffer.getChannelData(0);
  var last=0, b0=0,b1=0,b2=0,b3=0,b4=0,b5=0,b6=0;
  for(var i=0;i<len;i++){
    var white=Math.random()*2-1;
    if(color==='brown'){ last=(last+0.02*white)/1.02; data[i]=last*3.5; }
    else if(color==='pink'){ b0=0.99886*b0+white*0.0555179; b1=0.99332*b1+white*0.0750759; b2=0.96900*b2+white*0.1538520; b3=0.86650*b3+white*0.3104856; b4=0.55000*b4+white*0.5329522; b5=-0.7616*b5-white*0.0168980; data[i]=(b0+b1+b2+b3+b4+b5+b6+white*0.5362)*0.11; b6=white*0.115926; }
    else data[i]=white*0.55;
  }
  return buffer;
}
function addNoise(color, gainValue, filterType, freq){
  var src=ctx.createBufferSource(); src.buffer=noiseBuffer(color); src.loop=true;
  var filter=ctx.createBiquadFilter(); filter.type=filterType||'lowpass'; filter.frequency.value=freq||900; filter.Q.value=.7;
  var gain=ctx.createGain(); gain.gain.value=gainValue;
  src.connect(filter); filter.connect(gain); gain.connect(master); src.start(); nodes.push(src,filter,gain);
}
function addTone(freq, gainValue, type, pan){
  var osc=ctx.createOscillator(); osc.frequency.value=freq; osc.type=type||'sine';
  var gain=ctx.createGain(); gain.gain.value=gainValue;
  var panner=ctx.createStereoPanner?ctx.createStereoPanner():null; if(panner)panner.pan.value=pan||0;
  osc.connect(gain); if(panner){gain.connect(panner);panner.connect(master);} else gain.connect(master);
  osc.start(); nodes.push(osc,gain); if(panner)nodes.push(panner);
}
function setVol(v){ pendingVolume=Math.max(0,Math.min(100,Number(v)||42)); if(master) master.gain.setTargetAtTime(pendingVolume/100, ctx.currentTime, .08); }
function start(){
  try{
    if(started){ if(ctx&&ctx.state==='suspended')ctx.resume(); paused=false; tell('player.playing'); return; }
    var C=window.AudioContext||window.webkitAudioContext; if(!C){tell('player.error',{message:'WebAudio unavailable'});return;}
    ctx=new C(); master=ctx.createGain(); master.connect(ctx.destination); setVol(pendingVolume);
    if(kind==='rain'){ addNoise('pink',.36,'highpass',520); addNoise('white',.08,'bandpass',2500); }
    else if(kind==='ocean'){ addNoise('brown',.34,'lowpass',520); addNoise('pink',.11,'bandpass',900); }
    else if(kind==='forest'){ addNoise('pink',.18,'lowpass',1200); addTone(932,.012,'sine',-.35); addTone(1244,.009,'sine',.42); }
    else if(kind==='brown_noise'){ addNoise('brown',.46,'lowpass',420); }
    else if(kind==='pink_noise'){ addNoise('pink',.42,'lowpass',1400); }
    else if(kind==='breathing'){ addNoise('pink',.22,'lowpass',700); addTone(174,.035,'sine',0); addTone(432,.018,'sine',.2); }
    else { addNoise('pink',.18,'lowpass',1000); addTone(174,.032,'sine',-.18); addTone(285,.022,'sine',.24); addTone(528,.012,'sine',0); }
    started=true; paused=false; if(ctx.state==='suspended')ctx.resume(); tell('player.playing');
  }catch(e){tell('player.error',{message:String(e)});}
}
function pause(){ try{ if(ctx)ctx.suspend(); paused=true; tell('player.paused'); }catch(e){} }
function resume(){ try{ if(ctx)ctx.resume(); paused=false; tell('player.playing'); }catch(e){} }
function stop(){ try{ nodes.forEach(function(n){try{n.stop&&n.stop();}catch(e){} try{n.disconnect&&n.disconnect();}catch(e){}}); nodes=[]; if(ctx)ctx.close(); ctx=null; master=null; started=false; tell('player.stopped'); }catch(e){tell('player.stopped');} }
function handle(raw){try{var msg=typeof raw==='string'?JSON.parse(raw):raw; if(msg.type==='volume')setVol(msg.value); if(msg.type==='pause')pause(); if(msg.type==='resume')resume(); if(msg.type==='stop')stop();}catch(e){}}
document.addEventListener('message',function(e){handle(e.data)}); window.addEventListener('message',function(e){handle(e.data)});
setTimeout(start,80);
</script></body></html>`;
}

function useWebAmbient(kind: AmbientKind, volume: number, command?: MediaCommand, onEvent?: (event: string) => void) {
  const ctxRef = useRef<AudioContext | null>(null);
  const nodesRef = useRef<any[]>([]);
  const gainRef = useRef<GainNode | null>(null);
  const onEventRef = useRef(onEvent);
  const commandRef = useRef<MediaCommand>(null);

  useEffect(() => { onEventRef.current = onEvent; }, [onEvent]);

  useEffect(() => {
    if (Platform.OS !== 'web') return undefined;
    const root: any = globalThis as any;
    const Ctor = root.AudioContext || root.webkitAudioContext;
    if (!Ctor) {
      onEventRef.current?.(eventJson('player.error', { message: 'WebAudio unavailable' }));
      return undefined;
    }
    const ctx: AudioContext = new Ctor();
    const master = ctx.createGain();
    master.gain.value = Math.max(0, Math.min(100, Math.round(volume))) / 100;
    master.connect(ctx.destination);
    ctxRef.current = ctx;
    gainRef.current = master;

    const addTone = (freq: number, gainValue: number, type: OscillatorType = 'sine', pan = 0) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const panner = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      osc.frequency.value = freq;
      osc.type = type;
      gain.gain.value = gainValue;
      if (panner) panner.pan.value = pan;
      osc.connect(gain);
      if (panner) { gain.connect(panner); panner.connect(master); nodesRef.current.push(panner); }
      else gain.connect(master);
      osc.start();
      nodesRef.current.push(osc, gain);
    };

    const addNoise = (filterFreq: number, gainValue: number, filterType: BiquadFilterType = 'lowpass') => {
      const len = ctx.sampleRate * 2;
      const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      let last = 0;
      for (let i = 0; i < len; i += 1) {
        const white = Math.random() * 2 - 1;
        last = (last + 0.02 * white) / 1.02;
        data[i] = kind === 'brown_noise' || kind === 'ocean' ? last * 3.3 : white * 0.28;
      }
      const src = ctx.createBufferSource();
      const filter = ctx.createBiquadFilter();
      const gain = ctx.createGain();
      src.buffer = buffer; src.loop = true;
      filter.type = filterType; filter.frequency.value = filterFreq;
      gain.gain.value = gainValue;
      src.connect(filter); filter.connect(gain); gain.connect(master); src.start();
      nodesRef.current.push(src, filter, gain);
    };

    if (kind === 'rain') { addNoise(2500, 0.32, 'bandpass'); addNoise(700, 0.14, 'highpass'); }
    else if (kind === 'ocean') { addNoise(520, 0.36); addTone(110, 0.014, 'sine'); }
    else if (kind === 'forest') { addNoise(1200, 0.18); addTone(932, 0.012, 'sine', -0.35); addTone(1244, 0.009, 'sine', 0.42); }
    else if (kind === 'brown_noise') addNoise(420, 0.48);
    else if (kind === 'pink_noise') addNoise(1400, 0.36);
    else if (kind === 'breathing') { addNoise(700, 0.2); addTone(174, 0.035); addTone(432, 0.014); }
    else { addNoise(1000, 0.16); addTone(174, 0.032, 'sine', -0.18); addTone(285, 0.022, 'sine', 0.24); addTone(528, 0.012); }

    void ctx.resume().catch(() => undefined);
    onEventRef.current?.(eventJson('player.playing', { provider: 'local_ambient' }));
    measureMark('ambient.web.start', { kind });

    return () => {
      for (const node of nodesRef.current) {
        try { node.stop?.(); } catch { /* ignore */ }
        try { node.disconnect?.(); } catch { /* ignore */ }
      }
      nodesRef.current = [];
      void ctx.close().catch(() => undefined);
      ctxRef.current = null;
      gainRef.current = null;
      onEventRef.current?.(eventJson('player.stopped', { provider: 'local_ambient' }));
    };
  }, [kind]);

  useEffect(() => {
    const safeVolume = Math.max(0, Math.min(100, Math.round(volume))) / 100;
    const ctx = ctxRef.current;
    const gain = gainRef.current;
    if (ctx && gain) gain.gain.setTargetAtTime(safeVolume, ctx.currentTime, 0.08);
    measureMark('ambient.volume', { value: Math.round(safeVolume * 100) });
  }, [volume]);

  useEffect(() => {
    if (!command || commandRef.current === command) return;
    commandRef.current = command;
    const ctx = ctxRef.current;
    if (command === 'pause') {
      void ctx?.suspend?.();
      onEventRef.current?.(eventJson('player.paused', { provider: 'local_ambient' }));
    } else if (command === 'resume') {
      void ctx?.resume?.();
      onEventRef.current?.(eventJson('player.playing', { provider: 'local_ambient' }));
    } else if (command === 'stop') {
      onEventRef.current?.(eventJson('player.stopped', { provider: 'local_ambient' }));
    }
  }, [command]);
}

export function AmbientPlayer({
  kind,
  title,
  command,
  ducked = false,
  normalVolume = Number(process.env.EXPO_PUBLIC_AGA_MEDIA_VOLUME ?? 38),
  duckedVolume = Number(process.env.EXPO_PUBLIC_AGA_MEDIA_DUCK_VOLUME ?? 10),
  onEvent,
}: Props) {
  const slide = useRef(new Animated.Value(0)).current;
  const webviewRef = useRef<any>(null);
  const onEventRef = useRef(onEvent);
  const targetVolume = ducked ? duckedVolume : normalVolume;
  const html = useMemo(() => ambientHtml(kind, title), [kind, title]);

  useEffect(() => { onEventRef.current = onEvent; }, [onEvent]);

  useEffect(() => {
    Animated.spring(slide, { toValue: 1, useNativeDriver: Platform.OS !== 'web', damping: 18, stiffness: 130 }).start();
  }, [slide]);

  useWebAmbient(kind, targetVolume, command, Platform.OS === 'web' ? onEvent : undefined);

  useEffect(() => {
    const safeVolume = Math.max(0, Math.min(100, Math.round(targetVolume)));
    webviewRef.current?.postMessage?.(JSON.stringify({ type: 'volume', value: safeVolume }));
  }, [targetVolume]);

  useEffect(() => {
    if (!command) return;
    webviewRef.current?.postMessage?.(JSON.stringify({ type: command }));
  }, [command]);

  return (
    <Animated.View
      style={[
        styles.card,
        {
          opacity: slide,
          transform: [{ translateY: slide.interpolate({ inputRange: [0, 1], outputRange: [42, 0] }) }],
        },
      ]}
    >
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.kicker}>{ducked ? 'LOCAL AMBIENT · AGA SPEAKING' : 'LOCAL AMBIENT'}</Text>
          <Text numberOfLines={1} style={styles.title}>{title}</Text>
        </View>
        <View style={styles.voiceOnlyClose}>
          <Text style={styles.voiceOnlyCloseText}>say “AGA stop music”</Text>
        </View>
      </View>
      <View style={styles.stageWrap}>
        {Platform.OS === 'web' ? (
          <View style={styles.localStage}>
            <View style={styles.ringOuter} />
            <View style={styles.ringInner} />
            <View style={styles.glowCore} />
            <Text style={styles.stageText}>generated on-device</Text>
          </View>
        ) : WebView ? (
          <WebView
            ref={(ref: any) => { webviewRef.current = ref; }}
            style={styles.webview}
            source={{ html }}
            allowsInlineMediaPlayback
            mediaPlaybackRequiresUserAction={false}
            javaScriptEnabled
            domStorageEnabled
            onMessage={(event: any) => onEventRef.current?.(event.nativeEvent.data)}
            onError={(event: any) => onEventRef.current?.(eventJson('player.error', { message: event?.nativeEvent?.description }))}
          />
        ) : (
          <View style={styles.localStage}>
            <Text style={styles.stageText}>Local ambient visual active. Install react-native-webview for generated audio on this build.</Text>
          </View>
        )}
      </View>
      <Text style={styles.hint}>No YouTube needed for background ambience. Say “AGA pause”, “AGA resume”, or “AGA stop music”.</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    bottom: spacing.xl,
    zIndex: 30,
    borderRadius: radius.xl,
    padding: spacing.md,
    backgroundColor: 'rgba(8,11,31,0.96)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
    shadowColor: colors.cyan,
    shadowOpacity: 0.35,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 16 },
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.sm },
  kicker: { color: colors.cyan, fontSize: 10, fontWeight: '900', letterSpacing: 1.8, marginBottom: 2 },
  title: { color: colors.text, fontSize: 16, fontWeight: '900' },
  voiceOnlyClose: { paddingHorizontal: 10, paddingVertical: 8, borderRadius: radius.pill, backgroundColor: 'rgba(255,255,255,0.08)' },
  voiceOnlyCloseText: { color: colors.faint, fontSize: 10, fontWeight: '900' },
  stageWrap: { height: 244, overflow: 'hidden', borderRadius: radius.lg, backgroundColor: '#050817' },
  webview: { flex: 1, backgroundColor: '#050817' },
  localStage: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#050817' },
  ringOuter: { position: 'absolute', width: 280, height: 280, borderRadius: 140, borderWidth: 1, borderColor: 'rgba(103,232,249,0.22)' },
  ringInner: { position: 'absolute', width: 170, height: 170, borderRadius: 85, borderWidth: 1, borderColor: 'rgba(251,113,133,0.16)' },
  glowCore: { width: 112, height: 112, borderRadius: 56, backgroundColor: 'rgba(103,232,249,0.23)', shadowColor: colors.cyan, shadowOpacity: 0.6, shadowRadius: 38 },
  stageText: { position: 'absolute', bottom: 20, color: colors.faint, fontSize: 12, fontWeight: '800', letterSpacing: 1.2, textTransform: 'uppercase', textAlign: 'center', paddingHorizontal: spacing.lg },
  hint: { marginTop: spacing.sm, color: colors.faint, fontSize: 12, textAlign: 'center', fontWeight: '700' },
});
