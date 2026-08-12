"use client";

/**
 * GhatScene — Immersive 3D Chhath Puja Ghat
 *
 * Built with React Three Fiber + @react-three/drei.
 * Time-of-day aware: sky, lighting, sun/moon, crowd activity all change.
 *
 * Interactions:
 *  - Mouse moves camera slightly (parallax)
 *  - Click on river spawns ripple rings
 *
 * Time slots:
 *  predawn  (4–6 AM)  : Dark, stars, moon, devotees arriving with diyas
 *  morning  (6–10 AM) : Sunrise arghya — golden sky, people in river
 *  afternoon(10–4 PM) : Bright blue sky, river shimmering
 *  evening  (4–7 PM)  : Sunset arghya — crimson sky, crowd offering water
 *  night    (7 PM–4 AM): Stars, moon, floating diyas, aarti glow
 */

import { useRef, useMemo, useEffect, useState, Suspense } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Stars, Float, MeshDistortMaterial, Environment } from "@react-three/drei";
import * as THREE from "three";

// ─── Time of Day ──────────────────────────────────────────────────────────────

type TOD = "predawn" | "morning" | "afternoon" | "evening" | "night";

function getTOD(): TOD {
  const h = new Date().getHours();
  if (h >= 4 && h < 6)  return "predawn";
  if (h >= 6 && h < 10) return "morning";
  if (h >= 10 && h < 16) return "afternoon";
  if (h >= 16 && h < 19) return "evening";
  return "night";
}

interface TODConfig {
  skyTop: string;
  skyHorizon: string;
  fogColor: string;
  fogNear: number;
  fogFar: number;
  ambientIntensity: number;
  ambientColor: string;
  sunColor: string;
  sunIntensity: number;
  sunPosition: [number, number, number];
  waterColor: string;
  waterEmissive: string;
  waterEmissiveIntensity: number;
  showMoon: boolean;
  showSun: boolean;
  diyaIntensity: number;
  diyaCount: number;
  birdCount: number;
  crowdActivity: "arghya" | "prayer" | "normal";
}

const TOD_CONFIGS: Record<TOD, TODConfig> = {
  predawn: {
    skyTop: "#010510", skyHorizon: "#1a0a3a",
    fogColor: "#0a0a2e", fogNear: 12, fogFar: 45,
    ambientIntensity: 0.15, ambientColor: "#2a1a5a",
    sunColor: "#ffd4a0", sunIntensity: 0.2,
    sunPosition: [-8, 2, -15],
    waterColor: "#060e1a", waterEmissive: "#0a1628", waterEmissiveIntensity: 0.3,
    showMoon: true, showSun: false,
    diyaIntensity: 1.8, diyaCount: 30,
    birdCount: 2, crowdActivity: "prayer",
  },
  morning: {
    skyTop: "#0d1b4b", skyHorizon: "#ff8c42",
    fogColor: "#e8834a", fogNear: 18, fogFar: 60,
    ambientIntensity: 0.6, ambientColor: "#ffd4a0",
    sunColor: "#ffcc44", sunIntensity: 2.5,
    sunPosition: [-10, 3, -20],
    waterColor: "#1a3a6a", waterEmissive: "#2a5a9a", waterEmissiveIntensity: 0.4,
    showMoon: false, showSun: true,
    diyaIntensity: 0.8, diyaCount: 18,
    birdCount: 16, crowdActivity: "arghya",
  },
  afternoon: {
    skyTop: "#1a3a8a", skyHorizon: "#87ceeb",
    fogColor: "#87ceeb", fogNear: 25, fogFar: 80,
    ambientIntensity: 1.2, ambientColor: "#ffffff",
    sunColor: "#ffe066", sunIntensity: 3.5,
    sunPosition: [0, 18, -20],
    waterColor: "#2a5a9a", waterEmissive: "#3a7acc", waterEmissiveIntensity: 0.5,
    showMoon: false, showSun: true,
    diyaIntensity: 0.3, diyaCount: 8,
    birdCount: 10, crowdActivity: "normal",
  },
  evening: {
    skyTop: "#1a0a2e", skyHorizon: "#f39c12",
    fogColor: "#c0392b", fogNear: 14, fogFar: 50,
    ambientIntensity: 0.5, ambientColor: "#ff8844",
    sunColor: "#ff6622", sunIntensity: 2.0,
    sunPosition: [10, 2, -18],
    waterColor: "#1a1a3a", waterEmissive: "#2a2a5a", waterEmissiveIntensity: 0.35,
    showMoon: false, showSun: true,
    diyaIntensity: 1.4, diyaCount: 25,
    birdCount: 12, crowdActivity: "arghya",
  },
  night: {
    skyTop: "#020818", skyHorizon: "#1a1040",
    fogColor: "#0a0a2e", fogNear: 10, fogFar: 40,
    ambientIntensity: 0.1, ambientColor: "#1a1a4a",
    sunColor: "#c8d8ff", sunIntensity: 0.3,
    sunPosition: [5, 12, -15],
    waterColor: "#0d1f3c", waterEmissive: "#0a1628", waterEmissiveIntensity: 0.25,
    showMoon: true, showSun: false,
    diyaIntensity: 2.2, diyaCount: 35,
    birdCount: 1, crowdActivity: "prayer",
  },
};

