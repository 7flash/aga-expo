export const ANGEL_VERTEX_SHADER = `
attribute vec2 position;
varying vec2 vUv;
void main() {
  vUv = position * 0.5 + 0.5;
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

/**
 * Tactile Neural Relic shader.
 *
 * Emissive-on-black for behind-glass projection, but not clean/glassmorphic.
 * The angel is mounted inside a worn mechanical neural housing: deep gunmetal,
 * oxidized copper, rivets, engraved seams, cable conduits, glowing dendritic
 * pathways, subtle patina, and holographic scan/chroma artifacts on top.
 */
export const ANGEL_FRAGMENT_SHADER = `
precision highp float;
varying vec2 vUv;
uniform vec2 uResolution;
uniform float uTime;
uniform float uAudio;
uniform float uMode;
uniform vec3 uAccent;
uniform float uWear;
uniform float uInteraction;

float sat(float x) { return clamp(x, 0.0, 1.0); }
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}

float sdBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}
float sdDiamond(vec2 p, float r) {
  p = abs(p);
  return (p.x + p.y - r) * 0.7071067;
}
float ring(vec2 p, float r, float w) {
  return 1.0 - smoothstep(w, w + 0.006, abs(length(p) - r));
}
float lineSeg(vec2 p, vec2 a, vec2 b, float w) {
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / max(0.0001, dot(ba, ba)), 0.0, 1.0);
  return 1.0 - smoothstep(w, w + 0.006, length(pa - ba * h));
}
float rivet(vec2 p, vec2 c, float r) {
  float d = length(p - c);
  float head = 1.0 - smoothstep(r, r + 0.012, d);
  float inset = smoothstep(r * 0.42, r * 0.72, d);
  float shine = 1.0 - smoothstep(r * 0.36, r * 0.46, length(p - c + vec2(0.011, 0.014)));
  return head * (0.28 + 0.36 * inset) + shine * 0.72;
}
float cable(vec2 p, vec2 a, vec2 b, float w) {
  float outer = lineSeg(p, a, b, w);
  float core = lineSeg(p, a, b, w * 0.34);
  return outer * 0.35 + core;
}

vec3 modeColor(float mode, vec3 base) {
  vec3 cyan = vec3(0.28, 0.95, 1.0);
  vec3 teal = vec3(0.12, 0.82, 0.74);
  vec3 amber = vec3(1.0, 0.66, 0.22);
  vec3 violet = vec3(0.70, 0.34, 1.0);
  vec3 rose = vec3(1.0, 0.22, 0.32);
  vec3 green = vec3(0.34, 1.0, 0.65);
  if (mode > 5.5 && mode < 6.5) return mix(green, teal, 0.40);
  if (mode > 4.5 && mode < 5.5) return violet;
  if (mode > 3.5 && mode < 4.5) return amber;
  if (mode > 1.5 && mode < 3.5) return mix(violet, cyan, 0.48);
  if (mode > 6.5) return rose;
  return mix(base, cyan, 0.58);
}

