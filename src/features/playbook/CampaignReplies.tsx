// Replies feed — recent reply campaign_events (Campaigns overhaul S7;
// extended S9 with a reply-category badge, an "Open contact" link, and
// "Mark handled" so a reply doesn't require opening Smartlead to notice OR
// to triage). Independently collapsible with the other Campaigns home
// groups; expanded by default when nonempty, user-toggleable.

import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, MessageSquareText } from "lucide-react";
import { campaignGroupOpen } from "./campaign-groups";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/EmptyState";
import { cn } from "@/lib/utils";
import { formatName, formatRelativeDate, formatDateTime } from "@/lib/formatters";
import { useAuth } from "@/features/auth/AuthProvider";
import { QueryError } from "@/components/QueryError";
import { useCampaignReplies, useMarkReplyHandled, useLogReplyCall, type CampaignReplyRow } from "./api";
import { extractReplyBody, isPositiveReplyCategory, replySubject, mailtoRecipient } from "./reply-extract";

function replyWho(row: CampaignReplyRow): string {
  const name = formatName(row.enrollment?.first_name ?? "", row.enrollment?.last_name ?? "").trim();
  return name || row.email || "Someone";
}

interface HandledInfo {
  at: string;
  by: string | null;
}

/** The feed's definition of "this reply is handled" — a real mark-handled
 *  stamp with a timestamp, not any truthy `handled` key (the payload is the
 *  raw webhook body, so a vendor field could collide). The tracker's
 *  "N replies waiting" tally no longer derives from this feed — it filters
 *  on the handled_at COLUMN via its own uncapped query (outside-review I35,
 *  useUnhandledReplyCounts) — but the two can't disagree: mark-reply-handled
 *  stamps payload.handled and handled_at in the same UPDATE, and
 *  20260731100000 backfilled history. */
function handledInfo(row: CampaignReplyRow): HandledInfo | null {
  const h = row.payload?.handled as HandledInfo | undefined;
  return h?.at ? h : null;
}

// replySubject / mailtoRecipient (the Reply button's mailto injection
// guards) live in reply-extract.ts (extracted 2026-07-31, docket I38, so
// tests/campaignReplyMailto.test.ts can pin them) — imported above.

function ReplyRow({
  row,
  handled,
  onMarkHandled,
  marking,
  onLogCall,
  loggingCall,
  callLogged,
}: {
  row: CampaignReplyRow;
  handled: HandledInfo | null;
  onMarkHandled: () => void;
  marking: boolean;
  onLogCall: (outcome: "Call - Spoke" | "Call - Left VM" | "Call - No answer") => void;
  loggingCall: boolean;
  callLogged: boolean;
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
      {/* Actions (outside-review I28): answer, log the call, or open a deal
          right here — the point of a reply is the next step, not a detour
          through Outlook and three other tabs. */}
      <div className="flex items-center gap-3 pt-0.5 flex-wrap">
        {mailtoRecipient(row.email) && (
          <a
            href={`mailto:${mailtoRecipient(row.email)}?subject=${encodeURIComponent(replySubject(row.payload, row.campaign?.name))}`}
            className="text-xs text-primary hover:underline"
            title="Opens a reply in your email app"
          >
            Reply by email
          </a>
        )}
        {row.enrollment?.contact_id && (
          callLogged ? (
            <span className="text-xs text-muted-foreground">Call logged</span>
          ) : (
            <span className="inline-flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground">Log:</span>
              {(["Call - Spoke", "Call - Left VM", "Call - No answer"] as const).map((outcome) => (
                <button
                  key={outcome}
                  type="button"
                  className="text-xs text-primary hover:underline disabled:opacity-50"
                  disabled={loggingCall}
                  onClick={() => onLogCall(outcome)}
                >
                  {loggingCall ? "Logging…" : outcome.replace("Call - ", "")}
                </button>
              ))}
            </span>
          )
        )}
        {row.enrollment?.account_id && (
          <Link
            to={`/opportunities/new?account_id=${row.enrollment.account_id}`}
            className="text-xs text-primary hover:underline"
            title="Start a new deal on this account"
          >
            New deal
          </Link>
        )}
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
  const [openOverride, setOpenOverride] = useState<boolean | undefined>(undefined);
  const [handledOpen, setHandledOpen] = useState(false);
  const { data: replies, isLoading, isError, refetch } = useCampaignReplies();
  const markHandled = useMarkReplyHandled();
  const logCall = useLogReplyCall();
  const { profile } = useAuth();
  const count = replies?.length ?? 0;
  const open = campaignGroupOpen("replies", isLoading ? 1 : count, false, openOverride);
  // Rows whose call has already been logged this session — the button
  // becomes a static "Call logged" so a second click can't write a second
  // call row (adversarial review). loggingRowId keys the in-flight spinner
  // to the exact ROW clicked — matching on contact_id lit every row for
  // that contact at once (final-sweep catch).
  const [calledRowIds, setCalledRowIds] = useState<Set<string>>(new Set());
  const [loggingRowId, setLoggingRowId] = useState<string | null>(null);

  function logCallFor(row: CampaignReplyRow, outcome: "Call - Spoke" | "Call - Left VM" | "Call - No answer") {
    if (!row.enrollment?.contact_id || calledRowIds.has(row.id) || loggingRowId) return;
    setLoggingRowId(row.id);
    logCall.mutate(
      {
        contact_id: row.enrollment.contact_id,
        account_id: row.enrollment.account_id ?? null,
        owner_user_id: profile?.id ?? null,
        campaignName: row.campaign?.name ?? null,
        outcome,
      },
      {
        onSuccess: () => setCalledRowIds((prev) => new Set(prev).add(row.id)),
        onSettled: () => setLoggingRowId(null),
      },
    );
  }

  const { active, handled } = useMemo(() => {
    const active: CampaignReplyRow[] = [];
    const handled: CampaignReplyRow[] = [];
    for (const row of replies ?? []) {
      (handledInfo(row) ? handled : active).push(row);
    }
    return { active, handled };
  }, [replies]);

  return (
    <section className="space-y-3" data-campaigns-group="replies">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 text-left"
        aria-expanded={open}
        onClick={() => setOpenOverride(!open)}
      >
        <h3 className="text-sm font-semibold">
          Replies ({isLoading ? "…" : count})
        </h3>
        <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        isLoading ? (
          <div className="space-y-2">
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}
          </div>
        ) : isError ? (
          <QueryError message="Couldn't load replies." onRetry={() => refetch()} />
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
                    onLogCall={(outcome) => logCallFor(row, outcome)}
                    loggingCall={loggingRowId === row.id}
                    callLogged={calledRowIds.has(row.id)}
                  />
                ))}
              </div>
            )}
            {!active.length && (
              <p className="text-xs text-muted-foreground">Everything's handled. Nice work.</p>
            )}
            {handled.length > 0 && (
              <div className="space-y-2">
                <button
                  type="button"
                  className="text-xs text-muted-foreground hover:text-foreground"
                  aria-expanded={handledOpen}
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
                        onLogCall={(outcome) => logCallFor(row, outcome)}
                        loggingCall={loggingRowId === row.id}
                        callLogged={calledRowIds.has(row.id)}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )
      )}
    </section>
  );
}
