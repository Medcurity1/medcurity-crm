import { useState, useCallback } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Building2,
  Users,
  Plus,
  Target,
  Kanban,
  Clock,
  CheckCircle2,
  ListTodo,
  Upload,
  LogIn,
  UserPlus,
  Sparkles,
  Settings,
  Settings2,
  GripVertical,
  Phone,
  History,
} from "lucide-react";
import { useRecentRecords, type RecentRecord } from "@/hooks/useRecentRecords";
import { TeamActivityFeed } from "./TeamActivityFeed";
import { MyAccountsWidget } from "./MyAccountsWidget";
import { KpiCard } from "./KpiCard";
import { KpiConfigDialog } from "./KpiConfigDialog";
import { loadKpiConfig, getKpiById } from "./kpi-registry";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/features/auth/AuthProvider";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/StatusBadge";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  formatCurrency,
  formatDate,
  formatRelativeDate,
  stageLabel,
  activityLabel,
} from "@/lib/formatters";
import type { AppRole, OpportunityStage, ActivityType } from "@/types/crm";

// ---------------------------------------------------------------------------
// Types for query results
// ---------------------------------------------------------------------------

interface OpenOpportunity {
  id: string;
  name: string;
  stage: OpportunityStage;
  amount: number;
  expected_close_date: string | null;
  account: { name: string } | null;
}

interface RecentActivity {
  id: string;
  activity_type: ActivityType;
  subject: string;
  created_at: string;
  account: { name: string } | null;
}

interface TaskItem {
  id: string;
  subject: string;
  due_at: string | null;
  completed_at: string | null;
}

// ---------------------------------------------------------------------------
// Data hooks
// ---------------------------------------------------------------------------

function useMyOpenOpportunities(userId: string) {
  return useQuery({
    queryKey: ["dashboard", "my-open-opps", userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("opportunities")
        .select("id, name, stage, amount, expected_close_date, account:accounts(name)")
        .eq("owner_user_id", userId)
        .is("archived_at", null)
        .not("stage", "in", '("closed_won","closed_lost")')
        .order("expected_close_date", { ascending: true, nullsFirst: false })
        .limit(10);
      if (error) throw error;
      return (data ?? []) as unknown as OpenOpportunity[];
    },
  });
}

function useRecentActivity() {
  return useQuery({
    queryKey: ["dashboard", "recent-activity"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("activities")
        .select("id, activity_type, subject, created_at, account:accounts(name)")
        .is("archived_at", null)
        .order("created_at", { ascending: false })
        .limit(5);
      if (error) throw error;
      return (data ?? []) as unknown as RecentActivity[];
    },
  });
}

