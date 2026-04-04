import { useDroppable } from "@dnd-kit/core";
import { cn } from "@/lib/utils";
import { stageLabel, formatCurrency } from "@/lib/formatters";
import { PipelineCard } from "./PipelineCard";
import type { ActivePipelineRow, OpportunityStage } from "@/types/crm";

interface PipelineColumnProps {
  stage: OpportunityStage;
  items: ActivePipelineRow[];
  onCardClick: (id: string) => void;
}

export function PipelineColumn({ stage, items, onCardClick }: PipelineColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: stage });
  const totalAmount = items.reduce((sum, item) => sum + Number(item.amount), 0);

  return (
    <div
      ref={setNodeRef}
      className={cn(
        "flex flex-col rounded-lg border bg-muted/30 transition-colors min-h-[200px]",
        isOver && "bg-primary/5 border-primary/30"
      )}
    >
      <div className="p-3 border-b bg-muted/50 rounded-t-lg">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-sm">{stageLabel(stage)}</h3>
          <span className="text-xs text-muted-foreground bg-background rounded-full px-2 py-0.5">
            {items.length}
          </span>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          {formatCurrency(totalAmount)}
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
