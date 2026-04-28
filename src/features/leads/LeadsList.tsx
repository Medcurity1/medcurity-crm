import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useUrlState, useUrlNumberState, useUrlArrayState } from "@/hooks/useUrlState";
import { useDebouncedUrlState } from "@/hooks/useDebouncedUrlState";
import { useAuth } from "@/features/auth/AuthProvider";
import { UserPlus, Plus, Search, X } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useLeads, useArchiveLead, useBulkUpdateOwner, useBulkDeleteLeads } from "./api";
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
import type { LeadSource } from "@/types/crm";
import { SortableHeader, type SortState } from "@/components/SortableHeader";
import { MultiSelect } from "@/components/MultiSelect";
import { formatPhone } from "@/components/PhoneInput";

const PAGE_SIZE = 25;

function useLeadQuickStats() {
  return useQuery({
    queryKey: ["leads", "quick-stats"],
    queryFn: async () => {
      // Don't fetch rows — use head:true counts. The previous version
      // pulled the full table and was capped at PostgREST's 1000-row
      // default, which is why the "Total Leads" card said 1000 when
      // the table actually has ~32k. Each count() is a single query
      // that returns just the count via Content-Range.
      const [totalRes, mqlRes, qualifiedRes] = await Promise.all([
        supabase
          .from("leads")
          .select("id", { count: "exact", head: true })
          .is("archived_at", null),
        supabase
          .from("leads")
          .select("id", { count: "exact", head: true })
          .is("archived_at", null)
          .eq("qualification", "mql"),
        // 'qualified' is the SF status that means "ready to convert"
        // — closer in spirit to the old "converted" metric for migrated
        // data, since converted leads aren't kept in the leads table.
        supabase
          .from("leads")
          .select("id", { count: "exact", head: true })
          .is("archived_at", null)
          .eq("status", "qualified"),
      ]);

      if (totalRes.error) throw totalRes.error;
      if (mqlRes.error) throw mqlRes.error;
      if (qualifiedRes.error) throw qualifiedRes.error;

      return {
        total: totalRes.count ?? 0,
        mql: mqlRes.count ?? 0,
        qualified: qualifiedRes.count ?? 0,
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

export function LeadsList() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const isAdmin = profile?.role === "admin" || profile?.role === "super_admin";
  const [search, setSearch] = useDebouncedUrlState("q", "");
  const [statusFilter, setStatusFilter] = useUrlArrayState("status");
  const [sourceFilter, setSourceFilter] = useUrlArrayState("source");
  const [qualificationFilter, setQualificationFilter] = useUrlArrayState("qual");
  const [ownerFilter, setOwnerFilter] = useUrlState("owner", "all");
  const [ratingFilter, setRatingFilter] = useUrlArrayState("rating");
  const [industryFilter, setIndustryFilter] = useUrlArrayState("industry");
  const [verifiedFilter, setVerifiedFilter] = useUrlState("verified", "all");
  // Hide converted leads by default. Toggle to show them when a rep
  // wants to dig into history. URL-state so a "show converted" view
  // is bookmarkable.
  const [showConverted, setShowConverted] = useUrlState("show_converted", "false");
  const [page, setPage] = useUrlNumberState("page", 0);
  const [sort, setSort] = useState<SortState>({ column: null, direction: "desc" });
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Reset to page 0 whenever sort changes so the user doesn't end up
  // on page 47 of the new ordering with nothing visible.
  function handleSort(next: SortState) {
    setSort(next);
    setPage(0);
  }

  const { data: result, isLoading } = useLeads({
    search: search || undefined,
    status: statusFilter.length ? statusFilter : undefined,
    source: sourceFilter.length ? sourceFilter : undefined,
    qualification: qualificationFilter.length ? qualificationFilter : undefined,
    ownerId:
      ownerFilter === "all" ? undefined : ownerFilter === "mine" ? "mine" : ownerFilter,
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
    pageSize: PAGE_SIZE,
  });
  const { data: users } = useUsers();
  const { data: quickStats } = useLeadQuickStats();
  const archiveMutation = useArchiveLead();
  const bulkOwnerMutation = useBulkUpdateOwner();
  const bulkDeleteMutation = useBulkDeleteLeads();

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
    if (!confirm(`Permanently delete ${selectedIds.size} lead(s)? This cannot be undone.`)) return;
    await bulkDeleteMutation.mutateAsync({ ids: Array.from(selectedIds) });
    setSelectedIds(new Set());
    toast.success(`${selectedIds.size} lead(s) deleted.`);
  };

  const handleBulkAssignOwner = async (userId: string) => {
    await bulkOwnerMutation.mutateAsync({ ids: Array.from(selectedIds), owner_user_id: userId });
    setSelectedIds(new Set());
  };

  const allChecked =
    !!leads?.length && leads.every((l) => selectedIds.has(l.id));

  return (
    <div>
      <PageHeader
        title="Leads"
        description="Track and convert your sales leads"
        actions={
          <Button onClick={() => navigate("/leads/new")}>
            <Plus className="h-4 w-4 mr-2" />
            New Lead
          </Button>
        }
      />

      <div className="grid grid-cols-3 gap-3 mb-4">
        <StatCard label="Total Leads" value={quickStats?.total ?? 0} />
        <StatCard label="MQL" value={quickStats?.mql ?? 0} />
        <StatCard label="Qualified" value={quickStats?.qualified ?? 0} />
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search leads..."
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
            { value: "cold_call", label: "Cold Call" },
            { value: "conference", label: "Conference" },
            { value: "email_campaign", label: "Email Campaign" },
            { value: "mql", label: "MQL" },
            { value: "partner", label: "Partner" },
            { value: "podcast", label: "Podcast" },
            { value: "referral", label: "Referral" },
            { value: "social_media", label: "Social Media" },
            { value: "sql", label: "SQL" },
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
        <Select value={ownerFilter} onValueChange={(v) => { setOwnerFilter(v); setPage(0); }}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="All owners" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Owners</SelectItem>
            <SelectItem value="mine">My Leads</SelectItem>
            {(users ?? []).map((u) => (
              <SelectItem key={u.id} value={u.id}>
                {u.full_name ?? "Unknown"}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
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
          <SelectTrigger className="w-44" title="Converted leads are hidden by default">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="false">Hide converted</SelectItem>
            <SelectItem value="true">Show converted</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Applied-filter chip row. */}
      {(statusFilter.length > 0 ||
        sourceFilter.length > 0 ||
        qualificationFilter.length > 0 ||
        ownerFilter !== "all" ||
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
          {ownerFilter !== "all" && (
            <FilterChip label={`Owner: ${ownerFilter === "mine" ? "Me" : (users ?? []).find((u) => u.id === ownerFilter)?.full_name ?? "Other"}`} onClear={() => { setOwnerFilter("all"); setPage(0); }} />
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
      ) : !leads?.length ? (
        <EmptyState
          icon={UserPlus}
          title="No leads found"
          description={
            search || statusFilter.length > 0 || sourceFilter.length > 0 || qualificationFilter.length > 0
              ? "Try adjusting your search or filters"
              : "Create your first lead to get started"
          }
          action={
            !search && !statusFilter.length && !sourceFilter.length && !qualificationFilter.length
              ? {
                  label: "New Lead",
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
                  <TableHead className="w-10">
                    <Checkbox
                      checked={allChecked}
                      onCheckedChange={toggleAll}
                      aria-label="Select all"
                    />
                  </TableHead>
                  <SortableHeader column="last_name" sort={sort} onSort={handleSort}>Name</SortableHeader>
                  <SortableHeader column="company" sort={sort} onSort={handleSort}>Company</SortableHeader>
                  <SortableHeader column="status" sort={sort} onSort={handleSort}>Status</SortableHeader>
                  <SortableHeader column="qualification" sort={sort} onSort={handleSort}>Qualification</SortableHeader>
                  <SortableHeader column="source" sort={sort} onSort={handleSort}>Source</SortableHeader>
                  <SortableHeader column="email" sort={sort} onSort={handleSort}>Email</SortableHeader>
                  <SortableHeader column="phone" sort={sort} onSort={handleSort}>Phone</SortableHeader>
                  <TableHead>Owner</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {leads.map((lead) => (
                  <TableRow
                    key={lead.id}
                    className="cursor-pointer"
                    onClick={() => navigate(`/leads/${lead.id}`)}
                  >
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={selectedIds.has(lead.id)}
                        onCheckedChange={() => toggleSelect(lead.id)}
                        aria-label={`Select ${lead.first_name} ${lead.last_name}`}
                      />
                    </TableCell>
                    <TableCell className="max-w-[200px]">
                      <Link
                        to={`/leads/${lead.id}`}
                        className="font-medium text-primary hover:underline block truncate"
                        title={`${lead.first_name ?? ""} ${lead.last_name ?? ""}`.trim()}
                        onClick={(e) => e.stopPropagation()}
                      >
                        {lead.first_name} {lead.last_name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground max-w-[260px]">
                      <div className="truncate" title={lead.company ?? ""}>
                        {lead.company ?? "\u2014"}
                      </div>
                    </TableCell>
                    <TableCell>
                      <StatusBadge
                        value={lead.status}
                        variant="leadStatus"
                        label={leadStatusLabel(lead.status)}
                      />
                    </TableCell>
                    <TableCell>
                      <StatusBadge
                        value={lead.qualification}
                        variant="qualification"
                        label={qualificationLabel(lead.qualification)}
                      />
                    </TableCell>
                    <TableCell>
                      {lead.source ? (
                        <StatusBadge
                          value={lead.source}
                          variant="leadSource"
                          label={leadSourceLabel(lead.source as LeadSource)}
                        />
                      ) : (
                        <span className="text-muted-foreground">{"\u2014"}</span>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground max-w-[240px]">
                      <div className="truncate" title={lead.email ?? ""}>
                        {lead.email ?? "\u2014"}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground whitespace-nowrap">
                      {lead.phone ? formatPhone(lead.phone) : "\u2014"}
                    </TableCell>
                    <TableCell className="text-muted-foreground max-w-[160px]">
                      <div className="truncate" title={lead.owner?.full_name ?? "Unassigned"}>
                        {lead.owner?.full_name ?? "Unassigned"}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <Pagination
            page={page}
            pageSize={PAGE_SIZE}
            totalCount={totalCount}
            onPageChange={setPage}
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
    </div>
  );
}
