// Campaign detail sheet (Campaigns overhaul S8) — the full-height view that
// opens when a rep clicks a campaign card in the tracker. Header mirrors the
// card (status, owner, inbox, origin, anchor date, Smartlead link, the same
// Start/Pause/Resume/Stop controls), then the frozen sequence, aggregate
// metrics, a person-by-person table with per-person Pause/Resume/Stop, and
// the last 20 webhook events for this campaign. Nothing here is a second
// source of truth: the campaign row is the one CampaignsTab already has
// loaded (via useCampaigns), and the two new queries below (enrollments,
// events) are lazy — they only fire while the sheet is actually open.

import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { ExternalLink, Loader2, Pause, PlayCircle, Search, Square } from "lucide-react";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { formatName, formatDate, formatDateOnly, formatDateTime, formatRelativeDate, formatCurrency } from "@/lib/formatters";
import { cn } from "@/lib/utils";
import { LoadError } from "./LoadError";
import { SequenceTimeline } from "./SequenceTimeline";
import { STATUS_META, originHint, CampaignStatusControls, type CampaignRow } from "./CampaignCard";
import {
  smartleadUrl, useCampaignEnrollments, useCampaignEvents, useCampaignEventStats, useSetEnrollmentStatus,
  useSetCampaignStatus, useCampaignTouchStats, useCampaignInfluence,
  useRepairCampaignWebhook, useGenerateCampaignInsights,
  type CampaignEnrollmentRow, type CampaignEventRow, type EnrollmentStatusAction,
} from "./api";

