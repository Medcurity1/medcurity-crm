// "Do Not Email" — the marketing suppression list. Every contact + import we
// must NOT email, each tagged with a reason. Filter to one category for a
// targeted list, or keep "All" for the master sheet, then Export CSV and
// subtract it from any campaign list. Backed by v_marketing_suppression.

import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Download, ShieldX } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { downloadCsv, todayStamp } from "./report-helpers";
import { fetchUsersById, fetchAllRows } from "./report-fetchers";
import { PreviewNote, PREVIEW_LIMIT } from "./PreviewNote";

// Friendly label per reason (the view's raw reason codes).
const REASON_LABEL: Record<string, string> = {
  customer_account: "Customer account",
  former_customer_account: "Past customer",
  partner_account: "Partner account",
  contact_do_not_contact: "Do not contact",
  account_do_not_contact: "Account: do not contact",
  contact_no_longer_employed: "No longer employed",
  contact_archived: "Archived contact",
  lead_do_not_market: "Import: do not market",
  lead_do_not_contact: "Import: do not contact",
  lead_avoid: "Import: avoid (bounced/unsub)",
  lead_archived: "Import: archived",
};

// Category filter → which reasons it includes.
const CATEGORIES: { value: string; label: string; reasons: string[] | null }[] = [
  { value: "all", label: "All (master list)", reasons: null },
  { value: "customer", label: "Customer-account contacts", reasons: ["customer_account"] },
  { value: "partner", label: "Partner-account contacts", reasons: ["partner_account"] },
  { value: "former", label: "Past customers", reasons: ["former_customer_account"] },
  { value: "do_not_market", label: "Do-not-market / do-not-contact", reasons: ["contact_do_not_contact", "account_do_not_contact", "lead_do_not_market", "lead_do_not_contact"] },
  { value: "nle_bounced", label: "No longer employed / bounced / archived", reasons: ["contact_no_longer_employed", "contact_archived", "lead_avoid", "lead_archived"] },
];

interface SuppRow {
  source_kind: "contact" | "lead";
  source_id: string;
  reason: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
  company: string | null;
  account_id: string | null;
  owner_user_id: string | null;
}

export function DoNotEmail() {
  const [category, setCategory] = useState("all");
  const reasons = CATEGORIES.find((c) => c.value === category)?.reasons ?? null;

  const { data, isLoading, error } = useQuery({
    queryKey: ["report", "do-not-email", category],
    queryFn: async () => {
      const rows = await fetchAllRows<SuppRow>(
        () => {
          let q = supabase
            .from("v_marketing_suppression")
            .select("source_kind, source_id, reason, first_name, last_name, email, company, account_id, owner_user_id");
          if (reasons) q = q.in("reason", reasons);
          return q.order("email", { ascending: true });
        },
        1000,
        200_000, // multi-row + ~30k imports can run large; well under any real cap
      );
      const ownerIds = new Set(rows.map((r) => r.owner_user_id).filter(Boolean) as string[]);
      const users = await fetchUsersById(ownerIds);
      return rows.map((r) => ({
        ...r,
        owner_name: r.owner_user_id ? users.get(r.owner_user_id)?.full_name ?? "Unassigned" : "Unassigned",
      }));
    },
  });

  const rows = data ?? [];
  const distinctEmails = useMemo(
    () => new Set(rows.map((r) => (r.email || "").trim().toLowerCase())).size,
    [rows],
  );

  function exportCsv() {
    const header = ["First Name", "Last Name", "Email", "Company", "Reason", "Source", "Owner"];
    const out = rows.map((r) => [
      r.first_name ?? "",
      r.last_name ?? "",
      r.email,
      r.company ?? "",
      REASON_LABEL[r.reason] ?? r.reason,
      r.source_kind === "lead" ? "Import" : "Contact",
      r.owner_name,
    ]);
    downloadCsv(`do-not-email-${category}-${todayStamp()}.csv`, [header, ...out]);
  }

  return (
    <div className="space-y-4">
      <div>
        <Button variant="ghost" size="sm" asChild>
          <Link to="/reports?tab=standard">
            <ArrowLeft className="h-4 w-4 mr-1" /> Back to Standard Reports
          </Link>
        </Button>
      </div>

      <PageHeader
        title="Do Not Email"
        description="Everyone to suppress from marketing — customers, partners, past customers, do-not-contact/do-not-market, and bounced/archived. Filter to one category or keep the master list, export, and subtract it from your campaign list."
        actions={
          <div className="flex items-center gap-2">
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger className="w-64"><SelectValue /></SelectTrigger>
              <SelectContent>
                {CATEGORIES.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={exportCsv} disabled={isLoading || !rows.length}>
              <Download className="h-4 w-4 mr-1" /> Export CSV
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
        <Kpi label="Rows" value={isLoading ? "…" : rows.length.toLocaleString()} icon />
        <Kpi label="Unique emails to suppress" value={isLoading ? "…" : distinctEmails.toLocaleString()} />
        <Kpi label="Category" value={CATEGORIES.find((c) => c.value === category)?.label ?? ""} />
      </div>

      <p className="text-xs text-muted-foreground">
        A person can appear once per reason (e.g. a customer contact who is also do-not-contact), so "Rows" ≥ "Unique
        emails". For suppression, subtract the email column. Imports come from the leads/imports pool (will retire with it).
      </p>

      <PreviewNote total={rows.length} shown={PREVIEW_LIMIT} />

      <Card>
        <CardContent className="p-0">
          <div className="overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>First Name</TableHead>
                  <TableHead>Last Name</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Company</TableHead>
                  <TableHead>Reason</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Owner</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={7} className="p-4"><Skeleton className="h-48 w-full" /></TableCell></TableRow>
                ) : !rows.length ? (
                  <TableRow><TableCell colSpan={7} className="p-6 text-sm text-muted-foreground text-center">Nothing to suppress in this category.</TableCell></TableRow>
                ) : (
                  rows.slice(0, PREVIEW_LIMIT).map((r) => {
                    const href = r.source_kind === "lead" ? `/leads/${r.source_id}` : `/contacts/${r.source_id}`;
                    return (
                      <TableRow key={`${r.source_kind}-${r.source_id}-${r.reason}`}>
                        <TableCell><Link target="_blank" rel="noopener noreferrer" to={href} className="text-primary hover:underline">{r.first_name}</Link></TableCell>
                        <TableCell>{r.last_name}</TableCell>
                        <TableCell>{r.email}</TableCell>
                        <TableCell>
                          {r.account_id ? (
                            <Link target="_blank" rel="noopener noreferrer" to={`/accounts/${r.account_id}`} className="text-primary hover:underline">{r.company}</Link>
                          ) : r.company}
                        </TableCell>
                        <TableCell>{REASON_LABEL[r.reason] ?? r.reason}</TableCell>
                        <TableCell className="capitalize">{r.source_kind === "lead" ? "Import" : "Contact"}</TableCell>
                        <TableCell>{r.owner_name}</TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function Kpi({ label, value, icon }: { label: string; value: string; icon?: boolean }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground font-medium flex items-center gap-1">
          {icon && <ShieldX className="h-3.5 w-3.5" />} {label}
        </p>
        <p className="text-2xl font-semibold mt-1">{value}</p>
      </CardContent>
    </Card>
  );
}
