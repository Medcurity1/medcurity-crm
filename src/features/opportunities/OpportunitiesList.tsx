import { useState, useRef, useMemo, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useUrlState, useUrlNumberState, useUrlArrayState, useUrlSortState } from "@/hooks/useUrlState";
import { useDebouncedUrlState } from "@/hooks/useDebouncedUrlState";
import { useAuth } from "@/features/auth/AuthProvider";
import { Target, Plus, Search, X, Pencil, Check } from "lucide-react";
import { useOpportunities, useOpportunitiesTotals, useArchiveOpportunity, useBulkUpdateOwner, useBulkDeleteOpportunities, useUpdateOpportunity } from "./api";
import { useClosedLostGuard } from "./useClosedLostGuard";
import { toast } from "sonner";
import { useUsers } from "@/features/accounts/api";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { StatusBadge } from "@/components/StatusBadge";
import { Pagination } from "@/components/Pagination";
import { BulkActionBar } from "@/components/BulkActionBar";
import { SortableHeader, type SortState } from "@/components/SortableHeader";
// Sort state is URL-backed (useUrlSortState) so a rep can sort by Amount,
// drill into a deal, then hit Back and find the list still sorted — the
// previous useState-only version reset on every remount.
import { MultiSelect } from "@/components/MultiSelect";
import { SavedViews } from "@/features/saved-views/SavedViews";
import { ColumnPicker } from "@/features/list-columns/ColumnPicker";
import { useColumnPrefs } from "@/features/list-columns/useColumnPrefs";
import type { ColumnDescriptor } from "@/features/list-columns/columns";
import type { Opportunity, OpportunityStage } from "@/types/crm";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { stageLabel, businessTypeLabel, formatCurrency, formatDate } from "@/lib/formatters";
import { cn } from "@/lib/utils";

const OPPORTUNITIES_COLUMNS: ColumnDescriptor[] = [
  { key: "select", label: "Select", locked: true, headClassName: "w-10" },
  { key: "name", label: "Name", sortKey: "name", locked: true },
  { key: "account", label: "Account", sortKey: "account.name" },
  { key: "stage", label: "Stage", sortKey: "stage" },
  { key: "business_type", label: "Business Type", sortKey: "business_type" },
  { key: "amount", label: "Amount", sortKey: "amount", align: "right" },
  { key: "expected_close", label: "Expected Close", sortKey: "expected_close_date" },
  // Close Date column removed (Summer): it's only set the moment a deal closes,
  // at which point the opp leaves this open list — so it was always empty here.
  { key: "owner", label: "Owner", sortKey: "owner.full_name" },
  { key: "next_step", label: "Next Step" },
  // "Rotting deals" (Summer): days since the last real touch on the deal,
  // color-coded so stale deals jump out. Sortable (server-side via the
  // v_opportunities_with_activity view) — ascending surfaces the stalest first.
  { key: "last_touch", label: "Last Touch", sortKey: "last_touch" },
];

// Days since an ISO timestamp (floored, never negative).
function daysSinceTouch(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000));
}

// Color-coded "days since last touch" badge. Fresh deals are green; the longer
// since the last call/email/meeting/completed task, the hotter the color, so a
// "rotting" deal is obvious at a glance (Summer's Pipedrive-style request).
// A deal with NO logged activity falls back to its age since creation (with a
// ⚠ marker) so neglected deals still surface instead of showing a blank.
function StaleBadge({
  at,
  createdAt,
}: {
  at: string | null | undefined;
  createdAt: string;
}) {
  const never = at == null;
  const basis = at ?? createdAt;
  if (!basis) return <span className="text-muted-foreground">—</span>;
  const d = daysSinceTouch(basis);
  const tone =
    d < 7
      ? "bg-green-500/10 text-green-700 dark:text-green-400"
      : d < 14
        ? "bg-yellow-500/10 text-yellow-700 dark:text-yellow-400"
        : d < 30
          ? "bg-orange-500/10 text-orange-700 dark:text-orange-400"
          : "bg-red-500/10 text-red-700 dark:text-red-400";
  const label = d === 0 ? "Today" : d === 1 ? "1 day" : `${d} days`;
  const title = never
    ? `No activity logged — ${d} day${d === 1 ? "" : "s"} since the deal was created`
    : `Last touch ${formatDate(basis)} (${d} day${d === 1 ? "" : "s"} ago)`;
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium whitespace-nowrap",
        tone,
      )}
    >
      {never && <span className="opacity-70">⚠</span>}
      {label}
    </span>
  );
}

