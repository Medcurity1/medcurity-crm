import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/features/auth/AuthProvider";
import { meddySweeper, useMeddySweeperOpen } from "./store";
import {
  DIFFICULTIES,
  newGame,
  reveal,
  toggleFlag,
  chord,
  scoreBreakdown,
  type Difficulty,
  type GameState,
} from "./engine";
import { MeddyFace, MeddyMine, ShieldSprite, type FaceState } from "./sprites";
import { useTopScores, useMyBest, useSubmitScore } from "./api";

// Classic minesweeper-style number colors, tuned to read on the cream tiles.
const NUM_COLORS = ["", "#2f6fe0", "#2e8b57", "#c23a22", "#7b3ff2", "#b5651d", "#1aa0a0", "#2a2620", "#7a7268"];
const DIFF_ORDER: Difficulty[] = ["rookie", "analyst", "guardian"];

// ── tiny 8-bit sound (opt-in, default off) ──────────────────────────────
let actx: AudioContext | null = null;
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
function blip(freq: number, dur: number, type: OscillatorType = "square", gain = 0.05, slideTo?: number) {
  const c = audio();
  if (!c) return;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  const t = c.currentTime;
  o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(1, slideTo), t + dur);
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g);
  g.connect(c.destination);
  o.start(t);
  o.stop(t + dur);
}
const sfx = {
  tick: () => blip(480, 0.05, "square", 0.035),
  flag: () => blip(720, 0.06, "triangle", 0.05),
  boom: () => {
    blip(140, 0.5, "sawtooth", 0.09, 40);
    blip(90, 0.55, "square", 0.06, 30);
  },
  win: () => [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => blip(f, 0.16, "square", 0.06), i * 110)),
};

function pad3(n: number): string {
  const s = Math.abs(Math.max(-99, Math.min(999, n)));
  return (n < 0 ? "-" : "") + String(s).padStart(n < 0 ? 2 : 3, "0");
}

export function MeddySweeperGame() {
  const open = useMeddySweeperOpen();
  // If the player navigates away while open, reset the launch flag so it
  // doesn't silently re-open when they return to /meddy.
  useEffect(() => () => meddySweeper.close(), []);
  if (!open) return null;
  return <GameModal />;
}

