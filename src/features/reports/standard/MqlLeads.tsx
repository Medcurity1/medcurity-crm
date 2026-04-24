import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Download, ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import { supabase } from "@/lib/supabase";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatDate, leadSourceLabel } from "@/lib/formatters";
import { downloadCsv, todayStamp } from "./report-helpers";

/**
 * MQL (Leads) — leads with MQL date in current fiscal quarter, not
 * converted. Columns match SF:
 *   First Name, Last Name, Title, Email, Phone, Mobile,
 *   Lead Owner, MQL
 * Grouping: Lead Source
 *
 * API: /rest/v1/v_mql_leads_qtd?select=*
 */
interface MqlLeadRow {
  lead_id: string;
  lead_source: string | null;
  first_name: string | null;
  last_name: string | null;
  title: string | null;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  lead_owner: string | null;
  mql_date: string | null;
}

export function MqlLeads() {
  const { data: rows, isLoading } = useQuery({
    queryKey: ["report", "mql-leads-qtd"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("v_mql_leads_qtd")
        .select("*")
        .order("mql_date", { ascending: false });
      if (error) throw error;
      return ((data ?? []) as unknown) as MqlLeadRow[];
    },
  });

  const grouped = useMemo(() => {
    const m = new Map<string, MqlLeadRow[]>();
    for (const r of rows ?? []) {
      const key = r.lead_source ?? "unknown";
      const list = m.get(key) ?? [];
      list.push(r);
      m.set(key, list);
    }
    return m;
  }, [rows]);

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
      leadSourceLabel(r.lead_source as never) ?? r.lead_source ?? "",
      r.first_name ?? "",
      r.last_name ?? "",
      r.title ?? "",
      r.email ?? "",
      r.phone ?? "",
      r.mobile ?? "",
      r.lead_owner ?? "",
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
        description="Leads with MQL date this fiscal quarter, not yet converted."
        actions={
          <Button variant="outline" size="sm" onClick={exportCsv} disabled={isLoading}>
            <Download className="h-4 w-4 mr-1" />
            Export CSV
          </Button>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Kpi label="MQL Leads" value={(rows?.length ?? 0).toLocaleString()} />
        <Kpi label="Sources" value={grouped.size.toLocaleString()} />
        <Kpi label="API" value="/rest/v1/v_mql_leads_qtd" tiny />
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4">
              <Skeleton className="h-64 w-full" />
            </div>
          ) : !rows?.length ? (
            <p className="p-6 text-sm text-muted-foreground text-center">
              No MQL leads this fiscal quarter.
            </p>
          ) : (
            <div className="divide-y">
              {Array.from(grouped.entries()).map(([source, list]) => (
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
                <TableCell className="pl-8">{r.first_name ?? ""}</TableCell>
                <TableCell>{r.last_name ?? ""}</TableCell>
                <TableCell>{r.title ?? ""}</TableCell>
                <TableCell>{r.email ?? ""}</TableCell>
                <TableCell>{r.phone ?? ""}</TableCell>
                <TableCell>{r.mobile ?? ""}</TableCell>
                <TableCell>{r.lead_owner ?? ""}</TableCell>
                <TableCell>{formatDate(r.mql_date)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
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
