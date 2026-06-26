import React, { memo, useEffect, useMemo, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import type { AgaMode } from '../aga/turn';
import { AgaAvatarZen } from '../ui/AgaAvatarZen';
import { ANGEL_FRAGMENT_SHADER, ANGEL_VERTEX_SHADER } from './angelShader';
import { HologramEnvironment } from './HologramEnvironment';

declare function require(name: string): any;

type Props = {
  mode: AgaMode;
  audioLevel?: number;
  compact?: boolean;
  size?: number;
  mirror?: boolean;
  lowPower?: boolean;
};

function modeNumber(mode: AgaMode) {
  switch (mode) {
    case 'listening':
    case 'awake': return 1;
    case 'thinking':
    case 'recovering': return 2;
    case 'speaking': return 4;
    case 'translating': return 5;
    case 'media': return 6;
    case 'offline': return 7;
    default: return 0;
  }
}

function getGlView() {
  try {
    // Optional dependency. If expo-gl is not in this build, the SVG avatar stays active.
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

export const HologramAngel = memo(function HologramAngel({ mode, audioLevel = 0, compact, size = compact ? 220 : 300, mirror, lowPower }: Props) {
  const GLView = useMemo(() => getGlView(), []);
  const audioRef = useRef(audioLevel);
  const modeRef = useRef(modeNumber(mode));
  const alive = useRef(true);

  useEffect(() => { audioRef.current = Math.max(0, Math.min(1, Number(audioLevel) || 0)); }, [audioLevel]);
  useEffect(() => { modeRef.current = modeNumber(mode); }, [mode]);
  useEffect(() => () => { alive.current = false; }, []);

  const stage = size * (lowPower ? 1.28 : 1.52);
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
      const started = Date.now();
      let smoothAudio = 0;

      gl.clearColor(0, 0, 0, 0);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE);

      const draw = () => {
        if (!alive.current) return;
        smoothAudio += (audioRef.current - smoothAudio) * 0.22;
        gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.useProgram(program);
        gl.uniform2f(uResolution, gl.drawingBufferWidth, gl.drawingBufferHeight);
        gl.uniform1f(uTime, (Date.now() - started) / 1000);
        gl.uniform1f(uAudio, smoothAudio);
        gl.uniform1f(uMode, modeRef.current);
        gl.uniform3f(uAccent, 0.42, 0.93, 1.0);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        gl.flush();
        gl.endFrameEXP?.();
        frame = requestAnimationFrame(draw);
      };
      draw();
    } catch (error) {
      console.warn?.('[aga:hologram] GL avatar failed; falling back next mount.', error);
    }
    return () => cancelAnimationFrame(frame);
  };

  return (
    <View pointerEvents="none" style={[styles.root, { width: stage, height: stage }, mirror && styles.mirror]}>
      <HologramEnvironment mode={mode} audioLevel={audioLevel} compact={compact} lowPower={lowPower} />
      <GLView style={StyleSheet.absoluteFill} onContextCreate={onContextCreate} />
      <View style={styles.glassEdge} />
    </View>
  );
});

const styles = StyleSheet.create({
  root: {
    backgroundColor: 'transparent',
    overflow: 'hidden',
  },
  glassEdge: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(236,254,255,0.14)',
    shadowColor: '#67e8f9',
    shadowOpacity: 0.22,
    shadowRadius: 22,
  },
  mirror: {
    transform: [{ scaleX: -1 }],
  },
});
