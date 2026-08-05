import { lazy, Suspense } from "react";
import { useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  BarChart3,
  ChevronRight,
  LayoutDashboard,
  LibraryBig,
  ListChecks,
  Plus,
  SlidersHorizontal,
  Sparkles,
  UserSearch,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  useLeadLists,
  useLeadListMemberCount,
} from "@/features/lead-lists/lead-lists-api";

// Lazy-loaded panels so we don't pull in Recharts + big chart bundles
// on routes that don't need them.
const ReportBuilder = lazy(() =>
  import("./ReportBuilder").then((m) => ({ default: m.ReportBuilder }))
);
const StandardReports = lazy(() =>
  import("./StandardReports").then((m) => ({ default: m.StandardReports }))
);
const TeamDashboard = lazy(() =>
  import("./TeamDashboard").then((m) => ({ default: m.TeamDashboard }))
);
const ListsPage = lazy(() =>
  import("@/features/lead-lists/ListsPage").then((m) => ({ default: m.ListsPage }))
);

function LazyPanel({ children }: { children: React.ReactNode }) {
  return (
    <Suspense
      fallback={
        <div className="space-y-4 pt-4">
          <Skeleton className="h-10 w-48" />
          <Skeleton className="h-64 w-full" />
        </div>
      }
    >
      {children}
    </Suspense>
  );
}

/**
 * /reports = two jobs under one roof (Nathan 2026-08-04 restructure):
 *
 *   INSIGHTS - numbers you check: the report catalog, the team dashboard,
 *   and Custom report (the full builder engine, any entity).
 *   LISTS - people you work: the lists workspace plus Pull people (the
 *   same builder engine scoped to contacts/accounts so every result can
 *   become a list).
 *
 * The landing is a two-card front door that explains itself by layout.
 * Legacy deep links keep working: ?tab=standard -> insights catalog,
 * ?tab=team-dashboard -> insights team view, ?tab=reports (old Builder)
 * -> insights custom view, ?tab=lists (+&list=) unchanged.
 */

type Zone = "home" | "insights" | "lists";
type InsightsView = "catalog" | "team" | "custom";
type ListsView = "browse" | "pull";

function resolve(params: URLSearchParams): {
  zone: Zone;
  insightsView: InsightsView;
  listsView: ListsView;
} {
  const tab = params.get("tab");
  const view = params.get("view");
  // Legacy tab values from the four-tab era
  if (tab === "standard") return { zone: "insights", insightsView: "catalog", listsView: "browse" };
  if (tab === "team-dashboard") return { zone: "insights", insightsView: "team", listsView: "browse" };
  if (tab === "reports") return { zone: "insights", insightsView: "custom", listsView: "browse" };
  if (tab === "insights") {
    const v: InsightsView = view === "team" ? "team" : view === "custom" ? "custom" : "catalog";
    return { zone: "insights", insightsView: v, listsView: "browse" };
  }
  if (tab === "lists") {
    return { zone: "lists", insightsView: "catalog", listsView: view === "pull" ? "pull" : "browse" };
  }
  return { zone: "home", insightsView: "catalog", listsView: "browse" };
}