function GameModal() {
  const { profile } = useAuth();
  const [difficulty, setDifficulty] = useState<Difficulty>("rookie");
  const [game, setGame] = useState<GameState>(() => newGame("rookie"));
  const [gameId, setGameId] = useState(0);
  const [face, setFace] = useState<FaceState>("idle");
  const [flagMode, setFlagMode] = useState(false);
  const [soundOn, setSoundOn] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [showHelp, setShowHelp] = useState(false);
  const [lastScore, setLastScore] = useState<{ won: boolean; total?: number; base?: number; speed?: number } | null>(null);
  const [tile, setTile] = useState(30);

  const startRef = useRef<number | null>(null);
  const submittedRef = useRef<number | null>(null);

  const submit = useSubmitScore();
  const { data: top5 = [] } = useTopScores();
  const { data: myBest = 0 } = useMyBest(profile?.id);

  const cfg = DIFFICULTIES[difficulty];
  const play = useCallback((fn: () => void) => { if (soundOn) fn(); }, [soundOn]);

  // ── responsive tile sizing: the whole board must always fit, no scroll ──
  useEffect(() => {
    function calc() {
      // Subtract the grid's own gaps (2px) + board padding (8px each side)
      // BEFORE dividing by tile count, or the board renders wider than its
      // budget and overflows the cabinet. Floor low enough that even the
      // 30-wide Guardian board stays fully visible on a laptop.
      const GAP = 2, PAD = 8;
      const availW = Math.min(window.innerWidth - 72, 940) - 2 * PAD - (cfg.cols - 1) * GAP;
      const availH = Math.max(180, window.innerHeight * 0.46) - 2 * PAD - (cfg.rows - 1) * GAP;
      const t = Math.floor(Math.min(availW / cfg.cols, availH / cfg.rows));
      setTile(Math.max(9, Math.min(34, t)));
    }
    calc();
    window.addEventListener("resize", calc);
    return () => window.removeEventListener("resize", calc);
  }, [cfg.cols, cfg.rows]);

  // ── timer: runs only while playing ──
  useEffect(() => {
    if (game.status === "playing") {
      if (startRef.current === null) startRef.current = Date.now();
      const id = setInterval(() => {
        if (startRef.current != null) setSeconds(Math.floor((Date.now() - startRef.current) / 1000));
      }, 250);
      return () => clearInterval(id);
    }
  }, [game.status]);

  // ── end-of-game: face, sound, precise time, one-time score submit ──
  useEffect(() => {
    if (game.status !== "won" && game.status !== "lost") return;
    const won = game.status === "won";
    setFace(won ? "won" : "lost");
    play(won ? sfx.win : sfx.boom);
    const finalSeconds = startRef.current != null ? Math.floor((Date.now() - startRef.current) / 1000) : 0;
    setSeconds(finalSeconds);
    if (submittedRef.current === gameId) return;
    submittedRef.current = gameId;
    if (won) {
      const b = scoreBreakdown(difficulty, finalSeconds);
      setLastScore({ won: true, total: b.total, base: b.base, speed: b.speed });
      // Only cleared boards score — nothing to submit on a loss.
      if (profile?.id) {
        submit.mutate({
          userId: profile.id,
          playerName: profile.full_name || "Player",
          score: b.total,
          difficulty,
          won: true,
        });
      }
    } else {
      setLastScore({ won: false });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game.status, gameId]);

  // ── Esc to quit ──
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") meddySweeper.close();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function startNewGame(d: Difficulty = difficulty) {
    startRef.current = null;
    setSeconds(0);
    setFace("idle");
    setLastScore(null);
    setGame(newGame(d));
    setGameId((g) => g + 1);
  }
  function chooseDifficulty(d: Difficulty) {
    setDifficulty(d);
    startNewGame(d);
  }

  const finished = game.status === "won" || game.status === "lost";
  const threatsLeft = game.mines - game.flags;

  function onCellClick(i: number) {
    if (finished) return;
    const cell = game.cells[i];
    if (cell.revealed) {
      setGame((g) => chord(g, i));
      play(sfx.tick);
      return;
    }
    if (flagMode) {
      if (!cell.revealed) { setGame((g) => toggleFlag(g, i)); play(sfx.flag); }
      return;
    }
    if (cell.flagged) return;
    setGame((g) => reveal(g, i));
    play(sfx.tick);
  }
  function onCellContext(e: React.MouseEvent, i: number) {
    e.preventDefault();
    if (finished) return;
    if (game.cells[i].revealed) return;
    setGame((g) => toggleFlag(g, i));
    play(sfx.flag);
  }
  function onCellDown(i: number) {
    if (finished) return;
    const cell = game.cells[i];
    if (!cell.revealed && !cell.flagged && !flagMode) setFace("worried");
  }
  function clearWorried() {
    if (!finished) setFace("idle");
  }

  const numFont = Math.max(9, Math.floor(tile * 0.62));

  return (
    <div className="ms-root" role="dialog" aria-label="MeddySweeper" onMouseUp={clearWorried} onMouseLeave={clearWorried}>
      <style>{CSS}</style>
      <div className="ms-scanlines" aria-hidden="true" />

      <div className="ms-cabinet">
        {/* marquee */}
        <div className="ms-marquee">
          <div className="ms-title">MEDDYSWEEPER</div>
          <div className="ms-subtitle">find every hidden Meddy</div>
          <button className="ms-x" onClick={() => meddySweeper.close()} aria-label="Close game">×</button>
        </div>

        {/* HUD */}
        <div className="ms-hud">
          <div className="ms-led" title="Meddys left to find">
            <MeddyMine size={16} />
            <span className="ms-led-digits">{pad3(threatsLeft)}</span>
          </div>

          <button
            className="ms-face"
            onClick={() => startNewGame()}
            title="New game"
            aria-label="New game"
          >
            <MeddyFace state={face} size={44} />
          </button>

          <div className="ms-led" title="Time">
            <span className="ms-clock">◷</span>
            <span className="ms-led-digits">{pad3(seconds)}</span>
          </div>
        </div>

        {/* controls */}
        <div className="ms-controls">
          <div className="ms-seg">
            {DIFF_ORDER.map((d) => (
              <button
                key={d}
                className={"ms-seg-btn" + (d === difficulty ? " is-active" : "")}
                onClick={() => chooseDifficulty(d)}
              >
                {DIFFICULTIES[d].label}
              </button>
            ))}
          </div>
          <button
            className={"ms-toggle" + (flagMode ? " is-on" : "")}
            onClick={() => setFlagMode((v) => !v)}
            title="Toggle shield mode (tap to shield). Right-click also shields."
          >
            🛡 {flagMode ? "Shield: ON" : "Shield: off"}
          </button>
          <button className="ms-toggle" onClick={() => setSoundOn((v) => !v)} title="Toggle sound">
            {soundOn ? "🔊" : "🔇"}
          </button>
          <button className="ms-toggle" onClick={() => setShowHelp((v) => !v)} title="How to play">?</button>
        </div>

        {showHelp && (
          <div className="ms-help">
            Reveal the safe tiles. A number = how many <b>Meddys</b> are hiding next to it.
            Right-click (or flip <b>Shield</b> mode on) to shield a spot where you think a Meddy is
            hiding. Click a fully-shielded number to auto-clear its neighbors. Clear every safe tile
            to <b>win</b> — uncover a Meddy and it's game over. Faster + harder = higher score.
          </div>
        )}

        {/* board */}
        <div className="ms-board-wrap">
          <div
            className="ms-board"
            style={{ gridTemplateColumns: `repeat(${cfg.cols}, ${tile}px)` }}
            onContextMenu={(e) => e.preventDefault()}
          >
            {game.cells.map((cell, i) => {
              const revealed = cell.revealed;
              const boom = game.explodedIndex === i;
              const wrongFlag = finished && cell.flagged && !cell.mine;
              let cls = "ms-cell";
              if (revealed || (finished && cell.mine)) cls += " ms-cell--rev";
              else cls += " ms-cell--cov";
              if (boom) cls += " ms-cell--boom";
              return (
                <button
                  key={i}
                  className={cls}
                  style={{ width: tile, height: tile }}
                  onMouseDown={() => onCellDown(i)}
                  onClick={() => onCellClick(i)}
                  onContextMenu={(e) => onCellContext(e, i)}
                  aria-label={revealed ? (cell.mine ? "threat" : String(cell.adjacent)) : cell.flagged ? "shielded" : "hidden node"}
                >
                  {!revealed && cell.flagged && !wrongFlag && <ShieldSprite size={Math.floor(tile * 0.82)} />}
                  {wrongFlag && <ShieldSprite size={Math.floor(tile * 0.82)} wrong />}
                  {(revealed || (finished && cell.mine)) && cell.mine && !cell.flagged && (
                    <MeddyMine size={Math.floor(tile * 0.82)} dead={boom} />
                  )}
                  {revealed && !cell.mine && cell.adjacent > 0 && (
                    <span style={{ color: NUM_COLORS[cell.adjacent], fontSize: numFont }} className="ms-num">
                      {cell.adjacent}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {finished && (
            <div className={"ms-banner " + (game.status === "won" ? "is-win" : "is-lose")}>
              <div className="ms-banner-title">
                {game.status === "won" ? "ALL CLEAR!" : "OOPS!"}
              </div>
              {lastScore?.won && (
                <>
                  <div className="ms-banner-score">
                    SCORE <b>{lastScore.total!.toLocaleString()}</b>
                    <span className="ms-banner-time"> · {seconds}s</span>
                  </div>
                  <div className="ms-banner-break">
                    {lastScore.base!.toLocaleString()} cleared
                    {lastScore.speed! > 0 && <> + {lastScore.speed!.toLocaleString()} speed</>}
                  </div>
                </>
              )}
              {lastScore && !lastScore.won && (
                <div className="ms-banner-score">Board not cleared — no points. Try again!</div>
              )}
              <button className="ms-play-again" onClick={() => startNewGame()}>▶ PLAY AGAIN</button>
            </div>
          )}
        </div>

        {/* footer: leaderboard + personal best */}
        <div className="ms-footer">
          <div className="ms-board-panel">
            <div className="ms-panel-h">◆ ALL-TIME TOP 5</div>
            {top5.length === 0 ? (
              <div className="ms-empty">No scores yet — be the first to secure the network.</div>
            ) : (
              <ol className="ms-scores">
                {top5.map((s, i) => (
                  <li key={s.id} className={s.user_id === profile?.id ? "is-me" : ""}>
                    <span className="ms-rank">{i + 1}</span>
                    <span className="ms-pname">{s.player_name}</span>
                    <span className={"ms-dtag ms-dtag--" + s.difficulty}>{DIFFICULTIES[s.difficulty]?.label ?? s.difficulty}</span>
                    <span className="ms-pscore">{s.score.toLocaleString()}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>
          <div className="ms-best">
            <div className="ms-best-label">YOUR BEST</div>
            <div className="ms-best-val">{myBest.toLocaleString()}</div>
            <div className="ms-hint">Esc to quit · right-click to shield</div>
          </div>
        </div>
      </div>
    </div>
  );
}

const CSS = `
.ms-root{position:fixed;inset:0;z-index:70;display:flex;align-items:center;justify-content:center;
  font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace;padding:16px;overflow:auto;
  background-color:#2f6fe0;
  background-image:linear-gradient(45deg, rgba(255,255,255,.06) 25%, transparent 25%, transparent 75%, rgba(255,255,255,.06) 75%),
    linear-gradient(45deg, rgba(255,255,255,.06) 25%, transparent 25%, transparent 75%, rgba(255,255,255,.06) 75%);
  background-size:30px 30px;background-position:0 0,15px 15px;}
.ms-scanlines{position:absolute;inset:0;pointer-events:none;z-index:1;
  background:radial-gradient(130% 100% at 50% 40%, transparent 52%, rgba(10,32,80,.42) 100%);}
.ms-cabinet{position:relative;z-index:2;width:100%;max-width:min(96vw,1000px);max-height:94vh;overflow:auto;
  border-radius:10px;padding:14px 16px 18px;background:#fdf7ec;
  border:4px solid #1e50b0;
  box-shadow:0 0 0 4px #14356f, 0 14px 0 rgba(12,32,74,.35), 0 20px 40px rgba(8,24,60,.45);}
.ms-marquee{position:relative;text-align:center;padding:6px 40px 10px;}
.ms-title{font-size:clamp(24px,5vw,40px);font-weight:800;letter-spacing:.16em;line-height:1;color:#ea4a2f;
  text-shadow:2px 2px 0 #1e50b0, 4px 4px 0 rgba(30,80,176,.28);}
.ms-subtitle{margin-top:8px;font-size:11px;letter-spacing:.3em;text-transform:uppercase;color:#1e50b0;font-weight:700;}
.ms-x{position:absolute;top:2px;right:4px;width:30px;height:30px;border:none;border-radius:6px;cursor:pointer;
  background:#f1e6cf;color:#a5432c;font-size:20px;line-height:1;box-shadow:inset 0 0 0 2px #d8c9a8;}
.ms-x:hover{background:#ea4a2f;color:#fff;}
.ms-hud{display:flex;align-items:center;justify-content:center;gap:16px;margin:4px 0 12px;}
.ms-led{display:flex;align-items:center;gap:6px;padding:5px 10px;border-radius:6px;background:#1a1410;
  box-shadow:inset 0 0 0 2px #4a3a28, inset 0 2px 8px rgba(0,0,0,.7);}
.ms-led-digits{font-weight:800;font-size:22px;letter-spacing:.08em;color:#ff4a2a;
  text-shadow:0 0 4px rgba(255,74,42,.7);min-width:46px;text-align:right;font-variant-numeric:tabular-nums;}
.ms-clock{color:#ff4a2a;font-size:15px;text-shadow:0 0 4px rgba(255,74,42,.7);}
.ms-face{border:none;cursor:pointer;padding:5px;border-radius:9px;line-height:0;background:#f1e6cf;
  box-shadow:0 0 0 3px #1e50b0,0 4px 0 #14356f;transition:transform .05s;}
.ms-face:hover{filter:brightness(1.04);}
.ms-face:active{transform:translateY(2px);box-shadow:0 0 0 3px #1e50b0,0 1px 0 #14356f;}
.ms-face svg{animation:ms-bob 2.6s ease-in-out infinite;}
@keyframes ms-bob{0%,100%{transform:translateY(0)}50%{transform:translateY(-2px)}}
.ms-controls{display:flex;flex-wrap:wrap;align-items:center;justify-content:center;gap:8px;margin-bottom:12px;}
.ms-seg{display:flex;background:#f1e6cf;border-radius:8px;padding:3px;box-shadow:inset 0 0 0 2px #d8c9a8;}
.ms-seg-btn{border:none;background:transparent;color:#8a6d52;font-weight:700;font-size:12px;letter-spacing:.08em;
  text-transform:uppercase;padding:6px 12px;border-radius:6px;cursor:pointer;font-family:inherit;}
.ms-seg-btn.is-active{background:#2f6fe0;color:#fff;box-shadow:0 2px 0 #1e50b0;}
.ms-toggle{border:none;background:#f1e6cf;color:#5a4a38;font-weight:700;font-size:12px;padding:7px 11px;border-radius:7px;
  cursor:pointer;font-family:inherit;box-shadow:inset 0 0 0 2px #d8c9a8;}
.ms-toggle:hover{filter:brightness(.98);}
.ms-toggle.is-on{background:#ea4a2f;color:#fff;box-shadow:0 2px 0 #b83a22;}
.ms-help{max-width:640px;margin:0 auto 12px;font-size:12px;line-height:1.6;color:#5a4a38;
  background:#f4ead3;border-radius:8px;padding:10px 14px;box-shadow:inset 0 0 0 2px #d8c9a8;}
.ms-help b{color:#c23a22;}
.ms-board-wrap{position:relative;display:flex;justify-content:center;max-width:100%;overflow-x:auto;}
.ms-board{display:grid;gap:2px;padding:8px;border-radius:6px;background:#c9b48f;
  box-shadow:inset 0 0 0 3px #a8916a, 0 0 0 3px #1e50b0;}
.ms-cell{position:relative;display:flex;align-items:center;justify-content:center;padding:0;border:none;cursor:pointer;
  border-radius:2px;line-height:0;font-family:inherit;}
.ms-cell--cov{background:#3b82f6;box-shadow:inset 2px 2px 0 #8fbaff, inset -2px -2px 0 #1c4fb0;}
.ms-cell--cov:hover{background:#4c8ff8;}
.ms-cell--cov:active{box-shadow:inset -2px -2px 0 #8fbaff, inset 2px 2px 0 #1c4fb0;}
.ms-cell--rev{background:#f1e6cf;box-shadow:inset 0 0 0 1px #d3c3a0;cursor:default;}
.ms-cell--rev:hover{background:#f6eeda;}
.ms-cell--boom{background:#ea4a2f !important;box-shadow:inset 0 0 0 2px #b83a22;animation:ms-pop .28s ease-out;}
@keyframes ms-pop{0%{transform:scale(.6)}70%{transform:scale(1.12)}100%{transform:scale(1)}}
.ms-num{font-weight:800;font-variant-numeric:tabular-nums;line-height:1;}
.ms-banner{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;
  border-radius:6px;background:rgba(253,247,236,.94);box-shadow:inset 0 0 0 4px #1e50b0;animation:ms-bannerin .3s ease-out;}
@keyframes ms-bannerin{from{opacity:0;transform:scale(.94)}to{opacity:1;transform:scale(1)}}
.ms-banner-title{font-size:clamp(24px,4.5vw,36px);font-weight:800;letter-spacing:.1em;text-shadow:2px 2px 0 rgba(0,0,0,.12);}
.ms-banner.is-win .ms-banner-title{color:#2fa84f;}
.ms-banner.is-lose .ms-banner-title{color:#ea4a2f;}
.ms-banner-score{font-size:15px;color:#6a5540;letter-spacing:.1em;text-transform:uppercase;font-weight:700;}
.ms-banner-score b{color:#1e50b0;font-size:20px;}
.ms-banner-time{color:#a08a6e;}
.ms-banner-break{font-size:11px;color:#a08a6e;letter-spacing:.04em;margin-top:-4px;}
.ms-play-again{border:none;cursor:pointer;font-family:inherit;font-weight:800;letter-spacing:.1em;
  padding:10px 20px;border-radius:8px;color:#fff;background:#2f6fe0;box-shadow:0 4px 0 #1e50b0;}
.ms-play-again:active{transform:translateY(3px);box-shadow:0 1px 0 #1e50b0;}
.ms-footer{display:flex;flex-wrap:wrap;gap:12px;margin-top:14px;}
.ms-board-panel{flex:1;min-width:240px;background:#f4ead3;border-radius:10px;padding:10px 12px;box-shadow:inset 0 0 0 2px #d8c9a8;}
.ms-panel-h{font-size:11px;letter-spacing:.2em;color:#8a6d52;margin-bottom:8px;font-weight:700;}
.ms-empty{font-size:12px;color:#a08a6e;padding:6px 2px;}
.ms-scores{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:3px;}
.ms-scores li{display:flex;align-items:center;gap:8px;font-size:13px;padding:5px 8px;border-radius:6px;background:#fbf3e2;}
.ms-scores li.is-me{background:rgba(47,111,224,.12);box-shadow:inset 0 0 0 2px rgba(47,111,224,.45);}
.ms-rank{width:16px;color:#ea4a2f;font-weight:800;}
.ms-pname{flex:1;color:#4a3d2e;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
.ms-dtag{font-size:9px;letter-spacing:.06em;text-transform:uppercase;padding:2px 6px;border-radius:5px;font-weight:700;}
.ms-dtag--rookie{background:#d7e6ff;color:#1e50b0;}
.ms-dtag--analyst{background:#d6f0dc;color:#1e7a3a;}
.ms-dtag--guardian{background:#ffe0d6;color:#c23a22;}
.ms-pscore{color:#1e50b0;font-weight:800;font-variant-numeric:tabular-nums;}
.ms-best{width:170px;background:#f4ead3;border-radius:10px;padding:12px;text-align:center;box-shadow:inset 0 0 0 2px #d8c9a8;
  display:flex;flex-direction:column;justify-content:center;}
.ms-best-label{font-size:10px;letter-spacing:.22em;color:#8a6d52;font-weight:700;}
.ms-best-val{font-size:30px;font-weight:800;color:#ea4a2f;font-variant-numeric:tabular-nums;}
.ms-hint{margin-top:8px;font-size:10px;color:#a08a6e;letter-spacing:.05em;}
@media (max-width:560px){.ms-best{width:100%;}}
@media (prefers-reduced-motion:reduce){.ms-face svg{animation:none;}.ms-cell--boom{animation:none;}.ms-banner{animation:none;}}
`;
