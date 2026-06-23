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
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import {
  useMailchimpStatus,
  useNewsletters,
  useIngestNewsletters,
  useSyncNewsletters,
  useGenerateStyle,
  useGenerateNewsletterDraft,
  useDeleteNewsletter,
} from "./api";
import { NewsletterEditor } from "./NewsletterEditor";
import type { Newsletter, NewsletterType } from "./types";

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
  const { data: newsletters, isLoading } = useNewsletters("all");
  const ingest = useIngestNewsletters();
  const syncM = useSyncNewsletters();
  const genStyle = useGenerateStyle();
  const genDraft = useGenerateNewsletterDraft();
  const del = useDeleteNewsletter();

  const [filter, setFilter] = useState<Filter>("all");
  const [editorId, setEditorId] = useState<string | null>(null);
  const busy = ingest.isPending || syncM.isPending;

  const shown = (newsletters ?? []).filter((n) => filter === "all" || n.newsletter_type === filter);

  function newDraft(type: NewsletterType) {
    genDraft.mutate({ type }, { onSuccess: (r) => setEditorId(r.draft_id) });
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
            <Button size="sm" disabled={genDraft.isPending}>
              {genDraft.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Plus className="h-4 w-4 mr-1" />}
              New draft
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onClick={() => newDraft("report")}>The Medcurity Report</DropdownMenuItem>
            <DropdownMenuItem onClick={() => newDraft("partner")}>Partner Exclusive</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="outline" disabled={genStyle.isPending}>
              {genStyle.isPending ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Sparkles className="h-4 w-4 mr-1" />}
              Style guide
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onClick={() => genStyle.mutate("report")}>Generate for Report</DropdownMenuItem>
            <DropdownMenuItem onClick={() => genStyle.mutate("partner")}>Generate for Partner Exclusive</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

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
