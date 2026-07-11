import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAuth } from "@/features/auth/AuthProvider";
import { dealMerger, useDealMergerOpen } from "./store";
import { useTopScores, useMyBest, useSubmitScore, type MergerScore } from "./api";
import {
  MILLION_TIER,
  SIZE,
  fmtMoney,
  move,
  newGame,
  serialize,
  deserialize,
  tierLabel,
  type Dir,
  type GameState,
  type Ghost,
} from "./engine";

/**
 * Deal Merger — the third hidden mini-game. A calm 2048.
 *
 * Unlock: triple-click the "Opportunities" nav label. Slide deal memos with
 * arrows / WASD / swipe; equal deals merge into the next size up, doubling
 * from $500 toward the $1M contract (and beyond). Score is every dollar you
 * merge — "total closed" — submitted to the shared ledger when the desk
 * finally locks up. No timer, no lives; the run auto-saves, so closing the
 * window keeps your board.
 *
 * Look: nothing like the other two games on purpose. This one is a 1920s
 * corner office — mahogany frame, engraved brass plaques, a green felt desk
 * pad, paper memos that upgrade to leather and gold foil, fountain-pen ink
 * annotations. All CSS, no assets.
 *
 * Perf: mounts only while open; no rAF loop at all — every animation is a
 * CSS transition/keyframe on transform/opacity, so idle cost is zero and
 * moves stay smooth even on weak hardware.
 */

// ---- sounds (opt-in, default off) ----------------------------------------
let actx: AudioContext | null = null;
let noiseBuf: AudioBuffer | null = null;
function audio(): AudioContext | null {
  try {
    if (!actx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      actx = new AC();
    }
    if (actx.state === "suspended") actx.resume().catch(() => {});
    return actx;
  } catch {
    return null;
  }
}
function tone(freq: number, dur: number, type: OscillatorType, gain: number, slideTo?: number, delay = 0) {
  const c = audio();
  if (!c) return;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  const t = c.currentTime + delay;
  o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g);
  g.connect(c.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}
