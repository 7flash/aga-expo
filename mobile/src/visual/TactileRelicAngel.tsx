import React, { memo, useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, StyleSheet, View } from 'react-native';
import type { AgaMode } from '../aga/turn';
import { AgaAvatarZen } from '../ui/AgaAvatarZen';
import { ANGEL_FRAGMENT_SHADER, ANGEL_VERTEX_SHADER } from './angelShader';

declare function require(name: string): any;

type Props = {
  mode: AgaMode;
  audioLevel?: number;
  compact?: boolean;
  size?: number;
  mirror?: boolean;
  lowPower?: boolean;
  wear?: number;
  interactionPulse?: number;
};

function modeNumber(mode: AgaMode) {
  switch (mode) {
    case 'listening':
    case 'awake': return 1;
    case 'thinking':
    case 'recovering': return 2;
    case 'settings': return 3;
    case 'speaking': return 4;
    case 'translating': return 5;
    case 'media': return 6;
    case 'offline': return 7;
    default: return 0;
  }
}

function getGlView() {
  try {
    // Optional in managed/dev builds. A production relic APK should include expo-gl;
    // older/web builds fall back to the SVG angel without crashing.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('expo-gl')?.GLView ?? null;
  } catch {
    return null;
  }
}

function compile(gl: any, type: number, source: string) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(info || 'shader compile failed');
  }
  return shader;
}

function createProgram(gl: any) {
  const vertex = compile(gl, gl.VERTEX_SHADER, ANGEL_VERTEX_SHADER);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, ANGEL_FRAGMENT_SHADER);
  const program = gl.createProgram();
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || 'shader link failed');
  return program;
}

export const TactileRelicAngel = memo(function TactileRelicAngel({
  mode,
  audioLevel = 0,
  compact,
  size = compact ? 230 : 330,
  mirror,
  lowPower,
  wear = 0.22,
  interactionPulse = 0,
}: Props) {
  const GLView = useMemo(() => getGlView(), []);
  const audioRef = useRef(audioLevel);
  const modeRef = useRef(modeNumber(mode));
  const wearRef = useRef(wear);
  const interactRef = useRef(interactionPulse);
  const alive = useRef(true);
  const scan = useRef(new Animated.Value(0)).current;

  useEffect(() => { audioRef.current = Math.max(0, Math.min(1, Number(audioLevel) || 0)); }, [audioLevel]);
  useEffect(() => { modeRef.current = modeNumber(mode); }, [mode]);
  useEffect(() => { wearRef.current = Math.max(0, Math.min(1, Number(wear) || 0)); }, [wear]);
  useEffect(() => { interactRef.current = Math.max(0, Math.min(1, Number(interactionPulse) || 0)); }, [interactionPulse]);
  useEffect(() => () => { alive.current = false; }, []);
  useEffect(() => {
    const loop = Animated.loop(Animated.timing(scan, { toValue: 1, duration: 4200, easing: Easing.linear, useNativeDriver: true }));
    loop.start();
    return () => loop.stop();
  }, [scan]);

  const stage = size * (lowPower ? 1.18 : 1.55);
  if (!GLView) return <AgaAvatarZen mode={mode} audioLevel={audioLevel} compact={compact} size={size} />;

  const onContextCreate = (gl: any) => {
    let frame = 0;
    try {
      const program = createProgram(gl);
      const buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      gl.useProgram(program);
      const position = gl.getAttribLocation(program, 'position');
      gl.enableVertexAttribArray(position);
      gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

      const uResolution = gl.getUniformLocation(program, 'uResolution');
      const uTime = gl.getUniformLocation(program, 'uTime');
      const uAudio = gl.getUniformLocation(program, 'uAudio');
      const uMode = gl.getUniformLocation(program, 'uMode');
      const uAccent = gl.getUniformLocation(program, 'uAccent');
      const uWear = gl.getUniformLocation(program, 'uWear');
      const uInteraction = gl.getUniformLocation(program, 'uInteraction');
      const started = Date.now();
      let smoothAudio = 0;
      let smoothInteraction = 0;

      gl.clearColor(0, 0, 0, 0);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE);

      const draw = () => {
        if (!alive.current) return;
        smoothAudio += (audioRef.current - smoothAudio) * 0.18;
        smoothInteraction += (interactRef.current - smoothInteraction) * 0.12;
        gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.useProgram(program);
        gl.uniform2f(uResolution, gl.drawingBufferWidth, gl.drawingBufferHeight);
        gl.uniform1f(uTime, (Date.now() - started) / 1000);
        gl.uniform1f(uAudio, smoothAudio);
        gl.uniform1f(uMode, modeRef.current);
        gl.uniform3f(uAccent, 0.30, 0.94, 1.0);
        gl.uniform1f(uWear, wearRef.current);
        gl.uniform1f(uInteraction, smoothInteraction);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.flush();
        gl.endFrameEXP?.();
        frame = requestAnimationFrame(draw);
      };
      draw();
    } catch (error) {
      console.warn?.('[aga:tactile-relic] GL angel failed; SVG fallback will be used next mount.', error);
    }
    return () => cancelAnimationFrame(frame);
  };

  const scanY = scan.interpolate({ inputRange: [0, 1], outputRange: [-stage * 0.15, stage * 1.15] });

  return (
    <View pointerEvents="none" style={[styles.root, { width: stage, height: stage }, mirror && styles.mirror]}>
      <GLView style={StyleSheet.absoluteFill} onContextCreate={onContextCreate} />
      <Animated.View style={[styles.scanPass, { transform: [{ translateY: scanY }] }]} />
      <View style={styles.horizontalScanlines} />
      <View style={styles.chromaCyan} />
      <View style={styles.chromaMagenta} />
    </View>
  );
});

const styles = StyleSheet.create({
  root: { backgroundColor: 'transparent', overflow: 'hidden' },
  horizontalScanlines: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.065,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(72,240,255,0.10)',
  },
  scanPass: {
    position: 'absolute',
    left: '8%',
    right: '8%',
    height: 18,
    backgroundColor: 'rgba(130,245,255,0.08)',
    shadowColor: '#48f0ff',
    shadowOpacity: 0.55,
    shadowRadius: 20,
  },
  chromaCyan: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 999,
    borderLeftWidth: 1,
    borderColor: 'rgba(72,240,255,0.18)',
    transform: [{ translateX: -1 }],
  },
  chromaMagenta: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 999,
    borderRightWidth: 1,
    borderColor: 'rgba(180,92,255,0.16)',
    transform: [{ translateX: 1 }],
  },
  mirror: { transform: [{ scaleX: -1 }] },
});

export default TactileRelicAngel;
