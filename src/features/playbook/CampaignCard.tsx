// Campaign tracker card (Campaigns overhaul S4) — the "beautiful display"
// Nathan asked for: status, owner, origin hint, metrics, enrollment
// progress, and Start/Pause/Resume/Stop/Delete/Analyze right on the card so
// a campaign never has to be managed by opening Smartlead.

import { useState } from "react";
import { toast } from "sonner";
import { ExternalLink, Loader2, Trash2, Play, Pause, PlayCircle, Square } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  useAnalyzeCampaign, useDeleteCampaign, useSetCampaignStatus, smartleadUrl,
  type CampaignEnrollmentStats, type CampaignStatusAction,
} from "./api";
import type { Campaign } from "./types";

export type CampaignRow = Campaign & {
  owner?: { id: string; full_name: string | null } | null;
  template?: { name: string } | null;
};

const STATUS_META: Record<string, { label: string; className: string }> = {
  draft: { label: "Draft", className: "" },
  active: { label: "Active", className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" },
  paused: { label: "Paused", className: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300" },
  completed: { label: "Complete", className: "" },
  stopped: { label: "Stopped", className: "bg-muted text-muted-foreground" },
};

/** Plain-English "where this campaign came from" hint, next to the status
 *  chip. Prefers the linked template's name (most informative); falls back
 *  to origin. */
function originHint(c: CampaignRow): string | null {
  if (c.template?.name) return c.template.name;
  if (c.origin === "smartlead_import") return "Imported from Smartlead";
  if (c.origin === "legacy") return "Migrated campaign";
  if (c.origin === "pulse") return "AI-generated sequence";
  return null;
}

function pluralize(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export function CampaignCard({
  c,
  analyze,
  del,
  setStatus,
  stats,
  inboxLabel,
}: {
  c: CampaignRow;
  analyze: ReturnType<typeof useAnalyzeCampaign>;
  del: ReturnType<typeof useDeleteCampaign>;
  setStatus: ReturnType<typeof useSetCampaignStatus>;
  stats?: CampaignEnrollmentStats;
  inboxLabel?: string | null;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [stopConfirmOpen, setStopConfirmOpen] = useState(false);
  const url = smartleadUrl(c.smartlead_campaign_id);
  const statusMeta = STATUS_META[c.status] ?? { label: c.status, className: "" };
  const a = c.analysis_json as {
    performance?: string; summary?: string; wins?: string[]; improvements?: string[];
  } | null;

  const busy = setStatus.isPending && setStatus.variables?.id === c.id;
  const busyAction = busy ? setStatus.variables?.action : null;

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
            toast.success(`Campaign started${tasks ? ` — ${pluralize(tasks, "call/LinkedIn task")} scheduled.` : "."}`);
          } else if (action === "stop") {
            const cancelled = r.tasks_cancelled ?? 0;
            toast.success(`Campaign stopped${cancelled ? ` — ${pluralize(cancelled, "task")} cancelled.` : "."}`);
          } else if (action === "pause") {
            toast.success("Campaign paused.");
          } else {
            toast.success("Campaign resumed.");
          }
        },
      },
    );
  }

  const hint = originHint(c);

  return (
    <Card className="py-0">
      <CardContent className="px-4 py-3 space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="font-semibold text-sm truncate">{c.name}</h3>
              <Badge variant="secondary" className={statusMeta.className}>{statusMeta.label}</Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {c.owner?.full_name ? `${c.owner.full_name}` : ""}
              {c.owner?.full_name && hint ? " · " : ""}
              {hint ?? ""}
              {inboxLabel ? `${(c.owner?.full_name || hint) ? " · " : ""}from ${inboxLabel}` : ""}
            </p>
            {(c.metrics?.sent != null || c.metrics?.openRate != null || c.metrics?.clickRate != null || c.metrics?.replies != null) && (
              <p className="text-xs text-muted-foreground mt-0.5">
                {c.metrics?.sent != null ? `${c.metrics.sent} sent` : ""}
                {c.metrics?.openRate != null ? ` · ${c.metrics.openRate} open` : ""}
                {c.metrics?.clickRate != null ? ` · ${c.metrics.clickRate} click` : ""}
                {c.metrics?.replies != null ? ` · ${c.metrics.replies} replies` : ""}
              </p>
            )}
            {stats && stats.total > 0 && (
              <p className="text-xs text-muted-foreground mt-0.5">
                {stats.total} {stats.total === 1 ? "person" : "people"}
                {stats.finished > 0 ? ` · ${stats.finished} finished` : ""}
                {stats.replied > 0 ? ` · ${stats.replied} replied` : ""}
              </p>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {c.status === "completed" && !c.analyzed_at && (
              <Button
                size="sm" variant="ai" className="h-7 text-xs"
                disabled={analyze.isPending}
                onClick={() => analyze.mutate(c.id)}
              >
                {analyze.isPending && analyze.variables === c.id ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : "Analyze"}
              </Button>
            )}

            {c.status === "draft" && (
              <Button
                size="sm" className="h-7 text-xs"
                disabled={busy}
                onClick={() => runStatus("start")}
              >
                {busyAction === "start" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <><Play className="h-3.5 w-3.5 mr-1" /> Start</>}
              </Button>
            )}
            {c.status === "active" && (
              <>
                <Button
                  size="sm" variant="outline" className="h-7 text-xs"
                  disabled={busy}
                  onClick={() => runStatus("pause")}
                >
                  {busyAction === "pause" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <><Pause className="h-3.5 w-3.5 mr-1" /> Pause</>}
                </Button>
                <Button
                  size="sm" variant="outline" className="h-7 text-xs text-destructive hover:text-destructive"
                  disabled={busy}
                  onClick={() => setStopConfirmOpen(true)}
                >
                  <Square className="h-3.5 w-3.5 mr-1" /> Stop
                </Button>
              </>
            )}
            {c.status === "paused" && (
              <>
                <Button
                  size="sm" variant="outline" className="h-7 text-xs"
                  disabled={busy}
                  onClick={() => runStatus("resume")}
                >
                  {busyAction === "resume" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <><PlayCircle className="h-3.5 w-3.5 mr-1" /> Resume</>}
                </Button>
                <Button
                  size="sm" variant="outline" className="h-7 text-xs text-destructive hover:text-destructive"
                  disabled={busy}
                  onClick={() => setStopConfirmOpen(true)}
                >
                  <Square className="h-3.5 w-3.5 mr-1" /> Stop
                </Button>
              </>
            )}

            {url && (
              <a href={url} target="_blank" rel="noopener noreferrer"
                className="text-xs text-primary hover:underline inline-flex items-center gap-1">
                Smartlead <ExternalLink className="h-3 w-3" />
              </a>
            )}
            {c.status === "draft" && (
              <button
                type="button"
                title="Delete campaign"
                className="p-1 text-muted-foreground hover:text-destructive"
                onClick={() => setConfirmOpen(true)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>
        {a && (
          <div className="rounded-md bg-muted/40 p-2 text-xs space-y-1">
            <p className="font-medium">
              AI analysis{a.performance ? ` · ${a.performance.replace(/_/g, " ")}` : ""}
            </p>
            {a.summary && <p className="text-muted-foreground">{a.summary}</p>}
            {a.wins?.length ? <p className="text-muted-foreground">✓ {a.wins.join("; ")}</p> : null}
            {a.improvements?.length ? <p className="text-muted-foreground">→ {a.improvements.join("; ")}</p> : null}
          </div>
        )}
      </CardContent>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
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
      </AlertDialog>

      <AlertDialog open={stopConfirmOpen} onOpenChange={setStopConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Stop this campaign?</AlertDialogTitle>
            <AlertDialogDescription>
              This halts remaining emails and cancels scheduled call/LinkedIn tasks for "{c.name}" — it can't be resumed.
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
    </Card>
  );
}
