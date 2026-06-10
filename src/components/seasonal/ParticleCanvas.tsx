import { useEffect, useRef } from "react";

/**
 * Generic ambient particle layer for the seasonal login backdrops.
 * One requestAnimationFrame loop drawing lightweight 2D-canvas shapes.
 * Pure decoration: pointer-events none, skipped entirely for users with
 * reduced motion enabled. Mounted only on the login page, so it never
 * costs anything inside the working app.
 */
export type ParticleKind =
  | "snow"
  | "hearts"
  | "petals"
  | "leaves"
  | "fireflies"
  | "stars"
  | "motes";

interface ParticleCanvasProps {
  kind: ParticleKind;
  /** Particle colors; sensible defaults per kind. */
  colors?: string[];
  /** Particle count; sensible default per kind. */
  count?: number;
  className?: string;
}

interface P {
  x: number;
  y: number;
  size: number;
  speed: number;
  drift: number;
  sway: number;
  swaySpeed: number;
  phase: number;
  rot: number;
  rotSpeed: number;
  color: string;
  alpha: number;
  /** fireflies: wander target */
  tx?: number;
  ty?: number;
}

const DEFAULTS: Record<ParticleKind, { count: number; colors: string[] }> = {
  snow: { count: 90, colors: ["#ffffff", "#e8f1fb", "#d4e3f5"] },
  hearts: { count: 22, colors: ["#e8557a", "#f0789a", "#d4356b", "#f5a3bb"] },
  petals: { count: 32, colors: ["#f5c1d4", "#fbdce8", "#f3a8c4", "#fdf0f5"] },
  leaves: { count: 28, colors: ["#c96f2c", "#a8542a", "#d98e3a", "#8a4a22", "#b8762e"] },
  fireflies: { count: 14, colors: ["#ffd76e", "#ffe9a8", "#ffc94d"] },
  stars: { count: 60, colors: ["#ffffff", "#dce8ff", "#fff4d6"] },
  motes: { count: 26, colors: ["#ffffff", "#fff6e3", "#ffeec9"] },
};

function rand(min: number, max: number) {
  return min + Math.random() * (max - min);
}

function drawHeart(ctx: CanvasRenderingContext2D, s: number) {
  ctx.beginPath();
  ctx.moveTo(0, s);
  ctx.bezierCurveTo(-s, s * 0.4, -s * 0.6, -s * 0.5, 0, s * 0.05);
  ctx.bezierCurveTo(s * 0.6, -s * 0.5, s, s * 0.4, 0, s);
  ctx.closePath();
  ctx.fill();
}

function drawLeaf(ctx: CanvasRenderingContext2D, s: number) {
  ctx.beginPath();
  ctx.moveTo(0, -s);
  ctx.quadraticCurveTo(s * 0.75, 0, 0, s);
  ctx.quadraticCurveTo(-s * 0.75, 0, 0, -s);
  ctx.closePath();
  ctx.fill();
}

