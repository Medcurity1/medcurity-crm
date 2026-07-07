import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Handshake, Search, AlertTriangle } from "lucide-react";
import { usePartners } from "./api";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { StatusBadge } from "@/components/StatusBadge";
import { Pagination } from "@/components/Pagination";
import { SortableHeader, type SortState } from "@/components/SortableHeader";
import { MultiSelect } from "@/components/MultiSelect";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { usePicklistOptionsFor } from "@/features/picklists/api";
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
import { statusLabel, leadSourceLabel, formatDate } from "@/lib/formatters";
import type { LeadSource } from "@/types/crm";

export function PartnersPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string[]>([]);
  const [typeFilter, setTypeFilter] = useState<string[]>([]);
  const [roleFilter, setRoleFilter] = useState<"all" | "umbrella" | "member" | "top_level">("all");
  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [sort, setSort] = useState<SortState>({ column: "name", direction: "asc" });

  // Partner Type filter options come from the admin-managed picklist, plus a
  // "No type set" bucket so the untyped partners are findable for cleanup.
  const { options: typeOptions } = usePicklistOptionsFor("accounts.partner_type");

  const { data: result, isLoading, isError, refetch, isFetching } = usePartners({
    search: search || undefined,
    status: statusFilter.length ? statusFilter : undefined,
    partnerType: typeFilter.length ? typeFilter : undefined,
    partnerRole: roleFilter,
    page,
    pageSize,
    sortColumn: sort.column,
    sortDirection: sort.direction,
  });

  const partners = result?.data;
  const totalCount = result?.count ?? 0;
  const lastContact = result?.lastContact;

  const handleSearchChange = (value: string) => {
    setSearch(value);
    setPage(0);
  };
  const handleStatusChange = (value: string[]) => {
    setStatusFilter(value);
    setPage(0);
  };
  function handleSort(next: SortState) {
    setSort(next);
    setPage(0);
  }

  return (
    <div>
      <PageHeader
        title="Partners"
        description="Accounts with partner relationships"
      />

      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search partners..."
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
            { value: "discovery", label: "Discovery" },
            { value: "pending", label: "Pending" },
            { value: "active", label: "Active" },
            { value: "inactive", label: "Inactive" },
            { value: "churned", label: "Churned" },
          ]}
        />
        <MultiSelect
          value={typeFilter}
          onChange={(v) => {
            setTypeFilter(v);
            setPage(0);
          }}
          placeholder="All Types"
          triggerClassName="w-40"
          options={[
            ...typeOptions.map((o) => ({ value: o.value, label: o.label })),
            { value: "__none__", label: "No type set" },
          ]}
        />
        {/* Role filter — single-select; the buckets are mutually exclusive */}
        <Select
          value={roleFilter}
          onValueChange={(v) => {
            setRoleFilter(v as typeof roleFilter);
            setPage(0);
          }}
        >
          <SelectTrigger className="w-56">
            <SelectValue placeholder="All partner roles" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Partners</SelectItem>
            <SelectItem value="umbrella">Umbrella (has members)</SelectItem>
            <SelectItem value="top_level">Top-level only (no parent)</SelectItem>
            <SelectItem value="member">Members (under a partner)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : isError ? (
        <EmptyState
          icon={AlertTriangle}
          title="Couldn't load partners"
          description="Something went wrong loading the partner list. This is usually a momentary hiccup — try again."
        >
          <Button onClick={() => refetch()} disabled={isFetching}>
            {isFetching ? "Retrying…" : "Try again"}
          </Button>
        </EmptyState>
      ) : !partners?.length ? (
        <EmptyState
          icon={Handshake}
          title="No partners found"
          description={
            search || statusFilter.length > 0 || typeFilter.length > 0 || roleFilter !== "all"
              ? "Try adjusting your search or filter"
              : "No partner accounts exist yet"
          }
        />
      ) : (
        <>
          <div className="border rounded-lg overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <SortableHeader column="name" sort={sort} onSort={handleSort}>Name</SortableHeader>
                  <SortableHeader column="partner_type" sort={sort} onSort={handleSort}>Type</SortableHeader>
                  <TableHead className="text-right w-24">Members</TableHead>
                  <SortableHeader column="status" sort={sort} onSort={handleSort}>Status</SortableHeader>
                  <SortableHeader column="lead_source" sort={sort} onSort={handleSort}>Lead Source</SortableHeader>
                  <SortableHeader column="active_since" sort={sort} onSort={handleSort}>Active Since</SortableHeader>
                  <TableHead>Last Contact</TableHead>
                  <TableHead>Account Owner</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {partners.map((account) => (
                  <TableRow
                    key={account.id}
                    className="cursor-pointer"
                    onClick={() => navigate(`/accounts/${account.id}`)}
                  >
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
                      {account.partner_type ? (
                        <Badge variant="secondary">{account.partner_type}</Badge>
                      ) : (
                        <span className="text-muted-foreground text-xs">No type</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {account.member_count > 0 ? (
                        <span className="font-medium">{account.member_count}</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <StatusBadge
                        value={account.status}
                        variant="status"
                        label={statusLabel(account.status)}
                      />
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {account.lead_source
                        ? leadSourceLabel(account.lead_source as LeadSource) ?? account.lead_source
                        : "\u2014"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(account.active_since)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {lastContact?.get(account.id)
                        ? formatDate(lastContact.get(account.id)!)
                        : "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {account.owner_full_name ?? "Unassigned"}
                    </TableCell>
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
    </div>
  );
}