// ── Inline edit (Summer): edit Stage / Amount / Expected Close / Next Step
// right from the list. Click a cell to edit; saves on blur / Enter, Esc cancels.
const INLINE_STAGES: OpportunityStage[] = [
  "details_analysis", "demo", "proposal_and_price_quote",
  "proposal_conversation", "closed_won", "closed_lost",
];

function InlineStage({
  o,
  onClosedLost,
}: {
  o: Opportunity;
  onClosedLost: (accountId: string | null) => void;
}) {
  const update = useUpdateOpportunity();
  // Always include the opp's CURRENT stage as an option, even if it's a legacy
  // value (e.g. "qualified") that isn't in the standard pipeline list. Without
  // this, an item-aligned dropdown has no item matching the selected value and
  // renders the menu off-screen — which is exactly the "drops down but nothing
  // shows" bug. (We also force position="popper" below as a belt-and-suspenders
  // fix so the menu always anchors to the trigger.)
  const stageOptions = useMemo(
    () =>
      INLINE_STAGES.includes(o.stage)
        ? INLINE_STAGES
        : [o.stage, ...INLINE_STAGES],
    [o.stage],
  );
  return (
    <div onClick={(e) => e.stopPropagation()}>
      <Select
        value={o.stage}
        onValueChange={(v) => {
          if (v !== o.stage) {
            update.mutate(
              { id: o.id, stage: v as OpportunityStage },
              {
                onSuccess: () => {
                  toast.success(`Stage → ${stageLabel(v as OpportunityStage)}`);
                  if (v === "closed_lost") onClosedLost(o.account_id);
                },
                onError: (e) => toast.error("Couldn't update stage: " + (e as Error).message),
              },
            );
          }
        }}
      >
        <SelectTrigger
          title="Click to change stage"
          className="h-7 w-auto gap-1 rounded border border-dashed border-transparent bg-transparent px-1 shadow-none hover:border-muted-foreground/40 hover:bg-muted/60 focus:ring-0 [&>svg]:opacity-70"
        >
          <StatusBadge value={o.stage} variant="stage" label={stageLabel(o.stage)} />
        </SelectTrigger>
        {/* position="popper" anchors the menu to the trigger regardless of
            whether the current value matches an item — the item-aligned
            default mispositioned it to the bottom of the page. */}
        <SelectContent position="popper">
          {stageOptions.map((s) => (
            <SelectItem key={s} value={s}>{stageLabel(s)}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function InlineField({
  o, field, kind, display,
}: {
  o: Opportunity;
  field: "amount" | "expected_close_date" | "next_step";
  kind: "number" | "date" | "text";
  display: React.ReactNode;
}) {
  const update = useUpdateOpportunity();
  const [editing, setEditing] = useState(false);
  const raw = o[field] == null ? "" : String(o[field]);
  const initial = kind === "date" ? raw.slice(0, 10) : raw;
  const [val, setVal] = useState(initial);
  // Guards against a double-commit (e.g. Enter then the unmount blur).
  const doneRef = useRef(false);

  const startEdit = () => {
    setVal(initial);
    doneRef.current = false;
    setEditing(true);
  };
  const cancel = () => {
    doneRef.current = true;
    setVal(initial);
    setEditing(false);
  };

  if (!editing) {
    return (
      <button
        type="button"
        title="Click to edit"
        className="group/edit -mx-1 flex w-full items-center gap-1 rounded border border-dashed border-transparent px-1 py-0.5 text-left hover:border-muted-foreground/40 hover:bg-muted/60 cursor-text"
        onClick={(e) => { e.stopPropagation(); startEdit(); }}
      >
        <span className="min-w-0 truncate">{display}</span>
        <Pencil className="ml-auto h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover/edit:opacity-50" />
      </button>
    );
  }

  const commit = () => {
    if (doneRef.current) return; // already saved/cancelled
    doneRef.current = true;
    setEditing(false);
    let parsed: string | number | null;
    if (kind === "number") {
      if (val.trim() === "") {
        // `amount` is NOT NULL with a `>= 0` DB check — clearing it means 0,
        // not null (a null/negative save throws and the rep loses their edit).
        parsed = field === "amount" ? 0 : null;
      } else {
        parsed = Number(val);
        if (Number.isNaN(parsed)) return; // ignore a bad number
        if (parsed < 0) {
          toast.error("Amount can't be negative.");
          return;
        }
      }
    } else {
      parsed = val.trim() === "" ? null : val.trim();
    }
    const original = (o[field] == null ? null : (kind === "date" ? String(o[field]).slice(0, 10) : o[field]));
    // amount comes back from Supabase as a STRING (numeric serialized as text),
    // while parsed is a JS number — so a strict !== would ALWAYS look "changed"
    // and fire a no-op write + false "Saved" toast on every focus-and-blur.
    // Compare numerically for the number kind; string-compare text/date.
    const changed = kind === "number"
      ? Number(parsed ?? 0) !== Number(original ?? 0)
      : parsed !== original;
    if (changed) {
      update.mutate(
        { id: o.id, [field]: parsed } as Partial<Opportunity> & { id: string },
        {
          onSuccess: () => toast.success("Saved"),
          onError: (e) => toast.error("Couldn't save: " + (e as Error).message),
        },
      );
    }
  };

  // Inline editor: type, then Save (✓) / Enter, or Cancel (✕) / Esc. Clicking
  // away also saves. The buttons preventDefault on mousedown so they don't blur
  // the input first (which would double-fire the commit / race the cancel).
  return (
    <div className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
      <Input
        type={kind === "number" ? "number" : kind === "date" ? "date" : "text"}
        autoFocus
        value={val}
        onChange={(e) => setVal(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); commit(); }
          if (e.key === "Escape") { e.preventDefault(); cancel(); }
        }}
        // min-w keeps the field readable in the narrow Amount column — without
        // it the input collapsed to almost nothing once the Save/Cancel buttons
        // took their space. It still grows to fill wider columns (date/next step).
        className="h-7 w-full min-w-[7rem] text-sm"
      />
      <button
        type="button"
        title="Save (Enter)"
        onMouseDown={(e) => e.preventDefault()}
        onClick={commit}
        className="grid h-6 w-6 shrink-0 place-items-center rounded text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950"
      >
        <Check className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        title="Cancel (Esc)"
        onMouseDown={(e) => e.preventDefault()}
        onClick={cancel}
        className="grid h-6 w-6 shrink-0 place-items-center rounded text-muted-foreground hover:bg-muted"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export function OpportunitiesList() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const isAdmin = profile?.role === "admin" || profile?.role === "super_admin";
  const [search, setSearch] = useDebouncedUrlState("q", "");
  const [stageFilter, setStageFilter] = useUrlArrayState("stage");
  const [teamFilter, setTeamFilter] = useUrlArrayState("team");
  // Filter by business_type (5-value richer classification). The
  // legacy `kind` (new_business / renewal) is still used internally
  // by PipelineBoard to bucket Sales vs Renewals tabs, but no longer
  // exposed to users in the list view or detail badge.
  const [businessTypeFilter, setBusinessTypeFilter] = useUrlArrayState("business_type");
  const [ownerFilter, setOwnerFilter] = useUrlArrayState("owner");
  const [verifiedFilter, setVerifiedFilter] = useUrlState("verified", "all");
  // Date-range filter: ISO YYYY-MM-DD on close_date. Set by KPI
  // deep-links (e.g. "Team Closed Won This Month" → ?closed_after=
  // <month-start>) so the list view matches the count on the card.
  const [closedAfter, setClosedAfter] = useUrlState("closed_after", "");
  const [closedBefore, setClosedBefore] = useUrlState("closed_before", "");
  // Same idea against expected_close_date — used by the "Upcoming
  // Close Dates" KPI deep-link so the list matches the 30-day window
  // the card is counting.
  const [expectedAfter, setExpectedAfter] = useUrlState("expected_after", "");
  const [expectedBefore, setExpectedBefore] = useUrlState("expected_before", "");
  const [page, setPage] = useUrlNumberState("page", 0);
  // Default 100 per page (Summer: fewer pages to click through). The
  // Rows selector still offers 25/50/100/200 for anyone who wants less.
  const [pageSize, setPageSize] = useUrlNumberState("size", 100);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [sort, setSortState] = useUrlSortState("sort");
  const cols = useColumnPrefs("opportunities", OPPORTUNITIES_COLUMNS);
  // After a deal is marked Closed Lost for a current client, ask whether the
  // client is still contracted (Summer). Non-blocking; fires after the move.
  const closedLostGuard = useClosedLostGuard();

  // Totals query: same filter set as the visible list, but no
  // pagination/sort. Lets the user verify dashboard KPI numbers
  // against the same filtered list (e.g. clicking "My Open Pipeline"
  // should show a sum that matches the card).
  const totalsFilters = {
    search: search || undefined,
    stage: stageFilter.length ? stageFilter : undefined,
    team: teamFilter.length ? teamFilter : undefined,
    business_type: businessTypeFilter.length ? businessTypeFilter : undefined,
    ownerId: ownerFilter.length > 0 ? ownerFilter : undefined,
    verified:
      verifiedFilter === "verified"
        ? ("true" as const)
        : verifiedFilter === "unverified"
        ? ("false" as const)
        : undefined,
    closeAfter: closedAfter || undefined,
    closeBefore: closedBefore || undefined,
    expectedAfter: expectedAfter || undefined,
    expectedBefore: expectedBefore || undefined,
  };

  const { data: result, isLoading } = useOpportunities({
    ...totalsFilters,
    page,
    pageSize,
    sortColumn: sort.column,
    sortDirection: sort.direction,
  });
  const { data: totals } = useOpportunitiesTotals(totalsFilters);
  const { data: users } = useUsers();
  const archiveMutation = useArchiveOpportunity();
  const bulkOwnerMutation = useBulkUpdateOwner();
  const bulkDeleteMutation = useBulkDeleteOpportunities();

  const opps = result?.data;
  const totalCount = result?.count ?? 0;

  const handleSearchChange = (value: string) => {
    setSearch(value);
    setPage(0);
  };

  function handleSort(next: SortState) {
    setSortState(next);
    setPage(0);
  }

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (!opps) return;
    const allVisible = opps.map((o) => o.id);
    const allSelected = allVisible.every((id) => selectedIds.has(id));
    if (allSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        allVisible.forEach((id) => next.delete(id));
        return next;
      });
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        allVisible.forEach((id) => next.add(id));
        return next;
      });
    }
  };

  const handleBulkArchive = async () => {
    const ids = Array.from(selectedIds);
    await Promise.all(ids.map((id) => archiveMutation.mutateAsync({ id })));
    setSelectedIds(new Set());
  };

  const handleBulkDelete = async () => {
    if (!confirm(`Permanently delete ${selectedIds.size} opportunity(ies)? This cannot be undone.`)) return;
    await bulkDeleteMutation.mutateAsync({ ids: Array.from(selectedIds) });
    setSelectedIds(new Set());
    toast.success(`${selectedIds.size} opportunity(ies) deleted.`);
  };

  const handleBulkAssignOwner = async (userId: string) => {
    await bulkOwnerMutation.mutateAsync({ ids: Array.from(selectedIds), owner_user_id: userId });
    setSelectedIds(new Set());
  };

  const allChecked =
    !!opps?.length && opps.every((o) => selectedIds.has(o.id));

  const cellRenderers: Record<string, (o: Opportunity) => ReactNode> = {
    select: (o) => (
      <Checkbox
        checked={selectedIds.has(o.id)}
        onCheckedChange={() => toggleSelect(o.id)}
        aria-label={`Select ${o.name}`}
      />
    ),
    name: (o) => (
      <Link
        to={`/opportunities/${o.id}`}
        className="font-medium text-primary hover:underline"
        onClick={(e) => e.stopPropagation()}
      >
        {o.name}
      </Link>
    ),
    account: (o) =>
      o.account ? (
        <Link
          to={`/accounts/${o.account.id}`}
          className="text-primary hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          {o.account.name}
        </Link>
      ) : (
        "—"
      ),
    stage: (o) => <InlineStage o={o} onClosedLost={closedLostGuard.promptIfClient} />,
    business_type: (o) =>
      o.business_type ? (
        <StatusBadge
          value={o.business_type}
          variant="businessType"
          label={businessTypeLabel(o.business_type)}
        />
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
    amount: (o) => (
      <InlineField o={o} field="amount" kind="number"
        display={<span className="font-medium">{formatCurrency(o.amount)}</span>} />
    ),
    expected_close: (o) => (
      <InlineField o={o} field="expected_close_date" kind="date"
        display={<span className="text-muted-foreground">{o.expected_close_date ? formatDate(o.expected_close_date) : "—"}</span>} />
    ),
    owner: (o) => (
      <span className="text-muted-foreground">{o.owner?.full_name ?? "Unassigned"}</span>
    ),
    next_step: (o) => (
      <InlineField o={o} field="next_step" kind="text"
        display={
          <span className="block max-w-[240px] truncate text-muted-foreground" title={o.next_step ?? undefined}>
            {o.next_step || "—"}
          </span>
        } />
    ),
    last_touch: (o) => <StaleBadge at={o.last_activity_at} createdAt={o.created_at} />,
  };

  return (
    <div>
      <PageHeader
        title="Opportunities"
        description="Track your deals and pipeline"
        actions={
          <Button onClick={() => navigate("/opportunities/new")}>
            <Plus className="h-4 w-4 mr-2" />
            New Opportunity
          </Button>
        }
      />

      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="relative min-w-[220px] w-full sm:w-auto sm:flex-1 sm:max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search opportunities..."
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="pl-9"
          />
        </div>
        <MultiSelect
          value={stageFilter}
          onChange={(v) => { setStageFilter(v); setPage(0); }}
          placeholder="All Stages"
          triggerClassName="w-44"
          options={[
            { value: "details_analysis", label: "Details Analysis" },
            { value: "demo", label: "Demo" },
            { value: "proposal_and_price_quote", label: "Proposal and Price Quote" },
            { value: "proposal_conversation", label: "Proposal Conversation" },
            { value: "closed_won", label: "Closed Won" },
            { value: "closed_lost", label: "Closed Lost" },
          ]}
        />
        <MultiSelect
          value={businessTypeFilter}
          onChange={(v) => { setBusinessTypeFilter(v); setPage(0); }}
          placeholder="All Business Types"
          triggerClassName="w-44"
          options={[
            { value: "new_business", label: "New Business" },
            { value: "existing_business", label: "Existing Business" },
            { value: "existing_business_new_product", label: "Existing Business — New Product" },
            { value: "existing_business_new_service", label: "Existing Business — New Service" },
            { value: "opportunity", label: "Opportunity" },
          ]}
        />
        <MultiSelect
          value={teamFilter}
          onChange={(v) => { setTeamFilter(v); setPage(0); }}
          placeholder="All Teams"
          triggerClassName="w-36"
          options={[
            { value: "sales", label: "Sales" },
            { value: "renewals", label: "Renewals" },
          ]}
        />
        <MultiSelect
          value={ownerFilter}
          onChange={(v) => { setOwnerFilter(v); setPage(0); }}
          placeholder="All Owners"
          triggerClassName="w-40"
          options={[
            { value: "mine", label: "My Opps" },
            ...(users ?? []).map((u) => ({
              value: u.id,
              label: u.full_name ?? "Unknown",
            })),
          ]}
        />
        <Select value={verifiedFilter} onValueChange={(v) => { setVerifiedFilter(v); setPage(0); }}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="Verified" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="verified">Verified only</SelectItem>
            <SelectItem value="unverified">Unverified only</SelectItem>
          </SelectContent>
        </Select>

        <SavedViews entity="opportunities" />
        <ColumnPicker columns={OPPORTUNITIES_COLUMNS} prefs={cols} />
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : !opps?.length ? (
        <EmptyState
          icon={Target}
          title="No opportunities found"
          description={search || stageFilter.length || teamFilter.length || businessTypeFilter.length
            ? "Try adjusting your filters"
            : "Create your first opportunity"}
          action={!search && !stageFilter.length && !teamFilter.length && !businessTypeFilter.length ? {
            label: "New Opportunity",
            onClick: () => navigate("/opportunities/new"),
          } : undefined}
        />
      ) : (
        <>
          {/* Active date-range chips. Surfaced when a KPI deep-link
              (or manual URL edit) sets `closed_after` / `closed_before`
              so the user can SEE why the list is filtered and clear
              the constraint with one click. Without this, the list
              looks like it's narrower than the user's other filters
              for no obvious reason. */}
          {(closedAfter || closedBefore || expectedAfter || expectedBefore) && (
            <div className="flex flex-wrap items-center gap-2 mb-2">
              {closedAfter && (
                <button
                  type="button"
                  onClick={() => setClosedAfter("")}
                  className="inline-flex items-center gap-1 rounded-full border bg-muted px-2 py-1 text-xs hover:bg-muted/70"
                >
                  <span>Closed on/after {closedAfter}</span>
                  <X className="h-3 w-3" />
                </button>
              )}
              {closedBefore && (
                <button
                  type="button"
                  onClick={() => setClosedBefore("")}
                  className="inline-flex items-center gap-1 rounded-full border bg-muted px-2 py-1 text-xs hover:bg-muted/70"
                >
                  <span>Closed on/before {closedBefore}</span>
                  <X className="h-3 w-3" />
                </button>
              )}
              {expectedAfter && (
                <button
                  type="button"
                  onClick={() => setExpectedAfter("")}
                  className="inline-flex items-center gap-1 rounded-full border bg-muted px-2 py-1 text-xs hover:bg-muted/70"
                >
                  <span>Expected on/after {expectedAfter}</span>
                  <X className="h-3 w-3" />
                </button>
              )}
              {expectedBefore && (
                <button
                  type="button"
                  onClick={() => setExpectedBefore("")}
                  className="inline-flex items-center gap-1 rounded-full border bg-muted px-2 py-1 text-xs hover:bg-muted/70"
                >
                  <span>Expected on/before {expectedBefore}</span>
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          )}
          {/* Totals across the full filtered set (not just the visible
              page). Lets the user cross-check a dashboard KPI by
              landing here with the same filters and reading the sum
              off the strip. */}
          {totals && (
            <div className="flex items-center justify-end gap-4 mb-2 text-sm text-muted-foreground">
              <span>
                {totals.count.toLocaleString()} opportunit
                {totals.count === 1 ? "y" : "ies"}
              </span>
              <span className="font-medium text-foreground">
                Total: {formatCurrency(totals.sum)}
              </span>
            </div>
          )}
          <div className="border rounded-lg overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  {cols.visibleColumns.map((c) => {
                    if (c.key === "select") {
                      return (
                        <TableHead key="select" className="w-10">
                          <Checkbox
                            checked={allChecked}
                            onCheckedChange={toggleAll}
                            aria-label="Select all"
                          />
                        </TableHead>
                      );
                    }
                    return c.sortKey ? (
                      <SortableHeader
                        key={c.key}
                        column={c.sortKey}
                        sort={sort}
                        onSort={handleSort}
                        align={c.align}
                        className={c.headClassName}
                      >
                        {c.label}
                      </SortableHeader>
                    ) : (
                      <TableHead key={c.key} className={c.headClassName}>
                        {c.label}
                      </TableHead>
                    );
                  })}
                </TableRow>
              </TableHeader>
              <TableBody>
                {opps.map((opp) => (
                  <TableRow key={opp.id} className="cursor-pointer" onClick={() => navigate(`/opportunities/${opp.id}`)}>
                    {cols.visibleColumns.map((c) => (
                      <TableCell
                        key={c.key}
                        className={c.align === "right" ? "text-right" : undefined}
                        onClick={c.key === "select" ? (e) => e.stopPropagation() : undefined}
                      >
                        {cellRenderers[c.key]?.(opp)}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Pagination
            page={page}
            pageSize={pageSize}
            totalCount={totalCount}
            onPageChange={setPage}
            onPageSizeChange={(size) => {
              setPageSize(size);
              setPage(0);
            }}
          />
        </>
      )}

      <BulkActionBar
        selectedCount={selectedIds.size}
        onClear={() => setSelectedIds(new Set())}
        onArchive={isAdmin ? handleBulkArchive : undefined}
        onDelete={isAdmin ? handleBulkDelete : undefined}
        onAssignOwner={handleBulkAssignOwner}
        users={users}
      />
      {closedLostGuard.dialog}
    </div>
  );
}
