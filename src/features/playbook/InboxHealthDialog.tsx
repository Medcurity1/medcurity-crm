// "Sending inboxes" panel (Campaigns overhaul Phase 5) — plain-English
// warmup health + how much daily volume each Smartlead sending inbox is
// already carrying, so a rep can tell whether an inbox is safe to load up
// more without opening Smartlead. Lazy: the inbox-health edge action (a
// live warmup-stats round trip per inbox, capped at 10 server-side) only
// fires while this dialog is actually open — see useInboxHealth in api.ts.

import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryError } from "@/components/QueryError";
import { useEffect, useState } from "react";
import { PencilLine, Signature } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import DOMPurify from "dompurify";
import { useInboxHealth, useUpdateEmailAccountSignature, type InboxHealthEntry } from "./api";

function signaturePreviewHtml(signature: string): string {
  const clean = DOMPurify.sanitize(signature, { USE_PROFILES: { html: true } });
  return `<!doctype html><html><body style="margin:0;padding:14px;font:14px/1.5 Arial,Helvetica,sans-serif;color:#222">${clean}</body></html>`;
}

/** Plain-English badge for an inbox's warmup state. Deliberately reads as
 *  "no data" rather than a false "healthy" when Smartlead's warmup-stats
 *  endpoint didn't return anything usable (unverified endpoint shape — see
 *  the edge function's fetchInboxWarmup doc comment) — an unknown inbox
 *  should never look reassuring. */
