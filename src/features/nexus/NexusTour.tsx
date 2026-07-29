// The Nexus first-visit tour: three popups, shown once, ever.
//
// Armed only by NEXUS_IS_LANDING (see landing-flip.ts). Until swap day
// this component returns null before it runs a single hook, so it costs
// nothing to leave wired into NexusPage.
//
// Shape (Nathan, 2026-07-29): exactly three steps, each pinned to a real
// piece of the page, no skip button, one button per step that only moves
// forward. Small team, so it should feel like a treat, not a chore.
//
// Copy rules, same as the briefing: no em dashes, no filler, sentence
// case, short plain phrases.
//
// PREVIEW (staging only): set localStorage key `nexus_tour_preview` to
// "1" in the browser console and reload. That arms the tour for that one
// browser without touching the flip point, ignores an existing done key,
// and never writes one, so it can be replayed as many times as you like.
// A normal user never has that key, so this can't fire for them.

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAuth } from "@/features/auth/AuthProvider";
import { NEXUS_IS_LANDING, NEXUS_FEEDBACK_LINK } from "./landing-flip";

// ── Arming ───────────────────────────────────────────────────────────

function readPreviewFlag(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem("nexus_tour_preview") === "1";
  } catch {
    return false;
  }
}

/** Read once at module load so the armed check is a constant per session. */
const PREVIEW = readPreviewFlag();
const TOUR_ARMED = NEXUS_IS_LANDING || PREVIEW;

export function tourStorageKey(userId: string): string {
  return `nexus_tour_done:${userId}`;
}

function hasSeenTour(userId: string): boolean {
  try {
    return window.localStorage.getItem(tourStorageKey(userId)) === "1";
  } catch {
    return false;
  }
}

function markTourSeen(userId: string): void {
  try {
    window.localStorage.setItem(tourStorageKey(userId), "1");
  } catch {
    /* private mode or full storage: worst case the tour shows again */
  }
}

// ── The three steps ──────────────────────────────────────────────────

interface TourStep {
  /** Matches a data-tour attribute in Briefing.tsx / NexusPage.tsx. */
  anchor: string;
  title: string;
  body: string;
  button: string;
}

const STEPS: TourStep[] = [
  {
    anchor: "hero",
    title: "Your briefing",
    body: "This is what needs you today, ranked so the top one matters most. Open it with one click, or push it to tomorrow with Not today.",
    button: "Next",
  },
  {
    anchor: "widgets",
    title: "Your widgets",
    body: "Everything from Home lives here now. Same widgets, still yours to arrange.",
    button: "Next",
  },
  {
    anchor: "add-widget",
    title: "Make it yours",
    body:
      NEXUS_IS_LANDING && NEXUS_FEEDBACK_LINK
        ? "Customize is where you add, remove, rearrange, and pin widgets. If something you need is missing, use the Something missing link."
        : "Customize is where you add, remove, rearrange, and pin widgets. If something you need is missing, send it from the Requests tab.",
    button: "Got it",
  },
];

// How long to wait for the anchors to show up before giving up on the
// tour for this visit. The briefing renders skeletons first, so the hero
// is not in the DOM on the very first frame.
const ANCHOR_WAIT_MS = 5000;
const ANCHOR_POLL_MS = 120;

// The highlight glides between steps and the page scrolls smoothly, so
// keep re-measuring for a moment after each step change.
const SETTLE_MS = 800;

// Geometry.
const HOLE_PAD = 8;
const CARD_W = 320;
const CARD_H_EST = 210;
const GAP = 14;
const EDGE = 12;

interface Frame {
  top: number;
  left: number;
  width: number;
  height: number;
  vw: number;
  vh: number;
}

function anchorEl(name: string): HTMLElement | null {
  if (typeof document === "undefined") return null;
  return document.querySelector<HTMLElement>(`[data-tour="${name}"]`);
}

function sameFrame(a: Frame, b: Frame): boolean {
  return (
    Math.abs(a.top - b.top) < 0.5 &&
    Math.abs(a.left - b.left) < 0.5 &&
    Math.abs(a.width - b.width) < 0.5 &&
    Math.abs(a.height - b.height) < 0.5 &&
    a.vw === b.vw &&
    a.vh === b.vh
  );
}

// ── Component ────────────────────────────────────────────────────────

/**
 * Rendered by NexusPage. Returns null before any hook runs when the tour
 * is not armed, so the dormant path is a single boolean check.
 */
export function NexusTour() {
  if (!TOUR_ARMED) return null;
  return <NexusTourRunner />;
}

type Phase = "waiting" | "running" | "off";

