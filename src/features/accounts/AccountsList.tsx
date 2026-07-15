import { useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useUrlState, useUrlNumberState, useUrlArrayState, useUrlSortState } from "@/hooks/useUrlState";
import { useDebouncedUrlState } from "@/hooks/useDebouncedUrlState";
import { useAuth } from "@/features/auth/AuthProvider";
import { Building2, Plus, Search } from "lucide-react";
import { useAccounts, useArchiveAccount, useBulkUpdateOwner, useBulkDeleteAccounts, useUsers, useStatesInUse } from "./api";
import { stateLabel } from "@/lib/us-states";
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
import { statusLabel, customerStatusLabel, salesStatusLabel, formatRelativeDate, formatDate, formatName, daysUntil, INDUSTRY_CATEGORY_LABELS } from "@/lib/formatters";
import { formatPhone } from "@/components/PhoneInput";

// "Contract End" (contract_end / current_contract_end_date) was replaced by
// "Last Touch" below (Jordan, 2026-07-08). AccountsList has a ColumnPicker,
// but useColumnPrefs has no working "default hidden, still available"
// mode — ColumnDescriptor.defaultHidden is declared but explicitly commented
// "reserved; unused in v1" in list-columns/columns.ts, and useColumnPrefs
// only tracks a per-user HIDDEN deny-list (everything in the registry is
// visible until a user personally toggles it off). Wiring up true
// "available but not default" would mean editing shared
// src/features/list-columns/** code, which is outside this change's file
// boundary — so Contract End is dropped from the registry entirely rather
// than left default-on (the spec's documented fallback for fixed-column
// lists). It's still fully viewable on the Account detail page.
const ACCOUNTS_COLUMNS: ColumnDescriptor[] = [
  { key: "select", label: "Select", locked: true, headClassName: "w-10" },
  { key: "name", label: "Name", sortKey: "name", locked: true },
  { key: "primary_contact", label: "Primary Contact" },
  { key: "phone", label: "Phone", sortKey: "phone" },
  { key: "status", label: "Status", sortKey: "status" },
  { key: "customer_status", label: "Account Status", sortKey: "customer_status" },
  { key: "sales", label: "Sales Status", sortKey: "sales_status" },
  { key: "next_follow_up", label: "Next Follow Up", sortKey: "next_follow_up_date" },
  { key: "owner", label: "Owner" },
  { key: "state", label: "State", sortKey: "billing_state" },
  { key: "industry", label: "Industry", sortKey: "industry" },
  { key: "last_touch", label: "Last Touch" },
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
  // Sales working-state filters (status restructure): ?sales=active|inactive,
  // ?sub=<comma-list of sales_status values>, ?follow_up=due|overdue.
  const [salesFilter, setSalesFilter] = useUrlState("sales", "all");
  const [subStatusFilter, setSubStatusFilter] = useUrlArrayState("sub");
  const [followUpFilter, setFollowUpFilter] = useUrlState("follow_up", "all");
  const [ownerFilter, setOwnerFilter] = useUrlArrayState("owner");
  const [industryFilter, setIndustryFilter] = useUrlArrayState("industry");
  const [stateFilter, setStateFilter] = useUrlArrayState("state");
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
    salesActive:
      salesFilter === "active" ? "true" : salesFilter === "inactive" ? "false" : undefined,
    salesStatus: subStatusFilter.length > 0 ? subStatusFilter : undefined,
    followUp:
      followUpFilter === "due" || followUpFilter === "overdue" ? followUpFilter : undefined,
    ownerId: ownerFilter.length > 0 ? ownerFilter : undefined,
    industryCategory: industryFilter.length > 0 ? industryFilter : undefined,
    billingState: stateFilter.length > 0 ? stateFilter : undefined,
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
  const { data: statesInUse } = useStatesInUse("accounts");
  const stateOptions = (statesInUse ?? []).map((s) => ({
    value: s.state,
    label: `${stateLabel(s.state)} · ${s.n}`,
  }));
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
  const handleStateChange = (value: string[]) => {
    setStateFilter(value);
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
    salesFilter !== "all" ||
    subStatusFilter.length > 0 ||
    followUpFilter !== "all" ||
    ownerFilter.length > 0 ||
    industryFilter.length > 0 ||
    stateFilter.length > 0 ||
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
    primary_contact: (a) =>
      a.primary_contact ? (
        <Link
          to={`/contacts/${a.primary_contact.id}`}
          className="text-primary hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          {formatName(a.primary_contact.first_name, a.primary_contact.last_name)}
        </Link>
      ) : (
        <span className="text-muted-foreground">—</span>
      ),
    phone: (a) => (
      <span className="text-muted-foreground">
        {a.phone
          ? formatPhone(`${a.phone}${a.phone_extension ? ` x${a.phone_extension}` : ""}`)
          : "—"}
      </span>
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
    sales: (a) => (
      <StatusBadge
        value={a.sales_active ? a.sales_status ?? "" : "inactive"}
        variant="salesStatus"
        label={
          a.sales_active
            ? a.sales_status
              ? salesStatusLabel(a.sales_status)
              : "Active"
            : "Inactive"
        }
      />
    ),
    next_follow_up: (a) => {
      if (!a.next_follow_up_date) return <span className="text-muted-foreground">—</span>;
      const overdue = (daysUntil(a.next_follow_up_date) ?? 0) < 0;
      return (
        <span className={overdue ? "text-red-600 dark:text-red-400 font-medium" : "text-muted-foreground"}>
          {formatDate(a.next_follow_up_date)}
        </span>
      );
    },
    owner: (a) => (
      <span className="text-muted-foreground">{a.owner?.full_name ?? "Unassigned"}</span>
    ),
    state: (a) => (
      <span className="text-muted-foreground">
        {a.billing_state ? stateLabel(a.billing_state) : "—"}
      </span>
    ),
    industry: (a) => (
      <span className="text-muted-foreground">{a.industry ?? "—"}</span>
    ),
    last_touch: (a) => (
      <span className="text-muted-foreground">
        {a.last_activity_at ? formatRelativeDate(a.last_activity_at) : "—"}
      </span>
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
          placeholder="Account Status"
          triggerClassName="w-44"
          options={[
            { value: "client", label: "Customer" },
            { value: "prospect", label: "Prospect" },
            { value: "former_client", label: "Former Customer" },
          ]}
        />

        <Select
          value={salesFilter}
          onValueChange={(v) => {
            setSalesFilter(v);
            setPage(0);
          }}
        >
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Sales Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Sales</SelectItem>
            <SelectItem value="active">Sales Active</SelectItem>
            <SelectItem value="inactive">Sales Inactive</SelectItem>
          </SelectContent>
        </Select>

        <MultiSelect
          value={subStatusFilter}
          onChange={(v) => {
            setSubStatusFilter(v);
            setPage(0);
          }}
          placeholder="Sub-Status"
          triggerClassName="w-44"
          options={[
            { value: "prospecting", label: salesStatusLabel("prospecting") },
            { value: "identified_outreach", label: salesStatusLabel("identified_outreach") },
            { value: "engaged", label: salesStatusLabel("engaged") },
            { value: "nurture", label: salesStatusLabel("nurture") },
          ]}
        />

        <Select
          value={followUpFilter}
          onValueChange={(v) => {
            setFollowUpFilter(v);
            setPage(0);
          }}
        >
          <SelectTrigger className="w-44">
            <SelectValue placeholder="Follow Up" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Follow Ups</SelectItem>
            <SelectItem value="due">Due (next 7 days)</SelectItem>
            <SelectItem value="overdue">Overdue</SelectItem>
          </SelectContent>
        </Select>

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

        <MultiSelect
          value={stateFilter}
          onChange={handleStateChange}
          placeholder="All States"
          triggerClassName="w-40"
          options={stateOptions}
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
