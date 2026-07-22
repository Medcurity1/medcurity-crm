// Replies feed — recent EMAIL_REPLIED campaign_events (Campaigns overhaul
// S7), so a reply doesn't require opening Smartlead to notice. Sits between
// the template gallery and the Ongoing/Recently ended tracker in
// CampaignsTab.tsx, same border-t/h3 rhythm as those sections, collapsible
// (defaults open) since it's read-only and one more thing on the page.

import { useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, MessageSquareText } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/EmptyState";
import { cn } from "@/lib/utils";
import { formatName, formatRelativeDate, formatDateTime } from "@/lib/formatters";
import { LoadError } from "./LoadError";
import { useCampaignReplies, type CampaignReplyRow } from "./api";
import { extractReplyBody } from "./reply-extract";

function replyWho(row: CampaignReplyRow): string {
  const name = formatName(row.enrollment?.first_name ?? "", row.enrollment?.last_name ?? "").trim();
  return name || row.email || "Someone";
}

export function CampaignReplies() {
  const [open, setOpen] = useState(true);
  const { data: replies, isLoading, isError, refetch } = useCampaignReplies();
  const count = replies?.length ?? 0;

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
          <div className="space-y-2">
            {replies.map((row) => {
              const replyText = extractReplyBody(row.payload);
              const when = row.occurred_at ?? row.created_at;
              return (
                <div key={row.id} className="rounded-md border p-3 space-y-1">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className="text-sm font-medium">
                      {row.enrollment?.contact_id ? (
                        <Link to={`/contacts/${row.enrollment.contact_id}`} className="text-primary hover:underline">
                          {replyWho(row)}
                        </Link>
                      ) : (
                        replyWho(row)
                      )}
                      <span className="text-muted-foreground font-normal"> replied in </span>
                      {row.campaign?.name ?? "a campaign"}
                    </span>
                    <span className="text-xs text-muted-foreground shrink-0" title={formatDateTime(when)}>
                      {formatRelativeDate(when)}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground italic">
                    {replyText || "(reply text unavailable)"}
                  </p>
                </div>
              );
            })}
          </div>
        )
      )}
    </div>
  );
}
