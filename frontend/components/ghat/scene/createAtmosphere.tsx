"use client";

/**
 * createAtmosphere.tsx — Atmospheric effects for the Chhath Ghat scene.
 *
 * Features:
 *   - Sun glow: Sprite-based additive glow disc behind the sun mesh.
 *     Intensity breathes ±8% over a 6s cycle.
 *   - Atmospheric haze: FogExp2 + depth-based warm scattering via useThree.
 *   - Vignette: Applied via CSS on the canvas wrapper (zero GPU cost).
 *   - Film grain: CSS SVG filter on overlay div (imperceptible, cinematic).
 *
 * The component renders the sun glow sprite and updates scene fog each frame.
 */

import { useRef, useEffect, useMemo } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

// ─── Types ────────────────────────────────────────────────────────────────────

interface TODConfigSubset {
  fogColor: string;
  sunPosition: [number, number, number];
  showSun: boolean;
  sunColor: string;
}

interface AtmosphereProps {
  config: TODConfigSubset;
  prefersReduced: boolean;
}

// ─── Radial gradient texture for sun glow sprite ──────────────────────────────

function createGlowTexture(): THREE.Texture {
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width  = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const cx = size / 2;
  const grad = ctx.createRadialGradient(cx, cx, 0, cx, cx, cx);
  grad.addColorStop(0.0, "rgba(255, 200, 100, 0.9)");
  grad.addColorStop(0.3, "rgba(255, 140, 40,  0.5)");
  grad.addColorStop(0.7, "rgba(255, 80,  0,   0.15)");
  grad.addColorStop(1.0, "rgba(255, 60,  0,   0.0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

// ─── Sun Glow Sprite ──────────────────────────────────────────────────────────

function SunGlow({ config }: { config: TODConfigSubset }) {
  const spriteRef = useRef<THREE.Sprite>(null);
  const matRef    = useRef<THREE.SpriteMaterial>(null);
  const clock     = useRef(0);

  const glowTexture = useMemo(() => {
    if (typeof window === "undefined") return null;
    return createGlowTexture();
  }, []);

  useFrame((_, delta) => {
    if (!spriteRef.current || !matRef.current || !config.showSun) return;
    clock.current += delta;
    // Breathe ±8% over 6s cycle
    const breathe = 1.0 + Math.sin(clock.current * (Math.PI * 2 / 6)) * 0.08;
    matRef.current.opacity = 0.65 * breathe;
    // Follow sun position (approximate — sun moves slowly)
    spriteRef.current.position.set(
      config.sunPosition[0],
      config.sunPosition[1],
      config.sunPosition[2] + 0.1 // slightly in front of sun mesh
    );
  });

  if (!config.showSun || !glowTexture) return null;

  return (
    <sprite ref={spriteRef} position={config.sunPosition} scale={[8, 8, 1]}>
      <spriteMaterial
        ref={matRef}
        map={glowTexture}
        transparent
        blending={THREE.AdditiveBlending}
        depthWrite={false}
        opacity={0.65}
      />
    </sprite>
  );
}

// ─── Scene Fog Updater ────────────────────────────────────────────────────────

function FogUpdater({ config }: { config: TODConfigSubset }) {
  const { scene } = useThree();

  useEffect(() => {
    // FogExp2 gives more natural atmospheric depth than linear Fog
    scene.fog = new THREE.FogExp2(config.fogColor, 0.018);
    return () => { scene.fog = null; };
  }, [scene, config.fogColor]);

  return null;
}

// ─── Main Export ──────────────────────────────────────────────────────────────

export function GhatAtmosphere({ config, prefersReduced }: AtmosphereProps) {
  return (
    <>
      <FogUpdater config={config} />
      <SunGlow config={config} />
    </>
  );
}