export function ParticleCanvas({ kind, colors, count, className }: ParticleCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const cfg = DEFAULTS[kind];
    const palette = colors ?? cfg.colors;
    const n = count ?? cfg.count;
    let w = 0;
    let h = 0;
    let raf = 0;
    let particles: P[] = [];

    function resize() {
      if (!canvas) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function spawn(initial: boolean): P {
      const goesUp = kind === "hearts" || kind === "motes";
      return {
        x: rand(0, w),
        y: initial ? rand(0, h) : goesUp ? h + 20 : -20,
        size:
          kind === "snow" ? rand(1.2, 3.4)
          : kind === "hearts" ? rand(5, 11)
          : kind === "petals" ? rand(4, 8)
          : kind === "leaves" ? rand(5, 10)
          : kind === "fireflies" ? rand(1.6, 2.8)
          : kind === "stars" ? rand(0.6, 1.8)
          : rand(1, 2.6),
        speed:
          kind === "snow" ? rand(0.25, 0.9)
          : kind === "hearts" ? rand(0.25, 0.6)
          : kind === "petals" ? rand(0.3, 0.8)
          : kind === "leaves" ? rand(0.45, 1.1)
          : rand(0.06, 0.22),
        drift: rand(-0.15, 0.15),
        sway: kind === "leaves" ? rand(14, 30) : kind === "snow" ? rand(4, 12) : rand(6, 16),
        swaySpeed: rand(0.4, 1.1),
        phase: rand(0, Math.PI * 2),
        rot: rand(0, Math.PI * 2),
        rotSpeed: rand(-0.02, 0.02),
        color: palette[Math.floor(Math.random() * palette.length)],
        alpha:
          kind === "stars" ? rand(0.3, 0.9)
          : kind === "motes" ? rand(0.15, 0.4)
          : rand(0.5, 0.95),
        tx: rand(0, w),
        ty: rand(0, h),
      };
    }

    resize();
    particles = Array.from({ length: n }, () => spawn(true));

    let t = 0;
    function frame() {
      t += 1 / 60;
      ctx!.clearRect(0, 0, w, h);

      for (const p of particles) {
        if (kind === "stars") {
          // Static twinkling field
          const tw = 0.5 + 0.5 * Math.sin(t * p.swaySpeed * 2 + p.phase);
          ctx!.globalAlpha = p.alpha * (0.35 + 0.65 * tw);
          ctx!.fillStyle = p.color;
          ctx!.beginPath();
          ctx!.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          ctx!.fill();
          continue;
        }

        if (kind === "fireflies") {
          // Slow wander toward a drifting target with pulsing glow
          p.tx! += rand(-0.6, 0.6);
          p.ty! += rand(-0.4, 0.4);
          p.x += (p.tx! - p.x) * 0.002 + Math.sin(t * p.swaySpeed + p.phase) * 0.15;
          p.y += (p.ty! - p.y) * 0.002 + Math.cos(t * p.swaySpeed + p.phase) * 0.1;
          if (p.x < -30 || p.x > w + 30 || p.y < -30 || p.y > h + 30) {
            Object.assign(p, spawn(true));
          }
          const pulse = 0.35 + 0.65 * Math.max(0, Math.sin(t * 1.4 + p.phase));
          const g = ctx!.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size * 5);
          g.addColorStop(0, p.color);
          g.addColorStop(1, "rgba(255,200,80,0)");
          ctx!.globalAlpha = pulse * 0.8;
          ctx!.fillStyle = g;
          ctx!.beginPath();
          ctx!.arc(p.x, p.y, p.size * 5, 0, Math.PI * 2);
          ctx!.fill();
          continue;
        }

        const up = kind === "hearts" || kind === "motes";
        p.y += up ? -p.speed : p.speed;
        p.x += p.drift + Math.sin(t * p.swaySpeed + p.phase) * (p.sway / 60);
        p.rot += p.rotSpeed;

        const off = 30;
        if (up ? p.y < -off : p.y > h + off) Object.assign(p, spawn(false));
        if (p.x < -off) p.x = w + off;
        if (p.x > w + off) p.x = -off;

        // Fade hearts/motes near the top so they dissolve, not pop
        let alpha = p.alpha;
        if (up) alpha *= Math.max(0, Math.min(1, p.y / (h * 0.35)));

        ctx!.globalAlpha = alpha;
        ctx!.fillStyle = p.color;

        if (kind === "snow" || kind === "motes") {
          ctx!.beginPath();
          ctx!.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          ctx!.fill();
        } else {
          ctx!.save();
          ctx!.translate(p.x, p.y);
          ctx!.rotate(p.rot);
          if (kind === "hearts") drawHeart(ctx!, p.size);
          else drawLeaf(ctx!, p.size);
          ctx!.restore();
        }
      }

      ctx!.globalAlpha = 1;
      raf = requestAnimationFrame(frame);
    }

    raf = requestAnimationFrame(frame);
    window.addEventListener("resize", resize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [kind, colors, count]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
      }}
      aria-hidden="true"
    />
  );
}
