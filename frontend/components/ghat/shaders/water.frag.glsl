// water.frag.glsl — Fragment shader for the Chhath Ghat river surface
//
// Features:
//   - Fresnel-based reflection blend (more reflective at grazing angles)
//   - Animated UV distortion for caustic shimmer
//   - Sun specular highlight
//   - Depth-based color (shallow warm, deep cool)
//   - Subtle foam at wave crests

uniform float uTime;
uniform float uReflectionStrength;  // 0.4
uniform vec3  uSunPosition;
uniform vec3  uWaterColor;          // shallow color from TODConfig
uniform vec3  uDeepColor;           // deep color (darker)
uniform float uFoamThreshold;       // 0.08

varying vec3  vWorldPosition;
varying vec3  vNormal;
varying vec2  vUv;

// ─── Helpers ──────────────────────────────────────────────────────────────────

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f); // smoothstep
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
    f.y
  );
}

void main() {
  // ── Animated UV distortion (caustic shimmer) ──────────────────────────────
  vec2 distortedUv = vUv + vec2(
    noise(vUv * 4.0 + uTime * 0.3) * 0.04,
    noise(vUv * 4.0 + uTime * 0.25 + 3.7) * 0.04
  );

  // ── Depth-based color blend ───────────────────────────────────────────────
  // Use Y position to approximate depth (lower = deeper)
  float depth = clamp((vWorldPosition.y + 2.0) / 1.5, 0.0, 1.0);
  vec3 waterCol = mix(uDeepColor, uWaterColor, depth);

  // ── Fresnel reflection ────────────────────────────────────────────────────
  vec3 viewDir = normalize(cameraPosition - vWorldPosition);
  float fresnel = pow(1.0 - max(dot(vNormal, viewDir), 0.0), 3.0);
  fresnel *= uReflectionStrength;

  // Reflection tint (sky color approximation — warm orange at sunrise)
  vec3 reflectionColor = mix(vec3(0.05, 0.08, 0.15), vec3(1.0, 0.55, 0.2), fresnel * 0.5);

  // ── Sun specular highlight ────────────────────────────────────────────────
  vec3 sunDir = normalize(uSunPosition - vWorldPosition);
  vec3 halfDir = normalize(sunDir + viewDir);
  float spec = pow(max(dot(vNormal, halfDir), 0.0), 64.0);
  vec3 specular = vec3(1.0, 0.9, 0.7) * spec * 0.8;

  // ── Foam at wave crests ───────────────────────────────────────────────────
  float crestHeight = vWorldPosition.y + 1.5; // relative to water base
  float foam = smoothstep(uFoamThreshold * 0.5, uFoamThreshold, crestHeight);
  foam *= noise(distortedUv * 12.0 + uTime * 0.5) * 0.6;
  vec3 foamColor = vec3(0.9, 0.92, 0.95);

  // ── Diya reflection sprites (additive orange glow on water) ───────────────
  // Approximate: animated noise blobs near water surface
  float diyaGlow = noise(vUv * 3.0 + vec2(uTime * 0.1, 0.0)) * 0.15;
  diyaGlow *= smoothstep(0.3, 0.0, abs(vWorldPosition.y + 1.4));
  vec3 diyaColor = vec3(1.0, 0.5, 0.1) * diyaGlow;

  // ── Composite ─────────────────────────────────────────────────────────────
  vec3 color = waterCol;
  color = mix(color, reflectionColor, fresnel);
  color += specular;
  color = mix(color, foamColor, foam);
  color += diyaColor;

  // Subtle animated shimmer
  float shimmer = noise(distortedUv * 8.0 + uTime * 0.8) * 0.06;
  color += shimmer * uWaterColor;

  gl_FragColor = vec4(color, 0.88);
}