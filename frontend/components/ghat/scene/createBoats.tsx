"use client";

/**
 * createBoats.tsx — Three animated wooden boats on the Chhath Ghat river.
 *
 * Boats:
 *   1. Foreground — medium poly, warm wood, slow bob + x-drift
 *   2. Mid        — low poly, darker wood, slower bob
 *   3. Background — silhouette only, nearly static
 *
 * Each boat has a small wake: two PlaneGeometry quads with animated opacity.
 */

import { useRef, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";

// ─── Types ────────────────────────────────────────────────────────────────────

interface BoatConfig {
  position: [number, number, number];
  scale: number;
  woodColor: string;
  hullColor: string;
  bobSpeed: number;
  bobAmp: number;
  driftSpeed: number;
  driftRange: number;
  phase: number;
}

// ─── Single Boat ──────────────────────────────────────────────────────────────

function Boat({ cfg }: { cfg: BoatConfig }) {
  const groupRef   = useRef<THREE.Group>(null);
  const wake1Ref   = useRef<THREE.Mesh>(null);
  const wake2Ref   = useRef<THREE.Mesh>(null);
  const wake1Mat   = useRef<THREE.MeshStandardMaterial>(null);
  const wake2Mat   = useRef<THREE.MeshStandardMaterial>(null);
  const clock      = useRef(cfg.phase);
  const baseX      = useRef(cfg.position[0]);

  useFrame((_, delta) => {
    clock.current += delta;
    if (!groupRef.current) return;

    // Bob on water
    groupRef.current.position.y =
      cfg.position[1] + Math.sin(clock.current * cfg.bobSpeed) * cfg.bobAmp;

    // Gentle x-drift
    groupRef.current.position.x =
      baseX.current + Math.sin(clock.current * cfg.driftSpeed) * cfg.driftRange;

    // Slight roll with bob
    groupRef.current.rotation.z = Math.sin(clock.current * cfg.bobSpeed * 0.7) * 0.04;
    groupRef.current.rotation.x = Math.sin(clock.current * cfg.bobSpeed * 0.5) * 0.02;

    // Wake opacity pulse
    const wakeAlpha = 0.15 + Math.sin(clock.current * 1.5) * 0.08;
    if (wake1Mat.current) wake1Mat.current.opacity = wakeAlpha;
    if (wake2Mat.current) wake2Mat.current.opacity = wakeAlpha * 0.6;
  });

  const s = cfg.scale;

  return (
    <group ref={groupRef} position={cfg.position}>
      {/* Hull — main body */}
      <mesh castShadow receiveShadow>
        <boxGeometry args={[2.4 * s, 0.35 * s, 0.9 * s]} />
        <meshStandardMaterial color={cfg.hullColor} roughness={0.85} metalness={0.05} />
      </mesh>

      {/* Hull bottom curve (approximated with a flattened cylinder) */}
      <mesh position={[0, -0.18 * s, 0]} rotation={[0, 0, 0]}>
        <cylinderGeometry args={[0.45 * s, 0.45 * s, 2.4 * s, 8, 1, false, 0, Math.PI]} />
        <meshStandardMaterial color={cfg.hullColor} roughness={0.9} side={THREE.BackSide} />
      </mesh>

      {/* Bow (front point) */}
      <mesh position={[1.2 * s, 0, 0]} rotation={[0, 0, 0]}>
        <coneGeometry args={[0.45 * s, 0.6 * s, 6]} />
        <meshStandardMaterial color={cfg.woodColor} roughness={0.8} />
      </mesh>

      {/* Stern (back) */}
      <mesh position={[-1.2 * s, 0.05 * s, 0]}>
        <boxGeometry args={[0.3 * s, 0.4 * s, 0.85 * s]} />
        <meshStandardMaterial color={cfg.woodColor} roughness={0.8} />
      </mesh>

      {/* Deck planks */}
      {[-0.6, 0, 0.6].map((xOff, i) => (
        <mesh key={i} position={[xOff * s, 0.18 * s, 0]}>
          <boxGeometry args={[0.55 * s, 0.04 * s, 0.82 * s]} />
          <meshStandardMaterial color={cfg.woodColor} roughness={0.75} />
        </mesh>
      ))}

      {/* Mast (only on foreground boat) */}
      {cfg.scale > 0.8 && (
        <mesh position={[0, 0.8 * s, 0]}>
          <cylinderGeometry args={[0.03 * s, 0.04 * s, 1.6 * s, 6]} />
          <meshStandardMaterial color="#2a1a08" roughness={0.95} />
        </mesh>
      )}

      {/* Wake — two translucent quads behind the boat */}
      <mesh
        ref={wake1Ref}
        position={[-1.8 * s, -0.15 * s, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <planeGeometry args={[1.2 * s, 0.6 * s]} />
        <meshStandardMaterial
          ref={wake1Mat}
          color="#a0c8e0"
          transparent
          opacity={0.15}
          depthWrite={false}
        />
      </mesh>
      <mesh
        ref={wake2Ref}
        position={[-2.4 * s, -0.15 * s, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <planeGeometry args={[0.8 * s, 0.4 * s]} />
        <meshStandardMaterial
          ref={wake2Mat}
          color="#a0c8e0"
          transparent
          opacity={0.09}
          depthWrite={false}
        />
      </mesh>
    </group>
  );
}

// ─── Main Export ──────────────────────────────────────────────────────────────

export function GhatBoats() {
  const boats: BoatConfig[] = useMemo(() => [
    // 1. Foreground — warm wood, visible detail
    {
      position: [-6, -1.38, -3],
      scale: 1.0,
      woodColor: "#8b5e3c",
      hullColor: "#5c3a1e",
      bobSpeed: 0.8,
      bobAmp: 0.06,
      driftSpeed: 0.15,
      driftRange: 0.4,
      phase: 0,
    },
    // 2. Mid — darker, less detail
    {
      position: [4, -1.42, -8],
      scale: 0.75,
      woodColor: "#5a3a20",
      hullColor: "#3a2010",
      bobSpeed: 0.6,
      bobAmp: 0.04,
      driftSpeed: 0.1,
      driftRange: 0.3,
      phase: 1.2,
    },
    // 3. Background — silhouette, nearly static
    {
      position: [-2, -1.46, -14],
      scale: 0.5,
      woodColor: "#1a1008",
      hullColor: "#0e0804",
      bobSpeed: 0.4,
      bobAmp: 0.02,
      driftSpeed: 0.05,
      driftRange: 0.15,
      phase: 2.5,
    },
  ], []);

  return (
    <group>
      {boats.map((cfg, i) => (
        <Boat key={i} cfg={cfg} />
      ))}
    </group>
  );
}