# Pulse Mini-Games — Roadmap & Playbook

An ongoing, always-fun docket. The idea (Nathan, 2026-07-05): keep adding small
hidden mini-games to different tabs over time when there's spare capacity, each
themed to the tab it lives on, each a different *style* of game and animation.
They stay short and replayable so they're a fun 2-minute break for the Medcurity
team without eating real work time.

**This is a "pull from when we have downtime" list, not a committed sprint.**

---

## The pattern (how every mini-game should work)

The first one — **Pipeline Runner** (`src/features/pipeline-runner/`, on the
Pipeline tab) — establishes the template. Reuse it:

1. **Unlock:** triple-click the tab's own nav label in the sidebar (see the
   `secret` flag on nav items in `Sidebar.tsx` + the shared launch store).
2. **Zero idle cost:** the game component renders `null` until launched — no
   canvas, no requestAnimationFrame loop, no listeners during normal CRM use.
   Mounts only when open; tears everything down on close/unmount.
3. **Pop-up over the tab content:** a portal modal, Esc / ✕ / backdrop to close.
   Owns the keyboard only while open so it never fights app shortcuts.
4. **"Press any key to start"** ready screen; delta-time loop (frame-rate
   independent) with a long-frame clamp so a backgrounded tab can't glitch it.
5. **Public all-time top 5 + private personal best**, one small table per game
   (RLS: read-all authenticated, insert-own, no update/delete). Scores persist
   across game/CRM updates because they're data, not code.
6. **Short & replayable.** A run is a couple of minutes, tops.

Shared infra worth extracting when we build game #2: the launch store, the modal
shell (header + stage + ready/gameover overlays + leaderboard), the DPR-aware
self-healing canvas sizing, and the score/leaderboard hooks. Consider a
`src/features/minigames/` shared kit so each new game is mostly its own art +
mechanics.

---

## Theme ideas per tab

Each game's visual style and *type* of gameplay should match its tab's theme.
Rough brainstorm (mix and match; the fun is in the variety):

| Tab | Theme | Game type idea |
|---|---|---|
| Pipeline | ✅ **built** — neon/violet "close the pipeline" | endless runner |
| Accounts | Western / frontier ("stake your claim") | fast-draw reaction duel, or a wagon-dodge |
| Contacts | Japanese / zen (ink, cherry blossom) | rhythm / timing slicer, or a koi-pond catch |
| Opportunities | Outer space ("shoot for the stars") | asteroid dodger / space shooter |
| Renewals | Retro arcade ("keep the streak alive") | Breakout / paddle, or a juggling-plates timing game |
| Reports | Blueprint / synthwave grid | a snake-style "connect the data" game |
| Partners | Co-op / board-game felt | a quick match-3 or memory game |
| Calendar | Seasonal (ties to the seasonal login art) | a falling-blocks / Tetris-ish stacker |
| Meddy | Chatbot / arcade robot | a Flappy-style one-button hopper |

None of these are locked — pick whatever's fun and fits when the time comes.
Keep each one a genuinely *different* animation style so discovering a new one
feels fresh.

---

## Guardrails (so bonus fun never becomes a liability)

- **Never affect page performance.** Zero cost when not playing is non-negotiable.
- **Never block real shortcuts or navigation.** The unlock must not interfere
  with normal tab clicks.
- **Keep them hidden easter eggs** unless we decide otherwise — discovery is
  part of the delight.
- **Staging first, always.** Ship + playtest on staging before prod.
- **Fair, not infinite.** Difficulty should make top scores *hard*, not make the
  game drag on forever.

---

## Status

- **Pipeline Runner** — live in production (2026-07-05). v2 (variable jump,
  score-tiered difficulty, ceiling obstacles, richer coins, personal best) on
  staging awaiting Nathan's re-playtest before promoting.
- Everything else here is **unstarted / idea stage.**
