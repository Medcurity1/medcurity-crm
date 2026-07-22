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
import { formatName, formatDate, formatDateTime, formatRelativeDate } from "@/lib/formatters";
import { cn } from "@/lib/utils";
import { SequenceTimeline } from "./SequenceTimeline";
import { STATUS_META, originHint, CampaignStatusControls, type CampaignRow } from "./CampaignCard";
import {
  smartleadUrl, useCampaignEnrollments, useCampaignEvents, useSetEnrollmentStatus,
  useSetCampaignStatus,
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

const EVENT_LABEL: Record<string, string> = {
  EMAIL_SENT: "Email sent to",
  EMAIL_OPENED: "Email opened by",
  EMAIL_CLICKED: "Link clicked by",
  EMAIL_REPLIED: "Reply from",
  EMAIL_BOUNCED: "Email bounced for",
  EMAIL_UNSUBSCRIBED: "Unsubscribed:",
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
  const setEnrollment = useSetEnrollmentStatus();
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
                      const stepLabel = e.current_step > 0
                        ? `Step ${e.current_step}${totalEmailSteps ? ` of ${totalEmailSteps}` : ""}`
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
                          <TableCell className="text-sm text-muted-foreground" title={formatDateTime(e.first_send_at)}>
                            {formatDate(e.first_send_at)}
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
