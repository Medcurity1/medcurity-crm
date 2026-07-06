import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X, Trophy, Zap, Star } from "lucide-react";
import { useAuth } from "@/features/auth/AuthProvider";
import { cn } from "@/lib/utils";
import { pipelineRunner, usePipelineRunnerOpen } from "./store";
import { useTopScores, useSubmitScore, useMyBest, type RunnerScore } from "./api";

/**
 * Pipeline Runner — a hidden endless-runner easter egg.
 *
 * Unlock: triple-click the "Pipeline" nav label. One button (Space / click /
 * tap) to jump — TAP for a short hop, HOLD for a big jump, press again in the
 * air to double-jump. Clear the red "Closed Lost" blocks, grab gold (worth
 * real points now), and bank the biggest pipeline "$ closed" you can.
 *
 * Difficulty scales with your SCORE, not just time: comfortable under 50k,
 * trickier past 50k (taller/wider blocks, tighter spacing), and past 100k the
 * overhead "don't jump" ceiling bars appear. Speed also creeps up the deeper
 * you get, so the top scores stay hard to beat without ever being unfair.
 *
 * Perf: the whole thing only mounts while open, so it costs nothing when idle.
 * The loop is delta-time based and clamps long frames so a background tab
 * can't tunnel the player through an obstacle.
 */

// ---- tuning -------------------------------------------------------------
const GRAVITY = 2700; // px/s^2
const JUMP_V = 940; // px/s — full (held) jump impulse
const JUMP_CUT = 0.5; // releasing early cuts upward velocity → short hop
const MAX_JUMPS = 2; // ground jump + one air jump
const PLAYER_SIZE = 34;
const PLAYER_X_RATIO = 0.16;
const BASE_SPEED = 360; // px/s
const SPEED_RAMP = 12; // px/s added per second of play
const SPEED_TIME_CAP = 820; // time-based ramp tops out here
const HARD_SPEED_CAP = 1010; // absolute ceiling once the score bonus is added
const SCORE_RATE = 1.5; // pipeline "$" per px travelled
const COIN_VALUE = 1500; // each coin is worth a real dent in your score
const TIER1 = 50_000; // score at which things get trickier
const TIER2 = 100_000; // score at which the "don't jump" ceilings appear
const CEIL_GAP = 56; // grounded clearance under a ceiling bar (player is 34)

type ObstacleKind = "ground" | "ceiling";
type Obstacle = { x: number; w: number; h: number; kind: ObstacleKind };
type Coin = { x: number; y: number; taken: boolean; bob: number };
type Popup = { x: number; y: number; vy: number; life: number; text: string };
type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  color: string;
  size: number;
  grav: number;
};

interface GameState {
  W: number;
  H: number;
  groundY: number;
  playerY: number;
  playerVy: number;
  jumps: number;
  squash: number;
  rot: number;
  speed: number;
  elapsed: number;
  distance: number;
  score: number;
  obstacles: Obstacle[];
  coins: Coin[];
  particles: Particle[];
  popups: Popup[];
  flash: { text: string; life: number } | null;
  milestonesPassed: number;
  spawnTimer: number;
  coinTimer: number;
  shake: number;
  groundScroll: number;
  bgScroll: number;
  dead: boolean;
}

type Phase = "ready" | "playing" | "gameover";

function makeState(W: number, H: number): GameState {
  const groundY = H - 52;
  return {
    W,
    H,
    groundY,
    playerY: groundY - PLAYER_SIZE,
    playerVy: 0,
    jumps: 0,
    squash: 0,
    rot: 0,
    speed: BASE_SPEED,
    elapsed: 0,
    distance: 0,
    score: 0,
    obstacles: [],
    coins: [],
    particles: [],
    popups: [],
    flash: null,
    milestonesPassed: 0,
    spawnTimer: 1.1,
    coinTimer: 1.8,
    shake: 0,
    groundScroll: 0,
    bgScroll: 0,
    dead: false,
  };
}

function rand(a: number, b: number) {
  return a + Math.random() * (b - a);
}

function difficultyFor(score: number) {
  if (score >= TIER2) return 2;
  if (score >= TIER1) return 1;
  return 0;
}

