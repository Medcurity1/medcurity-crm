import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Download } from "lucide-react";
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
import { formatDate } from "@/lib/formatters";
import {
  downloadCsv,
  todayStamp,
  DATE_RANGE_OPTIONS,
  resolveRange,
  type DateRangeKey,
} from "./report-helpers";

/**
 * MQL (Contacts) — contacts with MQL date, no SQL yet, marketable.
 * Columns match SF:
 *   First Name, Last Name, Title, Account Name, Phone, Mobile,
 *   Email, Account Owner, MQL
 *
 * API: /rest/v1/v_mql_contacts?select=*
 */
interface MqlContactRow {
  contact_id: string;
  first_name: string | null;
  last_name: string | null;
  title: string | null;
  account_name: string | null;
  phone: string | null;
  mobile: string | null;
  email: string | null;
  account_owner: string | null;
  mql_date: string | null;
}

export function MqlContacts() {
  const [range, setRange] = useState<DateRangeKey>("current_quarter");
  const { start, end } = resolveRange(range);

  const { data: rows, isLoading } = useQuery({
    queryKey: ["report", "mql-contacts", start, end],
    queryFn: async () => {
      let q = supabase.from("v_mql_contacts").select("*");
      if (start) q = q.gte("mql_date", start);
      if (end) q = q.lte("mql_date", end);
      q = q.order("mql_date", { ascending: false });
      const { data, error } = await q;
      if (error) throw error;
      return ((data ?? []) as unknown) as MqlContactRow[];
    },
  });

  const total = useMemo(() => (rows ?? []).length, [rows]);

  function exportCsv() {
    const header = [
      "First Name",
      "Last Name",
      "Title",
      "Account Name",
      "Phone",
      "Mobile",
      "Email",
      "Account Owner",
      "MQL",
    ];
    const data = (rows ?? []).map((r) => [
      r.first_name ?? "",
      r.last_name ?? "",
      r.title ?? "",
      r.account_name ?? "",
      r.phone ?? "",
      r.mobile ?? "",
      r.email ?? "",
      r.account_owner ?? "",
      r.mql_date ?? "",
    ]);
    downloadCsv(`mql-contacts-${todayStamp()}.csv`, [header, ...data]);
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
        title="MQL (Contacts)"
        description="Marketable contacts with MQL date, not yet SQL."
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

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Kpi label="MQL Contacts" value={total.toLocaleString()} />
        <Kpi label="Range" value={DATE_RANGE_OPTIONS.find((o) => o.value === range)?.label ?? ""} />
        <Kpi label="API" value="/rest/v1/v_mql_contacts" tiny />
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4">
              <Skeleton className="h-64 w-full" />
            </div>
          ) : !rows?.length ? (
            <p className="p-6 text-sm text-muted-foreground text-center">
              No MQL contacts in the selected range.
            </p>
          ) : (
            <div className="overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>First Name</TableHead>
                    <TableHead>Last Name</TableHead>
                    <TableHead>Title</TableHead>
                    <TableHead>Account Name</TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead>Mobile</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Account Owner</TableHead>
                    <TableHead>MQL</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.contact_id}>
                      <TableCell>{r.first_name ?? ""}</TableCell>
                      <TableCell>{r.last_name ?? ""}</TableCell>
                      <TableCell>{r.title ?? ""}</TableCell>
                      <TableCell>{r.account_name ?? ""}</TableCell>
                      <TableCell>{r.phone ?? ""}</TableCell>
                      <TableCell>{r.mobile ?? ""}</TableCell>
                      <TableCell>{r.email ?? ""}</TableCell>
                      <TableCell>{r.account_owner ?? ""}</TableCell>
                      <TableCell>{formatDate(r.mql_date)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Kpi({ label, value, tiny }: { label: string; value: string; tiny?: boolean }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground font-medium">{label}</p>
        <p className={tiny ? "text-sm font-mono mt-1 truncate" : "text-2xl font-semibold mt-1"}>
          {value}
        </p>
      </CardContent>
    </Card>
  );
}