// ─── Camera Controller ────────────────────────────────────────────────────────

function CameraController({ mouse }: { mouse: React.MutableRefObject<{ x: number; y: number }> }) {
  const { camera } = useThree();
  const target = useRef(new THREE.Vector3(0, 1.5, 0));

  useFrame(() => {
    const mx = (mouse.current.x - 0.5) * 2;
    const my = (mouse.current.y - 0.5) * 2;
    camera.position.x += (mx * 1.5 - camera.position.x) * 0.03;
    camera.position.y += (2.5 - my * 0.8 - camera.position.y) * 0.03;
    camera.lookAt(target.current);
  });

  return null;
}

// ─── Sky Dome ─────────────────────────────────────────────────────────────────

function SkyDome({ config }: { config: TODConfig }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const matRef  = useRef<THREE.ShaderMaterial>(null);

  const shader = useMemo(() => ({
    uniforms: {
      topColor:    { value: new THREE.Color(config.skyTop) },
      horizonColor:{ value: new THREE.Color(config.skyHorizon) },
      offset:      { value: 0.4 },
      exponent:    { value: 0.6 },
    },
    vertexShader: `
      varying vec3 vWorldPosition;
      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPosition.xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 topColor;
      uniform vec3 horizonColor;
      uniform float offset;
      uniform float exponent;
      varying vec3 vWorldPosition;
      void main() {
        float h = normalize(vWorldPosition + offset).y;
        gl_FragColor = vec4(mix(horizonColor, topColor, max(pow(max(h, 0.0), exponent), 0.0)), 1.0);
      }
    `,
    side: THREE.BackSide,
  }), [config.skyTop, config.skyHorizon]);

  return (
    <mesh ref={meshRef} scale={[100, 100, 100]}>
      <sphereGeometry args={[1, 32, 32]} />
      <shaderMaterial ref={matRef} attach="material" args={[shader]} />
    </mesh>
  );
}

// ─── Sun / Moon ───────────────────────────────────────────────────────────────

function CelestialBody({ config, tod }: { config: TODConfig; tod: TOD }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const lightRef = useRef<THREE.DirectionalLight>(null);
  const t = useRef(0);

  useFrame((_, delta) => {
    t.current += delta;
    if (!meshRef.current) return;

    if (config.showSun) {
      // Arc the sun across the sky
      const progress = tod === "morning" ? 0.1 + t.current * 0.008
        : tod === "evening" ? 0.65 + t.current * 0.006
        : 0.5;
      const angle = progress * Math.PI;
      meshRef.current.position.x = Math.cos(angle) * 22;
      meshRef.current.position.y = Math.sin(angle) * 14 + 2;
      meshRef.current.position.z = -20;
    } else {
      // Moon gentle drift
      meshRef.current.position.x = 8 + Math.sin(t.current * 0.05) * 2;
      meshRef.current.position.y = 10 + Math.cos(t.current * 0.03) * 1;
      meshRef.current.position.z = -18;
    }

    if (lightRef.current) {
      lightRef.current.position.copy(meshRef.current.position);
    }
  });

  const isSun = config.showSun;
  const bodyColor = isSun
    ? (tod === "evening" ? "#ff6622" : tod === "morning" ? "#ffcc44" : "#ffe066")
    : "#fffde0";
  const emissiveColor = isSun
    ? (tod === "evening" ? "#cc3300" : "#ffaa00")
    : "#e8c860";
  const bodySize = isSun ? (tod === "afternoon" ? 1.4 : 1.8) : 1.0;

  return (
    <group>
      <mesh ref={meshRef} position={config.sunPosition}>
        <sphereGeometry args={[bodySize, 24, 24]} />
        <meshStandardMaterial
          color={bodyColor}
          emissive={emissiveColor}
          emissiveIntensity={isSun ? 2.5 : 1.2}
          toneMapped={false}
        />
      </mesh>
      <directionalLight
        ref={lightRef}
        position={config.sunPosition}
        color={config.sunColor}
        intensity={config.sunIntensity}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-far={80}
        shadow-camera-left={-20}
        shadow-camera-right={20}
        shadow-camera-top={20}
        shadow-camera-bottom={-20}
      />
    </group>
  );
}

