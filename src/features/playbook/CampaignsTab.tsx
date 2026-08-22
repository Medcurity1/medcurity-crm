// Campaigns home — Aurora rebuild (Nathan 8/19). One action row (Create +
// Sync; Templates and Sending inboxes moved up to the page header), then
// consistent collapsible groups: Replies / Needs you / Active / Drafts /
// Recently ended. Every group gets the same clickable section header —
// "Needs you" is no longer the lone boxed one. Sync Smartlead runs the
// server's unified refresh (import new campaigns + metrics + statuses +
// stale-enrollment cleanup), so the old separate "Advanced import" button
// is gone — one button does all of it.

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { Megaphone, RefreshCw, Loader2, Plus, AlertTriangle, Search } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { useAuth } from "@/features/auth/AuthProvider";
import { CampaignSectionHeader } from "./CampaignSection";
import { CampaignWizard } from "./CampaignWizard";
import { TemplatesSection } from "./TemplatesSection";
import { CampaignReplies } from "./CampaignReplies";
import { QueryError } from "@/components/QueryError";
import { CampaignCard, type CampaignRow } from "./CampaignCard";
import { CampaignDetailSheet } from "./CampaignDetailSheet";
import { InboxHealthDialog } from "./InboxHealthDialog";
import { campaignAttentionFlags, type AttentionFlag } from "./needs-attention";
import { campaignGroupOpen, collapsedSearchMatchLabel, type CampaignListGroupId } from "./campaign-groups";
import { lastSyncedLabel } from "./campaign-freshness";
import {
  useCampaigns,
  useSmartleadStatus,
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

function CampaignGroup({
  id,
  title,
  count,
  open,
  onToggle,
  searchActive,
  children,
  icon,
}: {
  id: CampaignListGroupId;
  title: string;
  count: number;
  open: boolean;
  onToggle: () => void;
  searchActive: boolean;
  children: ReactNode;
  icon?: ReactNode;
}) {
  if (count <= 0) return null;
  const matchLabel = !open && searchActive ? collapsedSearchMatchLabel(count) : null;
  return (
    <section data-campaigns-group={id}>
      <CampaignSectionHeader
        title={title}
        count={count}
        open={open}
        onToggle={onToggle}
        icon={icon}
        trailing={matchLabel ? <span className="text-xs font-medium camp-link">{matchLabel}</span> : null}
      />
      {open && <div className="space-y-2 pt-2">{children}</div>}
    </section>
  );
}

export function CampaignsTab({
  templatesOpen,
  onTemplatesOpenChange,
  inboxHealthOpen,
  onInboxHealthOpenChange,
}: {
  templatesOpen: boolean;
  onTemplatesOpenChange: (o: boolean) => void;
  inboxHealthOpen: boolean;
  onInboxHealthOpenChange: (o: boolean) => void;
}) {
  const { profile } = useAuth();
  const isAdmin = profile?.role === "admin" || profile?.role === "super_admin";
  const { data: campaigns, isLoading, isError, refetch } = useCampaigns();
  const { data: sl, isLoading: slLoading, isError: slError, refetch: refetchSl } = useSmartleadStatus();
  const [searchParams] = useSearchParams();
  const { data: inboxes } = useEmailAccounts();
  const refreshMut = useRefreshSmartlead();
  const analyze = useAnalyzeCampaign();
  const del = useDeleteCampaign();
  const setStatus = useSetCampaignStatus();
  const [wizardOpen, setWizardOpen] = useState(false);
  const [wizardNonce, setWizardNonce] = useState(0);
  const [wizardMode, setWizardMode] = useState<"ai" | "template">("ai");
  const [wizardSeed, setWizardSeed] = useState<{ template_id: string | null; name: string; steps: SequenceStep[] } | undefined>(undefined);
  const [ownerFilter, setOwnerFilter] = useState<"everyone" | "mine">("everyone");
  const [search, setSearch] = useState("");
  const [showAllPast, setShowAllPast] = useState(false);
  const [detailCampaign, setDetailCampaign] = useState<CampaignRow | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
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
    onTemplatesOpenChange(false);
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
        adminActions={isAdmin}
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
    <div className="camp-wash space-y-5 p-4 sm:p-5" data-campaigns-shell>
      {/* THE action row — everything else moved up to the page header. */}
      <div className="flex items-center gap-2 flex-wrap">
        {slLoading ? (
          <p className="text-xs text-muted-foreground">Checking Smartlead…</p>
        ) : sl?.configured ? (
          <>
            <button type="button" className="camp-btn-primary" onClick={openCreate}>
              <Plus className="h-4 w-4" /> Create campaign
            </button>
            {isAdmin && <button type="button" className="camp-btn" onClick={() => refreshMut.mutate()} disabled={refreshMut.isPending}>
              {refreshMut.isPending ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> Syncing…</>
              ) : (
                <><RefreshCw className="h-4 w-4" /> Sync Smartlead</>
              )}
            </button>}
            {isAdmin && lastSyncedLabel(latestSync) && (
              <span className="text-[11px] text-muted-foreground">{lastSyncedLabel(latestSync)}</span>
            )}
          </>
        ) : slError ? (
          <button type="button" className="camp-btn" onClick={() => refetchSl()}>
            Retry Smartlead check
          </button>
        ) : (
          <p className="text-xs text-muted-foreground">
            Smartlead isn't connected. Reconnect it before launching campaigns.
          </p>
        )}
        <span className="flex-1" />
        {isAdmin && <div className="flex items-center gap-1">
          <button type="button" className="camp-pill" aria-pressed={ownerFilter === "everyone"} onClick={() => setOwnerFilter("everyone")}>
            Everyone
          </button>
          <button type="button" className="camp-pill" aria-pressed={ownerFilter === "mine"} onClick={() => setOwnerFilter("mine")}>
            Mine
          </button>
        </div>}
        <div className="relative">
          <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search campaigns…"
            className="h-9 w-52 pl-8 text-xs rounded-lg"
          />
        </div>
      </div>

      {monthStats && (monthStats.campaignsLaunched || monthStats.peopleEnrolled || monthStats.replies) ? (
        <p className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Last 30 days:</span>{" "}
          {monthStats.campaignsLaunched} {monthStats.campaignsLaunched === 1 ? "campaign" : "campaigns"} launched
          {" · "}{monthStats.peopleEnrolled} {monthStats.peopleEnrolled === 1 ? "person" : "people"} enrolled
          {" · "}{monthStats.replies} {monthStats.replies === 1 ? "reply" : "replies"}
          {monthStats.positiveReplies > 0 ? ` (${monthStats.positiveReplies} positive)` : ""}
        </p>
      ) : null}

      {isAdmin && <CampaignReplies />}

      {!isLoading && !isError && talliesError && (
        <div className="camp-card p-3 flex items-center gap-2 flex-wrap">
          <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
          <p className="text-xs text-muted-foreground">
            Couldn't check for waiting replies. "Needs you" may be missing reply alerts.
          </p>
          <button type="button" className="camp-btn h-6 px-2 text-xs" onClick={() => unhandledQ.refetch()}>
            Retry
          </button>
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
          icon={<AlertTriangle className="h-4 w-4 text-amber-500" />}
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
        <div className="space-y-4">
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
              <button type="button" className="camp-link" onClick={() => setShowAllPast((v) => !v)}>
                {showAllPast ? "Hide older campaigns" : `Show all past (${olderPast.length})`}
              </button>
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

      <Dialog open={templatesOpen} onOpenChange={onTemplatesOpenChange}>
        <DialogContent className="camp-scope camp-shell camp-templates-dialog overflow-hidden flex flex-col p-0 gap-0">
          <div className="px-6 pt-6 pb-3 pr-12 shrink-0">
            <DialogHeader>
              <DialogTitle>Templates</DialogTitle>
              <DialogDescription className="sr-only">
                Review saved sequences, start from one, or create a custom campaign.
              </DialogDescription>
            </DialogHeader>
          </div>
          <div className="camp-templates-body px-6 pb-6">
            <TemplatesSection embedded onUseTemplate={openFromTemplate} canManage={isAdmin} />
          </div>
        </DialogContent>
      </Dialog>

      <InboxHealthDialog open={inboxHealthOpen} onOpenChange={onInboxHealthOpenChange} />

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
