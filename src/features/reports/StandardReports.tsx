import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
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
  Plus,
  Users,
  Pencil,
  Trash2,
  Share2,
  Play,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { useAuth } from "@/features/auth/AuthProvider";
import type { SavedReport } from "@/types/crm";
import { useSavedReports, useUpdateReport, useDeleteReport } from "./report-api";
import {
  useReportFavorites,
  useToggleFavorite,
  useMigrateLegacyFavorites,
} from "./report-favorites-api";

// ---------------------------------------------------------------------------
// Reports landing — one searchable home for BOTH the prebuilt Standard reports
// and the user's saved/custom reports. Standard cards still Link to their
// bespoke /reports/standard/:slug page (untouched); saved cards open in the
// Custom Builder via ?report=<id>. Favorite (★), share, run from one place.
// The Team Dashboard stays its own ReportsHub tab — never a card here.
// ---------------------------------------------------------------------------

interface StandardCard {
  id: string;
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  apiView: string;
  status: "live" | "coming_soon";
}

// Standard catalog — each id slug maps to a dedicated /reports/standard/:id
// page (App.tsx) and usually a Postgres v_* view. Keep the slug stable.
const REPORTS: StandardCard[] = [
  {
    id: "do-not-email",
    title: "Do Not Email",
    description:
      "Everyone to suppress from marketing — customers, partners, past customers, do-not-contact/do-not-market, and bounced/archived — with a reason column.",
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
      "Accounts whose latest Closed-Won has lapsed. Complements the opp-based Lost Customers report.",
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
      "Consolidated quarterly Revenue / Churn / Rolling 12-month grid with one-click Excel + PDF exports.",
    icon: TrendingUp,
    apiView: "f_financial_saas_metrics_quarterly()",
    status: "live",
  },
];

const ENTITY_LABEL: Record<string, string> = {
  accounts: "Accounts",
  contacts: "Contacts",
  opportunities: "Opportunities",
  activities: "Activities",
  opportunity_products: "Products",
  leads: "Leads",
};

type Chip = "all" | "fav" | "mine" | "shared" | "standard";
const CHIPS: { key: Chip; label: string }[] = [
  { key: "all", label: "All" },
  { key: "fav", label: "Favorites" },
  { key: "mine", label: "My reports" },
  { key: "shared", label: "Shared with me" },
  { key: "standard", label: "Standard" },
];

function StarButton({
  active,
  onToggle,
}: {
  active: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      title={active ? "Remove from favorites" : "Add to favorites"}
      aria-label={active ? "Remove from favorites" : "Add to favorites"}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onToggle();
      }}
      className="shrink-0 p-1 text-muted-foreground hover:text-amber-500"
    >
      <Star className={cn("h-4 w-4", active && "fill-amber-400 text-amber-400")} />
    </button>
  );
}

function StandardCardView({
  r,
  fav,
  onToggleFav,
}: {
  r: StandardCard;
  fav: boolean;
  onToggleFav: () => void;
}) {
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
          <div className="flex items-center gap-1">
            <span className="text-[10px] uppercase tracking-wider font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded">
              {isLive ? "Standard" : "Coming soon"}
            </span>
            <StarButton active={fav} onToggle={onToggleFav} />
          </div>
        </div>
        <div>
          <h3 className="font-semibold text-sm">{r.title}</h3>
          <p className="text-xs text-muted-foreground mt-1 line-clamp-3">{r.description}</p>
        </div>
      </CardContent>
    </Card>
  );
  return isLive ? <Link to={`/reports/standard/${r.id}`}>{inner}</Link> : <div>{inner}</div>;
}

