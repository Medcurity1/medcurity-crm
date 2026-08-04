// Hand-built mini mocks, one per widget type, for the widget gallery.
//
// These are deliberately fake: bars and pills shaped like the real widget,
// no query, no data, no chance of a slow or failing fetch turning the
// gallery into a loading screen. They exist so someone who has never used
// a widget can tell at a glance what shape of thing they are about to add.
//
// Keep each one short (about four rows) and quiet: muted fills only, no
// text, so ten of them side by side read as a set rather than a wall.

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { NexusWidgetType } from "./types";

// ── Primitives ───────────────────────────────────────────────────────

function Bar({ w, className }: { w: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("block h-1.5 rounded-full bg-muted-foreground/25", className)}
      style={{ width: w }}
    />
  );
}

function Pill({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("block h-3 w-8 shrink-0 rounded-full bg-muted-foreground/15", className)}
    />
  );
}

function Row({
  lead,
  main = "70%",
  sub,
  trail,
}: {
  lead?: ReactNode;
  main?: string;
  sub?: string;
  trail?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-2">
      {lead}
      <div className="min-w-0 flex-1 space-y-1">
        <Bar w={main} />
        {sub && <Bar w={sub} className="bg-muted-foreground/15" />}
      </div>
      {trail}
    </div>
  );
}

function Dot({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("block h-2 w-2 shrink-0 rounded-full bg-muted-foreground/40", className)}
    />
  );
}

function Square({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "block h-3 w-3 shrink-0 rounded-[3px] border border-muted-foreground/35",
        className,
      )}
    />
  );
}

// ── Per-type mocks ───────────────────────────────────────────────────

const PREVIEWS: Record<NexusWidgetType, ReactNode> = {
  tasks: (
    <div className="space-y-2.5">
      <Row lead={<Square />} main="80%" trail={<Pill />} />
      <Row lead={<Square />} main="62%" trail={<Pill />} />
      <Row lead={<Square />} main="72%" trail={<Pill />} />
    </div>
  ),
  pipeline: (
    <div className="space-y-2.5">
      <Row main="70%" sub="40%" trail={<Pill />} />
      <Row main="58%" sub="34%" trail={<Pill />} />
      <Row main="66%" sub="38%" trail={<Pill />} />
    </div>
  ),
  custom_report: (
    <div className="space-y-2">
      <div className="flex items-center gap-2 border-b border-muted-foreground/15 pb-1.5">
        <Bar w="28%" className="bg-muted-foreground/35" />
        <Bar w="22%" className="bg-muted-foreground/35" />
        <Bar w="18%" className="bg-muted-foreground/35" />
      </div>
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex items-center gap-2">
          <Bar w="28%" />
          <Bar w="22%" />
          <Bar w="18%" />
        </div>
      ))}
    </div>
  ),
  pinned_records: (
    <div className="space-y-2.5">
      <Row lead={<Dot className="bg-primary/50" />} main="74%" sub="42%" />
      <Row lead={<Dot className="bg-primary/50" />} main="60%" sub="36%" />
      <Row lead={<Dot className="bg-primary/50" />} main="68%" sub="40%" />
    </div>
  ),
  requests: (
    <div className="space-y-3">
      <Row
        main="70%"
        sub="40%"
        trail={
          <span className="flex gap-1">
            <Pill className="w-6 bg-emerald-500/25" />
            <Pill className="w-6 bg-rose-500/25" />
          </span>
        }
      />
      <Row
        main="62%"
        sub="36%"
        trail={
          <span className="flex gap-1">
            <Pill className="w-6 bg-emerald-500/25" />
            <Pill className="w-6 bg-rose-500/25" />
          </span>
        }
      />
    </div>
  ),
  campaign_touches: (
    <div className="space-y-2.5">
      <Row lead={<Dot className="bg-violet-500/50" />} main="72%" trail={<Pill />} />
      <Row lead={<Dot className="bg-violet-500/50" />} main="58%" trail={<Pill />} />
      <Row lead={<Dot className="bg-violet-500/50" />} main="66%" trail={<Pill />} />
    </div>
  ),
  wins: (
    <div className="space-y-2.5">
      <Row lead={<Dot className="bg-emerald-500/60" />} main="66%" sub="38%" trail={<Pill className="bg-emerald-500/20" />} />
      <Row lead={<Dot className="bg-emerald-500/60" />} main="74%" sub="34%" trail={<Pill className="bg-emerald-500/20" />} />
      <Row lead={<Dot className="bg-emerald-500/60" />} main="60%" sub="40%" trail={<Pill className="bg-emerald-500/20" />} />
    </div>
  ),
  cold_call: (
    <div className="space-y-2.5">
      <Row lead={<Dot className="bg-amber-500/60" />} main="70%" sub="44%" trail={<Pill className="bg-primary/20" />} />
      <Row lead={<Dot className="bg-amber-500/60" />} main="62%" sub="38%" trail={<Pill className="bg-primary/20" />} />
      <Row lead={<Dot className="bg-sky-500/50" />} main="68%" sub="42%" trail={<Pill className="bg-primary/20" />} />
    </div>
  ),
  recents: (
    <div className="space-y-2.5">
      <Row lead={<Square className="rounded-full" />} main="64%" trail={<Pill className="w-6" />} />
      <Row lead={<Square className="rounded-full" />} main="76%" trail={<Pill className="w-6" />} />
      <Row lead={<Square className="rounded-full" />} main="58%" trail={<Pill className="w-6" />} />
    </div>
  ),
};

/**
 * The mini mock for a widget type, wrapped in a card that echoes the real
 * WidgetShell (accent strip, title bar, body).
 */
export function WidgetPreview({ type }: { type: NexusWidgetType }) {
  return (
    <div className="relative overflow-hidden rounded-lg border bg-card p-3">
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-1 bg-muted-foreground/20"
      />
      <div className="mb-2.5 flex items-center gap-2 pl-1.5">
        <Bar w="45%" className="h-2 bg-muted-foreground/35" />
      </div>
      <div className="pl-1.5">{PREVIEWS[type]}</div>
    </div>
  );
}
