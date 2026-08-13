"use client";

/**
 * createWater.tsx — GPU water shader component for the Chhath Ghat river.
 *
 * Replaces the CPU vertex-displacement River component with a ShaderMaterial
 * plane. Zero CPU per-frame allocation — all wave math runs on the GPU.
 *
 * Props:
 *   config       — TODConfig (water color, sun position)
 *   audioBands   — ref from useAudioReactive (bass drives wave strength)
 *   prefersReduced — freeze uTime when true
 *   isMobile     — use lower-res geometry on mobile
 */

import { useRef, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { AudioBands } from "./createAudioReactive";

// ─── Inline GLSL (avoids webpack glsl-loader requirement) ─────────────────────

const VERT = /* glsl */`
uniform float uTime;
uniform float uWaveStrength;

varying vec3 vWorldPosition;
varying vec3 vNormal;
varying vec2 vUv;

vec3 gerstnerWave(vec2 dir, float amplitude, float wavelength, float speed, vec3 pos) {
  float k = 6.28318 / wavelength;
  float c = sqrt(9.8 / k);
  float f = k * (dot(dir, pos.xz) - c * speed * uTime);
  float a = amplitude * uWaveStrength / 0.12;
  return vec3(dir.x * a * cos(f), a * sin(f), dir.y * a * cos(f));
}

void main() {
  vUv = uv;
  vec3 pos = position;
  vec3 w1 = gerstnerWave(normalize(vec2(1.0, 0.6)),  0.12, 8.0, 0.8, pos);
  vec3 w2 = gerstnerWave(normalize(vec2(-0.4, 1.0)), 0.06, 4.5, 1.2, pos);
  vec3 w3 = gerstnerWave(normalize(vec2(0.7, -0.3)), 0.03, 2.0, 2.0, pos);
  pos += w1 + w2 + w3;
  vec3 tangent  = normalize(vec3(1.0 - w1.x * 0.5, w1.y, -w1.z * 0.5));
  vec3 binormal = normalize(vec3(-w1.z * 0.5, w1.y, 1.0 - w1.x * 0.5));
  vNormal = normalize(cross(binormal, tangent));
  vec4 worldPos = modelMatrix * vec4(pos, 1.0);
  vWorldPosition = worldPos.xyz;
  gl_Position = projectionMatrix * viewMatrix * worldPos;
}
`;

const FRAG = /* glsl */`
uniform float uTime;
uniform float uReflectionStrength;
uniform vec3  uSunPosition;
uniform vec3  uWaterColor;
uniform vec3  uDeepColor;
uniform float uFoamThreshold;

varying vec3 vWorldPosition;
varying vec3 vNormal;
varying vec2 vUv;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y);
}

void main() {
  vec2 duv = vUv + vec2(noise(vUv*4.0+uTime*0.3)*0.04, noise(vUv*4.0+uTime*0.25+3.7)*0.04);
  float depth = clamp((vWorldPosition.y + 2.0) / 1.5, 0.0, 1.0);
  vec3 waterCol = mix(uDeepColor, uWaterColor, depth);
  vec3 viewDir = normalize(cameraPosition - vWorldPosition);
  float fresnel = pow(1.0 - max(dot(vNormal, viewDir), 0.0), 3.0) * uReflectionStrength;
  vec3 reflCol = mix(vec3(0.05,0.08,0.15), vec3(1.0,0.55,0.2), fresnel * 0.5);
  vec3 sunDir = normalize(uSunPosition - vWorldPosition);
  vec3 halfDir = normalize(sunDir + viewDir);
  float spec = pow(max(dot(vNormal, halfDir), 0.0), 64.0);
  vec3 specular = vec3(1.0,0.9,0.7) * spec * 0.8;
  float crestH = vWorldPosition.y + 1.5;
  float foam = smoothstep(uFoamThreshold*0.5, uFoamThreshold, crestH) * noise(duv*12.0+uTime*0.5) * 0.6;
  float diyaGlow = noise(vUv*3.0+vec2(uTime*0.1,0.0)) * 0.15 * smoothstep(0.3, 0.0, abs(vWorldPosition.y+1.4));
  vec3 color = waterCol;
  color = mix(color, reflCol, fresnel);
  color += specular;
  color = mix(color, vec3(0.9,0.92,0.95), foam);
  color += vec3(1.0,0.5,0.1) * diyaGlow;
  color += noise(duv*8.0+uTime*0.8) * 0.06 * uWaterColor;
  gl_FragColor = vec4(color, 0.88);
}
`;

// ─── Types ────────────────────────────────────────────────────────────────────

interface TODConfigSubset {
  waterColor: string;
  waterEmissive: string;
  sunPosition: [number, number, number];
}

interface WaterProps {
  config: TODConfigSubset;
  audioBands: React.MutableRefObject<AudioBands>;
  prefersReduced: boolean;
  isMobile: boolean;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function GhatWater({ config, audioBands, prefersReduced, isMobile }: WaterProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const matRef  = useRef<THREE.ShaderMaterial>(null);
  const clock   = useRef(0);

  const uniforms = useMemo(() => ({
    uTime:               { value: 0 },
    uWaveStrength:       { value: 0.12 },
    uReflectionStrength: { value: 0.4 },
    uSunPosition:        { value: new THREE.Vector3(...config.sunPosition) },
    uWaterColor:         { value: new THREE.Color(config.waterColor) },
    uDeepColor:          { value: new THREE.Color(config.waterEmissive) },
    uFoamThreshold:      { value: 0.08 },
  }), []); // eslint-disable-line react-hooks/exhaustive-deps

  // Update sun position when config changes
  useMemo(() => {
    uniforms.uSunPosition.value.set(...config.sunPosition);
    uniforms.uWaterColor.value.set(config.waterColor);
    uniforms.uDeepColor.value.set(config.waterEmissive);
  }, [config.sunPosition, config.waterColor, config.waterEmissive]); // eslint-disable-line react-hooks/exhaustive-deps

  useFrame((_, delta) => {
    if (!matRef.current) return;
    if (!prefersReduced) {
      clock.current += delta;
      matRef.current.uniforms.uTime.value = clock.current;
    }
    // Bass-reactive wave strength (0.08 – 0.20 range)
    const bass = audioBands.current.bass;
    matRef.current.uniforms.uWaveStrength.value = 0.08 + bass * 0.12;
  });

  const segments = isMobile ? [32, 16] : [64, 32];

  return (
    <mesh
      ref={meshRef}
      rotation={[-Math.PI / 2, 0, 0]}
      position={[0, -1.5, 0]}
      receiveShadow
    >
      <planeGeometry args={[60, 30, segments[0], segments[1]]} />
      <shaderMaterial
        ref={matRef}
        vertexShader={VERT}
        fragmentShader={FRAG}
        uniforms={uniforms}
        transparent
        side={THREE.DoubleSide}
      />
    </mesh>
  );
}