import { useEffect, useState } from "react";
import { Check, ExternalLink, Clock, ThumbsUp, ThumbsDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import type { CrmRequest, RequestPriority, RequestStatus } from "@/types/crm";
import {
  REQUEST_TYPE_LABELS,
  STATUS_LABELS,
  useCompleteRequest,
  useApproveProductRequest,
  useDenyProductRequest,
  useSummarizeProductRequest,
} from "./api";

const PRIORITY_BADGE: Record<RequestPriority, string> = {
  high: "bg-red-500 text-white",
  medium: "bg-amber-500 text-white",
  low: "bg-slate-400 text-white",
};

const STATUS_BADGE: Record<RequestStatus, string> = {
  pending: "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300",
  completed: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300",
  approved: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-300",
  denied: "bg-red-100 text-red-800 dark:bg-red-500/20 dark:text-red-300",
  cancelled: "bg-slate-100 text-slate-700 dark:bg-slate-500/20 dark:text-slate-300",
};

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function detailLine(r: CrmRequest): string | null {
  const d = r.details ?? {};
  if (r.type === "collateral") {
    const bits = [d.audience, d.format].filter(Boolean) as string[];
    return bits.length ? bits.join(" · ") : null;
  }
  if (r.type === "crm" && d.change_type) return String(d.change_type);
  return null;
}

function ProductReviewDialog({
  request,
  open,
  onOpenChange,
}: {
  request: CrmRequest;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const approve = useApproveProductRequest();
  const deny = useDenyProductRequest();
  const summarize = useSummarizeProductRequest();
  const [note, setNote] = useState("");
  const [summary, setSummary] = useState<string | null>(request.ai_summary);
  const busy = approve.isPending || deny.isPending;

  // Generate the AI one-liner the first time the dialog opens (cached
  // on the request after that). No-ops gracefully if no Anthropic key.
  useEffect(() => {
    if (open && !summary && !summarize.isPending) {
      summarize.mutate(request.id, { onSuccess: (s) => setSummary(s) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Review product request</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <p className="font-semibold">{request.title}</p>
            <p className="text-xs text-muted-foreground">
              From {request.requester_name ?? request.requester?.full_name ?? "Unknown"} · {fmtDate(request.created_at)}
            </p>
          </div>
          {summary ? (
            <p className="rounded-md bg-muted px-3 py-2 text-sm italic">{summary}</p>
          ) : summarize.isPending ? (
            <p className="rounded-md bg-muted px-3 py-2 text-sm italic text-muted-foreground">
              Generating summary…
            </p>
          ) : null}
          {request.description && (
            <p className="whitespace-pre-wrap text-sm text-muted-foreground">{request.description}</p>
          )}
          <div className="space-y-2">
            <Label htmlFor="review-note">Note (optional)</Label>
            <Textarea
              id="review-note"
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Add context for your decision..."
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Approving will file this to the product team's Jira board once the Jira connection is set up.
          </p>
        </div>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            variant="outline"
            className="gap-2 text-red-600 hover:text-red-700"
            disabled={busy}
            onClick={() =>
              deny.mutate(
                { id: request.id, note: note.trim() || undefined },
                {
                  onSuccess: () => {
                    toast.success("Request denied.");
                    onOpenChange(false);
                  },
                  onError: (e) => toast.error((e as Error).message),
                },
              )
            }
          >
            <ThumbsDown className="h-4 w-4" /> Deny
          </Button>
          <Button
            className="gap-2"
            disabled={busy}
            onClick={() =>
              approve.mutate(
                { id: request.id, note: note.trim() || undefined },
                {
                  onSuccess: (res) => {
                    toast.success(
                      res?.jiraKey
                        ? `Approved — filed ${res.jiraKey} in Jira.`
                        : res && res.jiraConfigured === false
                          ? "Approved. (Jira isn't connected yet, so no ticket was filed.)"
                          : "Request approved.",
                    );
                    onOpenChange(false);
                  },
                  onError: (e) => toast.error((e as Error).message),
                },
              )
            }
          >
            <ThumbsUp className="h-4 w-4" /> Approve
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function RequestCard({
  request,
  compact = false,
}: {
  request: CrmRequest;
  compact?: boolean;
}) {
  const complete = useCompleteRequest();
  const [reviewOpen, setReviewOpen] = useState(false);
  const isPending = request.status === "pending";
  const detail = detailLine(request);

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="outline" className="text-[10px]">
              {REQUEST_TYPE_LABELS[request.type]}
            </Badge>
            <Badge className={cn("text-[10px] border-transparent", PRIORITY_BADGE[request.priority])}>
              {request.priority}
            </Badge>
            <Badge className={cn("text-[10px] border-transparent", STATUS_BADGE[request.status])}>
              {STATUS_LABELS[request.status]}
            </Badge>
          </div>
          <p className="mt-1.5 font-semibold leading-snug">{request.title}</p>
          <p className="text-xs text-muted-foreground">
            From {request.requester_name ?? request.requester?.full_name ?? "Unknown"}
            {detail ? ` · ${detail}` : ""} · {fmtDate(request.created_at)}
          </p>
        </div>
      </div>

      {!compact && request.description && (
        <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{request.description}</p>
      )}

      {request.jira_issue_url && (
        <a
          href={request.jira_issue_url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
        >
          {request.jira_issue_key ?? "View in Jira"} <ExternalLink className="h-3 w-3" />
        </a>
      )}

      {/* Actions */}
      {isPending ? (
        <div className="mt-3 flex justify-end gap-2">
          {request.type === "product" ? (
            <Button size="sm" className="gap-1.5" onClick={() => setReviewOpen(true)}>
              <ThumbsUp className="h-3.5 w-3.5" /> Review
            </Button>
          ) : (
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              disabled={complete.isPending}
              onClick={() =>
                complete.mutate(request.id, {
                  onSuccess: () => toast.success("Marked complete."),
                  onError: (e) => toast.error((e as Error).message),
                })
              }
            >
              <Check className="h-3.5 w-3.5" /> Mark complete
            </Button>
          )}
        </div>
      ) : (
        request.completed_at && (
          <p className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
            <Clock className="h-3 w-3" />
            {STATUS_LABELS[request.status]} {fmtDate(request.completed_at)}
            {request.decision_note ? ` — ${request.decision_note}` : ""}
          </p>
        )
      )}

      {request.type === "product" && (
        <ProductReviewDialog request={request} open={reviewOpen} onOpenChange={setReviewOpen} />
      )}
    </div>
  );
}
