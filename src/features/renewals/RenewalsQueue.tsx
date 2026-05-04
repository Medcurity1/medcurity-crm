import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Check, ChevronsUpDown, Download, RefreshCw, X } from "lucide-react";
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
import { Input } from "@/components/ui/input";
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
 * - Upcoming: closed-won deals whose contract_end_date is in the
 *   selected date window. This is where renewal-prep work happens.
 * - Closed-Won Renewals: renewal-kind opps that have already been won
 *   in the selected date window (filtered by close_date).
 *
 * All filters (date window, owner, account-name exclusion) apply to
 * both tabs. Owner filter is persisted to URL (?owners=…) AND to
 * localStorage so the rep's last filter survives reloads. URL wins on
 * first paint when both are present.
 */

const OWNER_LS_KEY = "renewals_owner_filter_v1";
const EXCLUDE_LS_KEY = "renewals_exclude_account_v1";
const RANGE_LS_KEY = "renewals_date_range_v1";

type RenewalRow = {
  id: string;
  account_id: string;
  account_name: string;
  owner_user_id: string | null;
  owner_name: string | null;
  contract_end_date: string | null;
  close_date: string;
  expected_close_date: string | null;
  amount: number;
  stage: string;
  kind: string;
  name: string;
  next_step: string | null;
  lead_source: string | null;
  description: string | null;
};

function useUpcomingRenewals() {
  return useQuery({
    queryKey: ["renewal_queue", "upcoming"],
    queryFn: async () => {
      // Pull a generous 18-month forward window. The UI then narrows
      // by the date-filter chip — this lets "All time" still feel
      // bounded while supporting custom ranges out into the future.
      const today = new Date();
      const todayIso = today.toISOString().slice(0, 10);
      const cap = new Date(today);
      cap.setMonth(cap.getMonth() + 18);
      const capIso = cap.toISOString().slice(0, 10);

      const { data, error } = await supabase
        .from("opportunities")
        .select(
          "id, account_id, owner_user_id, contract_end_date, close_date, expected_close_date, amount, stage, kind, name, next_step, lead_source, description, account:accounts!inner(id, name, archived_at), owner:user_profiles!owner_user_id(id, full_name)",
        )
        .is("archived_at", null)
        .eq("stage", "closed_won")
        .not("contract_end_date", "is", null)
        .gte("contract_end_date", todayIso)
        .lte("contract_end_date", capIso)
        .order("contract_end_date", { ascending: true });
      if (error) throw error;

      return (data ?? [])
        .filter((o: any) => o.account && o.account.archived_at === null)
        .map(
          (o: any): RenewalRow => ({
            id: o.id,
            account_id: o.account_id,
            account_name: o.account?.name ?? "—",
            owner_user_id: o.owner_user_id,
            owner_name: o.owner?.full_name ?? null,
            contract_end_date: o.contract_end_date,
            close_date: o.close_date,
            expected_close_date: o.expected_close_date,
            amount: Number(o.amount) || 0,
            stage: o.stage,
            kind: o.kind,
            name: o.name,
            next_step: o.next_step,
            lead_source: o.lead_source,
            description: o.description,
          }),
        );
    },
  });
}

function useClosedWonRenewals() {
  return useQuery({
    queryKey: ["renewal_queue", "closed_won"],
    queryFn: async () => {
      // Last 24 months by default; UI filter narrows further. Pulling
      // wider gives custom-range users runway to look back.
      const since = new Date();
      since.setMonth(since.getMonth() - 24);
      const sinceIso = since.toISOString().slice(0, 10);

      const { data, error } = await supabase
        .from("opportunities")
        .select(
          "id, account_id, owner_user_id, contract_end_date, close_date, expected_close_date, amount, stage, kind, name, next_step, lead_source, description, account:accounts!inner(id, name, archived_at), owner:user_profiles!owner_user_id(id, full_name)",
        )
        .is("archived_at", null)
        .eq("stage", "closed_won")
        .eq("kind", "renewal")
        .gte("close_date", sinceIso)
        .order("close_date", { ascending: false });
      if (error) throw error;

      return (data ?? [])
        .filter((o: any) => o.account && o.account.archived_at === null)
        .map(
          (o: any): RenewalRow => ({
            id: o.id,
            account_id: o.account_id,
            account_name: o.account?.name ?? "—",
            owner_user_id: o.owner_user_id,
            owner_name: o.owner?.full_name ?? null,
            contract_end_date: o.contract_end_date,
            close_date: o.close_date,
            expected_close_date: o.expected_close_date,
            amount: Number(o.amount) || 0,
            stage: o.stage,
            kind: o.kind,
            name: o.name,
            next_step: o.next_step,
            lead_source: o.lead_source,
            description: o.description,
          }),
        );
    },
  });
}

