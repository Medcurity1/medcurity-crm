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
const ForecastPage = lazy(() =>
  import("@/features/forecasting/ForecastPage").then((m) => ({
    default: m.ForecastPage,
  }))
);
const WinLossAnalysis = lazy(() =>
  import("@/features/analytics/WinLossAnalysis").then((m) => ({
    default: m.WinLossAnalysis,
  }))
);
const DashboardsTab = lazy(() =>
  import("./DashboardsTab").then((m) => ({ default: m.DashboardsTab }))
);
const StandardReports = lazy(() =>
  import("./StandardReports").then((m) => ({ default: m.StandardReports }))
);

const VALID_TABS = ["standard", "reports", "dashboards", "forecasting", "analytics"] as const;
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
        description="Build reports, watch dashboards, run forecasts, and analyze win/loss."
      />

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="standard">Standard</TabsTrigger>
          <TabsTrigger value="reports">Custom Builder</TabsTrigger>
          <TabsTrigger value="dashboards">Dashboards</TabsTrigger>
          <TabsTrigger value="forecasting">Forecasting</TabsTrigger>
          <TabsTrigger value="analytics">Win/Loss</TabsTrigger>
        </TabsList>

        <TabsContent value="standard" className="mt-4">
          <LazyPanel>
            <StandardReports />
          </LazyPanel>
        </TabsContent>

        <TabsContent value="reports" className="mt-4">
          <LazyPanel>
            <ReportBuilder />
          </LazyPanel>
        </TabsContent>

        <TabsContent value="dashboards" className="mt-4">
          <LazyPanel>
            <DashboardsTab />
          </LazyPanel>
        </TabsContent>

        <TabsContent value="forecasting" className="mt-4">
          <LazyPanel>
            <ForecastPage />
          </LazyPanel>
        </TabsContent>

        <TabsContent value="analytics" className="mt-4">
          <LazyPanel>
            <WinLossAnalysis />
          </LazyPanel>
        </TabsContent>
      </Tabs>
    </div>
  );
}
