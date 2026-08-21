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
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ImagePlus, PencilLine, Signature } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import DOMPurify from "dompurify";
import {
  useInboxHealth, useUpdateEmailAccountDailyLimit, useUpdateEmailAccountSignature, type InboxHealthEntry,
} from "./api";

function signaturePreviewHtml(signature: string): string {
  const clean = DOMPurify.sanitize(signature, { USE_PROFILES: { html: true } });
  return `<!doctype html><html><body style="margin:0;padding:14px;font:14px/1.5 Arial,Helvetica,sans-serif;color:#222">${clean}</body></html>`;
}

/** Plain-English badge for an inbox's warmup state. Deliberately reads as
 *  "no data" rather than a false "healthy" when Smartlead's warmup-stats
 *  endpoint didn't return anything usable (unverified endpoint shape — see
 *  the edge function's fetchInboxWarmup doc comment) — an unknown inbox
 *  should never look reassuring. */
function warmupBadge(ib: InboxHealthEntry): { label: string; className: string } {
  const status = ib.account_status?.toLowerCase() ?? "";
  if (/disconnect|error|fail/.test(status)) {
    return { label: "Disconnected", className: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300" };
  }
  if (ib.warmup_enabled === false) {
    return { label: "Warmup off", className: "bg-muted text-muted-foreground" };
  }
  if (ib.warmup_enabled !== true) {
    return { label: "Warmup unknown", className: "bg-muted text-muted-foreground" };
  }
  const w = ib.warmup;
  if (!w) return { label: "Warming", className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" };
  if (w.spam_rate != null && w.spam_rate >= 5) {
    return {
      label: `Spam risk: ${w.spam_rate}% landing in spam`,
      className: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
    };
  }
  if (w.status && /paus|error|fail/i.test(w.status)) {
    return { label: "Warmup paused", className: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300" };
  }
  return { label: "Warming", className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" };
}

function VisualSignatureEditor({ seedHtml, label, onChange }: { seedHtml: string; label: string; onChange: (html: string) => void }) {
  const editorRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (editorRef.current) editorRef.current.innerHTML = DOMPurify.sanitize(seedHtml, { USE_PROFILES: { html: true } });
    // Seed once per mount. Parent state updates must never rewrite the DOM:
    // doing so resets the browser selection and caused the caret-jump bug.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <div
      ref={editorRef}
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      aria-multiline="true"
      aria-label={`Visual signature editor for ${label}`}
      className="min-h-32 rounded-md border bg-white p-3 text-sm text-slate-900 outline-none focus:ring-2 focus:ring-ring"
      onInput={(event) => onChange(event.currentTarget.innerHTML)}
    />
  );
}

export function InboxHealthDialog({
  open, onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { data: inboxes, isLoading, isError, isFetching, refetch } = useInboxHealth(open);
  const updateSignature = useUpdateEmailAccountSignature();
  const updateDailyLimit = useUpdateEmailAccountDailyLimit();
  const [editingId, setEditingId] = useState<number | null>(null);
  const [signatureDraft, setSignatureDraft] = useState("");
  const [editorMode, setEditorMode] = useState<"visual" | "html">("visual");
  const [editorRevision, setEditorRevision] = useState(0);
  const [imageUrl, setImageUrl] = useState("");
  const [editingLimitId, setEditingLimitId] = useState<number | null>(null);
  const [dailyLimitDraft, setDailyLimitDraft] = useState(25);

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
              const badge = warmupBadge(ib);
              const label = ib.from_email ?? ib.from_name ?? `Inbox ${ib.id}`;
              const headroom = ib.daily_limit != null ? Math.max(0, ib.daily_limit - ib.total_leads_per_day) : null;
              return (
                <div key={ib.id} className="camp-card p-4 space-y-3">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className="text-sm font-medium truncate min-w-0">{label}</span>
                    <Badge variant="secondary" className={badge.className}>{badge.label}</Badge>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap text-xs text-muted-foreground">
                    <span>{ib.daily_limit != null ? `${ib.daily_limit}/day mailbox safety limit` : "Mailbox safety limit unknown"}</span>
                    {editingLimitId !== ib.id && (
                      <button type="button" className="text-primary hover:underline" onClick={() => { setEditingLimitId(ib.id); setDailyLimitDraft(ib.daily_limit ?? 25); }}>Edit limit</button>
                    )}
                    {ib.sent_today != null ? ` · ${ib.sent_today} sent today` : " · Sent today unavailable from Smartlead"}
                    {ib.warmup?.sent_7d != null ? ` · ${ib.warmup.sent_7d} warmup sends last 7 days` : ""}
                    {headroom != null
                      ? ` · room for ~${headroom} more/day`
                      : ib.total_leads_per_day > 0 ? " · remaining room unknown" : ""}
                  </div>
                  {editingLimitId === ib.id && (
                    <div className="rounded-xl border p-3 space-y-2" style={{ borderColor: "var(--camp-line)", background: "var(--camp-surface-2)" }}>
                      <p className="text-xs font-medium">Mailbox daily safety limit</p>
                      <p className="text-[11px] text-muted-foreground">The maximum this inbox may send in a day across all campaigns. Keep it conservative for deliverability; campaign volume is set separately in each campaign.</p>
                      <div className="flex items-center gap-2 flex-wrap">
                        <Input className="w-28" type="number" min={1} max={500} value={dailyLimitDraft} onChange={(event) => setDailyLimitDraft(Math.max(1, Math.min(500, Number(event.target.value) || 1)))} />
                        <Button type="button" variant="ghost" size="sm" onClick={() => setEditingLimitId(null)}>Cancel</Button>
                        <Button type="button" size="sm" disabled={updateDailyLimit.isPending || dailyLimitDraft === ib.daily_limit} onClick={() => updateDailyLimit.mutate(
                          { emailAccountId: ib.id, dailyLimit: dailyLimitDraft },
                          {
                            onSuccess: () => { toast.success(`Daily limit updated for ${label}.`); setEditingLimitId(null); },
                            onError: (error) => toast.error(`Daily limit wasn't updated: ${(error as Error).message}`),
                          },
                        )}>{updateDailyLimit.isPending ? "Saving…" : "Save to Smartlead"}</Button>
                      </div>
                    </div>
                  )}
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
                          onClick={() => { setEditingId(ib.id); setSignatureDraft(ib.signature ?? ""); setEditorMode("visual"); setEditorRevision(0); setImageUrl(""); }}
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
                          <VisualSignatureEditor key={`${ib.id}-${editorMode}-${editorRevision}`} seedHtml={signatureDraft} label={label} onChange={setSignatureDraft} />
                        ) : (
                          <Textarea
                            value={signatureDraft}
                            onChange={(event) => setSignatureDraft(event.target.value)}
                            rows={7}
                            aria-label={`Signature HTML for ${label}`}
                            placeholder="Add a plain-text or HTML signature…"
                          />
                        )}
                        <div className="rounded-xl border p-3 space-y-2" style={{ borderColor: "var(--camp-line)" }}>
                          <div className="flex items-center gap-2"><ImagePlus className="h-4 w-4" /><p className="text-xs font-medium">Insert hosted image</p></div>
                          <p className="text-[11px] text-muted-foreground">Smartlead signatures accept HTML image URLs, but its API does not provide a signature-image upload endpoint. Use an existing public HTTPS image URL; Pulse will not upload or take ownership of the file.</p>
                          <div className="flex gap-2 flex-col sm:flex-row">
                            <Input value={imageUrl} onChange={(event) => setImageUrl(event.target.value)} placeholder="https://…/logo.png" aria-label={`Hosted signature image URL for ${label}`} />
                            <Button type="button" variant="outline" size="sm" disabled={!/^https:\/\/\S+$/i.test(imageUrl)} onClick={() => {
                              const safeUrl = imageUrl.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
                              setSignatureDraft((current) => `${current}<p><img src="${safeUrl}" alt="" style="max-width:100%;height:auto;"></p>`);
                              setImageUrl("");
                              setEditorRevision((value) => value + 1);
                            }}>Insert image</Button>
                          </div>
                        </div>
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
