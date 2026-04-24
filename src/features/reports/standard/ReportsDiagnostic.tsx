import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Database } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Diagnostic panel for standard reports. Runs the same count queries
 * the reports use (plus their unfiltered counterparts) so you can
 * tell in a glance whether empty reports are a filter problem, a
 * data problem, or an RLS problem.
 *
 * Available at /reports/standard/diagnostic.
 */

type CheckResult = {
  label: string;
  desc: string;
  count: number | null;
  error: string | null;
};

async function count(
  label: string,
  desc: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query: any,
): Promise<CheckResult> {
  const { count: c, error } = await query;
  return {
    label,
    desc,
    count: c ?? null,
    error: error?.message ?? null,
  };
}

export function ReportsDiagnostic() {
  const { data, isLoading } = useQuery({
    queryKey: ["reports-diagnostic"],
    queryFn: async () => {
      const today = new Date();
      const q = Math.floor(today.getUTCMonth() / 3);
      const qStart = new Date(Date.UTC(today.getUTCFullYear(), q * 3, 1))
        .toISOString()
        .slice(0, 10);
      const qEnd = new Date(Date.UTC(today.getUTCFullYear(), q * 3 + 3, 0))
        .toISOString()
        .slice(0, 10);

      const opts = { count: "exact" as const, head: true };

      const results = await Promise.all([
        // ---------- OPPORTUNITIES ----------
        count(
          "All opportunities",
          "total rows in public.opportunities",
          supabase.from("opportunities").select("*", opts),
        ),
        count(
          "  ... archived_at IS NULL",
          "live (non-archived) opps",
          supabase.from("opportunities").select("*", opts).is("archived_at", null),
        ),
        count(
          "  ... stage = closed_won",
          "closed-won opps (live only)",
          supabase
            .from("opportunities")
            .select("*", opts)
            .is("archived_at", null)
            .eq("stage", "closed_won"),
        ),
        count(
          "  ... stage = closed_lost",
          "closed-lost opps (live only)",
          supabase
            .from("opportunities")
            .select("*", opts)
            .is("archived_at", null)
            .eq("stage", "closed_lost"),
        ),
        count(
          "  ... kind = new_business",
          "opps flagged as New Business (live only)",
          supabase
            .from("opportunities")
            .select("*", opts)
            .is("archived_at", null)
            .eq("kind", "new_business"),
        ),
        count(
          "  ... kind = renewal",
          "opps flagged as Existing Business / Renewal (live only)",
          supabase
            .from("opportunities")
            .select("*", opts)
            .is("archived_at", null)
            .eq("kind", "renewal"),
        ),
        count(
          "  ... kind IS NULL",
          "opps with kind not set (hurts New/Lost/Renewals reports)",
          supabase
            .from("opportunities")
            .select("*", opts)
            .is("archived_at", null)
            .is("kind", null),
        ),
        count(
          `New Customers QTD (${qStart} → ${qEnd})`,
          "stage=closed_won AND kind=new_business AND close_date in current quarter",
          supabase
            .from("opportunities")
            .select("*", opts)
            .is("archived_at", null)
            .eq("stage", "closed_won")
            .eq("kind", "new_business")
            .gte("close_date", qStart)
            .lte("close_date", qEnd),
        ),
        count(
          `Lost Customers QTD (${qStart} → ${qEnd})`,
          "stage=closed_lost AND kind=renewal AND close_date in current quarter",
          supabase
            .from("opportunities")
            .select("*", opts)
            .is("archived_at", null)
            .eq("stage", "closed_lost")
            .eq("kind", "renewal")
            .gte("close_date", qStart)
            .lte("close_date", qEnd),
        ),
        count(
          `Renewals QTD (${qStart} → ${qEnd})`,
          "stage=closed_won AND kind=renewal AND close_date in current quarter",
          supabase
            .from("opportunities")
            .select("*", opts)
            .is("archived_at", null)
            .eq("stage", "closed_won")
            .eq("kind", "renewal")
            .gte("close_date", qStart)
            .lte("close_date", qEnd),
        ),
        count(
          "Closed Won (all-time)",
          "stage=closed_won ignoring date range and kind",
          supabase
            .from("opportunities")
            .select("*", opts)
            .is("archived_at", null)
            .eq("stage", "closed_won"),
        ),
        count(
          "Closed Won (current year)",
          `stage=closed_won AND close_date >= ${today.getUTCFullYear()}-01-01`,
          supabase
            .from("opportunities")
            .select("*", opts)
            .is("archived_at", null)
            .eq("stage", "closed_won")
            .gte("close_date", `${today.getUTCFullYear()}-01-01`),
        ),

        // ---------- LEADS ----------
        count(
          "All leads",
          "total rows in public.leads",
          supabase.from("leads").select("*", opts),
        ),
        count(
          "  ... live (archived_at IS NULL)",
          "non-archived leads",
          supabase.from("leads").select("*", opts).is("archived_at", null),
        ),
        count(
          "  ... mql_date IS NOT NULL",
          "leads that were ever MQL",
          supabase
            .from("leads")
            .select("*", opts)
            .is("archived_at", null)
            .not("mql_date", "is", null),
        ),
        count(
          `MQL Leads QTD (${qStart} → ${qEnd})`,
          "mql_date in current quarter AND not converted",
          supabase
            .from("leads")
            .select("*", opts)
            .is("archived_at", null)
            .not("mql_date", "is", null)
            .neq("status", "converted")
            .gte("mql_date", qStart)
            .lte("mql_date", qEnd),
        ),

        // ---------- CONTACTS ----------
        count(
          "All contacts",
          "total rows in public.contacts",
          supabase.from("contacts").select("*", opts),
        ),
        count(
          "  ... mql_date IS NOT NULL",
          "contacts that were ever MQL",
          supabase
            .from("contacts")
            .select("*", opts)
            .is("archived_at", null)
            .not("mql_date", "is", null),
        ),
        count(
          "  ... sql_date IS NOT NULL",
          "contacts that became SQL",
          supabase
            .from("contacts")
            .select("*", opts)
            .is("archived_at", null)
            .not("sql_date", "is", null),
        ),
        count(
          "MQL Contacts (marketable, not SQL)",
          "mql_date set AND sql_date null AND do_not_contact=false",
          supabase
            .from("contacts")
            .select("*", opts)
            .is("archived_at", null)
            .not("mql_date", "is", null)
            .is("sql_date", null)
            .eq("do_not_contact", false),
        ),

        // ---------- ACCOUNTS ----------
        count(
          "All accounts",
          "total rows in public.accounts",
          supabase.from("accounts").select("*", opts),
        ),
        count(
          "  ... lifecycle_status = inactive",
          "accounts currently marked churned",
          supabase
            .from("accounts")
            .select("*", opts)
            .is("archived_at", null)
            .eq("lifecycle_status", "inactive"),
        ),
      ]);

      return { checks: results, qStart, qEnd };
    },
  });

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
        title="Reports Diagnostic"
        description="Raw row counts. Use this to tell whether empty reports are a data problem or a filter problem."
      />

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4">
              <Skeleton className="h-64 w-full" />
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40">
                  <th className="text-left px-4 py-2 font-semibold">Check</th>
                  <th className="text-right px-4 py-2 font-semibold">Rows</th>
                  <th className="text-left px-4 py-2 font-semibold">Notes</th>
                </tr>
              </thead>
              <tbody>
                {data?.checks.map((c, i) => (
                  <tr key={i} className="border-b">
                    <td className="px-4 py-2 font-mono whitespace-pre">
                      {c.label}
                    </td>
                    <td className="px-4 py-2 text-right font-mono">
                      {c.error ? (
                        <span className="text-destructive">ERR</span>
                      ) : (
                        (c.count ?? 0).toLocaleString()
                      )}
                    </td>
                    <td className="px-4 py-2 text-muted-foreground">
                      {c.error ? (
                        <span className="text-destructive">{c.error}</span>
                      ) : (
                        c.desc
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      <div className="rounded-md border bg-muted/30 p-4 text-sm space-y-2">
        <p className="flex items-center gap-2 font-medium">
          <Database className="h-4 w-4" />
          How to read this
        </p>
        <ul className="list-disc list-inside space-y-1 text-muted-foreground">
          <li>
            If <strong>All opportunities</strong> is 0: no data at all — RLS
            problem or empty database.
          </li>
          <li>
            If <strong>stage = closed_won</strong> is 0: no won deals in the
            system, so all "won" reports will be empty.
          </li>
          <li>
            If <strong>kind IS NULL</strong> is high: most opps aren't flagged
            as New Business / Renewal, so the New Customers / Lost Customers /
            Renewals reports will look empty. The fix is a backfill — we can
            run SQL to infer kind from the opp name / account history.
          </li>
          <li>
            If <strong>QTD counts</strong> are 0 but underlying counts are
            healthy: the current-quarter filter is excluding all matches. Use
            the "All Time" range in the report or widen the range picker.
          </li>
        </ul>
      </div>
    </div>
  );
}
