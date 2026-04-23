import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useUrlState, useUrlNumberState } from "@/hooks/useUrlState";
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
  const [statusFilter, setStatusFilter] = useUrlState("status", "all");
  const [sourceFilter, setSourceFilter] = useUrlState("source", "all");
  const [qualificationFilter, setQualificationFilter] = useUrlState("qual", "all");
  const [ownerFilter, setOwnerFilter] = useUrlState("owner", "all");
  const [ratingFilter, setRatingFilter] = useUrlState("rating", "all");
  const [industryFilter, setIndustryFilter] = useUrlState("industry", "all");
  const [verifiedFilter, setVerifiedFilter] = useUrlState("verified", "all");
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
    status: statusFilter !== "all" ? statusFilter : undefined,
    source: sourceFilter !== "all" ? sourceFilter : undefined,
    qualification: qualificationFilter !== "all" ? qualificationFilter : undefined,
    ownerId:
      ownerFilter === "all" ? undefined : ownerFilter === "mine" ? "mine" : ownerFilter,
    rating: ratingFilter !== "all" ? ratingFilter : undefined,
    industryCategory: industryFilter !== "all" ? industryFilter : undefined,
    verified:
      verifiedFilter === "verified"
        ? "true"
        : verifiedFilter === "unverified"
        ? "false"
        : undefined,
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
  const handleStatusChange = (value: string) => {
    setStatusFilter(value);
    setPage(0);
  };
  const handleSourceChange = (value: string) => {
    setSourceFilter(value);
    setPage(0);
  };
  const handleQualificationChange = (value: string) => {
    setQualificationFilter(value);
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
        <Select value={statusFilter} onValueChange={handleStatusChange}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="new">New</SelectItem>
            <SelectItem value="contacted">Contacted</SelectItem>
            <SelectItem value="qualified">Qualified</SelectItem>
            <SelectItem value="unqualified">Unqualified</SelectItem>
            <SelectItem value="converted">Converted</SelectItem>
          </SelectContent>
        </Select>
        <Select value={sourceFilter} onValueChange={handleSourceChange}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="All sources" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Sources</SelectItem>
            <SelectItem value="cold_call">Cold Call</SelectItem>
            <SelectItem value="conference">Conference</SelectItem>
            <SelectItem value="email_campaign">Email Campaign</SelectItem>
            <SelectItem value="mql">MQL</SelectItem>
            <SelectItem value="partner">Partner</SelectItem>
            <SelectItem value="podcast">Podcast</SelectItem>
            <SelectItem value="referral">Referral</SelectItem>
            <SelectItem value="social_media">Social Media</SelectItem>
            <SelectItem value="sql">SQL</SelectItem>
            <SelectItem value="trade_show">Trade Show</SelectItem>
            <SelectItem value="webinar">Webinar</SelectItem>
            <SelectItem value="website">Website</SelectItem>
            <SelectItem value="other">Other</SelectItem>
          </SelectContent>
        </Select>
        <Select value={qualificationFilter} onValueChange={handleQualificationChange}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="All qualifications" />
          </SelectTrigger>
          <SelectContent>
            {/* SQL/SAL intentionally omitted: per project workflow,
                a lead becoming SQL = it converts to a contact, so
                a lead's qualification only ever takes 'unqualified'
                or 'mql'. */}
            <SelectItem value="all">All Qualifications</SelectItem>
            <SelectItem value="unqualified">Unqualified</SelectItem>
            <SelectItem value="mql">MQL</SelectItem>
          </SelectContent>
        </Select>
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
        <Select value={ratingFilter} onValueChange={(v) => { setRatingFilter(v); setPage(0); }}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="All ratings" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Ratings</SelectItem>
            <SelectItem value="hot">🔥 Hot</SelectItem>
            <SelectItem value="warm">Warm</SelectItem>
            <SelectItem value="cold">❄️ Cold</SelectItem>
          </SelectContent>
        </Select>
        <Select value={industryFilter} onValueChange={(v) => { setIndustryFilter(v); setPage(0); }}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="All industries" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Industries</SelectItem>
            <SelectItem value="behavioral_health">Behavioral Health</SelectItem>
            <SelectItem value="dental">Dental</SelectItem>
            <SelectItem value="fqhc">FQHC</SelectItem>
            <SelectItem value="healthcare_consulting">Healthcare Consulting</SelectItem>
            <SelectItem value="healthcare_it_vendor">Healthcare IT Vendor</SelectItem>
            <SelectItem value="home_health">Home Health</SelectItem>
            <SelectItem value="hospice">Hospice</SelectItem>
            <SelectItem value="hospital">Hospital</SelectItem>
            <SelectItem value="imaging_center">Imaging Center</SelectItem>
            <SelectItem value="insurance_payer">Insurance / Payer</SelectItem>
            <SelectItem value="lab_services">Lab Services</SelectItem>
            <SelectItem value="long_term_care">Long-Term Care</SelectItem>
            <SelectItem value="managed_service_provider">Managed Service Provider</SelectItem>
            <SelectItem value="medical_group">Medical Group</SelectItem>
            <SelectItem value="pediatrics">Pediatrics</SelectItem>
            <SelectItem value="pharmacy">Pharmacy</SelectItem>
            <SelectItem value="public_health_agency">Public Health Agency</SelectItem>
            <SelectItem value="rural_health_clinic">Rural Health Clinic</SelectItem>
            <SelectItem value="skilled_nursing">Skilled Nursing</SelectItem>
            <SelectItem value="specialty_clinic">Specialty Clinic</SelectItem>
            <SelectItem value="telemedicine">Telemedicine</SelectItem>
            <SelectItem value="tribal_health">Tribal Health</SelectItem>
            <SelectItem value="urgent_care">Urgent Care</SelectItem>
            <SelectItem value="other_healthcare">Other Healthcare</SelectItem>
            <SelectItem value="other">Other</SelectItem>
          </SelectContent>
        </Select>
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
      </div>

      {/* Applied-filter chip row. Surfacing this is partly for UX
          (clear what's filtering the table) and partly debug — when
          filters "look like they aren't applying" the user can now
          see whether the URL state actually updated. */}
      {(statusFilter !== "all" ||
        sourceFilter !== "all" ||
        qualificationFilter !== "all" ||
        ownerFilter !== "all" ||
        ratingFilter !== "all" ||
        industryFilter !== "all" ||
        verifiedFilter !== "all") && (
        <div className="flex flex-wrap items-center gap-2 mb-4 text-xs">
          <span className="text-muted-foreground font-medium">Active filters:</span>
          {statusFilter !== "all" && (
            <FilterChip label={`Status: ${statusFilter}`} onClear={() => { setStatusFilter("all"); setPage(0); }} />
          )}
          {sourceFilter !== "all" && (
            <FilterChip label={`Source: ${sourceFilter}`} onClear={() => { setSourceFilter("all"); setPage(0); }} />
          )}
          {qualificationFilter !== "all" && (
            <FilterChip label={`Qual: ${qualificationFilter.toUpperCase()}`} onClear={() => { setQualificationFilter("all"); setPage(0); }} />
          )}
          {ownerFilter !== "all" && (
            <FilterChip label={`Owner: ${ownerFilter === "mine" ? "Me" : (users ?? []).find((u) => u.id === ownerFilter)?.full_name ?? "Other"}`} onClear={() => { setOwnerFilter("all"); setPage(0); }} />
          )}
          {ratingFilter !== "all" && (
            <FilterChip label={`Rating: ${ratingFilter}`} onClear={() => { setRatingFilter("all"); setPage(0); }} />
          )}
          {industryFilter !== "all" && (
            <FilterChip label={`Industry: ${industryFilter.replace(/_/g, " ")}`} onClear={() => { setIndustryFilter("all"); setPage(0); }} />
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
            search || statusFilter !== "all" || sourceFilter !== "all" || qualificationFilter !== "all"
              ? "Try adjusting your search or filters"
              : "Create your first lead to get started"
          }
          action={
            !search && statusFilter === "all" && sourceFilter === "all" && qualificationFilter === "all"
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
