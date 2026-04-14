import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useUrlState, useUrlNumberState } from "@/hooks/useUrlState";
import { Building2, Plus, Search } from "lucide-react";
import { useAccounts, useArchiveAccount, useBulkUpdateOwner, useUsers } from "./api";
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
import { statusLabel, formatDate } from "@/lib/formatters";

const PAGE_SIZE = 25;

export function AccountsList() {
  const navigate = useNavigate();
  const [search, setSearch] = useUrlState("q", "");
  const [statusFilter, setStatusFilter] = useUrlState("status", "all");
  const [page, setPage] = useUrlNumberState("page", 0);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const { data: result, isLoading } = useAccounts({
    search: search || undefined,
    status: statusFilter !== "all" ? statusFilter : undefined,
    page,
    pageSize: PAGE_SIZE,
  });
  const { data: users } = useUsers();
  const archiveMutation = useArchiveAccount();
  const bulkOwnerMutation = useBulkUpdateOwner();

  const accounts = result?.data;
  const totalCount = result?.count ?? 0;

  const handleSearchChange = (value: string) => {
    setSearch(value);
    setPage(0);
  };
  const handleStatusChange = (value: string) => {
    setStatusFilter(value);
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
    await Promise.all(ids.map((id) => archiveMutation.mutateAsync({ id })));
    setSelectedIds(new Set());
  };

  const handleBulkAssignOwner = async (userId: string) => {
    await bulkOwnerMutation.mutateAsync({ ids: Array.from(selectedIds), owner_user_id: userId });
    setSelectedIds(new Set());
  };

  const allChecked =
    !!accounts?.length && accounts.every((a) => selectedIds.has(a.id));

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

      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search accounts..."
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
            <SelectItem value="discovery">Discovery</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
            <SelectItem value="churned">Churned</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : !accounts?.length ? (
        <EmptyState
          icon={Building2}
          title="No accounts found"
          description={search || statusFilter !== "all"
            ? "Try adjusting your search or filter"
            : "Create your first account to get started"}
          action={!search && statusFilter === "all" ? {
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
                  <TableHead className="w-10">
                    <Checkbox
                      checked={allChecked}
                      onCheckedChange={toggleAll}
                      aria-label="Select all"
                    />
                  </TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Owner</TableHead>
                  <TableHead>Industry</TableHead>
                  <TableHead>Contract End</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {accounts.map((account) => (
                  <TableRow key={account.id} className="cursor-pointer" onClick={() => navigate(`/accounts/${account.id}`)}>
                    <TableCell onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={selectedIds.has(account.id)}
                        onCheckedChange={() => toggleSelect(account.id)}
                        aria-label={`Select ${account.name}`}
                      />
                    </TableCell>
                    <TableCell>
                      <Link
                        to={`/accounts/${account.id}`}
                        className="font-medium text-primary hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {account.name}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <StatusBadge
                        value={account.status}
                        variant="status"
                        label={statusLabel(account.status)}
                      />
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {account.owner?.full_name ?? "Unassigned"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {account.industry ?? "\u2014"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(account.current_contract_end_date)}
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
        onArchive={handleBulkArchive}
        onAssignOwner={handleBulkAssignOwner}
        users={users}
      />
    </div>
  );
}
