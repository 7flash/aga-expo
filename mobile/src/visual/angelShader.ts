export const ANGEL_VERTEX_SHADER = `
attribute vec2 position;
varying vec2 vUv;
void main() {
  vUv = position * 0.5 + 0.5;
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

export const ANGEL_FRAGMENT_SHADER = `
precision highp float;
varying vec2 vUv;
uniform vec2 uResolution;
uniform float uTime;
uniform float uAudio;
uniform float uMode;
uniform vec3 uAccent;

float sdDiamond(vec2 p, float r) {
  p = abs(p);
  return (p.x + p.y - r) * 0.7071;
}

float ring(vec2 p, float r, float w) {
  return 1.0 - smoothstep(w, w + 0.006, abs(length(p) - r));
}

void main() {
  vec2 uv = vUv * 2.0 - 1.0;
  uv.x *= uResolution.x / max(uResolution.y, 1.0);

  float t = uTime;
  float audio = clamp(uAudio, 0.0, 1.0);
  vec3 cyan = vec3(0.40, 0.91, 0.98);
  vec3 gold = vec3(1.0, 0.88, 0.48);
  vec3 violet = vec3(0.65, 0.55, 1.0);
  vec3 accent = mix(uAccent, gold, step(3.5, uMode) * step(uMode, 4.5));

  vec2 p = uv;
  p.y += 0.02 * sin(t * 1.3);

  float body = 1.0 - smoothstep(0.0, 0.018, sdDiamond(p * mat2(0.86, -0.5, 0.5, 0.86), 0.62 + audio * 0.06));
  float core = 1.0 - smoothstep(0.0, 0.014, sdDiamond(p * mat2(0.74, -0.67, 0.67, 0.74), 0.38 + audio * 0.04));
  float aura = exp(-3.0 * dot(p, p)) * (0.25 + audio * 0.45);

  vec2 leftWing = p - vec2(-0.56, 0.02);
  leftWing.x *= 0.78;
  leftWing.y *= 1.36;
  float wingL = ring(leftWing, 0.46 + 0.02 * sin(t * 1.8), 0.025);
  vec2 rightWing = p - vec2(0.56, 0.02);
  rightWing.x *= 0.78;
  rightWing.y *= 1.36;
  float wingR = ring(rightWing, 0.46 + 0.02 * sin(t * 1.8), 0.025);

  vec2 haloP = p - vec2(0.0, 0.72 + 0.018 * sin(t));
  haloP.y *= 2.9;
  float halo = ring(haloP, 0.34, 0.024);

  float orbitAngle = t * (0.7 + audio);
  vec2 orb = vec2(cos(orbitAngle), sin(orbitAngle)) * 0.78;
  float orbit = exp(-80.0 * length(p - orb));

  float sigil = ring(p - vec2(0.0, -0.18), 0.055 + audio * 0.08, 0.014);

  vec3 color = vec3(0.0);
  color += aura * accent;
  color += (wingL + wingR) * accent * 0.55;
  color += halo * gold * 1.1;
  color += body * mix(cyan, accent, 0.35);
  color += core * vec3(0.86, 1.0, 1.0);
  color += orbit * accent * 1.3;
  color += sigil * mix(violet, accent, 0.45);

  float alpha = clamp(aura + body * 0.86 + core + wingL * 0.55 + wingR * 0.55 + halo + orbit + sigil, 0.0, 1.0);
  gl_FragColor = vec4(color, alpha);
}
`;
