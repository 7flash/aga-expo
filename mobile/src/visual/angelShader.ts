export const ANGEL_VERTEX_SHADER = `
attribute vec2 position;
varying vec2 vUv;
void main() {
  vUv = position * 0.5 + 0.5;
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

/**
 * Tactile neuromorphic angel shader.
 *
 * The shader is intentionally emissive-on-black for behind-glass/Pepper's ghost
 * rigs, but its forms are physical: gunmetal cradle, riveted mounting ring,
 * engraved panels, neural cabling, and a luminous angel core mounted inside it.
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

float saturate(float x) { return clamp(x, 0.0, 1.0); }
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
  return (p.x + p.y - r) * 0.7071;
}
float ring(vec2 p, float r, float w) {
  return 1.0 - smoothstep(w, w + 0.006, abs(length(p) - r));
}
float lineSeg(vec2 p, vec2 a, vec2 b, float w) {
  vec2 pa = p - a, ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return 1.0 - smoothstep(w, w + 0.006, length(pa - ba * h));
}
float rivet(vec2 p, vec2 c, float r) {
  float d = length(p - c);
  float head = 1.0 - smoothstep(r, r + 0.012, d);
  float shine = 1.0 - smoothstep(r * 0.42, r * 0.48, length(p - c + vec2(0.012, 0.014)));
  return head * 0.38 + shine * 0.72;
}

vec3 modeColor(float mode, vec3 base) {
  vec3 cyan = vec3(0.28, 0.95, 1.0);
  vec3 amber = vec3(1.0, 0.68, 0.25);
  vec3 violet = vec3(0.70, 0.36, 1.0);
  vec3 rose = vec3(1.0, 0.23, 0.34);
  vec3 green = vec3(0.36, 1.0, 0.64);
  if (mode > 5.5 && mode < 6.5) return mix(green, cyan, 0.35);
  if (mode > 4.5 && mode < 5.5) return violet;
  if (mode > 3.5 && mode < 4.5) return amber;
  if (mode > 1.5 && mode < 3.5) return mix(violet, cyan, 0.45);
  if (mode > 6.5) return rose;
  return mix(base, cyan, 0.55);
}

void main() {
  vec2 uv = vUv * 2.0 - 1.0;
  uv.x *= uResolution.x / max(uResolution.y, 1.0);
  float t = uTime;
  float audio = saturate(uAudio);
  float wear = saturate(uWear);
  vec3 accent = modeColor(uMode, uAccent);
  vec3 cyan = vec3(0.34, 0.96, 1.0);
  vec3 amber = vec3(1.0, 0.70, 0.26);
  vec3 magenta = vec3(0.84, 0.32, 1.0);
  vec3 gunmetal = vec3(0.045, 0.070, 0.075);
  vec3 copper = vec3(0.45, 0.25, 0.13);

  vec2 p = uv;
  float breath = 0.5 + 0.5 * sin(t * 0.82);
  float vibration = 0.0035 * sin(t * 72.0) * audio;
  p.x += vibration;

  // Physical cradle / mechanical backing.
  float cradleOuter = 1.0 - smoothstep(0.0, 0.018, sdBox(p, vec2(0.82, 0.70), 0.16));
  float cradleInner = 1.0 - smoothstep(0.0, 0.018, sdBox(p, vec2(0.63, 0.51), 0.11));
  float cradle = saturate(cradleOuter - cradleInner * 0.82);
  float bevelTop = smoothstep(-0.72, 0.74, p.y) * cradle * 0.18;
  float bevelBottom = smoothstep(0.72, -0.70, p.y) * cradle * 0.34;
  float grain = (noise(p * 70.0 + t * 0.02) - 0.5) * 0.12;

  // Panel seams and mounting geometry.
  float seams = 0.0;
  seams += lineSeg(p, vec2(-0.74, 0.48), vec2(0.74, 0.48), 0.004);
  seams += lineSeg(p, vec2(-0.74, -0.48), vec2(0.74, -0.48), 0.004);
  seams += lineSeg(p, vec2(-0.48, -0.62), vec2(-0.48, 0.62), 0.004);
  seams += lineSeg(p, vec2(0.48, -0.62), vec2(0.48, 0.62), 0.004);
  float mountRing = ring(p, 0.58 + audio * 0.008, 0.016);
  float rivets = 0.0;
  for (int i = 0; i < 8; i++) {
    float a = float(i) * 0.785398;
    rivets += rivet(p, vec2(cos(a), sin(a)) * 0.72, 0.025);
  }

  // Neural cables feeding the angel core.
  float cable = 0.0;
  cable += lineSeg(p, vec2(-0.84, -0.36), vec2(-0.35, -0.12), 0.014);
  cable += lineSeg(p, vec2(0.84, -0.36), vec2(0.35, -0.12), 0.014);
  cable += lineSeg(p, vec2(-0.70, 0.34), vec2(-0.28, 0.10), 0.010);
  cable += lineSeg(p, vec2(0.70, 0.34), vec2(0.28, 0.10), 0.010);
  float neuralPulse = 0.50 + 0.50 * sin(t * (2.1 + audio * 5.0) - length(p) * 10.0);
  float cableGlow = cable * (0.20 + neuralPulse * (0.42 + audio * 0.55) + wear * 0.25);

  // Embedded angel core.
  vec2 q = p;
  q.y += 0.015 * sin(t * 1.1) + breath * 0.014;
  float body = 1.0 - smoothstep(0.0, 0.014, sdDiamond(q * mat2(0.86, -0.5, 0.5, 0.86), 0.44 + audio * 0.05));
  float core = 1.0 - smoothstep(0.0, 0.011, sdDiamond(q * mat2(0.74, -0.67, 0.67, 0.74), 0.25 + audio * 0.035));
  vec2 leftWing = q - vec2(-0.43, 0.03);
  leftWing.x *= 0.76; leftWing.y *= 1.42;
  vec2 rightWing = q - vec2(0.43, 0.03);
  rightWing.x *= 0.76; rightWing.y *= 1.42;
  float wingL = ring(leftWing, 0.34 + 0.02 * sin(t * 1.4 + audio), 0.018 + audio * 0.006);
  float wingR = ring(rightWing, 0.34 + 0.02 * sin(t * 1.4 + audio), 0.018 + audio * 0.006);
  vec2 haloP = q - vec2(0.0, 0.53 + 0.012 * sin(t));
  haloP.y *= 3.0;
  float halo = ring(haloP, 0.24 + audio * 0.014, 0.016);
  float aura = exp(-4.0 * dot(q, q)) * (0.16 + audio * 0.38 + breath * 0.12);

  // Holographic projection artifacts kept subtle over physical forms.
  float scan = 0.035 * sin((vUv.y + t * 0.10) * 950.0);
  float chroma = 0.004 * sin(t * 0.8 + p.y * 5.0);
  float edgeFloat = smoothstep(1.25, 0.0, length(p)) * 0.035 * sin(t * 0.55 + p.x * 6.0);

  vec3 color = vec3(0.0);
  color += cradle * (gunmetal + bevelTop + grain);
  color -= cradle * bevelBottom * 0.32;
  color += seams * vec3(0.0, 0.0, 0.0) * 0.9;
  color += mountRing * copper * (0.35 + wear * 0.25);
  color += rivets * vec3(0.55, 0.62, 0.60);
  color += cable * vec3(0.015, 0.025, 0.026);
  color += cableGlow * mix(cyan, magenta, 0.18) * 1.35;
  color += aura * accent;
  color += (wingL + wingR) * accent * 0.70;
  color += halo * amber * 1.2;
  color += body * mix(cyan, accent, 0.38);
  color += core * vec3(0.86 + chroma, 1.0, 1.0 - chroma) * 1.35;
  color += edgeFloat * vec3(0.55, 0.95, 1.0);
  color += scan;

  float alpha = saturate(cradle * 0.88 + mountRing * 0.55 + rivets * 0.5 + cable * 0.62 + cableGlow * 0.85 + aura + body + core + wingL * 0.62 + wingR * 0.62 + halo);
  gl_FragColor = vec4(max(color, 0.0), alpha);
}
`;
