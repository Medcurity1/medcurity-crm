import { useEffect, useMemo, useRef, useState } from "react";
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
import { useUrlState } from "@/hooks/useUrlState";
import { PipelineColumn, UNMAPPED_COLUMN_ID } from "./PipelineColumn";
import { PipelineCard } from "./PipelineCard";
import { CreatePipelineDialog } from "./CreatePipelineDialog";
import { PageHeader } from "@/components/PageHeader";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { celebrateClosedWon } from "@/lib/confetti";
import { useClosedLostGuard } from "./useClosedLostGuard";
import type {
  ActivePipelineRow,
  OpportunityStage,
  PipelineView,
} from "@/types/crm";

function PipelineStats({ items }: { items: ActivePipelineRow[] }) {
  // Memoized so the total/average aren't re-reduced on every re-render of the
  // board (drag, hover, etc.) — only when the items actually change.
  const { totalValue, dealCount, avgDealSize } = useMemo(() => {
    const total = items.reduce((sum, item) => sum + Number(item.amount), 0);
    const count = items.length;
    return { totalValue: total, dealCount: count, avgDealSize: count > 0 ? total / count : 0 };
  }, [items]);

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
  // "Still a client?" prompt after a deal goes Closed Lost for a current client.
  const closedLostGuard = useClosedLostGuard();
  // Drag-to-Closed-Lost prompts for a reason first. X / Escape / outside
  // click still moves the card, just without a reason. movingRef stops the
  // close handler from double-firing after an explicit "save reason & move".
  const [lossPrompt, setLossPrompt] = useState<{ id: string; name: string; accountId: string } | null>(null);
  const [lossReason, setLossReason] = useState("");
  const movingRef = useRef(false);

  function doMove(id: string, newStage: OpportunityStage, accountId: string | null, reason?: string) {
    updateMutation.mutate(
      {
        id,
        stage: newStage,
        ...(newStage === "closed_lost" && reason?.trim()
          ? { loss_reason: reason.trim() }
          : {}),
      },
      {
        onSuccess: () => {
          toast.success(`Moved to ${stageLabel(newStage)}`);
          if (newStage === "closed_won") celebrateClosedWon();
          if (newStage === "closed_lost") closedLostGuard.promptIfClient(accountId);
        },
        onError: (err) =>
          toast.error("Failed to update stage: " + (err as Error).message),
      }
    );
  }

  function resolveLoss(withReason: boolean) {
    if (!lossPrompt || movingRef.current) return;
    movingRef.current = true;
    doMove(lossPrompt.id, "closed_lost", lossPrompt.accountId, withReason ? lossReason : undefined);
    setLossPrompt(null);
  }
  const [activeItem, setActiveItem] = useState<ActivePipelineRow | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    })
  );

  // Hide the unused Lead + Qualified columns from the board (Brayden:
  // "we'll never use those"). Custom saved views still show whatever
  // stages they configured.
  const displayStages = stages ?? OPEN_STAGES.filter((s) => s !== "lead" && s !== "qualified");

  const columns = displayStages.map((stage) => ({
    stage,
    items: pipeline?.filter((p) => p.stage === stage) ?? [],
  }));

  // Open deals whose stage isn't one of the board's columns (legacy Lead/
  // Qualified, or any open stage we don't render) would otherwise silently
  // vanish from the board while still counting on the Home page and the stats
  // above — the "2 deals missing" report. Surface them in a read-only catch-all
  // so the board never loses a deal; reps can drag a stray into a real stage.
  const unmappedItems = pipeline?.filter((p) => !displayStages.includes(p.stage)) ?? [];
  const totalColumns = displayStages.length + (unmappedItems.length > 0 ? 1 : 0);

  function handleDragStart(event: DragStartEvent) {
    const item = pipeline?.find((p) => p.id === event.active.id);
    setActiveItem(item ?? null);
  }

  function handleDragEnd(event: DragEndEvent) {
    setActiveItem(null);
    const { active, over } = event;
    if (!over) return;
    // Dropping onto the read-only catch-all column is a no-op (the card snaps
    // back) — it isn't a real stage.
    if (over.id === UNMAPPED_COLUMN_ID) return;

    const newStage = over.id as OpportunityStage;
    const item = pipeline?.find((p) => p.id === active.id);
    if (!item || item.stage === newStage) return;

    if (newStage === "closed_lost") {
      // Ask why it's lost before moving. Skipping still moves the card.
      movingRef.current = false;
      setLossReason("");
      setLossPrompt({ id: item.id, name: item.name, accountId: item.account_id });
      return;
    }

    doMove(item.id, newStage, item.account_id);
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
    <>
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
            gridTemplateColumns: `repeat(${totalColumns}, minmax(260px, 1fr))`,
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
          {unmappedItems.length > 0 && (
            <PipelineColumn
              key={UNMAPPED_COLUMN_ID}
              stage={UNMAPPED_COLUMN_ID}
              items={unmappedItems}
              onCardClick={(id) => navigate(`/opportunities/${id}`)}
              readOnly
              title="Other open"
            />
          )}
        </div>
      </div>
      <DragOverlay>
        {activeItem ? <PipelineCard item={activeItem} isDragging /> : null}
      </DragOverlay>
    </DndContext>

    <Dialog open={!!lossPrompt} onOpenChange={(o) => { if (!o) resolveLoss(false); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Why is this deal lost?</DialogTitle>
          <DialogDescription>
            Moving{" "}
            {lossPrompt?.name ? <strong>{lossPrompt.name}</strong> : "this deal"}{" "}
            to Closed Lost. Add a reason if you have one — it helps win/loss
            reporting. You can skip it and the deal still moves.
          </DialogDescription>
        </DialogHeader>
        <Textarea
          autoFocus
          rows={3}
          value={lossReason}
          onChange={(e) => setLossReason(e.target.value)}
          placeholder="e.g. Went with a competitor, budget, timing, no decision..."
        />
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" onClick={() => resolveLoss(false)}>
            Move without a reason
          </Button>
          <Button onClick={() => resolveLoss(true)} disabled={updateMutation.isPending}>
            Save reason & move
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    {closedLostGuard.dialog}
    </>
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
  // Tab + filters live in the URL so navigating to a deal and coming
  // back (or sharing a link) restores the same view instead of
  // snapping back to the Sales tab.
  const [activeTab, setActiveTab] = useUrlState("tab", "sales");
  const [myDealsParam, setMyDealsParam] = useUrlState("my_deals", "0");
  const myDeals = myDealsParam === "1";
  const setMyDeals = (checked: boolean) => setMyDealsParam(checked ? "1" : "0");
  const [ownerFilter, setOwnerFilter] = useUrlState("owner", "");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingView, setEditingView] = useState<PipelineView | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PipelineView | null>(null);
  const { data: users } = useUsers();
  const { data: pipelineViews } = usePipelineViews();
  const deleteMutation = useDeletePipelineView();

  // A shared/bookmarked ?tab=custom-<id> can point at a view this user
  // can't see (someone else's private view, or a deleted one). Once views
  // have loaded, fall back to Sales instead of rendering a blank board.
  useEffect(() => {
    if (
      activeTab.startsWith("custom-") &&
      pipelineViews !== undefined &&
      !pipelineViews.some((v) => `custom-${v.id}` === activeTab)
    ) {
      setActiveTab("sales");
    }
  }, [activeTab, pipelineViews, setActiveTab]);

  const ownerUserId = myDeals ? profile?.id : ownerFilter || undefined;

  // Bucket by `kind` (new_business vs renewal) — this is the true
  // intent, set by the renewal automation and the form. `team` was
  // drifting (all SF-imported renewals had team='sales'), which made
  // every renewal show up in the Sales tab.
  const { data: salesPipeline, isLoading: salesLoading } = useActivePipeline({
    kind: "new_business",
    owner_user_id: ownerUserId,
  });

  const { data: renewalsPipeline, isLoading: renewalsLoading } =
    useActivePipeline({
      kind: "renewal",
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
              if (checked) setOwnerFilter("");
            }}
          />
          <Label htmlFor="my-deals" className="text-sm cursor-pointer">
            My Deals
          </Label>
        </div>

        {!myDeals && (
          <Select
            value={ownerFilter || "all"}
            onValueChange={(v) => setOwnerFilter(v === "all" ? "" : v)}
          >
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
                        onClick={() => setDeleteTarget(view)}
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

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title="Delete this view?"
        description={
          deleteTarget
            ? `"${deleteTarget.name}" will be permanently deleted. This can't be undone.`
            : ""
        }
        confirmLabel="Delete"
        destructive
        onConfirm={() => {
          const t = deleteTarget;
          setDeleteTarget(null);
          if (t) handleDeleteView(t);
        }}
      />
    </div>
  );
}
