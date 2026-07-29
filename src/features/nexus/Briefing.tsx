// The Briefing: Nexus's anchor above the widget grid (docket C2, phase 1).
//
// Look per docs/nexus/nexus-look-options.html (the CHOSEN section): hero
// greeting with a counts line and quick actions, then the three highest
// ranked queue rows as cards, then a divider above the widget grid
// everyone already has.
//
// Copy rules (docs/nexus/your-day-plan.md, Nathan 2026-07-29): no em
// dashes, no filler, sentence case, counts and plain phrases only.
//
// The briefing is a read of rep_day_queue and nothing else. If that read
// fails it renders nothing at all, so Nexus degrades to exactly the page
// it is today rather than showing a broken banner.

import { useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Plus, Phone, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/features/auth/AuthProvider";
import { QuickTaskDialog } from "@/features/activities/QuickTaskDialog";
import { useDayQueue, useSnoozeDayItem, type DayQueueRow } from "./day-queue-api";
import { NEXUS_IS_LANDING, NEXUS_FEEDBACK_LINK } from "./landing-flip";
import { getHeroTheme, useHeroTheme } from "./hero-themes";

// ── Copy helpers ─────────────────────────────────────────────────────

function greetingForHour(hour: number): string {
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function firstNameOf(fullName: string | null | undefined): string | null {
  const first = (fullName ?? "").trim().split(/\s+/)[0];
  return first || null;
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * The counts line: only the kinds the user actually has, in a fixed
 * order, middot separated. Tasks and campaign tasks read as one number
 * (a campaign step is still a task on your list); anything the server
 * starts emitting that we do not have wording for lands in "more items"
 * so a new branch never goes invisible.
 */
export function buildCountsLine(rows: DayQueueRow[]): string {
  const n = (kinds: string[]) =>
    rows.filter((r) => kinds.includes(r.kind)).length;

  const known = [
    "reply",
    "request",
    "renewal",
    "task",
    "campaign_task",
    "outreach_paused",
    "stale_deal",
  ];
  const parts: string[] = [];

  const replies = n(["reply"]);
  if (replies) parts.push(`${plural(replies, "reply", "replies")} waiting`);

  const requests = n(["request"]);
  if (requests) parts.push(`${plural(requests, "request", "requests")} waiting`);

  const renewals = n(["renewal"]);
  if (renewals)
    parts.push(`${plural(renewals, "renewal", "renewals")} in window`);

  const tasks = n(["task", "campaign_task"]);
  if (tasks) parts.push(`${plural(tasks, "task", "tasks")} due today`);

  const paused = n(["outreach_paused"]);
  if (paused)
    parts.push(
      `${plural(paused, "paused conversation", "paused conversations")}`,
    );

  const stale = n(["stale_deal"]);
  if (stale) parts.push(`${plural(stale, "quiet deal", "quiet deals")}`);

  const other = rows.filter((r) => !known.includes(r.kind)).length;
  if (other) parts.push(`${plural(other, "more item", "more items")}`);

  return parts.join(" · ");
}

// ── Per-kind presentation ────────────────────────────────────────────

const KIND_DOT: Record<string, string> = {
  reply: "bg-rose-500 dark:bg-rose-400",
  request: "bg-sky-500 dark:bg-sky-400",
  renewal: "bg-blue-500 dark:bg-blue-400",
  task: "bg-amber-500 dark:bg-amber-400",
  campaign_task: "bg-violet-500 dark:bg-violet-400",
  outreach_paused: "bg-violet-500 dark:bg-violet-400",
  stale_deal: "bg-slate-400 dark:bg-slate-500",
};

function dotClass(kind: string): string {
  return KIND_DOT[kind] ?? "bg-slate-400 dark:bg-slate-500";
}

/** True when a task row's due date is already behind us (local day). */
function isOverdue(row: DayQueueRow): boolean {
  if (row.due_at) {
    const due = new Date(row.due_at);
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    return due.getTime() < startOfToday.getTime();
  }
  return (row.reason ?? "").startsWith("Overdue");
}

/** The small uppercase label on a card ("Answer first", "Due today", …). */
export function cardLabel(row: DayQueueRow): string {
  switch (row.kind) {
    case "reply":
      return "Answer first";
    case "renewal":
      return "Renewal window";
    case "task":
    case "campaign_task":
      return isOverdue(row) ? "Overdue" : "Due today";
    case "outreach_paused":
      return "Deal opened";
    case "stale_deal":
      return "Going quiet";
    default:
      return "Waiting on you";
  }
}

/**
 * Where the primary button goes, and what it says. Unknown kinds fall
 * back to whatever record the row points at, so a branch added
 * server-side is useful the day it ships.
 */
export function primaryAction(row: DayQueueRow): { label: string; to: string } {
  switch (row.kind) {
    case "reply":
      return { label: "Open reply", to: "/playbook" };
    case "task":
    case "campaign_task":
      return { label: "Open task", to: "/activities" };
    case "renewal":
      return {
        label: "Open account",
        to: row.account_id ? `/accounts/${row.account_id}` : "/accounts",
      };
    case "stale_deal":
      return {
        label: "Open deal",
        to: row.opportunity_id
          ? `/opportunities/${row.opportunity_id}`
          : row.account_id
            ? `/accounts/${row.account_id}`
            : "/opportunities",
      };
    case "outreach_paused":
      return {
        label: "Open account",
        to: row.account_id ? `/accounts/${row.account_id}` : "/activities",
      };
    case "request":
      return { label: "Open request", to: "/requests" };
    default: {
      if (row.opportunity_id)
        return { label: "Open", to: `/opportunities/${row.opportunity_id}` };
      if (row.account_id)
        return { label: "Open", to: `/accounts/${row.account_id}` };
      if (row.contact_id)
        return { label: "Open", to: `/contacts/${row.contact_id}` };
      return { label: "Open", to: "/activities" };
    }
  }
}

// ── Component ────────────────────────────────────────────────────────

export interface BriefingProps {
  /**
   * Rendered on the right of the "Your widgets" divider row. Nexus passes
   * its Customize button here so the briefing owns the whole header
   * without any new widget-management UI being invented.
   */
  dividerActions?: ReactNode;
  /**
   * Pinned widgets, rendered between the top three and the divider. Nexus
   * passes the FeaturedWidgets strip; the briefing just gives it a home.
   */
  featuredSlot?: ReactNode;
  /**
   * The Customize bar (hero swatches and the mode hint). Sits directly
   * above the divider so the controls are next to what they change.
   */
  customizeSlot?: ReactNode;
}

export function Briefing({
  dividerActions,
  featuredSlot,
  customizeSlot,
}: BriefingProps) {
  const { profile, user } = useAuth();
  const [heroThemeId] = useHeroTheme(user?.id);
  const heroTheme = getHeroTheme(heroThemeId);
  const navigate = useNavigate();
  const { data, isLoading, isError, error } = useDayQueue();
  const snooze = useSnoozeDayItem();
  const [showAll, setShowAll] = useState(false);
  const [taskOpen, setTaskOpen] = useState(false);

  const rows = useMemo(() => data ?? [], [data]);
  const countsLine = useMemo(
    () => (rows.length ? buildCountsLine(rows) : "You're all caught up."),
    [rows],
  );

  if (isError) {
    // Never break the tab over a briefing. Nexus falls back to the grid.
    console.error("Nexus briefing: day queue failed to load", error);
    return null;
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-28 w-full rounded-xl" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-28 w-full rounded-xl" />
          ))}
        </div>
        {customizeSlot}
        {featuredSlot}
        <DividerRow actions={dividerActions} />
      </div>
    );
  }

  const name = firstNameOf(profile?.full_name);
  const greeting = greetingForHour(new Date().getHours());
  const top = rows.slice(0, 3);
  const rest = rows.slice(3);

  return (
    <div className="space-y-4">
      {/* Hero. data-tour is the first-visit tour's anchor (NexusTour.tsx);
          it has no effect until swap day. */}
      <div
        data-tour="hero"
        className="relative overflow-hidden rounded-xl border border-border/60 px-5 py-4"
      >
        {/* Two gradient layers, one per theme, swapped in CSS so a
            light/dark switch never waits on a re-render. The chosen preset
            lives in localStorage (hero-themes.ts); Evergreen is default. */}
        <span
          aria-hidden
          className="absolute inset-0 dark:hidden"
          style={{ backgroundImage: heroTheme.light }}
        />
        <span
          aria-hidden
          className="absolute inset-0 hidden dark:block"
          style={{ backgroundImage: heroTheme.dark }}
        />
        <div className="relative flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-xl font-semibold tracking-tight">
              {name ? `${greeting}, ${name}.` : `${greeting}.`}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">{countsLine}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => setTaskOpen(true)}>
              <Plus className="mr-1 h-4 w-4" />
              Task
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => navigate("/contacts/new")}
            >
              <Plus className="mr-1 h-4 w-4" />
              Contact
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => navigate("/activities?type=call&owner=me")}
            >
              <Phone className="mr-1 h-4 w-4" />
              Log call
            </Button>
          </div>
        </div>
      </div>

      {/* Customize mode banner, directly under the hero it restyles. */}
      {customizeSlot}

      {/* Top 3 */}
      {top.length > 0 && (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          {top.map((row, i) => (
            <BriefingCard
              key={row.item_key}
              row={row}
              rank={i + 1}
              onOpen={(to) => navigate(to)}
              onSnooze={() => snooze.mutate(row.item_key)}
              snoozing={snooze.isPending}
            />
          ))}
        </div>
      )}

      {/* The rest, on request */}
      {rest.length > 0 && (
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => setShowAll((s) => !s)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            {showAll ? (
              <ChevronUp className="h-3.5 w-3.5" />
            ) : (
              <ChevronDown className="h-3.5 w-3.5" />
            )}
            {showAll ? "Show less" : `See all (${rows.length})`}
          </button>
          {showAll && (
            <div className="space-y-2">
              {rest.map((row) => (
                <BriefingListRow
                  key={row.item_key}
                  row={row}
                  onOpen={(to) => navigate(to)}
                  onSnooze={() => snooze.mutate(row.item_key)}
                  snoozing={snooze.isPending}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Pinned widgets, above the divider by definition. */}
      {featuredSlot}

      <DividerRow actions={dividerActions} />

      {/* Reuses the app's standard task dialog, with its attach-to-record
          picker, rather than inventing a second one. */}
      <QuickTaskDialog open={taskOpen} onOpenChange={setTaskOpen} />
    </div>
  );
}

function DividerRow({ actions }: { actions?: ReactNode }) {
  return (
    <div data-tour="widgets" className="flex items-center gap-3 pt-1">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">
        Your widgets
      </span>
      <span className="flex-1 border-t border-dashed border-border" />
      {/* Transition-only escape hatch: live while Nexus is the landing
          page and Home is still fresh in everyone's memory. Both flags
          live in landing-flip.ts. */}
      {NEXUS_IS_LANDING && NEXUS_FEEDBACK_LINK && (
        <Link
          to="/requests"
          className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
        >
          Something missing?
        </Link>
      )}
      {actions}
    </div>
  );
}

function BriefingCard({
  row,
  rank,
  onOpen,
  onSnooze,
  snoozing,
}: {
  row: DayQueueRow;
  rank: number;
  onOpen: (to: string) => void;
  onSnooze: () => void;
  snoozing: boolean;
}) {
  const action = primaryAction(row);
  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-card p-4">
      <p className="text-xs uppercase tracking-wide text-muted-foreground">
        {rank} · {cardLabel(row)}
      </p>
      <div className="flex items-start gap-2.5 min-w-0">
        <span
          aria-hidden
          className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", dotClass(row.kind))}
        />
        <div className="min-w-0">
          <p className="text-sm font-medium leading-snug">
            {row.title ?? "Untitled"}
          </p>
          {row.reason && (
            <p className="mt-0.5 text-xs text-muted-foreground">{row.reason}</p>
          )}
        </div>
      </div>
      <div className="mt-auto flex items-center gap-2">
        <Button size="sm" className="flex-1" onClick={() => onOpen(action.to)}>
          {action.label}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="text-muted-foreground"
          onClick={onSnooze}
          disabled={snoozing}
        >
          Not today
        </Button>
      </div>
    </div>
  );
}

function BriefingListRow({
  row,
  onOpen,
  onSnooze,
  snoozing,
}: {
  row: DayQueueRow;
  onOpen: (to: string) => void;
  onSnooze: () => void;
  snoozing: boolean;
}) {
  const action = primaryAction(row);
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-card px-3 py-2">
      <span
        aria-hidden
        className={cn("h-2 w-2 shrink-0 rounded-full", dotClass(row.kind))}
      />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{row.title ?? "Untitled"}</p>
        {row.reason && (
          <p className="truncate text-xs text-muted-foreground">{row.reason}</p>
        )}
      </div>
      <Button size="sm" variant="outline" onClick={() => onOpen(action.to)}>
        {action.label}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="text-muted-foreground"
        onClick={onSnooze}
        disabled={snoozing}
      >
        Not today
      </Button>
    </div>
  );
}
