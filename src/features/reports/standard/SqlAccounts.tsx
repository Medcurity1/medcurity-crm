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
import { fetchAccountsById, fetchUsersById } from "./report-fetchers";

interface SqlRow {
  contact_id: string;
  account_id: string;
  first_name: string;
  last_name: string;
  title: string;
  account_name: string;
  account_owner: string;
  account_created_date: string | null;
  lead_source: string;
  description: string;
  sql_date: string | null;
  mql_date: string | null;
}

export function SqlAccounts() {
  const [range, setRange] = useState<DateRangeKey>("current_quarter");
  const { start, end } = resolveRange(range);

  const { data: rows, isLoading, error } = useQuery({
    queryKey: ["report", "sql-accounts-v2", start, end],
    queryFn: async (): Promise<SqlRow[]> => {
      let q = supabase
        .from("contacts")
        .select("id, first_name, last_name, title, sql_date, mql_date, account_id")
        .not("sql_date", "is", null)
        .is("archived_at", null);
      if (start) q = q.gte("sql_date", start);
      if (end) q = q.lte("sql_date", end);
      q = q.order("sql_date", { ascending: false });
      const { data, error } = await q;
      if (error) throw error;

      type ContactRaw = {
        id: string;
        first_name: string | null;
        last_name: string | null;
        title: string | null;
        sql_date: string | null;
        mql_date: string | null;
        account_id: string | null;
      };
      const contacts = ((data ?? []) as unknown) as ContactRaw[];
      const accountIds = new Set<string>(
        contacts.map((c) => c.account_id as string).filter(Boolean),
      );
      const accounts = await fetchAccountsById(accountIds);
      const ownerIds = new Set<string>(
        Array.from(accounts.values())
          .map((a) => a.owner_user_id as string)
          .filter(Boolean),
      );
      const users = await fetchUsersById(ownerIds);

      return contacts
        .filter((c) => accounts.has(c.account_id as string))
        .map((c) => {
          const a = accounts.get(c.account_id as string)!;
          const owner = a.owner_user_id ? users.get(a.owner_user_id) : undefined;
          return {
            contact_id: c.id as string,
            account_id: c.account_id as string,
            first_name: (c.first_name as string) ?? "",
            last_name: (c.last_name as string) ?? "",
            title: (c.title as string) ?? "",
            account_name: a.name,
            account_owner: owner?.full_name ?? "Unassigned",
            account_created_date: a.created_at?.slice(0, 10) ?? null,
            lead_source: a.lead_source ?? "",
            description: a.notes ?? "",
            sql_date: c.sql_date as string | null,
            mql_date: c.mql_date as string | null,
          };
        });
    },
  });

  const grouped = useMemo(() => {
    const m = new Map<string, SqlRow[]>();
    for (const r of rows ?? []) {
      const key = r.account_name || "Unknown";
      const list = m.get(key) ?? [];
      list.push(r);
      m.set(key, list);
    }
    return m;
  }, [rows]);

  function exportCsv() {
    const header = [
      "Account Name",
      "First Name",
      "Last Name",
      "Title",
      "Account Owner",
      "Account Created Date",
      "Lead Source",
      "Description",
      "SQL",
      "MQL",
    ];
    const data = (rows ?? []).map((r) => [
      r.account_name,
      r.first_name,
      r.last_name,
      r.title,
      r.account_owner,
      r.account_created_date ?? "",
      r.lead_source,
      r.description,
      r.sql_date ?? "",
      r.mql_date ?? "",
    ]);
    downloadCsv(`sql-accounts-${todayStamp()}.csv`, [header, ...data]);
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
        title="SQL (Accounts)"
        description="Contacts qualified as SQL, grouped by account."
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
        <Kpi label="Accounts" value={grouped.size.toLocaleString()} />
        <Kpi label="Contacts (SQL)" value={(rows?.length ?? 0).toLocaleString()} />
        <Kpi label="Range" value={DATE_RANGE_OPTIONS.find((o) => o.value === range)?.label ?? ""} />
      </div>

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
                    <TableHead>Account Name</TableHead>
                    <TableHead>First Name</TableHead>
                    <TableHead>Last Name</TableHead>
                    <TableHead>Title</TableHead>
                    <TableHead>Account Owner</TableHead>
                    <TableHead>Account Created</TableHead>
                    <TableHead>Lead Source</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead>SQL</TableHead>
                    <TableHead>MQL</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  <TableRow>
                    <TableCell colSpan={10} className="p-6 text-sm text-muted-foreground text-center">
                      No SQL events in the selected range.
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="divide-y">
              {Array.from(grouped.entries()).map(([accountName, contacts]) => (
                <div key={accountName}>
                  <div className="px-4 py-2 bg-muted/50 font-semibold text-sm">
                    {accountName} · {contacts.length} contact{contacts.length === 1 ? "" : "s"}
                  </div>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>First Name</TableHead>
                        <TableHead>Last Name</TableHead>
                        <TableHead>Title</TableHead>
                        <TableHead>Account Owner</TableHead>
                        <TableHead>Account Created</TableHead>
                        <TableHead>Lead Source</TableHead>
                        <TableHead>SQL</TableHead>
                        <TableHead>MQL</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {contacts.map((c) => (
                        <TableRow key={c.contact_id}>
                          <TableCell>{c.first_name}</TableCell>
                          <TableCell>{c.last_name}</TableCell>
                          <TableCell>{c.title}</TableCell>
                          <TableCell>{c.account_owner}</TableCell>
                          <TableCell>{formatDate(c.account_created_date)}</TableCell>
                          <TableCell>{c.lead_source}</TableCell>
                          <TableCell>{formatDate(c.sql_date)}</TableCell>
                          <TableCell>{formatDate(c.mql_date)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ))}
            </div>
          )}
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
