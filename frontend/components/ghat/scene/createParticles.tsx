"use client";

/**
 * createParticles.tsx — Four GPU-friendly particle systems for the Chhath Ghat.
 *
 * Systems:
 *   1. Morning dust  — slow upward drift, random XZ spread
 *   2. River mist    — horizontal drift above water surface
 *   3. Incense smoke — upward spiral near torch pillars
 *   4. Floating light — slow float, emissive orange glow
 *
 * All use THREE.Points with ShaderMaterial (uTime uniform) — zero CPU
 * per-frame allocation. High-frequency audio band increases speed/opacity.
 *
 * When prefersReduced === true: opacity set to 0, frame updates skipped.
 */

import { useRef, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import type { AudioBands } from "./createAudioReactive";

// ─── Shared particle shader ───────────────────────────────────────────────────

const PARTICLE_VERT = /* glsl */`
attribute float aPhase;
attribute float aSpeed;
attribute vec3  aInitPos;

uniform float uTime;
uniform float uSpeedMult;
uniform float uDriftDir;   // 1.0 = up, 0.0 = horizontal
uniform float uSpiral;     // 0.0 = none, 1.0 = spiral

varying float vAlpha;

void main() {
  float t = mod(uTime * aSpeed * uSpeedMult + aPhase, 1.0);

  vec3 pos = aInitPos;

  // Vertical drift
  pos.y += t * uDriftDir * 4.0;

  // Horizontal drift (mist)
  pos.x += sin(aPhase + uTime * 0.3) * (1.0 - uDriftDir) * 2.0;
  pos.z += cos(aPhase + uTime * 0.2) * (1.0 - uDriftDir) * 1.5;

  // Spiral (incense smoke)
  float spiralAngle = t * 6.28318 * uSpiral;
  pos.x += sin(spiralAngle + aPhase) * uSpiral * 0.4;
  pos.z += cos(spiralAngle + aPhase) * uSpiral * 0.4;

  // Fade in/out over lifetime
  vAlpha = sin(t * 3.14159) * 0.8;

  vec4 mvPos = modelViewMatrix * vec4(pos, 1.0);
  gl_PointSize = 3.0 * (300.0 / -mvPos.z);
  gl_Position = projectionMatrix * mvPos;
}
`;

const PARTICLE_FRAG = /* glsl */`
uniform float uOpacity;
uniform vec3  uColor;

varying float vAlpha;

void main() {
  // Circular point
  vec2 uv = gl_PointCoord - 0.5;
  float r = length(uv);
  if (r > 0.5) discard;
  float alpha = (1.0 - r * 2.0) * vAlpha * uOpacity;
  gl_FragColor = vec4(uColor, alpha);
}
`;

// ─── Types ────────────────────────────────────────────────────────────────────

interface ParticlesProps {
  audioBands: React.MutableRefObject<AudioBands>;
  prefersReduced: boolean;
  isMobile: boolean;
}

// ─── Single particle system ───────────────────────────────────────────────────

interface SystemConfig {
  count: number;
  countMobile: number;
  color: string;
  opacity: number;
  driftDir: number;   // 1=up, 0=horizontal
  spiral: number;     // 0=none, 1=spiral
  spread: [number, number, number]; // XYZ spread
  origin: [number, number, number]; // base position
}

function ParticleSystem({
  cfg,
  audioBands,
  prefersReduced,
  isMobile,
}: {
  cfg: SystemConfig;
  audioBands: React.MutableRefObject<AudioBands>;
  prefersReduced: boolean;
  isMobile: boolean;
}) {
  const matRef = useRef<THREE.ShaderMaterial>(null);
  const clock  = useRef(0);

  const count = isMobile ? cfg.countMobile : cfg.count;

  const { positions, phases, speeds, initPositions } = useMemo(() => {
    const pos   = new Float32Array(count * 3);
    const ph    = new Float32Array(count);
    const sp    = new Float32Array(count);
    const init  = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
      const x = cfg.origin[0] + (Math.random() - 0.5) * cfg.spread[0];
      const y = cfg.origin[1] + (Math.random() - 0.5) * cfg.spread[1];
      const z = cfg.origin[2] + (Math.random() - 0.5) * cfg.spread[2];
      pos[i * 3]     = x;
      pos[i * 3 + 1] = y;
      pos[i * 3 + 2] = z;
      init[i * 3]    = x;
      init[i * 3 + 1] = y;
      init[i * 3 + 2] = z;
      ph[i] = Math.random();
      sp[i] = 0.3 + Math.random() * 0.7;
    }
    return { positions: pos, phases: ph, speeds: sp, initPositions: init };
  }, [count, cfg.origin, cfg.spread]);

  const uniforms = useMemo(() => ({
    uTime:      { value: 0 },
    uSpeedMult: { value: 1.0 },
    uDriftDir:  { value: cfg.driftDir },
    uSpiral:    { value: cfg.spiral },
    uOpacity:   { value: cfg.opacity },
    uColor:     { value: new THREE.Color(cfg.color) },
  }), []); // eslint-disable-line react-hooks/exhaustive-deps

  useFrame((_, delta) => {
    if (!matRef.current || prefersReduced) {
      if (matRef.current) matRef.current.uniforms.uOpacity.value = 0;
      return;
    }
    clock.current += delta;
    matRef.current.uniforms.uTime.value = clock.current;
    // High-frequency audio drives speed
    const high = audioBands.current.high;
    matRef.current.uniforms.uSpeedMult.value = 0.8 + high * 0.4;
    matRef.current.uniforms.uOpacity.value = cfg.opacity * (0.7 + high * 0.3);
  });

  return (
    <points>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-aPhase"   args={[phases, 1]} />
        <bufferAttribute attach="attributes-aSpeed"   args={[speeds, 1]} />
        <bufferAttribute attach="attributes-aInitPos" args={[initPositions, 3]} />
      </bufferGeometry>
      <shaderMaterial
        ref={matRef}
        vertexShader={PARTICLE_VERT}
        fragmentShader={PARTICLE_FRAG}
        uniforms={uniforms}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  );
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function GhatParticles({ audioBands, prefersReduced, isMobile }: ParticlesProps) {
  const systems: SystemConfig[] = [
    // 1. Morning dust — slow upward drift
    {
      count: 800, countMobile: 200,
      color: "#ffd4a0", opacity: 0.25,
      driftDir: 1.0, spiral: 0.0,
      spread: [30, 6, 20],
      origin: [0, 0, 0],
    },
    // 2. River mist — horizontal drift above water
    {
      count: 400, countMobile: 100,
      color: "#a0c8e0", opacity: 0.18,
      driftDir: 0.0, spiral: 0.0,
      spread: [28, 0.5, 14],
      origin: [0, -1.2, -4],
    },
    // 3. Incense smoke — upward spiral near torch pillars
    {
      count: 200, countMobile: 60,
      color: "#c8b4a0", opacity: 0.22,
      driftDir: 0.8, spiral: 1.0,
      spread: [12, 1, 2],
      origin: [0, 0.5, 9.5],
    },
    // 4. Floating light particles — emissive orange glow
    {
      count: 150, countMobile: 40,
      color: "#ff8c00", opacity: 0.55,
      driftDir: 0.6, spiral: 0.2,
      spread: [20, 4, 12],
      origin: [0, -0.5, 0],
    },
  ];

  return (
    <group>
      {systems.map((cfg, i) => (
        <ParticleSystem
          key={i}
          cfg={cfg}
          audioBands={audioBands}
          prefersReduced={prefersReduced}
          isMobile={isMobile}
        />
      ))}
    </group>
  );
}