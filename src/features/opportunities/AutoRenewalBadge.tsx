import { RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/**
 * Renewal deals are created by the daily renewal automation, and the generator
 * copies the previous contract's NAME, amount and next-step verbatim. In a list
 * that reads as the rep's own closed deal coming back from the dead — Margaret
 * reported it as "Pulse is reopening closed opportunities" on 2026-07-21, and
 * again on 2026-07-27 after the ghost-stage fix made these rows visible.
 *
 * This tag is the "new renewal, not your old deal" marker. Deliberately a badge
 * and NOT a rename: the deal's real name stays intact, so reports, exports and
 * the SF-era naming are untouched and the tag can be pulled back out with no
 * data cleanup.
 */

/** A deal the renewal automation generated from a previous closed-won contract. */
export function isAutoRenewal(opp: {
  created_by_automation?: boolean | null;
  renewal_from_opportunity_id?: string | null;
}): boolean {
  // Both flags, not either: `created_by_automation` alone is also true for
  // the Salesforce-imported renewals (they carry the flag but no parent link),
  // and a parent link alone can be set by hand on a rep-created renewal.
  return !!opp.created_by_automation && !!opp.renewal_from_opportunity_id;
}

export function AutoRenewalBadge({ className }: { className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant="outline"
          className={cn(
            "gap-1 border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-400 font-normal align-middle",
            className,
          )}
        >
          <RefreshCw className="h-3 w-3" aria-hidden />
          Auto-renewal
        </Badge>
      </TooltipTrigger>
      <TooltipContent className="max-w-[260px]">
        Pulse created this deal automatically for the upcoming contract renewal.
        It copies the previous deal's name and amount, so it looks like the one
        you already closed. It is a new deal, not the old one reopened.
      </TooltipContent>
    </Tooltip>
  );
}
