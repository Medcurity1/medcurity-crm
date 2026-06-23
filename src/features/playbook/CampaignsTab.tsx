// Campaigns tab — cold-email campaigns (Smartlead). Phase A renders the
// data + empty state; import/sync (Phase C), the New Campaign wizard +
// launch (Phase D), and analysis/adaptation (Phase E) land next.

import { Megaphone } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useCampaigns } from "./api";

const STATUS_LABEL: Record<string, string> = {
  planned: "Planned",
  in_progress: "Active",
  complete: "Complete",
};

export function CampaignsTab() {
  const { data: campaigns, isLoading } = useCampaigns();

  if (isLoading) {
    return (
      <div className="space-y-2 pt-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-20 w-full" />
        ))}
      </div>
    );
  }

  if (!campaigns?.length) {
    return (
      <div className="pt-4">
        <EmptyState
          icon={Megaphone}
          title="No campaigns yet"
          description="Cold-email campaigns will live here — import your existing Smartlead campaigns or build a new one with the AI wizard. Coming in the next update."
        />
      </div>
    );
  }

  return (
    <div className="space-y-3 pt-4">
      {campaigns.map((c) => (
        <Card key={c.id}>
          <CardContent className="p-4 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="font-semibold text-sm truncate">{c.title}</h3>
              <p className="text-xs text-muted-foreground mt-1">
                {c.metrics?.sent != null ? `${c.metrics.sent} sent · ` : ""}
                {c.metrics?.openRate != null ? `${c.metrics.openRate}% open · ` : ""}
                {c.metrics?.replies != null ? `${c.metrics.replies} replies` : ""}
              </p>
            </div>
            <Badge variant="secondary" className="shrink-0 capitalize">
              {STATUS_LABEL[c.status] ?? c.status}
            </Badge>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
