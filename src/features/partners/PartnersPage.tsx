import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Handshake, Search } from "lucide-react";
import { usePartners } from "./api";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { StatusBadge } from "@/components/StatusBadge";
import { Pagination } from "@/components/Pagination";
import { Input } from "@/components/ui/input";
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

export function PartnersPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [page, setPage] = useState(0);

  const { data: result, isLoading } = usePartners({
    search: search || undefined,
    status: statusFilter !== "all" ? statusFilter : undefined,
    page,
    pageSize: PAGE_SIZE,
  });

  const partners = result?.data;
  const totalCount = result?.count ?? 0;

  const handleSearchChange = (value: string) => {
    setSearch(value);
    setPage(0);
  };
  const handleStatusChange = (value: string) => {
    setStatusFilter(value);
    setPage(0);
  };

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
      ) : !partners?.length ? (
        <EmptyState
          icon={Handshake}
          title="No partners found"
          description={
            search || statusFilter !== "all"
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
                  <TableHead>Name</TableHead>
                  <TableHead>Partner Account</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Lead Source</TableHead>
                  <TableHead>Active Since</TableHead>
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
                    <TableCell className="text-muted-foreground">
                      {account.partner_account ?? "\u2014"}
                    </TableCell>
                    <TableCell>
                      <StatusBadge
                        value={account.status}
                        variant="status"
                        label={statusLabel(account.status)}
                      />
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {account.lead_source ?? "\u2014"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(account.active_since)}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {account.owner?.full_name ?? "Unassigned"}
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
    </div>
  );
}
