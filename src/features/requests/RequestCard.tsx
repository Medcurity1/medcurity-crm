import { useEffect, useRef, useState } from "react";
import {
  Check,
  Clock,
  Copy,
  Download,
  ExternalLink,
  Paperclip,
  RefreshCw,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
} from "lucide-react";
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
  useGenerateDesignPrompt,
  useRequestAttachments,
  downloadAttachment,
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

function fmtSize(bytes: number | null): string {
  if (bytes == null) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Labeled type-specific fields from the details jsonb, for the popup. */
function detailFields(r: CrmRequest): Array<[string, string]> {
  const d = (r.details ?? {}) as Record<string, unknown>;
  const str = (k: string) => {
    const v = d[k];
    return typeof v === "string" && v.trim() ? v.trim() : null;
  };
  const rows: Array<[string, string | null]> =
    r.type === "collateral"
      ? [
          ["Audience", str("audience")],
          ["Preferred format", str("format")],
          ["Partner or event", str("partner_or_event")],
          ["How it will be used", str("usage")],
        ]
      : r.type === "crm"
        ? [["Type of change", str("change_type")]]
        : [];
  return rows.filter((x): x is [string, string] => x[1] !== null);
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[130px_1fr] gap-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="min-w-0">{value}</span>
    </div>
  );
}

/**
 * Full-detail popup: every submitted field, attachments (downloadable),
 * and the actions — mark complete for collateral/CRM, approve/deny (with
 * AI summary) for product. Opened by clicking anywhere on the row.
 */
