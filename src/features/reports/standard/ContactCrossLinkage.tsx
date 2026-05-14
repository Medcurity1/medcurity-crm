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
import { Badge } from "@/components/ui/badge";
import { downloadCsv, todayStamp } from "./report-helpers";
import { PreviewNote, PREVIEW_LIMIT } from "./PreviewNote";

interface LinkageRow {
  contact_id: string;
  contact_name: string;
  contact_email: string | null;
  link_type: "home_account" | "linked_account" | "linked_opportunity";
  record_id: string;
  record_name: string;
  record_kind: "account" | "opportunity";
}

interface ContactSummary {
  contact_id: string;
  contact_name: string;
  contact_email: string | null;
  total_records: number;
  account_count: number;
  opportunity_count: number;
  records: LinkageRow[];
}

type Mode = "multi_only" | "all" | "opps_only";
const MODE_OPTIONS: { value: Mode; label: string }[] = [
  { value: "multi_only", label: "Contacts on 2+ records" },
  { value: "opps_only", label: "Contacts on an opportunity" },
  { value: "all", label: "All contact associations" },
];

/**
 * Contact Cross-Linkage report — answers "which contacts appear on
 * multiple records?" Sourced from `v_contact_cross_linkage`, which
 * UNIONs home accounts (contacts.account_id), additional accounts
 * (contact_account_links), and opportunity stakeholders
 * (contact_opportunity_links).
 *
 * Default view filters to contacts with 2+ associations, since the
 * goal of the report is to highlight cross-linkage — single-account
 * contacts are the boring majority. Switch the dropdown to see
 * everyone or to focus on opportunity stakeholders.
 */
export function ContactCrossLinkage() {
  const [mode, setMode] = useState<Mode>("multi_only");

  const { data: rows, isLoading, error } = useQuery({
    queryKey: ["report", "contact-cross-linkage"],
    queryFn: async (): Promise<LinkageRow[]> => {
      const { data, error } = await supabase
        .from("v_contact_cross_linkage")
        .select(
          "contact_id, contact_name, contact_email, link_type, record_id, record_name, record_kind",
        )
        .order("contact_name");
      if (error) throw error;
      return (data ?? []) as LinkageRow[];
    },
  });

  // Group by contact_id and tally per record kind.
  const summaries = useMemo<ContactSummary[]>(() => {
    const map = new Map<string, ContactSummary>();
    for (const r of rows ?? []) {
      let s = map.get(r.contact_id);
      if (!s) {
        s = {
          contact_id: r.contact_id,
          contact_name: r.contact_name,
          contact_email: r.contact_email,
          total_records: 0,
          account_count: 0,
          opportunity_count: 0,
          records: [],
        };
        map.set(r.contact_id, s);
      }
      s.total_records += 1;
      if (r.record_kind === "account") s.account_count += 1;
      else s.opportunity_count += 1;
      s.records.push(r);
    }
    const arr = Array.from(map.values());
    arr.sort((a, b) => b.total_records - a.total_records);
    return arr;
  }, [rows]);

  const filtered = useMemo(() => {
    if (mode === "all") return summaries;
    if (mode === "multi_only")
      return summaries.filter((s) => s.total_records >= 2);
    return summaries.filter((s) => s.opportunity_count > 0);
  }, [summaries, mode]);

  const counts = useMemo(() => {
    const total = summaries.length;
    const multi = summaries.filter((s) => s.total_records >= 2).length;
    const opps = summaries.filter((s) => s.opportunity_count > 0).length;
    return { total, multi, opps };
  }, [summaries]);

  function exportCsv() {
    const header = [
      "Contact",
      "Email",
      "Total Records",
      "Accounts",
      "Opportunities",
      "Record Details (kind | type | name)",
    ];
    const data = filtered.map((s) => [
      s.contact_name,
      s.contact_email ?? "",
      s.total_records,
      s.account_count,
      s.opportunity_count,
      s.records
        .map(
          (r) =>
            `${r.record_kind}|${r.link_type}|${r.record_name.replace(/\|/g, " ")}`,
        )
        .join(" ; "),
    ]);
    downloadCsv(`contact-cross-linkage-${todayStamp()}.csv`, [header, ...data]);
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
        title="Contact Cross-Linkage"
        description="Contacts that appear on multiple accounts and/or opportunities. Sourced from v_contact_cross_linkage (home accounts + contact_account_links + contact_opportunity_links)."
        actions={
          <div className="flex items-center gap-2">
            <Select value={mode} onValueChange={(v) => setMode(v as Mode)}>
              <SelectTrigger className="w-64">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MODE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="sm"
              onClick={exportCsv}
              disabled={isLoading}
            >
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

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label="Contacts shown" value={filtered.length.toLocaleString()} />
        <Kpi
          label="On 2+ records"
          value={counts.multi.toLocaleString()}
          hint={`of ${counts.total} total`}
        />
        <Kpi
          label="On an opportunity"
          value={counts.opps.toLocaleString()}
        />
        <Kpi
          label="Total associations"
          value={(rows?.length ?? 0).toLocaleString()}
        />
      </div>

      <PreviewNote total={filtered.length} shown={PREVIEW_LIMIT} />

      <Card>
        <CardContent className="p-0">
          <div className="overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Contact</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead className="text-right"># Records</TableHead>
                  <TableHead className="text-right">Accounts</TableHead>
                  <TableHead className="text-right">Opportunities</TableHead>
                  <TableHead>Appears on</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={6} className="p-4">
                      <Skeleton className="h-48 w-full" />
                    </TableCell>
                  </TableRow>
                ) : !filtered.length ? (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="p-6 text-sm text-muted-foreground text-center"
                    >
                      No contacts match this filter.
                    </TableCell>
                  </TableRow>
                ) : (
                  filtered.slice(0, PREVIEW_LIMIT).map((s) => (
                    <TableRow key={s.contact_id}>
                      <TableCell>
                        <Link
                          to={`/contacts/${s.contact_id}`}
                          className="text-primary hover:underline font-medium"
                        >
                          {s.contact_name}
                        </Link>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {s.contact_email ?? "—"}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {s.total_records}
                      </TableCell>
                      <TableCell className="text-right">
                        {s.account_count}
                      </TableCell>
                      <TableCell className="text-right">
                        {s.opportunity_count}
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-1 max-w-xl">
                          {s.records.slice(0, 6).map((r) => (
                            <Link
                              key={`${r.record_kind}-${r.record_id}-${r.link_type}`}
                              to={
                                r.record_kind === "account"
                                  ? `/accounts/${r.record_id}`
                                  : `/opportunities/${r.record_id}`
                              }
                              className="hover:underline"
                            >
                              <Badge
                                variant="secondary"
                                className={
                                  r.link_type === "home_account"
                                    ? "bg-emerald-100 text-emerald-700"
                                    : r.record_kind === "opportunity"
                                      ? "bg-violet-100 text-violet-700"
                                      : "bg-sky-100 text-sky-700"
                                }
                              >
                                {r.record_name}
                              </Badge>
                            </Link>
                          ))}
                          {s.records.length > 6 && (
                            <span className="text-xs text-muted-foreground">
                              +{s.records.length - 6} more
                            </span>
                          )}
                        </div>
                      </TableCell>
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

function Kpi({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs text-muted-foreground font-medium">{label}</p>
        <p className="text-2xl font-semibold mt-1">{value}</p>
        {hint && <p className="text-[10px] text-muted-foreground mt-0.5">{hint}</p>}
      </CardContent>
    </Card>
  );
}
