import { useDraggable } from "@dnd-kit/core";
import { User } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatCurrency, daysUntil, formatDate } from "@/lib/formatters";
import type { ActivePipelineRow } from "@/types/crm";

interface PipelineCardProps {
  item: ActivePipelineRow;
  onClick?: () => void;
  isDragging?: boolean;
}

export function PipelineCard({ item, onClick, isDragging }: PipelineCardProps) {
  const { attributes, listeners, setNodeRef, transform } = useDraggable({
    id: item.id,
  });

  const days = daysUntil(item.expected_close_date);
  let daysLabel = "";
  let daysColor = "text-muted-foreground";
  if (days !== null) {
    if (days < 0) {
      daysLabel = `${Math.abs(days)}d overdue`;
      daysColor = "text-destructive";
    } else if (days === 0) {
      daysLabel = "Today";
      daysColor = "text-warning";
    } else {
      daysLabel = `in ${days}d`;
    }
  }

  const style = transform
    ? { transform: `translate(${transform.x}px, ${transform.y}px)` }
    : undefined;

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      onClick={onClick}
      className={cn(
        "bg-card border rounded-lg p-3 cursor-grab active:cursor-grabbing shadow-sm hover:shadow-md transition-shadow",
        isDragging && "opacity-50 shadow-lg rotate-2"
      )}
    >
      <p className="text-xs text-muted-foreground truncate">{item.account_name}</p>
      <p className="font-medium text-sm truncate mt-0.5">{item.name}</p>
      <div className="flex items-center justify-between mt-2">
        <span className="text-sm font-semibold text-primary">
          {formatCurrency(item.amount)}
        </span>
        {daysLabel && (
          <span className={cn("text-xs", daysColor)}>{daysLabel}</span>
        )}
      </div>
      {/* Owner + close date line — feedback from Summer 2026-04-19:
          "Add owner names and close date to deal cards." */}
      <div className="flex items-center justify-between mt-2 pt-2 border-t text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1 truncate">
          <User className="h-3 w-3 shrink-0" />
          <span className="truncate">{item.owner_name ?? "Unassigned"}</span>
        </span>
        {item.expected_close_date && (
          <span className="shrink-0">{formatDate(item.expected_close_date)}</span>
        )}
      </div>
    </div>
  );
}
