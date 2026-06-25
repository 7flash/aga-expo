import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import type { AgaMode } from '../aga/turn';
import { AgaAvatarZen } from '../ui/AgaAvatarZen';
import { ANGEL_FRAGMENT_SHADER, ANGEL_VERTEX_SHADER } from './angelShader';

type Props = {
  mode: AgaMode;
  audioLevel?: number;
  compact?: boolean;
  size?: number;
};

declare function require(name: string): any;

function loadGLView() {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require('expo-gl')?.GLView ?? null;
  } catch {
    return null;
  }
}

function modeNumber(mode: AgaMode) {
  switch (mode) {
    case 'listening': return 1;
    case 'thinking': return 2;
    case 'speaking': return 4;
    case 'translating': return 5;
    case 'media': return 6;
    case 'recovering': return 7;
    default: return 0;
  }
}

function accent(mode: AgaMode): [number, number, number] {
  switch (mode) {
    case 'speaking': return [1.0, 0.88, 0.48];
    case 'thinking': return [0.65, 0.55, 1.0];
    case 'translating': return [0.96, 0.58, 0.80];
    case 'media': return [0.55, 0.45, 1.0];
    case 'recovering': return [1.0, 0.45, 0.55];
    default: return [0.40, 0.91, 0.98];
  }
}

function createShader(gl: any, type: number, source: string) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(shader));
  return shader;
}

function createProgram(gl: any) {
  const program = gl.createProgram();
  gl.attachShader(program, createShader(gl, gl.VERTEX_SHADER, ANGEL_VERTEX_SHADER));
  gl.attachShader(program, createShader(gl, gl.FRAGMENT_SHADER, ANGEL_FRAGMENT_SHADER));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program));
  return program;
}

export function AngelVisual({ mode, audioLevel = 0, compact, size: requestedSize }: Props) {
  const GLView = useMemo(loadGLView, []);
  const [glFailed, setGlFailed] = useState(false);
  const stateRef = useRef({ mode, audioLevel });
  const aliveRef = useRef(true);
  stateRef.current = { mode, audioLevel };

  useEffect(() => {
    aliveRef.current = true;
    return () => { aliveRef.current = false; };
  }, []);

  const size = requestedSize ?? (compact ? 148 : 282);

  if (!GLView || glFailed) {
    return <AgaAvatarZen mode={mode} audioLevel={audioLevel} compact={compact} size={size} />;
  }

  return (
    <View pointerEvents="none" style={[styles.wrap, { width: size + 128, height: size + 128 }]}>
      <GLView
        style={StyleSheet.absoluteFill}
        onContextCreate={(gl: any) => {
          let frame = 0;
          try {
          const program = createProgram(gl);
          const position = gl.getAttribLocation(program, 'position');
          const uTime = gl.getUniformLocation(program, 'uTime');
          const uResolution = gl.getUniformLocation(program, 'uResolution');
          const uAudio = gl.getUniformLocation(program, 'uAudio');
          const uMode = gl.getUniformLocation(program, 'uMode');
          const uAccent = gl.getUniformLocation(program, 'uAccent');
          const buffer = gl.createBuffer();
          gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
          gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
          gl.enable(gl.BLEND);
          gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

          const started = Date.now();
          const draw = () => {
            if (!aliveRef.current) return;
            const width = gl.drawingBufferWidth || size;
            const height = gl.drawingBufferHeight || size;
            const current = stateRef.current;
            const [r, g, b] = accent(current.mode);
            gl.viewport(0, 0, width, height);
            gl.clearColor(0, 0, 0, Platform.OS === 'web' ? 0 : 0);
            gl.clear(gl.COLOR_BUFFER_BIT);
            gl.useProgram(program);
            gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
            gl.enableVertexAttribArray(position);
            gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
            gl.uniform1f(uTime, (Date.now() - started) / 1000);
            gl.uniform2f(uResolution, width, height);
            gl.uniform1f(uAudio, Math.max(0, Math.min(1, current.audioLevel || 0)));
            gl.uniform1f(uMode, modeNumber(current.mode));
            gl.uniform3f(uAccent, r, g, b);
            gl.drawArrays(gl.TRIANGLES, 0, 6);
            gl.endFrameEXP?.();
            if (aliveRef.current) frame = requestAnimationFrame(draw);
          };
          draw();
          return () => cancelAnimationFrame(frame);
          } catch (error) {
            setGlFailed(true);
          }
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center', backgroundColor: 'transparent' },
});