export function ReportsHub() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { zone, insightsView, listsView } = resolve(searchParams);

  const go = (tab: string, view?: string) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (tab === "home") {
          next.delete("tab");
        } else {
          next.set("tab", tab);
        }
        if (view) next.set("view", view);
        else next.delete("view");
        next.delete("list");
        return next;
      },
      { replace: true },
    );
  };

  const openList = (id: string) => {
    setSearchParams(
      () => {
        const next = new URLSearchParams();
        next.set("tab", "lists");
        next.set("list", id);
        return next;
      },
      { replace: true },
    );
  };

  if (zone === "home") {
    // No page H1: the top bar already says Reports, the cards do the rest.
    return <HubHome onGo={go} onOpenList={openList} />;
  }

  if (zone === "insights") {
    return (
      <div className="space-y-4">
        <ZoneBar
          onHome={() => go("home")}
          icon={<BarChart3 className="h-4 w-4 text-emerald-500" />}
          title="Insights"
          right={
            <div className="flex gap-1 rounded-lg border p-0.5">
              {(
                [
                  ["catalog", "Catalog", LibraryBig],
                  ["team", "Team dashboard", LayoutDashboard],
                  ["custom", "Custom report", SlidersHorizontal],
                ] as const
              ).map(([v, label, Icon]) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => go("insights", v)}
                  className={cn(
                    "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-sm transition-colors",
                    insightsView === v
                      ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 font-medium"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                </button>
              ))}
            </div>
          }
        />
        <LazyPanel>
          {insightsView === "catalog" && <StandardReports />}
          {insightsView === "team" && <TeamDashboard />}
          {insightsView === "custom" && <ReportBuilder mode="full" />}
        </LazyPanel>
      </div>
    );
  }

  // Lists zone
  return (
    <div className="space-y-4">
      <ZoneBar
        onHome={() => go("home")}
        icon={<ListChecks className="h-4 w-4 text-sky-500" />}
        title={listsView === "pull" ? "Pull people" : "Lists"}
        right={
          listsView === "pull" ? (
            <Button variant="outline" size="sm" onClick={() => go("lists")}>
              <ListChecks className="h-4 w-4 mr-1" />
              Back to lists
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={() => go("lists", "pull")}>
              <UserSearch className="h-4 w-4 mr-1" />
              Pull people
            </Button>
          )
        }
      />
      <LazyPanel>
        {listsView === "pull" ? <ReportBuilder mode="people" /> : <ListsPage />}
      </LazyPanel>
    </div>
  );
}

