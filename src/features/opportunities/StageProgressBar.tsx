import { cn } from "@/lib/utils";
import { stageLabel, ALL_STAGES } from "@/lib/formatters";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { OpportunityStage } from "@/types/crm";

interface StageProgressBarProps {
  currentStage: OpportunityStage;
  onStageClick?: (stage: OpportunityStage) => void;
}

export function StageProgressBar({ currentStage, onStageClick }: StageProgressBarProps) {
  const currentIndex = ALL_STAGES.indexOf(currentStage);
  const isClosed = currentStage === "closed_won" || currentStage === "closed_lost";
  const isWon = currentStage === "closed_won";
  const isClickable = !!onStageClick;

  return (
    <TooltipProvider>
      <div className="flex gap-1">
        {ALL_STAGES.map((stage, i) => {
          const isCurrent = stage === currentStage;
          const isPast = i < currentIndex;
          const isClosedStage = stage === "closed_won" || stage === "closed_lost";

          let bg = "bg-muted";
          if (isCurrent) {
            bg = isWon ? "bg-emerald-500" : currentStage === "closed_lost" ? "bg-red-500" : "bg-primary";
          } else if (isPast && !isClosedStage) {
            bg = "bg-primary/40";
          } else if (isClosed && !isClosedStage && i < 4) {
            bg = isWon ? "bg-emerald-300" : "bg-red-300";
          }

          const segment = (
            <div
              key={stage}
              className={cn("flex-1", isClickable && "cursor-pointer")}
              onClick={isClickable ? () => onStageClick(stage) : undefined}
            >
              <div className={cn(
                "h-2 rounded-full transition-colors",
                bg,
                isClickable && "hover:opacity-80"
              )} />
              <p className={cn(
                "text-[10px] mt-1 text-center",
                isCurrent ? "font-semibold text-foreground" : "text-muted-foreground"
              )}>
                {stageLabel(stage)}
              </p>
            </div>
          );

          if (isClickable && !isCurrent) {
            return (
              <Tooltip key={stage}>
                <TooltipTrigger asChild>{segment}</TooltipTrigger>
                <TooltipContent>
                  <p>Click to change to {stageLabel(stage)}</p>
                </TooltipContent>
              </Tooltip>
            );
          }

          return segment;
        })}
      </div>
    </TooltipProvider>
  );
}
