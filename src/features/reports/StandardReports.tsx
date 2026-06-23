import { useState } from "react";
import { Link } from "react-router-dom";
import {
  DollarSign,
  TrendingUp,
  Target,
  Activity,
  RefreshCw,
  FileBarChart,
  UserCheck,
  UserPlus,
  UserMinus,
  Search,
  Star,
  ShieldX,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// Per-user favorites live in localStorage (same lightweight personalization
// the dashboard widgets use) — favoriting a report pins it to the top so the
// "which of these cards do I want" hunt goes away.
const FAV_KEY = "report_favorites";
function loadFavorites(): Set<string> {
  try {
    const raw = localStorage.getItem(FAV_KEY);
    if (raw) return new Set(JSON.parse(raw) as string[]);
  } catch {
    // ignore
  }
  return new Set();
}
function saveFavorites(favs: Set<string>) {
  localStorage.setItem(FAV_KEY, JSON.stringify([...favs]));
}

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
    id: "do-not-email",
    title: "Do Not Email",
    description:
      "Everyone to suppress from marketing — customers, partners, past customers, do-not-contact/do-not-market, and bounced/archived — with a reason column. Filter to one category or export the master list and subtract it from any campaign.",
    icon: ShieldX,
    apiView: "v_marketing_suppression",
    status: "live",
  },
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
  // "MQL (Leads)" report retired 2026-06-16 (Nathan): qualification is a
  // Contact concept now, not an Import one. The contact-based "MQL
  // (Contacts)" report above (v_mql_contacts) is the replacement.
  {
    id: "arpc-by-quarter",
    title: "Average Revenue Per Customer",
    description:
      "Closed-won revenue ÷ distinct customers in the same quarter. Includes an 8-quarter historical view for the team dashboard.",
    icon: DollarSign,
    apiView: "—",
    status: "live",
  },
  {
    id: "lost-customers-account",
    title: "Lost Customers (Account-based)",
    description:
      "Accounts whose latest Closed-Won has lapsed — maturity date past, or close date older than 365 days when no maturity is set. Complements the opp-based Lost Customers report.",
    icon: UserMinus,
    apiView: "—",
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
  {
    id: "financial-saas-metrics",
    title: "Financial & SaaS Metrics",
    description:
      "Consolidated quarterly Revenue / Churn / Rolling 12-month grid. Mirrors the legacy financial spreadsheet's Summary sheet, with one-click Excel (Summary + Raw Data + Definitions tabs) and PDF exports.",
    icon: TrendingUp,
    apiView: "f_financial_saas_metrics_quarterly()",
    status: "live",
  },
];

function ReportCardView({
  r,
  isFavorite,
  onToggleFavorite,
}: {
  r: ReportCard;
  isFavorite: boolean;
  onToggleFavorite: (id: string) => void;
}) {
  const Icon = r.icon;
  const isLive = r.status === "live";
  const star = (
    <button
      type="button"
      title={isFavorite ? "Remove from favorites" : "Add to favorites"}
      aria-label={isFavorite ? "Remove from favorites" : "Add to favorites"}
      onClick={(e) => {
        // Inside a Link — don't navigate when toggling the star.
        e.preventDefault();
        e.stopPropagation();
        onToggleFavorite(r.id);
      }}
      className="shrink-0 p-1 text-muted-foreground hover:text-amber-500"
    >
      <Star
        className={cn(
          "h-4 w-4",
          isFavorite && "fill-amber-400 text-amber-400",
        )}
      />
    </button>
  );
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
          <div className="flex items-center gap-1">
            {!isLive && (
              <span className="text-[10px] uppercase tracking-wider font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded">
                Coming soon
              </span>
            )}
            {star}
          </div>
        </div>
        <div>
          <h3 className="font-semibold text-sm">{r.title}</h3>
          <p className="text-xs text-muted-foreground mt-1">{r.description}</p>
          <p className="text-[10px] font-mono text-muted-foreground/70 mt-2">
            /rest/v1/{r.apiView}
          </p>
        </div>
      </CardContent>
    </Card>
  );
  return isLive ? (
    <Link to={`/reports/standard/${r.id}`}>{inner}</Link>
  ) : (
    <div>{inner}</div>
  );
}

export function StandardReports() {
  const [search, setSearch] = useState("");
  const [favorites, setFavorites] = useState<Set<string>>(loadFavorites);

  const toggleFavorite = (id: string) => {
    setFavorites((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      saveFavorites(next);
      return next;
    });
  };

  const q = search.trim().toLowerCase();
  const matches = q
    ? REPORTS.filter(
        (r) =>
          r.title.toLowerCase().includes(q) ||
          r.description.toLowerCase().includes(q),
      )
    : REPORTS;
  const favs = matches.filter((r) => favorites.has(r.id));
  const rest = matches.filter((r) => !favorites.has(r.id));

  return (
    <div className="space-y-4 pt-4">
      <div className="rounded-md border bg-muted/30 p-4 text-sm flex items-start justify-between gap-4">
        <div>
          <p className="font-medium mb-1">Standard Reports</p>
          <p className="text-muted-foreground">
            Pre-built reports aligned column-for-column with the legacy Salesforce reports.
            Each report is also available as a Supabase REST view for the financial spreadsheet
            (see API column on each card). Star the ones you use to pin them up top.
          </p>
        </div>
        <Link
          to="/reports/standard/diagnostic"
          className="shrink-0 text-xs font-medium text-primary hover:underline"
        >
          Diagnostic →
        </Link>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search reports..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {matches.length === 0 ? (
        <p className="text-sm text-muted-foreground py-8 text-center">
          No reports match "{search}".
        </p>
      ) : (
        <>
          {favs.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Favorites
              </p>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {favs.map((r) => (
                  <ReportCardView
                    key={r.id}
                    r={r}
                    isFavorite
                    onToggleFavorite={toggleFavorite}
                  />
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {rest.map((r) => (
              <ReportCardView
                key={r.id}
                r={r}
                isFavorite={false}
                onToggleFavorite={toggleFavorite}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