function paperSwish() {
  const c = audio();
  if (!c) return;
  if (!noiseBuf) {
    noiseBuf = c.createBuffer(1, c.sampleRate * 0.1, c.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const src = c.createBufferSource();
  src.buffer = noiseBuf;
  const bp = c.createBiquadFilter();
  bp.type = "bandpass";
  bp.frequency.value = 900;
  bp.Q.value = 0.8;
  const g = c.createGain();
  const t = c.currentTime;
  g.gain.setValueAtTime(0.028, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
  src.connect(bp);
  bp.connect(g);
  g.connect(c.destination);
  src.start(t);
  src.stop(t + 0.08);
}
const sfx = {
  slide: () => paperSwish(),
  merge: () => {
    paperSwish();
    tone(130, 0.1, "sine", 0.05, 72); // felt thump
  },
  milestone: () => tone(420, 0.09, "triangle", 0.028, 860), // quill scratch up
  million: () => [392, 494, 587, 784].forEach((f, i) => tone(f, 0.5, "sine", 0.035, undefined, i * 0.1)),
  over: () => tone(196, 0.5, "sine", 0.04, 98),
};

// ---- helpers --------------------------------------------------------------
function labelForValue(value: number): string {
  if (value < 500) return "—";
  return tierLabel(Math.round(Math.log2(value / 500)));
}
/** short display for popups: "+$8K" / "+$1M" */
function shortGain(tier: number): string {
  return `+${tierLabel(tier)}`;
}
function tileFontClass(label: string): string {
  const digits = label.length;
  return digits >= 5 ? "dm-fs-s" : digits >= 4 ? "dm-fs-m" : "dm-fs-l";
}

interface Ink {
  key: number;
  r: number;
  c: number;
  text: string;
}

const SOUND_KEY = "deal-merger-sound";
const runKey = (uid: string | undefined) => `deal-merger-run:${uid ?? "anon"}`;

export function DealMergerGame() {
  const open = useDealMergerOpen();
  // If the player navigates away while open, reset the launch flag so it
  // doesn't silently re-open when they come back to /opportunities. The run
  // itself survives in localStorage.
  useEffect(() => () => dealMerger.close(), []);
  if (!open) return null;
  return <GameModal />;
}

function GameModal() {
  const { profile } = useAuth();
  const uid = profile?.id;

  const [game, setGame] = useState<GameState>(() => {
    try {
      const raw = localStorage.getItem(runKey(uid));
      if (raw) {
        const restored = deserialize(JSON.parse(raw));
        if (restored && !restored.over) return restored;
      }
    } catch {
      /* fresh game */
    }
    return newGame();
  });
  const resumed = useRef(game.moves > 0);
  const [ghosts, setGhosts] = useState<Ghost[]>([]);
  const [inks, setInks] = useState<Ink[]>([]);
  const [flash, setFlash] = useState<string | null>(null);
  const [showMillion, setShowMillion] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [sound, setSound] = useState(() => localStorage.getItem(SOUND_KEY) === "on");

  const gameRef = useRef(game);
  gameRef.current = game;
  const millionSeen = useRef(game.won);
  const prevHighest = useRef(game.highestTier);
  const inkSeq = useRef(0);
  const ghostTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const soundRef = useRef(sound);
  soundRef.current = sound;

  const { data: topScores } = useTopScores();
  const { data: myBest } = useMyBest(uid);
  const submit = useSubmitScore();

  const close = useCallback(() => dealMerger.close(), []);

  // persist the run; a finished board clears the slot
  useEffect(() => {
    try {
      if (game.over) localStorage.removeItem(runKey(uid));
      else localStorage.setItem(runKey(uid), JSON.stringify(serialize(game)));
    } catch {
      /* storage full/blocked — play on */
    }
  }, [game, uid]);

  useEffect(() => {
    localStorage.setItem(SOUND_KEY, sound ? "on" : "off");
  }, [sound]);

  useEffect(
    () => () => {
      if (ghostTimer.current) clearTimeout(ghostTimer.current);
      if (flashTimer.current) clearTimeout(flashTimer.current);
    },
    [],
  );

  const wouldRank = useCallback(
    (score: number) => {
      if (score <= 0) return false;
      const rows = topScores ?? [];
      if (rows.length < 5) return true;
      return score > rows[rows.length - 1].score;
    },
    [topScores],
  );

  const finalize = useCallback(
    (finished: GameState) => {
      if (soundRef.current) sfx.over();
      if (uid && finished.score > 0) {
        setSubmitted(true);
        submit.mutate({
          userId: uid,
          playerName: profile?.full_name || "Anonymous",
          score: finished.score,
          bestTile: 500 * 2 ** finished.highestTier,
        });
      }
    },
    [uid, profile?.full_name, submit],
  );

  const doMove = useCallback(
    (dir: Dir) => {
      const g = gameRef.current;
      if (g.over || showMillion) return;
      // No input throttle on purpose: fast play just clips animations, which
      // is the classic 2048 feel — a throttle here eats held-key repeats.
      const outcome = move(g, dir);
      if (!outcome.moved) return;

      // sweep the previous move's transients so fast play never stacks them
      if (ghostTimer.current) clearTimeout(ghostTimer.current);
      setGame(outcome.state);
      setGhosts(outcome.ghosts);
      ghostTimer.current = setTimeout(() => setGhosts([]), 220);

      if (outcome.merges.length) {
        const add = outcome.merges.slice(0, 6).map((m) => ({
          key: ++inkSeq.current,
          r: m.r,
          c: m.c,
          text: shortGain(m.tier),
        }));
        setInks((prev) => [...prev.slice(-6), ...add]);
        setTimeout(() => {
          setInks((prev) => prev.filter((i) => !add.some((a) => a.key === i.key)));
        }, 800);
        if (soundRef.current) sfx.merge();
      } else if (soundRef.current) {
        sfx.slide();
      }

      // biggest-deal-yet milestone (worth announcing from $32K up)
      if (outcome.state.highestTier > prevHighest.current) {
        prevHighest.current = outcome.state.highestTier;
        if (outcome.state.highestTier >= 6 && outcome.state.highestTier < MILLION_TIER) {
          setFlash(`Biggest deal yet — ${tierLabel(outcome.state.highestTier)}`);
          if (flashTimer.current) clearTimeout(flashTimer.current);
          flashTimer.current = setTimeout(() => setFlash(null), 1700);
          if (soundRef.current) sfx.milestone();
        }
      }

      if (outcome.state.won && !millionSeen.current) {
        millionSeen.current = true;
        setShowMillion(true);
        if (soundRef.current) sfx.million();
      }

      if (outcome.state.over) finalize(outcome.state);
    },
    [finalize, showMillion],
  );

  const restart = useCallback(() => {
    try {
      localStorage.removeItem(runKey(uid));
    } catch {
      /* ignore */
    }
    const fresh = newGame();
    millionSeen.current = false;
    prevHighest.current = fresh.highestTier;
    resumed.current = false;
    setSubmitted(false);
    setShowMillion(false);
    setGhosts([]);
    setInks([]);
    setFlash(null);
    setGame(fresh);
  }, [uid]);

  // ---- keyboard (capture-phase; owns the keyboard while open) ----
  useEffect(() => {
    const DIRS: Record<string, Dir> = {
      ArrowUp: "up",
      ArrowDown: "down",
      ArrowLeft: "left",
      ArrowRight: "right",
      w: "up",
      W: "up",
      s: "down",
      S: "down",
      a: "left",
      A: "left",
      d: "right",
      D: "right",
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close();
        return;
      }
      const dir = DIRS[e.key];
      if (dir) {
        e.preventDefault();
        e.stopPropagation();
        doMove(dir);
        return;
      }
      if (e.key === "Enter" && gameRef.current.over) {
        e.preventDefault();
        e.stopPropagation();
        restart();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [close, doMove, restart]);

  // ---- swipe ----
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const onPointerDown = useCallback((e: React.PointerEvent) => {
    touchStart.current = { x: e.clientX, y: e.clientY };
  }, []);
  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      const s = touchStart.current;
      touchStart.current = null;
      if (!s) return;
      const dx = e.clientX - s.x;
      const dy = e.clientY - s.y;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
      doMove(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up");
    },
    [doMove],
  );

  const bestShown = Math.max(myBest ?? 0, game.score);
  const madeBoard = game.over && wouldRank(game.score);
  const newPB = game.over && game.score > (myBest ?? 0) && game.score > 0;

  const slots = useMemo(() => Array.from({ length: SIZE * SIZE }, (_, i) => i), []);

  const cellTransform = (r: number, c: number) =>
    `translate(calc(${c * 100}% + ${c} * var(--dm-gap)), calc(${r * 100}% + ${r} * var(--dm-gap)))`;

  return createPortal(
    <div
      className="dm-root"
      role="dialog"
      aria-label="Deal Merger"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <style>{CSS}</style>
      <div className="dm-desk">
        <button className="dm-x" onClick={close} aria-label="Close game">
          ×
        </button>
        <div className="dm-plaque dm-title-plaque">
          <div className="dm-title">DEAL MERGER</div>
          <div className="dm-subtitle">Mergers &amp; Acquisitions · est. 2026</div>
        </div>

        <div className="dm-layout">
          {/* the felt desk pad */}
          <div className="dm-boardcol">
            <div
              className="dm-felt"
              onPointerDown={onPointerDown}
              onPointerUp={onPointerUp}
              onPointerCancel={() => (touchStart.current = null)}
            >
              <div className="dm-grid">
                {slots.map((i) => (
                  <div
                    key={i}
                    className="dm-slot"
                    style={{ transform: cellTransform(Math.floor(i / SIZE), i % SIZE) }}
                  />
                ))}

                {ghosts.map((g) => (
                  <div
                    key={`g${g.id}`}
                    className="dm-tilepos dm-ghostpos"
                    style={{ transform: cellTransform(g.r, g.c) }}
                  >
                    <div className={`dm-card dm-t${Math.min(g.tier, 12)} dm-ghost`}>
                      <span className={tileFontClass(tierLabel(g.tier))}>{tierLabel(g.tier)}</span>
                    </div>
                  </div>
                ))}

                {game.tiles.map((t) => {
                  const label = tierLabel(t.tier);
                  return (
                    <div
                      key={t.id}
                      className="dm-tilepos"
                      style={{ transform: cellTransform(t.r, t.c) }}
                    >
                      <div
                        key={t.tier} // remount on upgrade → pop animation
                        className={[
                          "dm-card",
                          `dm-t${Math.min(t.tier, 12)}`,
                          t.justMerged ? "dm-pop" : "",
                          t.isNew ? "dm-rise" : "",
                        ].join(" ")}
                        style={{ ["--tilt" as string]: `${((t.id % 5) - 2) * 0.6}deg` }}
                      >
                        <span className={tileFontClass(label)}>{label}</span>
                        {t.tier >= MILLION_TIER && <span className="dm-seal" aria-hidden />}
                      </div>
                    </div>
                  );
                })}

                {inks.map((ink) => (
                  <div
                    key={ink.key}
                    className="dm-ink"
                    style={{ transform: cellTransform(ink.r, ink.c) }}
                  >
                    <span>{ink.text}</span>
                  </div>
                ))}
              </div>

              {flash && <div className="dm-flash">{flash}</div>}
              {resumed.current && !game.over && <div className="dm-resumed">resumed your open quarter</div>}

              {/* $1M banner */}
              {showMillion && (
                <div className="dm-overlay">
                  <div className="dm-waxbig">$1M</div>
                  <div className="dm-overlay-title">The Seven-Figure Deal</div>
                  <div className="dm-overlay-sub">
                    Contract signed. The desk plays on — how big can the book get?
                  </div>
                  <button className="dm-btn dm-btn-brass" onClick={() => setShowMillion(false)}>
                    Back to the desk
                  </button>
                </div>
              )}

              {/* game over */}
              {game.over && !showMillion && (
                <div className="dm-overlay">
                  <div className="dm-overlay-kicker">Quarter closed</div>
                  <div className="dm-overlay-total">{fmtMoney(game.score)}</div>
                  <div className="dm-overlay-badges">
                    {newPB && <span className="dm-badge dm-badge-gold">★ New personal best</span>}
                    {madeBoard && <span className="dm-badge dm-badge-red">✒ Made the ledger</span>}
                  </div>
                  <div className="dm-overlay-sub">
                    Biggest deal: {tierLabel(game.highestTier)} · {game.moves} moves
                  </div>
                  <div className="dm-overlay-actions">
                    <button className="dm-btn dm-btn-brass" onClick={restart}>
                      New quarter
                    </button>
                    <button className="dm-btn dm-btn-leather" onClick={close}>
                      Close
                    </button>
                  </div>
                  <div className="dm-overlay-hint">Enter for a new quarter · Esc to close</div>
                </div>
              )}
            </div>
            <div className="dm-help">
              Arrows, WASD or swipe · equal deals merge · your desk is saved when you leave
            </div>
          </div>

          {/* the ledger column */}
          <div className="dm-side">
            <div className="dm-plaque dm-stat">
              <div className="dm-stat-label">Total closed</div>
              <div className="dm-stat-value">{fmtMoney(game.score)}</div>
            </div>
            <div className="dm-plaque-row">
              <div className="dm-plaque dm-stat dm-stat-half">
                <div className="dm-stat-label">Best</div>
                <div className="dm-stat-value dm-stat-sm">{fmtMoney(bestShown)}</div>
              </div>
              <div className="dm-plaque dm-stat dm-stat-half">
                <div className="dm-stat-label">Biggest deal</div>
                <div className="dm-stat-value dm-stat-sm">{tierLabel(game.highestTier)}</div>
              </div>
            </div>

            <Ledger scores={topScores} highlightScore={submitted && game.over ? game.score : undefined} />

            <div className="dm-controls">
              <button className="dm-btn dm-btn-leather dm-btn-sm" onClick={restart}>
                New quarter
              </button>
              <button
                className={`dm-btn dm-btn-leather dm-btn-sm ${sound ? "dm-sound-on" : ""}`}
                onClick={() => setSound((s) => !s)}
                aria-pressed={sound}
              >
                {sound ? "Sound: on" : "Sound: off"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

const ROMAN = ["I", "II", "III", "IV", "V"];

function Ledger({
  scores,
  highlightScore,
}: {
  scores: MergerScore[] | undefined;
  highlightScore?: number;
}) {
  const rows = scores ?? [];
  let highlighted = false;
  return (
    <div className="dm-ledger">
      <div className="dm-ledger-head">The Ledger — all-time top 5</div>
      {rows.length === 0 ? (
        <div className="dm-ledger-empty">
          No entries yet.
          <br />
          Be the first name in the book.
        </div>
      ) : (
        <ol className="dm-ledger-list">
          {rows.map((r, i) => {
            const isMe = !highlighted && highlightScore != null && r.score === highlightScore;
            if (isMe) highlighted = true;
            return (
              <li key={r.id} className={isMe ? "dm-ledger-me" : ""}>
                <span className="dm-ledger-rank">{ROMAN[i] ?? i + 1}</span>
                <span className="dm-ledger-name">{r.player_name}</span>
                {r.best_tile >= 500 && (
                  <span className="dm-ledger-chip">{labelForValue(r.best_tile)}</span>
                )}
                <span className="dm-ledger-score">{fmtMoney(r.score)}</span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

// ---- theme ----------------------------------------------------------------
const CSS = `
.dm-root{position:fixed;inset:0;z-index:70;display:flex;align-items:center;justify-content:center;
  padding:16px;overflow:auto;
  font-family:Georgia,'Iowan Old Style','Palatino Linotype','Times New Roman',serif;
  background:
    radial-gradient(120% 90% at 50% 0%, rgba(88,58,28,.28), rgba(0,0,0,0) 55%),
    radial-gradient(140% 120% at 50% 110%, rgba(10,6,3,.5), rgba(0,0,0,0) 60%),
    rgba(16,11,7,.84);
  backdrop-filter:blur(3px);animation:dm-fadein .22s ease-out;}
@keyframes dm-fadein{from{opacity:0}to{opacity:1}}

/* mahogany desk frame */
.dm-desk{position:relative;width:100%;max-width:920px;max-height:94vh;overflow:auto;border-radius:16px;
  padding:14px 18px 18px;
  background:
    repeating-linear-gradient(93deg, rgba(0,0,0,.13) 0 2px, rgba(255,255,255,.03) 2px 5px, rgba(0,0,0,0) 5px 11px),
    linear-gradient(100deg,#4d2b18 0%,#6d3e24 26%,#552f1b 52%,#71422a 78%,#4a2917 100%);
  box-shadow:0 0 0 1px #2c1810, 0 2px 0 1px rgba(255,220,160,.12) inset, 0 -14px 40px rgba(0,0,0,.35) inset,
    0 30px 70px rgba(0,0,0,.6);
  animation:dm-deskin .25s ease-out;}
@keyframes dm-deskin{from{opacity:0;transform:scale(.965)}to{opacity:1;transform:scale(1)}}

.dm-x{position:absolute;top:10px;right:10px;z-index:5;width:32px;height:32px;border:none;border-radius:50%;
  cursor:pointer;font-size:20px;line-height:1;font-family:inherit;color:#43320f;
  background:linear-gradient(160deg,#f0d68c,#c39c49 45%,#93702c 80%,#dabc72);
  box-shadow:0 0 0 1px #6d5420, 0 2px 4px rgba(0,0,0,.5), inset 0 1px 0 rgba(255,255,255,.5);}
.dm-x:hover{filter:brightness(1.1)}

/* brass plaques */
.dm-plaque{border-radius:8px;
  background:linear-gradient(168deg,#f2d88c 0%,#d3ac57 32%,#a8813a 62%,#e6c877 100%);
  box-shadow:0 0 0 1px #6d5420, 0 2px 5px rgba(0,0,0,.45), inset 0 1px 0 rgba(255,255,255,.55),
    inset 0 -2px 3px rgba(80,55,10,.35);
  color:#43320f;position:relative;}
.dm-plaque::before,.dm-plaque::after{content:"";position:absolute;top:50%;width:5px;height:5px;border-radius:50%;
  margin-top:-2.5px;background:radial-gradient(circle at 35% 30%,#fff3c8,#7a5c20 70%);
  box-shadow:inset 0 0 1px #3c2c08;}
.dm-plaque::before{left:7px}.dm-plaque::after{right:7px}

.dm-title-plaque{width:fit-content;margin:2px auto 14px;padding:8px 46px;text-align:center;}
.dm-title{font-size:clamp(21px,3.4vw,30px);font-weight:700;letter-spacing:.24em;text-indent:.24em;
  text-shadow:0 1px 0 rgba(255,255,255,.5), 0 -1px 0 rgba(70,45,5,.55);}
.dm-subtitle{font-size:10px;letter-spacing:.34em;text-indent:.34em;text-transform:uppercase;opacity:.78;
  font-style:italic;margin-top:2px;}

.dm-layout{display:flex;gap:18px;align-items:stretch;justify-content:center;flex-wrap:wrap;}
.dm-boardcol{display:flex;flex-direction:column;align-items:center;min-width:0;}

/* the felt desk pad */
.dm-felt{--dm-board:clamp(264px, min(86vw, 56vh), 460px);
  --dm-gap:calc(var(--dm-board) * 0.026);
  --dm-tile:calc((var(--dm-board) - 5 * var(--dm-gap)) / 4);
  position:relative;width:var(--dm-board);height:var(--dm-board);border-radius:12px;touch-action:none;
  background:
    repeating-linear-gradient(0deg, rgba(255,255,255,.016) 0 1px, rgba(0,0,0,0) 1px 3px),
    repeating-linear-gradient(90deg, rgba(0,0,0,.05) 0 1px, rgba(0,0,0,0) 1px 4px),
    radial-gradient(130% 130% at 28% 18%, #2d5e46 0%, #1d4432 52%, #143026 100%);
  box-shadow:0 0 0 3px #33200f, 0 0 0 4px rgba(226,196,138,.25), inset 0 3px 22px rgba(0,0,0,.6);}
.dm-felt::after{content:"";position:absolute;inset:6px;border:1.5px dashed rgba(226,196,138,.28);
  border-radius:8px;pointer-events:none;}

.dm-grid{position:absolute;inset:var(--dm-gap);}
.dm-slot,.dm-tilepos,.dm-ink{position:absolute;top:0;left:0;width:var(--dm-tile);height:var(--dm-tile);}
.dm-slot{border-radius:9px;background:rgba(8,24,17,.42);
  box-shadow:inset 0 2px 5px rgba(0,0,0,.5), inset 0 -1px 0 rgba(255,255,255,.04);}

.dm-tilepos{transition:transform .11s cubic-bezier(.25,.6,.3,1);z-index:2;will-change:transform;}
.dm-ghostpos{z-index:1;}

/* deal memo cards */
.dm-card{position:absolute;inset:0;border-radius:9px;display:flex;align-items:center;justify-content:center;
  font-weight:700;user-select:none;transform:rotate(var(--tilt,0deg));
  box-shadow:0 2px 5px rgba(0,0,0,.42), inset 0 1px 0 rgba(255,255,255,.5), inset 0 -2px 3px rgba(0,0,0,.12);}
.dm-card span{position:relative;z-index:2}
.dm-fs-l{font-size:calc(var(--dm-tile)*.32)}
.dm-fs-m{font-size:calc(var(--dm-tile)*.27)}
.dm-fs-s{font-size:calc(var(--dm-tile)*.225)}

/* paper → leather → gold ladder */
.dm-t0{background:linear-gradient(175deg,#faf3e2,#efe3c6);color:#6a5836}
.dm-t1{background:linear-gradient(175deg,#f6ecd0,#eadcb4);color:#63512c}
.dm-t2{background:linear-gradient(175deg,#f0e0b4,#e3cf97);color:#5b4823}
.dm-t3{background:linear-gradient(175deg,#e9d29b,#d9bd7d);color:#53401c}
.dm-t4{background:linear-gradient(175deg,#f2d4b4,#e5bd92);color:#6b4020}
.dm-t5{background:linear-gradient(175deg,#ecc294,#dcab74);color:#5f3517}
.dm-t6{background:linear-gradient(175deg,#d9e0bd,#c3cd9d);color:#3f4d24}
.dm-t7{background:linear-gradient(175deg,#b9cfc0,#9dbaa6);color:#24493a}
.dm-t8{background:
  repeating-linear-gradient(115deg, rgba(0,0,0,.09) 0 2px, rgba(0,0,0,0) 2px 5px),
  linear-gradient(175deg,#7c352c,#61251f);color:#f6e7c8;
  box-shadow:0 2px 6px rgba(0,0,0,.5), inset 0 0 0 1.5px rgba(240,214,150,.5), inset 0 1px 0 rgba(255,255,255,.18);}
.dm-t9{background:
  repeating-linear-gradient(115deg, rgba(0,0,0,.1) 0 2px, rgba(0,0,0,0) 2px 5px),
  linear-gradient(175deg,#4f3320,#3a2414);color:#eed9a4;
  box-shadow:0 2px 6px rgba(0,0,0,.5), inset 0 0 0 1.5px rgba(240,214,150,.5), inset 0 1px 0 rgba(255,255,255,.15);}
.dm-t10{background:
  repeating-linear-gradient(115deg, rgba(255,255,255,.035) 0 2px, rgba(0,0,0,0) 2px 5px),
  linear-gradient(175deg,#332d26,#211c17);color:#f1d98b;
  box-shadow:0 2px 7px rgba(0,0,0,.55), inset 0 0 0 1.5px rgba(241,217,139,.65), inset 0 1px 0 rgba(255,255,255,.12);}
.dm-t11,.dm-t12{background:linear-gradient(135deg,#f7e5a8 0%,#dcb254 34%,#b1852c 58%,#eed492 88%);
  color:#3d2c08;overflow:hidden;
  box-shadow:0 3px 9px rgba(0,0,0,.55), inset 0 0 0 1.5px #8a6a2a, inset 0 1px 0 rgba(255,255,255,.7);}
.dm-t11::before,.dm-t12::before{content:"";position:absolute;inset:-40%;z-index:1;
  background:linear-gradient(115deg, rgba(255,255,255,0) 42%, rgba(255,255,255,.5) 50%, rgba(255,255,255,0) 58%);
  animation:dm-sheen 5.5s ease-in-out infinite;}
@keyframes dm-sheen{0%,55%{transform:translateX(-60%)}90%,100%{transform:translateX(60%)}}
.dm-seal{position:absolute;right:7%;bottom:8%;width:22%;height:22%;border-radius:50%;z-index:2;
  background:radial-gradient(circle at 38% 32%, #b8473a, #8c2f24 58%, #6d211a 100%);
  box-shadow:inset 0 1px 2px rgba(255,255,255,.35), inset 0 -2px 3px rgba(0,0,0,.4), 0 1px 2px rgba(0,0,0,.4);}

.dm-pop{animation:dm-pop .19s cubic-bezier(.34,1.4,.64,1) .09s backwards;}
@keyframes dm-pop{0%{transform:rotate(var(--tilt,0deg)) scale(.72)}62%{transform:rotate(var(--tilt,0deg)) scale(1.11)}
  100%{transform:rotate(var(--tilt,0deg)) scale(1)}}
.dm-rise{animation:dm-rise .17s ease-out .1s backwards;}
@keyframes dm-rise{from{transform:rotate(var(--tilt,0deg)) scale(.45);opacity:0}
  to{transform:rotate(var(--tilt,0deg)) scale(1);opacity:1}}
.dm-ghost{opacity:.9;animation:dm-ghost .2s ease-out .06s forwards;}
@keyframes dm-ghost{to{opacity:0;transform:scale(.82)}}

/* fountain-pen annotations */
.dm-ink{z-index:6;display:flex;align-items:center;justify-content:center;pointer-events:none;}
.dm-ink span{font-style:italic;font-size:calc(var(--dm-tile)*.26);color:#f7ecca;
  text-shadow:0 1px 3px rgba(0,0,0,.65);animation:dm-ink .75s ease-out forwards;}
@keyframes dm-ink{0%{opacity:0;transform:translateY(4px) scale(.9)}18%{opacity:1}
  100%{opacity:0;transform:translateY(-30px) scale(1)}}

.dm-flash{position:absolute;top:9%;left:50%;transform:translateX(-50%);z-index:7;pointer-events:none;
  font-style:italic;font-size:14px;color:#f7ecca;background:rgba(14,32,24,.62);border-radius:999px;
  padding:5px 16px;white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,.35);
  animation:dm-flash 1.7s ease-in-out forwards;}
@keyframes dm-flash{0%{opacity:0;transform:translateX(-50%) translateY(6px)}12%,78%{opacity:1;transform:translateX(-50%) translateY(0)}
  100%{opacity:0;transform:translateX(-50%) translateY(-4px)}}
.dm-resumed{position:absolute;bottom:7px;left:50%;transform:translateX(-50%);z-index:7;pointer-events:none;
  font-style:italic;font-size:11px;color:rgba(247,236,202,.75);animation:dm-resumed 3.4s ease-in-out forwards;}
@keyframes dm-resumed{0%,72%{opacity:1}100%{opacity:0}}

/* board overlays (win / game over) */
.dm-overlay{position:absolute;inset:0;z-index:10;border-radius:12px;display:flex;flex-direction:column;
  align-items:center;justify-content:center;gap:8px;text-align:center;padding:18px;
  background:rgba(10,22,16,.78);backdrop-filter:blur(2px);animation:dm-fadein .3s ease-out;}
.dm-overlay-kicker{font-size:11px;letter-spacing:.32em;text-indent:.32em;text-transform:uppercase;color:#d8c69a;}
.dm-overlay-total{font-size:clamp(26px,6vw,38px);font-weight:700;color:#f1d98b;
  text-shadow:0 2px 10px rgba(0,0,0,.5);}
.dm-overlay-title{font-size:clamp(20px,4.5vw,28px);font-weight:700;color:#f1d98b;letter-spacing:.04em;}
.dm-overlay-sub{font-size:13px;font-style:italic;color:#e8dcbd;max-width:300px;line-height:1.45;}
.dm-overlay-badges{display:flex;gap:6px;flex-wrap:wrap;justify-content:center;}
.dm-badge{font-size:11px;font-style:italic;padding:3px 11px;border-radius:999px;}
.dm-badge-gold{color:#f5e2a5;border:1px solid rgba(241,217,139,.55);background:rgba(241,217,139,.12);}
.dm-badge-red{color:#f4b9ad;border:1px solid rgba(220,120,100,.55);background:rgba(180,70,50,.16);}
.dm-overlay-actions{display:flex;gap:8px;margin-top:6px;}
.dm-overlay-hint{font-size:10.5px;font-style:italic;color:rgba(232,220,189,.6);}
.dm-waxbig{width:74px;height:74px;border-radius:50%;display:flex;align-items:center;justify-content:center;
  font-weight:700;font-size:19px;color:#f7d9c8;letter-spacing:.02em;
  background:radial-gradient(circle at 36% 30%, #bb4c3e, #8c2f24 58%, #691f18 100%);
  box-shadow:inset 0 2px 4px rgba(255,255,255,.35), inset 0 -3px 6px rgba(0,0,0,.45), 0 4px 14px rgba(0,0,0,.5);
  animation:dm-stamp .45s cubic-bezier(.2,1.6,.4,1);}
@keyframes dm-stamp{0%{transform:scale(1.7);opacity:0}55%{transform:scale(.94);opacity:1}100%{transform:scale(1)}}

/* buttons */
.dm-btn{border:none;cursor:pointer;font-family:inherit;font-weight:700;border-radius:8px;
  padding:9px 18px;font-size:13.5px;transition:filter .12s, transform .05s;}
.dm-btn:active{transform:translateY(1px)}
.dm-btn-brass{color:#43320f;background:linear-gradient(168deg,#f2d88c,#cfa851 40%,#a07a34 75%,#e2c476);
  box-shadow:0 0 0 1px #6d5420, 0 3px 6px rgba(0,0,0,.4), inset 0 1px 0 rgba(255,255,255,.55);}
.dm-btn-brass:hover{filter:brightness(1.08)}
.dm-btn-leather{color:#eed9a4;background:linear-gradient(175deg,#4f3320,#382313);
  box-shadow:0 0 0 1px rgba(240,214,150,.4), 0 3px 6px rgba(0,0,0,.4), inset 0 1px 0 rgba(255,255,255,.12);}
.dm-btn-leather:hover{filter:brightness(1.15)}
.dm-btn-sm{padding:7px 13px;font-size:12px;}
.dm-sound-on{box-shadow:0 0 0 1px #f1d98b, 0 3px 6px rgba(0,0,0,.4), inset 0 1px 0 rgba(255,255,255,.12);}

.dm-help{margin-top:10px;font-size:11.5px;font-style:italic;color:rgba(238,222,184,.62);text-align:center;}

/* ledger column */
.dm-side{display:flex;flex-direction:column;gap:10px;width:238px;flex-shrink:0;}
.dm-stat{padding:8px 16px;text-align:center;}
.dm-stat-label{font-size:9.5px;letter-spacing:.26em;text-indent:.26em;text-transform:uppercase;opacity:.75;}
.dm-stat-value{font-size:21px;font-weight:700;font-variant-numeric:tabular-nums;
  text-shadow:0 1px 0 rgba(255,255,255,.45), 0 -1px 0 rgba(70,45,5,.5);}
.dm-stat-sm{font-size:15px;}
.dm-plaque-row{display:flex;gap:10px;}
.dm-stat-half{flex:1;padding:7px 8px;min-width:0;}
.dm-stat-half .dm-stat-value{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}

/* the ledger book page */
.dm-ledger{border-radius:8px;flex:1;min-height:150px;
  background:
    repeating-linear-gradient(0deg, rgba(0,0,0,0) 0 25px, rgba(120,86,40,.16) 25px 26px),
    linear-gradient(178deg,#f8f1de,#efe4c6);
  box-shadow:0 0 0 1px #b09a6c, 0 3px 7px rgba(0,0,0,.4), inset 0 0 24px rgba(150,110,50,.12);
  padding:10px 12px 12px;color:#4c3d22;}
.dm-ledger-head{font-size:10px;letter-spacing:.22em;text-indent:.22em;text-transform:uppercase;text-align:center;
  border-bottom:1.5px solid rgba(120,86,40,.4);padding-bottom:5px;margin-bottom:2px;color:#7d3126;font-weight:700;}
.dm-ledger-empty{padding:22px 6px;text-align:center;font-style:italic;font-size:12px;opacity:.72;line-height:1.7;}
.dm-ledger-list{list-style:none;margin:0;padding:0;}
.dm-ledger-list li{display:flex;align-items:baseline;gap:7px;height:26px;font-size:12.5px;padding:0 2px;
  line-height:26px;}
.dm-ledger-me{background:rgba(241,217,139,.42);border-radius:4px;}
.dm-ledger-rank{width:20px;text-align:center;color:#7d3126;font-weight:700;font-size:11.5px;}
.dm-ledger-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-style:italic;}
.dm-ledger-chip{font-size:9.5px;font-weight:700;color:#8a6a2a;border:1px solid rgba(138,106,42,.5);
  border-radius:999px;padding:0 6px;line-height:14px;align-self:center;flex-shrink:0;}
.dm-ledger-score{font-weight:700;font-variant-numeric:tabular-nums;font-size:12px;flex-shrink:0;}

.dm-controls{display:flex;gap:8px;justify-content:center;}

@media (max-width:820px){
  .dm-side{width:min(86vw,460px);}
  .dm-ledger{min-height:0;}
}
@media (prefers-reduced-motion:reduce){
  .dm-tilepos{transition-duration:.01s}
  .dm-card,.dm-ghost,.dm-ink span,.dm-flash,.dm-waxbig,.dm-desk,.dm-root{animation-duration:.01s !important}
  .dm-t11::before,.dm-t12::before{animation:none}
}
`;
