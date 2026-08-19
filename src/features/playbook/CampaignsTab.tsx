// Campaigns home — one Create action, one Smartlead sync surface, then
// independently collapsible Replies / Needs you / Active / Drafts /
// Recently ended. Page title lives on PlaybookPage; this header is
// freshness plus named actions only.

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { Megaphone, RefreshCw, Loader2, Plus, Inbox, AlertTriangle, Search, Download, LayoutTemplate, ChevronDown } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useAuth } from "@/features/auth/AuthProvider";
import { CampaignWizard } from "./CampaignWizard";
import { TemplatesSection } from "./TemplatesSection";
import { CampaignReplies } from "./CampaignReplies";
import { QueryError } from "@/components/QueryError";
import { CampaignCard, type CampaignRow } from "./CampaignCard";
import { CampaignDetailSheet } from "./CampaignDetailSheet";
import { InboxHealthDialog } from "./InboxHealthDialog";
import { campaignAttentionFlags, type AttentionFlag } from "./needs-attention";
import { campaignGroupOpen, collapsedSearchMatchLabel, type CampaignListGroupId } from "./campaign-groups";
import { dailySweepLocalTimeLabel, lastSyncedLabel } from "./campaign-freshness";
import {
  useCampaigns,
  useSmartleadStatus,
  useImportCampaigns,
  useRefreshSmartlead,
  useAnalyzeCampaign,
  useDeleteCampaign,
  useSetCampaignStatus,
  useCampaignEnrollmentStats,
  useCampaignsMonthStats,
  useUnhandledReplyCounts,
  useEmailAccounts,
} from "./api";
import type { SequenceStep } from "./types";

const RECENTLY_ENDED_DAYS = 30;
const RECENTLY_ENDED_MS = RECENTLY_ENDED_DAYS * 24 * 60 * 60 * 1000;

function FilterPill({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "rounded-full px-3 py-1 text-xs font-medium transition-colors",
        active
          ? "campaigns-cta text-white"
          : "bg-transparent text-muted-foreground hover:bg-accent",
      )}
    >
      {label}
    </button>
  );
}

function CampaignGroup({
  id,
  title,
  count,
  open,
  onToggle,
  searchActive,
  children,
  className,
  icon,
}: {
  id: CampaignListGroupId;
  title: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  searchActive: boolean;
  children: ReactNode;
  className?: string;
  icon?: ReactNode;
}) {
  if (count <= 0) return null;
  const matchLabel = !open && searchActive ? collapsedSearchMatchLabel(count) : null;
  return (
    <section className={className} data-campaigns-group={id}>
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 text-left"
        aria-expanded={open}
        onClick={onToggle}
      >
        <h3 className="text-sm font-semibold flex items-center gap-1.5">
          {icon}
          {title} ({count})
        </h3>
        <span className="flex items-center gap-2">
          {matchLabel && (
            <span className="text-xs font-medium text-primary">{matchLabel}</span>
          )}
          <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", open && "rotate-180")} />
        </span>
      </button>
      {open && <div className="space-y-2 pt-2">{children}</div>}
    </section>
  );
}