// ─── Animated River ───────────────────────────────────────────────────────────

function River({ config }: { config: TODConfig }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const t = useRef(0);

  useFrame((_, delta) => {
    t.current += delta * 0.4;
    if (!meshRef.current) return;
    const geo = meshRef.current.geometry as THREE.PlaneGeometry;
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const wave = Math.sin(x * 0.4 + t.current) * 0.12
        + Math.cos(z * 0.3 + t.current * 0.7) * 0.08
        + Math.sin(x * 0.8 + z * 0.5 + t.current * 1.2) * 0.04;
      pos.setY(i, wave);
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
  });

  return (
    <mesh ref={meshRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.5, 0]} receiveShadow>
      <planeGeometry args={[60, 30, 64, 32]} />
      <meshStandardMaterial
        color={config.waterColor}
        emissive={config.waterEmissive}
        emissiveIntensity={config.waterEmissiveIntensity}
        metalness={0.6}
        roughness={0.2}
        transparent
        opacity={0.88}
      />
    </mesh>
  );
}

// ─── Ghat Steps ───────────────────────────────────────────────────────────────

function GhatSteps() {
  const steps = [
    { y: -1.35, z: 1.5,  w: 28, d: 2.2, h: 0.22, color: "#2a1f14" },
    { y: -1.13, z: 3.5,  w: 25, d: 2.0, h: 0.22, color: "#241a10" },
    { y: -0.91, z: 5.2,  w: 22, d: 2.0, h: 0.22, color: "#1e160d" },
    { y: -0.69, z: 6.8,  w: 19, d: 1.8, h: 0.22, color: "#18120a" },
    { y: -0.47, z: 8.2,  w: 16, d: 1.8, h: 0.22, color: "#120e08" },
  ];

  return (
    <group>
      {steps.map((s, i) => (
        <mesh key={i} position={[0, s.y, s.z]} castShadow receiveShadow>
          <boxGeometry args={[s.w, s.h, s.d]} />
          <meshStandardMaterial color={s.color} roughness={0.95} metalness={0.05} />
        </mesh>
      ))}
      {/* Ghat floor / platform */}
      <mesh position={[0, -0.25, 10]} receiveShadow>
        <boxGeometry args={[30, 0.3, 8]} />
        <meshStandardMaterial color="#0e0a06" roughness={0.98} />
      </mesh>
    </group>
  );
}

// ─── Temple Silhouette ────────────────────────────────────────────────────────

function Temple() {
  return (
    <group position={[0, 0, 12]}>
      {/* Main spire */}
      <mesh position={[0, 5, 0]} castShadow>
        <coneGeometry args={[0.8, 6, 8]} />
        <meshStandardMaterial color="#0a0806" roughness={1} />
      </mesh>
      <mesh position={[0, 1.5, 0]} castShadow>
        <boxGeometry args={[4, 3, 3]} />
        <meshStandardMaterial color="#0d0a07" roughness={1} />
      </mesh>
      {/* Side spires */}
      {[-3.5, 3.5].map((x, i) => (
        <group key={i} position={[x, 0, 0]}>
          <mesh position={[0, 3.5, 0]} castShadow>
            <coneGeometry args={[0.5, 3.5, 8]} />
            <meshStandardMaterial color="#0a0806" roughness={1} />
          </mesh>
          <mesh position={[0, 1.5, 0]} castShadow>
            <boxGeometry args={[2.5, 3, 2.5]} />
            <meshStandardMaterial color="#0d0a07" roughness={1} />
          </mesh>
        </group>
      ))}
      {/* Wide base */}
      <mesh position={[0, 0, 0]} castShadow>
        <boxGeometry args={[14, 0.5, 4]} />
        <meshStandardMaterial color="#0a0806" roughness={1} />
      </mesh>
    </group>
  );
}

