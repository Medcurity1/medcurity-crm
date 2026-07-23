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
import { PipelineRunnerGame } from "@/features/pipeline-runner/PipelineRunnerGame";
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
import { QueryError } from "@/components/QueryError";
import { toast } from "sonner";
import { Plus, MoreVertical, Pencil, Trash2, DollarSign, Hash, TrendingUp, ArrowUpDown } from "lucide-react";
import { OPEN_STAGES, formatCurrency, stageLabel } from "@/lib/formatters";
import { celebrateClosedWon } from "@/lib/confetti";
import { supabase } from "@/lib/supabase";
import { checkCloseReadiness, formatCloseReadinessMessage } from "@/lib/closeReadiness";
import { useClosedLostGuard } from "./useClosedLostGuard";
import type {
  ActivePipelineRow,
  OpportunityStage,
  PipelineView,
} from "@/types/crm";

/** How cards are ordered inside each stage column (Summer, 7/22: "sort by
 * close date in each of the categories" for Joe's business tracker). Lives
 * in the URL (?sort=) like the other board filters so a shared/bookmarked
 * tracker link keeps its ordering. Cards were previously amount-ordered
 * (the query's default) with no way to change it. */
type PipelineCardSort = "close" | "amount" | "name";

function sortCards(items: ActivePipelineRow[], sortBy: PipelineCardSort): ActivePipelineRow[] {
  return [...items].sort((a, b) => {
    if (sortBy === "amount") return Number(b.amount) - Number(a.amount);
    if (sortBy === "name") return a.name.localeCompare(b.name);
    // Close date: soonest at the top; undated deals sink to the bottom
    // (alphabetical among themselves so the order is stable).
    if (!a.expected_close_date && !b.expected_close_date) return a.name.localeCompare(b.name);
    if (!a.expected_close_date) return 1;
    if (!b.expected_close_date) return -1;
    return a.expected_close_date.localeCompare(b.expected_close_date);
  });
}

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
      <Card className="transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md hover:shadow-emerald-500/10">
        <CardContent className="flex items-center gap-3 py-3.5 px-4">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-500/20 to-emerald-500/[0.04]">
            <DollarSign className="h-4 w-4 text-emerald-500" />
          </span>
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">Total Pipeline Value</p>
            <p className="text-lg font-semibold tabular-nums">{formatCurrency(totalValue)}</p>
          </div>
        </CardContent>
      </Card>
      <Card className="transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md hover:shadow-blue-500/10">
        <CardContent className="flex items-center gap-3 py-3.5 px-4">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-blue-500/20 to-blue-500/[0.04]">
            <Hash className="h-4 w-4 text-blue-500" />
          </span>
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">Deal Count</p>
            <p className="text-lg font-semibold tabular-nums">{dealCount}</p>
          </div>
        </CardContent>
      </Card>
      <Card className="transition-all duration-200 hover:-translate-y-0.5 hover:shadow-md hover:shadow-violet-500/10">
        <CardContent className="flex items-center gap-3 py-3.5 px-4">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-violet-500/20 to-violet-500/[0.04]">
            <TrendingUp className="h-4 w-4 text-violet-500" />
          </span>
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">Average Deal Size</p>
            <p className="text-lg font-semibold tabular-nums">{formatCurrency(avgDealSize)}</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

interface PipelineKanbanProps {
  pipeline: ActivePipelineRow[] | undefined;
  isLoading: boolean;
  stages?: OpportunityStage[];
  sortBy: PipelineCardSort;
}

function PipelineKanban({
  pipeline,
  isLoading,
  stages,
  sortBy,
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

  async function doMove(id: string, newStage: OpportunityStage, accountId: string | null, reason?: string) {
    // Close-readiness gate (Rachel): block a drag INTO Closed Won until the
    // account has complete client info. Returning without mutating leaves the
    // card in its source column — there's no optimistic move to undo, so the
    // card simply snaps back on drop.
    if (newStage === "closed_won") {
      const { ready, missing } = await checkCloseReadiness(supabase, accountId, id);
      if (!ready) {
        toast.error(formatCloseReadinessMessage(missing));
        return;
      }
    }
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
          toast.success(`Stage changed to ${stageLabel(newStage)}`);
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
    items: sortCards(pipeline?.filter((p) => p.stage === stage) ?? [], sortBy),
  }));

  // Open deals whose stage isn't one of the board's columns (legacy Lead/
  // Qualified, or any open stage we don't render) would otherwise silently
  // vanish from the board while still counting on the Home page and the stats
  // above — the "2 deals missing" report. Surface them in a read-only catch-all
  // so the board never loses a deal; reps can drag a stray into a real stage.
  const unmappedItems = sortCards(
    pipeline?.filter((p) => !displayStages.includes(p.stage)) ?? [],
    sortBy
  );
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

