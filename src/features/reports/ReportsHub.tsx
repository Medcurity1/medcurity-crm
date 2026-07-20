import { lazy, Suspense } from "react";
import { useSearchParams } from "react-router-dom";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader } from "@/components/PageHeader";
import { Skeleton } from "@/components/ui/skeleton";

// Lazy-loaded tab panels so we don't pull in Recharts + big chart bundles
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

const VALID_TABS = [
  "standard",
  "lists",
  "team-dashboard",
  "reports",
] as const;
type TabValue = (typeof VALID_TABS)[number];

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
 * One /reports hub for everything insight-y: reports builder, dashboards,
 * forecasting, win/loss analytics. Brayden 2026-04-17: consolidate so
 * there's a single place to live rather than separate sidebar entries.
 */
export function ReportsHub() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = ((): TabValue => {
    const t = searchParams.get("tab") as TabValue | null;
    // Default to the new Standard Reports catalog — most users land
    // here wanting a curated report, not the custom builder.
    return t && (VALID_TABS as readonly string[]).includes(t) ? t : "standard";
  })();

  const setActiveTab = (tab: string) => {
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("tab", tab);
        return next;
      },
      { replace: true }
    );
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Reports"
        description="Standard reports, your lists, the team dashboard, and a custom report builder."
      />

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="standard">Reports</TabsTrigger>
          {/* Lists live here (Nathan 2026-07-20): reports answer "who
              matches right now", lists are what you curate from them —
              one tab for all of it. */}
          <TabsTrigger value="lists">Lists</TabsTrigger>
          <TabsTrigger value="team-dashboard">Team Dashboard</TabsTrigger>
          <TabsTrigger value="reports">Builder</TabsTrigger>
        </TabsList>

        <TabsContent value="standard" className="mt-4">
          <LazyPanel>
            <StandardReports />
          </LazyPanel>
        </TabsContent>

        <TabsContent value="lists" className="mt-4">
          <LazyPanel>
            <ListsPage />
          </LazyPanel>
        </TabsContent>

        <TabsContent value="team-dashboard" className="mt-4">
          <LazyPanel>
            <TeamDashboard />
          </LazyPanel>
        </TabsContent>

        <TabsContent value="reports" className="mt-4">
          <LazyPanel>
            <ReportBuilder />
          </LazyPanel>
        </TabsContent>
      </Tabs>
    </div>
  );
}
