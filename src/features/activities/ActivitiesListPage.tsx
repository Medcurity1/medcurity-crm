import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Clock,
  Phone,
  Mail,
  Users as UsersIcon,
  StickyNote,
  CheckSquare,
  Search,
  Check,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { Activity, ActivityType } from "@/types/crm";
import { useUsers } from "@/features/accounts/api";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
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
import { formatDate, activityLabel } from "@/lib/formatters";

const PAGE_SIZE = 25;

type ListActivity = Activity & {
  owner: { id: string; full_name: string | null } | null;
};

const ACTIVITY_ICONS: Record<ActivityType, typeof Phone> = {
  call: Phone,
  email: Mail,
  meeting: UsersIcon,
  note: StickyNote,
  task: CheckSquare,
};

interface ListFilters {
  search: string;
  type: string;
  owner: string;
  startDate: string;
  endDate: string;
  page: number;
  // Optional record-scope filters from URL params (account_id, contact_id,
  // opportunity_id) so /activities?account_id=X shows only that account.
  scopeAccountId?: string;
  scopeContactId?: string;
  scopeOpportunityId?: string;
}

function useActivitiesList(filters: ListFilters) {
  return useQuery({
    queryKey: ["activities", "list", filters],
    queryFn: async () => {
      let query = supabase
        .from("activities")
        .select("*, owner:user_profiles!owner_user_id(id, full_name)", {
          count: "exact",
        })
        .order("created_at", { ascending: false });

      if (filters.search) {
        query = query.ilike("subject", `%${filters.search}%`);
      }
      if (filters.type !== "all") {
        query = query.eq("activity_type", filters.type);
      }
      if (filters.owner !== "all") {
        query = query.eq("owner_user_id", filters.owner);
      }
      if (filters.startDate) {
        query = query.gte("created_at", filters.startDate);
      }
      if (filters.endDate) {
        // include full end day
        const end = new Date(filters.endDate);
        end.setHours(23, 59, 59, 999);
        query = query.lte("created_at", end.toISOString());
      }
      if (filters.scopeAccountId) {
        query = query.eq("account_id", filters.scopeAccountId);
      }
      if (filters.scopeContactId) {
        query = query.eq("contact_id", filters.scopeContactId);
      }
      if (filters.scopeOpportunityId) {
        query = query.eq("opportunity_id", filters.scopeOpportunityId);
      }

      const from = filters.page * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;
      query = query.range(from, to);

      const { data, error, count } = await query;
      if (error) throw error;
      return { data: (data ?? []) as ListActivity[], count: count ?? 0 };
    },
  });
}

function getRecordLink(
  a: ListActivity
): { to: string; label: string } | null {
  if (a.opportunity_id) {
    return { to: `/opportunities/${a.opportunity_id}`, label: "Opportunity" };
  }
  if (a.contact_id) {
    return { to: `/contacts/${a.contact_id}`, label: "Contact" };
  }
  if (a.account_id) {
    return { to: `/accounts/${a.account_id}`, label: "Account" };
  }
  return null;
}

export function ActivitiesListPage() {
  const [search, setSearch] = useState("");
  const [type, setType] = useState<string>("all");
  const [owner, setOwner] = useState<string>("all");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [page, setPage] = useState(0);

  const [urlParams] = useSearchParams();
  const scopeAccountId = urlParams.get("account_id") || undefined;
  const scopeContactId = urlParams.get("contact_id") || undefined;
  const scopeOpportunityId = urlParams.get("opportunity_id") || undefined;

  const filters = useMemo<ListFilters>(
    () => ({
      search,
      type,
      owner,
      startDate,
      endDate,
      page,
      scopeAccountId,
      scopeContactId,
      scopeOpportunityId,
    }),
    [
      search,
      type,
      owner,
      startDate,
      endDate,
      page,
      scopeAccountId,
      scopeContactId,
      scopeOpportunityId,
    ]
  );

  const { data: result, isLoading } = useActivitiesList(filters);
  const { data: users } = useUsers();

  const activities = result?.data ?? [];
  const totalCount = result?.count ?? 0;

  const resetPage = () => setPage(0);

  return (
    <div>
      <PageHeader
        title="Activities"
        description="All activity across your records"
      />

      <div className="flex items-center gap-3 mb-4 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by subject..."
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              resetPage();
            }}
            className="pl-9"
          />
        </div>
        <Select
          value={type}
          onValueChange={(v) => {
            setType(v);
            resetPage();
          }}
        >
          <SelectTrigger className="w-36">
            <SelectValue placeholder="All types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="call">Call</SelectItem>
            <SelectItem value="email">Email</SelectItem>
            <SelectItem value="meeting">Meeting</SelectItem>
            <SelectItem value="note">Note</SelectItem>
            <SelectItem value="task">Task</SelectItem>
          </SelectContent>
        </Select>
        <Select
          value={owner}
          onValueChange={(v) => {
            setOwner(v);
            resetPage();
          }}
        >
          <SelectTrigger className="w-44">
            <SelectValue placeholder="All owners" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Owners</SelectItem>
            {(users ?? []).map((u) => (
              <SelectItem key={u.id} value={u.id}>
                {u.full_name ?? "Unnamed"}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          type="date"
          value={startDate}
          onChange={(e) => {
            setStartDate(e.target.value);
            resetPage();
          }}
          className="w-40"
          aria-label="Start date"
        />
        <Input
          type="date"
          value={endDate}
          onChange={(e) => {
            setEndDate(e.target.value);
            resetPage();
          }}
          className="w-40"
          aria-label="End date"
        />
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : activities.length === 0 ? (
        <EmptyState
          icon={Clock}
          title="No activities found"
          description={
            search || type !== "all" || owner !== "all" || startDate || endDate
              ? "Try adjusting your filters"
              : "Activities logged on records will show up here"
          }
        />
      ) : (
        <>
          <div className="border rounded-lg overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">Type</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead>Owner</TableHead>
                  <TableHead>Related</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="w-20 text-center">Done</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {activities.map((a) => {
                  const Icon = ACTIVITY_ICONS[a.activity_type] ?? StickyNote;
                  const link = getRecordLink(a);
                  return (
                    <TableRow key={a.id}>
                      <TableCell>
                        <div
                          className="h-7 w-7 rounded-full bg-muted flex items-center justify-center"
                          title={activityLabel(a.activity_type)}
                        >
                          <Icon className="h-3.5 w-3.5" />
                        </div>
                      </TableCell>
                      <TableCell className="font-medium max-w-sm truncate">
                        {a.subject}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {a.owner?.full_name ?? "\u2014"}
                      </TableCell>
                      <TableCell>
                        {link ? (
                          <Link
                            to={link.to}
                            className="text-primary hover:underline text-sm"
                          >
                            {link.label}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">
                            &mdash;
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm">
                        {formatDate(a.created_at)}
                      </TableCell>
                      <TableCell className="text-center">
                        {a.completed_at ? (
                          <Check className="h-4 w-4 text-primary inline" />
                        ) : (
                          <span className="text-muted-foreground">
                            &mdash;
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
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