// Shared tab body: stats + board, but swaps in a retryable QueryError when the
// query fails instead of silently painting an all-empty board (a rep would
// think their deals vanished). Recovery is one click instead of a full reload.
function PipelineTabBody({
  pipeline,
  isLoading,
  isError,
  onRetry,
  isRetrying,
  stages,
  sortBy,
}: {
  pipeline: ActivePipelineRow[] | undefined;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  isRetrying: boolean;
  stages?: OpportunityStage[];
  sortBy: PipelineCardSort;
}) {
  if (isError) {
    return (
      <QueryError
        message="Couldn't load this pipeline."
        onRetry={onRetry}
        isRetrying={isRetrying}
      />
    );
  }

  return (
    <>
      <PipelineStats items={pipeline ?? []} />
      <PipelineKanban pipeline={pipeline} isLoading={isLoading} stages={stages} sortBy={sortBy} />
    </>
  );
}

// Renewals is the non-default tab. Calling its hook inside the child (which
// Radix only mounts once the tab is activated) keeps the initial Sales-tab
// load from firing a second, hidden active_pipeline fetch on every mount.
function RenewalsPipelineTab({
  ownerUserId,
  sortBy,
}: {
  ownerUserId: string | undefined;
  sortBy: PipelineCardSort;
}) {
  const { data: pipeline, isLoading, isError, isFetching, refetch } =
    useActivePipeline({ kind: "renewal", owner_user_id: ownerUserId });

  return (
    <PipelineTabBody
      pipeline={pipeline}
      isLoading={isLoading}
      isError={isError}
      onRetry={() => refetch()}
      isRetrying={isFetching}
      sortBy={sortBy}
    />
  );
}

function CustomViewTab({
  view,
  ownerUserId,
  sortBy,
}: {
  view: PipelineView;
  ownerUserId: string | undefined;
  sortBy: PipelineCardSort;
}) {
  const { data: pipeline, isLoading, isError, isFetching, refetch } =
    useCustomPipeline({
      stages: view.config.stages,
      team_filter: view.config.team_filter,
      kind_filter: view.config.kind_filter,
      owner_user_id: ownerUserId,
    });

  return (
    <PipelineTabBody
      pipeline={pipeline}
      isLoading={isLoading}
      isError={isError}
      onRetry={() => refetch()}
      isRetrying={isFetching}
      stages={view.config.stages}
      sortBy={sortBy}
    />
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
  // Card order within each column. Close date is the default (Summer's
  // ask for Joe's business tracker); "amount" restores the old behavior.
  const [sortParam, setSortParam] = useUrlState("sort", "close");
  const sortBy: PipelineCardSort =
    sortParam === "amount" || sortParam === "name" ? sortParam : "close";
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
  //
  // Only the default Sales tab fetches eagerly here; the Renewals tab's hook
  // lives in RenewalsPipelineTab so it fetches only once that tab is opened.
  const {
    data: salesPipeline,
    isLoading: salesLoading,
    isError: salesError,
    isFetching: salesFetching,
    refetch: refetchSales,
  } = useActivePipeline({
    kind: "new_business",
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
      {/* Hidden easter egg — triple-click the Pipeline nav label to play.
          Renders nothing (zero cost) unless launched. */}
      <PipelineRunnerGame />

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

        <div className="ml-auto flex items-center gap-2">
          <ArrowUpDown className="h-3.5 w-3.5 text-muted-foreground" />
          <Label htmlFor="pipeline-sort" className="text-sm text-muted-foreground hidden sm:block">
            Sort cards
          </Label>
          <Select value={sortBy} onValueChange={setSortParam}>
            <SelectTrigger id="pipeline-sort" className="w-52">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="close">Close date — soonest first</SelectItem>
              <SelectItem value="amount">Amount — largest first</SelectItem>
              <SelectItem value="name">Deal name — A to Z</SelectItem>
            </SelectContent>
          </Select>
        </div>
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
          <PipelineTabBody
            pipeline={salesPipeline}
            isLoading={salesLoading}
            isError={salesError}
            onRetry={() => refetchSales()}
            isRetrying={salesFetching}
            sortBy={sortBy}
          />
        </TabsContent>

        <TabsContent value="renewals" className="mt-4">
          <RenewalsPipelineTab ownerUserId={ownerUserId} sortBy={sortBy} />
        </TabsContent>

        {pipelineViews?.map((view) => (
          <TabsContent
            key={view.id}
            value={`custom-${view.id}`}
            className="mt-4"
          >
            <CustomViewTab view={view} ownerUserId={ownerUserId} sortBy={sortBy} />
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
