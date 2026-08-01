// The Daily Deal — weekday word puzzle, morning-newspaper edition.
//
// Unlock: triple-click the "Nexus" nav label (registered in Sidebar.tsx,
// same secret-click mechanism as the other three games). Mounts on
// NexusPage; renders nothing until launched, costs nothing when idle.
//
// Theme: newsprint. Cream paper, ink black, serif masthead, mustard/ink-green
// tile flips, rubber-stamp verdicts (CLOSED WON / NO DEAL). Distinct from
// Runner (midnight neon), Sweeper (8-bit cartridge), Merger (mahogany).
//
// All answers live server-side (daily-deal edge fn) — this component only
// ever knows the marks it's told. Board state is server-persisted, so
// closing mid-game and reopening resumes exactly where you left off
// (Nathan's pause requirement).

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { dailyDeal, useDailyDealOpen } from "./store";
import {
  useDailyDealState,
  useDailyDealGuess,
  type DDBoardRow,
  type DDGuess,
  type DDWeek,
} from "./api";

const WORD_LEN = 5;
const MAX_GUESSES = 6;
const FLIP_STEP_MS = 280; // per-tile stagger
const FLIP_SETTLE_MS = FLIP_STEP_MS * 4 + 620; // last tile started + flip time

const KEY_ROWS = ["qwertyuiop", "asdfghjkl", "zxcvbnm"];

