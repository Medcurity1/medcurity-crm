// Newsletters tab — Mailchimp newsletters (The Medcurity Report / Partner
// Exclusive). Ingest past sends for metrics + style references, AI-draft a
// new issue, edit/revise it, then push it to Mailchimp as a draft.

import { useState } from "react";
import {
  Mail, Download, RefreshCw, Plus, Loader2, ExternalLink, Trash2, Sparkles, FileText,
} from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import {
  useMailchimpStatus,
  useNewsletters,
  useIngestNewsletters,
  useSyncNewsletters,
  useGenerateNewsletterDraft,
  useDeleteNewsletter,
} from "./api";
import { NewsletterEditor } from "./NewsletterEditor";
import { StyleGuideDialog } from "./StyleGuideDialog";
import { LoadError } from "./LoadError";
import type { Newsletter, NewsletterType } from "./types";

const TYPE_FULL: Record<string, string> = {
  report: "The Medcurity Report",
  partner: "Partner Exclusive",
};

const TYPE_LABEL: Record<string, string> = {
  report: "Report",
  partner: "Partner Exclusive",
  unclassified: "Other",
};
const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  mailchimp_draft: "In Mailchimp",
  sent: "Sent",
};

type Filter = "all" | "report" | "partner";

export function NewslettersTab() {
  const { data: mc } = useMailchimpStatus();
  const { data: newsletters, isLoading, isError, refetch } = useNewsletters("all");
  const ingest = useIngestNewsletters();
  const syncM = useSyncNewsletters();
  const genDraft = useGenerateNewsletterDraft();
  const del = useDeleteNewsletter();

  const [filter, setFilter] = useState<Filter>("all");
  const [editorId, setEditorId] = useState<string | null>(null);
  const [composeType, setComposeType] = useState<NewsletterType | null>(null);
  const [notes, setNotes] = useState("");
  const [styleType, setStyleType] = useState<NewsletterType | null>(null);
  const busy = ingest.isPending || syncM.isPending;

  const shown = (newsletters ?? []).filter((n) => filter === "all" || n.newsletter_type === filter);

  function openCompose(type: NewsletterType) {
    setNotes("");
    setComposeType(type);
  }
  function generateDraft() {
    if (!composeType) return;
    genDraft.mutate(
      { type: composeType, user_notes: notes.trim() || undefined },
      { onSuccess: (r) => { setComposeType(null); setEditorId(r.draft_id); } },
    );
  }

  if (mc && !mc.configured) {
    return (
      <div className="pt-4">
        <EmptyState
          icon={Mail}
          title="Mailchimp isn't connected"
          description="Add MAILCHIMP_API_KEY to enable newsletter ingest, AI drafting, and push-to-Mailchimp."
        />
      </div>
    );
  }

  return (
    <div className="space-y-3 pt-4">
      <div className="flex items-center gap-2 flex-wrap">
        <Button size="sm" onClick={() => ingest.mutate()} disabled={busy}>
          {ingest.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Download className="h-4 w-4 mr-1" />}
          Ingest from Mailchimp
        </Button>
        <Button size="sm" variant="outline" onClick={() => syncM.mutate()} disabled={busy}>
          {syncM.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <RefreshCw className="h-4 w-4 mr-1" />}
          Sync metrics
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ai" size="sm" disabled={genDraft.isPending}>
              {genDraft.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <span className="ai-icon mr-1"><Plus className="h-4 w-4" /></span>}
              New draft
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onClick={() => openCompose("report")}>The Medcurity Report</DropdownMenuItem>
            <DropdownMenuItem onClick={() => openCompose("partner")}>Partner Exclusive</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline">
              <Sparkles className="h-4 w-4 mr-1" /> Style guide
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onClick={() => setStyleType("report")}>Report style guide…</DropdownMenuItem>
            <DropdownMenuItem onClick={() => setStyleType("partner")}>Partner Exclusive style guide…</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Compose — capture notes/topics BEFORE the AI drafts */}
      <Dialog open={!!composeType} onOpenChange={(o) => !o && setComposeType(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>New {composeType ? TYPE_FULL[composeType] : "newsletter"} draft</DialogTitle>
            <DialogDescription>
              Add anything specific you want included — known events, webinar dates, news to cover, links, or notes
              about graphics you'll add later. Leave it blank for a strong general edition.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1">
            <Label htmlFor="nl-notes" className="text-xs">Topics & notes for this edition (optional)</Label>
            <Textarea
              id="nl-notes"
              rows={7}
              placeholder="e.g. Webinar on the HIPAA Security Rule update on July 24. Cover the recent OCR settlement with Cadence Health. I'll add a header graphic about our new analytics dashboard."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setComposeType(null)} disabled={genDraft.isPending}>Cancel</Button>
            <Button variant="ai" onClick={generateDraft} disabled={genDraft.isPending}>
              {genDraft.isPending
                ? <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Writing… (up to ~90s)</>
                : <><span className="ai-icon mr-1"><Sparkles className="h-4 w-4" /></span> Generate draft</>}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <StyleGuideDialog type={styleType} open={!!styleType} onOpenChange={(o) => !o && setStyleType(null)} />

      {/* Type filter */}
      <div className="flex gap-1">
        {(["all", "report", "partner"] as Filter[]).map((f) => (
          <Button
            key={f}
            size="sm"
            variant={filter === f ? "secondary" : "ghost"}
            className="h-7 text-xs"
            onClick={() => setFilter(f)}
          >
            {f === "all" ? "All" : TYPE_LABEL[f]}
          </Button>
        ))}
      </div>

      {isLoading ? (
        <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)}</div>
      ) : isError ? (
        <LoadError what="newsletters" onRetry={() => refetch()} />
      ) : !shown.length ? (
        <EmptyState
          icon={FileText}
          title="No newsletters yet"
          description="Ingest your past Mailchimp sends to build the style reference, then create an AI draft."
        />
      ) : (
        shown.map((n) => <NewsletterRow key={n.id} n={n} onEdit={() => setEditorId(n.id)} onDelete={() => {
          if (confirm(`Delete "${n.subject || "this draft"}"?`)) del.mutate(n.id);
        }} />)
      )}

      <NewsletterEditor id={editorId} open={!!editorId} onOpenChange={(v) => !v && setEditorId(null)} />
    </div>
  );
}

