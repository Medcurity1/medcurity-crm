import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  useCreatePipelineView,
  useUpdatePipelineView,
} from "./pipeline-views-api";
import { ALL_STAGES, stageLabel } from "@/lib/formatters";
import type { PipelineView, PipelineViewConfig, OpportunityStage } from "@/types/crm";

const pipelineViewSchema = z.object({
  name: z.string().min(1, "Name is required"),
  stages: z
    .array(
      z.enum([
        // SF-matching stages
        "details_analysis",
        "demo",
        "proposal_and_price_quote",
        "proposal_conversation",
        "closed_won",
        "closed_lost",
        // Legacy values retained for editing old pipeline views
        // whose config was saved before the stage rename.
        "lead",
        "qualified",
        "proposal",
        "verbal_commit",
      ])
    )
    .min(1, "Select at least one stage"),
  team_filter: z.string().optional(),
  kind_filter: z.string().optional(),
  is_shared: z.boolean(),
});

type PipelineViewFormValues = z.infer<typeof pipelineViewSchema>;

interface CreatePipelineDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  editingView?: PipelineView | null;
}

export function CreatePipelineDialog({
  open,
  onOpenChange,
  editingView,
}: CreatePipelineDialogProps) {
  const createMutation = useCreatePipelineView();
  const updateMutation = useUpdatePipelineView();
  const isEditing = !!editingView;

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    formState: { errors },
  } = useForm<PipelineViewFormValues>({
    resolver: zodResolver(pipelineViewSchema),
    defaultValues: {
      name: "",
      stages: ["details_analysis", "demo", "proposal_and_price_quote", "proposal_conversation"],
      team_filter: "",
      kind_filter: "",
      is_shared: false,
    },
  });

  useEffect(() => {
    if (open) {
      if (editingView) {
        reset({
          name: editingView.name,
          stages: editingView.config.stages,
          team_filter: editingView.config.team_filter ?? "",
          kind_filter: editingView.config.kind_filter ?? "",
          is_shared: editingView.is_shared,
        });
      } else {
        reset({
          name: "",
          stages: ["details_analysis", "demo", "proposal_and_price_quote", "proposal_conversation"],
          team_filter: "",
          kind_filter: "",
          is_shared: false,
        });
      }
    }
  }, [open, editingView, reset]);

  const selectedStages = watch("stages");
  const isShared = watch("is_shared");

  function toggleStage(stage: OpportunityStage) {
    const current = selectedStages ?? [];
    if (current.includes(stage)) {
      setValue(
        "stages",
        current.filter((s) => s !== stage),
        { shouldValidate: true }
      );
    } else {
      setValue("stages", [...current, stage], { shouldValidate: true });
    }
  }

  async function onSubmit(values: PipelineViewFormValues) {
    const config: PipelineViewConfig = {
      stages: values.stages,
      team_filter: (values.team_filter || undefined) as PipelineViewConfig["team_filter"],
      kind_filter: (values.kind_filter || undefined) as PipelineViewConfig["kind_filter"],
    };

    try {
      if (isEditing && editingView) {
        await updateMutation.mutateAsync({
          id: editingView.id,
          name: values.name,
          is_shared: values.is_shared,
          config,
        });
        toast.success("Pipeline view updated");
      } else {
        await createMutation.mutateAsync({
          name: values.name,
          is_shared: values.is_shared,
          config,
        });
        toast.success("Pipeline view created");
      }
      onOpenChange(false);
    } catch (err) {
      toast.error(
        `Failed to ${isEditing ? "update" : "create"} view: ${(err as Error).message}`
      );
    }
  }

  const isPending = createMutation.isPending || updateMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {isEditing ? "Edit Pipeline View" : "Create Pipeline View"}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="view-name">Name</Label>
            <Input
              id="view-name"
              placeholder="e.g. Q2 Focus Deals"
              {...register("name")}
            />
            {errors.name && (
              <p className="text-sm text-destructive">{errors.name.message}</p>
            )}
          </div>

          <div className="space-y-2">
            <Label>Stages (columns to display)</Label>
            <div className="grid grid-cols-2 gap-2">
              {ALL_STAGES.map((stage) => (
                <label
                  key={stage}
                  className="flex items-center gap-2 cursor-pointer"
                >
                  <Checkbox
                    checked={selectedStages?.includes(stage) ?? false}
                    onCheckedChange={() => toggleStage(stage)}
                  />
                  <span className="text-sm">{stageLabel(stage)}</span>
                </label>
              ))}
            </div>
            {errors.stages && (
              <p className="text-sm text-destructive">
                {errors.stages.message}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label>Team Filter</Label>
            <Select
              value={watch("team_filter") ?? ""}
              onValueChange={(val) =>
                setValue("team_filter", val === "all" ? "" : val)
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="All Teams" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Teams</SelectItem>
                <SelectItem value="sales">Sales</SelectItem>
                <SelectItem value="renewals">Renewals</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Kind Filter</Label>
            <Select
              value={watch("kind_filter") ?? ""}
              onValueChange={(val) =>
                setValue("kind_filter", val === "all" ? "" : val)
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="All Kinds" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Kinds</SelectItem>
                <SelectItem value="new_business">New Business</SelectItem>
                <SelectItem value="renewal">Renewal</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2">
            <Switch
              id="share-toggle"
              checked={isShared}
              onCheckedChange={(checked) => setValue("is_shared", checked)}
            />
            <Label htmlFor="share-toggle" className="cursor-pointer">
              Share with team
            </Label>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending
                ? "Saving..."
                : isEditing
                  ? "Save Changes"
                  : "Create View"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
