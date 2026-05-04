import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronsUpDown, RefreshCw, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useUsers } from "@/features/leads/api";
import { PageHeader } from "@/components/PageHeader";
import { EmptyState } from "@/components/EmptyState";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { cn } from "@/lib/utils";
import { formatCurrency, formatDate } from "@/lib/formatters";

/**
 * Renewals view, Salesforce "Open Renewal Opportunities" report style.
 *
 * Two tabs share the same filter rail:
 * - Upcoming: closed-won deals whose contract_end_date is between today
 *   and today + 120 days. This is where renewal-prep work happens.
 * - Closed-Won Renewals: renewal-kind opps that have already been won.
 *   Useful for retro / "how did we do last quarter" review.
 *
 * Owner filter is persisted both to the URL (?owners=id1,id2) so links
 * can be shared, and to localStorage so the rep's last filter survives
 * navigating away. URL wins on first paint when both are present.
 */

const OWNER_LS_KEY = "renewals_owner_filter_v1";

type RenewalRow = {
  id: string; // opportunity id
  account_id: string;
  account_name: string;
  owner_user_id: string | null;
  owner_name: string | null;
  contract_end_date: string | null;
  close_date: string;
  amount: number;
  stage: string;
  kind: string;
  name: string;
  days_until_renewal: number | null;
};

function useUpcomingRenewals() {
  return useQuery({
    queryKey: ["renewal_queue", "upcoming"],
    queryFn: async () => {
      // Direct join — old code used the renewal_queue view but it didn't
      // include owner names, and the view's 120-day window is already
      // hard-coded so re-implementing here lets us add the owner without
      // a schema migration.
      const today = new Date();
      const todayIso = today.toISOString().slice(0, 10);
      const cap = new Date(today);
      cap.setDate(cap.getDate() + 120);
      const capIso = cap.toISOString().slice(0, 10);

      const { data, error } = await supabase
        .from("opportunities")
        .select(
          "id, account_id, owner_user_id, contract_end_date, close_date, amount, stage, kind, name, account:accounts!inner(id, name, archived_at), owner:user_profiles!owner_user_id(id, full_name)",
        )
        .is("archived_at", null)
        .eq("stage", "closed_won")
        .not("contract_end_date", "is", null)
        .gte("contract_end_date", todayIso)
        .lte("contract_end_date", capIso)
        .order("contract_end_date", { ascending: true });
      if (error) throw error;

      const rows: RenewalRow[] = (data ?? [])
        // The accounts!inner join already filters to non-archived accounts,
        // but keep a defensive client-side check in case the join shape
        // changes. Cheap and prevents tombstoned accounts from appearing.
        .filter((o: any) => o.account && o.account.archived_at === null)
        .map((o: any) => {
          const end = o.contract_end_date
            ? new Date(o.contract_end_date)
            : null;
          const days =
            end !== null
              ? Math.round(
                  (end.getTime() - new Date(todayIso).getTime()) /
                    (1000 * 60 * 60 * 24),
                )
              : null;
          return {
            id: o.id,
            account_id: o.account_id,
            account_name: o.account?.name ?? "—",
            owner_user_id: o.owner_user_id,
            owner_name: o.owner?.full_name ?? null,
            contract_end_date: o.contract_end_date,
            close_date: o.close_date,
            amount: Number(o.amount) || 0,
            stage: o.stage,
            kind: o.kind,
            name: o.name,
            days_until_renewal: days,
          };
        });
      return rows;
    },
  });
}

function useClosedWonRenewals() {
  return useQuery({
    queryKey: ["renewal_queue", "closed_won"],
    queryFn: async () => {
      // Last 18 months of won renewals — far enough back to cover an
      // annual planning cycle without dragging in ancient history.
      const since = new Date();
      since.setMonth(since.getMonth() - 18);
      const sinceIso = since.toISOString().slice(0, 10);

      const { data, error } = await supabase
        .from("opportunities")
        .select(
          "id, account_id, owner_user_id, contract_end_date, close_date, amount, stage, kind, name, account:accounts!inner(id, name, archived_at), owner:user_profiles!owner_user_id(id, full_name)",
        )
        .is("archived_at", null)
        .eq("stage", "closed_won")
        .eq("kind", "renewal")
        .gte("close_date", sinceIso)
        .order("close_date", { ascending: false });
      if (error) throw error;

      const rows: RenewalRow[] = (data ?? [])
        .filter((o: any) => o.account && o.account.archived_at === null)
        .map((o: any) => ({
          id: o.id,
          account_id: o.account_id,
          account_name: o.account?.name ?? "—",
          owner_user_id: o.owner_user_id,
          owner_name: o.owner?.full_name ?? null,
          contract_end_date: o.contract_end_date,
          close_date: o.close_date,
          amount: Number(o.amount) || 0,
          stage: o.stage,
          kind: o.kind,
          name: o.name,
          days_until_renewal: null,
        }));
      return rows;
    },
  });
}

