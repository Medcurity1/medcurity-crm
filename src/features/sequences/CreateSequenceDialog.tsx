import { useState } from "react";
import { Plus, Trash2, GripVertical } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
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
import { useCreateSequence } from "./sequences-api";
import { useAuth } from "@/features/auth/AuthProvider";
import type { SequenceStep } from "@/types/crm";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const emptyStep = (): SequenceStep => ({
  step_number: 1,
  type: "email",
  delay_days: 0,
  subject: "",
  body: "",
});

export function CreateSequenceDialog({ open, onOpenChange }: Props) {
  const { profile } = useAuth();
  const createMutation = useCreateSequence();

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [steps, setSteps] = useState<SequenceStep[]>([emptyStep()]);

  function addStep() {
    setSteps((prev) => [
      ...prev,
      {
        step_number: prev.length + 1,
        type: "email",
        delay_days: prev.length === 0 ? 0 : 2,
        subject: "",
        body: "",
      },
    ]);
  }

  function removeStep(index: number) {
    setSteps((prev) =>
      prev
        .filter((_, i) => i !== index)
        .map((s, i) => ({ ...s, step_number: i + 1 }))
    );
  }

  function updateStep(index: number, field: keyof SequenceStep, value: unknown) {
    setSteps((prev) =>
      prev.map((s, i) => (i === index ? { ...s, [field]: value } : s))
    );
  }

  function reset() {
    setName("");
    setDescription("");
    setSteps([emptyStep()]);
  }

  async function handleSubmit() {
    if (!name.trim()) {
      toast.error("Sequence name is required");
      return;
    }
    if (steps.length === 0) {
      toast.error("Add at least one step");
      return;
    }
    if (steps.some((s) => !s.subject.trim())) {
      toast.error("All steps must have a subject");
      return;
    }

    try {
      await createMutation.mutateAsync({
        name: name.trim(),
        description: description.trim() || undefined,
        steps,
        owner_user_id: profile?.id,
      });
      toast.success("Sequence created");
      reset();
      onOpenChange(false);
    } catch {
      toast.error("Failed to create sequence");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Create Sales Sequence</DialogTitle>
          <DialogDescription>
            Build an outreach cadence with a series of touchpoints.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4">
            <div>
              <Label htmlFor="seq-name">Sequence Name</Label>
              <Input
                id="seq-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., New Lead Outreach"
              />
            </div>
            <div>
              <Label htmlFor="seq-desc">Description</Label>
              <Textarea
                id="seq-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional description..."
                rows={2}
              />
            </div>
          </div>

          {/* Steps */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <Label>Steps</Label>
              <Button variant="outline" size="sm" onClick={addStep}>
                <Plus className="h-4 w-4 mr-1" />
                Add Step
              </Button>
            </div>

            <div className="space-y-3">
              {steps.map((step, i) => (
                <div
                  key={i}
                  className="border rounded-lg p-3 space-y-3 bg-muted/30"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <GripVertical className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm font-medium">
                        Step {step.step_number}
                      </span>
                    </div>
                    {steps.length > 1 && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive"
                        onClick={() => removeStep(i)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">Type</Label>
                      <Select
                        value={step.type}
                        onValueChange={(v) => updateStep(i, "type", v)}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="email">Email</SelectItem>
                          <SelectItem value="call">Call</SelectItem>
                          <SelectItem value="task">Task</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label className="text-xs">
                        Delay (days after previous)
                      </Label>
                      <Input
                        type="number"
                        min={0}
                        value={step.delay_days}
                        onChange={(e) =>
                          updateStep(
                            i,
                            "delay_days",
                            Math.max(0, parseInt(e.target.value) || 0)
                          )
                        }
                      />
                    </div>
                  </div>

                  <div>
                    <Label className="text-xs">Subject</Label>
                    <Input
                      value={step.subject}
                      onChange={(e) => updateStep(i, "subject", e.target.value)}
                      placeholder="Step subject..."
                    />
                  </div>

                  {step.type === "email" && (
                    <div>
                      <Label className="text-xs">Body</Label>
                      <Textarea
                        value={step.body ?? ""}
                        onChange={(e) =>
                          updateStep(i, "body", e.target.value)
                        }
                        placeholder="Email body template..."
                        rows={3}
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={createMutation.isPending}
          >
            {createMutation.isPending ? "Creating..." : "Create Sequence"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
