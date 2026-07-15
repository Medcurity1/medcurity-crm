import { useState, type ReactNode } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useUrlState, useUrlNumberState, useUrlArrayState } from "@/hooks/useUrlState";
import { useDebouncedUrlState } from "@/hooks/useDebouncedUrlState";
import { useAuth } from "@/features/auth/AuthProvider";
import { UserPlus, Plus, Search, X, ListChecks, Save, UserCheck, Upload, Ban, AlertTriangle, Archive } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useLeads, useArchiveLead, useBulkUpdateOwner, useBulkDeleteLeads, useBulkPromoteImports, useMarkImportAvoid } from "./api";
import { BulkArchiveFromFile } from "./BulkArchiveFromFile";
import { BulkPromoteFromFile } from "./BulkPromoteFromFile";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { useUsers } from "@/features/accounts/api";
import { supabase } from "@/lib/supabase";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { StatusBadge } from "@/components/StatusBadge";
import { Pagination } from "@/components/Pagination";
import { BulkActionBar } from "@/components/BulkActionBar";
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
import { toast } from "sonner";
import { leadStatusLabel, leadSourceLabel, qualificationLabel } from "@/lib/formatters";
import type { LeadSource, Lead } from "@/types/crm";
import { SortableHeader, type SortState } from "@/components/SortableHeader";
import { ColumnPicker } from "@/features/list-columns/ColumnPicker";
import { useColumnPrefs } from "@/features/list-columns/useColumnPrefs";
import type { ColumnDescriptor } from "@/features/list-columns/columns";
import { MultiSelect } from "@/components/MultiSelect";
import { formatPhone } from "@/components/PhoneInput";
import {
  ChooseListDialog,
  CreateListDialog,
} from "@/features/lead-lists/LeadListsPage";
import type { LeadListFilterConfig } from "@/features/lead-lists/lead-lists-api";

const LEADS_COLUMNS: ColumnDescriptor[] = [
  { key: "select", label: "Select", locked: true, headClassName: "w-10" },
  { key: "name", label: "Name", sortKey: "last_name", locked: true },
  { key: "company", label: "Company", sortKey: "company" },
  { key: "status", label: "Status", sortKey: "status" },
  { key: "qualification", label: "Qualification", sortKey: "qualification" },
  { key: "source", label: "Source", sortKey: "source" },
  { key: "email", label: "Email", sortKey: "email" },
  { key: "phone", label: "Phone", sortKey: "phone" },
  { key: "owner", label: "Owner" },
];

function useLeadQuickStats() {
  return useQuery({
    queryKey: ["leads", "quick-stats"],
    queryFn: async () => {
      // Don't fetch rows — use head:true counts. The previous version
      // pulled the full table and was capped at PostgREST's 1000-row
      // default, which is why the "Total Leads" card said 1000 when
      // the table actually has ~32k. Each count() is a single query
      // that returns just the count via Content-Range.
      // Import-workflow stats (MQL/qualification is a Contact concept now,
      // not an Import one): the active pile, plus cumulative promoted and
      // avoided. head:true counts dodge PostgREST's 1000-row cap.
      const [totalRes, promotedRes, avoidedRes] = await Promise.all([
        // Active imports = the working pile (not yet promoted or archived).
        supabase
          .from("leads")
          .select("id", { count: "exact", head: true })
          .is("archived_at", null),
        // Promoted to contacts (cumulative; promoted imports are archived).
        supabase
          .from("leads")
          .select("id", { count: "exact", head: true })
          .eq("status", "converted"),
        // Marked Avoid (bounced/unsub/auto-reply/manual). Require archived
        // so a restored import (avoid_reason kept, un-archived) isn't
        // double-counted here and in the pending pile.
        supabase
          .from("leads")
          .select("id", { count: "exact", head: true })
          .not("avoid_reason", "is", null)
          .not("archived_at", "is", null),
      ]);

      if (totalRes.error) throw totalRes.error;
      if (promotedRes.error) throw promotedRes.error;
      if (avoidedRes.error) throw avoidedRes.error;

      return {
        total: totalRes.count ?? 0,
        promoted: promotedRes.count ?? 0,
        avoided: avoidedRes.count ?? 0,
      };
    },
  });
}