function useMyTasks(userId: string) {
  return useQuery({
    queryKey: ["dashboard", "my-tasks", userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("activities")
        .select("id, subject, due_at, completed_at")
        .eq("activity_type", "task")
        .eq("owner_user_id", userId)
        .is("archived_at", null)
        .order("due_at", { ascending: true, nullsFirst: false });
      if (error) throw error;
      return (data ?? []) as TaskItem[];
    },
    enabled: !!userId,
  });
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function QuickActions() {
  const navigate = useNavigate();
  return (
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" onClick={() => navigate("/accounts/new")}>
        <Plus className="h-4 w-4 mr-2" />
        New Account
      </Button>
      <Button variant="outline" onClick={() => navigate("/opportunities/new")}>
        <Target className="h-4 w-4 mr-2" />
        New Opportunity
      </Button>
      <Button variant="outline" onClick={() => navigate("/pipeline")}>
        <Kanban className="h-4 w-4 mr-2" />
        View Pipeline
      </Button>
    </div>
  );
}

function RecentActivitySection() {
  const { data: activities, isLoading } = useRecentActivity();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Recent Activity</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-start gap-3">
                <Skeleton className="h-8 w-8 rounded-full shrink-0" />
                <div className="space-y-1.5 flex-1">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-1/3" />
                </div>
              </div>
            ))}
          </div>
        ) : !activities?.length ? (
          <p className="text-sm text-muted-foreground">No recent activity.</p>
        ) : (
          <div className="space-y-4">
            {activities.map((a) => (
              <div key={a.id} className="flex items-start gap-3">
                <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                  <Clock className="h-4 w-4 text-primary" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium leading-snug">
                    <span className="text-muted-foreground">
                      [{activityLabel(a.activity_type)}]
                    </span>{" "}
                    {a.subject}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {a.account?.name ? `${a.account.name} · ` : ""}
                    {formatRelativeDate(a.created_at)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function getDueDateColor(dueAt: string | null): string {
  if (!dueAt) return "text-muted-foreground";
  const due = new Date(dueAt);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  due.setHours(0, 0, 0, 0);
  const diffDays = Math.floor(
    (due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
  );
  if (diffDays < 0) return "text-red-600";
  if (diffDays === 0) return "text-amber-600";
  if (diffDays <= 2) return "text-amber-500";
  return "text-muted-foreground";
}

function MyTasksSection({ userId }: { userId: string }) {
  const { data: tasks, isLoading } = useMyTasks(userId);
  const qc = useQueryClient();

  const completeMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("activities")
        .update({ completed_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["dashboard", "my-tasks"] });
    },
  });

  const openTasks = (tasks ?? []).filter((t) => !t.completed_at);
  const completedTasks = (tasks ?? []).filter((t) => t.completed_at);
  const displayOpen = openTasks.slice(0, 5);
  const displayCompleted = completedTasks.slice(0, 2);
  const totalCount = openTasks.length;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base flex items-center gap-2">
          <ListTodo className="h-4 w-4" />
          My Tasks
          {totalCount > 0 && (
            <span className="text-xs font-normal text-muted-foreground">
              ({totalCount})
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="h-4 w-4 rounded" />
                <Skeleton className="h-4 w-3/4" />
              </div>
            ))}
          </div>
        ) : !displayOpen.length && !displayCompleted.length ? (
          <p className="text-sm text-muted-foreground">No tasks assigned to you.</p>
        ) : (
          <div className="space-y-2">
            {displayOpen.map((task) => (
              <div
                key={task.id}
                className="flex items-center gap-3 py-1"
              >
                <Checkbox
                  checked={false}
                  onCheckedChange={() => completeMutation.mutate(task.id)}
                  disabled={completeMutation.isPending}
                  className="shrink-0"
                />
                <span className="flex-1 text-sm truncate">{task.subject}</span>
                {task.due_at && (
                  <span
                    className={`text-xs shrink-0 ${getDueDateColor(task.due_at)}`}
                  >
                    Due: {formatDate(task.due_at)}
                  </span>
                )}
              </div>
            ))}

            {displayCompleted.length > 0 && (
              <>
                {displayOpen.length > 0 && (
                  <div className="border-t my-2" />
                )}
                {displayCompleted.map((task) => (
                  <div
                    key={task.id}
                    className="flex items-center gap-3 py-1 opacity-60"
                  >
                    <CheckCircle2 className="h-4 w-4 text-green-600 shrink-0" />
                    <span className="flex-1 text-sm truncate line-through">
                      {task.subject}
                    </span>
                    <span className="text-xs text-muted-foreground shrink-0">
                      Completed
                    </span>
                  </div>
                ))}
              </>
            )}

            <div className="pt-2">
              <Button variant="ghost" size="sm" className="text-sm text-primary" asChild>
                <Link to="/activities?type=task&owner=me">View All Tasks</Link>
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function MyOpenOpportunitiesSection({ userId }: { userId: string }) {
  const { data: opps, isLoading } = useMyOpenOpportunities(userId);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">My Open Opportunities</CardTitle>
        <Link
          to="/opportunities?owner=mine"
          className="text-sm text-primary hover:underline"
        >
          View All
        </Link>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : !opps?.length ? (
          <p className="text-sm text-muted-foreground">
            No open opportunities assigned to you.
          </p>
        ) : (
          <div className="border rounded-lg overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Account</TableHead>
                  <TableHead>Stage</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Expected Close</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {opps.map((opp) => (
                  <TableRow key={opp.id}>
                    <TableCell>
                      <Link
                        to={`/opportunities/${opp.id}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {opp.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {opp.account?.name ?? "—"}
                    </TableCell>
                    <TableCell>
                      <StatusBadge
                        value={opp.stage}
                        variant="stage"
                        label={stageLabel(opp.stage)}
                      />
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      {formatCurrency(Number(opp.amount))}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(opp.expected_close_date)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Getting Started (empty-state)
// ---------------------------------------------------------------------------

function GettingStartedCard() {
  const navigate = useNavigate();

  const steps = [
    { label: "Log in to the CRM", done: true, icon: LogIn },
    {
      label: "Import your Salesforce data (Settings \u2192 Data Import)",
      done: false,
      icon: Upload,
    },
    { label: "Create your first account", done: false, icon: Building2 },
    { label: "Add contacts to your accounts", done: false, icon: UserPlus },
    { label: "Create an opportunity", done: false, icon: Target },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="h-5 w-5 text-primary" />
          Getting Started
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Here's what to do first:
        </p>
        <div className="space-y-3">
          {steps.map((step, i) => (
            <div key={i} className="flex items-center gap-3">
              {step.done ? (
                <CheckCircle2 className="h-5 w-5 text-green-600 shrink-0" />
              ) : (
                <div className="h-5 w-5 rounded border-2 border-muted-foreground/30 shrink-0" />
              )}
              <span
                className={`text-sm ${step.done ? "line-through text-muted-foreground" : ""}`}
              >
                {i + 1}. {step.label}
              </span>
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-2 pt-2">
          <Button onClick={() => navigate("/admin")}>
            <Upload className="h-4 w-4 mr-2" />
            Import Salesforce Data
          </Button>
          <Button variant="outline" onClick={() => navigate("/accounts/new")}>
            <Plus className="h-4 w-4 mr-2" />
            Create Account
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Dashboard customization
// ---------------------------------------------------------------------------

interface WidgetDef {
  key: string;
  label: string;
  defaultVisible: boolean;
}

const WIDGET_DEFS: WidgetDef[] = [
  { key: "kpis", label: "My KPIs", defaultVisible: true },
  { key: "tasks", label: "My Tasks", defaultVisible: true },
  { key: "open_opps", label: "My Open Opportunities", defaultVisible: true },
  { key: "recent_activity", label: "Recent Activities", defaultVisible: true },
  { key: "recent_records", label: "Recent Records", defaultVisible: true },
  { key: "pipeline_summary", label: "Pipeline Summary", defaultVisible: false },
  { key: "upcoming_renewals", label: "Upcoming Renewals", defaultVisible: false },
  { key: "call_list", label: "Call List (from Sequences)", defaultVisible: false },
  { key: "saved_report", label: "Saved Report", defaultVisible: false },
  { key: "team_activity_feed", label: "Team Activity Feed", defaultVisible: false },
  { key: "my_accounts", label: "My Accounts", defaultVisible: false },
];

function getDefaultConfig(): Record<string, boolean> {
  const config: Record<string, boolean> = {};
  for (const w of WIDGET_DEFS) {
    config[w.key] = w.defaultVisible;
  }
  return config;
}

function loadDashboardConfig(): Record<string, boolean> {
  try {
    const stored = localStorage.getItem("dashboard_config");
    if (stored) {
      const parsed = JSON.parse(stored);
      // Merge with defaults to pick up new widgets
      const defaults = getDefaultConfig();
      return { ...defaults, ...parsed };
    }
  } catch {
    // ignore
  }
  return getDefaultConfig();
}

function saveDashboardConfig(config: Record<string, boolean>) {
  localStorage.setItem("dashboard_config", JSON.stringify(config));
}

function DashboardCustomizeSheet({
  open,
  onOpenChange,
  config,
  onConfigChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  config: Record<string, boolean>;
  onConfigChange: (config: Record<string, boolean>) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Customize Dashboard</SheetTitle>
          <SheetDescription>
            Toggle widgets on or off to personalize your dashboard.
          </SheetDescription>
        </SheetHeader>
        <div className="space-y-4 py-4">
          {WIDGET_DEFS.map((w) => (
            <div key={w.key} className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <GripVertical className="h-4 w-4 text-muted-foreground" />
                <Label htmlFor={`widget-${w.key}`} className="cursor-pointer">
                  {w.label}
                </Label>
              </div>
              <Switch
                id={`widget-${w.key}`}
                checked={config[w.key] ?? false}
                onCheckedChange={(checked) => {
                  const updated = { ...config, [w.key]: checked };
                  onConfigChange(updated);
                  saveDashboardConfig(updated);
                }}
              />
            </div>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ---------------------------------------------------------------------------
// Pipeline Summary widget
// ---------------------------------------------------------------------------

function PipelineSummaryWidget() {
  const { data, isLoading } = useQuery({
    queryKey: ["dashboard", "pipeline-summary"],
    queryFn: async () => {
      const { data: opps, error } = await supabase
        .from("opportunities")
        .select("stage, amount")
        .is("archived_at", null)
        .not("stage", "in", '("closed_won","closed_lost")');
      if (error) throw error;

      const stages: Record<string, { count: number; total: number }> = {};
      for (const opp of opps ?? []) {
        if (!stages[opp.stage]) stages[opp.stage] = { count: 0, total: 0 };
        stages[opp.stage].count++;
        stages[opp.stage].total += Number(opp.amount);
      }
      return stages;
    },
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-2">
        <GripVertical className="h-4 w-4 text-muted-foreground" />
        <CardTitle className="text-base">Pipeline Summary</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : !data || Object.keys(data).length === 0 ? (
          <p className="text-sm text-muted-foreground">No open pipeline.</p>
        ) : (
          <div className="space-y-2">
            {Object.entries(data).map(([stage, info]) => (
              <div key={stage} className="flex items-center justify-between text-sm">
                <span className="capitalize">{stageLabel(stage as OpportunityStage)}</span>
                <div className="flex items-center gap-3">
                  <span className="text-muted-foreground">{info.count} deals</span>
                  <span className="font-medium">{formatCurrency(info.total)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Upcoming Renewals widget
// ---------------------------------------------------------------------------

function UpcomingRenewalsWidget() {
  const { data, isLoading } = useQuery({
    queryKey: ["dashboard", "upcoming-renewals-widget"],
    queryFn: async () => {
      const { data: rows, error } = await supabase
        .from("renewal_queue")
        .select("account_name, days_until_renewal, current_arr")
        .order("days_until_renewal", { ascending: true })
        .limit(5);
      if (error) throw error;
      return rows ?? [];
    },
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <GripVertical className="h-4 w-4 text-muted-foreground" />
          <CardTitle className="text-base">Upcoming Renewals</CardTitle>
        </div>
        <Link to="/reports/standard/renewals" className="text-xs text-primary hover:underline">
          View all →
        </Link>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : !data?.length ? (
          <p className="text-sm text-muted-foreground">No upcoming renewals.</p>
        ) : (
          <div className="space-y-2">
            {data.map((row, i) => (
              <div key={i} className="flex items-center justify-between text-sm">
                <span className="font-medium truncate max-w-[200px]">{row.account_name}</span>
                <div className="flex items-center gap-3">
                  <span className="text-muted-foreground">
                    {row.days_until_renewal != null
                      ? `${row.days_until_renewal}d`
                      : "---"}
                  </span>
                  <span className="font-medium">{formatCurrency(Number(row.current_arr))}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Call List widget (from sequences)
// ---------------------------------------------------------------------------

function CallListWidget() {
  const { data, isLoading } = useQuery({
    queryKey: ["dashboard", "call-list-widget"],
    queryFn: async () => {
      const now = new Date();
      now.setHours(23, 59, 59, 999);
      const { data: enrollments, error } = await supabase
        .from("sequence_enrollments")
        .select(
          "id, current_step, next_touch_at, sequence:sequences(steps), lead:leads(first_name, last_name, company, phone), contact:contacts(first_name, last_name, phone)"
        )
        .eq("status", "active")
        .lte("next_touch_at", now.toISOString())
        .limit(10);
      if (error) throw error;

      // Filter to call steps
      return (enrollments ?? []).filter((e) => {
        const seq = e.sequence as unknown as { steps: Array<{ step_number: number; type: string }> } | null;
        if (!seq?.steps) return false;
        const step = seq.steps.find(
          (s: { step_number: number; type: string }) => s.step_number === e.current_step
        );
        return step?.type === "call";
      });
    },
  });

  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-2">
        <GripVertical className="h-4 w-4 text-muted-foreground" />
        <CardTitle className="text-base flex items-center gap-2">
          <Phone className="h-4 w-4 text-green-600" />
          Call List
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-24 w-full" />
        ) : !data?.length ? (
          <p className="text-sm text-muted-foreground">No calls due today.</p>
        ) : (
          <div className="space-y-2">
            {data.map((e) => {
              const lead = (e.lead as unknown) as Record<string, string> | null;
              const contact = (e.contact as unknown) as Record<string, string> | null;
              const name = lead
                ? `${lead.first_name ?? ""} ${lead.last_name ?? ""}`.trim()
                : contact
                  ? `${contact.first_name ?? ""} ${contact.last_name ?? ""}`.trim()
                  : "Unknown";
              const phone = lead?.phone ?? contact?.phone ?? "";
              const company = lead?.company ?? "";
              return (
                <div key={e.id} className="flex items-center justify-between text-sm">
                  <div>
                    <span className="font-medium">{name}</span>
                    {company && (
                      <span className="text-muted-foreground ml-2">
                        {company}
                      </span>
                    )}
                  </div>
                  <span className="text-muted-foreground">{phone || "No phone"}</span>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Recent Records widget
// ---------------------------------------------------------------------------

function recentRecordPath(r: RecentRecord): string {
  switch (r.entity) {
    case "account":
      return `/accounts/${r.id}`;
    case "contact":
      return `/contacts/${r.id}`;
    case "opportunity":
      return `/opportunities/${r.id}`;
    case "lead":
      return `/leads/${r.id}`;
  }
}

function recentRecordIcon(entity: RecentRecord["entity"]): React.ElementType {
  switch (entity) {
    case "account":
      return Building2;
    case "contact":
      return Users;
    case "opportunity":
      return Target;
    case "lead":
      return UserPlus;
  }
}

function entityLabel(entity: RecentRecord["entity"]): string {
  switch (entity) {
    case "account":
      return "Account";
    case "contact":
      return "Contact";
    case "opportunity":
      return "Opportunity";
    case "lead":
      return "Lead";
  }
}

function RecentRecordsWidget() {
  const { records } = useRecentRecords();

  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-2">
        <History className="h-4 w-4 text-muted-foreground" />
        <CardTitle className="text-base">Recently Viewed</CardTitle>
      </CardHeader>
      <CardContent>
        {!records.length ? (
          <p className="text-sm text-muted-foreground">
            Records you view will appear here.
          </p>
        ) : (
          <div className="space-y-2">
            {records.map((r) => {
              const Icon = recentRecordIcon(r.entity);
              return (
                <Link
                  key={`${r.entity}-${r.id}`}
                  to={recentRecordPath(r)}
                  className="flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-muted transition-colors"
                >
                  <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{r.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {entityLabel(r.entity)}
                    </p>
                  </div>
                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                    {formatRelativeDate(r.viewedAt)}
                  </span>
                </Link>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function HomePage() {
  const { profile } = useAuth();
  const role: AppRole = profile?.role ?? "sales";
  const userId = profile?.id ?? "";

  const [dashboardConfig, setDashboardConfig] = useState<Record<string, boolean>>(
    loadDashboardConfig
  );
  const [showCustomize, setShowCustomize] = useState(false);
  const [showKpiConfig, setShowKpiConfig] = useState(false);
  const [selectedKpis, setSelectedKpis] = useState<string[]>(() =>
    loadKpiConfig(role),
  );

  const isWidgetVisible = useCallback(
    (key: string) => dashboardConfig[key] ?? false,
    [dashboardConfig]
  );

  // Resolve KPI definitions for selected IDs
  const activeKpis = selectedKpis
    .map((id) => getKpiById(id))
    .filter((k) => k !== undefined);

  const greeting = getGreeting();

  // If no KPIs have been loaded yet show getting-started for brand new installs
  const showGettingStarted = activeKpis.length === 0;

  return (
    <div className="space-y-6">
      {/* Welcome header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {greeting}, {profile?.full_name ?? "there"}
          </h1>
          <p className="text-muted-foreground mt-1">
            Here is your dashboard overview.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowCustomize(true)}
        >
          <Settings className="h-4 w-4 mr-2" />
          Customize
        </Button>
      </div>

      {showGettingStarted ? (
        <GettingStartedCard />
      ) : isWidgetVisible("kpis") ? (
        <>
          {/* KPI Section Header */}
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-muted-foreground">
              Key Metrics
            </h2>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowKpiConfig(true)}
            >
              <Settings2 className="h-4 w-4 mr-1" />
              Configure
            </Button>
          </div>

          {/* Configurable KPI Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {activeKpis.map((kpi) => (
              <KpiCard key={kpi.id} kpi={kpi} userId={userId} />
            ))}
          </div>
        </>
      ) : null}

      {/* KPI Config Dialog */}
      <KpiConfigDialog
        open={showKpiConfig}
        onOpenChange={setShowKpiConfig}
        role={role}
        selectedKpis={selectedKpis}
        onSave={setSelectedKpis}
      />

      {/* Quick Actions */}
      <div>
        <h2 className="text-sm font-medium text-muted-foreground mb-2">
          Quick Actions
        </h2>
        <QuickActions />
      </div>

      {/* My Tasks */}
      {isWidgetVisible("tasks") && <MyTasksSection userId={userId} />}

      {/* My Open Opportunities gets its own full-width row so the
          stage + amount + close-date columns don't get squeezed.
          Brayden 2026-04-17. */}
      {isWidgetVisible("open_opps") && (
        <MyOpenOpportunitiesSection userId={userId} />
      )}

      {/* Two-column grid for the remaining default widgets */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {isWidgetVisible("recent_activity") && <RecentActivitySection />}
        {isWidgetVisible("recent_records") && <RecentRecordsWidget />}
      </div>

      {/* Optional widgets */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {isWidgetVisible("pipeline_summary") && <PipelineSummaryWidget />}
        {isWidgetVisible("upcoming_renewals") && <UpcomingRenewalsWidget />}
      </div>

      {isWidgetVisible("call_list") && <CallListWidget />}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {isWidgetVisible("team_activity_feed") && <TeamActivityFeed />}
        {isWidgetVisible("my_accounts") && <MyAccountsWidget userId={userId} />}
      </div>

      {/* Customize sheet */}
      <DashboardCustomizeSheet
        open={showCustomize}
        onOpenChange={setShowCustomize}
        config={dashboardConfig}
        onConfigChange={setDashboardConfig}
      />
    </div>
  );
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}