function urgencyClass(days: number | null): string {
  if (days === null) return "bg-muted text-muted-foreground";
  if (days <= 30) return "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300";
  if (days <= 60) return "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300";
  return "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300";
}

function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}
function startOfQuarter(d: Date): Date {
  const q = Math.floor(d.getMonth() / 3);
  return new Date(d.getFullYear(), q * 3, 1);
}
function inDateRange(
  dateStr: string | null,
  start: Date | null,
  end: Date | null,
): boolean {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  if (start && d < start) return false;
  if (end && d > end) return false;
  return true;
}
function daysBetween(today: Date, dateStr: string | null): number | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  return Math.round((d.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}
function quarterLabel(d: Date): string {
  const q = Math.floor(d.getMonth() / 3) + 1;
  return `Q${q} ${d.getFullYear()}`;
}
function monthLabel(d: Date): string {
  return d.toLocaleString("en-US", { month: "short", year: "numeric" });
}
function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Build month buckets covering the filter window. Falls back to the
 * current calendar quarter if no bounds are set. Capped so that very
 * wide ranges don't render dozens of cards. */
function monthsInRange(
  start: Date | null,
  end: Date | null,
  fallbackAround: Date,
  cap = 6,
): { start: Date; end: Date; label: string }[] {
  const s = start ?? startOfQuarter(fallbackAround);
  const e =
    end ??
    new Date(
      startOfQuarter(fallbackAround).getFullYear(),
      startOfQuarter(fallbackAround).getMonth() + 3,
      0,
    );
  const months: { start: Date; end: Date; label: string }[] = [];
  const cursor = new Date(s.getFullYear(), s.getMonth(), 1);
  while (cursor <= e && months.length < cap) {
    const mStart = new Date(cursor);
    const mEnd = endOfMonth(cursor);
    months.push({ start: mStart, end: mEnd, label: monthLabel(mStart) });
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return months;
}

function csvEscape(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function downloadCsv(filename: string, rows: RenewalRow[], tab: "upcoming" | "closed-won") {
  const header = [
    "Owner",
    "Account",
    "Opportunity",
    tab === "upcoming" ? "Contract End" : "Close Date",
    tab === "upcoming" ? "Close Date" : "Contract End",
    "Expected Close",
    "Next Step",
    "Amount",
    "Lead Source",
    "Description",
  ];
  const lines = [header.map(csvEscape).join(",")];
  for (const r of rows) {
    lines.push(
      [
        r.owner_name ?? "",
        r.account_name,
        r.name,
        tab === "upcoming" ? (r.contract_end_date ?? "") : r.close_date,
        tab === "upcoming" ? r.close_date : (r.contract_end_date ?? ""),
        r.expected_close_date ?? "",
        r.next_step ?? "",
        r.amount,
        r.lead_source ?? "",
        r.description ?? "",
      ]
        .map(csvEscape)
        .join(","),
    );
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

type DatePreset = "all" | "30" | "60" | "90" | "120" | "this-quarter" | "this-year" | "custom";

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

/** Compute the [start, end] window for a date preset relative to today. */
function rangeFromPreset(
  preset: DatePreset,
  custom: { start: string; end: string },
  forTab: "upcoming" | "closed-won",
): { start: Date | null; end: Date | null; label: string } {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  switch (preset) {
    case "all":
      // Upcoming has an inherent forward bound (18 months in the data
      // hook); closed-won has an inherent 24-month backward bound.
      // 'all' just means no UI-side narrowing.
      return { start: null, end: null, label: "All dates" };
    case "30":
    case "60":
    case "90":
    case "120": {
      const cap = new Date(today);
      const days = Number(preset);
      if (forTab === "upcoming") {
        cap.setDate(cap.getDate() + days);
        return { start: today, end: cap, label: `Next ${days} days` };
      }
      // For closed-won, "Next 30" makes no sense — interpret as "last 30"
      cap.setDate(cap.getDate() - days);
      return { start: cap, end: today, label: `Last ${days} days` };
    }
    case "this-quarter": {
      const start = startOfQuarter(today);
      const end = new Date(start.getFullYear(), start.getMonth() + 3, 0);
      return { start, end, label: `This quarter (${quarterLabel(today)})` };
    }
    case "this-year": {
      return {
        start: new Date(today.getFullYear(), 0, 1),
        end: new Date(today.getFullYear(), 11, 31),
        label: `This year (${today.getFullYear()})`,
      };
    }
    case "custom": {
      const s = custom.start ? new Date(custom.start) : null;
      const e = custom.end ? new Date(custom.end) : null;
      if (e) e.setHours(23, 59, 59, 999);
      const label =
        s && e
          ? `${formatDate(custom.start)} – ${formatDate(custom.end)}`
          : "Custom range";
      return { start: s, end: e, label };
    }
  }
}

export function RenewalsQueue() {
  const [searchParams, setSearchParams] = useSearchParams();

  const tab =
    searchParams.get("tab") === "closed-won" ? "closed-won" : "upcoming";

  // Date preset: default to a 120-day forward window so the page
  // matches what /renewals always showed for upcoming renewals.
  const preset = (searchParams.get("preset") as DatePreset | null) ?? "120";

  // Owner filter: URL wins on first paint, falls back to localStorage.
  const [owners, setOwnersState] = useState<string[]>(() => {
    const fromUrl = searchParams.get("owners");
    if (fromUrl !== null) return fromUrl.split(",").filter(Boolean);
    if (typeof window !== "undefined") {
      try {
        const raw = window.localStorage.getItem(OWNER_LS_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed))
            return parsed.filter((x) => typeof x === "string");
        }
      } catch {
        /* ignore */
      }
    }
    return [];
  });

  // Account-name exclusion: same hydration pattern. Default Test Account
  // is what SF reports usually carry, so save the rep a click on first
  // visit by initialising it empty and letting them type once.
  const [excludeAccount, setExcludeAccount] = useState<string>(() => {
    const fromUrl = searchParams.get("exclude");
    if (fromUrl !== null) return fromUrl;
    if (typeof window !== "undefined") {
      try {
        const raw = window.localStorage.getItem(EXCLUDE_LS_KEY);
        if (raw !== null) return raw;
      } catch {
        /* ignore */
      }
    }
    return "";
  });

  // Custom-range start/end. Persisted so a custom range survives reloads.
  const [customRange, setCustomRange] = useState<{ start: string; end: string }>(
    () => {
      const fromUrl = {
        start: searchParams.get("from") ?? "",
        end: searchParams.get("to") ?? "",
      };
      if (fromUrl.start || fromUrl.end) return fromUrl;
      if (typeof window !== "undefined") {
        try {
          const raw = window.localStorage.getItem(RANGE_LS_KEY);
          if (raw) {
            const parsed = JSON.parse(raw);
            if (parsed && typeof parsed === "object") {
              return {
                start: typeof parsed.start === "string" ? parsed.start : "",
                end: typeof parsed.end === "string" ? parsed.end : "",
              };
            }
          }
        } catch {
          /* ignore */
        }
      }
      return { start: "", end: "" };
    },
  );

  // Persist filters back to URL + localStorage on every change.
  useEffect(() => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (owners.length === 0) next.delete("owners");
        else next.set("owners", owners.join(","));
        if (!excludeAccount) next.delete("exclude");
        else next.set("exclude", excludeAccount);
        if (preset === "custom" && customRange.start) next.set("from", customRange.start);
        else next.delete("from");
        if (preset === "custom" && customRange.end) next.set("to", customRange.end);
        else next.delete("to");
        return next;
      },
      { replace: true },
    );
    try {
      if (typeof window !== "undefined") {
        window.localStorage.setItem(OWNER_LS_KEY, JSON.stringify(owners));
        window.localStorage.setItem(EXCLUDE_LS_KEY, excludeAccount);
        window.localStorage.setItem(RANGE_LS_KEY, JSON.stringify(customRange));
      }
    } catch {
      /* localStorage may be disabled */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [owners.join(","), excludeAccount, customRange.start, customRange.end, preset]);

  const { data: upcoming, isLoading: upcomingLoading } = useUpcomingRenewals();
  const { data: closedWon, isLoading: closedLoading } = useClosedWonRenewals();

  function setPreset(v: DatePreset) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      next.set("preset", v);
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

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const upcomingRange = rangeFromPreset(preset, customRange, "upcoming");
  const closedRange = rangeFromPreset(preset, customRange, "closed-won");

  // Common filter helper applied to both lists.
  function applyCommonFilters(rows: RenewalRow[], dateField: "contract_end_date" | "close_date", range: { start: Date | null; end: Date | null }) {
    const exclude = excludeAccount.trim().toLowerCase();
    return rows.filter((r) => {
      if (owners.length > 0 && (!r.owner_user_id || !owners.includes(r.owner_user_id))) {
        return false;
      }
      if (exclude && r.account_name.toLowerCase().includes(exclude)) {
        return false;
      }
      if (range.start || range.end) {
        const dateStr =
          dateField === "contract_end_date" ? r.contract_end_date : r.close_date;
        if (!inDateRange(dateStr, range.start, range.end)) return false;
      }
      return true;
    });
  }

  const upcomingFiltered = useMemo(() => {
    if (!upcoming) return undefined;
    return applyCommonFilters(upcoming, "contract_end_date", upcomingRange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [upcoming, owners.join(","), excludeAccount, preset, customRange.start, customRange.end]);

  const closedWonFiltered = useMemo(() => {
    if (!closedWon) return undefined;
    return applyCommonFilters(closedWon, "close_date", closedRange);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closedWon, owners.join(","), excludeAccount, preset, customRange.start, customRange.end]);

  // Month buckets reflect whatever filter window is active, so reps can
  // see the breakdown change as they switch between "Next 30 days",
  // "This quarter", a custom range, etc.
  const upcomingMonthBuckets = useMemo(
    () => monthsInRange(upcomingRange.start, upcomingRange.end, today),
    [upcomingRange.start, upcomingRange.end, today.getMonth(), today.getFullYear()],
  );
  const closedMonthBuckets = useMemo(
    () => monthsInRange(closedRange.start, closedRange.end, today),
    [closedRange.start, closedRange.end, today.getMonth(), today.getFullYear()],
  );

  const upcomingTotals = useMemo(() => {
    const list = upcomingFiltered ?? [];
    const total = list.reduce((s, r) => s + r.amount, 0);
    const monthly = upcomingMonthBuckets.map(({ start, end, label }) => {
      const inWindow = list.filter((r) =>
        inDateRange(r.contract_end_date, start, end),
      );
      return {
        label,
        count: inWindow.length,
        total: inWindow.reduce((s, r) => s + r.amount, 0),
      };
    });
    return { count: list.length, total, monthly };
  }, [upcomingFiltered, upcomingMonthBuckets]);

  const closedTotals = useMemo(() => {
    const list = closedWonFiltered ?? [];
    const monthly = closedMonthBuckets.map(({ start, end, label }) => {
      const inWindow = list.filter((r) =>
        inDateRange(r.close_date, start, end),
      );
      return {
        label,
        count: inWindow.length,
        total: inWindow.reduce((s, r) => s + r.amount, 0),
      };
    });
    return {
      count: list.length,
      total: list.reduce((s, r) => s + r.amount, 0),
      monthly,
    };
  }, [closedWonFiltered, closedMonthBuckets]);

  return (
    <div>
      <PageHeader
        title="Renewals"
        description="Contracts coming up for renewal and the renewals you've already won"
      />

      {/* Filter rail — persists across both tabs. */}
      <div className="flex flex-wrap items-end gap-3 mb-4">
        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">
            Date window
          </label>
          <Select value={preset} onValueChange={(v) => setPreset(v as DatePreset)}>
            <SelectTrigger className="w-52">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All time</SelectItem>
              <SelectItem value="30">30 days</SelectItem>
              <SelectItem value="60">60 days</SelectItem>
              <SelectItem value="90">90 days</SelectItem>
              <SelectItem value="120">120 days</SelectItem>
              <SelectItem value="this-quarter">This quarter</SelectItem>
              <SelectItem value="this-year">This year</SelectItem>
              <SelectItem value="custom">Custom range…</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {preset === "custom" && (
          <div className="flex items-end gap-2">
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-muted-foreground">From</label>
              <Input
                type="date"
                className="w-40"
                value={customRange.start}
                onChange={(e) =>
                  setCustomRange((r) => ({ ...r, start: e.target.value }))
                }
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs font-medium text-muted-foreground">To</label>
              <Input
                type="date"
                className="w-40"
                value={customRange.end}
                onChange={(e) =>
                  setCustomRange((r) => ({ ...r, end: e.target.value }))
                }
              />
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="h-9"
              onClick={() => {
                const t = new Date();
                setCustomRange({
                  start: isoDate(startOfQuarter(t)),
                  end: isoDate(new Date(t.getFullYear(), startOfQuarter(t).getMonth() + 3, 0)),
                });
              }}
            >
              This quarter
            </Button>
          </div>
        )}

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">Owner</label>
          <OwnerFilter selected={owners} onChange={setOwnersState} />
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs font-medium text-muted-foreground">
            Hide accounts containing
          </label>
          <div className="flex items-center gap-2">
            <Input
              type="text"
              placeholder="e.g. Test"
              className="w-48"
              value={excludeAccount}
              onChange={(e) => setExcludeAccount(e.target.value)}
            />
            {excludeAccount && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setExcludeAccount("")}
                className="h-9 px-2 text-muted-foreground"
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
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
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs text-muted-foreground">
              {upcomingRange.label} • monthly breakdown follows the filter window
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                downloadCsv(
                  `renewals-upcoming-${isoDate(today)}.csv`,
                  upcomingFiltered ?? [],
                  "upcoming",
                )
              }
              disabled={!upcomingFiltered?.length}
            >
              <Download className="h-4 w-4 mr-1.5" />
              Export CSV
            </Button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs text-muted-foreground font-medium">
                  Renewals in window
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{upcomingTotals.count}</p>
                <p className="text-[10px] text-muted-foreground mt-1">
                  {upcomingRange.label}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs text-muted-foreground font-medium">
                  Total ARR at risk
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold text-primary">
                  {formatCurrency(upcomingTotals.total)}
                </p>
                <p className="text-[10px] text-muted-foreground mt-1">
                  Sum of filtered renewals
                </p>
              </CardContent>
            </Card>
          </div>
          {upcomingTotals.monthly.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
              {upcomingTotals.monthly.map((m) => (
                <Card key={m.label}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-xs text-muted-foreground font-medium">
                      {m.label}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-lg font-semibold">{formatCurrency(m.total)}</p>
                    <p className="text-[10px] text-muted-foreground mt-1">
                      {m.count} renewal{m.count === 1 ? "" : "s"}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

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
              description="No contracts match the current filters."
            />
          ) : (
            <div className="border rounded-lg overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Owner</TableHead>
                    <TableHead>Account</TableHead>
                    <TableHead>Opportunity</TableHead>
                    <TableHead>Contract End</TableHead>
                    <TableHead>Close Date</TableHead>
                    <TableHead>Expected Close</TableHead>
                    <TableHead className="min-w-[12rem]">Next Step</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Lead Source</TableHead>
                    <TableHead className="min-w-[16rem]">Description</TableHead>
                    <TableHead>Days</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {upcomingFiltered.map((r) => {
                    const days = daysBetween(today, r.contract_end_date);
                    const slip =
                      r.expected_close_date && r.close_date
                        ? Math.round(
                            (new Date(r.expected_close_date).getTime() -
                              new Date(r.close_date).getTime()) /
                              (1000 * 60 * 60 * 24),
                          )
                        : null;
                    return (
                      <TableRow key={r.id} className="align-top">
                        <TableCell className="text-muted-foreground whitespace-nowrap">
                          {r.owner_name ?? "—"}
                        </TableCell>
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
                        <TableCell className="text-muted-foreground whitespace-nowrap">
                          {formatDate(r.contract_end_date)}
                        </TableCell>
                        <TableCell className="text-muted-foreground whitespace-nowrap">
                          {formatDate(r.close_date)}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          <div className="text-muted-foreground">
                            {formatDate(r.expected_close_date)}
                          </div>
                          {slip !== null && slip !== 0 && (
                            <div
                              className={cn(
                                "text-[10px] mt-0.5",
                                slip > 0 ? "text-amber-600" : "text-emerald-600",
                              )}
                            >
                              {slip > 0 ? `+${slip}d slip` : `${slip}d early`}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground max-w-[16rem] whitespace-pre-wrap break-words">
                          {r.next_step ?? "—"}
                        </TableCell>
                        <TableCell className="text-right font-medium whitespace-nowrap">
                          {formatCurrency(r.amount)}
                        </TableCell>
                        <TableCell className="text-muted-foreground whitespace-nowrap">
                          {r.lead_source ?? "—"}
                        </TableCell>
                        <TableCell className="text-muted-foreground max-w-[20rem] whitespace-pre-wrap break-words">
                          {r.description ?? "—"}
                        </TableCell>
                        <TableCell>
                          <span
                            className={cn(
                              "inline-flex items-center rounded-md px-2 py-1 text-xs font-medium whitespace-nowrap",
                              urgencyClass(days),
                            )}
                          >
                            {days !== null ? `${days}d` : "—"}
                          </span>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
                <tfoot>
                  <tr className="border-t bg-muted/40">
                    <td className="px-4 py-2 text-sm font-medium" colSpan={7}>
                      Total ({upcomingTotals.count} renewal
                      {upcomingTotals.count === 1 ? "" : "s"})
                    </td>
                    <td className="px-4 py-2 text-right font-semibold">
                      {formatCurrency(upcomingTotals.total)}
                    </td>
                    <td colSpan={3} />
                  </tr>
                </tfoot>
              </Table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="closed-won" className="mt-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs text-muted-foreground">
              {closedRange.label} • monthly breakdown follows the filter window
            </p>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                downloadCsv(
                  `renewals-closed-won-${isoDate(today)}.csv`,
                  closedWonFiltered ?? [],
                  "closed-won",
                )
              }
              disabled={!closedWonFiltered?.length}
            >
              <Download className="h-4 w-4 mr-1.5" />
              Export CSV
            </Button>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs text-muted-foreground font-medium">
                  Closed-Won renewals
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{closedTotals.count}</p>
                <p className="text-[10px] text-muted-foreground mt-1">
                  {closedRange.label}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-xs text-muted-foreground font-medium">
                  Total ARR renewed
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold text-primary">
                  {formatCurrency(closedTotals.total)}
                </p>
                <p className="text-[10px] text-muted-foreground mt-1">
                  Sum of filtered renewals
                </p>
              </CardContent>
            </Card>
          </div>
          {closedTotals.monthly.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
              {closedTotals.monthly.map((m) => (
                <Card key={m.label}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-xs text-muted-foreground font-medium">
                      {m.label}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-lg font-semibold">{formatCurrency(m.total)}</p>
                    <p className="text-[10px] text-muted-foreground mt-1">
                      {m.count} renewal{m.count === 1 ? "" : "s"}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

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
              description="No renewal-kind opportunities match the current filters."
            />
          ) : (
            <div className="border rounded-lg overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Owner</TableHead>
                    <TableHead>Account</TableHead>
                    <TableHead>Opportunity</TableHead>
                    <TableHead>Close Date</TableHead>
                    <TableHead>Expected Close</TableHead>
                    <TableHead>Contract End</TableHead>
                    <TableHead className="min-w-[12rem]">Next Step</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Lead Source</TableHead>
                    <TableHead className="min-w-[16rem]">Description</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {closedWonFiltered.map((r) => {
                    const slip =
                      r.expected_close_date && r.close_date
                        ? Math.round(
                            (new Date(r.close_date).getTime() -
                              new Date(r.expected_close_date).getTime()) /
                              (1000 * 60 * 60 * 24),
                          )
                        : null;
                    return (
                      <TableRow key={r.id} className="align-top">
                        <TableCell className="text-muted-foreground whitespace-nowrap">
                          {r.owner_name ?? "—"}
                        </TableCell>
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
                        <TableCell className="text-muted-foreground whitespace-nowrap">
                          {formatDate(r.close_date)}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          <div className="text-muted-foreground">
                            {formatDate(r.expected_close_date)}
                          </div>
                          {slip !== null && slip !== 0 && (
                            <div
                              className={cn(
                                "text-[10px] mt-0.5",
                                slip > 0 ? "text-amber-600" : "text-emerald-600",
                              )}
                            >
                              {slip > 0
                                ? `closed ${slip}d late`
                                : `closed ${-slip}d early`}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground whitespace-nowrap">
                          {formatDate(r.contract_end_date)}
                        </TableCell>
                        <TableCell className="text-muted-foreground max-w-[16rem] whitespace-pre-wrap break-words">
                          {r.next_step ?? "—"}
                        </TableCell>
                        <TableCell className="text-right font-medium whitespace-nowrap">
                          {formatCurrency(r.amount)}
                        </TableCell>
                        <TableCell className="text-muted-foreground whitespace-nowrap">
                          {r.lead_source ?? "—"}
                        </TableCell>
                        <TableCell className="text-muted-foreground max-w-[20rem] whitespace-pre-wrap break-words">
                          {r.description ?? "—"}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
                <tfoot>
                  <tr className="border-t bg-muted/40">
                    <td className="px-4 py-2 text-sm font-medium" colSpan={7}>
                      Total ({closedTotals.count} renewal
                      {closedTotals.count === 1 ? "" : "s"})
                    </td>
                    <td className="px-4 py-2 text-right font-semibold">
                      {formatCurrency(closedTotals.total)}
                    </td>
                    <td colSpan={2} />
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