function FilterChip({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 text-primary px-2 py-0.5">
      {label}
      <button
        type="button"
        onClick={onClear}
        className="hover:text-destructive"
        aria-label={`Clear ${label} filter`}
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}

function StatCard({ label, value }: { label: string; value: number | string }) {
  // Format numeric values with grouping commas (32145 → "32,145").
  // Strings pass through unchanged.
  const display = typeof value === "number" ? value.toLocaleString() : value;
  return (
    <Card>
      <CardContent className="px-4 py-3">
        <p className="text-xs text-muted-foreground font-medium">{label}</p>
        <p className="text-2xl font-semibold mt-1">{display}</p>
      </CardContent>
    </Card>
  );
}

// The Leads tab is admin-only. Guard wrapper keeps the hooks in the inner
// component unconditional (rules-of-hooks safe).
export function LeadsList() {
  const { profile } = useAuth();
  if (profile?.role !== "admin" && profile?.role !== "super_admin") {
    return <Navigate to="/accounts" replace />;
  }
  return <ImportsList />;
}

function ImportsList() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const isAdmin = profile?.role === "admin" || profile?.role === "super_admin";
  const [bulkArchiveOpen, setBulkArchiveOpen] = useState(false);
  const [bulkPromoteOpen, setBulkPromoteOpen] = useState(false);
  const [search, setSearch] = useDebouncedUrlState("q", "");
  const [statusFilter, setStatusFilter] = useUrlArrayState("status");
  const [sourceFilter, setSourceFilter] = useUrlArrayState("source");
  const [qualificationFilter, setQualificationFilter] = useUrlArrayState("qual");
  const [ownerFilter, setOwnerFilter] = useUrlArrayState("owner");
  const [ratingFilter, setRatingFilter] = useUrlArrayState("rating");
  const [industryFilter, setIndustryFilter] = useUrlArrayState("industry");
  const [verifiedFilter, setVerifiedFilter] = useUrlState("verified", "all");
  // Hide converted leads by default. Toggle to show them when a rep
  // wants to dig into history. URL-state so a "show converted" view
  // is bookmarkable.
  const [showConverted, setShowConverted] = useUrlState("show_converted", "false");
  const [page, setPage] = useUrlNumberState("page", 0);
  const [pageSize, setPageSize] = useUrlNumberState("size", 25);
  const [sort, setSort] = useState<SortState>({ column: null, direction: "desc" });
  const cols = useColumnPrefs("leads", LEADS_COLUMNS);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showAddToList, setShowAddToList] = useState(false);
  const [showSaveSmartList, setShowSaveSmartList] = useState(false);

  // Translates the /leads URL filters into the LeadListFilterConfig
  // shape used by smart lists. Only fields that have a smart-list filter
  // analog get carried over; the rest (verified, showConverted) are
  // /leads-only chrome and don't make sense as list criteria.
  function buildSmartListSeed(): LeadListFilterConfig {
    const config: LeadListFilterConfig = {};
    if (statusFilter.length) config.status = statusFilter;
    if (sourceFilter.length) config.source = sourceFilter;
    if (qualificationFilter.length) config.qualification = qualificationFilter;
    if (ratingFilter.length) config.rating = ratingFilter;
    if (industryFilter.length) config.industry_category = industryFilter;
    if (ownerFilter.length) {
      // 'mine' is a /leads convenience token meaning the current user.
      // Map it to the actual user id so the smart list keeps working
      // for the rep who created it (and not the viewer).
      config.owner_user_id = ownerFilter.map((id) =>
        id === "mine" && profile ? profile.id : id,
      );
    }
    if (search) config.search = search;
    return config;
  }

  function suggestedListName(): string {
    const parts: string[] = [];
    if (statusFilter.length) parts.push(statusFilter.join("/"));
    if (qualificationFilter.length) parts.push(qualificationFilter.map((q) => q.toUpperCase()).join("/"));
    if (industryFilter.length) parts.push(industryFilter[0].replace(/_/g, " "));
    if (ratingFilter.length) parts.push(`${ratingFilter.join("/")} leads`);
    return parts.length ? parts.join(" · ") : "New smart list";
  }

  // Reset to page 0 whenever sort changes so the user doesn't end up
  // on page 47 of the new ordering with nothing visible.
  function handleSort(next: SortState) {
    setSort(next);
    setPage(0);
  }

  const { data: result, isLoading, isError, refetch, isFetching } = useLeads({
    search: search || undefined,
    status: statusFilter.length ? statusFilter : undefined,
    source: sourceFilter.length ? sourceFilter : undefined,
    qualification: qualificationFilter.length ? qualificationFilter : undefined,
    ownerId: ownerFilter.length > 0 ? ownerFilter : undefined,
    rating: ratingFilter.length ? ratingFilter : undefined,
    industryCategory: industryFilter.length ? industryFilter : undefined,
    verified:
      verifiedFilter === "verified"
        ? "true"
        : verifiedFilter === "unverified"
        ? "false"
        : undefined,
    includeConverted: showConverted === "true",
    sortColumn: sort.column,
    sortDirection: sort.direction,
    page,
    pageSize,
  });
  const { data: users } = useUsers();
  const { data: quickStats } = useLeadQuickStats();
  const archiveMutation = useArchiveLead();
  const bulkOwnerMutation = useBulkUpdateOwner();
  const bulkDeleteMutation = useBulkDeleteLeads();
  const bulkPromoteMutation = useBulkPromoteImports();
  const markAvoidMutation = useMarkImportAvoid();

  const leads = result?.data;
  const totalCount = result?.count ?? 0;

  const handleSearchChange = (value: string) => {
    setSearch(value);
    setPage(0);
  };
  const handleStatusChange = (value: string[]) => {
    setStatusFilter(value);
    setPage(0);
  };
  const handleSourceChange = (value: string[]) => {
    setSourceFilter(value);
    setPage(0);
  };
  const handleQualificationChange = (value: string[]) => {
    setQualificationFilter(value);
    setPage(0);
  };
  const handleRatingChange = (value: string[]) => {
    setRatingFilter(value);
    setPage(0);
  };
  const handleIndustryChange = (value: string[]) => {
    setIndustryFilter(value);
    setPage(0);
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    if (!leads) return;
    const allVisible = leads.map((l) => l.id);
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
    if (!confirm(`Permanently delete ${selectedIds.size} import(s)? This cannot be undone.`)) return;
    await bulkDeleteMutation.mutateAsync({ ids: Array.from(selectedIds) });
    setSelectedIds(new Set());
    toast.success(`${selectedIds.size} import(s) deleted.`);
  };

  const handleBulkAssignOwner = async (userId: string) => {
    await bulkOwnerMutation.mutateAsync({ ids: Array.from(selectedIds), owner_user_id: userId });
    setSelectedIds(new Set());
  };

  const handleBulkPromote = async () => {
    const n = selectedIds.size;
    if (!confirm(
      `Promote ${n} import(s) to Contacts?\n\n` +
        `Each one is matched to an existing account by company name (or a new account is created), ` +
        `and its history follows it. Duplicates of existing contacts are skipped automatically.`,
    )) return;
    try {
      const r = await bulkPromoteMutation.mutateAsync(Array.from(selectedIds));
      setSelectedIds(new Set());
      const parts = [`${r.promoted} promoted`];
      if (r.skipped_duplicate) parts.push(`${r.skipped_duplicate} skipped (already a contact)`);
      if (r.skipped_ambiguous) parts.push(`${r.skipped_ambiguous} need a manual account (multiple matched)`);
      if (r.skipped_other) parts.push(`${r.skipped_other} skipped`);
      if (r.errors) parts.push(`${r.errors} error(s)`);
      toast.success(parts.join(" · "));
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const handleBulkAvoid = async (reason: string) => {
    const n = selectedIds.size;
    if (!confirm(
      `Mark ${n} import(s) as Avoid (${reason.replace(/_/g, " ")})? They'll be archived and ` +
        `kept out of any future import so they're never re-added.`,
    )) return;
    try {
      await Promise.all(Array.from(selectedIds).map((id) => markAvoidMutation.mutateAsync({ id, reason })));
      setSelectedIds(new Set());
      toast.success(`${n} marked Avoid`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  };

  const allChecked =
    !!leads?.length && leads.every((l) => selectedIds.has(l.id));

  const cellRenderers: Record<string, (l: Lead) => ReactNode> = {
    select: (lead) => (
      <Checkbox
        checked={selectedIds.has(lead.id)}
        onCheckedChange={() => toggleSelect(lead.id)}
        aria-label={`Select ${lead.first_name} ${lead.last_name}`}
      />
    ),
    name: (lead) => (
      <Link
        to={`/leads/${lead.id}`}
        className="font-medium text-primary hover:underline block truncate"
        title={`${lead.first_name ?? ""} ${lead.last_name ?? ""}`.trim()}
        onClick={(e) => e.stopPropagation()}
      >
        {lead.first_name} {lead.last_name}
      </Link>
    ),
    company: (lead) => (
      <div className="truncate" title={lead.company ?? ""}>
        {lead.company ?? "—"}
      </div>
    ),
    status: (lead) => (
      <StatusBadge
        value={lead.status}
        variant="leadStatus"
        label={leadStatusLabel(lead.status)}
      />
    ),
    qualification: (lead) => (
      <StatusBadge
        value={lead.qualification}
        variant="qualification"
        label={qualificationLabel(lead.qualification)}
      />
    ),
    source: (lead) =>
      lead.source ? (
        <StatusBadge
          value={lead.source}
          variant="leadSource"
          label={leadSourceLabel(lead.source as LeadSource)}
        />
      ) : (
        <span className="text-muted-foreground">{"—"}</span>
      ),
    email: (lead) => (
      <div className="truncate" title={lead.email ?? ""}>
        {lead.email ?? "—"}
      </div>
    ),
    phone: (lead) => (lead.phone ? formatPhone(lead.phone) : "—"),
    owner: (lead) => (
      <div className="truncate" title={lead.owner?.full_name ?? "Unassigned"}>
        {lead.owner?.full_name ?? "Unassigned"}
      </div>
    ),
  };

  return (
    <div>
      <PageHeader
        title="Leads"
        description="Leads and imported lists. Promote the good ones to Contacts; archive the rest."
        actions={
          <div className="flex items-center gap-2">
            <Button onClick={() => navigate("/admin?tab=data-import")}>
              <Upload className="h-4 w-4 mr-2" />
              Import a list
            </Button>
            {isAdmin && (
              <Button variant="outline" onClick={() => setBulkPromoteOpen(true)}>
                <UserCheck className="h-4 w-4 mr-2" />
                Bulk promote from file
              </Button>
            )}
            {isAdmin && (
              <Button variant="outline" onClick={() => setBulkArchiveOpen(true)}>
                <Archive className="h-4 w-4 mr-2" />
                Bulk archive from file
              </Button>
            )}
            <Button variant="outline" onClick={() => navigate("/leads/new")}>
              <Plus className="h-4 w-4 mr-2" />
              Add one
            </Button>
          </div>
        }
      />

      {isAdmin && (
        <BulkArchiveFromFile open={bulkArchiveOpen} onOpenChange={setBulkArchiveOpen} />
      )}
      {isAdmin && (
        <BulkPromoteFromFile open={bulkPromoteOpen} onOpenChange={setBulkPromoteOpen} />
      )}

      <div className="grid grid-cols-3 gap-3 mb-4">
        <StatCard label="Imports (pending)" value={quickStats?.total ?? 0} />
        <StatCard label="Promoted to Contacts" value={quickStats?.promoted ?? 0} />
        <StatCard label="Marked Avoid" value={quickStats?.avoided ?? 0} />
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search imports..."
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="pl-9"
          />
        </div>
        <MultiSelect
          value={statusFilter}
          onChange={handleStatusChange}
          placeholder="All Statuses"
          triggerClassName="w-44"
          options={[
            { value: "new", label: "New" },
            { value: "contacted", label: "Contacted" },
            { value: "qualified", label: "Qualified" },
            { value: "unqualified", label: "Unqualified" },
            { value: "converted", label: "Converted" },
          ]}
        />
        <MultiSelect
          value={sourceFilter}
          onChange={handleSourceChange}
          placeholder="All Sources"
          triggerClassName="w-44"
          options={[
            // mql/sql removed (Joe): Source is a CHANNEL; stage lives in the
            // Qualification field/filter below.
            { value: "cold_call", label: "Cold Call" },
            { value: "conference", label: "Conference" },
            { value: "email_campaign", label: "Email Campaign" },
            { value: "partner", label: "Partner" },
            { value: "podcast", label: "Podcast" },
            { value: "referral", label: "Referral" },
            { value: "social_media", label: "Social Media" },
            { value: "trade_show", label: "Trade Show" },
            { value: "webinar", label: "Webinar" },
            { value: "website", label: "Website" },
            { value: "other", label: "Other" },
          ]}
        />
        {/* SQL/SAL omitted per project workflow — a lead becoming SQL =
            converts to a contact, so leads only ever take unqualified/mql. */}
        <MultiSelect
          value={qualificationFilter}
          onChange={handleQualificationChange}
          placeholder="All Qualifications"
          triggerClassName="w-44"
          options={[
            { value: "unqualified", label: "Unqualified" },
            { value: "mql", label: "MQL" },
          ]}
        />
        <MultiSelect
          value={ownerFilter}
          onChange={(v) => { setOwnerFilter(v); setPage(0); }}
          placeholder="All Owners"
          triggerClassName="w-40"
          options={[
            { value: "mine", label: "My Leads" },
            ...(users ?? []).map((u) => ({
              value: u.id,
              label: u.full_name ?? "Unknown",
            })),
          ]}
        />
        <MultiSelect
          value={ratingFilter}
          onChange={handleRatingChange}
          placeholder="All Ratings"
          triggerClassName="w-36"
          options={[
            { value: "hot", label: "🔥 Hot" },
            { value: "warm", label: "Warm" },
            { value: "cold", label: "❄️ Cold" },
          ]}
        />
        <MultiSelect
          value={industryFilter}
          onChange={handleIndustryChange}
          placeholder="All Industries"
          triggerClassName="w-44"
          options={[
            { value: "behavioral_health", label: "Behavioral Health" },
            { value: "dental", label: "Dental" },
            { value: "fqhc", label: "FQHC" },
            { value: "healthcare_consulting", label: "Healthcare Consulting" },
            { value: "healthcare_it_vendor", label: "Healthcare IT Vendor" },
            { value: "home_health", label: "Home Health" },
            { value: "hospice", label: "Hospice" },
            { value: "hospital", label: "Hospital" },
            { value: "imaging_center", label: "Imaging Center" },
            { value: "insurance_payer", label: "Insurance / Payer" },
            { value: "lab_services", label: "Lab Services" },
            { value: "long_term_care", label: "Long-Term Care" },
            { value: "managed_service_provider", label: "Managed Service Provider" },
            { value: "medical_group", label: "Medical Group" },
            { value: "pediatrics", label: "Pediatrics" },
            { value: "pharmacy", label: "Pharmacy" },
            { value: "public_health_agency", label: "Public Health Agency" },
            { value: "rural_health_clinic", label: "Rural Health Clinic" },
            { value: "skilled_nursing", label: "Skilled Nursing" },
            { value: "specialty_clinic", label: "Specialty Clinic" },
            { value: "telemedicine", label: "Telemedicine" },
            { value: "tribal_health", label: "Tribal Health" },
            { value: "urgent_care", label: "Urgent Care" },
            { value: "other_healthcare", label: "Other Healthcare" },
            { value: "other", label: "Other" },
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
        {/* Show converted toggle — defaults OFF so the working list
            stays clean. Flip on to dig into history without losing the
            tombstone leads. */}
        <Select
          value={showConverted}
          onValueChange={(v) => { setShowConverted(v); setPage(0); }}
        >
          <SelectTrigger className="w-44" title="Converted (promoted) imports are hidden by default">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="false">Hide converted</SelectItem>
            <SelectItem value="true">Show converted</SelectItem>
          </SelectContent>
        </Select>
        {/* Save the current filter set as a reusable smart list. Disabled
            when there are no filters to capture — saving an empty list
            is just confusing. */}
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowSaveSmartList(true)}
          disabled={
            !search &&
            !statusFilter.length &&
            !sourceFilter.length &&
            !qualificationFilter.length &&
            !ownerFilter.length &&
            !ratingFilter.length &&
            !industryFilter.length
          }
          title="Save the current filter as a smart list"
        >
          <Save className="h-4 w-4 mr-1" />
          Save as smart list
        </Button>
        <ColumnPicker columns={LEADS_COLUMNS} prefs={cols} />
      </div>

      {/* Applied-filter chip row. */}
      {(statusFilter.length > 0 ||
        sourceFilter.length > 0 ||
        qualificationFilter.length > 0 ||
        ownerFilter.length > 0 ||
        ratingFilter.length > 0 ||
        industryFilter.length > 0 ||
        verifiedFilter !== "all") && (
        <div className="flex flex-wrap items-center gap-2 mb-4 text-xs">
          <span className="text-muted-foreground font-medium">Active filters:</span>
          {statusFilter.length > 0 && (
            <FilterChip label={`Status: ${statusFilter.join(", ")}`} onClear={() => { setStatusFilter([]); setPage(0); }} />
          )}
          {sourceFilter.length > 0 && (
            <FilterChip label={`Source: ${sourceFilter.join(", ")}`} onClear={() => { setSourceFilter([]); setPage(0); }} />
          )}
          {qualificationFilter.length > 0 && (
            <FilterChip label={`Qual: ${qualificationFilter.map((q) => q.toUpperCase()).join(", ")}`} onClear={() => { setQualificationFilter([]); setPage(0); }} />
          )}
          {ownerFilter.length > 0 && (
            <FilterChip
              label={`Owner: ${ownerFilter
                .map((id) =>
                  id === "mine"
                    ? "Me"
                    : (users ?? []).find((u) => u.id === id)?.full_name ?? "Other",
                )
                .join(", ")}`}
              onClear={() => {
                setOwnerFilter([]);
                setPage(0);
              }}
            />
          )}
          {ratingFilter.length > 0 && (
            <FilterChip label={`Rating: ${ratingFilter.join(", ")}`} onClear={() => { setRatingFilter([]); setPage(0); }} />
          )}
          {industryFilter.length > 0 && (
            <FilterChip label={`Industry: ${industryFilter.map((i) => i.replace(/_/g, " ")).join(", ")}`} onClear={() => { setIndustryFilter([]); setPage(0); }} />
          )}
          {verifiedFilter !== "all" && (
            <FilterChip label={`Verified: ${verifiedFilter}`} onClear={() => { setVerifiedFilter("all"); setPage(0); }} />
          )}
        </div>
      )}

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : isError ? (
        <EmptyState
          icon={AlertTriangle}
          title="Couldn't load leads"
          description="Something went wrong loading this list. This is usually a momentary hiccup — try again."
        >
          <Button onClick={() => refetch()} disabled={isFetching}>
            {isFetching ? "Retrying…" : "Try again"}
          </Button>
        </EmptyState>
      ) : !leads?.length ? (
        <EmptyState
          icon={UserPlus}
          title="No imports found"
          description={
            search || statusFilter.length > 0 || sourceFilter.length > 0 || qualificationFilter.length > 0
              ? "Try adjusting your search or filters"
              : "Import a list to get started"
          }
          action={
            !search && !statusFilter.length && !sourceFilter.length && !qualificationFilter.length
              ? {
                  label: "New Import",
                  onClick: () => navigate("/leads/new"),
                }
              : undefined
          }
        />
      ) : (
        <>
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
                {leads.map((lead) => (
                  <TableRow
                    key={lead.id}
                    className="cursor-pointer"
                    onClick={() => navigate(`/leads/${lead.id}`)}
                  >
                    {cols.visibleColumns.map((c) => (
                      <TableCell
                        key={c.key}
                        className={c.align === "right" ? "text-right" : undefined}
                        onClick={c.key === "select" ? (e) => e.stopPropagation() : undefined}
                      >
                        {cellRenderers[c.key]?.(lead)}
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
      >
        {isAdmin && (
          <Button
            size="sm"
            onClick={handleBulkPromote}
            disabled={bulkPromoteMutation.isPending}
          >
            <UserCheck className="h-4 w-4 mr-1" />
            {bulkPromoteMutation.isPending ? "Promoting…" : "Promote to Contacts"}
          </Button>
        )}
        {isAdmin && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" disabled={markAvoidMutation.isPending}>
                <Ban className="h-4 w-4 mr-1" />
                Mark Avoid
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {([
                ["bounced", "Bounced"],
                ["unsubscribed", "Unsubscribed"],
                ["auto_reply", "Auto-reply"],
                ["manual", "Other / manual"],
              ] as const).map(([val, label]) => (
                <DropdownMenuItem key={val} onSelect={() => handleBulkAvoid(val)}>
                  {label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <Button variant="outline" size="sm" onClick={() => setShowAddToList(true)}>
          <ListChecks className="h-4 w-4 mr-1" />
          Add to list…
        </Button>
      </BulkActionBar>

      {/* Static-list picker for the bulk "Add to list…" action. The
          dialog itself filters out smart lists since they're criteria-
          driven and can't accept manual additions. */}
      <ChooseListDialog
        open={showAddToList}
        onOpenChange={(o) => {
          setShowAddToList(o);
          if (!o) setSelectedIds(new Set());
        }}
        leadIds={Array.from(selectedIds)}
      />

      {/* "Save filter as smart list" — opens the standard CreateListDialog
          seeded with the current /leads filter state. Defaults to the
          smart-list type so the user just names it and saves. */}
      <CreateListDialog
        open={showSaveSmartList}
        onOpenChange={setShowSaveSmartList}
        initialFilters={buildSmartListSeed()}
        initialName={suggestedListName()}
      />
    </div>
  );
}
