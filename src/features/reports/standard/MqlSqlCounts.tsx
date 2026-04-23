import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Download } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
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

/**
 * MQL + SQL counts with dedup.
 *
 * Per the project workflow (MEMORY.md):
 *   - Leads can be MQL only (not SQL)
 *   - Conversion to contact IS the SQL event
 *   - A contact.original_lead_id pointer means the lead→contact
 *     progression happened
 *
 * So the canonical totals per period are:
 *   MQLs created = leads whose mql_date falls in the period, counted
 *                  ONCE (by lead id). If that lead later converted to
 *                  a contact, the contact's contact.sql_date still
 *                  fires separately — we don't double-count the MQL.
 *   SQLs created = contacts whose sql_date falls in the period.
 *                  Leads with qualification='sql' are not possible
 *                  (enum disallows it); conversion is the SQL event.
 *
 * Dedup nuance:
 *   - If a contact has original_lead_id pointing at a lead, and that
 *     lead also has an mql_date, we already count the MQL on the
 *     lead side and the SQL on the contact side. That's correct —
 *     two separate funnel events, not a double-count.
 *   - If there's a contact with sql_date but no original_lead_id,
 *     that's a contact added directly (no lead stage). Still counts
 *     as an SQL for the period (contact.sql_date) — doesn't double.
 */
export function MqlSqlCounts() {
  const [rangeMonths, setRangeMonths] = useState<6 | 12 | 24>(12);

  const leadsQ = useQuery({
    queryKey: ["report", "mql-sql", "leads", rangeMonths],
    queryFn: async () => {
      const from = new Date();
      from.setMonth(from.getMonth() - rangeMonths);
      from.setDate(1);
      const { data, error } = await supabase
        .from("leads")
        .select("id, mql_date")
        .not("mql_date", "is", null)
        .gte("mql_date", from.toISOString().slice(0, 10));
      if (error) throw error;
      return data ?? [];
    },
  });

  const contactsQ = useQuery({
    queryKey: ["report", "mql-sql", "contacts", rangeMonths],
    queryFn: async () => {
      const from = new Date();
      from.setMonth(from.getMonth() - rangeMonths);
      from.setDate(1);
      const { data, error } = await supabase
        .from("contacts")
        .select("id, mql_date, sql_date, original_lead_id")
        .or(
          `mql_date.gte.${from.toISOString().slice(0, 10)},sql_date.gte.${from.toISOString().slice(0, 10)}`
        );
      if (error) throw error;
      return data ?? [];
    },
  });

  const isLoading = leadsQ.isLoading || contactsQ.isLoading;

  const monthly = useMemo(() => {
    const leads = leadsQ.data ?? [];
    const contacts = contactsQ.data ?? [];

    const byMonth = new Map<string, { mql: Set<string>; sql: Set<string> }>();
    const bump = (key: string) => {
      if (!byMonth.has(key)) byMonth.set(key, { mql: new Set(), sql: new Set() });
      return byMonth.get(key)!;
    };

    // MQL events on leads
    for (const l of leads) {
      if (!l.mql_date) continue;
      const d = new Date(l.mql_date);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      bump(key).mql.add(l.id);
    }

    // MQL events on contacts that DIDN'T come from a lead
    // (otherwise the lead side already counted them).
    for (const c of contacts) {
      if (c.mql_date && !c.original_lead_id) {
        const d = new Date(c.mql_date);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        // Prefix with c: so it can't collide with a lead id above
        bump(key).mql.add(`c:${c.id}`);
      }
      // SQL events are contact-side only
      if (c.sql_date) {
        const d = new Date(c.sql_date);
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        bump(key).sql.add(c.id);
      }
    }

    // Emit the displayed series — last `rangeMonths` months.
    const now = new Date();
    const rows: {
      monthKey: string;
      label: string;
      year: number;
      month: number;
      mql: number;
      sql: number;
    }[] = [];
    for (let i = rangeMonths - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const e = byMonth.get(key);
      rows.push({
        monthKey: key,
        label: d.toLocaleDateString("en-US", { month: "short", year: "2-digit" }),
        year: d.getFullYear(),
        month: d.getMonth() + 1,
        mql: e?.mql.size ?? 0,
        sql: e?.sql.size ?? 0,
      });
    }
    return rows;
  }, [leadsQ.data, contactsQ.data, rangeMonths]);

  const totalMql = monthly.reduce((s, r) => s + r.mql, 0);
  const totalSql = monthly.reduce((s, r) => s + r.sql, 0);
  const conversion = totalMql > 0 ? ((totalSql / totalMql) * 100).toFixed(1) + "%" : "—";

  function exportCsv() {
    const header = ["Year", "Month", "MQLs", "SQLs"];
    const rows = monthly.map((r) => [r.year, r.month, r.mql, r.sql]);
    const csv = [header, ...rows].map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 10);
    link.href = url;
    link.download = `mql-sql-counts-${stamp}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
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
        title="MQL & SQL Counts"
        description="Monthly Marketing / Sales Qualified Leads with dedup across the lead → contact funnel."
        actions={
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-md border">
              {([6, 12, 24] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setRangeMonths(m)}
                  className={`px-3 py-1.5 text-sm ${rangeMonths === m ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
                >
                  {m}M
                </button>
              ))}
            </div>
            <Button variant="outline" size="sm" onClick={exportCsv} disabled={isLoading}>
              <Download className="h-4 w-4 mr-1" />
              Export CSV
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Total MQLs" value={totalMql.toLocaleString()} />
        <Kpi label="Total SQLs" value={totalSql.toLocaleString()} />
        <Kpi label="MQL → SQL Conversion" value={conversion} />
        <Kpi
          label="Avg MQLs / month"
          value={
            monthly.length > 0 ? (totalMql / monthly.length).toFixed(1) : "0"
          }
        />
      </div>

      <Card>
        <CardContent className="p-4">
          {isLoading ? (
            <Skeleton className="h-80 w-full" />
          ) : (
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthly}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip contentStyle={{ fontSize: 12 }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Bar dataKey="mql" name="MQLs" fill="#3b82f6" />
                  <Bar dataKey="sql" name="SQLs" fill="#10b981" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Month</TableHead>
                <TableHead className="text-right">MQLs</TableHead>
                <TableHead className="text-right">SQLs</TableHead>
                <TableHead className="text-right">Conversion</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {monthly.map((r) => (
                <TableRow key={r.monthKey}>
                  <TableCell>
                    {new Date(r.year, r.month - 1).toLocaleDateString("en-US", {
                      month: "long",
                      year: "numeric",
                    })}
                  </TableCell>
                  <TableCell className="text-right">{r.mql}</TableCell>
                  <TableCell className="text-right">{r.sql}</TableCell>
                  <TableCell className="text-right text-muted-foreground">
                    {r.mql > 0 ? ((r.sql / r.mql) * 100).toFixed(1) + "%" : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
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
