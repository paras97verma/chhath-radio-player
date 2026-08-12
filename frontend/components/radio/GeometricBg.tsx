"use client";

/**
 * GeometricBg — Chhath-vibe ambient particle overlay.
 *
 * Lightweight canvas animation that sits over the background image
 * without obscuring it. Renders:
 *   - Golden sparkles (twinkling stars / diya sparks)
 *   - Light drizzle drops (thin vertical streaks)
 *   - Floating marigold petals
 *   - Occasional flame flickers near bottom
 *
 * All elements are low-opacity so the wallpaper background shows through.
 */

import { useEffect, useRef } from "react";

interface Sparkle {
  x: number;
  y: number;
  size: number;
  alpha: number;
  alphaDir: number;
  speed: number;
  color: string;
}

interface Drop {
  x: number;
  y: number;
  len: number;
  speed: number;
  alpha: number;
}

interface Petal {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rotation: number;
  rotSpeed: number;
  size: number;
  alpha: number;
  color: string;
}

const SPARKLE_COLORS = ["#f5c842", "#ffd700", "#ffe066", "#ffb347", "#fff8dc"];
const PETAL_COLORS = ["#f5c842", "#e8860a", "#ff9933", "#ffcc44"];

export default function GeometricBg() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let W = window.innerWidth;
    let H = window.innerHeight;
    canvas.width = W;
    canvas.height = H;

    // ── Sparkles ──────────────────────────────────────────────────────────────
    const sparkles: Sparkle[] = Array.from({ length: 80 }, () => ({
      x: Math.random() * W,
      y: Math.random() * H,
      size: 1 + Math.random() * 2.5,
      alpha: Math.random(),
      alphaDir: Math.random() > 0.5 ? 1 : -1,
      speed: 0.008 + Math.random() * 0.018,
      color: SPARKLE_COLORS[Math.floor(Math.random() * SPARKLE_COLORS.length)],
    }));

    // ── Rain drops ────────────────────────────────────────────────────────────
    const drops: Drop[] = Array.from({ length: 60 }, () => ({
      x: Math.random() * W,
      y: Math.random() * H,
      len: 8 + Math.random() * 18,
      speed: 1.5 + Math.random() * 2.5,
      alpha: 0.04 + Math.random() * 0.1,
    }));

    // ── Petals ────────────────────────────────────────────────────────────────
    const petals: Petal[] = Array.from({ length: 18 }, () => ({
      x: Math.random() * W,
      y: Math.random() * H,
      vx: (Math.random() - 0.5) * 0.4,
      vy: 0.3 + Math.random() * 0.5,
      rotation: Math.random() * Math.PI * 2,
      rotSpeed: (Math.random() - 0.5) * 0.03,
      size: 4 + Math.random() * 6,
      alpha: 0.15 + Math.random() * 0.25,
      color: PETAL_COLORS[Math.floor(Math.random() * PETAL_COLORS.length)],
    }));

    let rafId: number;

    function drawSparkle(s: Sparkle) {
      ctx!.save();
      ctx!.globalAlpha = Math.max(0, Math.min(1, s.alpha)) * 0.7;
      ctx!.fillStyle = s.color;
      ctx!.shadowColor = s.color;
      ctx!.shadowBlur = s.size * 3;
      ctx!.beginPath();
      ctx!.arc(s.x, s.y, s.size, 0, Math.PI * 2);
      ctx!.fill();
      // Cross flare
      ctx!.globalAlpha = Math.max(0, Math.min(1, s.alpha)) * 0.3;
      ctx!.strokeStyle = s.color;
      ctx!.lineWidth = 0.5;
      const fl = s.size * 3;
      ctx!.beginPath();
      ctx!.moveTo(s.x - fl, s.y);
      ctx!.lineTo(s.x + fl, s.y);
      ctx!.moveTo(s.x, s.y - fl);
      ctx!.lineTo(s.x, s.y + fl);
      ctx!.stroke();
      ctx!.restore();
    }

    function drawDrop(d: Drop) {
      ctx!.save();
      ctx!.globalAlpha = d.alpha;
      ctx!.strokeStyle = "rgba(180,220,255,0.6)";
      ctx!.lineWidth = 0.8;
      ctx!.beginPath();
      ctx!.moveTo(d.x, d.y);
      ctx!.lineTo(d.x - 1, d.y + d.len);
      ctx!.stroke();
      ctx!.restore();
    }

    function drawPetal(p: Petal) {
      ctx!.save();
      ctx!.globalAlpha = p.alpha;
      ctx!.translate(p.x, p.y);
      ctx!.rotate(p.rotation);
      ctx!.fillStyle = p.color;
      ctx!.shadowColor = p.color;
      ctx!.shadowBlur = 4;
      // Simple ellipse petal
      ctx!.beginPath();
      ctx!.ellipse(0, 0, p.size * 0.4, p.size, 0, 0, Math.PI * 2);
      ctx!.fill();
      ctx!.restore();
    }

    function animate() {
      ctx!.clearRect(0, 0, W, H);

      // Update & draw sparkles
      for (const s of sparkles) {
        s.alpha += s.alphaDir * s.speed;
        if (s.alpha >= 1) { s.alpha = 1; s.alphaDir = -1; }
        if (s.alpha <= 0) {
          s.alpha = 0;
          s.alphaDir = 1;
          // Respawn at random position
          s.x = Math.random() * W;
          s.y = Math.random() * H;
        }
        drawSparkle(s);
      }

      // Update & draw rain drops
      for (const d of drops) {
        d.y += d.speed;
        if (d.y > H + d.len) {
          d.y = -d.len;
          d.x = Math.random() * W;
        }
        drawDrop(d);
      }

      // Update & draw petals
      for (const p of petals) {
        p.x += p.vx + Math.sin(p.y * 0.01) * 0.3;
        p.y += p.vy;
        p.rotation += p.rotSpeed;
        if (p.y > H + p.size) {
          p.y = -p.size;
          p.x = Math.random() * W;
        }
        if (p.x < -p.size) p.x = W + p.size;
        if (p.x > W + p.size) p.x = -p.size;
        drawPetal(p);
      }

      rafId = requestAnimationFrame(animate);
    }

    animate();

    const handleResize = () => {
      W = window.innerWidth;
      H = window.innerHeight;
      canvas.width = W;
      canvas.height = H;
    };
    window.addEventListener("resize", handleResize);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 w-full h-full pointer-events-none"
      style={{ zIndex: 5 }}
      aria-hidden="true"
    />
  );
}