export function CampaignsTab() {
  const { profile } = useAuth();
  const { data: campaigns, isLoading, isError, refetch } = useCampaigns();
  const { data: sl, isLoading: slLoading, isError: slError, refetch: refetchSl } = useSmartleadStatus();
  const [searchParams] = useSearchParams();
  const { data: inboxes } = useEmailAccounts();
  const importMut = useImportCampaigns();
  const refreshMut = useRefreshSmartlead();
  const analyze = useAnalyzeCampaign();
  const del = useDeleteCampaign();
  const setStatus = useSetCampaignStatus();
  const busy = importMut.isPending || refreshMut.isPending;
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardNonce, setWizardNonce] = useState(0);
  const [wizardMode, setWizardMode] = useState<"ai" | "template">("ai");
  const [wizardSeed, setWizardSeed] = useState<{ template_id: string | null; name: string; steps: SequenceStep[] } | undefined>(undefined);
  const [ownerFilter, setOwnerFilter] = useState<"everyone" | "mine">("everyone");
  const [search, setSearch] = useState("");
  const [showAllPast, setShowAllPast] = useState(false);
  const [detailCampaign, setDetailCampaign] = useState<CampaignRow | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [inboxHealthOpen, setInboxHealthOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [groupOverride, setGroupOverride] = useState<Partial<Record<CampaignListGroupId, boolean>>>({});

  const inboxLabels = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of inboxes ?? []) {
      const label = a.from_email ?? a.from_name ?? `Inbox ${a.id}`;
      m.set(String(a.id), label);
    }
    return m;
  }, [inboxes]);

  function inboxLabelFor(c: CampaignRow): string | null {
    return c.sending_email_account_id ? inboxLabels.get(c.sending_email_account_id) ?? null : null;
  }

  const ownerFiltered = useMemo(() => {
    const rows = (campaigns ?? []) as CampaignRow[];
    if (ownerFilter === "mine") return rows.filter((c) => c.owner_user_id === profile?.id);
    return rows;
  }, [campaigns, ownerFilter, profile?.id]);

  const searchActive = search.trim().length > 0;
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return ownerFiltered;
    return ownerFiltered.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        (c.owner?.full_name ?? "").toLowerCase().includes(q),
    );
  }, [ownerFiltered, search]);

  const unhandledQ = useUnhandledReplyCounts();
  const talliesSettled = !unhandledQ.isPending;
  const talliesError = unhandledQ.isError;
  const unhandledByCampaign = unhandledQ.data;

  const now = Date.now();
  const attentionById = useMemo(() => {
    const m = new Map<string, AttentionFlag[]>();
    if (!talliesSettled) return m;
    for (const c of filtered) {
      const flags = campaignAttentionFlags(c, {
        unhandledReplies: unhandledByCampaign?.[c.id] ?? 0,
        nowMs: now,
      });
      if (flags.length) m.set(c.id, flags);
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, unhandledByCampaign, talliesSettled]);

  const isLegacy = (c: CampaignRow) => c.origin === "legacy";
  const allPast = filtered.filter((c) => c.status === "completed" || c.status === "stopped" || isLegacy(c));
  const recentlyEndedAll = allPast.filter((c) => now - new Date(c.updated_at).getTime() <= RECENTLY_ENDED_MS);
  const needsAttention = filtered.filter((c) => {
    if (isLegacy(c)) return false;
    const flags = attentionById.get(c.id);
    if (!flags) return false;
    const terminal = c.status === "completed" || c.status === "stopped";
    return terminal ? flags.some((f) => f.kind === "replies") : true;
  });
  const needsIds = new Set(needsAttention.map((c) => c.id));
  const active = filtered.filter(
    (c) =>
      (c.status === "active" || c.status === "paused") &&
      !isLegacy(c) &&
      !needsIds.has(c.id),
  );
  const drafts = filtered.filter(
    (c) => c.status === "draft" && !isLegacy(c) && !needsIds.has(c.id),
  );
  const recentlyEnded = recentlyEndedAll.filter((c) => !needsIds.has(c.id));
  const olderPast = allPast.filter(
    (c) => now - new Date(c.updated_at).getTime() > RECENTLY_ENDED_MS && !needsIds.has(c.id),
  );
  const anyLiveAnywhere =
    active.length > 0 ||
    drafts.length > 0 ||
    needsAttention.some((c) => c.status === "draft" || c.status === "active" || c.status === "paused");

  const liveDetailCampaign = useMemo(() => {
    if (!detailCampaign) return null;
    const rows = (campaigns ?? []) as CampaignRow[];
    return rows.find((c) => c.id === detailCampaign.id) ?? detailCampaign;
  }, [campaigns, detailCampaign]);

  useEffect(() => {
    const id = searchParams.get("campaign");
    if (!id || !campaigns) return;
    const row = (campaigns as CampaignRow[]).find((c) => c.id === id);
    if (!row) return;
    setDetailCampaign(row);
    setDetailOpen(true);
  }, [campaigns, searchParams]);

  const searchKey = search.trim().toLowerCase();
  useEffect(() => {
    setGroupOverride((prev) => {
      if (prev.recentlyEnded === undefined) return prev;
      const next = { ...prev };
      delete next.recentlyEnded;
      return next;
    });
  }, [searchKey]);

  const statsIds = useMemo(() => ownerFiltered.map((c) => c.id), [ownerFiltered]);
  const { data: statsById } = useCampaignEnrollmentStats(statsIds);
  const { data: monthStats } = useCampaignsMonthStats();

  const latestSync = useMemo(() => {
    let latest: string | null = null;
    for (const c of ownerFiltered) {
      const stamp = c.settings?.last_metrics_sync_at;
      if (typeof stamp === "string" && (!latest || stamp > latest)) latest = stamp;
    }
    return latest;
  }, [ownerFiltered]);

  function openCreate() {
    setWizardMode("ai");
    setWizardSeed(undefined);
    setWizardNonce((n) => n + 1);
    setWizardOpen(true);
  }

  function openFromTemplate(seed: { template_id: string | null; name: string; steps: SequenceStep[] }) {
    setTemplatesOpen(false);
    setWizardMode("template");
    setWizardSeed(seed);
    setWizardNonce((n) => n + 1);
    setWizardOpen(true);
  }

  function toggleGroup(id: CampaignListGroupId, count: number) {
    setGroupOverride((prev) => ({
      ...prev,
      [id]: !campaignGroupOpen(id, count, searchActive, prev[id]),
    }));
  }

  function renderCard(c: CampaignRow) {
    return (
      <CampaignCard
        key={c.id}
        c={c}
        analyze={analyze}
        del={del}
        setStatus={setStatus}
        stats={statsById?.[c.id]}
        inboxLabel={inboxLabelFor(c)}
        attention={attentionById.get(c.id)}
        onOpenDetail={(row) => { setDetailCampaign(row); setDetailOpen(true); }}
      />
    );
  }

  const needsOpen = campaignGroupOpen("needsYou", needsAttention.length, searchActive, groupOverride.needsYou);
  const activeOpen = campaignGroupOpen("active", active.length, searchActive, groupOverride.active);
  const draftsOpen = campaignGroupOpen("drafts", drafts.length, searchActive, groupOverride.drafts);
  const recentlyEndedOpen = campaignGroupOpen(
    "recentlyEnded",
    recentlyEnded.length,
    searchActive,
    groupOverride.recentlyEnded,
  );

  return (
    <div className="campaigns-aurora space-y-5" data-campaigns-shell>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">
            {lastSyncedLabel(latestSync) ?? "Not synced yet"}
            {" · "}Automatic refresh daily at {dailySweepLocalTimeLabel()} Pacific
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {slLoading ? (
            <p className="text-xs text-muted-foreground">Checking Smartlead…</p>
          ) : sl?.configured ? (
            <>
              <Button className="campaigns-cta" size="sm" onClick={openCreate}>
                <Plus className="h-4 w-4 mr-1" /> Create campaign
              </Button>
              <Button size="sm" variant="outline" onClick={() => refreshMut.mutate()} disabled={busy}>
                {refreshMut.isPending ? (
                  <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Syncing…</>
                ) : (
                  <><RefreshCw className="h-4 w-4 mr-1" /> Sync Smartlead</>
                )}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setTemplatesOpen(true)}>
                <LayoutTemplate className="h-4 w-4 mr-1" /> Templates
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setInboxHealthOpen(true)}>
                <Inbox className="h-4 w-4 mr-1" /> Sending inboxes
              </Button>
              <Button size="sm" variant="ghost" onClick={() => importMut.mutate()} disabled={busy}>
                {importMut.isPending ? (
                  <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Importing…</>
                ) : (
                  <><Download className="h-4 w-4 mr-1" /> Advanced import</>
                )}
              </Button>
            </>
          ) : slError ? (
            <Button size="sm" variant="outline" onClick={() => refetchSl()}>
              Retry Smartlead check
            </Button>
          ) : (
            <p className="text-xs text-muted-foreground">
              Smartlead isn't connected. Reconnect it before launching campaigns.
            </p>
          )}
        </div>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1">
          <FilterPill label="Everyone" active={ownerFilter === "everyone"} onClick={() => setOwnerFilter("everyone")} />
          <FilterPill label="Mine" active={ownerFilter === "mine"} onClick={() => setOwnerFilter("mine")} />
        </div>
        <div className="relative">
          <Search className="h-3.5 w-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search campaigns…"
            className="h-8 w-52 pl-7 text-xs"
          />
        </div>
      </div>

      <CampaignReplies />

      {monthStats && (monthStats.campaignsLaunched || monthStats.peopleEnrolled || monthStats.replies) ? (
        <p className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Last 30 days:</span>{" "}
          {monthStats.campaignsLaunched} {monthStats.campaignsLaunched === 1 ? "campaign" : "campaigns"} launched
          {" · "}{monthStats.peopleEnrolled} {monthStats.peopleEnrolled === 1 ? "person" : "people"} enrolled
          {" · "}{monthStats.replies} {monthStats.replies === 1 ? "reply" : "replies"}
          {monthStats.positiveReplies > 0 ? ` (${monthStats.positiveReplies} positive)` : ""}
        </p>
      ) : null}

      {!isLoading && !isError && talliesError && (
        <div className="rounded-xl campaigns-surface p-3 flex items-center gap-2 flex-wrap">
          <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
          <p className="text-xs text-muted-foreground">
            Couldn't check for waiting replies. "Needs you" may be missing reply alerts.
          </p>
          <Button size="sm" variant="outline" className="h-6 px-2 text-xs" onClick={() => unhandledQ.refetch()}>
            Retry
          </Button>
        </div>
      )}
      {!isLoading && !isError && (
        <CampaignGroup
          id="needsYou"
          title="Needs you"
          count={needsAttention.length}
          open={needsOpen}
          onToggle={() => toggleGroup("needsYou", needsAttention.length)}
          searchActive={searchActive}
          className="rounded-xl campaigns-surface p-3"
          icon={<AlertTriangle className="h-4 w-4 text-amber-600" />}
        >
          {needsAttention.map(renderCard)}
        </CampaignGroup>
      )}

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}
        </div>
      ) : isError ? (
        <QueryError message="Couldn't load campaigns." onRetry={() => refetch()} />
      ) : (
        <div className="space-y-5">
          <CampaignGroup
            id="active"
            title="Active"
            count={active.length}
            open={activeOpen}
            onToggle={() => toggleGroup("active", active.length)}
            searchActive={searchActive}
          >
            {active.map(renderCard)}
          </CampaignGroup>
          <CampaignGroup
            id="drafts"
            title="Drafts"
            count={drafts.length}
            open={draftsOpen}
            onToggle={() => toggleGroup("drafts", drafts.length)}
            searchActive={searchActive}
          >
            {drafts.map(renderCard)}
          </CampaignGroup>
          {!anyLiveAnywhere && recentlyEnded.length === 0 && (
            <EmptyState
              icon={Megaphone}
              title={
                searchActive
                  ? "No campaigns match that search"
                  : allPast.length ? "No ongoing campaigns" : "No campaigns yet"
              }
              description={
                searchActive
                  ? "Try a different name, or clear the search."
                  : sl?.configured
                    ? "Create a campaign to get started."
                    : "Campaigns will live here once Smartlead is connected."
              }
            />
          )}
          <CampaignGroup
            id="recentlyEnded"
            title="Recently ended"
            count={recentlyEnded.length}
            open={recentlyEndedOpen}
            onToggle={() => toggleGroup("recentlyEnded", recentlyEnded.length)}
            searchActive={searchActive}
          >
            {recentlyEnded.map(renderCard)}
          </CampaignGroup>
          {olderPast.length > 0 && (
            <div className="space-y-2">
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setShowAllPast((v) => !v)}>
                {showAllPast ? "Hide older campaigns" : `Show all past (${olderPast.length})`}
              </Button>
              {showAllPast && olderPast.map(renderCard)}
            </div>
          )}
        </div>
      )}

      <CampaignWizard
        key={wizardNonce}
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        mode={wizardMode}
        templateSeed={wizardSeed}
      />

      <Dialog open={templatesOpen} onOpenChange={setTemplatesOpen}>
        <DialogContent className="campaigns-aurora campaigns-templates-dialog sm:max-w-4xl max-h-[min(88vh,calc(100dvh-2rem))] overflow-hidden flex flex-col p-0 gap-0">
          <div className="px-6 pt-6 pb-3 pr-12 shrink-0">
            <DialogHeader>
              <DialogTitle>Manage templates</DialogTitle>
              <DialogDescription>
                Review saved sequences, start from one, or create a custom campaign.
              </DialogDescription>
            </DialogHeader>
          </div>
          <div className="campaigns-templates-body px-6 pb-6">
            <TemplatesSection embedded onUseTemplate={openFromTemplate} />
          </div>
        </DialogContent>
      </Dialog>

      <InboxHealthDialog open={inboxHealthOpen} onOpenChange={setInboxHealthOpen} />

      <CampaignDetailSheet
        campaign={liveDetailCampaign}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        setStatus={setStatus}
        inboxLabel={liveDetailCampaign ? inboxLabelFor(liveDetailCampaign) : null}
      />
    </div>
  );
}
