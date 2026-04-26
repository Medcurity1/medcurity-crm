import { Link } from "react-router-dom";
import {
  DollarSign,
  TrendingUp,
  Users,
  Target,
  Activity,
  RefreshCw,
  FileBarChart,
  UserCheck,
  UserPlus,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Standard Reports catalog — Medcurity's Salesforce-aligned reports.
 *
 * Every card here maps to a dedicated page at /reports/standard/:id
 * and a Postgres view v_* that external tools (e.g. the financial
 * spreadsheet) can query directly via the Supabase REST API:
 *
 *   GET https://<ref>.supabase.co/rest/v1/<view_name>?select=*
 */

interface ReportCard {
  id: string;
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  apiView: string;
  status: "live" | "coming_soon";
}

const REPORTS: ReportCard[] = [
  {
    id: "arr-base-dataset",
    title: "ARR Base Dataset",
    description:
      "All ARR-relevant opportunities with the full SF column set. Drives the financial model export.",
    icon: DollarSign,
    apiView: "v_arr_base_dataset",
    status: "live",
  },
  {
    id: "new-customers",
    title: "New Customers",
    description:
      "New Business closed-won this fiscal quarter. SF columns: Owner, Account, Opp, Type, Amount, Close, Lead Source.",
    icon: UserPlus,
    apiView: "v_new_customers_qtd",
    status: "live",
  },
  {
    id: "lost-customers",
    title: "Lost Customers",
    description:
      "Existing Business closed-lost this quarter on inactive accounts. Full SF column set including Next Step + Probability.",
    icon: TrendingUp,
    apiView: "v_lost_customers_qtd",
    status: "live",
  },
  {
    id: "active-pipeline",
    title: "Active Pipeline",
    description:
      "All open opportunities grouped by Stage → Type. SF columns: Opp, Account, Close Date, Amount, Owner.",
    icon: Activity,
    apiView: "v_active_pipeline",
    status: "live",
  },
  {
    id: "renewals",
    title: "Renewals",
    description:
      "Existing Business closed-won this fiscal quarter (excl. EHR Implementation). Grouped by Type with Owner Role + Fiscal Period.",
    icon: RefreshCw,
    apiView: "v_renewals_qtd",
    status: "live",
  },
  {
    id: "sql",
    title: "SQL (Accounts)",
    description:
      "Contacts qualified as SQL, grouped by account. Feeds the SQL running-total dashboard metric.",
    icon: UserCheck,
    apiView: "v_sql_accounts",
    status: "live",
  },
  {
    id: "mql-contacts",
    title: "MQL (Contacts)",
    description:
      "Marketable contacts with MQL date but not yet SQL. Excludes do_not_contact.",
    icon: Target,
    apiView: "v_mql_contacts",
    status: "live",
  },
  {
    id: "mql-leads",
    title: "MQL (Leads)",
    description:
      "Leads with MQL date this fiscal quarter, not yet converted. Grouped by Lead Source.",
    icon: Users,
    apiView: "v_mql_leads_qtd",
    status: "live",
  },
  {
    id: "dashboard-metrics",
    title: "Dashboard Metrics",
    description:
      "Single-row scalar summary: ARR, New Customers QTD, NRR (legacy + true), pipeline, churn. Powers the Team Dashboard.",
    icon: FileBarChart,
    apiView: "v_dashboard_metrics",
    status: "live",
  },
];

export function StandardReports() {
  return (
    <div className="space-y-4 pt-4">
      <div className="rounded-md border bg-muted/30 p-4 text-sm flex items-start justify-between gap-4">
        <div>
          <p className="font-medium mb-1">Standard Reports</p>
          <p className="text-muted-foreground">
            Pre-built reports aligned column-for-column with the legacy Salesforce reports.
            Each report is also available as a Supabase REST view for the financial spreadsheet
            (see API column on each card).
          </p>
        </div>
        <Link
          to="/reports/standard/diagnostic"
          className="shrink-0 text-xs font-medium text-primary hover:underline"
        >
          Diagnostic →
        </Link>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {REPORTS.map((r) => {
          const Icon = r.icon;
          const isLive = r.status === "live";
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
                  <p className="text-[10px] font-mono text-muted-foreground/70 mt-2">
                    /rest/v1/{r.apiView}
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
