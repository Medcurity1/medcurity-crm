import { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  DndContext,
  DragOverlay,
  closestCorners,
  PointerSensor,
  useSensor,
  useSensors,
  type DragStartEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import { useActivePipeline, useUpdateOpportunity } from "./api";
import {
  usePipelineViews,
  useDeletePipelineView,
  useCustomPipeline,
} from "./pipeline-views-api";
import { useUsers } from "@/features/accounts/api";
import { useAuth } from "@/features/auth/AuthProvider";
import { PipelineColumn } from "./PipelineColumn";
import { PipelineCard } from "./PipelineCard";
import { CreatePipelineDialog } from "./CreatePipelineDialog";
import { PageHeader } from "@/components/PageHeader";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { Plus, MoreVertical, Pencil, Trash2 } from "lucide-react";
import { OPEN_STAGES, formatCurrency, stageLabel } from "@/lib/formatters";
import type {
  ActivePipelineRow,
  OpportunityStage,
  PipelineView,
} from "@/types/crm";

function PipelineStats({ items }: { items: ActivePipelineRow[] }) {
  const totalValue = items.reduce((sum, item) => sum + Number(item.amount), 0);
  const dealCount = items.length;
  const avgDealSize = dealCount > 0 ? totalValue / dealCount : 0;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
      <Card>
        <CardContent className="pt-4 pb-3 px-4">
          <p className="text-xs text-muted-foreground">Total Pipeline Value</p>
          <p className="text-lg font-semibold">{formatCurrency(totalValue)}</p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-4 pb-3 px-4">
          <p className="text-xs text-muted-foreground">Deal Count</p>
          <p className="text-lg font-semibold">{dealCount}</p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="pt-4 pb-3 px-4">
          <p className="text-xs text-muted-foreground">Average Deal Size</p>
          <p className="text-lg font-semibold">{formatCurrency(avgDealSize)}</p>
        </CardContent>
      </Card>
    </div>
  );
}

interface PipelineKanbanProps {
  pipeline: ActivePipelineRow[] | undefined;
  isLoading: boolean;
  stages?: OpportunityStage[];
}