function RequestDetailDialog({
  request,
  open,
  onOpenChange,
}: {
  request: CrmRequest;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const complete = useCompleteRequest();
  const approve = useApproveProductRequest();
  const deny = useDenyProductRequest();
  const summarize = useSummarizeProductRequest();
  const designPromptMutation = useGenerateDesignPrompt();
  const { data: attachments } = useRequestAttachments(request.id, open);
  const [note, setNote] = useState("");
  const [summary, setSummary] = useState<string | null>(request.ai_summary);
  const [designPrompt, setDesignPrompt] = useState<string | null>(
    request.design_prompt,
  );
  const [designUploadFiles, setDesignUploadFiles] = useState<string[]>([]);
  const triedSummarize = useRef(false);
  const busy = approve.isPending || deny.isPending || complete.isPending;
  const isPending = request.status === "pending";
  const isProduct = request.type === "product";
  const isCollateral = request.type === "collateral";

  function runDesignPrompt(regenerate: boolean) {
    designPromptMutation.mutate(
      { id: request.id, regenerate },
      {
        onSuccess: (res) => {
          setDesignPrompt(res.prompt);
          setDesignUploadFiles(res.uploadFiles ?? []);
        },
        onError: (e) =>
          toast.error("Could not generate the design prompt: " + (e as Error).message),
      },
    );
  }

  function copyDesignPrompt() {
    if (!designPrompt) return;
    navigator.clipboard
      .writeText(designPrompt)
      .then(() => toast.success("Design prompt copied. Paste it into Claude design."))
      .catch(() => toast.error("Could not copy to clipboard."));
  }

  // Product only: generate the AI one-liner on first open (cached on the
  // request after that; ref stops re-calls when no summary comes back).
  useEffect(() => {
    if (isProduct && open && !summary && !summarize.isPending && !triedSummarize.current) {
      triedSummarize.current = true;
      summarize.mutate(request.id, { onSuccess: (s) => setSummary(s) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const fields = detailFields(request);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="pr-8 leading-snug">{request.title}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
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

          {isProduct && (summary || summarize.isPending) && (
            <p className="rounded-md bg-muted px-3 py-2 text-sm italic">
              {summary ?? "Generating summary…"}
            </p>
          )}

          <div className="space-y-1.5">
            <DetailRow
              label="From"
              value={request.requester_name ?? request.requester?.full_name ?? "Unknown"}
            />
            <DetailRow label="Submitted" value={fmtDate(request.created_at)} />
            {fields.map(([label, value]) => (
              <DetailRow key={label} label={label} value={value} />
            ))}
          </div>

          {request.description && (
            <div>
              <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Description
              </p>
              <p className="whitespace-pre-wrap text-sm">{request.description}</p>
            </div>
          )}

          {attachments && attachments.length > 0 && (
            <div>
              <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Attachments
              </p>
              <div className="space-y-1.5">
                {attachments.map((a) => (
                  <button
                    key={a.id}
                    type="button"
                    onClick={() =>
                      downloadAttachment(a).catch((e) =>
                        toast.error("Download failed: " + (e as Error).message),
                      )
                    }
                    className="flex w-full items-center gap-2 rounded-md border border-border px-3 py-2 text-left text-sm transition-colors hover:bg-muted"
                  >
                    <Paperclip className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">{a.original_filename}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">
                      {fmtSize(a.size_bytes)}
                    </span>
                    <Download className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {isCollateral && (
            <div className="space-y-2">
              {!designPrompt ? (
                <Button
                  type="button"
                  disabled={designPromptMutation.isPending}
                  onClick={() => runDesignPrompt(false)}
                  className="w-full gap-2 border-0 bg-gradient-to-r from-violet-600 via-blue-600 to-cyan-500 text-white shadow-md transition-all hover:opacity-90 hover:shadow-lg"
                >
                  <Sparkles className="h-4 w-4" />
                  {designPromptMutation.isPending
                    ? "Generating design prompt..."
                    : "Generate design prompt"}
                </Button>
              ) : (
                <div className="overflow-hidden rounded-lg border border-violet-500/40">
                  <div className="flex items-center justify-between gap-2 bg-gradient-to-r from-violet-600 via-blue-600 to-cyan-500 px-3 py-1.5">
                    <span className="flex items-center gap-1.5 text-xs font-semibold text-white">
                      <Sparkles className="h-3.5 w-3.5" /> Design prompt for Claude design
                    </span>
                    <span className="flex items-center gap-1">
                      <button
                        type="button"
                        title="Regenerate"
                        disabled={designPromptMutation.isPending}
                        onClick={() => runDesignPrompt(true)}
                        className="rounded p-1 text-white/85 transition-colors hover:bg-white/20 hover:text-white"
                      >
                        <RefreshCw
                          className={cn(
                            "h-3.5 w-3.5",
                            designPromptMutation.isPending && "animate-spin",
                          )}
                        />
                      </button>
                      <button
                        type="button"
                        title="Copy prompt"
                        onClick={copyDesignPrompt}
                        className="rounded p-1 text-white/85 transition-colors hover:bg-white/20 hover:text-white"
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </button>
                    </span>
                  </div>
                  <p className="max-h-52 overflow-y-auto whitespace-pre-wrap bg-muted/40 px-3 py-2 text-xs leading-relaxed">
                    {designPrompt}
                  </p>
                  {designUploadFiles.length > 0 && (
                    <p className="border-t border-border bg-muted/60 px-3 py-1.5 text-[11px] text-muted-foreground">
                      Also upload to Claude design: {designUploadFiles.join(", ")}
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {request.jira_issue_url && (
            <a
              href={request.jira_issue_url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
            >
              {request.jira_issue_key ?? "View in Jira"} <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}

          {!isPending && request.completed_at && (
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" />
              {STATUS_LABELS[request.status]} {fmtDate(request.completed_at)}
              {request.decision_note ? ` — ${request.decision_note}` : ""}
            </p>
          )}

          {isPending && isProduct && (
            <div className="space-y-2">
              <Label htmlFor={`note-${request.id}`}>Note (optional)</Label>
              <Textarea
                id={`note-${request.id}`}
                rows={2}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Add context for your decision..."
              />
              <p className="text-xs text-muted-foreground">
                Approving files this to the product team's Jira board, including any
                attachments.
              </p>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          {isPending && isProduct && (
            <>
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
            </>
          )}
          {isPending && !isProduct && (
            <Button
              className="gap-2"
              disabled={busy}
              onClick={() =>
                complete.mutate(request.id, {
                  onSuccess: () => {
                    toast.success("Marked complete.");
                    onOpenChange(false);
                  },
                  onError: (e) => toast.error((e as Error).message),
                })
              }
            >
              <Check className="h-4 w-4" /> Mark complete
            </Button>
          )}
          {!isPending && (
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Condensed request row: title + priority/status tags (plus a type tag
 * when mixed lists need it). Click anywhere to open the full popup.
 */
export function RequestCard({
  request,
  showType = false,
}: {
  request: CrmRequest;
  showType?: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="w-full rounded-lg border border-border bg-card px-3 py-2 text-left transition-colors hover:border-primary/50 hover:bg-muted/40"
      >
        <div className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-sm font-medium">
            {request.title}
          </span>
          {showType && (
            <Badge variant="outline" className="shrink-0 text-[10px]">
              {REQUEST_TYPE_LABELS[request.type]}
            </Badge>
          )}
          <Badge
            className={cn(
              "shrink-0 text-[10px] border-transparent",
              PRIORITY_BADGE[request.priority],
            )}
          >
            {request.priority}
          </Badge>
          <Badge
            className={cn(
              "shrink-0 text-[10px] border-transparent",
              STATUS_BADGE[request.status],
            )}
          >
            {STATUS_LABELS[request.status]}
          </Badge>
        </div>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          From {request.requester_name ?? request.requester?.full_name ?? "Unknown"} ·{" "}
          {fmtDate(request.created_at)}
        </p>
      </button>

      {open && (
        <RequestDetailDialog request={request} open={open} onOpenChange={setOpen} />
      )}
    </>
  );
}