const ENROLLMENT_STATUS_META: Record<string, { label: string; className: string }> = {
  active: { label: "Active", className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300" },
  paused: { label: "Paused", className: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300" },
  replied: { label: "Replied", className: "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300" },
  bounced: { label: "Bounced", className: "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300" },
  stopped: { label: "Stopped", className: "bg-muted text-muted-foreground" },
  completed: { label: "Completed", className: "" },
};

const ENROLLMENT_TERMINAL = ["completed", "stopped", "replied", "bounced"];

// Covers both the canonical event-type spelling and Smartlead's actual raw
// names (verified live 2026-07-22 — see playbook-smartlead/index.ts's
// SMARTLEAD_WEBHOOK_EVENT_TYPES comment) since campaign_events.event_type
// stores whichever one a given row's source preferred.
const EVENT_LABEL: Record<string, string> = {
  EMAIL_SENT: "Email sent to",
  EMAIL_OPENED: "Email opened by",
  EMAIL_OPEN: "Email opened by",
  EMAIL_CLICKED: "Link clicked by",
  EMAIL_LINK_CLICK: "Link clicked by",
  EMAIL_REPLIED: "Reply from",
  EMAIL_REPLY: "Reply from",
  EMAIL_BOUNCED: "Email bounced for",
  EMAIL_BOUNCE: "Email bounced for",
  EMAIL_UNSUBSCRIBED: "Unsubscribed:",
  LEAD_UNSUBSCRIBED: "Unsubscribed:",
};

function humanizeEvent(ev: CampaignEventRow): string {
  const label = EVENT_LABEL[ev.event_type] ?? ev.event_type.replace(/_/g, " ").toLowerCase();
  return `${label} ${ev.email ?? "someone"}`;
}

function enrollmentSubtitle(e: CampaignEnrollmentRow): string | null {
  if (e.status === "replied" && e.replied_at) return `Replied ${formatRelativeDate(e.replied_at)}`;
  if (e.status === "bounced" && e.bounced_at) return `Bounced ${formatRelativeDate(e.bounced_at)}`;
  if (e.status === "stopped") return e.paused_reason === "stopped_by_user" ? "Stopped by a teammate" : "Stopped";
  if (e.status === "paused" && e.paused_reason === "meeting_booked") return "Paused — opportunity opened";
  if (e.status === "paused" && e.paused_reason === "paused_by_user") return "Paused by a teammate";
  if (e.status === "completed") return "Finished the sequence";
  return null;
}

export function CampaignDetailSheet({
  campaign,
  open,
  onOpenChange,
  setStatus,
  inboxLabel,
}: {
  campaign: CampaignRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  setStatus: ReturnType<typeof useSetCampaignStatus>;
  inboxLabel?: string | null;
}) {
  const campaignId = campaign?.id ?? null;
  const { data: enrollments, isLoading: enrollmentsLoading } = useCampaignEnrollments(campaignId);
  const { data: events, isLoading: eventsLoading } = useCampaignEvents(campaignId);
  const { data: eventStats } = useCampaignEventStats(campaignId);
  const touchStatsQ = useCampaignTouchStats(campaignId);
  const touchStats = touchStatsQ.data;
  const influenceQ = useCampaignInfluence(campaignId);
  const influence = influenceQ.data;
  const setEnrollment = useSetEnrollmentStatus();
  const repairWebhook = useRepairCampaignWebhook();
  const freshInsights = useGenerateCampaignInsights();
  const [search, setSearch] = useState("");
  const [stopTarget, setStopTarget] = useState<CampaignEnrollmentRow | null>(null);

  const filteredEnrollments = useMemo(() => {
    const rows = enrollments ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((e) => {
      const hay = `${e.first_name ?? ""} ${e.last_name ?? ""} ${e.email ?? ""} ${e.company ?? ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [enrollments, search]);

  const enrollmentStats = useMemo(() => {
    const rows = enrollments ?? [];
    const out = { total: rows.length, active: 0, paused: 0, replied: 0, bounced: 0, stopped: 0, completed: 0 };
    for (const e of rows) {
      if (e.status in out) (out as unknown as Record<string, number>)[e.status]++;
    }
    return out;
  }, [enrollments]);

  const totalEmailSteps = useMemo(
    () => (campaign?.steps ?? []).filter((s) => s.channel === "EMAIL_AUTO").length,
    [campaign?.steps],
  );

  if (!campaign) return null;
  const c = campaign;
  const statusMeta = STATUS_META[c.status] ?? { label: c.status, className: "" };
  const hint = originHint(c);
  const url = smartleadUrl(c.smartlead_campaign_id);

  function runEnrollmentAction(e: CampaignEnrollmentRow, action: EnrollmentStatusAction) {
    setEnrollment.mutate(
      { enrollment_id: e.id, action, campaign_id: c.id },
      {
        onSuccess: (r) => {
          if (r.warning) { toast.warning(r.warning); return; }
          if (action === "stop") toast.success("Stopped — their scheduled tasks are cancelled.");
          else if (action === "pause") toast.success("Paused.");
          else toast.success("Resumed.");
        },
      },
    );
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-2xl flex flex-col gap-0 p-0">
        <SheetHeader className="border-b px-5 py-4 gap-3 pr-10">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <SheetTitle className="truncate">{c.name}</SheetTitle>
                <Badge variant="secondary" className={statusMeta.className}>{statusMeta.label}</Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {c.owner?.full_name ?? ""}
                {c.owner?.full_name && hint ? " · " : ""}
                {hint ?? ""}
                {inboxLabel ? `${(c.owner?.full_name || hint) ? " · " : ""}from ${inboxLabel}` : ""}
                {c.anchor_date ? `${(c.owner?.full_name || hint || inboxLabel) ? " · " : ""}anchored ${formatDate(c.anchor_date)}` : ""}
              </p>
            </div>
            {url && (
              <a href={url} target="_blank" rel="noopener noreferrer"
                className="text-xs text-primary hover:underline inline-flex items-center gap-1 shrink-0">
                Smartlead <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>

          <CampaignStatusControls c={c} setStatus={setStatus} />

          {/* Live-updates health + on-demand AI (docket I1 + I12). Only for
              Smartlead-linked campaigns — legacy/migrated rows have neither. */}
          {c.smartlead_campaign_id != null && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              {/* The stored webhook id can't prove the webhook still exists on
                  Smartlead's side, so the reconnect action is always offered —
                  it adopts the live webhook if one exists (no duplicate). */}
              {c.smartlead_webhook_id != null ? (
                <span className="text-muted-foreground">Live updates: on</span>
              ) : (
                <span className="text-amber-600">Live updates: not connected</span>
              )}
              <Button
                size="sm" variant="outline" className="h-6 px-2 text-xs"
                disabled={repairWebhook.isPending}
                onClick={() => repairWebhook.mutate(c.id)}
              >
                {repairWebhook.isPending ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : c.smartlead_webhook_id != null ? (
                  "Reconnect live updates"
                ) : (
                  "Repair live updates"
                )}
              </Button>
              {Number(c.metrics?.sent) > 0 && (
                <Button
                  size="sm" variant="ai" className="h-6 px-2 text-xs"
                  disabled={freshInsights.isPending}
                  onClick={() => freshInsights.mutate(c.id)}
                >
                  {freshInsights.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : "Get fresh insights"}
                </Button>
              )}
            </div>
          )}

          {(c.metrics?.sent != null || c.metrics?.openRate != null || c.metrics?.clickRate != null || c.metrics?.replies != null || enrollmentStats.total > 0) && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              {c.metrics?.sent != null && <span>{c.metrics.sent} sent</span>}
              {c.metrics?.openRate != null && <span>{c.metrics.openRate} open</span>}
              {c.metrics?.clickRate != null && <span>{c.metrics.clickRate} click</span>}
              {c.metrics?.replies != null && <span>{c.metrics.replies} replies</span>}
              {enrollmentStats.total > 0 && (
                <span className="font-medium text-foreground">
                  {enrollmentStats.total} {enrollmentStats.total === 1 ? "person" : "people"}
                  {enrollmentStats.active > 0 ? ` · ${enrollmentStats.active} active` : ""}
                  {enrollmentStats.paused > 0 ? ` · ${enrollmentStats.paused} paused` : ""}
                  {enrollmentStats.replied > 0 ? ` · ${enrollmentStats.replied} replied` : ""}
                  {enrollmentStats.completed > 0 ? ` · ${enrollmentStats.completed} completed` : ""}
                </span>
              )}
            </div>
          )}
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          {/* Sequence strip */}
          {c.steps?.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Sequence</h4>
              <SequenceTimeline steps={c.steps} />
            </div>
          )}

          {/* Engagement funnel — a compact, honest tally of our own event
              log (campaign_events). The per-email breakdown below covers
              the subset of events that NAME their email number; this line
              is the everything-included total. Separate from the c.metrics
              numbers in the header above, which are Smartlead's own
              server-computed rates — different sources, can legitimately
              disagree slightly. */}
          {eventStats && (eventStats.sent + eventStats.opened + eventStats.clicked + eventStats.replied > 0) && (
            <div className="space-y-1">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Engagement</h4>
              <p className="text-xs text-muted-foreground">
                Events seen: {eventStats.sent} sent · {eventStats.opened} opens · {eventStats.clicked} clicks · {eventStats.replied} replies
              </p>
            </div>
          )}

          {/* Per-email performance (outside-review I29) — which email in the
              sequence earns its send. Only events that name their email #
              can be attributed; the footnote keeps the table honest about
              the rest instead of silently miscounting. */}
          {touchStatsQ.isError && (
            <LoadError what="per-email performance" onRetry={() => touchStatsQ.refetch()} />
          )}
          {touchStats && Object.keys(touchStats.bySeq).length > 0 && (
            <div className="space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Per-email performance</h4>
              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Email</TableHead>
                      <TableHead className="text-right">Sent</TableHead>
                      <TableHead className="text-right">Opens</TableHead>
                      <TableHead className="text-right">Clicks</TableHead>
                      <TableHead className="text-right">Replies</TableHead>
                      <TableHead className="text-right">Bounces</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {Object.entries(touchStats.bySeq)
                      .sort(([a], [b]) => Number(a) - Number(b))
                      .map(([seq, t]) => (
                        <TableRow key={seq}>
                          <TableCell className="text-xs font-medium">Email {seq}</TableCell>
                          <TableCell className="text-xs text-right">{t.sent}</TableCell>
                          <TableCell className="text-xs text-right">{t.opened}</TableCell>
                          <TableCell className="text-xs text-right">{t.clicked}</TableCell>
                          <TableCell className={"text-xs text-right" + (t.replied > 0 ? " font-medium" : "")}>{t.replied}</TableCell>
                          <TableCell className="text-xs text-right">{t.bounced}</TableCell>
                        </TableRow>
                      ))}
                  </TableBody>
                </Table>
              </div>
              {(touchStats.unattributed > 0 || touchStats.capped) && (
                <p className="text-[11px] text-muted-foreground">
                  {[
                    touchStats.unattributed > 0
                      ? `${touchStats.unattributed} event${touchStats.unattributed === 1 ? "" : "s"} didn't say which email they belonged to and aren't counted above.`
                      : null,
                    touchStats.capped ? "Counts stopped at the first 10,000 events — treat them as a floor." : null,
                  ].filter(Boolean).join(" ")}
                </p>
              )}
            </div>
          )}

          {/* Influence (outside-review I30) — deals opened on enrolled
              accounts AFTER enrollment. Deliberately labeled as "opened
              after", not "generated by": correlation is what this data can
              honestly support. */}
          {influenceQ.isError && (
            <LoadError what="campaign influence" onRetry={() => influenceQ.refetch()} />
          )}
          {influence && influence.deals.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Influence</h4>
              <p className="text-xs text-muted-foreground">
                {influence.deals.length} {influence.deals.length === 1 ? "deal" : "deals"} opened by the team after people were enrolled (auto-created renewals excluded)
                {influence.wonTotal > 0 ? ` · ${formatCurrency(influence.wonTotal)} won` : ""}
                {influence.openTotal > 0 ? ` · ${formatCurrency(influence.openTotal)} in open pipeline` : ""}
              </p>
              {influence.capped && (
                <p className="text-[11px] text-muted-foreground">
                  Deal totals stopped at a read cap — treat the dollars as a floor, not the full picture.
                </p>
              )}
              <div className="space-y-1">
                {influence.deals.slice(0, 5).map((d) => (
                  <p key={d.id} className="text-xs">
                    <Link to={`/opportunities/${d.id}`} className="text-primary hover:underline">{d.name}</Link>
                    <span className="text-muted-foreground">
                      {" "}· {d.stage === "closed_won" ? "won" : d.stage === "closed_lost" ? "lost" : "open"}
                      {typeof d.amount === "number" ? ` · ${formatCurrency(d.amount)}` : ""}
                      {" "}· {formatRelativeDate(d.created_at)}
                    </span>
                  </p>
                ))}
                {influence.deals.length > 5 && (
                  <p className="text-[11px] text-muted-foreground">…and {influence.deals.length - 5} more on these accounts.</p>
                )}
              </div>
            </div>
          )}

          {/* People table */}
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                People{enrollments ? ` (${enrollments.length})` : ""}
              </h4>
              <div className="relative w-48">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search name or email…"
                  className="h-7 pl-7 text-xs"
                />
              </div>
            </div>

            {enrollmentsLoading ? (
              <div className="space-y-2">
                {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-9 w-full" />)}
              </div>
            ) : !enrollments?.length ? (
              <p className="text-xs text-muted-foreground">No one has been enrolled yet.</p>
            ) : !filteredEnrollments.length ? (
              <p className="text-xs text-muted-foreground">No one matches "{search}".</p>
            ) : (
              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Company</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>First send</TableHead>
                      <TableHead>Step</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredEnrollments.map((e) => {
                      const meta = ENROLLMENT_STATUS_META[e.status] ?? { label: e.status, className: "" };
                      const displayName = formatName(e.first_name ?? "", e.last_name ?? "").trim() || e.email || "—";
                      const subtitle = enrollmentSubtitle(e);
                      // current_step only advances once campaign_events sees
                      // a step-attributable send (Smartlead doesn't reliably
                      // tell us which step — see extractStepNumber's doc
                      // comment in playbook-smartlead/index.ts), so it can
                      // stay 0 for a person who genuinely has been sent to.
                      // Don't claim a step number we don't have, but also
                      // don't say "Not sent yet" when we have real evidence
                      // otherwise: the campaign has sent SOMETHING (metrics)
                      // AND this person's own first_send_at has passed AND
                      // they're not just enrolled-and-waiting (active) or
                      // stopped-by-reply (still means their first email
                      // went out) — show "In progress" instead.
                      const campaignHasSent = Number(c.metrics?.sent) > 0;
                      const firstSendInPast = !!e.first_send_at && new Date(e.first_send_at).getTime() <= Date.now();
                      const stepLabel = e.current_step > 0
                        ? `Step ${e.current_step}${totalEmailSteps ? ` of ${totalEmailSteps}` : ""}`
                        : campaignHasSent && firstSendInPast && (e.status === "active" || e.status === "replied")
                          ? "In progress"
                          : "Not sent yet";
                      const terminal = ENROLLMENT_TERMINAL.includes(e.status);
                      const rowBusy = setEnrollment.isPending && setEnrollment.variables?.enrollment_id === e.id;
                      const rowBusyAction = rowBusy ? setEnrollment.variables?.action : null;
                      return (
                        <TableRow key={e.id}>
                          <TableCell>
                            <div className="min-w-0">
                              {e.contact_id ? (
                                <Link to={`/contacts/${e.contact_id}`} className="font-medium text-primary hover:underline">
                                  {displayName}
                                </Link>
                              ) : (
                                <span className="font-medium">{displayName}</span>
                              )}
                              {e.email && displayName !== e.email && (
                                <p className="text-[11px] text-muted-foreground truncate">{e.email}</p>
                              )}
                              {subtitle && <p className="text-[11px] text-muted-foreground">{subtitle}</p>}
                            </div>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">{e.company || "—"}</TableCell>
                          <TableCell>
                            <Badge variant="secondary" className={cn("text-[10px]", meta.className)} title={formatDateTime(e.last_event_at)}>
                              {meta.label}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground" title={formatDateOnly(e.first_send_at)}>
                            {formatDateOnly(e.first_send_at)}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground whitespace-nowrap">{stepLabel}</TableCell>
                          <TableCell className="text-right">
                            {!terminal && (
                              <div className="flex items-center justify-end gap-1">
                                {e.status === "active" ? (
                                  <Button
                                    size="icon-xs" variant="outline"
                                    disabled={rowBusy}
                                    onClick={() => runEnrollmentAction(e, "pause")}
                                    title="Pause this person"
                                  >
                                    {rowBusyAction === "pause" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Pause className="h-3 w-3" />}
                                  </Button>
                                ) : (
                                  <Button
                                    size="icon-xs" variant="outline"
                                    disabled={rowBusy}
                                    onClick={() => runEnrollmentAction(e, "resume")}
                                    title="Resume this person"
                                  >
                                    {rowBusyAction === "resume" ? <Loader2 className="h-3 w-3 animate-spin" /> : <PlayCircle className="h-3 w-3" />}
                                  </Button>
                                )}
                                <Button
                                  size="icon-xs" variant="outline" className="text-destructive hover:text-destructive"
                                  disabled={rowBusy}
                                  onClick={() => setStopTarget(e)}
                                  title="Stop this person"
                                >
                                  {rowBusyAction === "stop" ? <Loader2 className="h-3 w-3 animate-spin" /> : <Square className="h-3 w-3" />}
                                </Button>
                              </div>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>

          {/* Recent activity */}
          <div className="space-y-2">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Recent activity</h4>
            {eventsLoading ? (
              <div className="space-y-1.5">
                {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-5 w-full" />)}
              </div>
            ) : !events?.length ? (
              <p className="text-xs text-muted-foreground">
                Nothing yet — this fills in once Smartlead reports sends, opens, or replies.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {events.map((ev) => {
                  const when = ev.occurred_at ?? ev.created_at;
                  return (
                    <li key={ev.id} className="flex items-center justify-between gap-2 text-xs">
                      <span className="truncate">{humanizeEvent(ev)}</span>
                      <span className="text-muted-foreground shrink-0" title={formatDateTime(when)}>
                        {formatRelativeDate(when)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </div>
      </SheetContent>

      <AlertDialog open={!!stopTarget} onOpenChange={(v) => !v && setStopTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Stop this person?</AlertDialogTitle>
            <AlertDialogDescription>
              Stops remaining emails and cancels their scheduled tasks — can't be undone for this person.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-white hover:bg-destructive/90"
              onClick={() => {
                if (stopTarget) runEnrollmentAction(stopTarget, "stop");
                setStopTarget(null);
              }}
            >
              Stop
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Sheet>
  );
}
