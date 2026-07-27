import { Bot } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * Machine-created activities are stamped owner = the account/opp owner, so
 * every feed shows the owner's name as if they wrote the row themselves
 * (Summer's 7/22 follow-up). This badge is the tell.
 *
 * Detection is flag OR campaign linkage: renewal signature tasks carry
 * `created_by_automation` (backfilled + stamped by the generator since
 * 20260727160000); campaign-spawned rows carry `campaign_enrollment_id`,
 * which keeps them badged even for rows the edge fn wrote before it learns
 * the new column.
 */
export function isAutomationActivity(a: {
  created_by_automation?: boolean | null;
  campaign_enrollment_id?: string | null;
}): boolean {
  return !!a.created_by_automation || !!a.campaign_enrollment_id;
}

export function AutomationBadge({ className }: { className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant="outline"
          className={cn(
            "gap-1 border-border/60 bg-muted/60 text-muted-foreground font-normal align-middle",
            className,
          )}
        >
          <Bot className="h-3 w-3" aria-hidden />
          Automation
        </Badge>
      </TooltipTrigger>
      <TooltipContent className="max-w-[240px]">
        Pulse created this automatically. The name shown is who it's assigned
        to, not who wrote it.
      </TooltipContent>
    </Tooltip>
  );
}
