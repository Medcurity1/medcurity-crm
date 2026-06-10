import { useEffect, useRef } from "react";

/**
 * Canvas fireworks. Two modes:
 *   ambient — an occasional rocket + burst every few seconds (login
 *             backdrop, July 1-10 and Dec 29-31)
 *   show    — rapid continuous bursts for a fixed duration (the one-time
 *             New Year celebration after login)
 * Decorative only; disabled under prefers-reduced-motion.
 */
interface FireworksCanvasProps {
  mode?: "ambient" | "show";
  className?: string;
}

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  decay: number;
  color: string;
  px: number;
  py: number;
}

interface Rocket {
  x: number;
  y: number;
  vy: number;
  targetY: number;
  color: string;
}

const COLORS = [
  "#ffd957",
  "#7cc4ff",
  "#ff7ac8",
  "#9effa3",
  "#ffffff",
  "#ffae5e",
  "#c9a3ff",
];

function rand(min: number, max: number) {
  return min + Math.random() * (max - min);
}

export function FireworksCanvas({ mode = "ambient", className }: FireworksCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let w = 0;
    let h = 0;
    let raf = 0;
    let sparks: Spark[] = [];
    let rockets: Rocket[] = [];
    let nextLaunch = performance.now() + (mode === "show" ? 100 : rand(400, 1500));

    function resize() {
      if (!canvas) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();

    function explode(x: number, y: number, color: string) {
      const n = mode === "show" ? Math.floor(rand(55, 85)) : Math.floor(rand(38, 60));
      // Mostly single-color bursts with the occasional multicolor one
      const multi = Math.random() < 0.25;
      for (let i = 0; i < n; i++) {
        const angle = (Math.PI * 2 * i) / n + rand(-0.05, 0.05);
        const speed = rand(1.2, mode === "show" ? 4.6 : 3.6);
        sparks.push({
          x,
          y,
          px: x,
          py: y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life: 1,
          decay: rand(0.008, 0.018),
          color: multi ? COLORS[Math.floor(Math.random() * COLORS.length)] : color,
        });
      }
    }

    function launch() {
      const color = COLORS[Math.floor(Math.random() * COLORS.length)];
      rockets.push({
        x: rand(w * 0.12, w * 0.88),
        y: h + 10,
        vy: rand(-7.5, -5.8),
        targetY: rand(h * 0.12, h * 0.45),
        color,
      });
    }

    function frame(now: number) {
      ctx!.clearRect(0, 0, w, h);

      if (now >= nextLaunch) {
        launch();
        if (mode === "show" && Math.random() < 0.5) launch();
        nextLaunch =
          now + (mode === "show" ? rand(280, 650) : rand(2600, 5200));
      }

      rockets = rockets.filter((r) => {
        r.y += r.vy;
        r.vy += 0.04;
        ctx!.globalAlpha = 0.9;
        ctx!.fillStyle = r.color;
        ctx!.beginPath();
        ctx!.arc(r.x, r.y, 1.6, 0, Math.PI * 2);
        ctx!.fill();
        if (r.y <= r.targetY || r.vy >= -1) {
          explode(r.x, r.y, r.color);
          return false;
        }
        return true;
      });

      sparks = sparks.filter((s) => {
        s.px = s.x;
        s.py = s.y;
        s.x += s.vx;
        s.y += s.vy;
        s.vy += 0.028;
        s.vx *= 0.985;
        s.vy *= 0.992;
        s.life -= s.decay;
        if (s.life <= 0) return false;
        ctx!.globalAlpha = Math.max(0, s.life);
        ctx!.strokeStyle = s.color;
        ctx!.lineWidth = s.life * 2;
        ctx!.lineCap = "round";
        ctx!.beginPath();
        ctx!.moveTo(s.px, s.py);
        ctx!.lineTo(s.x, s.y);
        ctx!.stroke();
        return true;
      });

      ctx!.globalAlpha = 1;
      raf = requestAnimationFrame(frame);
    }

    raf = requestAnimationFrame(frame);
    window.addEventListener("resize", resize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [mode]);

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
