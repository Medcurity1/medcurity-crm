import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useAuth } from "@/features/auth/AuthProvider";
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
  // Embedded names for the "Related" column. Falls back to the
  // generic entity label when the embed isn't loaded (shouldn't
  // happen with the select below, but defensive).
  account: { id: string; name: string } | null;
  contact: { id: string; first_name: string | null; last_name: string | null } | null;
  opportunity: {
    id: string;
    name: string;
    account: { id: string; name: string } | null;
  } | null;
  lead: { id: string; first_name: string | null; last_name: string | null; company: string | null } | null;
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
  scopeLeadId?: string;
}

function useActivitiesList(filters: ListFilters) {
  return useQuery({
    queryKey: ["activities", "list", filters],
    queryFn: async () => {
      let query = supabase
        .from("activities")
        .select(
          // Embed each related record so the Related column can show
          // the actual name (not just the entity type). Opportunities
          // also bring along their account so we can show "Opp · Account"
          // for sales-context tasks.
          "*, " +
            "owner:user_profiles!owner_user_id(id, full_name), " +
            "account:accounts!account_id(id, name), " +
            "contact:contacts!contact_id(id, first_name, last_name), " +
            "opportunity:opportunities!opportunity_id(id, name, account:accounts!account_id(id, name)), " +
            "lead:leads!lead_id(id, first_name, last_name, company)",
          { count: "exact" }
        )
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
      if (filters.scopeLeadId) {
        query = query.eq("lead_id", filters.scopeLeadId);
      }

      const from = filters.page * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;
      query = query.range(from, to);

      const { data, error, count } = await query;
      if (error) throw error;
      return { data: ((data ?? []) as unknown) as ListActivity[], count: count ?? 0 };
    },
  });
}

function getRecordLink(
  a: ListActivity
): { to: string; label: string; sublabel?: string } | null {
  // Order matters: opp is most specific (it carries an account too),
  // then contact, then account, then lead.
  if (a.opportunity_id) {
    const oppName = a.opportunity?.name ?? "Opportunity";
    const acctName = a.opportunity?.account?.name;
    return {
      to: `/opportunities/${a.opportunity_id}`,
      label: oppName,
      sublabel: acctName ? `Account: ${acctName}` : undefined,
    };
  }
  if (a.contact_id) {
    const fn = a.contact?.first_name ?? "";
    const ln = a.contact?.last_name ?? "";
    const name = `${fn} ${ln}`.trim() || "Contact";
    return { to: `/contacts/${a.contact_id}`, label: name };
  }
  if (a.account_id) {
    return {
      to: `/accounts/${a.account_id}`,
      label: a.account?.name ?? "Account",
    };
  }
  if (a.lead_id) {
    const fn = a.lead?.first_name ?? "";
    const ln = a.lead?.last_name ?? "";
    const personName = `${fn} ${ln}`.trim();
    const label = personName || a.lead?.company || "Lead";
    return {
      to: `/leads/${a.lead_id}`,
      label,
      sublabel: personName && a.lead?.company ? a.lead.company : undefined,
    };
  }
  return null;
}

export function ActivitiesListPage() {
  const { user } = useAuth();
  const [urlParams] = useSearchParams();

  // Allow the home "View All Tasks" link (and other deep links) to
  // pre-seed type + owner filters via ?type=task&owner=me.
  const initialType = urlParams.get("type") ?? "all";
  const initialOwnerParam = urlParams.get("owner");
  const initialOwner =
    initialOwnerParam === "me" && user?.id
      ? user.id
      : initialOwnerParam ?? "all";

  const [search, setSearch] = useState("");
  const [type, setType] = useState<string>(initialType);
  const [owner, setOwner] = useState<string>(initialOwner);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [page, setPage] = useState(0);

  const scopeAccountId = urlParams.get("account_id") || undefined;
  const scopeContactId = urlParams.get("contact_id") || undefined;
  const scopeOpportunityId = urlParams.get("opportunity_id") || undefined;
  const scopeLeadId = urlParams.get("lead_id") || undefined;

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
      scopeLeadId,
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
      scopeLeadId,
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
                          <div className="flex flex-col">
                            <Link
                              to={link.to}
                              className="text-primary hover:underline text-sm truncate max-w-xs"
                            >
                              {link.label}
                            </Link>
                            {link.sublabel && (
                              <span className="text-[11px] text-muted-foreground truncate max-w-xs">
                                {link.sublabel}
                              </span>
                            )}
                          </div>
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
