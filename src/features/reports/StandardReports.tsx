import { Link } from "react-router-dom";
import {
  DollarSign,
  TrendingUp,
  Users,
  Target,
  Activity,
  RefreshCw,
  FileBarChart,
  Percent,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Standard Reports catalog — Medcurity-specific pre-built reports
 * that don't need custom SQL to run. Each card links to a dedicated
 * page (live query + chart + CSV export) under /reports/standard/:id.
 *
 * This is the "curated" counterpart to the Reports tab's custom
 * ReportBuilder. Brayden's old SF reports folder had 43 reports,
 * only 17 actively used; we rebuild those 17 here rather than
 * replicating the whole mess.
 */

interface ReportCard {
  id: string;
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  status: "live" | "coming_soon";
}

const REPORTS: ReportCard[] = [
  {
    id: "arr-rolling-365",
    title: "ARR (Rolling 365 Days)",
    description:
      "Annual recurring revenue from closed-won opportunities in the trailing 365 days. Exports to match the financial spreadsheet format.",
    icon: DollarSign,
    status: "live",
  },
  {
    id: "mql-sql-counts",
    title: "MQL & SQL Counts",
    description:
      "Monthly MQL / SQL counts with dedup logic so a lead that converted to a contact doesn't get double-counted.",
    icon: Target,
    status: "live",
  },
  {
    id: "new-customers-by-period",
    title: "New Customers by Period",
    description:
      "New customer count per month / quarter / year. Counts all 5 business_type values (new, expansion, existing, opportunity, new_service).",
    icon: Users,
    status: "coming_soon",
  },
  {
    id: "lost-clients",
    title: "Lost Clients",
    description:
      "Accounts that moved to inactive / churned in a given period, with last closed-won ARR and churn date.",
    icon: TrendingUp,
    status: "coming_soon",
  },
  {
    id: "active-pipeline",
    title: "Active Pipeline",
    description:
      "Open opportunities by stage + owner, weighted by probability.",
    icon: Activity,
    status: "live",
  },
  {
    id: "renewals-queue",
    title: "Renewals Queue",
    description:
      "Upcoming renewals in the next 120 days, with ARR, owner, and last-contact activity.",
    icon: RefreshCw,
    status: "live",
  },
  {
    id: "nrr",
    title: "NRR (Net Revenue Retention)",
    description:
      "1 − churn % by period. Matches the legacy financial-spreadsheet formula.",
    icon: Percent,
    status: "coming_soon",
  },
  {
    id: "4q-revenue",
    title: "4Q Revenue",
    description:
      "Rolling 4-quarter revenue (closed-won sum per quarter) for trending charts.",
    icon: FileBarChart,
    status: "coming_soon",
  },
];

export function StandardReports() {
  return (
    <div className="space-y-4 pt-4">
      <div className="text-sm text-muted-foreground">
        Pre-built reports tuned for Medcurity's financial + pipeline workflows. Click into one to see live data with filters + CSV export.
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {REPORTS.map((r) => {
          const Icon = r.icon;
          const isLive = r.status === "live";
          // Non-live cards render as disabled placeholders with a
          // "Coming soon" pill so the user knows the reports are
          // on the roadmap without clicking into a 404.
          const inner = (
            <Card
              className={
                isLive
                  ? "hover:shadow-md transition-shadow cursor-pointer h-full"
                  : "opacity-60 h-full"
              }
            >
              <CardContent className="p-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="rounded-md bg-primary/10 p-2">
                    <Icon className="h-5 w-5 text-primary" />
                  </div>
                  {!isLive && (
                    <span className="text-[10px] uppercase tracking-wider font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded">
                      Coming soon
                    </span>
                  )}
                </div>
                <div>
                  <h3 className="font-semibold text-sm">{r.title}</h3>
                  <p className="text-xs text-muted-foreground mt-1">
                    {r.description}
                  </p>
                </div>
              </CardContent>
            </Card>
          );
          return isLive ? (
            <Link key={r.id} to={`/reports/standard/${r.id}`}>
              {inner}
            </Link>
          ) : (
            <div key={r.id}>{inner}</div>
          );
        })}
      </div>
    </div>
  );
}
