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

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Plus, Phone, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/features/auth/AuthProvider";
import { QuickTaskDialog } from "@/features/activities/QuickTaskDialog";
import { useDayQueue, useSnoozeDayItem, type DayQueueRow } from "./day-queue-api";
import { NEXUS_FEEDBACK_LINK } from "./landing-flip";
import { useRequestDialog } from "@/features/requests/RequestDialogProvider";
import { RequestDetailDialog } from "@/features/requests/RequestCard";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { toast } from "sonner";
import type { CrmRequest } from "@/types/crm";
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
/** The request id rides in item_key ('request:<uuid>' — day-queue requests
 * branch migration). Null for every other kind. */
export function requestIdOf(row: DayQueueRow): string | null {
  if (row.kind !== "request") return null;
  return row.item_key.startsWith("request:")
    ? row.item_key.slice("request:".length)
    : null;
}

/** The task's activity id, for BOTH task kinds — a campaign_task is the
 * same activities row with an enrollment attached. rep_day_queue fills
 * row.task_id (a.id) directly; item_key 'task:<uuid>' is the fallback for
 * any older cached row shape. Null when unreadable. */
export function taskIdOf(row: DayQueueRow): string | null {
  if (row.kind !== "task" && row.kind !== "campaign_task") return null;
  if (row.task_id) return row.task_id;
  return row.item_key.startsWith("task:")
    ? row.item_key.slice("task:".length)
    : null;
}

export function primaryAction(row: DayQueueRow, isAdmin = true): { label: string; to: string } {
  switch (row.kind) {
    case "reply":
      // /playbook is admin-gated; a rep clicking it would silently bounce
      // to /accounts (pre-promote sweep #3). Reps land on the contact
      // instead, where the reply thread lives from their side.
      if (!isAdmin) {
        return {
          label: "Open contact",
          to: row.contact_id ? `/contacts/${row.contact_id}` : "/contacts",
        };
      }
      return { label: "Open reply", to: "/playbook" };
    case "task":
    case "campaign_task": {
      // Molly's 8/12 ticket ("open the account and task directly to
      // manage"), Nathan's reading: land on the ACCOUNT with the task
      // popped open on top. ?open_task= is the existing reminder
      // deep-link — DetailPageLayout flips the side panel to Tasks and
      // TasksPanel opens the edit dialog. Tasks without an account fall
      // back to the task's own page; unreadable rows to the log.
      const taskId = taskIdOf(row);
      if (taskId && row.account_id) {
        return {
          label: "Open task",
          to: `/accounts/${row.account_id}?open_task=${taskId}`,
        };
      }
      return {
        label: "Open task",
        to: taskId ? `/activities/${taskId}` : "/activities",
      };
    }
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
      // Jordan M's 8/4 request: this used to dump her on the submit form.
      // BriefingCard/ListRow intercept request rows and open the specific
      // request in a dialog right here (requestIdOf below); this `to` is
      // only the fallback if the id can't be read or the fetch fails.
      return { label: "View request", to: "/admin?tab=requests" };
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
  /**
   * The Metrics strip (Nathan 8/4): its own section under the three
   * surfaced items and above the pinned widgets / divider.
   */
  metricsSlot?: ReactNode;
}

export function Briefing({
  dividerActions,
  featuredSlot,
  customizeSlot,
  metricsSlot,
}: BriefingProps) {
  const { profile, user } = useAuth();
  const isAdmin = ["admin", "super_admin"].includes(
    ((profile as { role?: string } | null)?.role ?? ""),
  );
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

  // "View request" opens the actual request right here (Jordan M, 8/4)
  // instead of navigating anywhere. Falls back to the admin inbox if the
  // row can't be fetched (deleted, or RLS says no).
  const [requestId, setRequestId] = useState<string | null>(null);
  // Bell deep-link (Nathan 8/4): a request notification navigates to
  // /nexus?request=<id>; open that request's dialog and strip the param
  // so refresh/back doesn't reopen it.
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const rid = searchParams.get("request");
    if (!rid) return;
    setRequestId(rid);
    const next = new URLSearchParams(searchParams);
    next.delete("request");
    setSearchParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);
  const requestQuery = useQuery({
    queryKey: ["briefing-request", requestId],
    enabled: !!requestId,
    queryFn: async () => {
      const { data: req, error: reqError } = await supabase
        .from("requests")
        .select("*")
        .eq("id", requestId!)
        .maybeSingle();
      if (reqError) throw reqError;
      return (req ?? null) as CrmRequest | null;
    },
  });
  const requestLookupFailed =
    !!requestId &&
    (requestQuery.isError || (requestQuery.isSuccess && requestQuery.data === null));
  useEffect(() => {
    if (!requestLookupFailed) return;
    toast.error("Couldn't open that request. Taking you to the inbox instead.");
    setRequestId(null);
    navigate("/admin?tab=requests");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestLookupFailed]);

  function handleOpen(row: DayQueueRow, to: string) {
    const reqId = requestIdOf(row);
    if (reqId) {
      setRequestId(reqId);
      return;
    }
    navigate(to);
  }

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
        {metricsSlot}
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
              isAdmin={isAdmin}
              rank={i + 1}
              onOpen={(to) => handleOpen(row, to)}
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
                  isAdmin={isAdmin}
                  onOpen={(to) => handleOpen(row, to)}
                  onSnooze={() => snooze.mutate(row.item_key)}
                  snoozing={snooze.isPending}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Metrics strip: its own section under the surfaced items (Nathan 8/4). */}
      {metricsSlot}

      {/* Pinned widgets, above the divider by definition. */}
      {featuredSlot}

      <DividerRow actions={dividerActions} />

      {/* Reuses the app's standard task dialog, with its attach-to-record
          picker, rather than inventing a second one. */}
      <QuickTaskDialog open={taskOpen} onOpenChange={setTaskOpen} />

      {/* The specific request a "View request" click referred to (Jordan
          M, 8/4). Mounted only while open; closing clears the id. */}
      {requestId && requestQuery.data && (
        <RequestDetailDialog
          request={requestQuery.data}
          open
          onOpenChange={(o) => {
            if (!o) setRequestId(null);
          }}
        />
      )}
    </div>
  );
}

function DividerRow({ actions }: { actions?: ReactNode }) {
  const { openRequestDialog } = useRequestDialog();
  return (
    <div data-tour="widgets" className="flex items-center gap-3 pt-1">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">
        Your widgets
      </span>
      <span className="flex-1 border-t border-dashed border-border" />
      {/* Transition-only escape hatch: live while Nexus is the landing
          page and Home is still fresh in everyone's memory. Both flags
          live in landing-flip.ts. Opens the Submit Request popup on the
          CRM form (the tab it used to deep-link to). */}
      {NEXUS_FEEDBACK_LINK && (
        <button
          type="button"
          onClick={() => openRequestDialog("crm")}
          className="text-xs text-primary underline underline-offset-4 hover:text-primary/80"
        >
          Something missing?
        </button>
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
  isAdmin,
}: {
  row: DayQueueRow;
  rank: number;
  onOpen: (to: string) => void;
  onSnooze: () => void;
  snoozing: boolean;
  isAdmin: boolean;
}) {
  const action = primaryAction(row, isAdmin);
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
  isAdmin,
}: {
  row: DayQueueRow;
  onOpen: (to: string) => void;
  onSnooze: () => void;
  snoozing: boolean;
  isAdmin: boolean;
}) {
  const action = primaryAction(row, isAdmin);
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
