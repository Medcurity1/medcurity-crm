import { useDroppable } from "@dnd-kit/core";
import { cn } from "@/lib/utils";
import { stageLabel, formatCurrency } from "@/lib/formatters";
import { PipelineCard } from "./PipelineCard";
import type { ActivePipelineRow, OpportunityStage } from "@/types/crm";

// Droppable id for the read-only catch-all column (open deals on a stage the
// board doesn't show, e.g. legacy Lead/Qualified). The board ignores drops on
// this id, so a stray can be dragged OUT into a real stage but a drop back ON
// it is a no-op rather than an accidental move.
export const UNMAPPED_COLUMN_ID = "__unmapped__" as const;

interface PipelineColumnProps {
  stage: OpportunityStage | typeof UNMAPPED_COLUMN_ID;
  items: ActivePipelineRow[];
  onCardClick: (id: string) => void;
  readOnly?: boolean;
  title?: string;
  subtitle?: string;
}

export function PipelineColumn({ stage, items, onCardClick, readOnly = false, title, subtitle }: PipelineColumnProps) {
  // Stays an ENABLED droppable even when read-only — the board guards the drop
  // by id. A disabled droppable would be excluded from collision detection, so
  // releasing a card near it would snap to the wrong neighbouring column.
  const { setNodeRef, isOver } = useDroppable({ id: stage });
  const totalAmount = items.reduce((sum, item) => sum + Number(item.amount), 0);

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex flex-col rounded-lg border bg-muted/30 transition-colors min-h-[200px]",
        isOver && !readOnly && "bg-primary/5 border-primary/30",
        readOnly && "border-dashed"
      )}
    >
      <div className="p-3 border-b bg-muted/50 rounded-t-lg">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-sm">{title ?? stageLabel(stage as OpportunityStage)}</h3>
          <span className="text-xs text-muted-foreground bg-background rounded-full px-2 py-0.5">
            {items.length}
          </span>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          {subtitle ?? formatCurrency(totalAmount)}
        </p>
      </div>
      <div className="flex-1 p-2 space-y-2">
        {items.map((item) => (
          <PipelineCard
            key={item.id}
            item={item}
            onClick={() => onCardClick(item.id)}
          />
        ))}
      </div>
    </div>
  );
}
