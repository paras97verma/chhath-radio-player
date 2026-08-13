// water.vert.glsl — Gerstner wave vertex shader for the Chhath Ghat river
//
// Two overlapping Gerstner wave sets create realistic water surface displacement.
// Passes world position and perturbed normal to the fragment shader.

uniform float uTime;
uniform float uWaveStrength;   // default 0.12, bass-reactive

varying vec3  vWorldPosition;
varying vec3  vNormal;
varying vec2  vUv;

// ─── Gerstner Wave ────────────────────────────────────────────────────────────
// Returns XYZ displacement for a single Gerstner wave.
// dir: wave direction (normalized XZ), amplitude, wavelength, speed
vec3 gerstnerWave(vec2 dir, float amplitude, float wavelength, float speed, vec3 pos) {
  float k = 2.0 * 3.14159265 / wavelength;
  float c = sqrt(9.8 / k);          // phase speed (gravity waves)
  float f = k * (dot(dir, pos.xz) - c * speed * uTime);
  float a = amplitude * uWaveStrength / 0.12; // scale by uniform

  return vec3(
    dir.x * a * cos(f),             // X displacement
    a * sin(f),                     // Y displacement (height)
    dir.y * a * cos(f)              // Z displacement
  );
}

void main() {
  vUv = uv;

  vec3 pos = position;

  // Wave set 1 — primary swell (diagonal)
  vec3 w1 = gerstnerWave(normalize(vec2(1.0, 0.6)),  0.12, 8.0,  0.8, pos);
  // Wave set 2 — secondary chop (cross-direction)
  vec3 w2 = gerstnerWave(normalize(vec2(-0.4, 1.0)), 0.06, 4.5,  1.2, pos);
  // Wave set 3 — fine ripple
  vec3 w3 = gerstnerWave(normalize(vec2(0.7, -0.3)), 0.03, 2.0,  2.0, pos);

  pos += w1 + w2 + w3;

  // Approximate normal from wave tangents
  vec3 tangent = normalize(vec3(
    1.0 - w1.x * 0.5,
    w1.y,
    -w1.z * 0.5
  ));
  vec3 binormal = normalize(vec3(
    -w1.z * 0.5,
    w1.y,
    1.0 - w1.x * 0.5
  ));
  vNormal = normalize(cross(binormal, tangent));

  vec4 worldPos = modelMatrix * vec4(pos, 1.0);
  vWorldPosition = worldPos.xyz;

  gl_Position = projectionMatrix * viewMatrix * worldPos;
}