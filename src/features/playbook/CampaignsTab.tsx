// Campaigns tab — cold-email campaigns (Smartlead). Import/sync from
// Smartlead + view metrics with deep links. The New Campaign wizard +
// launch (Phase D) and analysis/adaptation (Phase E) land next.

import { useState } from "react";
import { Megaphone, Download, RefreshCw, ExternalLink, Loader2, Plus, Trash2 } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { CampaignWizard } from "./CampaignWizard";
import {
  useCampaigns,
  useSmartleadStatus,
  useImportCampaigns,
  useSyncCampaigns,
  useAnalyzeCampaign,
  useDeleteCampaign,
  smartleadUrl,
} from "./api";

const STATUS_LABEL: Record<string, string> = {
  planned: "Planned",
  in_progress: "Active",
  complete: "Complete",
};

export function CampaignsTab() {
  const { data: campaigns, isLoading } = useCampaigns();
  const { data: sl } = useSmartleadStatus();
  const importMut = useImportCampaigns();
  const syncMut = useSyncCampaigns();
  const analyze = useAnalyzeCampaign();
  const del = useDeleteCampaign();
  const busy = importMut.isPending || syncMut.isPending;
  const [wizardOpen, setWizardOpen] = useState(false);

  return (
    <div className="space-y-3 pt-4">
      <div className="flex items-center gap-2 flex-wrap">
        {sl?.configured && (
          <Button size="sm" onClick={() => setWizardOpen(true)}>
            <Plus className="h-4 w-4 mr-1" /> New Campaign
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

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}
        </div>
      ) : !campaigns?.length ? (
        <EmptyState
          icon={Megaphone}
          title="No campaigns yet"
          description={
            sl?.configured
              ? "Import your existing Smartlead campaigns to see them here. The AI campaign wizard arrives next."
              : "Cold-email campaigns will live here once Smartlead is connected."
          }
        />
      ) : (
        campaigns.map((c) => {
          const url = smartleadUrl(c.smartlead_campaign_id);
          const a = c.analysis_json as {
            performance?: string; summary?: string; wins?: string[]; improvements?: string[];
          } | null;
          return (
            <Card key={c.id}>
              <CardContent className="p-4 space-y-2">
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
                        size="sm" variant="outline" className="h-7 text-xs"
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
        })
      )}

      <CampaignWizard open={wizardOpen} onOpenChange={setWizardOpen} />
    </div>
  );
}