function warmupBadge(w: InboxHealthEntry["warmup"]): { label: string; className: string } {
  if (!w || (w.spam_rate == null && w.status == null && w.sent_7d == null)) {
    return { label: "No warmup data", className: "bg-muted text-muted-foreground" };
  }
  if (w.spam_rate != null && w.spam_rate >= 5) {
    return {
      label: `Spam risk: ${w.spam_rate}% landing in spam`,
      className: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
    };
  }
  if (w.status && /paus|error|fail/i.test(w.status)) {
    return { label: "Warmup paused", className: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300" };
  }
  return { label: "Warming well", className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" };
}

export function InboxHealthDialog({
  open, onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { data: inboxes, isLoading, isError, isFetching, refetch } = useInboxHealth(open);
  const updateSignature = useUpdateEmailAccountSignature();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [signatureDraft, setSignatureDraft] = useState("");
  const [editorMode, setEditorMode] = useState<"visual" | "html">("visual");

  useEffect(() => {
    if (!open) { setEditingId(null); setSignatureDraft(""); }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="camp-scope camp-shell w-[min(50rem,calc(100vw-2rem))] sm:max-w-3xl max-h-[85vh] overflow-y-auto p-6 gap-4">
        <DialogHeader>
          <DialogTitle>Sending inboxes</DialogTitle>
          <DialogDescription>
            Warmup health and today's load, straight from Smartlead.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}
          </div>
        ) : isError ? (
          <QueryError
            message="Couldn't load inbox health."
            onRetry={() => refetch()}
            isRetrying={isFetching}
          />
        ) : !inboxes?.length ? (
          <p className="text-sm text-muted-foreground">No sending inboxes found in Smartlead.</p>
        ) : (
          <div className="space-y-2">
            {inboxes.map((ib) => {
              const badge = warmupBadge(ib.warmup);
              const label = ib.from_email ?? ib.from_name ?? `Inbox ${ib.id}`;
              const headroom = ib.daily_limit != null ? Math.max(0, ib.daily_limit - ib.total_leads_per_day) : null;
              return (
                <div key={ib.id} className="camp-card p-4 space-y-3">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className="text-sm font-medium truncate min-w-0">{label}</span>
                    <Badge variant="secondary" className={badge.className}>{badge.label}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {ib.daily_limit != null ? `${ib.daily_limit}/day limit` : "Daily limit unknown"}
                    {ib.warmup?.sent_7d != null ? ` · ${ib.warmup.sent_7d} sent last 7 days` : ""}
                    {headroom != null
                      ? ` · room for ~${headroom} more/day`
                      : ib.total_leads_per_day > 0 ? " · remaining room unknown" : ""}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {ib.campaigns.length > 0
                      ? `Feeding ${ib.campaigns.length === 1 ? ib.campaigns[0].name : `${ib.campaigns.length} campaigns`} · ${ib.total_leads_per_day} new/day`
                      : "Not feeding any active campaigns"}
                  </p>
                  <div className="rounded-xl border p-3 space-y-2" style={{ borderColor: "var(--camp-line)", background: "var(--camp-surface-2)" }}>
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Signature className="h-4 w-4 text-muted-foreground" />
                        <div>
                          <p className="text-xs font-medium">Signature used by this inbox</p>
                          <p className="text-[11px] text-muted-foreground">Read from and saved directly to this Smartlead sending account.</p>
                        </div>
                      </div>
                      {editingId !== ib.id && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => { setEditingId(ib.id); setSignatureDraft(ib.signature ?? ""); setEditorMode("visual"); }}
                        >
                          <PencilLine className="h-3.5 w-3.5 mr-1" /> Edit
                        </Button>
                      )}
                    </div>
                    {editingId === ib.id ? (
                      <div className="space-y-2">
                        <div className="flex gap-1" role="group" aria-label="Signature editor mode">
                          <Button type="button" size="sm" variant={editorMode === "visual" ? "secondary" : "ghost"} onClick={() => setEditorMode("visual")}>Visual</Button>
                          <Button type="button" size="sm" variant={editorMode === "html" ? "secondary" : "ghost"} onClick={() => setEditorMode("html")}>HTML</Button>
                        </div>
                        {editorMode === "visual" ? (
                          <div
                            key={`${ib.id}-visual-${editorMode}`}
                            contentEditable
                            suppressContentEditableWarning
                            role="textbox"
                            aria-multiline="true"
                            aria-label={`Visual signature editor for ${label}`}
                            className="min-h-32 rounded-md border bg-white p-3 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-ring"
                            dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(signatureDraft, { USE_PROFILES: { html: true } }) }}
                            onInput={(event) => setSignatureDraft(event.currentTarget.innerHTML)}
                          />
                        ) : (
                          <Textarea
                            value={signatureDraft}
                            onChange={(event) => setSignatureDraft(event.target.value)}
                            rows={7}
                            aria-label={`Signature HTML for ${label}`}
                            placeholder="Add a plain-text or HTML signature…"
                          />
                        )}
                        <p className="text-[11px] text-muted-foreground">Edit what recipients will see, or switch to HTML for precise formatting. Saving changes this Smartlead inbox across its campaigns.</p>
                        <div className="flex justify-end gap-2">
                          <Button type="button" variant="ghost" size="sm" onClick={() => setEditingId(null)}>Cancel</Button>
                          <Button
                            type="button"
                            size="sm"
                            disabled={updateSignature.isPending || signatureDraft === (ib.signature ?? "")}
                            onClick={() => updateSignature.mutate(
                              { emailAccountId: ib.id, signature: DOMPurify.sanitize(signatureDraft, { USE_PROFILES: { html: true } }) },
                              {
                                onSuccess: () => { toast.success(`Signature updated for ${label}.`); setEditingId(null); },
                                onError: (error) => toast.error(`Signature wasn't updated: ${(error as Error).message}`),
                              },
                            )}
                          >
                            {updateSignature.isPending ? "Saving…" : "Save to Smartlead"}
                          </Button>
                        </div>
                      </div>
                    ) : ib.signature == null ? (
                      <p className="text-xs text-muted-foreground">Smartlead did not return a signature for this account. Nothing is being inferred or recreated in Pulse.</p>
                    ) : ib.signature.trim() ? (
                      <iframe
                        title={`Signature preview for ${label}`}
                        sandbox=""
                        srcDoc={signaturePreviewHtml(ib.signature)}
                        className="h-28 w-full rounded-lg border bg-white"
                      />
                    ) : (
                      <p className="text-xs text-muted-foreground">No signature is currently set on this Smartlead account.</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
