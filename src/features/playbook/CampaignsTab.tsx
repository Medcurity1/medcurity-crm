// Campaigns tab — sequence templates (top) + the running/past campaign list.
// Ongoing = planned + active; Past = complete. Import/Sync (Smartlead) sit atop
// the Ongoing section and refresh both. The visual sequence builder + launch
// land next; for now campaigns come from the Smartlead import.

import { useState } from "react";
import { Megaphone, Download, RefreshCw, ExternalLink, Loader2, Plus, Trash2 } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CampaignWizard } from "./CampaignWizard";
import { TemplatesSection } from "./TemplatesSection";
import { LoadError } from "./LoadError";
import {
  useCampaigns,
  useSmartleadStatus,
  useImportCampaigns,
  useSyncCampaigns,
  useAnalyzeCampaign,
  useDeleteCampaign,
  smartleadUrl,
} from "./api";
import type { PlaybookCampaign } from "./types";

const STATUS_LABEL: Record<string, string> = {
  planned: "Planned",
  in_progress: "Active",
  complete: "Complete",
};

type CampaignRow = PlaybookCampaign & { owner?: { id: string; full_name: string | null } | null };

function CampaignCard({
  c,
  analyze,
  del,
}: {
  c: CampaignRow;
  analyze: ReturnType<typeof useAnalyzeCampaign>;
  del: ReturnType<typeof useDeleteCampaign>;
}) {
  const url = smartleadUrl(c.smartlead_campaign_id);
  const a = c.analysis_json as {
    performance?: string; summary?: string; wins?: string[]; improvements?: string[];
  } | null;
  return (
    <Card className="py-0">
      <CardContent className="px-4 py-3 space-y-2">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="font-semibold text-sm truncate">{c.title}</h3>
            <p className="text-xs text-muted-foreground mt-1">
              {c.metrics?.sent != null ? `${c.metrics.sent} sent` : ""}
              {c.metrics?.openRate != null ? ` · ${c.metrics.openRate} open` : ""}
              {c.metrics?.clickRate != null ? ` · ${c.metrics.clickRate} click` : ""}
              {c.metrics?.replies != null ? ` · ${c.metrics.replies} replies` : ""}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {c.status === "complete" && !c.analyzed_at && (
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
            {url && (
              <a href={url} target="_blank" rel="noopener noreferrer"
                className="text-xs text-primary hover:underline inline-flex items-center gap-1">
                Smartlead <ExternalLink className="h-3 w-3" />
              </a>
            )}
            <Badge variant="secondary" className="capitalize">
              {STATUS_LABEL[c.status] ?? c.status}
            </Badge>
            {c.status === "planned" && (
              <button
                type="button"
                title="Delete campaign"
                className="p-1 text-muted-foreground hover:text-destructive"
                onClick={() => {
                  if (confirm(`Delete "${c.title}"? This removes it here and in Smartlead.`)) {
                    del.mutate({ id: c.id, smartlead_campaign_id: c.smartlead_campaign_id });
                  }
                }}
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
    </Card>
  );
}

export function CampaignsTab() {
  const { data: campaigns, isLoading, isError, refetch } = useCampaigns();
  const { data: sl } = useSmartleadStatus();
  const importMut = useImportCampaigns();
  const syncMut = useSyncCampaigns();
  const analyze = useAnalyzeCampaign();
  const del = useDeleteCampaign();
  const busy = importMut.isPending || syncMut.isPending;
  const [wizardOpen, setWizardOpen] = useState(false);

  // Ongoing = planned + active; Past = complete. The list comes back newest-first.
  const ongoing = (campaigns ?? []).filter((c) => c.status !== "complete");
  const past = (campaigns ?? []).filter((c) => c.status === "complete");

  return (
    <div className="space-y-5 pt-4">
      <TemplatesSection />

      <div className="border-t pt-4 space-y-3">
        {/* Ongoing section header + the Smartlead actions (refresh both sections) */}
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h3 className="text-sm font-semibold">Ongoing campaigns</h3>
          <div className="flex items-center gap-2 flex-wrap">
            {sl?.configured && (
              <Button variant="ai" size="sm" onClick={() => setWizardOpen(true)}>
                <span className="ai-icon mr-1"><Plus className="h-4 w-4" /></span> New Campaign
              </Button>
            )}
            {sl?.configured ? (
              <>
                <Button size="sm" onClick={() => importMut.mutate()} disabled={busy}>
                  {importMut.isPending ? (
                    <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Importing…</>
                  ) : (
                    <><Download className="h-4 w-4 mr-1" /> Import from Smartlead</>
                  )}
                </Button>
                <Button size="sm" variant="outline" onClick={() => syncMut.mutate()} disabled={busy}>
                  {syncMut.isPending ? (
                    <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Syncing…</>
                  ) : (
                    <><RefreshCw className="h-4 w-4 mr-1" /> Sync metrics</>
                  )}
                </Button>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">
                Smartlead isn't configured — add SMARTLEAD_API_KEY to enable import/launch.
              </p>
            )}
          </div>
        </div>

        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}
          </div>
        ) : isError ? (
          <LoadError what="campaigns" onRetry={() => refetch()} />
        ) : ongoing.length ? (
          <div className="space-y-2">
            {ongoing.map((c) => <CampaignCard key={c.id} c={c} analyze={analyze} del={del} />)}
          </div>
        ) : (
          <EmptyState
            icon={Megaphone}
            title={past.length ? "No ongoing campaigns" : "No campaigns yet"}
            description={
              sl?.configured
                ? "Start one from a template above, or import your existing Smartlead campaigns."
                : "Campaigns will live here once Smartlead is connected."
            }
          />
        )}

        {/* Past campaigns — completed, most recent first */}
        {past.length > 0 && (
          <div className="border-t pt-4 space-y-2">
            <h3 className="text-sm font-semibold">Past campaigns</h3>
            {past.map((c) => <CampaignCard key={c.id} c={c} analyze={analyze} del={del} />)}
          </div>
        )}
      </div>

      <CampaignWizard open={wizardOpen} onOpenChange={setWizardOpen} />
    </div>
  );
}
