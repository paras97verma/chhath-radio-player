"use client";

import { useEffect, useRef, useState, useCallback } from "react";

// ─── Canvas water-pour animation ────────────────────────────────────────────

interface Drop {
  x: number;
  y: number;
  vy: number;
  vx: number;
  r: number;
  life: number;
  maxLife: number;
  alpha: number;
}

interface Ripple {
  x: number;
  y: number;
  r: number;
  maxR: number;
  life: number;
  maxLife: number;
}

function runWaterAnimation(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
  if (!ctx) return () => {};

  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;

  const W = canvas.width;
  const H = canvas.height;

  // Lota button is at left:16px, top:50% of viewport
  // The spout (top of lota when tilted right) is approximately at:
  const lotaCenterX = 16 + 30; // left offset + half button width
  const lotaCenterY = H * 0.5; // vertically centered
  // When tilted right 50deg, the spout (top of lota) moves to the right
  const spoutX = lotaCenterX + 22; // spout shifts right when tilted
  const spoutY = lotaCenterY - 18; // spout is above center

  // Water falls all the way to the bottom of the screen
  const bottomY = H;

  const drops: Drop[] = [];
  const ripples: Ripple[] = [];

  let frame = 0;
  const ANIM_FRAMES = 100;

  let rafId = 0;

  function spawnDrop() {
    // Water falls straight down from spout — high initial velocity to reach bottom
    drops.push({
      x: spoutX + (Math.random() - 0.5) * 5,
      y: spoutY + 5,
      vx: (Math.random() - 0.5) * 0.5,
      vy: 4 + Math.random() * 3,   // strong downward velocity
      r: 2 + Math.random() * 2,
      life: 0,
      maxLife: 200, // long enough to reach bottom
      alpha: 0.9,
    });
  }

  function spawnRipple(x: number) {
    // Small splash at bottom
    ripples.push({
      x: Math.min(Math.max(x, 30), W - 30),
      y: bottomY - 4,
      r: 3,
      maxR: 20 + Math.random() * 12,
      life: 0,
      maxLife: 35,
    });
  }

  // No river drawing — just water drops falling to bottom

  function drawWaterStream(progress: number) {
    if (progress > 0.85) return;
    const streamAlpha =
      Math.min(1, progress / 0.05) *
      Math.min(1, (0.85 - progress) / 0.08);

    // Draw a thin vertical stream from spout down to bottom
    const grad = ctx.createLinearGradient(spoutX, spoutY, spoutX, bottomY);
    grad.addColorStop(0, `rgba(125,211,252,${streamAlpha * 0.7})`);
    grad.addColorStop(0.5, `rgba(96,165,250,${streamAlpha * 0.5})`);
    grad.addColorStop(1, `rgba(59,130,246,${streamAlpha * 0.1})`);
    ctx.save();
    ctx.strokeStyle = grad;
    ctx.lineWidth = 3.5;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(spoutX, spoutY);
    // Slight curve as water falls
    ctx.bezierCurveTo(
      spoutX + 4, spoutY + (bottomY - spoutY) * 0.3,
      spoutX + 2, spoutY + (bottomY - spoutY) * 0.7,
      spoutX, bottomY - 5
    );
    ctx.stroke();
    ctx.restore();
  }

  function animate() {
    ctx.clearRect(0, 0, W, H);

    const progress = Math.min(frame / ANIM_FRAMES, 1);

    drawWaterStream(progress);

    // Spawn drops immediately when animation starts
    if (progress < 0.85 && frame % 2 === 0) {
      spawnDrop();
    }

    // Update & draw drops
    for (let i = drops.length - 1; i >= 0; i--) {
      const d = drops[i];
      d.x += d.vx;
      d.y += d.vy;
      d.vy += 0.22; // gravity pulls down
      d.vx *= 0.98; // slight air resistance
      d.life++;
      d.alpha = 1 - d.life / d.maxLife;

      if (d.y >= bottomY) {
        spawnRipple(d.x);
        drops.splice(i, 1);
        continue;
      }
      if (d.life > d.maxLife) {
        drops.splice(i, 1);
        continue;
      }

      // Draw teardrop shape
      ctx.save();
      ctx.globalAlpha = d.alpha * 0.88;
      const dg = ctx.createRadialGradient(d.x - d.r * 0.3, d.y - d.r * 0.3, 0, d.x, d.y, d.r * 1.2);
      dg.addColorStop(0, "#e0f4ff");
      dg.addColorStop(0.5, "#7dd3fc");
      dg.addColorStop(1, "rgba(74,144,217,0)");
      ctx.fillStyle = dg;
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Update & draw ripples
    for (let i = ripples.length - 1; i >= 0; i--) {
      const rp = ripples[i];
      rp.r += (rp.maxR - rp.r) * 0.1;
      rp.life++;
      if (rp.life > rp.maxLife) {
        ripples.splice(i, 1);
        continue;
      }
      const alpha = (1 - rp.life / rp.maxLife) * 0.7;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = "#93c5fd";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.ellipse(rp.x, rp.y, rp.r, rp.r * 0.32, 0, 0, Math.PI * 2);
      ctx.stroke();
      // Second inner ripple
      if (rp.r > 8) {
        ctx.globalAlpha = alpha * 0.5;
        ctx.beginPath();
        ctx.ellipse(rp.x, rp.y, rp.r * 0.55, rp.r * 0.55 * 0.32, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }

    frame++;

    if (frame < ANIM_FRAMES + 80 || drops.length > 0 || ripples.length > 0) {
      rafId = requestAnimationFrame(animate);
    }
  }

  rafId = requestAnimationFrame(animate);
  return () => cancelAnimationFrame(rafId);
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function JalArghya() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [animating, setAnimating] = useState(false);
  const cleanupRef = useRef<(() => void) | null>(null);

  const handleClick = useCallback(() => {
    if (animating) return;
    setAnimating(true);

    const canvas = canvasRef.current;
    if (!canvas) return;

    cleanupRef.current?.();
    const stop = runWaterAnimation(canvas);
    cleanupRef.current = stop;

    setTimeout(() => {
      setAnimating(false);
    }, 3000);
  }, [animating]);

  useEffect(() => {
    return () => {
      cleanupRef.current?.();
    };
  }, []);

  return (
    <>
      {/* Full-screen canvas for water animation */}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full pointer-events-none"
        style={{
          zIndex: 18,
          opacity: animating ? 1 : 0,
          transition: "opacity 0.4s ease",
          mixBlendMode: "screen",
        }}
      />

      {/* Arghya Dein text button — positioned in layout by parent */}
      <button
        onClick={handleClick}
        aria-label="Offer Jal Arghya to Chhathi Maiya"
        style={{
          cursor: animating ? "default" : "pointer",
          background: animating
            ? "linear-gradient(135deg, rgba(245,200,66,0.25), rgba(125,211,252,0.15))"
            : "rgba(8,2,2,0.55)",
          border: `1px solid ${animating ? "rgba(125,211,252,0.6)" : "rgba(245,200,66,0.35)"}`,
          borderRadius: "20px",
          padding: "5px 14px",
          color: animating ? "#7dd3fc" : "#f5c842",
          fontSize: "12px",
          fontWeight: 600,
          letterSpacing: "0.03em",
          backdropFilter: "blur(8px)",
          transition: "all 0.3s ease",
          whiteSpace: "nowrap",
        }}
      >
        🪔 अर्घ्य दें
      </button>
    </>
  );
}

// ─── Beautiful 3D Lota SVG ───────────────────────────────────────────────────

function LotaSVG({ animating }: { animating: boolean }) {
  return (
    <svg
      width="56"
      height="56"
      viewBox="0 0 56 56"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        {/* Main body — rich brass/copper */}
        <radialGradient id="lg-body" cx="35%" cy="28%" r="70%">
          <stop offset="0%" stopColor="#fff0a0" />
          <stop offset="25%" stopColor="#f5c842" />
          <stop offset="55%" stopColor="#e8860a" />
          <stop offset="80%" stopColor="#b85c00" />
          <stop offset="100%" stopColor="#6b2f00" />
        </radialGradient>

        {/* Neck */}
        <linearGradient id="lg-neck" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#922b21" />
          <stop offset="40%" stopColor="#e74c3c" />
          <stop offset="60%" stopColor="#c0392b" />
          <stop offset="100%" stopColor="#7b241c" />
        </linearGradient>

        {/* Rim */}
        <linearGradient id="lg-rim" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#fff0a0" />
          <stop offset="50%" stopColor="#f5c842" />
          <stop offset="100%" stopColor="#c9a227" />
        </linearGradient>

        {/* Base ring */}
        <linearGradient id="lg-base" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#c9a227" />
          <stop offset="100%" stopColor="#7a5200" />
        </linearGradient>

        {/* Drop shadow */}
        <radialGradient id="lg-shadow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="rgba(0,0,0,0.5)" />
          <stop offset="100%" stopColor="rgba(0,0,0,0)" />
        </radialGradient>

        {/* Water drop */}
        <radialGradient id="lg-water" cx="35%" cy="30%" r="65%">
          <stop offset="0%" stopColor="#e0f4ff" />
          <stop offset="60%" stopColor="#7dd3fc" />
          <stop offset="100%" stopColor="#2563eb" />
        </radialGradient>
      </defs>

      {/* Drop shadow */}
      <ellipse cx="28" cy="52" rx="13" ry="3.5" fill="url(#lg-shadow)" />

      {/* Base ring */}
      <ellipse cx="28" cy="46" rx="11" ry="3" fill="url(#lg-base)" />

      {/* Main body — rounded pot */}
      <path
        d="M28 44 C15 44 9 34 9 25 C9 14 17 8 28 8 C39 8 47 14 47 25 C47 34 41 44 28 44Z"
        fill="url(#lg-body)"
      />

      {/* Body decorative band */}
      <path
        d="M12 30 Q28 34 44 30"
        stroke="rgba(245,200,66,0.35)"
        strokeWidth="1.5"
        fill="none"
        strokeLinecap="round"
      />
      <path
        d="M11 26 Q28 30 45 26"
        stroke="rgba(245,200,66,0.2)"
        strokeWidth="1"
        fill="none"
        strokeLinecap="round"
      />

      {/* 3D highlight — large oval sheen */}
      <ellipse
        cx="20"
        cy="19"
        rx="7"
        ry="10"
        fill="rgba(255,255,255,0.28)"
        transform="rotate(-15 20 19)"
      />
      {/* Small bright specular */}
      <ellipse
        cx="18"
        cy="15"
        rx="3"
        ry="4"
        fill="rgba(255,255,255,0.55)"
        transform="rotate(-15 18 15)"
      />

      {/* Neck */}
      <rect x="22" y="1" width="12" height="10" rx="4" fill="url(#lg-neck)" />
      {/* Neck highlight */}
      <rect x="23" y="2" width="4" height="7" rx="2" fill="rgba(255,255,255,0.2)" />

      {/* Rim / spout */}
      <ellipse cx="28" cy="2" rx="10" ry="3.5" fill="url(#lg-rim)" />
      {/* Rim highlight */}
      <ellipse cx="25" cy="1.2" rx="5" ry="1.8" fill="rgba(255,255,255,0.5)" />

      {/* Water droplet pouring out when animating */}
      {animating && (
        <g>
          <ellipse
            cx="38"
            cy="5"
            rx="3"
            ry="4.5"
            fill="url(#lg-water)"
            opacity="0.9"
          />
          <ellipse
            cx="38"
            cy="4"
            rx="1.5"
            ry="1.5"
            fill="rgba(255,255,255,0.6)"
          />
        </g>
      )}
    </svg>
  );
}