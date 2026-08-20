// "Sending inboxes" panel (Campaigns overhaul Phase 5) — plain-English
// warmup health + how much daily volume each Smartlead sending inbox is
// already carrying, so a rep can tell whether an inbox is safe to load up
// more without opening Smartlead. Lazy: the inbox-health edge action (a
// live warmup-stats round trip per inbox, capped at 10 server-side) only
// fires while this dialog is actually open — see useInboxHealth in api.ts.

import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryError } from "@/components/QueryError";
import { useInboxHealth, type InboxHealthEntry } from "./api";

/** Plain-English badge for an inbox's warmup state. Deliberately reads as
 *  "no data" rather than a false "healthy" when Smartlead's warmup-stats
 *  endpoint didn't return anything usable (unverified endpoint shape — see
 *  the edge function's fetchInboxWarmup doc comment) — an unknown inbox
 *  should never look reassuring. */
function warmupBadge(w: InboxHealthEntry["warmup"]): { label: string; className: string } {
  if (!w || (w.spam_rate == null && w.status == null && w.sent_7d == null)) {
    return { label: "No warmup data", className: "bg-muted text-muted-foreground" };
  }
  if (w.spam_rate != null && w.spam_rate >= 5) {
    return {
      label: `Spam risk: ${w.spam_rate}% landing in spam`,
      className: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300",
    };
  }
  if (w.status && /paus|error|fail/i.test(w.status)) {
    return { label: "Warmup paused", className: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300" };
  }
  return { label: "Warming well", className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" };
}

export function InboxHealthDialog({
  open, onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { data: inboxes, isLoading, isError, isFetching, refetch } = useInboxHealth(open);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="camp-scope camp-shell sm:max-w-xl max-h-[85vh] overflow-y-auto p-6 gap-4">
        <DialogHeader>
          <DialogTitle>Sending inboxes</DialogTitle>
          <DialogDescription>
            Warmup health and today's load, straight from Smartlead.
          </DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)}
          </div>
        ) : isError ? (
          <QueryError
            message="Couldn't load inbox health."
            onRetry={() => refetch()}
            isRetrying={isFetching}
          />
        ) : !inboxes?.length ? (
          <p className="text-sm text-muted-foreground">No sending inboxes found in Smartlead.</p>
        ) : (
          <div className="space-y-2">
            {inboxes.map((ib) => {
              const badge = warmupBadge(ib.warmup);
              const label = ib.from_email ?? ib.from_name ?? `Inbox ${ib.id}`;
              const headroom = ib.daily_limit != null ? Math.max(0, ib.daily_limit - ib.total_leads_per_day) : null;
              return (
                <div key={ib.id} className="camp-card p-3 space-y-1">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className="text-sm font-medium truncate min-w-0">{label}</span>
                    <Badge variant="secondary" className={badge.className}>{badge.label}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {ib.daily_limit != null ? `${ib.daily_limit}/day limit` : "Daily limit unknown"}
                    {ib.warmup?.sent_7d != null ? ` · ${ib.warmup.sent_7d} sent last 7 days` : ""}
                    {headroom != null
                      ? ` · room for ~${headroom} more/day`
                      : ib.total_leads_per_day > 0 ? " · remaining room unknown" : ""}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {ib.campaigns.length > 0
                      ? `Feeding ${ib.campaigns.length === 1 ? ib.campaigns[0].name : `${ib.campaigns.length} campaigns`} · ${ib.total_leads_per_day} new/day`
                      : "Not feeding any active campaigns"}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