function SavedCardView({
  rep,
  fav,
  isOwner,
  onToggleFav,
  onRun,
  onShareToggle,
  onDelete,
}: {
  rep: SavedReport;
  fav: boolean;
  isOwner: boolean;
  onToggleFav: () => void;
  onRun: () => void;
  onShareToggle: () => void;
  onDelete: () => void;
}) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const entity = ENTITY_LABEL[rep.config?.entity] ?? "Custom";
  const cols = rep.config?.columns?.length ?? 0;
  return (
    <Card className="hover:shadow-md transition-shadow h-full">
      <CardContent className="p-4 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="rounded-md bg-violet-500/10 p-2">
            <FileBarChart className="h-5 w-5 text-violet-600 dark:text-violet-400" />
          </div>
          <div className="flex items-center gap-1">
            {rep.is_shared && (
              <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wider font-medium text-violet-700 dark:text-violet-300 bg-violet-500/10 px-2 py-0.5 rounded">
                <Users className="h-3 w-3" /> Shared
              </span>
            )}
            <StarButton active={fav} onToggle={onToggleFav} />
          </div>
        </div>
        <button type="button" onClick={onRun} className="block text-left w-full">
          <h3 className="font-semibold text-sm hover:underline">{rep.name}</h3>
          <p className="text-xs text-muted-foreground mt-1">
            Custom · {entity}
            {cols ? ` · ${cols} column${cols === 1 ? "" : "s"}` : ""}
            {rep.folder ? ` · ${rep.folder}` : ""}
          </p>
        </button>
        <div className="flex items-center gap-1 pt-1">
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={onRun}>
            <Play className="h-3.5 w-3.5 mr-1" /> Run
          </Button>
          {isOwner && (
            <>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs"
                title={rep.is_shared ? "Unshare from team" : "Share with team"}
                onClick={onShareToggle}
              >
                <Share2 className="h-3.5 w-3.5 mr-1" />
                {rep.is_shared ? "Unshare" : "Share"}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0"
                title="Edit"
                onClick={onRun}
              >
                <Pencil className="h-3.5 w-3.5" />
              </Button>
              <button
                type="button"
                title="Delete report"
                className="h-7 w-7 inline-flex items-center justify-center text-muted-foreground hover:text-destructive"
                onClick={() => setConfirmOpen(true)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </>
          )}
        </div>
      </CardContent>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this report?</AlertDialogTitle>
            <AlertDialogDescription>
              “{rep.name}” will be removed{rep.is_shared ? " for everyone it's shared with" : ""}. This can’t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={onDelete}
            >
              Delete report
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

export function StandardReports() {
  const { user } = useAuth();
  const navigate = useNavigate();
  useMigrateLegacyFavorites();
  const { data: favData } = useReportFavorites();
  const toggleFav = useToggleFavorite();
  const { data: saved } = useSavedReports();
  const updateReport = useUpdateReport();
  const deleteReport = useDeleteReport();

  const favs = useMemo(() => favData ?? new Set<string>(), [favData]);
  const [search, setSearch] = useState("");
  const [chip, setChip] = useState<Chip>("all");

  const q = search.trim().toLowerCase();
  const savedReports = saved ?? [];

  // Which cards survive the active chip + search.
  const standardVisible = useMemo(() => {
    if (chip === "mine" || chip === "shared") return [] as StandardCard[];
    return REPORTS.filter((r) => {
      if (chip === "fav" && !favs.has(`standard:${r.id}`)) return false;
      if (q && !(r.title.toLowerCase().includes(q) || r.description.toLowerCase().includes(q)))
        return false;
      return true;
    });
  }, [chip, favs, q]);

  const savedVisible = useMemo(() => {
    if (chip === "standard") return [] as SavedReport[];
    return savedReports.filter((rep) => {
      const isOwner = rep.owner_user_id === user?.id;
      if (chip === "mine" && !isOwner) return false;
      if (chip === "shared" && !(rep.is_shared && !isOwner)) return false;
      if (chip === "fav" && !favs.has(`saved:${rep.id}`)) return false;
      if (q && !(rep.name.toLowerCase().includes(q) || (ENTITY_LABEL[rep.config?.entity] ?? "").toLowerCase().includes(q)))
        return false;
      return true;
    });
  }, [chip, favs, q, savedReports, user?.id]);

  const totalVisible = standardVisible.length + savedVisible.length;

  return (
    <div className="space-y-4 pt-4">
      {/* Header + New report */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="font-medium">Reports</p>
          <p className="text-sm text-muted-foreground">
            Browse, save, and share. Star the ones you use to pin them up top.
          </p>
        </div>
        <Button size="sm" onClick={() => navigate("/reports?tab=reports")}>
          <Plus className="h-4 w-4 mr-1" /> New report
        </Button>
      </div>

      {/* Search + filter chips */}
      <div className="flex flex-col gap-3">
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search reports..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {CHIPS.map((c) => (
            <button
              key={c.key}
              type="button"
              onClick={() => setChip(c.key)}
              className={cn(
                "text-xs px-3 py-1 rounded-md border transition-colors",
                chip === c.key
                  ? "bg-muted text-foreground border-border"
                  : "text-muted-foreground border-transparent hover:bg-muted/60",
              )}
            >
              {c.label}
            </button>
          ))}
          <Link
            to="/reports/standard/diagnostic"
            className="ml-auto self-center text-xs font-medium text-primary hover:underline"
          >
            Diagnostic →
          </Link>
        </div>
      </div>

      {totalVisible === 0 ? (
        <p className="text-sm text-muted-foreground py-10 text-center">
          {q ? `No reports match "${search}".` : "No reports here yet."}
        </p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {savedVisible.map((rep) => {
            const isOwner = rep.owner_user_id === user?.id;
            return (
              <SavedCardView
                key={`saved-${rep.id}`}
                rep={rep}
                isOwner={isOwner}
                fav={favs.has(`saved:${rep.id}`)}
                onToggleFav={() => {
                  const ref = `saved:${rep.id}`;
                  // Ignore a second click on the SAME star while its toggle is
                  // still in flight — rapid on/off would otherwise race and the
                  // DB could settle to the wrong state.
                  if (toggleFav.isPending && toggleFav.variables?.ref === ref) return;
                  toggleFav.mutate({ ref, on: !favs.has(ref) });
                }}
                onRun={() => navigate(`/reports?tab=reports&report=${rep.id}`)}
                onShareToggle={() =>
                  updateReport.mutate({ id: rep.id, is_shared: !rep.is_shared })
                }
                onDelete={() => deleteReport.mutate(rep.id)}
              />
            );
          })}
          {standardVisible.map((r) => (
            <StandardCardView
              key={`std-${r.id}`}
              r={r}
              fav={favs.has(`standard:${r.id}`)}
              onToggleFav={() => {
                const ref = `standard:${r.id}`;
                if (toggleFav.isPending && toggleFav.variables?.ref === ref) return;
                toggleFav.mutate({ ref, on: !favs.has(ref) });
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