function fmtMs(ms: number | null | undefined): string {
  if (ms == null) return "—";
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

function fmtDay(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function shareGrid(guesses: DDGuess[], won: boolean, today: string): string {
  const rows = guesses
    .map((g) => [...g.marks].map((m) => (m === "g" ? "🟩" : m === "y" ? "🟨" : "⬛")).join(""))
    .join("\n");
  const score = won ? `${guesses.length}/6` : "X/6";
  return `The Daily Deal — ${today} — ${score}\n${rows}`;
}

/** g beats y beats x for keyboard key coloring. */
function keyStates(guesses: DDGuess[]): Record<string, string> {
  const rank: Record<string, number> = { x: 1, y: 2, g: 3 };
  const out: Record<string, string> = {};
  for (const g of guesses) {
    for (let i = 0; i < g.word.length; i++) {
      const ch = g.word[i];
      const m = g.marks[i];
      if (!out[ch] || rank[m] > (rank[out[ch]] ?? 0)) out[ch] = m;
    }
  }
  return out;
}

export function DailyDealGame() {
  const open = useDailyDealOpen();
  if (!open) return null;
  return <DailyDealDialog />;
}

function DailyDealDialog() {
  const stateQ = useDailyDealState(true);
  const guessMut = useDailyDealGuess();

  const [typed, setTyped] = useState("");
  const [shaking, setShaking] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  // Rows ≤ animatedUpTo flipped in a previous session/render — show settled.
  // The row currently flipping animates; everything is driven by row index.
  const [flippingRow, setFlippingRow] = useState<number | null>(null);
  const [revealPanel, setRevealPanel] = useState(false);
  const dictRef = useRef<Set<string> | null>(null);

  const st = stateQ.data;
  const guesses = useMemo(() => st?.guesses ?? [], [st?.guesses]);
  const completed = !!st?.completed;

  // Lazy-load the guess dictionary (compact string, its own chunk).
  useEffect(() => {
    import("./dictionary").then((m) => {
      dictRef.current = m.guessDictionary();
    });
  }, []);

  // A board restored already-complete shows its panel immediately (no stamp
  // re-slam); a board completing LIVE stamps first, then slides the panel in.
  useEffect(() => {
    if (completed && flippingRow === null) setRevealPanel(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [completed]);

  function submit() {
    if (guessMut.isPending || completed || flippingRow !== null) return;
    if (typed.length !== WORD_LEN) {
      nudge("Five letters needed");
      return;
    }
    if (guesses.some((g) => g.word === typed)) {
      nudge("Already tried that one");
      return;
    }
    if (dictRef.current && !dictRef.current.has(typed)) {
      nudge("Not in the dictionary");
      return;
    }
    const rowIdx = guesses.length;
    guessMut.mutate(typed, {
      onSuccess: (res) => {
        setTyped("");
        setFlippingRow(rowIdx);
        window.setTimeout(() => {
          setFlippingRow(null);
          if (res.completed) setRevealPanel(true);
        }, FLIP_SETTLE_MS);
      },
      onError: (e) => nudge((e as Error).message || "Couldn't submit — try again"),
    });
  }

  function nudge(msg: string) {
    setNote(msg);
    setShaking(true);
    window.setTimeout(() => setShaking(false), 500);
    window.setTimeout(() => setNote(null), 1800);
  }

  function onKey(key: string) {
    if (completed || st?.mode !== "play") return;
    if (key === "enter") submit();
    else if (key === "back") setTyped((t) => t.slice(0, -1));
    else if (/^[a-z]$/.test(key) && typed.length < WORD_LEN && flippingRow === null) {
      setTyped((t) => t + key);
    }
  }

  // Physical keyboard (capture-phase; owns typing while open, same as the
  // other games). Modifier combos pass through untouched.
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "Escape") {
        dailyDeal.close();
        e.stopPropagation();
        return;
      }
      const k = e.key.toLowerCase();
      if (k === "enter") onKey("enter");
      else if (k === "backspace") onKey("back");
      else if (/^[a-z]$/.test(k)) onKey(k);
      else return;
      e.stopPropagation();
      e.preventDefault();
    }
    window.addEventListener("keydown", handler, true);
    return () => window.removeEventListener("keydown", handler, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typed, guesses.length, completed, flippingRow, st?.mode]);

  const keys = useMemo(() => keyStates(guesses), [guesses]);
  const stampVisible = completed && flippingRow === null;

  return (
    <div className="dd-overlay" onClick={() => dailyDeal.close()}>
      <style>{CSS}</style>
      <div className="dd-paper" onClick={(e) => e.stopPropagation()}>
        <button className="dd-close" onClick={() => dailyDeal.close()} aria-label="Close">×</button>

        <div className="dd-masthead">
          <div className="dd-rule" />
          <h1>The Daily Deal</h1>
          <div className="dd-rule" />
          <p className="dd-dateline">
            {st ? fmtDay(st.today) : "…"} · Medcurity Bureau · Free to subscribers
          </p>
        </div>

        {stateQ.isPending && <p className="dd-note">Fetching today's edition…</p>}
        {stateQ.isError && (
          <p className="dd-note">
            The presses jammed. <button className="dd-linkbtn" onClick={() => stateQ.refetch()}>Retry</button>
          </p>
        )}

        {st?.mode === "weekend" && st.recap && <WeekendRecap week={st.recap} />}

        {st?.mode === "play" && (
          <>
            <div className={"dd-grid" + (shaking ? " dd-shake" : "")}>
              {Array.from({ length: MAX_GUESSES }).map((_, r) => {
                const g = guesses[r];
                const isTyping = r === guesses.length && !completed;
                const isFlipping = flippingRow === r;
                return (
                  <div className="dd-row" key={r}>
                    {Array.from({ length: WORD_LEN }).map((_, c) => {
                      const letter = g ? g.word[c] : isTyping ? typed[c] ?? "" : "";
                      const mark = g ? g.marks[c] : "";
                      const cls = g
                        ? isFlipping
                          ? `dd-tile dd-flip dd-${mark}`
                          : `dd-tile dd-settled dd-${mark}`
                        : "dd-tile" + (letter ? " dd-typed" : "");
                      return (
                        <div
                          key={c}
                          className={cls}
                          style={isFlipping ? { animationDelay: `${c * FLIP_STEP_MS}ms` } : undefined}
                        >
                          {letter}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
              {stampVisible && (
                <div className={"dd-stamp " + (st.won ? "dd-stamp-won" : "dd-stamp-lost")}>
                  {st.won ? "CLOSED WON" : "NO DEAL"}
                </div>
              )}
            </div>

            {note && <p className="dd-note dd-flash">{note}</p>}
            {!completed && !note && (
              <p className="dd-note dd-hint">
                {guesses.length === 0 ? "6 tries. The ink tells the truth." : `${MAX_GUESSES - guesses.length} ${MAX_GUESSES - guesses.length === 1 ? "try" : "tries"} left`}
              </p>
            )}
            {completed && !st.won && st.answer && flippingRow === null && (
              <p className="dd-note">
                The word was <strong>{st.answer.toUpperCase()}</strong>
              </p>
            )}

            {!completed && (
              <div className="dd-keys">
                {KEY_ROWS.map((row, i) => (
                  <div className="dd-keyrow" key={i}>
                    {i === 2 && (
                      <button className="dd-key dd-key-wide" onClick={() => onKey("enter")}>ENTER</button>
                    )}
                    {[...row].map((k) => (
                      <button
                        key={k}
                        className={`dd-key dd-key-${keys[k] ?? "fresh"}`}
                        onClick={() => onKey(k)}
                      >
                        {k.toUpperCase()}
                      </button>
                    ))}
                    {i === 2 && (
                      <button className="dd-key dd-key-wide" onClick={() => onKey("back")}>⌫</button>
                    )}
                  </div>
                ))}
              </div>
            )}

            {revealPanel && completed && (
              <PostGamePanel
                won={!!st.won}
                points={st.points ?? 0}
                streak={st.streak ?? 0}
                msElapsed={st.msElapsed ?? null}
                guesses={guesses}
                today={st.today}
                board={st.board ?? []}
                week={st.week ?? null}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

function PostGamePanel(props: {
  won: boolean;
  points: number;
  streak: number;
  msElapsed: number | null;
  guesses: DDGuess[];
  today: string;
  board: DDBoardRow[];
  week: DDWeek | null;
}) {
  function share() {
    navigator.clipboard
      .writeText(shareGrid(props.guesses, props.won, props.today))
      .then(() => toast.success("Result copied — paste it in chat"))
      .catch(() => toast.error("Couldn't copy"));
  }
  return (
    <div className="dd-panel">
      <div className="dd-scoreline">
        <span><strong>{props.points}</strong> pts</span>
        <span>{fmtMs(props.msElapsed)}</span>
        <span>{props.streak}-day streak</span>
        <button className="dd-sharebtn" onClick={share}>Share result</button>
      </div>

      <h3 className="dd-subhead">Today's solvers</h3>
      {props.board.length === 0 ? (
        <p className="dd-note">You're the first in the office. Scoop!</p>
      ) : (
        <table className="dd-table">
          <tbody>
            {props.board.map((r, i) => (
              <tr key={i}>
                <td>{r.name}</td>
                <td>{r.won ? `${r.guessCount}/6` : "X/6"}</td>
                <td>{fmtMs(r.msElapsed)}</td>
                <td className="dd-pts">{r.points ?? 0} pts</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {props.week && <Standings week={props.week} title="This week so far" />}
    </div>
  );
}

function Standings({ week, title }: { week: DDWeek; title: string }) {
  if (week.standings.length === 0) return null;
  return (
    <>
      <h3 className="dd-subhead">{title}</h3>
      <table className="dd-table">
        <tbody>
          {week.standings.map((s, i) => (
            <tr key={i} className={i === 0 ? "dd-leader" : undefined}>
              <td>{i + 1}. {s.name}</td>
              <td>{s.wins}W / {s.played}P</td>
              <td>{s.avgGuesses ?? "—"} avg</td>
              <td className="dd-pts">{s.points} pts</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

function WeekendRecap({ week }: { week: DDWeek }) {
  return (
    <div className="dd-panel dd-weekend">
      <h2 className="dd-weekend-head">Weekend Edition</h2>
      <p className="dd-note">No new word until Monday. The week in review:</p>
      <table className="dd-table">
        <tbody>
          {week.days.map((d) => (
            <tr key={d.date}>
              <td>{fmtDay(d.date).split(",")[0]}</td>
              <td className="dd-word">{d.word ? d.word.toUpperCase() : "—"}</td>
              <td>{d.played > 0 ? `${d.solved}/${d.played} solved` : "no players"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <Standings week={week} title="Final standings" />
      {week.standings.length > 0 && (
        <p className="dd-crown">🏆 {week.standings[0].name} takes the week</p>
      )}
    </div>
  );
}

const CSS = `
.dd-overlay{position:fixed;inset:0;z-index:100;background:rgba(24,20,14,.55);display:flex;
  align-items:flex-start;justify-content:center;overflow-y:auto;padding:4vh 16px 6vh;}
.dd-paper{position:relative;width:min(480px,94vw);background:#f7f2e5;color:#221d15;
  font-family:Georgia,'Times New Roman',serif;border:1px solid #b8ac93;border-radius:3px;
  box-shadow:0 24px 70px rgba(0,0,0,.45), 0 2px 0 #fff inset;padding:20px 22px 26px;
  background-image:repeating-linear-gradient(0deg,transparent,transparent 27px,rgba(101,86,58,.05) 28px);}
.dd-close{position:absolute;top:8px;right:12px;border:none;background:none;font-size:26px;
  color:#6b5f49;cursor:pointer;line-height:1;font-family:inherit;}
.dd-close:hover{color:#221d15;}
.dd-masthead{text-align:center;margin-bottom:14px;}
.dd-masthead h1{font-size:34px;font-weight:900;letter-spacing:.5px;margin:6px 0;
  font-variant:small-caps;}
.dd-rule{height:2px;background:#221d15;}
.dd-rule+h1+.dd-rule{height:1px;}
.dd-dateline{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#6b5f49;
  margin-top:6px;}
.dd-grid{position:relative;display:flex;flex-direction:column;gap:7px;align-items:center;
  margin:18px 0 10px;}
.dd-row{display:flex;gap:7px;}
.dd-tile{width:56px;height:56px;border:2px solid #c7bba1;display:flex;align-items:center;
  justify-content:center;font-size:28px;font-weight:700;text-transform:uppercase;
  background:#fbf7ec;transition:border-color .15s;}
.dd-typed{border-color:#8d7f63;animation:dd-pop .12s ease;}
@keyframes dd-pop{50%{transform:scale(1.08);}}
.dd-flip{animation:dd-flipin .62s ease both;}
@keyframes dd-flipin{0%{transform:rotateX(0);background:#fbf7ec;color:#221d15;border-color:#c7bba1;}
  49%{transform:rotateX(90deg);background:#fbf7ec;color:#221d15;border-color:#c7bba1;}
  51%{transform:rotateX(90deg);}100%{transform:rotateX(0);}}
.dd-settled,.dd-flip{color:#f7f2e5;}
.dd-g.dd-settled,.dd-g.dd-flip{background:#2e6b46;border-color:#2e6b46;}
.dd-y.dd-settled,.dd-y.dd-flip{background:#c19a3d;border-color:#c19a3d;}
.dd-x.dd-settled,.dd-x.dd-flip{background:#57534a;border-color:#57534a;}
.dd-flip.dd-g{animation-name:dd-flipin-g;}
@keyframes dd-flipin-g{0%{transform:rotateX(0);background:#fbf7ec;color:#221d15;border-color:#c7bba1;}
  49%{transform:rotateX(90deg);background:#fbf7ec;color:#221d15;}
  51%{transform:rotateX(90deg);background:#2e6b46;color:#f7f2e5;border-color:#2e6b46;}
  100%{transform:rotateX(0);background:#2e6b46;color:#f7f2e5;border-color:#2e6b46;}}
.dd-flip.dd-y{animation-name:dd-flipin-y;}
@keyframes dd-flipin-y{0%{transform:rotateX(0);background:#fbf7ec;color:#221d15;border-color:#c7bba1;}
  49%{transform:rotateX(90deg);background:#fbf7ec;color:#221d15;}
  51%{transform:rotateX(90deg);background:#c19a3d;color:#f7f2e5;border-color:#c19a3d;}
  100%{transform:rotateX(0);background:#c19a3d;color:#f7f2e5;border-color:#c19a3d;}}
.dd-flip.dd-x{animation-name:dd-flipin-x;}
@keyframes dd-flipin-x{0%{transform:rotateX(0);background:#fbf7ec;color:#221d15;border-color:#c7bba1;}
  49%{transform:rotateX(90deg);background:#fbf7ec;color:#221d15;}
  51%{transform:rotateX(90deg);background:#57534a;color:#f7f2e5;border-color:#57534a;}
  100%{transform:rotateX(0);background:#57534a;color:#f7f2e5;border-color:#57534a;}}
.dd-shake{animation:dd-shake .45s;}
@keyframes dd-shake{20%{transform:translateX(-7px);}40%{transform:translateX(6px);}
  60%{transform:translateX(-4px);}80%{transform:translateX(3px);}}
.dd-stamp{position:absolute;top:38%;left:50%;transform:translate(-50%,-50%) rotate(-12deg);
  font-size:30px;font-weight:900;letter-spacing:.12em;padding:8px 18px;border:4px double currentColor;
  border-radius:6px;background:rgba(247,242,229,.88);pointer-events:none;white-space:nowrap;
  animation:dd-stampin .38s cubic-bezier(.2,1.6,.4,1) both;font-variant:small-caps;}
@keyframes dd-stampin{0%{transform:translate(-50%,-50%) rotate(-12deg) scale(2.4);opacity:0;}
  70%{opacity:1;}100%{transform:translate(-50%,-50%) rotate(-12deg) scale(1);opacity:1;}}
.dd-stamp-won{color:#2e6b46;}
.dd-stamp-lost{color:#a33327;}
.dd-note{text-align:center;font-size:14px;color:#4c4335;margin:8px 0;font-style:italic;}
.dd-hint{color:#8d7f63;}
.dd-flash{color:#a33327;font-weight:700;font-style:normal;}
.dd-linkbtn{border:none;background:none;text-decoration:underline;cursor:pointer;
  font:inherit;color:#2e5a8a;}
.dd-keys{margin-top:14px;display:flex;flex-direction:column;gap:6px;align-items:center;}
.dd-keyrow{display:flex;gap:5px;}
.dd-key{min-width:32px;height:44px;border:1px solid #b8ac93;border-radius:3px;cursor:pointer;
  font-family:inherit;font-size:14px;font-weight:700;background:#efe8d5;color:#221d15;
  padding:0 6px;}
.dd-key:active{transform:translateY(1px);}
.dd-key-wide{min-width:56px;font-size:11px;}
.dd-key-g{background:#2e6b46;border-color:#2e6b46;color:#f7f2e5;}
.dd-key-y{background:#c19a3d;border-color:#c19a3d;color:#f7f2e5;}
.dd-key-x{background:#57534a;border-color:#57534a;color:#f7f2e5;opacity:.75;}
.dd-panel{margin-top:16px;border-top:2px solid #221d15;padding-top:12px;
  animation:dd-panelin .4s ease both;}
@keyframes dd-panelin{0%{opacity:0;transform:translateY(10px);}100%{opacity:1;}}
.dd-scoreline{display:flex;gap:14px;align-items:center;justify-content:center;font-size:15px;
  margin-bottom:6px;flex-wrap:wrap;}
.dd-sharebtn{border:1px solid #221d15;background:#221d15;color:#f7f2e5;border-radius:3px;
  padding:5px 12px;cursor:pointer;font-family:inherit;font-size:13px;font-weight:700;}
.dd-sharebtn:hover{background:#3a332a;}
.dd-subhead{font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#6b5f49;
  border-bottom:1px solid #b8ac93;margin:14px 0 6px;padding-bottom:3px;font-weight:700;}
.dd-table{width:100%;font-size:14px;border-collapse:collapse;}
.dd-table td{padding:4px 6px;border-bottom:1px dotted #cfc4aa;}
.dd-pts{text-align:right;font-weight:700;}
.dd-leader td{font-weight:700;}
.dd-word{font-weight:900;letter-spacing:.1em;}
.dd-weekend-head{text-align:center;font-size:22px;font-variant:small-caps;font-weight:900;
  margin-bottom:4px;}
.dd-crown{text-align:center;font-size:15px;font-weight:700;margin-top:12px;}
@media (max-width:430px){.dd-tile{width:46px;height:46px;font-size:23px;}
  .dd-key{min-width:26px;height:40px;font-size:12px;}}
`;
