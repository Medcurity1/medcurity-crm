import { useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useUrlState, useUrlNumberState, useUrlArrayState, useUrlSortState } from "@/hooks/useUrlState";
import { useDebouncedUrlState } from "@/hooks/useDebouncedUrlState";
import { useAuth } from "@/features/auth/AuthProvider";
import { Building2, Plus, Search } from "lucide-react";
import { useAccounts, useArchiveAccount, useBulkUpdateOwner, useBulkDeleteAccounts, useUsers } from "./api";
import { toast } from "sonner";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { QueryError } from "@/components/QueryError";
import { StatusBadge } from "@/components/StatusBadge";
import { Pagination } from "@/components/Pagination";
import { BulkActionBar } from "@/components/BulkActionBar";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { SortableHeader, type SortState } from "@/components/SortableHeader";
import { MultiSelect } from "@/components/MultiSelect";
import { SavedViews } from "@/features/saved-views/SavedViews";
import { ColumnPicker } from "@/features/list-columns/ColumnPicker";
import { useColumnPrefs } from "@/features/list-columns/useColumnPrefs";
import type { ColumnDescriptor } from "@/features/list-columns/columns";
import type { Account } from "@/types/crm";
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
import { statusLabel, customerStatusLabel, formatDate, INDUSTRY_CATEGORY_LABELS } from "@/lib/formatters";

const ACCOUNTS_COLUMNS: ColumnDescriptor[] = [
  { key: "select", label: "Select", locked: true, headClassName: "w-10" },
  { key: "name", label: "Name", sortKey: "name", locked: true },
  { key: "status", label: "Status", sortKey: "status" },
  { key: "customer_status", label: "Customer Status", sortKey: "customer_status" },
  { key: "owner", label: "Owner" },
  { key: "industry", label: "Industry", sortKey: "industry" },
  { key: "contract_end", label: "Contract End", sortKey: "current_contract_end_date" },
  { key: "notes", label: "Notes" },
];

// Industry filter options derived from the shared label map so the filter
// can't drift from the source of truth in formatters.ts (the previous
// hardcoded copy had already diverged).
const INDUSTRY_FILTER_OPTIONS = Object.entries(INDUSTRY_CATEGORY_LABELS)
  .map(([value, label]) => ({ value, label }))
  .sort((a, b) => a.label.localeCompare(b.label));

