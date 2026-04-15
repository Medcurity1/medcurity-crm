import { useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Zap,
  Plus,
  Trash2,
  Loader2,
  History,
  ChevronDown,
  ChevronUp,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import { CreateAutomationDialog } from "./CreateAutomationDialog";
import { RenewalAutomationCard } from "./RenewalAutomationCard";
import {
  useAutomationRules,
  useCreateAutomationRule,
  useUpdateAutomationRule,
  useDeleteAutomationRule,
  useAutomationLog,
  type AutomationRule,
  type CreateAutomationInput,
} from "./automations-api";

// ---------------------------------------------------------------------------
// Pre-built automation templates
// ---------------------------------------------------------------------------

interface AutomationTemplate {
  name: string;
  description: string;
  input: CreateAutomationInput;
}

const TEMPLATES: AutomationTemplate[] = [
  {
    name: "Closed Won -> Active Account",
    description:
      "When an opportunity reaches Closed Won, update the account lifecycle status to Customer.",
    input: {
      name: "Closed Won -> Active Account",
      description:
        "Automatically set account lifecycle to customer when an opportunity is closed won.",
      trigger_entity: "opportunities",
      trigger_event: "stage_changed",
      trigger_conditions: [{ field: "stage", operator: "eq", value: "closed_won" }],
      actions: [
        {
          type: "update_field",
          entity: "accounts",
          field: "lifecycle_status",
          value: "customer",
        },
      ],
      is_active: true,
    },
  },
  {
    name: "Closed Won -> Follow-up Task",
    description:
      "When an opportunity reaches Closed Won, create a follow-up task in 30 days.",
    input: {
      name: "Closed Won -> Follow-up Task",
      description:
        "Create a 30-day follow-up task after winning an opportunity.",
      trigger_entity: "opportunities",
      trigger_event: "stage_changed",
      trigger_conditions: [{ field: "stage", operator: "eq", value: "closed_won" }],
      actions: [
        {
          type: "create_activity",
          activity_type: "task",
          subject: "Follow up with customer after contract signing",
          due_offset_days: 30,
        },
      ],
      is_active: true,
    },
  },
  {
    name: "Qualified Lead -> Schedule Demo",
    description:
      "When a lead is qualified, create a task to schedule a demo.",
    input: {
      name: "Qualified Lead -> Schedule Demo",
      description: "Automatically create a demo scheduling task when a lead is qualified.",
      trigger_entity: "leads",
      trigger_event: "status_changed",
      trigger_conditions: [{ field: "status", operator: "eq", value: "qualified" }],
      actions: [
        {
          type: "create_activity",
          activity_type: "task",
          subject: "Schedule demo with qualified lead",
          due_offset_days: 3,
        },
      ],
      is_active: true,
    },
  },
  {
    name: "Contract Expiring -> Renewal Reminder",
    description:
      "When an account contract end date is 90 days away, create a renewal reminder task.",
    input: {
      name: "Contract Expiring -> Renewal Reminder",
      description:
        "Create a renewal reminder task 90 days before contract expiration.",
      trigger_entity: "accounts",
      trigger_event: "updated",
      trigger_conditions: [
        { field: "current_contract_end_date", operator: "lte", value: "90_days_from_now" },
      ],
      actions: [
        {
          type: "create_activity",
          activity_type: "task",
          subject: "Initiate contract renewal discussion",
          due_offset_days: 0,
        },
        {
          type: "send_notification",
          message: "Contract expiring soon - renewal action needed",
        },
      ],
      is_active: true,
    },
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ENTITY_LABELS: Record<string, string> = {
  accounts: "Account",
  contacts: "Contact",
  opportunities: "Opportunity",
  leads: "Lead",
};

const EVENT_LABELS: Record<string, string> = {
  created: "is created",
  updated: "is updated",
  stage_changed: "stage changes",
  status_changed: "status changes",
};

function triggerSummary(rule: AutomationRule): string {
  const entity = ENTITY_LABELS[rule.trigger_entity] ?? rule.trigger_entity;
  const event = EVENT_LABELS[rule.trigger_event] ?? rule.trigger_event;
  const condCount = rule.trigger_conditions?.length ?? 0;
  const condSuffix = condCount > 0 ? ` (${condCount} condition${condCount > 1 ? "s" : ""})` : "";
  return `When ${entity} ${event}${condSuffix}`;
}

function actionSummary(rule: AutomationRule): string {
  const count = rule.actions?.length ?? 0;
  if (count === 0) return "No actions";
  if (count === 1) {
    const a = rule.actions[0];
    if (a.type === "update_field") return `Update ${a.entity}.${a.field}`;
    if (a.type === "create_activity") return `Create ${a.activity_type ?? "task"}`;
    if (a.type === "send_notification") return "Send notification";
  }
  return `${count} actions`;
}

// ---------------------------------------------------------------------------
// Rule Card with expandable log
// ---------------------------------------------------------------------------

function RuleCard({ rule }: { rule: AutomationRule }) {
  const [showLog, setShowLog] = useState(false);
  const updateRule = useUpdateAutomationRule();
  const deleteRule = useDeleteAutomationRule();
  const { data: logEntries, isLoading: loadingLog } = useAutomationLog(
    showLog ? rule.id : undefined
  );

  function handleToggleActive(checked: boolean) {
    updateRule.mutate(
      { id: rule.id, is_active: checked },
      {
        onSuccess: () =>
          toast.success(checked ? "Automation enabled" : "Automation paused"),
        onError: (err: Error) =>
          toast.error("Failed to update", { description: err.message }),
      }
    );
  }

  function handleDelete() {
    deleteRule.mutate(rule.id, {
      onSuccess: () => toast.success("Automation deleted"),
      onError: (err: Error) =>
        toast.error("Failed to delete", { description: err.message }),
    });
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 space-y-1">
            <div className="flex items-center gap-2">
              <CardTitle className="text-base">{rule.name}</CardTitle>
              {!rule.is_active && <Badge variant="secondary">Paused</Badge>}
            </div>
            {rule.description && (
              <CardDescription>{rule.description}</CardDescription>
            )}
          </div>
          <Switch
            checked={rule.is_active}
            onCheckedChange={handleToggleActive}
            disabled={updateRule.isPending}
          />
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2 text-sm">
          <Badge variant="outline">{triggerSummary(rule)}</Badge>
          <span className="text-muted-foreground">then</span>
          <Badge variant="secondary">{actionSummary(rule)}</Badge>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setShowLog(!showLog)}
          >
            {showLog ? (
              <ChevronUp className="mr-1 h-3 w-3" />
            ) : (
              <ChevronDown className="mr-1 h-3 w-3" />
            )}
            <History className="mr-1 h-3 w-3" />
            Execution Log
          </Button>

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" size="sm" className="text-destructive">
                <Trash2 className="mr-1 h-3 w-3" />
                Delete
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete Automation?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will permanently delete &quot;{rule.name}&quot; and all its
                  execution history. This cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleDelete}>
                  Delete
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>

        {/* Expandable execution log */}
        {showLog && (
          <div className="rounded-md border">
            {loadingLog ? (
              <div className="flex items-center justify-center py-6">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            ) : logEntries && logEntries.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Time</TableHead>
                    <TableHead>Entity</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Details</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logEntries.map((entry) => (
                    <TableRow key={entry.id}>
                      <TableCell className="text-xs">
                        {new Date(entry.executed_at).toLocaleString()}
                      </TableCell>
                      <TableCell className="text-xs">
                        {entry.trigger_entity}
                      </TableCell>
                      <TableCell>
                        {entry.success ? (
                          <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 text-xs">
                            Success
                          </Badge>
                        ) : (
                          <Badge variant="destructive" className="text-xs">
                            Failed
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[200px] truncate">
                        {entry.error_message ??
                          `${entry.actions_executed?.length ?? 0} action(s)`}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="text-xs text-muted-foreground text-center py-4">
                No executions yet.
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function AutomationsManager() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<
    Partial<CreateAutomationInput> | undefined
  >();
  const { data: rules, isLoading } = useAutomationRules();
  const createRule = useCreateAutomationRule();

  function handleOpenCreate(template?: AutomationTemplate) {
    setSelectedTemplate(template?.input);
    setDialogOpen(true);
  }

  function handleQuickCreate(template: AutomationTemplate) {
    createRule.mutate(template.input, {
      onSuccess: () =>
        toast.success(`Automation "${template.name}" created and activated`),
      onError: (err: Error) =>
        toast.error("Failed to create automation", { description: err.message }),
    });
  }

  return (
    <div className="space-y-6">
      <RenewalAutomationCard />

      <Card className="p-6">
        <div className="flex items-center justify-between mb-6">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Zap className="h-5 w-5" />
              Process Automations
            </h2>
            <p className="text-sm text-muted-foreground">
              Create rules that automatically trigger actions when records change.
            </p>
          </div>
          <Button onClick={() => handleOpenCreate()}>
            <Plus className="mr-2 h-4 w-4" />
            Create Automation
          </Button>
        </div>

        {/* Active automation rules */}
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : rules && rules.length > 0 ? (
          <div className="space-y-4">
            {rules.map((rule) => (
              <RuleCard key={rule.id} rule={rule} />
            ))}
          </div>
        ) : (
          <div className="text-center py-12 space-y-2">
            <Zap className="h-10 w-10 text-muted-foreground mx-auto" />
            <p className="text-sm text-muted-foreground">
              No automation rules yet. Create one or use a template below.
            </p>
          </div>
        )}
      </Card>

      {/* Pre-built templates */}
      <Card className="p-6">
        <div className="space-y-1 mb-4">
          <h3 className="text-base font-semibold flex items-center gap-2">
            <Sparkles className="h-4 w-4" />
            Quick-Start Templates
          </h3>
          <p className="text-sm text-muted-foreground">
            Activate common automations with one click, or customize before saving.
          </p>
        </div>

        <Separator className="mb-4" />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {TEMPLATES.map((template) => (
            <Card key={template.name} className="flex flex-col justify-between">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">{template.name}</CardTitle>
                <CardDescription className="text-xs">
                  {template.description}
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="flex gap-2">
                  <Button
                    variant="default"
                    size="sm"
                    className="flex-1"
                    onClick={() => handleQuickCreate(template)}
                    disabled={createRule.isPending}
                  >
                    {createRule.isPending ? (
                      <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                    ) : null}
                    Activate
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleOpenCreate(template)}
                  >
                    Customize
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </Card>

      {/* Create dialog */}
      <CreateAutomationDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        template={selectedTemplate}
      />
    </div>
  );
}