function PipelineKanban({
  pipeline,
  isLoading,
  stages,
}: PipelineKanbanProps) {
  const navigate = useNavigate();
  const updateMutation = useUpdateOpportunity();
  const [activeItem, setActiveItem] = useState<ActivePipelineRow | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    })
  );

  const displayStages = stages ?? OPEN_STAGES;

  const columns = displayStages.map((stage) => ({
    stage,
    items: pipeline?.filter((p) => p.stage === stage) ?? [],
  }));

  function handleDragStart(event: DragStartEvent) {
    const item = pipeline?.find((p) => p.id === event.active.id);
    setActiveItem(item ?? null);
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveItem(null);
    const { active, over } = event;
    if (!over) return;

    const newStage = over.id as OpportunityStage;
    const item = pipeline?.find((p) => p.id === active.id);
    if (!item || item.stage === newStage) return;

    updateMutation.mutate(
      { id: item.id, stage: newStage },
      {
        onSuccess: () => {
          toast.success(
            `Moved to ${stageLabel(newStage)}`
          );
        },
        onError: (err) => {
          toast.error("Failed to update stage: " + (err as Error).message);
        },
      }
    );
  }

  if (isLoading) {
    return (
      <div className="overflow-x-auto -mx-1 px-1 pb-2">
        <div
          className="grid gap-4"
          style={{
            gridTemplateColumns: `repeat(${displayStages.length}, minmax(260px, 1fr))`,
          }}
        >
          {Array.from({ length: displayStages.length }).map((_, i) => (
            <Skeleton key={i} className="h-96 w-full" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="overflow-x-auto -mx-1 px-1 pb-2">
        <div
          className="grid gap-4 min-h-[60vh]"
          style={{
            gridTemplateColumns: `repeat(${displayStages.length}, minmax(260px, 1fr))`,
          }}
        >
          {columns.map((col) => (
            <PipelineColumn
              key={col.stage}
              stage={col.stage}
              items={col.items}
              onCardClick={(id) => navigate(`/opportunities/${id}`)}
            />
          ))}
        </div>
      </div>
      <DragOverlay>
        {activeItem ? <PipelineCard item={activeItem} isDragging /> : null}
      </DragOverlay>
    </DndContext>
  );
}

function CustomViewTab({
  view,
  ownerUserId,
}: {
  view: PipelineView;
  ownerUserId: string | undefined;
}) {
  const { data: pipeline, isLoading } = useCustomPipeline({
    stages: view.config.stages,
    team_filter: view.config.team_filter,
    kind_filter: view.config.kind_filter,
    owner_user_id: ownerUserId,
  });

  return (
    <>
      <PipelineStats items={pipeline ?? []} />
      <PipelineKanban
        pipeline={pipeline}
        isLoading={isLoading}
        stages={view.config.stages}
      />
    </>
  );
}

export function PipelineBoard() {
  const { profile } = useAuth();
  const [activeTab, setActiveTab] = useState<string>("sales");
  const [myDeals, setMyDeals] = useState(false);
  const [ownerFilter, setOwnerFilter] = useState<string>("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingView, setEditingView] = useState<PipelineView | null>(null);
  const { data: users } = useUsers();
  const { data: pipelineViews } = usePipelineViews();
  const deleteMutation = useDeletePipelineView();

  const ownerUserId = myDeals
    ? profile?.id
    : ownerFilter !== "all"
      ? ownerFilter
      : undefined;

  const { data: salesPipeline, isLoading: salesLoading } = useActivePipeline({
    team: "sales",
    owner_user_id: ownerUserId,
  });

  const { data: renewalsPipeline, isLoading: renewalsLoading } =
    useActivePipeline({
      team: "renewals",
      owner_user_id: ownerUserId,
    });

  function handleEditView(view: PipelineView) {
    setEditingView(view);
    setDialogOpen(true);
  }

  function handleDeleteView(view: PipelineView) {
    deleteMutation.mutate(view.id, {
      onSuccess: () => {
        toast.success(`Deleted "${view.name}"`);
        if (activeTab === `custom-${view.id}`) {
          setActiveTab("sales");
        }
      },
      onError: (err) => {
        toast.error("Failed to delete view: " + (err as Error).message);
      },
    });
  }

  function handleOpenCreate() {
    setEditingView(null);
    setDialogOpen(true);
  }

  return (
    <div>
      <PageHeader
        title="Pipeline"
        description="Drag opportunities between stages"
      />

      <div className="flex items-center gap-4 mb-4">
        <div className="flex items-center gap-2">
          <Switch
            id="my-deals"
            checked={myDeals}
            onCheckedChange={(checked) => {
              setMyDeals(checked);
              if (checked) setOwnerFilter("all");
            }}
          />
          <Label htmlFor="my-deals" className="text-sm cursor-pointer">
            My Deals
          </Label>
        </div>

        {!myDeals && (
          <Select value={ownerFilter} onValueChange={setOwnerFilter}>
            <SelectTrigger className="w-44">
              <SelectValue placeholder="All owners" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Owners</SelectItem>
              {users?.map((u) => (
                <SelectItem key={u.id} value={u.id}>
                  {u.full_name ?? u.id}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <div className="flex items-center gap-1">
          <TabsList>
            <TabsTrigger value="sales">Sales Pipeline</TabsTrigger>
            <TabsTrigger value="renewals">Renewals Pipeline</TabsTrigger>
            {pipelineViews?.map((view) => (
              <TabsTrigger
                key={view.id}
                value={`custom-${view.id}`}
                className="group relative pr-8"
              >
                {view.name}
                <span
                  className="absolute right-1 top-1/2 -translate-y-1/2"
                  onClick={(e) => e.stopPropagation()}
                >
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button className="inline-flex items-center justify-center rounded-sm p-0.5 opacity-0 group-hover:opacity-100 hover:bg-accent transition-opacity focus:opacity-100">
                        <MoreVertical className="h-3.5 w-3.5" />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onClick={() => handleEditView(view)}
                      >
                        <Pencil className="h-4 w-4 mr-2" />
                        Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => handleDeleteView(view)}
                        className="text-destructive focus:text-destructive"
                      >
                        <Trash2 className="h-4 w-4 mr-2" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </span>
              </TabsTrigger>
            ))}
          </TabsList>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleOpenCreate}
            className="h-8 w-8 p-0 shrink-0"
          >
            <Plus className="h-4 w-4" />
          </Button>
        </div>

        <TabsContent value="sales" className="mt-4">
          <PipelineStats items={salesPipeline ?? []} />
          <PipelineKanban pipeline={salesPipeline} isLoading={salesLoading} />
        </TabsContent>

        <TabsContent value="renewals" className="mt-4">
          <PipelineStats items={renewalsPipeline ?? []} />
          <PipelineKanban
            pipeline={renewalsPipeline}
            isLoading={renewalsLoading}
          />
        </TabsContent>

        {pipelineViews?.map((view) => (
          <TabsContent
            key={view.id}
            value={`custom-${view.id}`}
            className="mt-4"
          >
            <CustomViewTab view={view} ownerUserId={ownerUserId} />
          </TabsContent>
        ))}
      </Tabs>

      <CreatePipelineDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editingView={editingView}
      />
    </div>
  );
}