// ─── Torch Pillars ────────────────────────────────────────────────────────────

function TorchPillar({ position, config }: { position: [number, number, number]; config: TODConfig }) {
  const lightRef = useRef<THREE.PointLight>(null);
  const t = useRef(Math.random() * Math.PI * 2);

  useFrame((_, delta) => {
    t.current += delta * 4;
    if (lightRef.current) {
      lightRef.current.intensity = config.diyaIntensity * (0.8 + Math.sin(t.current) * 0.2);
    }
  });

  return (
    <group position={position}>
      {/* Pillar */}
      <mesh position={[0, -1, 0]} castShadow>
        <cylinderGeometry args={[0.12, 0.15, 3.5, 8]} />
        <meshStandardMaterial color="#1a1208" roughness={0.95} />
      </mesh>
      {/* Flame glow sphere */}
      <mesh position={[0, 1, 0]}>
        <sphereGeometry args={[0.25, 12, 12]} />
        <meshStandardMaterial
          color="#ff8c00"
          emissive="#ff4500"
          emissiveIntensity={3}
          toneMapped={false}
        />
      </mesh>
      <pointLight
        ref={lightRef}
        position={[0, 1.2, 0]}
        color="#ff8c00"
        intensity={config.diyaIntensity * 2}
        distance={8}
        decay={2}
      />
    </group>
  );
}

// ─── Floating Diyas ───────────────────────────────────────────────────────────

function FloatingDiyas({ config }: { config: TODConfig }) {
  const count = config.diyaCount;

  const diyaData = useMemo(() => Array.from({ length: count }, (_, i) => ({
    x: (Math.random() - 0.5) * 24,
    z: -2 + Math.random() * -10,
    phase: Math.random() * Math.PI * 2,
    speed: 0.3 + Math.random() * 0.4,
    drift: (Math.random() - 0.5) * 0.008,
  })), [count]);

  const refs = useRef<(THREE.Group | null)[]>([]);
  const lightRefs = useRef<(THREE.PointLight | null)[]>([]);
  const t = useRef(0);

  useFrame((_, delta) => {
    t.current += delta;
    diyaData.forEach((d, i) => {
      const group = refs.current[i];
      const light = lightRefs.current[i];
      if (!group) return;
      // Drift along river
      group.position.x += d.drift;
      if (group.position.x > 14) group.position.x = -14;
      if (group.position.x < -14) group.position.x = 14;
      // Bob on water
      group.position.y = -1.4 + Math.sin(t.current * d.speed + d.phase) * 0.06;
      // Flicker
      if (light) {
        light.intensity = config.diyaIntensity * (0.7 + Math.sin(t.current * 3.5 + d.phase) * 0.3);
      }
    });
  });

  return (
    <group>
      {diyaData.map((d, i) => (
        <group
          key={i}
          ref={(el) => { refs.current[i] = el; }}
          position={[d.x, -1.4, d.z]}
        >
          {/* Clay bowl */}
          <mesh>
            <cylinderGeometry args={[0.12, 0.08, 0.06, 12]} />
            <meshStandardMaterial color="#8b4513" roughness={0.9} />
          </mesh>
          {/* Flame */}
          <mesh position={[0, 0.12, 0]}>
            <coneGeometry args={[0.04, 0.18, 8]} />
            <meshStandardMaterial
              color="#ff8c00"
              emissive="#ff4500"
              emissiveIntensity={4}
              toneMapped={false}
              transparent
              opacity={0.9}
            />
          </mesh>
          <pointLight
            ref={(el) => { lightRefs.current[i] = el; }}
            color="#ff8c00"
            intensity={config.diyaIntensity}
            distance={3}
            decay={2}
          />
        </group>
      ))}
    </group>
  );
}

// ─── Crowd Silhouettes ────────────────────────────────────────────────────────

