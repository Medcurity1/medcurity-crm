// Campaign tracker card (Campaigns overhaul S4) — the "beautiful display"
// Nathan asked for: status, owner, origin hint, metrics, enrollment
// progress, and Start/Pause/Resume/Stop/Delete/Analyze right on the card so
// a campaign never has to be managed by opening Smartlead.

import { useState } from "react";
import { toast } from "sonner";
import { ExternalLink, Loader2, Trash2, Play, Pause, PlayCircle, Square } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  useAnalyzeCampaign, useDeleteCampaign, useSetCampaignStatus, useSmartleadStatus, smartleadUrl,
  type CampaignEnrollmentStats, type CampaignStatusAction,
} from "./api";
import { shouldActivateCardKey } from "./campaign-card-keyboard";
import type { AttentionFlag } from "./needs-attention";
import type { Campaign } from "./types";

export type CampaignRow = Campaign & {
  owner?: { id: string; full_name: string | null } | null;
  template?: { name: string } | null;
};

export const STATUS_META: Record<string, { label: string; className: string }> = {
  draft: { label: "Draft", className: "" },
  active: { label: "Active", className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" },
  paused: { label: "Paused", className: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300" },
  completed: { label: "Complete", className: "" },
  stopped: { label: "Stopped", className: "bg-muted text-muted-foreground" },
};

/** Plain-English "where this campaign came from" hint, next to the status
 *  chip. Prefers the linked template's name (most informative); falls back
 *  to origin. Exported so CampaignDetailSheet's header can show the same hint. */
export function originHint(c: CampaignRow): string | null {
  if (c.template?.name) return c.template.name;
  if (c.origin === "smartlead_import") return "Imported from Smartlead";
  if (c.origin === "legacy") return "Migrated campaign";
  if (c.origin === "pulse") {
    if (c.settings?.authoring_method === "ai") return "AI-generated sequence";
    if (c.settings?.authoring_method === "write_own") return "Written in Pulse";
    if (c.settings?.authoring_method === "template") return "Template sequence";
    return "Created in Pulse";
  }
  return null;
}

function pluralize(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** Start/Pause/Resume/Stop button group + the Stop confirm dialog — shared
 *  between the tracker card and CampaignDetailSheet's header so both surfaces
 *  run the exact same mutation, toasts, and confirm copy (Campaigns overhaul
 *  S8). Takes just the fields it needs so a CampaignDetailSheet caller
 *  doesn't have to pass a full CampaignRow. */
export function CampaignStatusControls({
  c,
  setStatus,
  className,
}: {
  c: Pick<Campaign, "id" | "name" | "status">;
  setStatus: ReturnType<typeof useSetCampaignStatus>;
  className?: string;
}) {
  const [stopConfirmOpen, setStopConfirmOpen] = useState(false);
  const [startConfirmOpen, setStartConfirmOpen] = useState(false);
  const busy = setStatus.isPending && setStatus.variables?.id === c.id;
  const busyAction = busy ? setStatus.variables?.action : null;
  const { data: sl } = useSmartleadStatus();
  // Only a confirmed `false` disables Start — undefined (still loading) and
  // true both leave it enabled, so the gate never flashes on while the
  // status query is in flight. Pause/Resume/Stop stay ungated (a running
  // campaign can't exist on an unconfigured env anyway).
  const smartleadDisabled = sl?.configured === false;

  function runStatus(action: CampaignStatusAction) {
    setStatus.mutate(
      { id: c.id, action },
      {
        onSuccess: (r) => {
          if (r.warning) {
            toast.warning(r.warning);
            return;
          }
          if (action === "start") {
            const tasks = r.tasks_created ?? 0;
            toast.success(`Campaign started${tasks ? `. ${pluralize(tasks, "call/LinkedIn task")} scheduled.` : "."}`);
          } else if (action === "stop") {
            const cancelled = r.tasks_cancelled ?? 0;
            toast.success(`Campaign stopped${cancelled ? `. ${pluralize(cancelled, "task")} cancelled.` : "."}`);
          } else if (action === "pause") {
            toast.success("Campaign paused.");
          } else {
            toast.success("Campaign resumed.");
          }
        },
      },
    );
  }

  return (
    <div className={className ?? "flex items-center gap-2 shrink-0"}>
      {c.status === "draft" && (
        <button
          type="button" className="camp-btn-primary !py-1.5 !px-3 text-xs"
          disabled={busy || smartleadDisabled}
          title={smartleadDisabled ? "Connect Smartlead to start" : undefined}
          onClick={() => setStartConfirmOpen(true)}
        >
          {busyAction === "start" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <><Play className="h-3.5 w-3.5" /> Start</>}
        </button>
      )}
      {c.status === "active" && (
        <>
          <button
            type="button" className="camp-btn h-8 text-xs"
            disabled={busy}
            onClick={() => runStatus("pause")}
          >
            {busyAction === "pause" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <><Pause className="h-3.5 w-3.5" /> Pause</>}
          </button>
          <button
            type="button" className="camp-btn camp-btn--danger h-8 text-xs"
            disabled={busy}
            onClick={() => setStopConfirmOpen(true)}
          >
            <Square className="h-3.5 w-3.5" /> Stop
          </button>
        </>
      )}
      {c.status === "paused" && (
        <>
          <button
            type="button" className="camp-btn h-8 text-xs"
            disabled={busy}
            onClick={() => runStatus("resume")}
          >
            {busyAction === "resume" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <><PlayCircle className="h-3.5 w-3.5" /> Resume</>}
          </button>
          <button
            type="button" className="camp-btn camp-btn--danger h-8 text-xs"
            disabled={busy}
            onClick={() => setStopConfirmOpen(true)}
          >
            <Square className="h-3.5 w-3.5" /> Stop
          </button>
        </>
      )}

      <AlertDialog open={startConfirmOpen} onOpenChange={setStartConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Start this campaign?</AlertDialogTitle>
            <AlertDialogDescription>
              Sending begins from Pulse. Start here, not only in Smartlead, so call and LinkedIn tasks get scheduled.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { setStartConfirmOpen(false); runStatus("start"); }}
            >
              Start campaign
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={stopConfirmOpen} onOpenChange={setStopConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Stop this campaign?</AlertDialogTitle>
            <AlertDialogDescription>
              This halts remaining emails and cancels scheduled call/LinkedIn tasks for "{c.name}". It can't be resumed.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => { setStopConfirmOpen(false); runStatus("stop"); }}
            >
              Stop campaign
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export function CampaignCard({
  c,
  analyze,
  del,
  setStatus,
  stats,
  inboxLabel,
  attention,
  onOpenDetail,
  adminActions = true,
}: {
  c: CampaignRow;
  analyze: ReturnType<typeof useAnalyzeCampaign>;
  del: ReturnType<typeof useDeleteCampaign>;
  setStatus: ReturnType<typeof useSetCampaignStatus>;
  stats?: CampaignEnrollmentStats;
  inboxLabel?: string | null;
  /** "Needs you" chips (outside-review I27) — computed by CampaignsTab via
   *  campaignAttentionFlags; undefined/empty = nothing to flag. */
  attention?: AttentionFlag[];
  /** Opens the full campaign detail sheet — wired to a click anywhere on the
   *  card body (Campaigns overhaul S8). Optional so CampaignCard still works
   *  standalone without it. */
  onOpenDetail?: (c: CampaignRow) => void;
  adminActions?: boolean;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const url = smartleadUrl(c.smartlead_campaign_id);
  const statusMeta = STATUS_META[c.status] ?? { label: c.status, className: "" };
  const a = c.analysis_json as {
    performance?: string; summary?: string; wins?: string[]; improvements?: string[];
  } | null;

  const hint = originHint(c);
  const accent = (attention?.length ?? 0) > 0
    ? "attention"
    : c.status === "active" ? "active" : c.status === "paused" ? "paused" : c.status === "draft" ? "draft" : undefined;
  const hasMetrics = c.metrics?.sent != null || c.metrics?.openRate != null || c.metrics?.clickRate != null || c.metrics?.replies != null;

  return (
    <div
      className={cn("camp-row", onOpenDetail && "camp-row--clickable")}
      data-accent={accent}
      role={onOpenDetail ? "button" : undefined}
      tabIndex={onOpenDetail ? 0 : undefined}
      onClick={onOpenDetail ? () => onOpenDetail(c) : undefined}
      onKeyDown={onOpenDetail ? (e) => {
        if (!shouldActivateCardKey(e)) return;
        e.preventDefault();
        onOpenDetail(c);
      } : undefined}
    >
      <div className="px-4 py-3 pl-5 space-y-2">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-semibold text-sm truncate">{c.name}</h3>
              <Badge variant="secondary" className={statusMeta.className}>{statusMeta.label}</Badge>
              {(attention ?? []).map((f) => (
                <Badge
                  key={f.kind}
                  variant="secondary"
                  className={
                    (f.severity === "red"
                      ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300"
                      : "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300")
                    + " max-w-full truncate"
                  }
                  title={f.label}
                >
                  {f.label}
                </Badge>
              ))}
            </div>
            <p className="text-xs text-muted-foreground truncate">
              {[c.owner?.full_name, hint, inboxLabel ? `from ${inboxLabel}` : null].filter(Boolean).join(" · ")}
            </p>
            {(hasMetrics || (stats && stats.total > 0)) && (
              <div className="flex items-center gap-3 flex-wrap pt-0.5">
                {c.metrics?.sent != null && <span className="camp-stat"><strong>{c.metrics.sent}</strong> sent</span>}
                {c.metrics?.openRate != null && <span className="camp-stat"><strong>{c.metrics.openRate}</strong> open</span>}
                {c.metrics?.clickRate != null && <span className="camp-stat"><strong>{c.metrics.clickRate}</strong> click</span>}
                {c.metrics?.replies != null && (
                  // Replies are the number that matters on this card — the
                  // one metric a rep acts on today (outside-review I27).
                  <span className={cn("camp-stat", Number(c.metrics.replies) > 0 && "camp-stat--hot")}>
                    <strong>{c.metrics.replies}</strong> {Number(c.metrics.replies) === 1 ? "reply" : "replies"}
                  </span>
                )}
                {stats && stats.total > 0 && (
                  <span className="camp-stat">
                    <strong>{stats.total}</strong> {stats.total === 1 ? "person" : "people"}
                    {stats.finished > 0 ? ` · ${stats.finished} finished` : ""}
                    {stats.replied > 0 ? ` · ${stats.replied} replied` : ""}
                  </span>
                )}
              </div>
            )}
          </div>
          {/* stopPropagation so clicking any action here never also opens the
             detail sheet underneath it (Campaigns overhaul S8). */}
          <div className="flex items-center gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
            {adminActions && c.status === "completed" && !c.analyzed_at && (
              <Button
                size="sm" variant="ai" className="h-8 text-xs"
                disabled={analyze.isPending}
                onClick={() => analyze.mutate(c.id)}
              >
                {analyze.isPending && analyze.variables === c.id ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : "Analyze"}
              </Button>
            )}

            <CampaignStatusControls c={c} setStatus={setStatus} />

            {url && (
              <a href={url} target="_blank" rel="noopener noreferrer"
                className="camp-link inline-flex items-center gap-1">
                Smartlead <ExternalLink className="h-3 w-3" />
              </a>
            )}
            {adminActions && c.status === "draft" && (
              <button
                type="button"
                title="Delete campaign"
                aria-label="Delete campaign"
                className="camp-btn camp-btn--danger h-8 w-8 !p-0"
                onClick={() => setConfirmOpen(true)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
        {a && (
          <div className="rounded-lg p-2.5 text-xs space-y-1" style={{ background: "var(--camp-tint)" }}>
            <p className="font-medium">
              AI analysis{a.performance ? ` · ${a.performance.replace(/_/g, " ")}` : ""}
            </p>
            {a.summary && <p className="text-muted-foreground">{a.summary}</p>}
            {a.wins?.length ? <p className="text-muted-foreground">✓ {a.wins.join("; ")}</p> : null}
            {a.improvements?.length ? <p className="text-muted-foreground">→ {a.improvements.join("; ")}</p> : null}
          </div>
        )}
      </div>

      {adminActions && <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this campaign?</AlertDialogTitle>
            <AlertDialogDescription>
              "{c.name}" will be removed from Pulse and deleted in Smartlead. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => del.mutate({ id: c.id, smartlead_campaign_id: c.smartlead_campaign_id })}
            >
              Delete campaign
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>}
    </div>
  );
}
