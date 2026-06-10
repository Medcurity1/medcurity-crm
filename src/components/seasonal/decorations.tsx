import { useEffect, useRef } from "react";

/**
 * Static (and one not-so-static) SVG decorations for the seasonal login
 * backdrops. All purely decorative, pointer-events none.
 */

export function PumpkinCorners() {
  return (
    <>
      <svg
        viewBox="0 0 120 80"
        aria-hidden="true"
        style={{ position: "absolute", left: 8, bottom: 0, width: 130, pointerEvents: "none" }}
      >
        <g transform="translate(36 46)">
          <path d="M-3 -22 q2 -8 9 -9 q-3 6 -2 10 z" fill="#5a7a36" />
          <ellipse cx="0" cy="0" rx="30" ry="22" fill="#d96c24" />
          <ellipse cx="-13" cy="0" rx="13" ry="21" fill="none" stroke="#b8531a" strokeWidth="2" />
          <ellipse cx="13" cy="0" rx="13" ry="21" fill="none" stroke="#b8531a" strokeWidth="2" />
          <ellipse cx="0" cy="0" rx="6" ry="22" fill="none" stroke="#e88a48" strokeWidth="2" />
        </g>
        <g transform="translate(88 56) rotate(8)">
          <path d="M-2 -16 q1 -6 7 -7 q-3 5 -2 8 z" fill="#5a7a36" />
          <ellipse cx="0" cy="0" rx="21" ry="15" fill="#e8852f" />
          <ellipse cx="-9" cy="0" rx="9" ry="14" fill="none" stroke="#c2611f" strokeWidth="1.6" />
          <ellipse cx="9" cy="0" rx="9" ry="14" fill="none" stroke="#c2611f" strokeWidth="1.6" />
        </g>
      </svg>
      <svg
        viewBox="0 0 90 70"
        aria-hidden="true"
        style={{ position: "absolute", right: 10, bottom: 0, width: 95, pointerEvents: "none" }}
      >
        <g transform="translate(45 44) rotate(-6)">
          <path d="M-2 -19 q1 -7 8 -8 q-3 5 -2 9 z" fill="#5a7a36" />
          <ellipse cx="0" cy="0" rx="26" ry="19" fill="#cc6420" />
          <ellipse cx="-11" cy="0" rx="11" ry="18" fill="none" stroke="#a84e16" strokeWidth="1.8" />
          <ellipse cx="11" cy="0" rx="11" ry="18" fill="none" stroke="#a84e16" strokeWidth="1.8" />
          <ellipse cx="0" cy="0" rx="5" ry="19" fill="none" stroke="#df8341" strokeWidth="1.8" />
        </g>
      </svg>
    </>
  );
}

export function ShamrockCorners() {
  const leaf = (rot: number) => (
    <g transform={`rotate(${rot})`}>
      <path
        d="M0 -4 C-7 -16, -20 -10, -14 -1 C-20 8, -7 14, 0 4 Z"
        fill="#2f9e4f"
        transform="scale(0.9)"
      />
    </g>
  );
  const shamrock = (x: number, y: number, s: number, rot: number) => (
    <g transform={`translate(${x} ${y}) scale(${s}) rotate(${rot})`}>
      {leaf(0)}
      {leaf(120)}
      {leaf(240)}
      <path d="M0 2 q3 12 8 16" fill="none" stroke="#23803c" strokeWidth="2.4" strokeLinecap="round" />
    </g>
  );
  return (
    <>
      <svg
        viewBox="0 0 130 90"
        aria-hidden="true"
        style={{ position: "absolute", left: 6, bottom: 4, width: 130, pointerEvents: "none" }}
      >
        {shamrock(40, 50, 1.15, -10)}
        {shamrock(86, 64, 0.75, 18)}
      </svg>
      <svg
        viewBox="0 0 100 80"
        aria-hidden="true"
        style={{ position: "absolute", right: 8, top: 8, width: 95, pointerEvents: "none" }}
      >
        {shamrock(52, 38, 0.85, 12)}
      </svg>
    </>
  );
}

export function FlowerCorners() {
  const flower = (x: number, y: number, s: number, petal: string, center: string) => (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      {[0, 60, 120, 180, 240, 300].map((r) => (
        <ellipse key={r} cx="0" cy="-9" rx="4.6" ry="8" fill={petal} transform={`rotate(${r})`} />
      ))}
      <circle cx="0" cy="0" r="4.5" fill={center} />
    </g>
  );
  return (
    <>
      <svg
        viewBox="0 0 140 90"
        aria-hidden="true"
        style={{ position: "absolute", left: 6, bottom: 0, width: 140, pointerEvents: "none" }}
      >
        <path d="M30 88 q2 -22 6 -30 M64 88 q-2 -16 -4 -22 M100 88 q2 -14 5 -20" stroke="#5d8c4a" strokeWidth="2.5" fill="none" strokeLinecap="round" />
        {flower(37, 52, 1.1, "#f3a8c4", "#e8b53a")}
        {flower(61, 62, 0.8, "#fdfdfd", "#e8b53a")}
        {flower(106, 64, 0.95, "#c9a3e8", "#e8b53a")}
      </svg>
      <svg
        viewBox="0 0 100 70"
        aria-hidden="true"
        style={{ position: "absolute", right: 8, bottom: 0, width: 100, pointerEvents: "none" }}
      >
        <path d="M40 68 q2 -16 4 -22 M66 68 q-1 -12 -2 -16" stroke="#5d8c4a" strokeWidth="2.2" fill="none" strokeLinecap="round" />
        {flower(45, 42, 0.9, "#f5c96e", "#b8762e")}
        {flower(67, 50, 0.7, "#f3a8c4", "#e8b53a")}
      </svg>
    </>
  );
}

