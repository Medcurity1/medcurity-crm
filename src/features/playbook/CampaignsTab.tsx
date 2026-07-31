// Campaigns tab — sequence templates (top) + the running/past campaign
// tracker. Ongoing = draft + active + paused; Recently ended = completed/
// stopped within the last 30 days; anything older sits behind a "Show all
// past" toggle. Import/Sync (Smartlead) sit atop the Ongoing section and
// refresh both. Start/Pause/Resume/Stop live right on each card (Campaigns
// overhaul S4) — a campaign never has to be managed by opening Smartlead.

import { useMemo, useState } from "react";
import { Megaphone, Download, RefreshCw, Loader2, Plus, Inbox, AlertTriangle, Search } from "lucide-react";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { useAuth } from "@/features/auth/AuthProvider";
import { CampaignWizard } from "./CampaignWizard";
import { TemplatesSection } from "./TemplatesSection";
import { CampaignReplies } from "./CampaignReplies";
import { LoadError } from "./LoadError";
import { CampaignCard, type CampaignRow } from "./CampaignCard";
import { CampaignDetailSheet } from "./CampaignDetailSheet";
import { InboxHealthDialog } from "./InboxHealthDialog";
import { campaignAttentionFlags, type AttentionFlag } from "./needs-attention";
import {
  useCampaigns,
  useSmartleadStatus,
  useImportCampaigns,
  useSyncCampaigns,
  useAnalyzeCampaign,
  useDeleteCampaign,
  useSetCampaignStatus,
  useCampaignEnrollmentStats,
  useCampaignsMonthStats,
  useUnhandledReplyCounts,
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
  const [search, setSearch] = useState("");
  const [showAllPast, setShowAllPast] = useState(false);
  // Detail sheet (Campaigns overhaul S8) — `detailCampaign` deliberately
  // isn't cleared on close (only `detailOpen` toggles), so Radix's own
  // slide-out animation has real content to animate away rather than the
  // sheet vanishing instantly.
  const [detailCampaign, setDetailCampaign] = useState<CampaignRow | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [inboxHealthOpen, setInboxHealthOpen] = useState(false);

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

  // Owner filter and search are applied in two steps deliberately: the
  // enrollment-stats fetch keys on the OWNER-filtered id list only, so
  // typing in the search box never mints a new stats cache key (each
  // keystroke used to refire the whole enrollment query and blank every
  // card's people-line — adversarial review).
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

  // "Needs you today" (outside-review I27): the unhandled-reply tally is a
  // dedicated uncapped count query (outside-review I35 — it used to piggyback
  // on the Replies feed's 50-row query, where handled rows consumed cap
  // slots and older unhandled replies silently fell off the tally). The
  // section (and the pulling-out of flagged cards) waits until that query
  // settles, so cards don't visibly jump between sections when it resolves
  // mid-render. A FAILED tally query is surfaced inline below (talliesError)
  // instead of silently rendering "nothing needs you".
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
    // `now` deliberately not a dep — it changes every render; the flags only
    // meaningfully change when the underlying data does.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, unhandledByCampaign, talliesSettled]);

  // Ongoing = draft + active + paused. Campaigns that need a human are
  // pulled OUT into their own section at the top. A terminal (completed/
  // stopped) campaign joins it ONLY for a replies flag — but then
  // regardless of age, since campaigns.updated_at is never maintained after
  // insert and the 30-day bucket would otherwise hide a fresh reply on an
  // old campaign behind "Show all past" (adversarial review).
  //
  // origin === 'legacy' rows (the one-time Mailchimp-era snapshot from
  // 20260722100000_campaigns_unify.sql) never get new smartlead data — no
  // sync ever touches them — so they can never earn their way out of
  // "ongoing" or "needs attention" on the merits; they'd sit there forever
  // (docket I16, "Draft for 34 days" on prod). The backfill migration
  // (20260728210500) closes out the ones that existed at deploy time, but
  // this exclusion is the belt-and-braces: ANY future legacy-origin row,
  // regardless of its status column, is treated as already past and never
  // eligible for needsAttention — it always falls through to
  // recentlyEnded/olderPast below. Every existing non-legacy behavior is
  // unchanged.
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
  const ongoing = filtered.filter(
    (c) =>
      (c.status === "draft" || c.status === "active" || c.status === "paused") &&
      !isLegacy(c) &&
      !needsIds.has(c.id),
  );
  const recentlyEnded = recentlyEndedAll.filter((c) => !needsIds.has(c.id));
  const olderPast = allPast.filter(
    (c) => now - new Date(c.updated_at).getTime() > RECENTLY_ENDED_MS && !needsIds.has(c.id),
  );
  // The "no ongoing campaigns" message should still appear when the only
  // flagged campaigns are terminal ones (their amber box isn't "ongoing").
  const anyOngoingAnywhere =
    ongoing.length > 0 ||
    needsAttention.some((c) => c.status === "draft" || c.status === "active" || c.status === "paused");

  // Re-resolve the sheet's campaign against the live list on every render so
  // its header (status chip, metrics) stays current after a Start/Pause/
  // Stop from either the card or the sheet itself — `detailCampaign` is just
  // the snapshot captured at click time. Falls back to that snapshot if the
  // row briefly isn't in `campaigns` yet (e.g. still loading).
  const liveDetailCampaign = useMemo(() => {
    if (!detailCampaign) return null;
    const rows = (campaigns ?? []) as CampaignRow[];
    return rows.find((c) => c.id === detailCampaign.id) ?? detailCampaign;
  }, [campaigns, detailCampaign]);

  // One grouped enrollment-stats fetch for every campaign in the OWNER-
  // filtered list (not the search-filtered one — see ownerFiltered's
  // comment — and not just the rendered subset): cheap at this scale, and
  // expanding "Show all past" or typing a search never needs a new fetch.
  const statsIds = useMemo(() => ownerFiltered.map((c) => c.id), [ownerFiltered]);
  const { data: statsById } = useCampaignEnrollmentStats(statsIds);

  // "This month" strip (Campaigns overhaul Phase 3, S9) — a quick pulse-check
  // above the tracker, independent of the owner/everyone filter above (it's
  // a team-wide number, not a per-view one).
  const { data: monthStats } = useCampaignsMonthStats();

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

  return (
    <div className="space-y-5 pt-4">
      <TemplatesSection />

      <CampaignReplies />

      {/* This month — a quick pulse-check, plain-English counts over the
          last 30 days (Campaigns overhaul Phase 3, S9). Only renders once
          there's at least one non-zero number, so a brand-new team doesn't
          see a row of zeroes. */}
      {monthStats && (monthStats.campaignsLaunched || monthStats.peopleEnrolled || monthStats.replies) ? (
        <div className="border-t pt-4">
          <p className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">This month:</span>{" "}
            {monthStats.campaignsLaunched} {monthStats.campaignsLaunched === 1 ? "campaign" : "campaigns"} launched
            {" · "}{monthStats.peopleEnrolled} {monthStats.peopleEnrolled === 1 ? "person" : "people"} enrolled
            {" · "}{monthStats.replies} {monthStats.replies === 1 ? "reply" : "replies"}
            {monthStats.positiveReplies > 0 ? ` (${monthStats.positiveReplies} positive)` : ""}
          </p>
        </div>
      ) : null}

      <div className="border-t pt-4 space-y-3">
        {/* Ongoing section header + the Smartlead actions (refresh both sections) */}
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-3 flex-wrap">
            <h3 className="text-sm font-semibold">Ongoing campaigns</h3>
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
                className="h-7 w-44 pl-7 text-xs"
              />
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
                <Button size="sm" variant="outline" onClick={() => setInboxHealthOpen(true)}>
                  <Inbox className="h-4 w-4 mr-1" /> Sending inboxes
                </Button>
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

        {/* Needs you today (outside-review I27) — every campaign with an
            unhandled reply, a stall, a high bounce rate, or a forgotten
            draft, pulled out of its normal section so trouble is the FIRST
            thing on the tracker instead of buried in a flat list. */}
        {/* A failed replies-tally query means the replies flag (the highest-
            value signal here) may be missing — say so instead of quietly
            rendering a calm page (outside-review I35). The other flags
            (bounce/stall/draft) still work off the campaigns query. */}
        {!isLoading && !isError && talliesError && (
          <div className="rounded-md border border-amber-300/60 dark:border-amber-500/30 p-3 flex items-center gap-2 flex-wrap">
            <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
            <p className="text-xs text-muted-foreground">
              Couldn't check for waiting replies — "Needs you today" may be missing reply alerts.
            </p>
            <Button size="sm" variant="outline" className="h-6 px-2 text-xs" onClick={() => unhandledQ.refetch()}>
              Retry
            </Button>
          </div>
        )}
        {!isLoading && !isError && needsAttention.length > 0 && (
          <div className="rounded-md border border-amber-300/60 dark:border-amber-500/30 p-3 space-y-2">
            <h3 className="text-sm font-semibold flex items-center gap-1.5">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              Needs you today ({needsAttention.length})
            </h3>
            {needsAttention.map(renderCard)}
          </div>
        )}

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
        ) : anyOngoingAnywhere ? null : (
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