function NexusTourRunner() {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [phase, setPhase] = useState<Phase>("waiting");
  const [step, setStep] = useState(0);
  const [frame, setFrame] = useState<Frame | null>(null);

  // Wait for every anchor to exist before starting. If they never all
  // show up (the briefing failed and fell back to the plain header, say)
  // the tour quietly stands down for this visit and does NOT record
  // itself as seen, so the user still gets it next time.
  useEffect(() => {
    if (phase !== "waiting" || !userId) return;
    if (!PREVIEW && hasSeenTour(userId)) {
      setPhase("off");
      return;
    }

    let cancelled = false;
    let timer = 0;
    const deadline = Date.now() + ANCHOR_WAIT_MS;

    const tick = () => {
      if (cancelled) return;
      if (STEPS.every((s) => anchorEl(s.anchor))) {
        setPhase("running");
        return;
      }
      if (Date.now() > deadline) {
        setPhase("off");
        return;
      }
      timer = window.setTimeout(tick, ANCHOR_POLL_MS);
    };
    tick();

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [phase, userId]);

  // Measure the current step's anchor, keep it measured through the
  // smooth scroll, and stay honest on resize and scroll.
  useEffect(() => {
    if (phase !== "running") return;
    const el = anchorEl(STEPS[step].anchor);
    if (!el) {
      // Anchor disappeared mid tour (a refetch re-rendered the briefing
      // into an error state). Leave quietly, no done key.
      setPhase("off");
      return;
    }

    el.scrollIntoView({ block: "center", behavior: "smooth" });

    const measure = () => {
      const r = el.getBoundingClientRect();
      const next: Frame = {
        top: r.top,
        left: r.left,
        width: r.width,
        height: r.height,
        vw: window.innerWidth,
        vh: window.innerHeight,
      };
      setFrame((prev) => (prev && sameFrame(prev, next) ? prev : next));
    };

    let raf = 0;
    const deadline = Date.now() + SETTLE_MS;
    const settle = () => {
      measure();
      if (Date.now() < deadline) raf = requestAnimationFrame(settle);
    };
    settle();

    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [phase, step]);

  if (phase !== "running" || !frame) return null;

  const current = STEPS[step];
  const last = step === STEPS.length - 1;

  function advance() {
    if (!last) {
      setStep((s) => s + 1);
      return;
    }
    // Preview runs never persist, so Nathan can replay it.
    if (!PREVIEW && userId) markTourSeen(userId);
    setPhase("off");
  }

  // Hole around the anchor, then the card next to it.
  const hole = {
    top: frame.top - HOLE_PAD,
    left: frame.left - HOLE_PAD,
    width: frame.width + HOLE_PAD * 2,
    height: frame.height + HOLE_PAD * 2,
  };

  const roomBelow = frame.vh - (hole.top + hole.height) - GAP;
  const below = roomBelow >= CARD_H_EST || hole.top < CARD_H_EST + GAP;
  const cardTop = below
    ? Math.min(hole.top + hole.height + GAP, frame.vh - CARD_H_EST - EDGE)
    : Math.max(EDGE, hole.top - GAP - CARD_H_EST);

  const centerX = frame.left + frame.width / 2;
  const cardLeft = Math.max(
    EDGE,
    Math.min(centerX - CARD_W / 2, frame.vw - CARD_W - EDGE),
  );
  const arrowLeft = Math.max(18, Math.min(centerX - cardLeft, CARD_W - 18));

  return createPortal(
    <div
      className="fixed inset-0 z-[120]"
      role="dialog"
      aria-modal="true"
      aria-label="Nexus tour"
    >
      {/* Dim everything, cut a rounded hole around the anchor, ring it. */}
      <div
        aria-hidden
        className="pointer-events-none absolute rounded-2xl transition-all duration-500 ease-out"
        style={{
          top: hole.top,
          left: hole.left,
          width: hole.width,
          height: hole.height,
          boxShadow:
            "0 0 0 2px rgba(52, 211, 153, 0.85), 0 0 0 9999px rgba(2, 6, 23, 0.55)",
        }}
      />

      {/* The card */}
      <div
        key={step}
        className={cn(
          "absolute rounded-2xl border border-emerald-200/80 p-4 shadow-2xl",
          "bg-gradient-to-br from-emerald-50 via-card to-sky-50",
          "dark:border-emerald-800/70 dark:from-emerald-950 dark:via-card dark:to-sky-950",
          "animate-in fade-in zoom-in-95 duration-300",
        )}
        style={{ top: cardTop, left: cardLeft, width: CARD_W }}
      >
        {/* Little arrow pointing at the highlighted piece */}
        <span
          aria-hidden
          className={cn(
            "absolute h-3 w-3 rotate-45",
            below
              ? "-top-[7px] border-t border-l border-emerald-200/80 bg-emerald-50 dark:border-emerald-800/70 dark:bg-emerald-950"
              : "-bottom-[7px] border-r border-b border-emerald-200/80 bg-sky-50 dark:border-emerald-800/70 dark:bg-sky-950",
          )}
          style={{ left: arrowLeft - 6 }}
        />

        <p className="text-[11px] font-medium uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
          {step + 1} of {STEPS.length}
        </p>
        <h2 className="mt-1 text-base font-semibold tracking-tight">
          {current.title}
        </h2>
        <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
          {current.body}
        </p>

        <div className="mt-4 flex items-center justify-between">
          <div className="flex items-center gap-1.5" aria-hidden>
            {STEPS.map((s, i) => (
              <span
                key={s.anchor}
                className={cn(
                  "h-1.5 rounded-full transition-all duration-300",
                  i === step
                    ? "w-5 bg-emerald-500"
                    : i < step
                      ? "w-1.5 bg-emerald-400/70"
                      : "w-1.5 bg-border",
                )}
              />
            ))}
          </div>
          <Button size="sm" autoFocus onClick={advance}>
            {current.button}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