function CrowdPerson({
  position,
  color,
  type,
  phase,
  config,
}: {
  position: [number, number, number];
  color: string;
  type: "standing" | "offering" | "praying" | "sitting";
  phase: number;
  config: TODConfig;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const armLRef  = useRef<THREE.Mesh>(null);
  const armRRef  = useRef<THREE.Mesh>(null);
  const t = useRef(phase);

  useFrame((_, delta) => {
    t.current += delta;
    if (!groupRef.current) return;

    // Gentle sway
    groupRef.current.rotation.z = Math.sin(t.current * 0.6 + phase) * 0.04;

    if (type === "offering" && config.crowdActivity === "arghya") {
      // Arms raise and lower offering water
      const armAngle = -Math.PI * 0.5 + Math.sin(t.current * 0.5 + phase) * 0.4;
      if (armLRef.current) armLRef.current.rotation.z = armAngle;
      if (armRRef.current) armRRef.current.rotation.z = -armAngle;
    } else if (type === "praying") {
      // Hands folded, slight bow
      groupRef.current.rotation.x = Math.sin(t.current * 0.3 + phase) * 0.08;
    }
  });

  const h = type === "sitting" ? 0.5 : 1.0;
  const bodyH = type === "sitting" ? 0.4 : 0.7;

  return (
    <group ref={groupRef} position={position}>
      {/* Body */}
      <mesh position={[0, bodyH * 0.5, 0]} castShadow>
        <cylinderGeometry args={[0.12, 0.14, bodyH, 8]} />
        <meshStandardMaterial color={color} roughness={0.9} />
      </mesh>
      {/* Head */}
      <mesh position={[0, bodyH + 0.14, 0]} castShadow>
        <sphereGeometry args={[0.14, 10, 10]} />
        <meshStandardMaterial color="#c8956c" roughness={0.8} />
      </mesh>
      {/* Left arm */}
      <mesh
        ref={armLRef}
        position={[-0.16, bodyH * 0.7, 0]}
        rotation={[0, 0, type === "offering" ? -Math.PI * 0.5 : -0.3]}
        castShadow
      >
        <cylinderGeometry args={[0.04, 0.04, 0.4, 6]} />
        <meshStandardMaterial color="#c8956c" roughness={0.8} />
      </mesh>
      {/* Right arm */}
      <mesh
        ref={armRRef}
        position={[0.16, bodyH * 0.7, 0]}
        rotation={[0, 0, type === "offering" ? Math.PI * 0.5 : 0.3]}
        castShadow
      >
        <cylinderGeometry args={[0.04, 0.04, 0.4, 6]} />
        <meshStandardMaterial color="#c8956c" roughness={0.8} />
      </mesh>
      {/* Water vessel for offering type */}
      {type === "offering" && (
        <mesh position={[0, bodyH + 0.3, 0]}>
          <cylinderGeometry args={[0.06, 0.04, 0.15, 8]} />
          <meshStandardMaterial color="#b8860b" roughness={0.7} metalness={0.3} />
        </mesh>
      )}
    </group>
  );
}

function Crowd({ config }: { config: TODConfig }) {
  const SARI_COLORS = [
    "#e74c3c","#8e44ad","#f39c12","#27ae60","#2980b9",
    "#e91e63","#ff5722","#009688","#ff9800","#673ab7",
    "#c0392b","#16a085","#d35400","#7f8c8d","#2c3e50",
  ];

  const people = useMemo(() => {
    const types: Array<"standing" | "offering" | "praying" | "sitting"> =
      config.crowdActivity === "arghya"
        ? ["offering","offering","praying","standing","offering","praying"]
        : ["standing","praying","sitting","standing","praying"];

    return Array.from({ length: 40 }, (_, i) => ({
      x: (Math.random() - 0.5) * 26,
      step: Math.floor(Math.random() * 5),
      color: SARI_COLORS[Math.floor(Math.random() * SARI_COLORS.length)],
      type: types[Math.floor(Math.random() * types.length)],
      phase: Math.random() * Math.PI * 2,
    }));
  }, [config.crowdActivity]);

  // Step Y positions
  const stepYs = [-1.24, -1.02, -0.80, -0.58, -0.36];
  const stepZs = [1.5, 3.5, 5.2, 6.8, 8.2];

  return (
    <group>
      {people.map((p, i) => (
        <CrowdPerson
          key={i}
          position={[p.x, stepYs[p.step], stepZs[p.step]]}
          color={p.color}
          type={p.type}
          phase={p.phase}
          config={config}
        />
      ))}
    </group>
  );
}

// ─── Birds ────────────────────────────────────────────────────────────────────

function Bird({ startX, startY, startZ, speed }: { startX: number; startY: number; startZ: number; speed: number }) {
  const groupRef = useRef<THREE.Group>(null);
  const wingLRef = useRef<THREE.Mesh>(null);
  const wingRRef = useRef<THREE.Mesh>(null);
  const t = useRef(Math.random() * Math.PI * 2);

  useFrame((_, delta) => {
    t.current += delta;
    if (!groupRef.current) return;
    groupRef.current.position.x += speed * delta * 8;
    groupRef.current.position.y = startY + Math.sin(t.current * 0.8) * 0.3;
    if (groupRef.current.position.x > 30) groupRef.current.position.x = -30;
    // Wing flap
    const flapAngle = Math.sin(t.current * 5) * 0.5;
    if (wingLRef.current) wingLRef.current.rotation.z = flapAngle;
    if (wingRRef.current) wingRRef.current.rotation.z = -flapAngle;
  });

  return (
    <group ref={groupRef} position={[startX, startY, startZ]}>
      {/* Body */}
      <mesh>
        <sphereGeometry args={[0.08, 6, 6]} />
        <meshStandardMaterial color="#1a1208" />
      </mesh>
      {/* Left wing */}
      <mesh ref={wingLRef} position={[-0.15, 0, 0]} rotation={[0, 0, 0.3]}>
        <boxGeometry args={[0.3, 0.04, 0.12]} />
        <meshStandardMaterial color="#1a1208" />
      </mesh>
      {/* Right wing */}
      <mesh ref={wingRRef} position={[0.15, 0, 0]} rotation={[0, 0, -0.3]}>
        <boxGeometry args={[0.3, 0.04, 0.12]} />
        <meshStandardMaterial color="#1a1208" />
      </mesh>
    </group>
  );
}

// ─── Twinkling Stars (3D points) ─────────────────────────────────────────────

function TwinklingStars({ config }: { config: TODConfig }) {
  const show = config.showMoon; // only at night / predawn
  const count = 300;

  const { positions, phases, speeds } = useMemo(() => {
    const pos = new Float32Array(count * 3);
    const ph  = new Float32Array(count);
    const sp  = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      // Spread stars across upper hemisphere
      const theta = Math.random() * Math.PI * 2;
      const phi   = Math.random() * Math.PI * 0.5;
      const r     = 45 + Math.random() * 5;
      pos[i * 3]     = r * Math.sin(phi) * Math.cos(theta);
      pos[i * 3 + 1] = r * Math.cos(phi) * 0.6 + 5;
      pos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
      ph[i] = Math.random() * Math.PI * 2;
      sp[i] = 0.5 + Math.random() * 2.5;
    }
    return { positions: pos, phases: ph, speeds: sp };
  }, []);

  const geoRef  = useRef<THREE.BufferGeometry>(null);
  const matRef  = useRef<THREE.PointsMaterial>(null);
  const t = useRef(0);

  useFrame((_, delta) => {
    t.current += delta;
    if (!matRef.current || !show) return;
    // Pulse overall opacity to simulate collective twinkle
    matRef.current.opacity = 0.6 + Math.sin(t.current * 0.8) * 0.15;
  });

  if (!show) return null;

  return (
    <points>
      <bufferGeometry ref={geoRef}>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial
        ref={matRef}
        color="#fffde0"
        size={0.18}
        sizeAttenuation
        transparent
        opacity={0.75}
        depthWrite={false}
      />
    </points>
  );
}

