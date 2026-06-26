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

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float dust(vec2 uv, float t) {
  vec2 gv = fract(uv * 13.0 + vec2(t * 0.025, -t * 0.018)) - 0.5;
  vec2 id = floor(uv * 13.0);
  float h = hash(id);
  float d = length(gv + vec2(sin(t * 0.4 + h * 6.28), cos(t * 0.3 + h * 4.2)) * 0.16);
  return smoothstep(0.055, 0.0, d) * smoothstep(0.15, 1.0, h);
}

vec3 modeColor(float mode, vec3 base) {
  vec3 cyan = vec3(0.35, 0.94, 1.0);
  vec3 gold = vec3(1.0, 0.82, 0.38);
  vec3 violet = vec3(0.62, 0.48, 1.0);
  vec3 rose = vec3(1.0, 0.45, 0.68);
  vec3 green = vec3(0.50, 1.0, 0.76);
  if (mode > 5.5 && mode < 6.5) return mix(green, cyan, 0.45);
  if (mode > 4.5 && mode < 5.5) return violet;
  if (mode > 3.5 && mode < 4.5) return gold;
  if (mode > 1.5 && mode < 3.5) return mix(violet, cyan, 0.42);
  if (mode > 6.5) return rose;
  return mix(base, cyan, 0.55);
}

void main() {
  vec2 uv = vUv * 2.0 - 1.0;
  uv.x *= uResolution.x / max(uResolution.y, 1.0);

  float t = uTime;
  float audio = clamp(uAudio, 0.0, 1.0);
  vec3 accent = modeColor(uMode, uAccent);
  vec3 cyan = vec3(0.40, 0.91, 0.98);
  vec3 gold = vec3(1.0, 0.88, 0.48);
  vec3 violet = vec3(0.65, 0.55, 1.0);

  vec2 p = uv;
  p.y += 0.018 * sin(t * 1.15) + 0.008 * sin(t * 0.27);

  float breath = 0.5 + 0.5 * sin(t * 0.9);
  float modePulse = 0.18 + audio * 0.55 + breath * 0.12;

  float body = 1.0 - smoothstep(0.0, 0.018, sdDiamond(p * mat2(0.86, -0.5, 0.5, 0.86), 0.60 + audio * 0.055));
  float core = 1.0 - smoothstep(0.0, 0.013, sdDiamond(p * mat2(0.74, -0.67, 0.67, 0.74), 0.36 + audio * 0.04));
  float aura = exp(-3.0 * dot(p, p)) * modePulse;

  vec2 leftWing = p - vec2(-0.56, 0.02);
  leftWing.x *= 0.78;
  leftWing.y *= 1.36;
  float wingL = ring(leftWing, 0.45 + 0.024 * sin(t * 1.55 + audio), 0.023 + audio * 0.008);
  vec2 rightWing = p - vec2(0.56, 0.02);
  rightWing.x *= 0.78;
  rightWing.y *= 1.36;
  float wingR = ring(rightWing, 0.45 + 0.024 * sin(t * 1.55 + audio), 0.023 + audio * 0.008);

  vec2 haloP = p - vec2(0.0, 0.72 + 0.018 * sin(t));
  haloP.y *= 2.9;
  float halo = ring(haloP, 0.335 + audio * 0.015, 0.021);

  float orbitAngle = t * (0.45 + audio * 0.8);
  vec2 orb1 = vec2(cos(orbitAngle), sin(orbitAngle)) * 0.78;
  vec2 orb2 = vec2(cos(-orbitAngle * 0.72 + 1.7), sin(-orbitAngle * 0.72 + 1.7)) * 0.58;
  float orbit = exp(-80.0 * length(p - orb1)) + exp(-105.0 * length(p - orb2));

  float sigil = ring(p - vec2(0.0, -0.18), 0.055 + audio * 0.08, 0.014);
  float scan = 0.06 * sin((vUv.y + t * 0.18) * 900.0);
  float chroma = 0.006 * sin(t * 0.8 + p.y * 4.0);
  float dustGlow = dust(vUv, t) * (0.25 + audio * 0.75);
  float glass = smoothstep(1.15, 0.0, length(p)) * 0.04 * sin(t * 0.55 + p.x * 6.0);

  vec3 color = vec3(0.0);
  color += aura * accent;
  color += (wingL + wingR) * accent * 0.62;
  color += halo * gold * 1.12;
  color += body * mix(cyan, accent, 0.38);
  color += core * vec3(0.86 + chroma, 1.0, 1.0 - chroma);
  color += orbit * accent * 1.35;
  color += sigil * mix(violet, accent, 0.45);
  color += dustGlow * mix(accent, vec3(1.0), 0.36);
  color += glass * vec3(0.7, 1.0, 1.0);
  color += scan;

  float alpha = clamp(aura + body * 0.86 + core + wingL * 0.55 + wingR * 0.55 + halo + orbit + sigil + dustGlow * 0.55, 0.0, 1.0);
  gl_FragColor = vec4(max(color, 0.0), alpha);
}
`;
