// clickup-services-sync Edge Function
//
// Replaces the Services-section logic from the external Python team
// dashboard (`Team Dashboard/dashboard_metrics.py`,
// `compute_services_from_clickup`).
//
// Walks every task on the configured ClickUp services list, computes
// quarter-bounded metrics (active projects, closed-this-quarter, avg close
// days, status breakdown, red-flagged projects), and writes one summary
// row to `public.clickup_services_snapshots`. The Team Dashboard reads
// the latest snapshot.
//
// Deploy:
//   supabase functions deploy clickup-services-sync --no-verify-jwt
//
// Required secrets:
//   CLICKUP_API_TOKEN            - ClickUp personal API token (already set
//                                  for clickup-sf-id-sync)
//   CLICKUP_LIST_ID              - the services list (already set for
//                                  clickup-sf-id-sync; same list)
//   CLICKUP_RED_ITEMS_FIELD      - optional. Custom field name whose
//                                  numeric value, when above
//                                  CLICKUP_RED_ITEMS_THRESHOLD, flags a
//                                  project as "at risk".
//   CLICKUP_RED_ITEMS_THRESHOLD  - optional integer (default 3).
//   SUPABASE_URL                 - provided by Edge runtime
//   SUPABASE_SERVICE_ROLE_KEY    - provided by Edge runtime
//
// Schedule: pg_cron daily — see migration
// `20260511000003_clickup_services_snapshots.sql`.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ClickUpCustomField {
  id: string;
  name?: string;
  value?: unknown;
}

interface ClickUpStatus {
  status?: string;
}

interface ClickUpTask {
  id: string;
  name?: string;
  status?: ClickUpStatus;
  date_created?: string;
  date_closed?: string | null;
  custom_fields?: ClickUpCustomField[];
}

interface StatusBreakdownEntry {
  status: string;
  count: number;
}

interface RedFlaggedProject {
  project: string;
  red_items: number;
}

interface ServicesSnapshot {
  quarter_label: string;
  task_count: number;
  active_projects: number;
  closed_projects_this_quarter: number;
  closed_projects_sra_final_quarter: number;
  avg_project_close_days_qtd: number;
  close_day_sample_count: number;
  overall_project_status: "green" | "red";
  red_item_threshold: number | null;
  projects_over_red_threshold: RedFlaggedProject[];
  status_breakdown: StatusBreakdownEntry[];
  closed_projects_quarter_names: string[];
  sra_final_quarter_names: string[];
  error_message: string | null;
}

// ---------------------------------------------------------------------------
// Defaults — mirror Team Dashboard/dashboard_config.template.json
// ---------------------------------------------------------------------------

const DEFAULT_CLOSED_STATUSES = new Set([
  "complete",
  "completed",
  "closed",
  "done",
  "cancelled",
  "canceled",
]);

const KICKOFF_FIELD_NAMES = new Set([
  "sra kickoff",
  "sra kickoff (sra)",
  "sra kickoff date",
  "kickoff date",
]);

const SRA_FINAL_FIELD_NAMES = new Set([
  "present final sra report",
  "present final sra report (sra)",
]);

// ---------------------------------------------------------------------------
// Quarter math
// ---------------------------------------------------------------------------

function quarterBounds(d: Date): { start: Date; endExclusive: Date; label: string } {
  const year = d.getUTCFullYear();
  const q = Math.floor(d.getUTCMonth() / 3); // 0..3
  const start = new Date(Date.UTC(year, q * 3, 1));
  const endExclusive = new Date(Date.UTC(year, q * 3 + 3, 1));
  return { start, endExclusive, label: `Q${q + 1}-${year}` };
}

function withinQuarter(d: Date, start: Date, endExclusive: Date): boolean {
  return d >= start && d < endExclusive;
}

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

function parseEpochMs(raw: unknown): Date | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const n = typeof raw === "number" ? raw : Number(String(raw));
  if (!Number.isFinite(n) || n <= 0) return null;
  // ClickUp returns epoch milliseconds as strings.
  return new Date(n);
}

