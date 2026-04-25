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
import { fetchAccountsById, fetchUsersById, fetchAllRows } from "./report-fetchers";
import { PreviewNote, PREVIEW_LIMIT } from "./PreviewNote";

interface MqlContactRow {
  contact_id: string;
  account_id: string | null;
  first_name: string;
  last_name: string;
  title: string;
  account_name: string;
  phone: string;
  mobile: string;
  email: string;
  account_owner: string;
  mql_date: string | null;
}

export function MqlContacts() {
  const [range, setRange] = useState<DateRangeKey>("current_quarter");
  const { start, end } = resolveRange(range);

  const { data: rows, isLoading, error } = useQuery({
    queryKey: ["report", "mql-contacts-v2", start, end],
    queryFn: async (): Promise<MqlContactRow[]> => {
      type ContactRaw = {
        id: string;
        first_name: string | null;
        last_name: string | null;
        title: string | null;
        email: string | null;
        phone: string | null;
        mobile_phone: string | null;
        mql_date: string | null;
        sql_date: string | null;
        do_not_contact: boolean | null;
        account_id: string | null;
      };
      const contacts = await fetchAllRows<ContactRaw>(() => {
        let q = supabase
          .from("contacts")
          .select(
            "id, first_name, last_name, title, email, phone, mobile_phone, mql_date, sql_date, do_not_contact, account_id",
          )
          .not("mql_date", "is", null)
          .is("sql_date", null)
          .eq("do_not_contact", false)
          .is("archived_at", null);
        if (start) q = q.gte("mql_date", start);
        if (end) q = q.lte("mql_date", end);
        return q.order("mql_date", { ascending: false });
      });
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

      return contacts.map((c) => {
        const a = accounts.get(c.account_id as string);
        const owner = a?.owner_user_id ? users.get(a.owner_user_id) : undefined;
        return {
          contact_id: c.id as string,
          account_id: c.account_id as string | null,
          first_name: (c.first_name as string) ?? "",
          last_name: (c.last_name as string) ?? "",
          title: (c.title as string) ?? "",
          account_name: a?.name ?? "",
          phone: (c.phone as string) ?? "",
          mobile: (c.mobile_phone as string) ?? "",
          email: (c.email as string) ?? "",
          account_owner: owner?.full_name ?? "Unassigned",
          mql_date: c.mql_date as string | null,
        };
      });
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
      r.first_name,
      r.last_name,
      r.title,
      r.account_name,
      r.phone,
      r.mobile,
      r.email,
      r.account_owner,
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

      {error && (
        <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          Error: {(error as Error).message}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <Kpi label="MQL Contacts" value={total.toLocaleString()} />
        <Kpi label="Range" value={DATE_RANGE_OPTIONS.find((o) => o.value === range)?.label ?? ""} />
      </div>

      <PreviewNote total={rows?.length ?? 0} shown={PREVIEW_LIMIT} />

      <Card>
        <CardContent className="p-0">
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
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={9} className="p-4">
                      <Skeleton className="h-48 w-full" />
                    </TableCell>
                  </TableRow>
                ) : !rows?.length ? (
                  <TableRow>
                    <TableCell colSpan={9} className="p-6 text-sm text-muted-foreground text-center">
                      No MQL contacts in the selected range.
                    </TableCell>
                  </TableRow>
                ) : (
                  rows.slice(0, PREVIEW_LIMIT).map((r) => (
                    <TableRow key={r.contact_id}>
                      <TableCell>
                        <Link to={`/contacts/${r.contact_id}`} className="text-primary hover:underline">
                          {r.first_name}
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Link to={`/contacts/${r.contact_id}`} className="text-primary hover:underline">
                          {r.last_name}
                        </Link>
                      </TableCell>
                      <TableCell>{r.title}</TableCell>
                      <TableCell>
                        {r.account_id ? (
                          <Link to={`/accounts/${r.account_id}`} className="text-primary hover:underline">
                            {r.account_name}
                          </Link>
                        ) : (
                          r.account_name
                        )}
                      </TableCell>
                      <TableCell>{r.phone}</TableCell>
                      <TableCell>{r.mobile}</TableCell>
                      <TableCell>{r.email}</TableCell>
                      <TableCell>{r.account_owner}</TableCell>
                      <TableCell>{formatDate(r.mql_date)}</TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
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
