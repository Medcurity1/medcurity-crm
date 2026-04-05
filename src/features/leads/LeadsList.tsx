import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { UserPlus, Plus, Search } from "lucide-react";
import { useLeads, useArchiveLead, useBulkUpdateOwner } from "./api";
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
import { leadStatusLabel, leadSourceLabel, qualificationLabel } from "@/lib/formatters";
import type { LeadSource } from "@/types/crm";

const PAGE_SIZE = 25;

export function LeadsList() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [qualificationFilter, setQualificationFilter] = useState<string>("all");
  const [page, setPage] = useState(0);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const { data: result, isLoading } = useLeads({
    search: search || undefined,
    status: statusFilter !== "all" ? statusFilter : undefined,
    source: sourceFilter !== "all" ? sourceFilter : undefined,
    qualification: qualificationFilter !== "all" ? qualificationFilter : undefined,
    page,
    pageSize: PAGE_SIZE,
  });
  const { data: users } = useUsers();
  const archiveMutation = useArchiveLead();
  const bulkOwnerMutation = useBulkUpdateOwner();

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

      <div className="flex items-center gap-3 mb-4">
        <div className="relative flex-1 max-w-sm">
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
            <SelectItem value="website">Website</SelectItem>
            <SelectItem value="referral">Referral</SelectItem>
            <SelectItem value="cold_call">Cold Call</SelectItem>
            <SelectItem value="trade_show">Trade Show</SelectItem>
            <SelectItem value="partner">Partner</SelectItem>
            <SelectItem value="social_media">Social Media</SelectItem>
            <SelectItem value="email_campaign">Email Campaign</SelectItem>
            <SelectItem value="other">Other</SelectItem>
          </SelectContent>
        </Select>
        <Select value={qualificationFilter} onValueChange={handleQualificationChange}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="All qualifications" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Qualifications</SelectItem>
            <SelectItem value="unqualified">Unqualified</SelectItem>
            <SelectItem value="mql">MQL</SelectItem>
            <SelectItem value="sql">SQL</SelectItem>
            <SelectItem value="sal">SAL</SelectItem>
          </SelectContent>
        </Select>
      </div>

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
                  <TableHead>Name</TableHead>
                  <TableHead>Company</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Qualification</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Phone</TableHead>
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
                    <TableCell>
                      <Link
                        to={`/leads/${lead.id}`}
                        className="font-medium text-primary hover:underline"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {lead.first_name} {lead.last_name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {lead.company ?? "\u2014"}
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
                    <TableCell className="text-muted-foreground">
                      {lead.email ?? "\u2014"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {lead.phone ?? "\u2014"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {lead.owner?.full_name ?? "Unassigned"}
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