function parseNumber(raw: unknown): number {
  if (raw === null || raw === undefined || raw === "") return 0;
  const n = typeof raw === "number" ? raw : Number(String(raw));
  return Number.isFinite(n) ? n : 0;
}

function displayStatus(raw: unknown): string {
  const s = String(raw ?? "").trim();
  if (!s) return "Unknown";
  return s
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function getCustomFieldByNames(
  task: ClickUpTask,
  names: Set<string>,
): ClickUpCustomField | undefined {
  for (const f of task.custom_fields ?? []) {
    const fname = String(f.name ?? "").trim().toLowerCase();
    if (names.has(fname)) return f;
  }
  return undefined;
}

function getCustomFieldByKeyOrName(
  task: ClickUpTask,
  keyOrName: string,
): ClickUpCustomField | undefined {
  const needle = keyOrName.trim().toLowerCase();
  if (!needle) return undefined;
  for (const f of task.custom_fields ?? []) {
    const fid = String(f.id ?? "").trim().toLowerCase();
    const fname = String(f.name ?? "").trim().toLowerCase();
    if (fid === needle || fname === needle) return f;
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// ClickUp API
// ---------------------------------------------------------------------------

const CLICKUP_BASE = "https://api.clickup.com/api/v2";

async function fetchAllTasks(listId: string, token: string): Promise<ClickUpTask[]> {
  const out: ClickUpTask[] = [];
  let page = 0;
  while (true) {
    const url = `${CLICKUP_BASE}/list/${listId}/task?include_closed=true&subtasks=true&page=${page}`;
    const res = await fetch(url, {
      headers: { Authorization: token, "Content-Type": "application/json" },
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`ClickUp GET list failed: ${res.status} ${text.slice(0, 300)}`);
    }
    const data = (await res.json()) as { tasks?: ClickUpTask[]; last_page?: boolean };
    const tasks = Array.isArray(data.tasks) ? data.tasks : [];
    out.push(...tasks);
    if (data.last_page === true || tasks.length === 0) break;
    page += 1;
    if (page > 200) break;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Metric computation
// ---------------------------------------------------------------------------

function computeMetrics(tasks: ClickUpTask[], opts: {
  redField: string;
  redThreshold: number;
}): ServicesSnapshot {
  const today = new Date();
  const { start, endExclusive, label } = quarterBounds(today);

  let activeCount = 0;
  let closedThisQuarter = 0;
  let sraFinalThisQuarter = 0;
  const closedNames = new Set<string>();
  const sraFinalNames = new Set<string>();
  const closeDays: number[] = [];
  const statusCounts = new Map<string, number>();
  const redFlagged: RedFlaggedProject[] = [];

  for (const task of tasks) {
    const statusRaw = String(task.status?.status ?? "").trim().toLowerCase();
    const display = displayStatus(statusRaw);
    statusCounts.set(display, (statusCounts.get(display) ?? 0) + 1);
    const isClosed = DEFAULT_CLOSED_STATUSES.has(statusRaw);
    if (!isClosed) activeCount += 1;

    const createdAt = parseEpochMs(task.date_created);
    const closedAt = parseEpochMs(task.date_closed);

    // Closed within current quarter (by status + date_closed).
    if (isClosed && closedAt && withinQuarter(closedAt, start, endExclusive)) {
      closedThisQuarter += 1;
      const name = String(task.name ?? "").trim();
      if (name) closedNames.add(name);
      const kickoffField = getCustomFieldByNames(task, KICKOFF_FIELD_NAMES);
      const kickoffAt = kickoffField ? parseEpochMs(kickoffField.value) : null;
      const startAt = kickoffAt ?? createdAt;
      if (startAt && closedAt.getTime() >= startAt.getTime()) {
        closeDays.push((closedAt.getTime() - startAt.getTime()) / 86_400_000);
      }
    }

    // Closed-by-SRA-Final-date this quarter (independent signal — teams
    // sometimes close work without transitioning task status).
    const sraField = getCustomFieldByNames(task, SRA_FINAL_FIELD_NAMES);
    const sraFinalAt = sraField ? parseEpochMs(sraField.value) : null;
    if (sraFinalAt && withinQuarter(sraFinalAt, start, endExclusive)) {
      sraFinalThisQuarter += 1;
      const name = String(task.name ?? "").trim();
      if (name) sraFinalNames.add(name);
    }

    // Red items.
    if (opts.redField) {
      const f = getCustomFieldByKeyOrName(task, opts.redField);
      const val = f ? parseNumber(f.value) : 0;
      if (val > opts.redThreshold) {
        redFlagged.push({
          project: String(task.name ?? ""),
          red_items: val,
        });
      }
    }
  }

  const avg = closeDays.length
    ? closeDays.reduce((a, b) => a + b, 0) / closeDays.length
    : 0;

  const breakdown: StatusBreakdownEntry[] = [...statusCounts.entries()]
    .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))
    .map(([status, count]) => ({ status, count }));

  return {
    quarter_label: label,
    task_count: tasks.length,
    active_projects: activeCount,
    closed_projects_this_quarter: closedThisQuarter,
    closed_projects_sra_final_quarter: sraFinalThisQuarter,
    avg_project_close_days_qtd: Math.round(avg * 100) / 100,
    close_day_sample_count: closeDays.length,
    overall_project_status: redFlagged.length > 0 ? "red" : "green",
    red_item_threshold: opts.redField ? opts.redThreshold : null,
    projects_over_red_threshold: redFlagged,
    status_breakdown: breakdown,
    closed_projects_quarter_names: [...closedNames].sort(),
    sra_final_quarter_names: [...sraFinalNames].sort(),
    error_message: null,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function runSync(): Promise<ServicesSnapshot> {
  const token = Deno.env.get("CLICKUP_API_TOKEN") ?? "";
  const listId = Deno.env.get("CLICKUP_LIST_ID") ?? "";
  const redField = (Deno.env.get("CLICKUP_RED_ITEMS_FIELD") ?? "").trim();
  const redThreshold = Number(Deno.env.get("CLICKUP_RED_ITEMS_THRESHOLD") ?? "3") || 3;
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  if (!token || !listId) {
    const empty = computeMetrics([], { redField, redThreshold });
    empty.error_message = "missing_clickup_env";
    return empty;
  }

  const tasks = await fetchAllTasks(listId, token);
  const snapshot = computeMetrics(tasks, { redField, redThreshold });

  if (supabaseUrl && serviceRole) {
    const supabase = createClient(supabaseUrl, serviceRole);
    const { error } = await supabase.from("clickup_services_snapshots").insert({
      quarter_label: snapshot.quarter_label,
      task_count: snapshot.task_count,
      active_projects: snapshot.active_projects,
      closed_projects_this_quarter: snapshot.closed_projects_this_quarter,
      closed_projects_sra_final_quarter: snapshot.closed_projects_sra_final_quarter,
      avg_project_close_days_qtd: snapshot.avg_project_close_days_qtd,
      close_day_sample_count: snapshot.close_day_sample_count,
      overall_project_status: snapshot.overall_project_status,
      red_item_threshold: snapshot.red_item_threshold,
      projects_over_red_threshold: snapshot.projects_over_red_threshold,
      status_breakdown: snapshot.status_breakdown,
      closed_projects_quarter_names: snapshot.closed_projects_quarter_names,
      sra_final_quarter_names: snapshot.sra_final_quarter_names,
      error_message: snapshot.error_message,
    });
    if (error) {
      snapshot.error_message = `insert: ${error.message}`;
    }
  }
  return snapshot;
}

serve(async (req: Request) => {
  if (req.method !== "POST" && req.method !== "GET") {
    return new Response("method_not_allowed", { status: 405 });
  }
  try {
    const snapshot = await runSync();
    return new Response(JSON.stringify(snapshot), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ error: (e as Error).message }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});
