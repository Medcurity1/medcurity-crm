import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Download, ChevronDown, ChevronRight } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
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
import { formatDate, leadSourceLabel } from "@/lib/formatters";
import {
  downloadCsv,
  todayStamp,
  DATE_RANGE_OPTIONS,
  resolveRange,
  type DateRangeKey,
} from "./report-helpers";
import { fetchUsersById, fetchAllRows } from "./report-fetchers";
import { PreviewNote, PREVIEW_LIMIT } from "./PreviewNote";

interface MqlLeadRow {
  lead_id: string;
  lead_source: string;
  first_name: string;
  last_name: string;
  title: string;
  email: string;
  phone: string;
  mobile: string;
  lead_owner: string;
  mql_date: string | null;
}

export function MqlLeads() {
  const [range, setRange] = useState<DateRangeKey>("current_quarter");
  const { start, end } = resolveRange(range);

  const { data: rows, isLoading, error } = useQuery({
    queryKey: ["report", "mql-leads-v2", start, end],
    queryFn: async (): Promise<MqlLeadRow[]> => {
      type LeadRaw = {
        id: string;
        first_name: string | null;
        last_name: string | null;
        title: string | null;
        email: string | null;
        phone: string | null;
        mobile_phone: string | null;
        lead_source: string | null;
        mql_date: string | null;
        status: string | null;
        owner_user_id: string | null;
      };
      const leads = await fetchAllRows<LeadRaw>(() => {
        let q = supabase
          .from("leads")
          .select(
            "id, first_name, last_name, title, email, phone, mobile_phone, lead_source, mql_date, status, owner_user_id",
          )
          .not("mql_date", "is", null)
          .neq("status", "converted")
          .is("archived_at", null);
        if (start) q = q.gte("mql_date", start);
        if (end) q = q.lte("mql_date", end);
        return q.order("mql_date", { ascending: false });
      });
      const ownerIds = new Set<string>(
        leads.map((l) => l.owner_user_id as string).filter(Boolean),
      );
      const users = await fetchUsersById(ownerIds);

      return leads.map((l) => ({
        lead_id: l.id as string,
        lead_source: (l.lead_source as string) ?? "unknown",
        first_name: (l.first_name as string) ?? "",
        last_name: (l.last_name as string) ?? "",
        title: (l.title as string) ?? "",
        email: (l.email as string) ?? "",
        phone: (l.phone as string) ?? "",
        mobile: (l.mobile_phone as string) ?? "",
        lead_owner: users.get(l.owner_user_id as string)?.full_name ?? "Unassigned",
        mql_date: l.mql_date as string | null,
      }));
    },
  });

  const grouped = useMemo(() => {
    // Group ALL rows so "Sources" KPI reflects reality.
    const m = new Map<string, MqlLeadRow[]>();
    for (const r of rows ?? []) {
      const key = r.lead_source || "unknown";
      const list = m.get(key) ?? [];
      list.push(r);
      m.set(key, list);
    }
    return m;
  }, [rows]);

  /** Grouped, but each group truncated to PREVIEW_LIMIT for render. */
  const groupedPreview = useMemo(() => {
    const m = new Map<string, MqlLeadRow[]>();
    let remaining = PREVIEW_LIMIT;
    for (const [key, list] of grouped) {
      if (remaining <= 0) break;
      const take = list.slice(0, remaining);
      m.set(key, take);
      remaining -= take.length;
    }
    return m;
  }, [grouped]);

  function exportCsv() {
    const header = [
      "Lead Source",
      "First Name",
      "Last Name",
      "Title",
      "Email",
      "Phone",
      "Mobile",
      "Lead Owner",
      "MQL",
    ];
    const data = (rows ?? []).map((r) => [
      r.lead_source,
      r.first_name,
      r.last_name,
      r.title,
      r.email,
      r.phone,
      r.mobile,
      r.lead_owner,
      r.mql_date ?? "",
    ]);
    downloadCsv(`mql-leads-${todayStamp()}.csv`, [header, ...data]);
  }

  return (
    <div className="space-y-4">
      <div>
        <Button variant="ghost" size="sm" asChild>
          <Link to="/reports?tab=standard">
            <ArrowLeft className="h-4 w-4 mr-1" />
            Back to Standard Reports
          </Link>
        </Button>
      </div>

      <PageHeader
        title="MQL (Leads)"
        description="Leads with MQL date, not yet converted. Grouped by Lead Source."
        actions={
          <div className="flex items-center gap-2">
            <Select value={range} onValueChange={(v) => setRange(v as DateRangeKey)}>
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DATE_RANGE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={exportCsv} disabled={isLoading}>
              <Download className="h-4 w-4 mr-1" />
              Export CSV
            </Button>
          </div>
        }
      />

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          Error: {(error as Error).message}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Kpi label="MQL Leads" value={(rows?.length ?? 0).toLocaleString()} />
        <Kpi label="Sources" value={grouped.size.toLocaleString()} />
        <Kpi label="Range" value={DATE_RANGE_OPTIONS.find((o) => o.value === range)?.label ?? ""} />
      </div>

      <PreviewNote total={rows?.length ?? 0} shown={PREVIEW_LIMIT} />

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4">
              <Skeleton className="h-48 w-full" />
            </div>
          ) : !rows?.length ? (
            <div className="overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Lead Source</TableHead>
                    <TableHead>First Name</TableHead>
                    <TableHead>Last Name</TableHead>
                    <TableHead>Title</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead>Mobile</TableHead>
                    <TableHead>Lead Owner</TableHead>
                    <TableHead>MQL</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell colSpan={9} className="p-6 text-sm text-muted-foreground text-center">
                      No MQL leads in the selected range.
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="divide-y">
              {Array.from(groupedPreview.entries()).map(([source, list]) => (
                <SourceGroup key={source} source={source} list={list} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function SourceGroup({ source, list }: { source: string; list: MqlLeadRow[] }) {
  const [open, setOpen] = useState(true);
  return (
    <div>
      <button
        type="button"
        className="w-full flex items-center gap-2 px-4 py-3 bg-muted/50 hover:bg-muted text-left"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        <span className="font-semibold capitalize">
          {leadSourceLabel(source as never) ?? source}
        </span>
        <span className="text-sm text-muted-foreground ml-2">
          {list.length} lead{list.length === 1 ? "" : "s"}
        </span>
      </button>
      {open && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-8">First Name</TableHead>
              <TableHead>Last Name</TableHead>
              <TableHead>Title</TableHead>
              <TableHead>Email</TableHead>
              <TableHead>Phone</TableHead>
              <TableHead>Mobile</TableHead>
              <TableHead>Lead Owner</TableHead>
              <TableHead>MQL</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {list.map((r) => (
              <TableRow key={r.lead_id}>
                <TableCell className="pl-8">{r.first_name}</TableCell>
                <TableCell>{r.last_name}</TableCell>
                <TableCell>{r.title}</TableCell>
                <TableCell>{r.email}</TableCell>
                <TableCell>{r.phone}</TableCell>
                <TableCell>{r.mobile}</TableCell>
                <TableCell>{r.lead_owner}</TableCell>
                <TableCell>{formatDate(r.mql_date)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground font-medium">{label}</p>
        <p className="text-2xl font-semibold mt-1">{value}</p>
      </CardContent>
    </Card>
  );
}
