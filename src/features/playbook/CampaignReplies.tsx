// Replies feed — recent reply campaign_events (Campaigns overhaul S7;
// extended S9 with a reply-category badge, an "Open contact" link, and
// "Mark handled" so a reply doesn't require opening Smartlead to notice OR
// to triage). Sits between the template gallery and the Ongoing/Recently
// ended tracker in CampaignsTab.tsx, same border-t/h3 rhythm as those
// sections, collapsible (defaults open) since it's read-only and one more
// thing on the page.

import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, MessageSquareText } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/EmptyState";
import { cn } from "@/lib/utils";
import { formatName, formatRelativeDate, formatDateTime } from "@/lib/formatters";
import { LoadError } from "./LoadError";
import { useCampaignReplies, useMarkReplyHandled, type CampaignReplyRow } from "./api";
import { extractReplyBody, isPositiveReplyCategory } from "./reply-extract";

function replyWho(row: CampaignReplyRow): string {
  const name = formatName(row.enrollment?.first_name ?? "", row.enrollment?.last_name ?? "").trim();
  return name || row.email || "Someone";
}

interface HandledInfo {
  at: string;
  by: string | null;
}

function handledInfo(row: CampaignReplyRow): HandledInfo | null {
  const h = row.payload?.handled as HandledInfo | undefined;
  return h?.at ? h : null;
}

function ReplyRow({
  row,
  handled,
  onMarkHandled,
  marking,
}: {
  row: CampaignReplyRow;
  handled: HandledInfo | null;
  onMarkHandled: () => void;
  marking: boolean;
}) {
  const replyText = extractReplyBody(row.payload);
  const when = row.occurred_at ?? row.created_at;
  const category = row.enrollment?.reply_category ?? null;
  const positive = isPositiveReplyCategory(category);

  return (
    <div className={cn("rounded-md border p-3 space-y-1", handled && "opacity-60")}>
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="text-sm font-medium">
          {replyWho(row)}
          <span className="text-muted-foreground font-normal"> replied in </span>
          {row.campaign?.name ?? "a campaign"}
          {category && (
            <Badge
              variant="secondary"
              className={cn(
                "ml-2 text-[10px] align-middle",
                positive && "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300",
              )}
            >
              {category}
            </Badge>
          )}
        </span>
        <span className="text-xs text-muted-foreground shrink-0" title={formatDateTime(when)}>
          {formatRelativeDate(when)}
        </span>
      </div>
      <p className="text-xs text-muted-foreground italic">
        {replyText || "(reply text unavailable)"}
      </p>
      <div className="flex items-center gap-3 pt-0.5">
        {row.enrollment?.contact_id && (
          <Link to={`/contacts/${row.enrollment.contact_id}`} className="text-xs text-primary hover:underline">
            Open contact
          </Link>
        )}
        {handled ? (
          <span className="text-xs text-muted-foreground">Handled {formatRelativeDate(handled.at)}</span>
        ) : (
          <Button
            size="sm" variant="ghost"
            className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground"
            disabled={marking}
            onClick={onMarkHandled}
          >
            Mark handled
          </Button>
        )}
      </div>
    </div>
  );
}

export function CampaignReplies() {
  const [open, setOpen] = useState(true);
  const [handledOpen, setHandledOpen] = useState(false);
  const { data: replies, isLoading, isError, refetch } = useCampaignReplies();
  const markHandled = useMarkReplyHandled();
  const count = replies?.length ?? 0;

  const { active, handled } = useMemo(() => {
    const active: CampaignReplyRow[] = [];
    const handled: CampaignReplyRow[] = [];
    for (const row of replies ?? []) {
      (handledInfo(row) ? handled : active).push(row);
    }
    return { active, handled };
  }, [replies]);

  return (
    <div className="border-t pt-4 space-y-3">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 text-left"
        onClick={() => setOpen((v) => !v)}
      >
        <h3 className="text-sm font-semibold">
          Replies{count > 0 ? ` (${count})` : ""}
        </h3>
        <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
          </div>
        ) : isError ? (
          <LoadError what="replies" onRetry={() => refetch()} />
        ) : !replies?.length ? (
          <EmptyState
            icon={MessageSquareText}
            title="No replies yet"
            description="Replies will appear here the moment someone answers a campaign email."
          />
        ) : (
          <div className="space-y-3">
            {active.length > 0 && (
              <div className="space-y-2">
                {active.map((row) => (
                  <ReplyRow
                    key={row.id}
                    row={row}
                    handled={null}
                    marking={markHandled.isPending && markHandled.variables === row.id}
                    onMarkHandled={() => markHandled.mutate(row.id)}
                  />
                ))}
              </div>
            )}
            {!active.length && (
              <p className="text-xs text-muted-foreground">Everything's handled — nice work.</p>
            )}
            {handled.length > 0 && (
              <div className="space-y-2">
                <button
                  type="button"
                  className="text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => setHandledOpen((v) => !v)}
                >
                  {handledOpen ? "Hide" : "Show"} handled ({handled.length})
                </button>
                {handledOpen && (
                  <div className="space-y-2">
                    {handled.map((row) => (
                      <ReplyRow
                        key={row.id}
                        row={row}
                        handled={handledInfo(row)}
                        marking={false}
                        onMarkHandled={() => {}}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )
      )}
    </div>
  );
}