function ZoneBar({
  onHome,
  icon,
  title,
  right,
}: {
  onHome: () => void;
  icon: React.ReactNode;
  title: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={onHome}
        className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" />
        Reports
      </button>
      <span className="text-muted-foreground/40">/</span>
      <span className="flex items-center gap-1.5 font-semibold">
        {icon}
        {title}
      </span>
      <div className="ml-auto">{right}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The front door: two cards that explain themselves by what they contain.
// ---------------------------------------------------------------------------

function HubHome({
  onGo,
  onOpenList,
}: {
  onGo: (tab: string, view?: string) => void;
  onOpenList: (id: string) => void;
}) {
  const { data: lists } = useLeadLists();
  const { data: counts } = useLeadListMemberCount();
  // Three live numbers so the numbers zone shows numbers before any click.
  const { data: kpi } = useQuery({
    queryKey: ["reports-hub-kpis"],
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const monthStart = new Date();
      monthStart.setDate(1);
      const [open, mql] = await Promise.all([
        supabase
          .from("opportunities")
          .select("amount")
          .not("stage", "in", "(closed_won,closed_lost)")
          .is("archived_at", null),
        supabase
          .from("contacts")
          .select("id", { count: "exact", head: true })
          .gte("mql_date", monthStart.toISOString().slice(0, 10)),
      ]);
      const amounts = open.data ?? [];
      return {
        openCount: amounts.length,
        openSum: amounts.reduce((s, r) => s + (r.amount ?? 0), 0),
        mql: mql.count ?? 0,
      };
    },
  });
  const money = (n: number) =>
    n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}M` : `$${Math.round(n / 1000)}k`;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 pt-1">
      {/* INSIGHTS */}
      <section className="flex flex-col overflow-hidden rounded-2xl border bg-card shadow-sm">
        <button
          type="button"
          onClick={() => onGo("insights")}
          className="group relative px-5 pb-4 pt-5 text-left"
        >
          <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-emerald-400 via-teal-500 to-cyan-500" />
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-emerald-500/20 to-teal-500/[0.06]">
              <BarChart3 className="h-5 w-5 text-emerald-500" />
            </span>
            <div>
              <h2 className="text-lg font-semibold leading-tight">Insights</h2>
              <p className="text-sm text-muted-foreground">How the business is doing</p>
            </div>
            <ChevronRight className="ml-auto h-5 w-5 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5" />
          </div>
        </button>
        <div className="mb-2 grid grid-cols-3 gap-2 px-5">
          {(
            [
              [kpi ? money(kpi.openSum) : "...", "Open pipeline"],
              [kpi ? String(kpi.openCount) : "...", "Open deals"],
              [kpi ? String(kpi.mql) : "...", "MQLs this month"],
            ] as const
          ).map(([value, label]) => (
            <div key={label} className="rounded-xl border bg-muted/30 px-3 py-2.5">
              <p className="text-lg font-semibold leading-tight tabular-nums">{value}</p>
              <p className="text-[11px] text-muted-foreground">{label}</p>
            </div>
          ))}
        </div>
        <div className="flex-1 space-y-1 px-3 pb-4">
          {(
            [
              ["catalog", LibraryBig, "Report catalog", "Financial, pipeline, marketing, renewals"],
              ["team", LayoutDashboard, "Team dashboard", "The whole team at a glance"],
              ["custom", SlidersHorizontal, "Custom report", "Build one over any data"],
            ] as const
          ).map(([view, Icon, label, sub]) => (
            <button
              key={view}
              type="button"
              onClick={() => onGo("insights", view)}
              className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2.5 text-left transition-colors hover:bg-muted"
            >
              <Icon className="h-4 w-4 shrink-0 text-emerald-500/80" />
              <span className="min-w-0">
                <span className="block text-sm font-medium leading-tight">{label}</span>
                <span className="block truncate text-xs text-muted-foreground">{sub}</span>
              </span>
              <ChevronRight className="ml-auto h-4 w-4 shrink-0 text-muted-foreground/40" />
            </button>
          ))}
        </div>
      </section>

      {/* LISTS */}
      <section className="flex flex-col overflow-hidden rounded-2xl border bg-card shadow-sm">
        <button
          type="button"
          onClick={() => onGo("lists")}
          className="group relative px-5 pb-4 pt-5 text-left"
        >
          <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-sky-400 via-blue-500 to-indigo-500" />
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-gradient-to-br from-sky-500/20 to-blue-500/[0.06]">
              <ListChecks className="h-5 w-5 text-sky-500" />
            </span>
            <div>
              <h2 className="text-lg font-semibold leading-tight">Lists</h2>
              <p className="text-sm text-muted-foreground">Who you're reaching out to</p>
            </div>
            <ChevronRight className="ml-auto h-5 w-5 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5" />
          </div>
        </button>
        <div className="flex-1 px-3 pb-4">
          <div className="mb-2 flex gap-2 px-2">
            <Button variant="outline" size="sm" className="h-8" onClick={() => onGo("lists")}>
              <Plus className="h-3.5 w-3.5 mr-1" />
              New list
            </Button>
            <Button variant="outline" size="sm" className="h-8" onClick={() => onGo("lists", "pull")}>
              <UserSearch className="h-3.5 w-3.5 mr-1" />
              Pull people
            </Button>
          </div>
          <div className="space-y-0.5">
            {(lists ?? []).slice(0, 5).map((l) => (
              <button
                key={l.id}
                type="button"
                onClick={() => onOpenList(l.id)}
                className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-muted"
              >
                {l.is_dynamic ? (
                  <Sparkles className="h-4 w-4 shrink-0 text-violet-500" />
                ) : (
                  <ListChecks className="h-4 w-4 shrink-0 text-sky-500" />
                )}
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{l.name}</span>
                {l.is_working_list && (
                  <Badge variant="outline" className="text-[10px] text-amber-600 dark:text-amber-400 border-amber-500/40">
                    Call list
                  </Badge>
                )}
                <span className="text-xs tabular-nums text-muted-foreground">
                  {counts?.[l.id] ?? 0}
                </span>
              </button>
            ))}
            {lists && lists.length > 5 && (
              <button
                type="button"
                onClick={() => onGo("lists")}
                className="flex w-full items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground"
              >
                All {lists.length} lists
                <ChevronRight className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