function urgencyClass(days: number | null): string {
  if (days === null) return "bg-muted text-muted-foreground";
  if (days <= 30) return "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300";
  if (days <= 60) return "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300";
  return "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300";
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}
function startOfQuarter(d: Date): Date {
  const q = Math.floor(d.getMonth() / 3);
  return new Date(d.getFullYear(), q * 3, 1);
}
function endOfQuarter(d: Date): Date {
  const q = Math.floor(d.getMonth() / 3);
  return new Date(d.getFullYear(), q * 3 + 3, 0);
}
function inRange(dateStr: string | null, start: Date, end: Date): boolean {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  return d >= start && d <= end;
}
function quarterLabel(d: Date): string {
  const q = Math.floor(d.getMonth() / 3) + 1;
  return `Q${q} ${d.getFullYear()}`;
}
function monthLabel(d: Date): string {
  return d.toLocaleString("en-US", { month: "long", year: "numeric" });
}

function OwnerFilter({
  selected,
  onChange,
}: {
  selected: string[];
  onChange: (next: string[]) => void;
}) {
  const { data: users } = useUsers();
  const [open, setOpen] = useState(false);

  const userOptions = users ?? [];
  const labelText = (() => {
    if (selected.length === 0) return "All owners";
    if (selected.length === 1) {
      const u = userOptions.find((x: any) => x.id === selected[0]);
      return u?.full_name ?? "1 owner";
    }
    return `${selected.length} owners`;
  })();

  function toggle(id: string) {
    onChange(
      selected.includes(id)
        ? selected.filter((x) => x !== id)
        : [...selected, id],
    );
  }

  return (
    <div className="flex items-center gap-2">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="w-56 justify-between"
          >
            <span className="truncate">{labelText}</span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-64 p-0" align="start">
          <Command>
            <CommandInput placeholder="Search owners…" />
            <CommandList>
              <CommandEmpty>No users found.</CommandEmpty>
              <CommandGroup>
                {userOptions.map((u: any) => {
                  const isSelected = selected.includes(u.id);
                  return (
                    <CommandItem
                      key={u.id}
                      value={u.full_name ?? u.id}
                      onSelect={() => toggle(u.id)}
                    >
                      <Check
                        className={cn(
                          "mr-2 h-4 w-4",
                          isSelected ? "opacity-100" : "opacity-0",
                        )}
                      />
                      {u.full_name ?? u.id}
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {selected.length > 0 && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onChange([])}
          className="h-9 px-2 text-muted-foreground"
        >
          <X className="h-4 w-4" />
          <span className="sr-only">Clear owner filter</span>
        </Button>
      )}
    </div>
  );
}

export function RenewalsQueue() {
  const [searchParams, setSearchParams] = useSearchParams();
  const within = searchParams.get("within") ?? "all";
  const tab = searchParams.get("tab") === "closed-won" ? "closed-won" : "upcoming";

  // Hydrate owner filter: URL takes precedence, falls back to
  // localStorage so the rep's last filter sticks across visits.
  const [owners, setOwnersState] = useState<string[]>(() => {
    const fromUrl = searchParams.get("owners");
    if (fromUrl !== null) {
      return fromUrl.split(",").filter(Boolean);
    }
    if (typeof window !== "undefined") {
      try {
        const raw = window.localStorage.getItem(OWNER_LS_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) return parsed.filter((x) => typeof x === "string");
        }
      } catch {
        // ignore corrupt JSON — fall through to default
      }
    }
    return [];
  });

  // Keep URL + localStorage in sync with state.
  useEffect(() => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (owners.length === 0) next.delete("owners");
        else next.set("owners", owners.join(","));
        return next;
      },
      { replace: true },
    );
    try {
      if (typeof window !== "undefined") {
        window.localStorage.setItem(OWNER_LS_KEY, JSON.stringify(owners));
      }
    } catch {
      // localStorage may be disabled (private mode) — non-fatal
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owners.join(",")]);

  const { data: upcoming, isLoading: upcomingLoading } = useUpcomingRenewals();
  const { data: closedWon, isLoading: closedLoading } = useClosedWonRenewals();

  function setWithin(v: string) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (v === "all") next.delete("within");
      else next.set("within", v);
      return next;
    });
  }
  function setTab(v: string) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (v === "upcoming") next.delete("tab");
      else next.set("tab", v);
      return next;
    });
  }

  // Apply owner + window filters to upcoming.
  const upcomingFiltered = useMemo(() => {
    if (!upcoming) return undefined;
    return upcoming.filter((r) => {
      if (owners.length > 0 && (!r.owner_user_id || !owners.includes(r.owner_user_id))) {
        return false;
      }
      if (within !== "all") {
        const cap = Number(within);
        if (
          Number.isFinite(cap) &&
          (r.days_until_renewal === null || r.days_until_renewal > cap)
        ) {
          return false;
        }
      }
      return true;
    });
  }, [upcoming, owners, within]);

  const closedWonFiltered = useMemo(() => {
    if (!closedWon) return undefined;
    return closedWon.filter(
      (r) =>
        owners.length === 0 ||
        (r.owner_user_id && owners.includes(r.owner_user_id)),
    );
  }, [closedWon, owners]);

  const today = new Date();
  const monthStart = startOfMonth(today);
  const monthEnd = endOfMonth(today);
  const quarterStart = startOfQuarter(today);
  const quarterEnd = endOfQuarter(today);

  const totals = useMemo(() => {
    const list = upcomingFiltered ?? [];
    const total = list.reduce((s, r) => s + r.amount, 0);
    const month = list
      .filter((r) => inRange(r.contract_end_date, monthStart, monthEnd))
      .reduce((s, r) => s + r.amount, 0);
    const quarter = list
      .filter((r) => inRange(r.contract_end_date, quarterStart, quarterEnd))
      .reduce((s, r) => s + r.amount, 0);
    return {
      count: list.length,
      total,
      month,
      quarter,
      monthCount: list.filter((r) =>
        inRange(r.contract_end_date, monthStart, monthEnd),
      ).length,
      quarterCount: list.filter((r) =>
        inRange(r.contract_end_date, quarterStart, quarterEnd),
      ).length,
    };
  }, [upcomingFiltered, monthStart, monthEnd, quarterStart, quarterEnd]);

  const closedTotals = useMemo(() => {
    const list = closedWonFiltered ?? [];
    return {
      count: list.length,
      total: list.reduce((s, r) => s + r.amount, 0),
    };
  }, [closedWonFiltered]);

  return (
    <div>
      <PageHeader
        title="Renewals"
        description="Contracts coming up for renewal and the renewals you've already won"
      />

      {/* Filter rail — persists across both tabs */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Window:</span>
          <Select value={within} onValueChange={setWithin}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="30">Next 30 days</SelectItem>
              <SelectItem value="60">Next 60 days</SelectItem>
              <SelectItem value="90">Next 90 days</SelectItem>
              <SelectItem value="all">All (up to 120 days)</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Owner:</span>
          <OwnerFilter selected={owners} onChange={setOwnersState} />
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="upcoming">
            Upcoming Renewals
            {upcomingFiltered ? (
              <Badge variant="secondary" className="ml-2">
                {upcomingFiltered.length}
              </Badge>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="closed-won">
            Closed-Won Renewals
            {closedWonFiltered ? (
              <Badge variant="secondary" className="ml-2">
                {closedWonFiltered.length}
              </Badge>
            ) : null}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="upcoming" className="mt-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground font-medium">
                  Upcoming
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold">{totals.count}</p>
                <p className="text-xs text-muted-foreground mt-1">renewals in window</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground font-medium">
                  Total ARR
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold text-primary">
                  {formatCurrency(totals.total)}
                </p>
                <p className="text-xs text-muted-foreground mt-1">at risk in window</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground font-medium">
                  {monthLabel(today)}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold">{formatCurrency(totals.month)}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {totals.monthCount} renewal{totals.monthCount === 1 ? "" : "s"} this month
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground font-medium">
                  {quarterLabel(today)}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold">{formatCurrency(totals.quarter)}</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {totals.quarterCount} renewal
                  {totals.quarterCount === 1 ? "" : "s"} this quarter
                </p>
              </CardContent>
            </Card>
          </div>

          {upcomingLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : !upcomingFiltered?.length ? (
            <EmptyState
              icon={RefreshCw}
              title="No upcoming renewals"
              description={
                owners.length > 0
                  ? "No renewals match the current owner filter. Try clearing it."
                  : "No contracts are expiring within the next 120 days."
              }
            />
          ) : (
            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Account</TableHead>
                    <TableHead>Opportunity</TableHead>
                    <TableHead>Owner</TableHead>
                    <TableHead>Contract End</TableHead>
                    <TableHead className="text-right">ARR</TableHead>
                    <TableHead>Days</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {upcomingFiltered.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>
                        <Link
                          to={`/accounts/${r.account_id}`}
                          className="font-medium text-primary hover:underline"
                        >
                          {r.account_name}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Link
                          to={`/opportunities/${r.id}`}
                          className="text-sm hover:underline"
                        >
                          {r.name}
                        </Link>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {r.owner_name ?? "—"}
                      </TableCell>
                      <TableCell className="text-muted-foreground whitespace-nowrap">
                        {formatDate(r.contract_end_date)}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {formatCurrency(r.amount)}
                      </TableCell>
                      <TableCell>
                        <span
                          className={cn(
                            "inline-flex items-center rounded-md px-2 py-1 text-xs font-medium",
                            urgencyClass(r.days_until_renewal),
                          )}
                        >
                          {r.days_until_renewal !== null
                            ? `${r.days_until_renewal} days`
                            : "—"}
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <tfoot>
                  <tr className="border-t bg-muted/40">
                    <td className="px-4 py-2 text-sm font-medium" colSpan={4}>
                      Total ({totals.count} renewal{totals.count === 1 ? "" : "s"})
                    </td>
                    <td className="px-4 py-2 text-right font-semibold">
                      {formatCurrency(totals.total)}
                    </td>
                    <td />
                  </tr>
                </tfoot>
              </Table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="closed-won" className="mt-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground font-medium">
                  Closed-Won Renewals (last 18 months)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold">{closedTotals.count}</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm text-muted-foreground font-medium">
                  Total ARR Renewed
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-bold text-primary">
                  {formatCurrency(closedTotals.total)}
                </p>
              </CardContent>
            </Card>
          </div>

          {closedLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : !closedWonFiltered?.length ? (
            <EmptyState
              icon={RefreshCw}
              title="No closed-won renewals"
              description={
                owners.length > 0
                  ? "No closed-won renewals match the current owner filter."
                  : "No renewal-kind opportunities have been won in the last 18 months."
              }
            />
          ) : (
            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Account</TableHead>
                    <TableHead>Opportunity</TableHead>
                    <TableHead>Owner</TableHead>
                    <TableHead>Closed</TableHead>
                    <TableHead>Contract End</TableHead>
                    <TableHead className="text-right">ARR</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {closedWonFiltered.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell>
                        <Link
                          to={`/accounts/${r.account_id}`}
                          className="font-medium text-primary hover:underline"
                        >
                          {r.account_name}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Link
                          to={`/opportunities/${r.id}`}
                          className="text-sm hover:underline"
                        >
                          {r.name}
                        </Link>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {r.owner_name ?? "—"}
                      </TableCell>
                      <TableCell className="text-muted-foreground whitespace-nowrap">
                        {formatDate(r.close_date)}
                      </TableCell>
                      <TableCell className="text-muted-foreground whitespace-nowrap">
                        {formatDate(r.contract_end_date)}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {formatCurrency(r.amount)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <tfoot>
                  <tr className="border-t bg-muted/40">
                    <td className="px-4 py-2 text-sm font-medium" colSpan={5}>
                      Total ({closedTotals.count} renewal
                      {closedTotals.count === 1 ? "" : "s"})
                    </td>
                    <td className="px-4 py-2 text-right font-semibold">
                      {formatCurrency(closedTotals.total)}
                    </td>
                  </tr>
                </tfoot>
              </Table>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
