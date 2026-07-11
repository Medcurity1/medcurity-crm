import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { env } from "@/lib/env";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Server,
  Database,
  Clock,
  Globe,
  Hash,
  Loader2,
  CalendarClock,
} from "lucide-react";

const APP_VERSION = "0.1.0";
const BUILD_DATE = "2026-04-04";
const BUILD_MODE = import.meta.env.MODE;

const CRM_TABLES = [
  "user_profiles",
  "accounts",
  "contacts",
  "leads",
  "opportunities",
  "opportunity_products",
  "activities",
  "products",
  "custom_field_definitions",
  "required_field_config",
  "pipeline_views",
  "saved_reports",
  "audit_logs",
] as const;

interface TableCount {
  table: string;
  count: number;
}

function useTableCounts() {
  return useQuery({
    queryKey: ["system_table_counts"],
    queryFn: async () => {
      const results: TableCount[] = [];

      for (const table of CRM_TABLES) {
        const { count, error } = await supabase
          .from(table)
          .select("*", { count: "exact", head: true });

        results.push({
          table,
          count: error ? -1 : (count ?? 0),
        });
      }

      return results;
    },
    staleTime: 30_000,
  });
}

function useLatestMigration() {
  return useQuery({
    queryKey: ["system_latest_migration"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("schema_migrations" as string)
        .select("version, name")
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error) {
        // schema_migrations may not exist in all setups
        return null;
      }

      return data as { version: string; name: string } | null;
    },
    staleTime: 60_000,
  });
}

interface ScheduledJobStatus {
  jobname: string;
  kind: "sql" | "http";
  required: boolean;
  installed: boolean;
  active: boolean;
  schedule: string | null;
  last_run_at: string | null;
  last_run_status: string | null;
  last_run_message: string | null;
}

function useScheduledJobs() {
  return useQuery({
    queryKey: ["scheduled_jobs_status"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("scheduled_jobs_status");
      if (error) throw error;
      return (data ?? []) as ScheduledJobStatus[];
    },
    staleTime: 30_000,
  });
}

// One glanceable verdict per job. "not on this env" is normal for jobs whose
// URL+key literals are only pasted into production (email sync, ClickUp, …).
function jobHealth(j: ScheduledJobStatus): {
  label: string;
  variant: "default" | "secondary" | "destructive" | "outline";
} {
  if (!j.installed)
    return j.required
      ? { label: "missing", variant: "destructive" }
      : { label: "not on this env", variant: "outline" };
  if (!j.active) return { label: "disabled", variant: "destructive" };
  if (j.last_run_status === "failed") return { label: "failed", variant: "destructive" };
  if (!j.last_run_at) return { label: "waiting for first run", variant: "secondary" };
  return { label: "ok", variant: "default" };
}

function formatTableName(name: string): string {
  return name
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function SystemInfo() {
  const tableCounts = useTableCounts();
  const latestMigration = useLatestMigration();
  const scheduledJobs = useScheduledJobs();

  const supabaseUrl = env.supabaseUrl;
  const projectRef = supabaseUrl.match(
    /https:\/\/([^.]+)\.supabase\.co/
  )?.[1];

  return (
    <div className="space-y-6">
      {/* App Info */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">App Version</CardTitle>
            <Hash className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">v{APP_VERSION}</div>
            <p className="text-xs text-muted-foreground">Pulse</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Build Info</CardTitle>
            <Server className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold capitalize">{BUILD_MODE}</div>
            <p className="text-xs text-muted-foreground">
              Built {BUILD_DATE}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">
              Supabase Project
            </CardTitle>
            <Globe className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-lg font-bold font-mono truncate">
              {projectRef ?? "unknown"}
            </div>
            <p className="text-xs text-muted-foreground truncate">
              {supabaseUrl}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Latest Migration */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">
            Last Migration Applied
          </CardTitle>
          <Clock className="h-4 w-4 text-muted-foreground" />
        </CardHeader>
        <CardContent>
          {latestMigration.isLoading ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : latestMigration.data ? (
            <div>
              <div className="text-sm font-mono">
                {latestMigration.data.version}
              </div>
              <p className="text-xs text-muted-foreground">
                {latestMigration.data.name}
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Migration tracking table not available. Migrations are applied via
              the combined SQL file.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Scheduled background jobs — the watchdog's view, self-serve */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">
            <span className="flex items-center gap-2">
              <CalendarClock className="h-4 w-4 text-muted-foreground" />
              Scheduled Jobs
            </span>
          </CardTitle>
          {scheduledJobs.isLoading && (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          )}
        </CardHeader>
        <CardContent>
          {scheduledJobs.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading job status...</p>
          ) : scheduledJobs.error ? (
            <p className="text-sm text-destructive">
              Failed to load scheduled job status.
            </p>
          ) : (
            <div className="space-y-1.5">
              {scheduledJobs.data?.map((j) => {
                const health = jobHealth(j);
                return (
                  <div
                    key={j.jobname}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border px-3 py-2"
                  >
                    <span className="text-sm font-mono">{j.jobname}</span>
                    {j.schedule && (
                      <span className="text-xs text-muted-foreground font-mono">
                        {j.schedule}
                      </span>
                    )}
                    <span className="ml-auto flex items-center gap-2">
                      {j.last_run_at && (
                        <span className="text-xs text-muted-foreground">
                          last run {new Date(j.last_run_at).toLocaleString()}
                        </span>
                      )}
                      <Badge variant={health.variant}>{health.label}</Badge>
                    </span>
                    {j.last_run_status === "failed" && j.last_run_message && (
                      <p className="w-full text-xs text-destructive">
                        {j.last_run_message}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Database Table Counts */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className="text-sm font-medium">
            <span className="flex items-center gap-2">
              <Database className="h-4 w-4 text-muted-foreground" />
              Database Tables
            </span>
          </CardTitle>
          {tableCounts.isLoading && (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          )}
        </CardHeader>
        <CardContent>
          {tableCounts.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading counts...</p>
          ) : tableCounts.error ? (
            <p className="text-sm text-destructive">
              Failed to load table counts.
            </p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {tableCounts.data?.map((t) => (
                <div
                  key={t.table}
                  className="flex items-center justify-between rounded-md border px-3 py-2"
                >
                  <span className="text-sm">{formatTableName(t.table)}</span>
                  <Badge variant={t.count < 0 ? "destructive" : "secondary"}>
                    {t.count < 0 ? "error" : t.count.toLocaleString()}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
