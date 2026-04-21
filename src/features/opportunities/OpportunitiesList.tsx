import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useUrlState, useUrlNumberState } from "@/hooks/useUrlState";
import { useDebouncedUrlState } from "@/hooks/useDebouncedUrlState";
import { useAuth } from "@/features/auth/AuthProvider";
import { Target, Plus, Search } from "lucide-react";
import { useOpportunities, useArchiveOpportunity, useBulkUpdateOwner, useBulkDeleteOpportunities } from "./api";
import { toast } from "sonner";
import { useUsers } from "@/features/accounts/api";
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
import { stageLabel, kindLabel, formatCurrency, formatDate } from "@/lib/formatters";

const PAGE_SIZE = 25;

export function OpportunitiesList() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const isAdmin = profile?.role === "admin" || profile?.role === "super_admin";
  const [search, setSearch] = useDebouncedUrlState("q", "");
  const [stageFilter, setStageFilter] = useUrlState("stage", "all");
  const [teamFilter, setTeamFilter] = useUrlState("team", "all");
  const [ownerFilter, setOwnerFilter] = useUrlState("owner", "all");
  const [verifiedFilter, setVerifiedFilter] = useUrlState("verified", "all");
  const [page, setPage] = useUrlNumberState("page", 0);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const { data: result, isLoading } = useOpportunities({
    search: search || undefined,
    stage: stageFilter !== "all" ? stageFilter : undefined,
    team: teamFilter !== "all" ? teamFilter : undefined,
    ownerId:
      ownerFilter === "all" ? undefined : ownerFilter === "mine" ? "mine" : ownerFilter,
    verified:
      verifiedFilter === "verified"
        ? "true"
        : verifiedFilter === "unverified"
        ? "false"
        : undefined,
    page,
    pageSize: PAGE_SIZE,
  });
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
  const handleStageChange = (value: string) => {
    setStageFilter(value);
    setPage(0);
  };
  const handleTeamChange = (value: string) => {
    setTeamFilter(value);
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
        <Select value={stageFilter} onValueChange={handleStageChange}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="All stages" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Stages</SelectItem>
            <SelectItem value="lead">Lead</SelectItem>
            <SelectItem value="qualified">Qualified</SelectItem>
            <SelectItem value="proposal">Proposal</SelectItem>
            <SelectItem value="verbal_commit">Verbal Commit</SelectItem>
            <SelectItem value="closed_won">Closed Won</SelectItem>
            <SelectItem value="closed_lost">Closed Lost</SelectItem>
          </SelectContent>
        </Select>
        <Select value={teamFilter} onValueChange={handleTeamChange}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="All teams" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Teams</SelectItem>
            <SelectItem value="sales">Sales</SelectItem>
            <SelectItem value="renewals">Renewals</SelectItem>
          </SelectContent>
        </Select>
        <Select value={ownerFilter} onValueChange={(v) => { setOwnerFilter(v); setPage(0); }}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="All owners" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Owners</SelectItem>
            <SelectItem value="mine">My Opps</SelectItem>
            {(users ?? []).map((u) => (
              <SelectItem key={u.id} value={u.id}>
                {u.full_name ?? "Unknown"}
              </SelectItem>
            ))}
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
          description={search || stageFilter !== "all" || teamFilter !== "all"
            ? "Try adjusting your filters"
            : "Create your first opportunity"}
          action={!search && stageFilter === "all" && teamFilter === "all" ? {
            label: "New Opportunity",
            onClick: () => navigate("/opportunities/new"),
          } : undefined}
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
                  <TableHead>Name</TableHead>
                  <TableHead>Account</TableHead>
                  <TableHead>Stage</TableHead>
                  <TableHead>Kind</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Expected Close</TableHead>
                  <TableHead>Close Date</TableHead>
                  <TableHead>Owner</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {opps.map((opp) => (
                  <TableRow key={opp.id} className="cursor-pointer" onClick={() => navigate(`/opportunities/${opp.id}`)}>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={selectedIds.has(opp.id)}
                        onCheckedChange={() => toggleSelect(opp.id)}
                        aria-label={`Select ${opp.name}`}
                      />
                    </TableCell>
                    <TableCell>
                      <Link
                        to={`/opportunities/${opp.id}`}
                        className="font-medium text-primary hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {opp.name}
                      </Link>
                    </TableCell>
                    <TableCell>
                      {opp.account ? (
                        <Link
                          to={`/accounts/${opp.account.id}`}
                          className="text-primary hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {opp.account.name}
                        </Link>
                      ) : "\u2014"}
                    </TableCell>
                    <TableCell>
                      <StatusBadge value={opp.stage} variant="stage" label={stageLabel(opp.stage)} />
                    </TableCell>
                    <TableCell>
                      <StatusBadge value={opp.kind} variant="kind" label={kindLabel(opp.kind)} />
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {formatCurrency(opp.amount)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(opp.expected_close_date)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {/* close_date is only set by the trigger when stage
                          hits closed_won/closed_lost. Empty otherwise. */}
                      {opp.close_date ? formatDate(opp.close_date) : "\u2014"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {opp.owner?.full_name ?? "Unassigned"}
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