// ─── Birds ────────────────────────────────────────────────────────────────────

function Birds({ config }: { config: TODConfig }) {
  const birdData = useMemo(() =>
    Array.from({ length: config.birdCount }, () => ({
      startX: (Math.random() - 0.5) * 50,
      startY: 4 + Math.random() * 8,
      startZ: -5 - Math.random() * 10,
      speed: (0.8 + Math.random() * 1.2) * (Math.random() > 0.5 ? 1 : -1),
    })),
  [config.birdCount]);

  return (
    <group>
      {birdData.map((b, i) => (
        <Bird key={i} {...b} />
      ))}
    </group>
  );
}

// ─── Lotus Flowers ────────────────────────────────────────────────────────────

function LotusFlower({ position }: { position: [number, number, number] }) {
  const groupRef = useRef<THREE.Group>(null);
  const t = useRef(Math.random() * Math.PI * 2);

  useFrame((_, delta) => {
    t.current += delta * 0.3;
    if (groupRef.current) {
      groupRef.current.position.y = position[1] + Math.sin(t.current) * 0.04;
      groupRef.current.rotation.y += delta * 0.05;
    }
  });

  const petalCount = 8;
  return (
    <group ref={groupRef} position={position}>
      {/* Petals */}
      {Array.from({ length: petalCount }, (_, i) => {
        const angle = (i / petalCount) * Math.PI * 2;
        return (
          <mesh
            key={i}
            position={[Math.cos(angle) * 0.18, 0.02, Math.sin(angle) * 0.18]}
            rotation={[Math.PI * 0.15, angle, 0]}
          >
            <sphereGeometry args={[0.1, 6, 6]} />
            <meshStandardMaterial
              color="#ffb6c1"
              emissive="#ff69b4"
              emissiveIntensity={0.3}
              roughness={0.6}
            />
          </mesh>
        );
      })}
      {/* Center */}
      <mesh position={[0, 0.05, 0]}>
        <sphereGeometry args={[0.08, 8, 8]} />
        <meshStandardMaterial color="#ffd700" emissive="#ffaa00" emissiveIntensity={0.5} />
      </mesh>
      {/* Pad */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]}>
        <circleGeometry args={[0.28, 12]} />
        <meshStandardMaterial color="#2d6a2d" roughness={0.9} />
      </mesh>
    </group>
  );
}

