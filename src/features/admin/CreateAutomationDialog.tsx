import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Plus, Trash2, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  useCreateAutomationRule,
  type TriggerCondition,
  type AutomationAction,
  type CreateAutomationInput,
} from "./automations-api";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ENTITIES = [
  { value: "accounts", label: "Accounts" },
  { value: "contacts", label: "Contacts" },
  { value: "opportunities", label: "Opportunities" },
  // "leads" retired 2026-07-20 — existing lead automations keep their
  // stored entity; new ones can't target the frozen table.
] as const;

const EVENTS = [
  { value: "created", label: "Created" },
  { value: "updated", label: "Updated" },
  { value: "stage_changed", label: "Stage Changed" },
  { value: "status_changed", label: "Status Changed" },
] as const;

const OPERATORS = [
  { value: "eq", label: "Equals" },
  { value: "neq", label: "Not Equals" },
  { value: "contains", label: "Contains" },
  { value: "gt", label: "Greater Than" },
  { value: "lt", label: "Less Than" },
] as const;

const ACTION_TYPES = [
  { value: "update_field", label: "Update Field" },
  { value: "create_activity", label: "Create Task/Activity" },
  { value: "send_notification", label: "Send Notification" },
] as const;

const ACTIVITY_TYPES = [
  { value: "task", label: "Task" },
  { value: "call", label: "Call" },
  { value: "email", label: "Email" },
  { value: "meeting", label: "Meeting" },
  { value: "note", label: "Note" },
] as const;

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ConditionRow({
  condition,
  onChange,
  onRemove,
}: {
  condition: TriggerCondition;
  onChange: (c: TriggerCondition) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex items-center gap-2">
      <Input
        placeholder="Field (e.g. stage)"
        value={condition.field}
        onChange={(e) => onChange({ ...condition, field: e.target.value })}
        className="flex-1"
      />
      <Select
        value={condition.operator}
        onValueChange={(v) =>
          onChange({ ...condition, operator: v as TriggerCondition["operator"] })
        }
      >
        <SelectTrigger className="w-[140px]">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {OPERATORS.map((op) => (
            <SelectItem key={op.value} value={op.value}>
              {op.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Input
        placeholder="Value"
        value={condition.value}
        onChange={(e) => onChange({ ...condition, value: e.target.value })}
        className="flex-1"
      />
      <Button variant="ghost" size="sm" onClick={onRemove}>
        <Trash2 className="h-4 w-4 text-destructive" />
      </Button>
    </div>
  );
}

function ActionRow({
  action,
  onChange,
  onRemove,
}: {
  action: AutomationAction;
  onChange: (a: AutomationAction) => void;
  onRemove: () => void;
}) {
  return (
    <div className="space-y-2 rounded-md border p-3">
      <div className="flex items-center justify-between">
        <Select
          value={action.type}
          onValueChange={(v) =>
            onChange({ ...action, type: v as AutomationAction["type"] })
          }
        >
          <SelectTrigger className="w-[200px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ACTION_TYPES.map((at) => (
              <SelectItem key={at.value} value={at.value}>
                {at.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="ghost" size="sm" onClick={onRemove}>
          <Trash2 className="h-4 w-4 text-destructive" />
        </Button>
      </div>

      {action.type === "update_field" && (
        <div className="grid grid-cols-3 gap-2">
          <Select
            value={action.entity ?? ""}
            onValueChange={(v) => onChange({ ...action, entity: v })}
          >
            <SelectTrigger>
              <SelectValue placeholder="Entity" />
            </SelectTrigger>
            <SelectContent>
              {ENTITIES.map((e) => (
                <SelectItem key={e.value} value={e.value}>
                  {e.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            placeholder="Field name"
            value={action.field ?? ""}
            onChange={(e) => onChange({ ...action, field: e.target.value })}
          />
          <Input
            placeholder="New value"
            value={action.value ?? ""}
            onChange={(e) => onChange({ ...action, value: e.target.value })}
          />
        </div>
      )}

      {action.type === "create_activity" && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <Select
              value={action.activity_type ?? "task"}
              onValueChange={(v) => onChange({ ...action, activity_type: v })}
            >
              <SelectTrigger>
                <SelectValue placeholder="Activity type" />
              </SelectTrigger>
              <SelectContent>
                {ACTIVITY_TYPES.map((at) => (
                  <SelectItem key={at.value} value={at.value}>
                    {at.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              type="number"
              placeholder="Due in X days"
              value={action.due_offset_days ?? ""}
              onChange={(e) =>
                onChange({
                  ...action,
                  due_offset_days: e.target.value ? parseInt(e.target.value) : undefined,
                })
              }
            />
          </div>
          <Input
            placeholder="Subject (e.g. Follow up with customer)"
            value={action.subject ?? ""}
            onChange={(e) => onChange({ ...action, subject: e.target.value })}
          />
        </div>
      )}

      {action.type === "send_notification" && (
        <Textarea
          placeholder="Notification message"
          value={action.message ?? ""}
          onChange={(e) => onChange({ ...action, message: e.target.value })}
          rows={2}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Dialog
// ---------------------------------------------------------------------------

interface CreateAutomationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Optional pre-filled values (used for templates). */
  template?: Partial<CreateAutomationInput>;
}

export function CreateAutomationDialog({
  open,
  onOpenChange,
  template,
}: CreateAutomationDialogProps) {
  const createRule = useCreateAutomationRule();

  // Step tracking: 0 = trigger, 1 = actions, 2 = name & save
  const [step, setStep] = useState(0);

  // Form state
  const [entity, setEntity] = useState<CreateAutomationInput["trigger_entity"]>(
    template?.trigger_entity ?? "opportunities"
  );
  const [event, setEvent] = useState<CreateAutomationInput["trigger_event"]>(
    template?.trigger_event ?? "stage_changed"
  );
  const [conditions, setConditions] = useState<TriggerCondition[]>(
    template?.trigger_conditions ?? []
  );
  const [actions, setActions] = useState<AutomationAction[]>(
    template?.actions ?? [{ type: "update_field" }]
  );
  const [name, setName] = useState(template?.name ?? "");
  const [description, setDescription] = useState(template?.description ?? "");

  function resetForm() {
    setStep(0);
    setEntity(template?.trigger_entity ?? "opportunities");
    setEvent(template?.trigger_event ?? "stage_changed");
    setConditions(template?.trigger_conditions ?? []);
    setActions(template?.actions ?? [{ type: "update_field" }]);
    setName(template?.name ?? "");
    setDescription(template?.description ?? "");
  }

  function addCondition() {
    setConditions([...conditions, { field: "", operator: "eq", value: "" }]);
  }

  function updateCondition(idx: number, c: TriggerCondition) {
    const next = [...conditions];
    next[idx] = c;
    setConditions(next);
  }

  function removeCondition(idx: number) {
    setConditions(conditions.filter((_, i) => i !== idx));
  }

  function addAction() {
    setActions([...actions, { type: "update_field" }]);
  }

  function updateAction(idx: number, a: AutomationAction) {
    const next = [...actions];
    next[idx] = a;
    setActions(next);
  }

  function removeAction(idx: number) {
    setActions(actions.filter((_, i) => i !== idx));
  }

  function handleSave() {
    if (!name.trim()) {
      toast.error("Please enter a name for this automation");
      return;
    }
    if (actions.length === 0) {
      toast.error("Add at least one action");
      return;
    }

    // Filter out incomplete conditions
    const validConditions = conditions.filter((c) => c.field && c.value);

    createRule.mutate(
      {
        name: name.trim(),
        description: description.trim() || null,
        trigger_entity: entity,
        trigger_event: event,
        trigger_conditions: validConditions,
        actions,
        is_active: true,
      },
      {
        onSuccess: () => {
          toast.success("Automation rule created");
          resetForm();
          onOpenChange(false);
        },
        onError: (err: Error) => {
          toast.error("Failed to create automation", { description: err.message });
        },
      }
    );
  }

  const entityLabel =
    ENTITIES.find((e) => e.value === entity)?.label ?? entity;
  const eventLabel =
    EVENTS.find((e) => e.value === event)?.label ?? event;

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) resetForm();
        onOpenChange(v);
      }}
    >
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Automation</DialogTitle>
          <DialogDescription>
            {step === 0 && "Step 1 of 3: Define the trigger"}
            {step === 1 && "Step 2 of 3: Define the actions"}
            {step === 2 && "Step 3 of 3: Name and save"}
          </DialogDescription>
        </DialogHeader>

        {/* Step indicator */}
        <div className="flex gap-2">
          {[0, 1, 2].map((s) => (
            <div
              key={s}
              className={`h-1.5 flex-1 rounded-full ${
                s <= step ? "bg-primary" : "bg-muted"
              }`}
            />
          ))}
        </div>

        {/* Step 0: Trigger */}
        {step === 0 && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>When this entity...</Label>
              <Select
                value={entity}
                onValueChange={(v) =>
                  setEntity(v as CreateAutomationInput["trigger_entity"])
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ENTITIES.map((e) => (
                    <SelectItem key={e.value} value={e.value}>
                      {e.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>...has this event</Label>
              <Select
                value={event}
                onValueChange={(v) =>
                  setEvent(v as CreateAutomationInput["trigger_event"])
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EVENTS.map((e) => (
                    <SelectItem key={e.value} value={e.value}>
                      {e.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Separator />

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Conditions (optional)</Label>
                <Button variant="ghost" size="sm" onClick={addCondition}>
                  <Plus className="mr-1 h-3 w-3" />
                  Add Condition
                </Button>
              </div>
              {conditions.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  No conditions -- the automation will fire on every matching event.
                </p>
              )}
              {conditions.map((c, i) => (
                <ConditionRow
                  key={i}
                  condition={c}
                  onChange={(upd) => updateCondition(i, upd)}
                  onRemove={() => removeCondition(i)}
                />
              ))}
            </div>
          </div>
        )}

        {/* Step 1: Actions */}
        {step === 1 && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <Label>Actions</Label>
                <p className="text-xs text-muted-foreground mt-1">
                  When triggered, these actions will run in order.
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={addAction}>
                <Plus className="mr-1 h-3 w-3" />
                Add Action
              </Button>
            </div>
            {actions.map((a, i) => (
              <ActionRow
                key={i}
                action={a}
                onChange={(upd) => updateAction(i, upd)}
                onRemove={() => removeAction(i)}
              />
            ))}
            {actions.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">
                Add at least one action.
              </p>
            )}
          </div>
        )}

        {/* Step 2: Name & Save */}
        {step === 2 && (
          <div className="space-y-4">
            <div className="rounded-md border p-3 space-y-1">
              <p className="text-xs text-muted-foreground">Trigger summary</p>
              <p className="text-sm">
                When <Badge variant="outline">{entityLabel}</Badge>{" "}
                <Badge variant="secondary">{eventLabel}</Badge>
                {conditions.length > 0 && (
                  <span className="text-muted-foreground">
                    {" "}with {conditions.length} condition(s)
                  </span>
                )}
              </p>
              <p className="text-xs text-muted-foreground mt-2">
                {actions.length} action(s) will run
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="rule-name">Name</Label>
              <Input
                id="rule-name"
                placeholder="e.g. Close Won → Activate Account"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="rule-desc">Description (optional)</Label>
              <Textarea
                id="rule-desc"
                placeholder="Describe what this automation does..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
              />
            </div>
          </div>
        )}

        <DialogFooter className="flex justify-between">
          <div>
            {step > 0 && (
              <Button variant="ghost" onClick={() => setStep(step - 1)}>
                Back
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            {step < 2 ? (
              <Button onClick={() => setStep(step + 1)}>Next</Button>
            ) : (
              <Button onClick={handleSave} disabled={createRule.isPending}>
                {createRule.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                Create Automation
              </Button>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
