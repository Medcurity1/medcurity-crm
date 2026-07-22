// Campaigns tab — sequence templates (top) + the running/past campaign
// tracker. Ongoing = draft + active + paused; Recently ended = completed/
// stopped within the last 30 days; anything older sits behind a "Show all
// past" toggle. Import/Sync (Smartlead) sit atop the Ongoing section and
// refresh both. Start/Pause/Resume/Stop live right on each card (Campaigns
// overhaul S4) — a campaign never has to be managed by opening Smartlead.

import { useMemo, useState } from "react";
import { Megaphone, Download, RefreshCw, Loader2, Plus } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useAuth } from "@/features/auth/AuthProvider";
import { CampaignWizard } from "./CampaignWizard";
import { TemplatesSection } from "./TemplatesSection";
import { CampaignReplies } from "./CampaignReplies";
import { LoadError } from "./LoadError";
import { CampaignCard, type CampaignRow } from "./CampaignCard";
import {
  useCampaigns,
  useSmartleadStatus,
  useImportCampaigns,
  useSyncCampaigns,
  useAnalyzeCampaign,
  useDeleteCampaign,
  useSetCampaignStatus,
  useCampaignEnrollmentStats,
  useEmailAccounts,
} from "./api";

const RECENTLY_ENDED_DAYS = 30;
const RECENTLY_ENDED_MS = RECENTLY_ENDED_DAYS * 24 * 60 * 60 * 1000;

function FilterPill({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full px-3 py-1 text-xs font-medium border transition-colors",
        active
          ? "bg-primary text-primary-foreground border-primary"
          : "bg-transparent text-muted-foreground border-border hover:bg-accent",
      )}
    >
      {label}
    </button>
  );
}

export function CampaignsTab() {
  const { profile } = useAuth();
  const { data: campaigns, isLoading, isError, refetch } = useCampaigns();
  const { data: sl } = useSmartleadStatus();
  const { data: inboxes } = useEmailAccounts();
  const importMut = useImportCampaigns();
  const syncMut = useSyncCampaigns();
  const analyze = useAnalyzeCampaign();
  const del = useDeleteCampaign();
  const setStatus = useSetCampaignStatus();
  const busy = importMut.isPending || syncMut.isPending;
  const [wizardOpen, setWizardOpen] = useState(false);
  const [ownerFilter, setOwnerFilter] = useState<"everyone" | "mine">("everyone");
  const [showAllPast, setShowAllPast] = useState(false);

  const inboxLabels = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of inboxes ?? []) {
      const label = a.from_email ?? a.from_name ?? `Inbox ${a.id}`;
      m.set(String(a.id), label);
    }
    return m;
  }, [inboxes]);

  const filtered = useMemo(() => {
    const rows = (campaigns ?? []) as CampaignRow[];
    if (ownerFilter === "mine") return rows.filter((c) => c.owner_user_id === profile?.id);
    return rows;
  }, [campaigns, ownerFilter, profile?.id]);

  // Ongoing = draft + active + paused. The list comes back newest-first
  // (created_at desc, id as tiebreaker).
  const ongoing = filtered.filter(
    (c) => c.status === "draft" || c.status === "active" || c.status === "paused",
  );
  const allPast = filtered.filter((c) => c.status === "completed" || c.status === "stopped");
  const now = Date.now();
  const recentlyEnded = allPast.filter((c) => now - new Date(c.updated_at).getTime() <= RECENTLY_ENDED_MS);
  const olderPast = allPast.filter((c) => now - new Date(c.updated_at).getTime() > RECENTLY_ENDED_MS);

  // One grouped enrollment-stats fetch for every campaign currently visible
  // in the filtered list (not just the rendered subset) — cheap at this
  // scale, and means expanding "Show all past" never needs a second fetch.
  const statsIds = useMemo(() => filtered.map((c) => c.id), [filtered]);
  const { data: statsById } = useCampaignEnrollmentStats(statsIds);

  function renderCard(c: CampaignRow) {
    return (
      <CampaignCard
        key={c.id}
        c={c}
        analyze={analyze}
        del={del}
        setStatus={setStatus}
        stats={statsById?.[c.id]}
        inboxLabel={c.sending_email_account_id ? inboxLabels.get(c.sending_email_account_id) ?? null : null}
      />
    );
  }

  return (
    <div className="space-y-5 pt-4">
      <TemplatesSection />

      <CampaignReplies />

      <div className="border-t pt-4 space-y-3">
        {/* Ongoing section header + the Smartlead actions (refresh both sections) */}
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-3 flex-wrap">
            <h3 className="text-sm font-semibold">Ongoing campaigns</h3>
            <div className="flex items-center gap-1">
              <FilterPill label="Everyone" active={ownerFilter === "everyone"} onClick={() => setOwnerFilter("everyone")} />
              <FilterPill label="Mine" active={ownerFilter === "mine"} onClick={() => setOwnerFilter("mine")} />
            </div>
          </div>
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
            {ongoing.map(renderCard)}
          </div>
        ) : (
          <EmptyState
            icon={Megaphone}
            title={allPast.length ? "No ongoing campaigns" : "No campaigns yet"}
            description={
              sl?.configured
                ? "Start one from a template above, or import your existing Smartlead campaigns."
                : "Campaigns will live here once Smartlead is connected."
            }
          />
        )}

        {/* Recently ended — completed/stopped within the last 30 days */}
        {recentlyEnded.length > 0 && (
          <div className="border-t pt-4 space-y-2">
            <h3 className="text-sm font-semibold">Recently ended</h3>
            {recentlyEnded.map(renderCard)}
          </div>
        )}

        {/* Older past campaigns — collapsed by default */}
        {olderPast.length > 0 && (
          <div className="border-t pt-4 space-y-2">
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setShowAllPast((v) => !v)}>
              {showAllPast ? "Hide older campaigns" : `Show all past (${olderPast.length})`}
            </Button>
            {showAllPast && (
              <div className="space-y-2">
                {olderPast.map(renderCard)}
              </div>
            )}
          </div>
        )}
      </div>

      <CampaignWizard open={wizardOpen} onOpenChange={setWizardOpen} />
    </div>
  );
}