export function AccountsList() {
  const navigate = useNavigate();
  const { profile } = useAuth();
  const isAdmin = profile?.role === "admin" || profile?.role === "super_admin";
  // Search box uses a debounced variant so rapid typing stays
  // responsive and we don't race the setSearchParams writes in
  // setPage(0) / setSearch (users on slow networks were losing
  // keystrokes on the list page).
  const [search, setSearch] = useDebouncedUrlState("q", "");
  const [statusFilter, setStatusFilter] = useUrlArrayState("status");
  const [customerStatusFilter, setCustomerStatusFilter] = useUrlArrayState("customer");
  const [ownerFilter, setOwnerFilter] = useUrlArrayState("owner");
  const [industryFilter, setIndustryFilter] = useUrlArrayState("industry");
  const [verifiedFilter, setVerifiedFilter] = useUrlState("verified", "all");
  const [page, setPage] = useUrlNumberState("page", 0);
  const [pageSize, setPageSize] = useUrlNumberState("size", 25);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // Bulk delete is confirmed via the app ConfirmDialog (not window.confirm)
  // so it matches the destructive-action pattern everywhere else.
  const [confirmBulkDelete, setConfirmBulkDelete] = useState(false);
  // Sort state is URL-backed (useUrlSortState) so a user can sort, drill
  // into an account, then hit Back and find the list still sorted — plain
  // useState reset on every remount.
  const [sort, setSortState] = useUrlSortState("sort");
  const cols = useColumnPrefs("accounts", ACCOUNTS_COLUMNS);

  const { data: result, isLoading, isError, isFetching, refetch } = useAccounts({
    search: search || undefined,
    status: statusFilter.length > 0 ? statusFilter : undefined,
    customerStatus: customerStatusFilter.length > 0 ? customerStatusFilter : undefined,
    ownerId: ownerFilter.length > 0 ? ownerFilter : undefined,
    industryCategory: industryFilter.length > 0 ? industryFilter : undefined,
    verified:
      verifiedFilter === "verified"
        ? "true"
        : verifiedFilter === "unverified"
        ? "false"
        : undefined,
    page,
    pageSize,
    sortColumn: sort.column,
    // No sort in the URL → leave direction undefined so the API's
    // default (name ASC) applies instead of the hook's "desc".
    sortDirection: sort.column ? sort.direction : undefined,
  });
  const { data: users } = useUsers();
  const archiveMutation = useArchiveAccount();
  const bulkOwnerMutation = useBulkUpdateOwner();
  const bulkDeleteMutation = useBulkDeleteAccounts();

  const accounts = result?.data;
  const totalCount = result?.count ?? 0;

  const handleSearchChange = (value: string) => {
    setSearch(value);
    // Reset pagination as search changes. setPage writes the same URL
    // object, but the debounced useDebouncedUrlState serializes its
    // own writes so there's no race with this one.
    if (page !== 0) setPage(0);
  };
  const handleStatusChange = (value: string[]) => {
    setStatusFilter(value);
    setPage(0);
  };
  const handleIndustryChange = (value: string[]) => {
    setIndustryFilter(value);
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
    if (!accounts) return;
    const allVisible = accounts.map((a) => a.id);
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
    const count = ids.length;
    try {
      await Promise.all(ids.map((id) => archiveMutation.mutateAsync({ id })));
      setSelectedIds(new Set());
      toast.success(`${count} account(s) archived.`);
    } catch (e) {
      // Keep the selection so the user can retry; surface why it failed.
      toast.error("Archive failed: " + (e as Error).message);
    }
  };

  // Opens the confirm dialog; the actual delete runs in doBulkDelete once
  // the user confirms.
  const handleBulkDelete = () => setConfirmBulkDelete(true);

  const doBulkDelete = async () => {
    // Capture the count BEFORE clearing the selection — reading selectedIds.size
    // after setSelectedIds(new Set()) showed "0 account(s) deleted".
    const count = selectedIds.size;
    try {
      await bulkDeleteMutation.mutateAsync({ ids: Array.from(selectedIds) });
      setSelectedIds(new Set());
      toast.success(`${count} account(s) deleted.`);
    } catch (e) {
      toast.error("Delete failed: " + (e as Error).message);
    }
  };

  const handleBulkAssignOwner = async (userId: string) => {
    const count = selectedIds.size;
    try {
      await bulkOwnerMutation.mutateAsync({ ids: Array.from(selectedIds), owner_user_id: userId });
      setSelectedIds(new Set());
      toast.success(`${count} account(s) reassigned.`);
    } catch (e) {
      // Keep the selection so the user can retry; surface why it failed
      // (e.g. some rows hit RLS / no longer exist) instead of failing silently.
      toast.error("Reassign failed: " + (e as Error).message);
    }
  };

  const allChecked =
    !!accounts?.length && accounts.every((a) => selectedIds.has(a.id));

  // Any filter narrowing the list — drives the empty-state copy so a
  // filtered-to-zero list says "adjust your filters", not "create your
  // first account".
  const hasActiveFilters =
    !!search ||
    statusFilter.length > 0 ||
    customerStatusFilter.length > 0 ||
    ownerFilter.length > 0 ||
    industryFilter.length > 0 ||
    verifiedFilter !== "all";

  const cellRenderers: Record<string, (a: Account) => ReactNode> = {
    select: (a) => (
      <Checkbox
        checked={selectedIds.has(a.id)}
        onCheckedChange={() => toggleSelect(a.id)}
        aria-label={`Select ${a.name}`}
      />
    ),
    name: (a) => (
      <Link
        to={`/accounts/${a.id}`}
        className="font-medium text-primary hover:underline"
        onClick={(e) => e.stopPropagation()}
      >
        {a.name}
      </Link>
    ),
    status: (a) => (
      <StatusBadge value={a.status} variant="status" label={statusLabel(a.status)} />
    ),
    customer_status: (a) => (
      <StatusBadge
        value={a.customer_status}
        variant="customerStatus"
        label={customerStatusLabel(a.customer_status)}
      />
    ),
    owner: (a) => (
      <span className="text-muted-foreground">{a.owner?.full_name ?? "Unassigned"}</span>
    ),
    industry: (a) => (
      <span className="text-muted-foreground">{a.industry ?? "—"}</span>
    ),
    contract_end: (a) => (
      <span className="text-muted-foreground">{formatDate(a.current_contract_end_date)}</span>
    ),
    notes: (a) => (
      <span
        className="block max-w-[240px] truncate text-muted-foreground"
        title={a.notes ?? undefined}
      >
        {a.notes || "—"}
      </span>
    ),
  };

  return (
    <div>
      <PageHeader
        title="Accounts"
        description="Manage your customer and prospect accounts"
        actions={
          <Button onClick={() => navigate("/accounts/new")}>
            <Plus className="h-4 w-4 mr-2" />
            New Account
          </Button>
        }
      />

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative min-w-[220px] w-full sm:w-auto sm:flex-1 sm:max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search accounts..."
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="pl-9"
          />
        </div>
        <MultiSelect
          value={statusFilter}
          onChange={handleStatusChange}
          placeholder="All Statuses"
          triggerClassName="w-40"
          options={[
            { value: "discovery", label: "Discovery" },
            { value: "pending", label: "Pending" },
            { value: "active", label: "Active" },
            { value: "inactive", label: "Inactive" },
            { value: "churned", label: "Churned" },
          ]}
        />

        <MultiSelect
          value={customerStatusFilter}
          onChange={(v) => {
            setCustomerStatusFilter(v);
            setPage(0);
          }}
          placeholder="Customer Status"
          triggerClassName="w-44"
          options={[
            { value: "client", label: "Client" },
            { value: "prospect", label: "Prospect" },
            { value: "former_client", label: "Former Client" },
          ]}
        />

        <MultiSelect
          value={ownerFilter}
          onChange={(v) => {
            setOwnerFilter(v);
            setPage(0);
          }}
          placeholder="All Owners"
          triggerClassName="w-40"
          options={[
            { value: "mine", label: "My Accounts" },
            ...(users ?? []).map((u) => ({
              value: u.id,
              label: u.full_name ?? "Unknown",
            })),
          ]}
        />

        <MultiSelect
          value={industryFilter}
          onChange={handleIndustryChange}
          placeholder="All Industries"
          triggerClassName="w-44"
          options={INDUSTRY_FILTER_OPTIONS}
        />

        <Select
          value={verifiedFilter}
          onValueChange={(v) => {
            setVerifiedFilter(v);
            setPage(0);
          }}
        >
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Verified" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="verified">Verified only</SelectItem>
            <SelectItem value="unverified">Unverified only</SelectItem>
          </SelectContent>
        </Select>

        <SavedViews entity="accounts" />
        <ColumnPicker columns={ACCOUNTS_COLUMNS} prefs={cols} />
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : isError ? (
        <QueryError
          message="Couldn't load accounts."
          onRetry={() => refetch()}
          isRetrying={isFetching}
        />
      ) : !accounts?.length ? (
        <EmptyState
          icon={Building2}
          title="No accounts found"
          description={hasActiveFilters
            ? "Try adjusting your search or filter"
            : "Create your first account to get started"}
          action={!hasActiveFilters ? {
            label: "New Account",
            onClick: () => navigate("/accounts/new"),
          } : undefined}
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
                {accounts.map((account) => (
                  <TableRow key={account.id} className="cursor-pointer transition-colors hover:bg-muted/40" onClick={() => navigate(`/accounts/${account.id}`)}>
                    {cols.visibleColumns.map((c) => (
                      <TableCell
                        key={c.key}
                        className={c.align === "right" ? "text-right" : undefined}
                        onClick={c.key === "select" ? (e) => e.stopPropagation() : undefined}
                      >
                        {cellRenderers[c.key]?.(account)}
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

      <ConfirmDialog
        open={confirmBulkDelete}
        onOpenChange={(o) => !o && setConfirmBulkDelete(false)}
        title="Delete accounts?"
        description={`Permanently delete ${selectedIds.size} account(s)? This cannot be undone.`}
        confirmLabel="Delete"
        destructive
        onConfirm={() => {
          setConfirmBulkDelete(false);
          void doBulkDelete();
        }}
      />
    </div>
  );
}