// Spawn one obstacle sized for the current difficulty tier. Returns its kind
// so the caller can add extra runway after a "don't jump" ceiling bar.
function spawnObstacle(g: GameState, d: number): ObstacleKind {
  // Overhead "don't jump" bar — only at max difficulty, occasionally.
  if (d >= 2 && Math.random() < 0.16) {
    g.obstacles.push({ x: g.W + 20, w: rand(28, 44), h: 0, kind: "ceiling" });
    return "ceiling";
  }
  let h: number;
  const r = Math.random();
  if (d <= 0) h = r < 0.55 ? 28 : 44;
  else if (d === 1) h = r < 0.42 ? 28 : r < 0.76 ? 44 : 60;
  else h = r < 0.28 ? 30 : r < 0.56 ? 46 : r < 0.82 ? 62 : r < 0.93 ? 84 : 110;
  const wBonus = d >= 2 ? rand(6, 24) : d >= 1 ? rand(2, 12) : 0;
  const w = rand(24, 38) + wBonus + (h > 55 ? 8 : 0);
  g.obstacles.push({ x: g.W + 20, w, h, kind: "ground" });
  return "ground";
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function burst(g: GameState, x: number, y: number, color: string, n: number, power: number) {
  for (let i = 0; i < n; i++) {
    const a = rand(0, Math.PI * 2);
    const s = rand(0.3, 1) * power;
    g.particles.push({
      x,
      y,
      vx: Math.cos(a) * s,
      vy: Math.sin(a) * s - power * 0.3,
      life: rand(0.4, 0.9),
      max: 0.9,
      color,
      size: rand(2, 4.5),
      grav: 900,
    });
  }
}

function fmtMoney(n: number) {
  return "$" + Math.round(n).toLocaleString("en-US");
}

// ---- the modal (only rendered while open) -------------------------------
function GameModal() {
  const { profile } = useAuth();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const gameRef = useRef<GameState | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastRef = useRef<number | null>(null);
  const phaseRef = useRef<Phase>("ready");
  const dprRef = useRef(1);

  const [phase, setPhase] = useState<Phase>("ready");
  const [finalScore, setFinalScore] = useState(0);
  const [submitted, setSubmitted] = useState(false);
  const [newPB, setNewPB] = useState(false);

  const { data: topScores } = useTopScores(true);
  const { data: myBest } = useMyBest(profile?.id);
  const submit = useSubmitScore();

  // Mirror the personal best into a ref so die() can compare the run against
  // the pre-submit best synchronously. `resolved` guards against celebrating a
  // PB before the query has actually loaded the prior best.
  const myBestRef = useRef(0);
  const myBestResolvedRef = useRef(false);
  useEffect(() => {
    if (myBest !== undefined) {
      myBestRef.current = myBest;
      myBestResolvedRef.current = true;
    }
  }, [myBest]);

  const setPhaseBoth = useCallback((p: Phase) => {
    phaseRef.current = p;
    setPhase(p);
  }, []);

  const close = useCallback(() => pipelineRunner.close(), []);

  // Would this score crack the current public top 5?
  const wouldRank = useCallback(
    (score: number) => {
      if (score <= 0) return false;
      const board = topScores ?? [];
      if (board.length < 5) return true;
      return score > board[board.length - 1].score;
    },
    [topScores],
  );

  // ---- sizing (DPR-aware, self-healing) ----
  const resize = useCallback(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;
    const cssW = wrap.clientWidth;
    const cssH = wrap.clientHeight;
    if (cssW === 0 || cssH === 0) return; // not laid out yet — never pin to 0
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    dprRef.current = dpr;
    const bw = Math.round(cssW * dpr);
    const bh = Math.round(cssH * dpr);
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw;
      canvas.height = bh;
    }
    const g = gameRef.current;
    if (g) {
      g.W = cssW;
      g.H = cssH;
      g.groundY = cssH - 52;
      if (phaseRef.current !== "playing") {
        g.playerY = g.groundY - PLAYER_SIZE;
      }
    } else {
      gameRef.current = makeState(cssW, cssH);
    }
  }, []);

  const startRun = useCallback(() => {
    const g = gameRef.current;
    if (!g) return;
    gameRef.current = makeState(g.W, g.H);
    lastRef.current = null;
    setSubmitted(false);
    setNewPB(false);
    setPhaseBoth("playing");
  }, [setPhaseBoth]);

  // Press: start a jump (short by default — hold to make it big).
  const jump = useCallback(() => {
    const g = gameRef.current;
    if (!g || phaseRef.current !== "playing") return;
    if (g.jumps < MAX_JUMPS) {
      g.playerVy = -JUMP_V;
      g.jumps++;
      g.squash = 1;
      burst(g, g.W * PLAYER_X_RATIO, g.groundY, "rgba(196,181,253,0.9)", 8, 220);
    }
  }, []);

  // Release: if still rising, cut the upward velocity → variable jump height.
  const jumpCut = useCallback(() => {
    const g = gameRef.current;
    if (!g || phaseRef.current !== "playing") return;
    if (g.playerVy < 0) g.playerVy *= JUMP_CUT;
  }, []);

  const die = useCallback(() => {
    const g = gameRef.current;
    if (!g || g.dead) return;
    g.dead = true;
    g.shake = 18;
    burst(g, g.W * PLAYER_X_RATIO + PLAYER_SIZE / 2, g.playerY + PLAYER_SIZE / 2, "#fca5a5", 26, 520);
    burst(g, g.W * PLAYER_X_RATIO + PLAYER_SIZE / 2, g.playerY + PLAYER_SIZE / 2, "#fde68a", 16, 380);
    const score = Math.round(g.score);
    setFinalScore(score);
    setNewPB(false);
    setPhaseBoth("gameover");
    if (profile?.id && score > 0) {
      setSubmitted(true);
      // Only celebrate a personal best once the save CONFIRMS and we actually
      // knew the prior best — avoids a false "New personal best!" on a run that
      // ended before the query loaded, or when the insert failed.
      const beatsPrev = myBestResolvedRef.current && score > myBestRef.current;
      submit.mutate(
        { userId: profile.id, playerName: profile.full_name || "Anonymous", score },
        { onSuccess: () => beatsPrev && setNewPB(true) },
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profile?.id, profile?.full_name, setPhaseBoth]);

  // ---- physics ----
  const update = useCallback(
    (dt: number) => {
      const g = gameRef.current;
      if (!g || g.dead) return;

      g.elapsed += dt;
      // Speed: a time ramp that plateaus, plus a gentle score-based boost so
      // the deeper you get the faster it moves (bounded by a hard cap).
      const timeSpeed = Math.min(SPEED_TIME_CAP, BASE_SPEED + g.elapsed * SPEED_RAMP);
      const scoreBoost = Math.max(0, g.score - 40_000) / 1000;
      g.speed = Math.min(HARD_SPEED_CAP, timeSpeed + scoreBoost);
      const dx = g.speed * dt;
      g.distance += dx;
      g.score += dx * SCORE_RATE;
      g.groundScroll = (g.groundScroll + dx) % 48;
      g.bgScroll = (g.bgScroll + dx * 0.25) % 260;

      // Milestone flashes (also teach the player why it just got harder).
      if (g.milestonesPassed === 0 && g.score >= TIER1) {
        g.milestonesPassed = 1;
        g.flash = { text: "Heating up", life: 2.0 };
      } else if (g.milestonesPassed === 1 && g.score >= TIER2) {
        g.milestonesPassed = 2;
        g.flash = { text: "Danger zone — don't jump the ceilings", life: 2.6 };
      }
      if (g.flash) {
        g.flash.life -= dt;
        if (g.flash.life <= 0) g.flash = null;
      }

      // player physics
      g.playerVy += GRAVITY * dt;
      g.playerY += g.playerVy * dt;
      const floor = g.groundY - PLAYER_SIZE;
      if (g.playerY >= floor) {
        if (g.playerVy > 260) {
          g.squash = 1;
          burst(g, g.W * PLAYER_X_RATIO, g.groundY, "rgba(148,163,184,0.7)", 5, 160);
        }
        g.playerY = floor;
        g.playerVy = 0;
        g.jumps = 0;
      }
      g.rot = g.jumps > 0 && g.playerY < floor - 1
        ? g.rot + dt * 9
        : g.rot * (1 - Math.min(1, dt * 12));
      g.squash *= 1 - Math.min(1, dt * 8);

      // spawn obstacles
      g.spawnTimer -= dt;
      if (g.spawnTimer <= 0) {
        const d = difficultyFor(g.score);
        const kind = spawnObstacle(g, d);
        // Gap (seconds) between spawns — floored so a well-timed jump always
        // clears it. Tightens with difficulty but never below the airtime.
        // Floors stay above the full-jump airtime (~0.7s) so there's always
        // time to land between obstacles — including a tall block right before
        // a "don't jump" ceiling bar.
        const floorGap = d >= 2 ? 0.94 : d >= 1 ? 0.9 : 0.95;
        const baseGap = d >= 2 ? rand(1.0, 1.6) : d >= 1 ? rand(1.15, 1.8) : rand(1.35, 2.0);
        let gap = Math.max(floorGap, baseGap - Math.min(g.elapsed * 0.008, 0.4));
        if (kind === "ceiling") gap += 0.55; // guaranteed runway after a ceiling bar
        g.spawnTimer = gap;
      }

      // spawn coins (kept at grabbable heights; optional, never mandatory)
      g.coinTimer -= dt;
      if (g.coinTimer <= 0) {
        const count = Math.floor(rand(2, 5));
        // High coins are rarer at max difficulty so they seldom line up with
        // an overhead "don't jump" ceiling bar and tempt a fatal jump.
        const high = Math.random() < (difficultyFor(g.score) >= 2 ? 0.28 : 0.55);
        const baseY = high ? g.groundY - rand(74, 104) : g.groundY - 26;
        for (let i = 0; i < count; i++) {
          g.coins.push({ x: g.W + 30 + i * 34, y: baseY, taken: false, bob: rand(0, Math.PI * 2) });
        }
        g.coinTimer = rand(1.7, 3.1);
      }

      // move + cull obstacles + collision
      const px = g.W * PLAYER_X_RATIO;
      const pRect = { x: px + 4, y: g.playerY + 3, w: PLAYER_SIZE - 8, h: PLAYER_SIZE - 6 };
      for (const o of g.obstacles) {
        o.x -= dx;
        const overlapX = pRect.x < o.x + o.w && pRect.x + pRect.w > o.x;
        if (!overlapX) continue;
        const hit =
          o.kind === "ceiling"
            ? pRect.y < g.groundY - CEIL_GAP // player rose into the overhead bar
            : pRect.y + pRect.h > g.groundY - o.h; // player didn't clear the block
        if (hit) {
          die();
          return;
        }
      }
      g.obstacles = g.obstacles.filter((o) => o.x + o.w > -10);

      // move + collect coins
      for (const c of g.coins) {
        c.x -= dx;
        c.bob += dt * 6;
        if (!c.taken) {
          const cx = px + PLAYER_SIZE / 2;
          const cy = g.playerY + PLAYER_SIZE / 2;
          if (Math.abs(c.x - cx) < 24 && Math.abs(c.y - cy) < 26) {
            c.taken = true;
            g.score += COIN_VALUE;
            burst(g, c.x, c.y, "#fde68a", 14, 300);
            g.popups.push({ x: c.x, y: c.y - 6, vy: -46, life: 0.95, text: "+" + fmtMoney(COIN_VALUE) });
          }
        }
      }
      g.coins = g.coins.filter((c) => c.x > -20 && !c.taken);

      // popups
      for (const p of g.popups) {
        p.y += p.vy * dt;
        p.life -= dt;
      }
      g.popups = g.popups.filter((p) => p.life > 0);

      // particles
      for (const p of g.particles) {
        p.life -= dt;
        p.vy += p.grav * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
      }
      g.particles = g.particles.filter((p) => p.life > 0);

      if (g.shake > 0) g.shake = Math.max(0, g.shake - dt * 40);
    },
    [die],
  );

  // ---- render ----
  const render = useCallback(() => {
    const canvas = canvasRef.current;
    const g = gameRef.current;
    if (!canvas || !g) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { W, H } = g;
    const dpr = dprRef.current;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    if (g.shake > 0) {
      ctx.translate(rand(-g.shake, g.shake) * 0.4, rand(-g.shake, g.shake) * 0.4);
    }

    // background gradient (violet -> blue -> deep navy)
    const bg = ctx.createLinearGradient(0, 0, 0, H);
    bg.addColorStop(0, "#1e1b4b");
    bg.addColorStop(0.55, "#1e2a5e");
    bg.addColorStop(1, "#0f172a");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // parallax pipeline "stage" columns
    const colW = 130;
    ctx.save();
    for (let i = -1; i < Math.ceil(W / colW) + 1; i++) {
      const x = i * colW - g.bgScroll;
      const grad = ctx.createLinearGradient(0, 0, 0, H);
      grad.addColorStop(0, i % 2 === 0 ? "rgba(129,140,248,0.06)" : "rgba(99,102,241,0.03)");
      grad.addColorStop(1, "rgba(99,102,241,0)");
      ctx.fillStyle = grad;
      ctx.fillRect(x, 0, colW - 10, g.groundY);
      ctx.fillStyle = "rgba(165,180,252,0.10)";
      ctx.fillRect(x, 0, colW - 10, 3);
    }
    ctx.restore();

    // floating dots (depth)
    ctx.fillStyle = "rgba(199,210,254,0.10)";
    for (let i = 0; i < 22; i++) {
      const dxp = (i * 137.5 - g.bgScroll * 1.4) % (W + 40);
      const x = dxp < 0 ? dxp + W + 40 : dxp;
      const y = (i * 53) % (g.groundY - 30) + 14;
      ctx.beginPath();
      ctx.arc(x, y, (i % 3) + 1, 0, Math.PI * 2);
      ctx.fill();
    }

    // coins
    for (const c of g.coins) {
      if (c.taken) continue;
      const bob = Math.sin(c.bob) * 4;
      const sx = Math.abs(Math.cos(c.bob));
      ctx.save();
      ctx.translate(c.x, c.y + bob);
      ctx.scale(0.55 + sx * 0.45, 1);
      const cg = ctx.createRadialGradient(0, -3, 2, 0, 0, 13);
      cg.addColorStop(0, "#fef3c7");
      cg.addColorStop(0.6, "#fbbf24");
      cg.addColorStop(1, "#d97706");
      ctx.fillStyle = cg;
      ctx.beginPath();
      ctx.arc(0, 0, 12, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      ctx.fillStyle = "rgba(120,53,15,0.85)";
      ctx.font = "bold 13px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      if (sx > 0.35) ctx.fillText("$", c.x, c.y + bob + 1);
    }

    // obstacles
    for (const o of g.obstacles) {
      if (o.kind === "ceiling") {
        const bottom = g.groundY - CEIL_GAP;
        const cg = ctx.createLinearGradient(0, -6, 0, bottom);
        cg.addColorStop(0, "#7f1d1d");
        cg.addColorStop(1, "#ef4444");
        ctx.fillStyle = cg;
        roundRect(ctx, o.x, -6, o.w, bottom + 6, 5);
        ctx.fill();
        // bright warning lip + hazard chevrons
        ctx.fillStyle = "rgba(254,202,202,0.9)";
        ctx.fillRect(o.x, bottom - 4, o.w, 4);
        ctx.fillStyle = "rgba(252,165,165,0.95)";
        ctx.font = "bold 13px ui-sans-serif, system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        ctx.fillText("▼", o.x + o.w / 2, bottom + 5);
        continue;
      }
      const oy = g.groundY - o.h;
      const og = ctx.createLinearGradient(o.x, oy, o.x, g.groundY);
      og.addColorStop(0, "#f87171");
      og.addColorStop(1, "#b91c1c");
      ctx.fillStyle = og;
      roundRect(ctx, o.x, oy, o.w, o.h, 5);
      ctx.fill();
      ctx.fillStyle = "rgba(254,202,202,0.7)";
      roundRect(ctx, o.x + 2, oy + 2, o.w - 4, 3, 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.8)";
      ctx.lineWidth = 2;
      const cx = o.x + o.w / 2;
      const cy = oy + o.h / 2;
      const r = Math.min(o.w, o.h) * 0.18;
      ctx.beginPath();
      ctx.moveTo(cx - r, cy - r);
      ctx.lineTo(cx + r, cy + r);
      ctx.moveTo(cx + r, cy - r);
      ctx.lineTo(cx - r, cy + r);
      ctx.stroke();
    }

    // ground
    const gg = ctx.createLinearGradient(0, g.groundY, 0, H);
    gg.addColorStop(0, "#312e81");
    gg.addColorStop(1, "#1e1b4b");
    ctx.fillStyle = gg;
    ctx.fillRect(0, g.groundY, W, H - g.groundY);
    ctx.strokeStyle = "rgba(165,180,252,0.7)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, g.groundY);
    ctx.lineTo(W, g.groundY);
    ctx.stroke();
    ctx.strokeStyle = "rgba(129,140,248,0.5)";
    ctx.lineWidth = 3;
    for (let x = -g.groundScroll; x < W; x += 48) {
      ctx.beginPath();
      ctx.moveTo(x, g.groundY + 14);
      ctx.lineTo(x + 22, g.groundY + 14);
      ctx.stroke();
    }

    // player (a gold "deal" token with $)
    const px = W * PLAYER_X_RATIO;
    const py = g.playerY;
    const squashY = 1 - g.squash * 0.28;
    const squashX = 1 + g.squash * 0.22;
    ctx.save();
    ctx.translate(px + PLAYER_SIZE / 2, py + PLAYER_SIZE / 2);
    ctx.rotate(Math.sin(g.rot) * 0.25);
    ctx.scale(squashX, squashY);
    ctx.shadowColor = "rgba(251,191,36,0.6)";
    ctx.shadowBlur = 16;
    const pg = ctx.createRadialGradient(-6, -6, 3, 0, 0, PLAYER_SIZE / 2 + 3);
    pg.addColorStop(0, "#fffbeb");
    pg.addColorStop(0.55, "#fbbf24");
    pg.addColorStop(1, "#b45309");
    ctx.fillStyle = pg;
    roundRect(ctx, -PLAYER_SIZE / 2, -PLAYER_SIZE / 2, PLAYER_SIZE, PLAYER_SIZE, 10);
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = "rgba(120,53,15,0.9)";
    ctx.font = "bold 22px ui-sans-serif, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("$", 0, 1);
    ctx.restore();

    // coin score popups (rising, fading "+$1,500")
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "bold 14px ui-sans-serif, system-ui, sans-serif";
    for (const p of g.popups) {
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life / 0.95));
      ctx.fillStyle = "#fde68a";
      ctx.fillText(p.text, p.x, p.y);
    }
    ctx.globalAlpha = 1;

    // particles
    for (const p of g.particles) {
      ctx.globalAlpha = Math.max(0, p.life / p.max);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // milestone flash (centered, brief)
    if (g.flash) {
      ctx.globalAlpha = Math.max(0, Math.min(1, g.flash.life / 0.6));
      ctx.fillStyle = "#fca5a5";
      ctx.font = "bold 20px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(g.flash.text, W / 2, 42);
      ctx.globalAlpha = 1;
    }

    // HUD (score)
    if (phaseRef.current !== "gameover") {
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      ctx.fillStyle = "rgba(199,210,254,0.85)";
      ctx.font = "600 11px ui-sans-serif, system-ui, sans-serif";
      ctx.fillText("PIPELINE CLOSED", 16, 24);
      ctx.fillStyle = "#fef3c7";
      ctx.font = "bold 26px ui-sans-serif, system-ui, sans-serif";
      ctx.fillText(fmtMoney(g.score), 16, 50);
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }, []);

  // ---- main loop ----
  useEffect(() => {
    resize();
    const ro = new ResizeObserver(() => resize());
    if (wrapRef.current) ro.observe(wrapRef.current);

    const frame = (now: number) => {
      resize(); // self-healing: snaps the backing store to the box each frame
      if (lastRef.current == null) lastRef.current = now;
      let dt = (now - lastRef.current) / 1000;
      lastRef.current = now;
      if (dt > 0.05) dt = 0.05; // clamp long frames (tab switch)
      if (phaseRef.current === "playing") {
        update(dt);
      } else {
        const g = gameRef.current;
        if (g) {
          if (phaseRef.current === "ready") {
            g.bgScroll = (g.bgScroll + dt * 24) % 260;
            g.groundScroll = (g.groundScroll + dt * 90) % 48;
            g.playerY = g.groundY - PLAYER_SIZE + Math.sin(now / 380) * 5;
          }
          // Effects keep animating in ready + gameover so the death burst
          // flies out and the screen-shake settles instead of freezing.
          for (const p of g.particles) {
            p.life -= dt;
            p.vy += p.grav * dt;
            p.x += p.vx * dt;
            p.y += p.vy * dt;
          }
          g.particles = g.particles.filter((p) => p.life > 0);
          if (g.shake > 0) g.shake = Math.max(0, g.shake - dt * 40);
        }
      }
      render();
      rafRef.current = requestAnimationFrame(frame);
    };
    rafRef.current = requestAnimationFrame(frame);

    const onVis = () => {
      if (document.hidden) lastRef.current = null;
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      ro.disconnect();
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [resize, update, render]);

  // ---- keyboard (capture-phase; owns the keyboard while open) ----
  useEffect(() => {
    const isJumpKey = (e: KeyboardEvent) =>
      e.code === "Space" || e.key === "ArrowUp" || e.key === "w" || e.key === "W";

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close();
        return;
      }
      const jumpKey = isJumpKey(e);
      // "Press any key" = a real character, space, enter, or arrow — NOT lone
      // modifiers or browser keys (F5, Tab, F12) which we leave alone.
      const startKey =
        e.code === "Space" ||
        e.key === "Enter" ||
        e.key.startsWith("Arrow") ||
        (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey);

      if (phaseRef.current === "ready") {
        if (startKey) {
          e.preventDefault();
          startRun();
        }
      } else if (phaseRef.current === "playing") {
        if (jumpKey && !e.repeat) {
          // ignore auto-repeat so holding doesn't burn the double-jump
          e.preventDefault();
          jump();
        }
      } else if (phaseRef.current === "gameover") {
        if (e.key === "Enter" || jumpKey) {
          e.preventDefault();
          startRun();
        }
      }
      e.stopPropagation();
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (phaseRef.current === "playing" && isJumpKey(e)) {
        jumpCut();
        e.stopPropagation();
      }
    };

    const onPointerUp = () => jumpCut();

    window.addEventListener("keydown", onKey, true);
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("pointerup", onPointerUp, true);
    window.addEventListener("pointercancel", onPointerUp, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("pointerup", onPointerUp, true);
      window.removeEventListener("pointercancel", onPointerUp, true);
    };
  }, [close, jump, jumpCut, startRun]);

  const onPointerDown = useCallback(() => {
    if (phaseRef.current === "ready") startRun();
    else if (phaseRef.current === "playing") jump();
  }, [jump, startRun]);

  const madeBoard = useMemo(
    () => phase === "gameover" && wouldRank(finalScore),
    [phase, finalScore, wouldRank],
  );
  const bestShown = Math.max(myBest ?? 0, phase === "gameover" ? finalScore : 0);

  return createPortal(
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/70 backdrop-blur-sm p-4 animate-in fade-in duration-200"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && phaseRef.current !== "playing") close();
      }}
    >
      <div className="w-full max-w-3xl rounded-2xl border border-indigo-400/30 bg-slate-900 shadow-2xl shadow-indigo-950/50 overflow-hidden animate-in zoom-in-95 duration-200">
        {/* header */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/5 bg-gradient-to-r from-indigo-950/60 to-slate-900">
          <div className="flex items-center gap-2 text-indigo-200">
            <Zap className="h-4 w-4 text-amber-300" />
            <span className="text-sm font-semibold tracking-wide">Pipeline Runner</span>
            <span className="text-[10px] uppercase tracking-widest text-indigo-400/70 hidden sm:inline">
              hidden mini-game
            </span>
          </div>
          <button
            onClick={close}
            className="rounded-md p-1 text-indigo-300/70 hover:text-white hover:bg-white/10 transition-colors"
            aria-label="Close game"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* stage */}
        <div
          ref={wrapRef}
          className="relative w-full aspect-[16/8] max-h-[62vh] select-none cursor-pointer touch-none"
          onPointerDown={onPointerDown}
        >
          <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />

          {/* READY overlay */}
          {phase === "ready" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2.5 text-center pointer-events-none">
              <div className="text-2xl sm:text-3xl font-black text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.6)]">
                Close the pipeline.
              </div>
              <div className="text-indigo-100/90 text-sm max-w-sm px-6">
                Jump the red <span className="text-rose-300 font-semibold">Closed&nbsp;Lost</span> blocks,
                grab the <span className="text-amber-300 font-semibold">gold</span>, bank the biggest number.
              </div>
              {(myBest ?? 0) > 0 && (
                <div className="text-amber-300/90 text-xs font-semibold">
                  Your best: {fmtMoney(myBest ?? 0)}
                </div>
              )}
              <div className="mt-1 animate-pulse rounded-full bg-white/10 border border-white/20 px-5 py-2 text-white font-semibold text-sm">
                Press any key or click to start
              </div>
              <div className="text-[11px] text-indigo-300/70 mt-0.5">
                Tap = short hop &nbsp;·&nbsp; hold = big jump &nbsp;·&nbsp; double-jump in the air &nbsp;·&nbsp; Esc to close
              </div>
            </div>
          )}

          {/* GAME OVER overlay */}
          {phase === "gameover" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-slate-950/72 backdrop-blur-[2px] p-4">
              <div className="text-center">
                <div className="text-[11px] uppercase tracking-widest text-indigo-300/80">
                  Pipeline closed
                </div>
                <div className="text-4xl font-black text-amber-300 drop-shadow">
                  {fmtMoney(finalScore)}
                </div>
                <div className="mt-1 flex items-center justify-center gap-1.5 flex-wrap">
                  {newPB && (
                    <div className="inline-flex items-center gap-1.5 rounded-full bg-gradient-to-r from-amber-400/20 to-yellow-300/10 border border-amber-300/40 px-3 py-1 text-amber-200 text-xs font-semibold animate-in zoom-in duration-300">
                      <Star className="h-3.5 w-3.5" /> New personal best!
                    </div>
                  )}
                  {madeBoard && (
                    <div className="inline-flex items-center gap-1.5 rounded-full bg-indigo-400/15 border border-indigo-300/40 px-3 py-1 text-indigo-100 text-xs font-semibold animate-in zoom-in duration-300">
                      <Trophy className="h-3.5 w-3.5" /> New top 5!
                    </div>
                  )}
                </div>
                {bestShown > 0 && (
                  <div className="text-indigo-300/70 text-xs mt-1">Your best: {fmtMoney(bestShown)}</div>
                )}
              </div>

              <Leaderboard scores={topScores} highlightScore={submitted ? finalScore : undefined} />

              <div className="flex items-center gap-2 mt-1">
                <button
                  onClick={startRun}
                  className="rounded-lg bg-gradient-to-r from-indigo-500 to-violet-500 px-5 py-2 text-sm font-semibold text-white shadow-lg shadow-indigo-900/40 hover:brightness-110 transition"
                >
                  Play again
                </button>
                <button
                  onClick={close}
                  className="rounded-lg border border-white/15 px-4 py-2 text-sm font-medium text-indigo-100 hover:bg-white/10 transition"
                >
                  Close
                </button>
              </div>
              <div className="text-[11px] text-indigo-300/60">Enter to play again · Esc to close</div>
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function Leaderboard({
  scores,
  highlightScore,
}: {
  scores: RunnerScore[] | undefined;
  highlightScore?: number;
}) {
  const rows = scores ?? [];
  let highlighted = false;
  return (
    <div className="w-full max-w-sm rounded-xl border border-white/10 bg-white/[0.03] overflow-hidden">
      <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-white/10 text-indigo-200/80 text-[11px] font-semibold uppercase tracking-wider">
        <Trophy className="h-3 w-3 text-amber-300" /> All-time top 5
      </div>
      {rows.length === 0 ? (
        <div className="px-3 py-4 text-center text-indigo-300/60 text-xs">
          No runs yet — be the first on the board.
        </div>
      ) : (
        <ol className="divide-y divide-white/5">
          {rows.map((r, i) => {
            const isMe =
              !highlighted && highlightScore != null && r.score === highlightScore;
            if (isMe) highlighted = true;
            return (
              <li
                key={r.id}
                className={cn(
                  "flex items-center gap-2 px-3 py-1.5 text-sm",
                  isMe && "bg-amber-400/10",
                )}
              >
                <span
                  className={cn(
                    "w-5 text-center font-bold",
                    i === 0 ? "text-amber-300" : i === 1 ? "text-slate-300" : i === 2 ? "text-amber-600" : "text-indigo-300/60",
                  )}
                >
                  {i + 1}
                </span>
                <span className="flex-1 truncate text-indigo-100">{r.player_name}</span>
                <span className="font-semibold text-amber-200 tabular-nums">{fmtMoney(r.score)}</span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

/**
 * Exported wrapper. Renders NOTHING until the game is launched, so there is
 * zero runtime cost (no canvas, no RAF, no listeners) during normal CRM use.
 */
export function PipelineRunnerGame() {
  const open = usePipelineRunnerOpen();
  // If the user leaves the Pipeline page while the game is open (clicks another
  // nav item instead of pressing Esc), reset the launch flag on unmount so it
  // doesn't silently re-open when they come back to /pipeline.
  useEffect(() => () => pipelineRunner.close(), []);
  if (!open) return null;
  return <GameModal />;
}