function NewsletterRow({ n, onEdit, onDelete }: { n: Newsletter; onEdit: () => void; onDelete: () => void }) {
  const m = n.metrics ?? {};
  const isDraft = n.status === "draft";
  const mailchimpUrl = n.mailchimp_campaign_id
    ? `https://admin.mailchimp.com/campaigns/edit?id=${n.mailchimp_campaign_id}`
    : null;
  return (
    <Card className="py-0">
      <CardContent className="px-4 py-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-semibold text-sm truncate">{n.subject || "(untitled draft)"}</h3>
          <p className="text-xs text-muted-foreground mt-1">
            {n.send_time ? new Date(n.send_time).toLocaleDateString() : "Draft"}
            {m.sent ? ` · ${m.sent} sent` : ""}
            {m.openRate ? ` · ${m.openRate} open` : ""}
            {m.clickRate ? ` · ${m.clickRate} click` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Badge variant="outline" className="text-xs">{TYPE_LABEL[n.newsletter_type] ?? n.newsletter_type}</Badge>
          <Badge variant="secondary" className="text-xs">{STATUS_LABEL[n.status] ?? n.status}</Badge>
          {isDraft && (
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onEdit}>Edit</Button>
          )}
          {n.status === "mailchimp_draft" && mailchimpUrl && (
            <a href={mailchimpUrl} target="_blank" rel="noopener noreferrer"
              className="text-xs text-primary hover:underline inline-flex items-center gap-1">
              Mailchimp <ExternalLink className="h-3 w-3" />
            </a>
          )}
          {n.status !== "sent" && (
            <button type="button" title="Delete draft"
              className="p-1 text-muted-foreground hover:text-destructive" onClick={onDelete}>
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