void main() {
  vec2 uv = vUv * 2.0 - 1.0;
  uv.x *= uResolution.x / max(uResolution.y, 1.0);
  float t = uTime;
  float audio = sat(uAudio);
  float wear = sat(uWear);
  float interact = sat(uInteraction);
  vec3 accent = modeColor(uMode, uAccent);
  vec3 cyan = vec3(0.30, 0.96, 1.0);
  vec3 teal = vec3(0.10, 0.78, 0.70);
  vec3 amber = vec3(1.0, 0.66, 0.22);
  vec3 magenta = vec3(0.78, 0.30, 1.0);
  vec3 gunmetal = vec3(0.040, 0.058, 0.060);
  vec3 raisedGun = vec3(0.070, 0.100, 0.104);
  vec3 copper = vec3(0.42, 0.23, 0.12);
  vec3 patina = vec3(0.05, 0.21, 0.19);

  vec2 p = uv;
  float breath = 0.5 + 0.5 * sin(t * 0.78);
  float mechBuzz = 0.0028 * sin(t * 74.0) * (audio + interact * 0.7);
  p.x += mechBuzz;

  // Deep physical backing: large raised relic panel with recessed center bay.
  float deckOuter = 1.0 - smoothstep(0.0, 0.018, sdBox(p, vec2(0.92, 0.78), 0.18));
  float deckInner = 1.0 - smoothstep(0.0, 0.018, sdBox(p, vec2(0.66, 0.53), 0.12));
  float deck = sat(deckOuter - deckInner * 0.78);
  float innerBay = deckInner * (1.0 - smoothstep(0.0, 0.025, sdBox(p, vec2(0.54, 0.43), 0.095)));
  float bevelHi = smoothstep(-0.74, 0.78, p.y) * deck * 0.22;
  float bevelLo = smoothstep(0.75, -0.75, p.y) * deck * 0.35;
  float grain = (noise(p * 76.0 + t * 0.015) - 0.5) * (0.14 + wear * 0.10);
  float corrosion = noise(p * 17.0 + vec2(2.0, -1.7)) * wear;

  // Mechanical seams, brackets, and mounting plate.
  float seams = 0.0;
  seams += lineSeg(p, vec2(-0.82, 0.54), vec2(0.82, 0.54), 0.004);
  seams += lineSeg(p, vec2(-0.82, -0.54), vec2(0.82, -0.54), 0.004);
  seams += lineSeg(p, vec2(-0.55, -0.68), vec2(-0.55, 0.68), 0.004);
  seams += lineSeg(p, vec2(0.55, -0.68), vec2(0.55, 0.68), 0.004);
  seams += lineSeg(p, vec2(-0.28, 0.68), vec2(-0.18, 0.54), 0.004);
  seams += lineSeg(p, vec2(0.28, 0.68), vec2(0.18, 0.54), 0.004);
  float ringMount = ring(p, 0.61 + audio * 0.006 + interact * 0.006, 0.018);
  float clampL = 1.0 - smoothstep(0.0, 0.014, sdBox(p - vec2(-0.72, 0.0), vec2(0.08, 0.26), 0.025));
  float clampR = 1.0 - smoothstep(0.0, 0.014, sdBox(p - vec2(0.72, 0.0), vec2(0.08, 0.26), 0.025));

  float rivets = 0.0;
  for (int i = 0; i < 12; i++) {
    float a = float(i) * 0.5235987;
    rivets += rivet(p, vec2(cos(a), sin(a)) * vec2(0.79, 0.67), 0.022);
  }
  rivets += rivet(p, vec2(-0.80, 0.57), 0.026);
  rivets += rivet(p, vec2(0.80, 0.57), 0.026);
  rivets += rivet(p, vec2(-0.80, -0.57), 0.026);
  rivets += rivet(p, vec2(0.80, -0.57), 0.026);

  // Dendritic neural cables and learned-path burn-in.
  float cables = 0.0;
  cables += cable(p, vec2(-0.93, -0.42), vec2(-0.34, -0.14), 0.018);
  cables += cable(p, vec2(0.93, -0.42), vec2(0.34, -0.14), 0.018);
  cables += cable(p, vec2(-0.78, 0.43), vec2(-0.28, 0.12), 0.012);
  cables += cable(p, vec2(0.78, 0.43), vec2(0.28, 0.12), 0.012);
  cables += cable(p, vec2(-0.15, -0.76), vec2(-0.07, -0.30), 0.010);
  cables += cable(p, vec2(0.15, -0.76), vec2(0.07, -0.30), 0.010);
  float branches = 0.0;
  branches += lineSeg(p, vec2(-0.46, -0.19), vec2(-0.50, 0.05), 0.006);
  branches += lineSeg(p, vec2(0.46, -0.19), vec2(0.50, 0.05), 0.006);
  branches += lineSeg(p, vec2(-0.36, 0.15), vec2(-0.18, 0.32), 0.005);
  branches += lineSeg(p, vec2(0.36, 0.15), vec2(0.18, 0.32), 0.005);
  float fire = 0.50 + 0.50 * sin(t * (2.4 + audio * 7.0) - length(p) * 12.0 + interact * 5.0);
  float neuralGlow = (cables + branches * 0.85) * (0.22 + fire * (0.45 + audio * 0.62 + interact * 0.60) + wear * 0.34);

  // Embedded angel as the luminous core inside the cradle.
  vec2 q = p;
  q.y += 0.014 * sin(t * 1.05) + breath * 0.014;
  float body = 1.0 - smoothstep(0.0, 0.014, sdDiamond(q * mat2(0.86, -0.50, 0.50, 0.86), 0.42 + audio * 0.042 + interact * 0.025));
  float core = 1.0 - smoothstep(0.0, 0.010, sdDiamond(q * mat2(0.74, -0.67, 0.67, 0.74), 0.24 + audio * 0.030));
  vec2 l = q - vec2(-0.43, 0.03);
  l.x *= 0.74; l.y *= 1.46;
  vec2 r = q - vec2(0.43, 0.03);
  r.x *= 0.74; r.y *= 1.46;
  float wingL = ring(l, 0.34 + 0.018 * sin(t * 1.35 + audio), 0.017 + audio * 0.006);
  float wingR = ring(r, 0.34 + 0.018 * sin(t * 1.35 + audio), 0.017 + audio * 0.006);
  vec2 haloP = q - vec2(0.0, 0.53 + 0.010 * sin(t));
  haloP.y *= 3.0;
  float halo = ring(haloP, 0.24 + audio * 0.014, 0.015);
  float aura = exp(-4.3 * dot(q, q)) * (0.13 + audio * 0.34 + breath * 0.12 + interact * 0.18);

  // Holographic projection layer: faint scanlines + chromatic edge on top only.
  float scan = 0.026 * sin((vUv.y + t * 0.085) * 980.0);
  float edge = smoothstep(1.22, 0.0, length(p)) * 0.025 * sin(t * 0.55 + p.x * 6.0);
  float chroma = 0.004 * sin(t * 0.75 + p.y * 5.0);

  vec3 color = vec3(0.0);
  color += deck * (gunmetal + bevelHi + grain);
  color += deck * corrosion * patina * 0.32;
  color -= deck * bevelLo * 0.34;
  color += innerBay * raisedGun * 0.45;
  color -= seams * vec3(0.018, 0.018, 0.016);
  color += ringMount * copper * (0.46 + wear * 0.26);
  color += (clampL + clampR) * (raisedGun + vec3(0.030, 0.025, 0.020));
  color += rivets * vec3(0.50, 0.57, 0.55);
  color += cables * vec3(0.010, 0.018, 0.017);
  color += neuralGlow * mix(cyan, magenta, 0.16) * 1.42;
  color += aura * accent;
  color += (wingL + wingR) * accent * 0.74;
  color += halo * amber * 1.18;
  color += body * mix(teal, accent, 0.38);
  color += core * vec3(0.86 + chroma, 1.0, 1.0 - chroma) * 1.45;
  color += edge * vec3(0.50, 0.94, 1.0);
  color += scan;

  float alpha = sat(deck * 0.90 + innerBay * 0.24 + ringMount * 0.65 + rivets * 0.58 + (clampL + clampR) * 0.58 + cables * 0.52 + neuralGlow * 0.92 + aura + body + core + wingL * 0.62 + wingR * 0.62 + halo);
  gl_FragColor = vec4(max(color, 0.0), alpha);
}
`;
