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

type Check = {
  label: string;
  desc: string;
  count: number | null;
  error: string | null;
};

async function runCheck(
  table: string,
  build: (
    q: ReturnType<typeof supabase.from>,
  ) => ReturnType<typeof supabase.from>,
): Promise<{ count: number | null; error: string | null }> {
  let q = supabase.from(table).select("*", { count: "exact", head: true });
  q = build(q) as typeof q;
  const { count, error } = await q;
  return { count: count ?? null, error: error?.message ?? null };
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

      const checks: Check[] = [];

      // ---------- OPPORTUNITIES ----------
      const specs = [
        {
          label: "All opportunities",
          desc: "total rows in public.opportunities",
          table: "opportunities",
          build: (x) => x,
        },
        {
          label: "  ... archived_at IS NULL",
          desc: "live (non-archived) opps",
          table: "opportunities",
          build: (x) => x.is("archived_at", null),
        },
        {
          label: "  ... stage = closed_won",
          desc: "closed-won opps (live only)",
          table: "opportunities",
          build: (x) => x.is("archived_at", null).eq("stage", "closed_won"),
        },
        {
          label: "  ... stage = closed_lost",
          desc: "closed-lost opps (live only)",
          table: "opportunities",
          build: (x) => x.is("archived_at", null).eq("stage", "closed_lost"),
        },
        {
          label: "  ... kind = new_business",
          desc: "opps flagged as New Business (live only)",
          table: "opportunities",
          build: (x) => x.is("archived_at", null).eq("kind", "new_business"),
        },
        {
          label: "  ... kind = renewal",
          desc: "opps flagged as Existing Business / Renewal (live only)",
          table: "opportunities",
          build: (x) => x.is("archived_at", null).eq("kind", "renewal"),
        },
        {
          label: "  ... kind IS NULL",
          desc: "opps with kind not set (hurts New/Lost/Renewals reports)",
          table: "opportunities",
          build: (x) => x.is("archived_at", null).is("kind", null),
        },
        {
          label: `New Customers QTD (${qStart} → ${qEnd})`,
          desc: "stage=closed_won AND kind=new_business AND close_date in current quarter",
          table: "opportunities",
          build: (x) =>
            x
              .is("archived_at", null)
              .eq("stage", "closed_won")
              .eq("kind", "new_business")
              .gte("close_date", qStart)
              .lte("close_date", qEnd),
        },
        {
          label: `Lost Customers QTD (${qStart} → ${qEnd})`,
          desc: "stage=closed_lost AND kind=renewal AND close_date in current quarter",
          table: "opportunities",
          build: (x) =>
            x
              .is("archived_at", null)
              .eq("stage", "closed_lost")
              .eq("kind", "renewal")
              .gte("close_date", qStart)
              .lte("close_date", qEnd),
        },
        {
          label: `Renewals QTD (${qStart} → ${qEnd})`,
          desc: "stage=closed_won AND kind=renewal AND close_date in current quarter",
          table: "opportunities",
          build: (x) =>
            x
              .is("archived_at", null)
              .eq("stage", "closed_won")
              .eq("kind", "renewal")
              .gte("close_date", qStart)
              .lte("close_date", qEnd),
        },
        // ---------- LEADS ----------
        {
          label: "All leads",
          desc: "total rows in public.leads",
          table: "leads",
          build: (x) => x,
        },
        {
          label: "  ... live (archived_at IS NULL)",
          desc: "non-archived leads",
          table: "leads",
          build: (x) => x.is("archived_at", null),
        },
        {
          label: "  ... mql_date IS NOT NULL",
          desc: "leads that were ever MQL",
          table: "leads",
          build: (x) => x.is("archived_at", null).not("mql_date", "is", null),
        },
        {
          label: `MQL Leads QTD (${qStart} → ${qEnd})`,
          desc: "mql_date in current quarter AND not converted",
          table: "leads",
          build: (x) =>
            x
              .is("archived_at", null)
              .not("mql_date", "is", null)
              .neq("status", "converted")
              .gte("mql_date", qStart)
              .lte("mql_date", qEnd),
        },
        // ---------- CONTACTS ----------
        {
          label: "All contacts",
          desc: "total rows in public.contacts",
          table: "contacts",
          build: (x) => x,
        },
        {
          label: "  ... mql_date IS NOT NULL",
          desc: "contacts that were ever MQL",
          table: "contacts",
          build: (x) => x.is("archived_at", null).not("mql_date", "is", null),
        },
        {
          label: "  ... sql_date IS NOT NULL",
          desc: "contacts that became SQL",
          table: "contacts",
          build: (x) => x.is("archived_at", null).not("sql_date", "is", null),
        },
        {
          label: "MQL Contacts (marketable, not SQL)",
          desc: "mql_date set AND sql_date null AND do_not_contact=false",
          table: "contacts",
          build: (x) =>
            x
              .is("archived_at", null)
              .not("mql_date", "is", null)
              .is("sql_date", null)
              .eq("do_not_contact", false),
        },
      ] as const;

      for (const s of specs) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const res = await runCheck(s.table, s.build as any);
        checks.push({ label: s.label, desc: s.desc, ...res });
      }

      return { checks, qStart, qEnd };
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
            Renewals reports will look empty. The fix is a backfill —
            we can run SQL to infer kind from the opp name / account history.
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