function Lotuses() {
  const positions = useMemo<[number, number, number][]>(() =>
    Array.from({ length: 12 }, () => [
      (Math.random() - 0.5) * 22,
      -1.42,
      -2 - Math.random() * 8,
    ]),
  []);

  return (
    <group>
      {positions.map((pos, i) => (
        <LotusFlower key={i} position={pos} />
      ))}
    </group>
  );
}

// ─── Scene Environment ────────────────────────────────────────────────────────

function SceneEnvironment({ config, tod }: { config: TODConfig; tod: TOD }) {
  const { scene } = useThree();

  useEffect(() => {
    scene.fog = new THREE.Fog(config.fogColor, config.fogNear, config.fogFar);
    scene.background = new THREE.Color(config.skyTop);
  }, [scene, config]);

  return (
    <>
      <ambientLight color={config.ambientColor} intensity={config.ambientIntensity} />
      <SkyDome config={config} />
      <TwinklingStars config={config} />
      <CelestialBody config={config} tod={tod} />
      <River config={config} />
      <GhatSteps />
      <Temple />
      {/* Torch pillars on ghat */}
      {([-10, -5, 0, 5, 10] as number[]).map((x, i) => (
        <TorchPillar key={i} position={[x, -0.25, 9.5]} config={config} />
      ))}
      <FloatingDiyas config={config} />
      <Crowd config={config} />
      <Birds config={config} />
      <Lotuses />
    </>
  );
}

// ─── Main Export ──────────────────────────────────────────────────────────────

export default function GhatScene() {
  const tod = getTOD();
  const config = TOD_CONFIGS[tod];
  const mouse = useRef({ x: 0.5, y: 0.5 });

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      mouse.current = { x: e.clientX / window.innerWidth, y: e.clientY / window.innerHeight };
    };
    const onTouch = (e: TouchEvent) => {
      if (e.touches[0]) {
        mouse.current = { x: e.touches[0].clientX / window.innerWidth, y: e.touches[0].clientY / window.innerHeight };
      }
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("touchmove", onTouch, { passive: true });
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("touchmove", onTouch);
    };
  }, []);

  return (
    <div className="w-full h-full" aria-hidden="true">
      <Canvas
        camera={{ position: [0, 2.5, 14], fov: 58, near: 0.1, far: 200 }}
        shadows
        gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
        onCreated={({ gl }) => { gl.setClearColor(0x000000, 0); }}
        dpr={[1, 1.5]}
        style={{ width: "100%", height: "100%", background: "transparent" }}
      >
        <Suspense fallback={null}>
          <CameraController mouse={mouse} />
          <SceneEnvironment config={config} tod={tod} />
        </Suspense>
      </Canvas>
    </div>
  );
}