export function ChristmasCorners() {
  return (
    <>
      <svg
        viewBox="0 0 130 150"
        aria-hidden="true"
        style={{ position: "absolute", left: 10, bottom: 0, width: 120, pointerEvents: "none" }}
      >
        <rect x="56" y="124" width="14" height="18" fill="#6b4a2f" />
        <path d="M63 8 L92 56 L76 54 L100 96 L82 93 L106 134 L20 134 L44 93 L26 96 L50 54 L34 56 Z" fill="#1f7a3d" />
        <path d="M63 8 L92 56 L76 54 L63 32 Z" fill="#2b9450" opacity="0.6" />
        <path d="M63 2 l3.5 7.5 8 1 -5.8 5.6 1.4 8 -7.1 -3.8 -7.1 3.8 1.4 -8 -5.8 -5.6 8 -1 Z" fill="#f5c542" />
        <circle cx="52" cy="70" r="3.4" fill="#e23b3b" />
        <circle cx="76" cy="86" r="3.4" fill="#f5c542" />
        <circle cx="60" cy="108" r="3.4" fill="#7cc4ff" />
        <circle cx="88" cy="118" r="3.4" fill="#e23b3b" />
        <circle cx="40" cy="116" r="3.4" fill="#f5c542" />
      </svg>
      <svg
        viewBox="0 0 150 90"
        aria-hidden="true"
        style={{ position: "absolute", right: 10, bottom: 0, width: 140, pointerEvents: "none" }}
      >
        <g>
          <rect x="14" y="38" width="46" height="44" rx="3" fill="#c4382e" />
          <rect x="33" y="38" width="8" height="44" fill="#f5c542" />
          <rect x="14" y="54" width="46" height="7" fill="#f5c542" />
          <path d="M37 38 q-9 -13 -16 -5 q-4 6 8 7 q-14 1 -7 8" fill="none" stroke="#f5c542" strokeWidth="3" strokeLinecap="round" />
        </g>
        <g>
          <rect x="68" y="50" width="36" height="32" rx="3" fill="#2563a8" />
          <rect x="82" y="50" width="8" height="32" fill="#ffffff" />
          <rect x="68" y="61" width="36" height="6" fill="#ffffff" />
        </g>
        <g>
          <rect x="110" y="60" width="26" height="22" rx="3" fill="#1f7a3d" />
          <rect x="120" y="60" width="6" height="22" fill="#e8b53a" />
        </g>
      </svg>
    </>
  );
}

/**
 * A bat that appears at unpredictable times (every ~12-45s) and flies
 * across the screen from a random side at a random height, with flapping
 * wings. October only.
 */
export function BatFlyby() {
  const elRef = useRef<HTMLDivElement | null>(null);
  const leftWingRef = useRef<SVGPathElement | null>(null);
  const rightWingRef = useRef<SVGPathElement | null>(null);

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    function scheduleNext(firstTime: boolean) {
      const delay = firstTime ? 3000 + Math.random() * 9000 : 12000 + Math.random() * 33000;
      timer = setTimeout(fly, delay);
    }

    function fly() {
      if (cancelled) return;
      const el = elRef.current;
      if (!el) return;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const fromLeft = Math.random() < 0.5;
      const baseY = vh * (0.08 + Math.random() * 0.5);
      const amp = 24 + Math.random() * 42;
      const dur = 5200 + Math.random() * 2600;
      const start = performance.now();
      el.style.opacity = "1";
      // Face the direction of travel
      el.style.setProperty("--flip", fromLeft ? "1" : "-1");

      function step(now: number) {
        const t = Math.min(1, (now - start) / dur);
        const x = fromLeft ? -70 + t * (vw + 140) : vw + 70 - t * (vw + 140);
        const y = baseY + Math.sin(t * Math.PI * 3 + 1) * amp;
        el!.style.transform = `translate(${x}px, ${y}px) scaleX(var(--flip))`;
        const flap = Math.sin(now / 70);
        if (leftWingRef.current && rightWingRef.current) {
          leftWingRef.current.setAttribute("transform", `rotate(${flap * 24} 22 16)`);
          rightWingRef.current.setAttribute("transform", `rotate(${-flap * 24} 42 16)`);
        }
        if (t < 1 && !cancelled) {
          raf = requestAnimationFrame(step);
        } else {
          el!.style.opacity = "0";
          if (!cancelled) scheduleNext(false);
        }
      }
      raf = requestAnimationFrame(step);
    }

    scheduleNext(true);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div
      ref={elRef}
      aria-hidden="true"
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: 64,
        height: 34,
        opacity: 0,
        pointerEvents: "none",
        willChange: "transform",
      }}
    >
      <svg viewBox="0 0 64 34" width="64" height="34">
        <path
          ref={leftWingRef}
          d="M22 16 C14 4, 4 4, 1 10 C7 10, 9 13, 8 17 C13 14, 18 15, 22 20 Z"
          fill="#241a33"
        />
        <path
          ref={rightWingRef}
          d="M42 16 C50 4, 60 4, 63 10 C57 10, 55 13, 56 17 C51 14, 46 15, 42 20 Z"
          fill="#241a33"
        />
        <ellipse cx="32" cy="17" rx="7" ry="9" fill="#2d2140" />
        <path d="M28 9 l2.5 -5 2 4.4 M36 9 l-2.5 -5 -2 4.4" fill="#2d2140" />
        <circle cx="29.5" cy="14" r="1.2" fill="#ffd76e" />
        <circle cx="34.5" cy="14" r="1.2" fill="#ffd76e" />
      </svg>
    </div>
  );
}
