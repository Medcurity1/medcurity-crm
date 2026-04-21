import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  Phone,
  Mail,
  Calendar,
  StickyNote,
  CheckSquare,
  CheckCircle2,
  Clock,
  Plus,
  ClipboardList,
  ChevronDown,
  ChevronRight,
  Reply,
  RefreshCw,
  Maximize2,
  ExternalLink,
  MessagesSquare,
} from "lucide-react";
import { useActivities } from "./api";
import { ActivityForm } from "./ActivityForm";
import { LogEmailDialog } from "./LogEmailDialog";
import { QuickNoteInput } from "./QuickNoteInput";
import { ReattributeActivityDialog } from "./ReattributeActivityDialog";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { formatRelativeDate, formatDate, activityLabel } from "@/lib/formatters";
import type { ActivityType, Activity } from "@/types/crm";

interface ActivityTimelineProps {
  accountId?: string;
  contactId?: string;
  opportunityId?: string;
  leadId?: string;
  contactEmail?: string;
  contactName?: string;
  /**
   * "compact" tightens spacing and limits the visible items to make the
   * timeline fit a side panel. The user can click "View All" to open the
   * dedicated full-screen view.
   */
  compact?: boolean;
  /** Hide the "Log Activity / Log Email" buttons (use on the full-screen page). */
  hideLogButtons?: boolean;
  /** Cap visible items in compact mode. Default 25. */
  visibleLimit?: number;
  /**
   * Show the per-row "Re-attribute" menu item. Only really useful on
   * Opportunity detail pages where the user wants to move an email to
   * a different opp on the same account. Account and Contact timelines
   * already show everything so re-attribution there is pointless.
   */
  enableReattribute?: boolean;
}

interface ThreadGroup {
  threadKey: string;
  primary: Activity; // newest message
  others: Activity[]; // earlier messages in the same thread
}

const typeIcons: Record<ActivityType, typeof Phone> = {
  call: Phone,
  email: Mail,
  meeting: Calendar,
  note: StickyNote,
  task: CheckSquare,
};

const typeColors: Record<ActivityType, string> = {
  call: "bg-blue-100 text-blue-600",
  email: "bg-purple-100 text-purple-600",
  meeting: "bg-amber-100 text-amber-600",
  note: "bg-gray-100 text-gray-600",
  task: "bg-emerald-100 text-emerald-600",
};

export function ActivityTimeline({
  accountId,
  contactId,
  opportunityId,
  leadId,
  contactEmail,
  contactName,
  compact = false,
  hideLogButtons = false,
  visibleLimit = 25,
  enableReattribute = false,
}: ActivityTimelineProps) {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [showEmailForm, setShowEmailForm] = useState(false);
  const [editingActivity, setEditingActivity] = useState<Activity | null>(null);
  const [allExpanded, setAllExpanded] = useState(false);
  // Bumping this triggers a re-render so children that read it update their
  // expand state. We don't push expand state down individually because that
  // would be a lot of plumbing.
  const [expandSignal, setExpandSignal] = useState(0);

  const { data: activities, isLoading, refetch, isFetching } = useActivities({
    account_id: accountId,
    contact_id: contactId,
    opportunity_id: opportunityId,
    lead_id: leadId,
  });

  // Build the "View All" deep link based on which entity scope we're in.
  const viewAllHref = (() => {
    if (opportunityId) return `/activities?opportunity_id=${opportunityId}`;
    if (contactId) return `/activities?contact_id=${contactId}`;
    if (accountId) return `/activities?account_id=${accountId}`;
    if (leadId) return `/activities?lead_id=${leadId}`;
    return "/activities";
  })();

  // Group consecutive emails on the same thread under one row. The newest
  // message is the visible one; older messages collapse into a chevron.
  // Non-email activities never group.
  const groupedActivities = useMemo(() => {
    if (!activities) return [] as Array<Activity | ThreadGroup>;
    const out: Array<Activity | ThreadGroup> = [];
    const threadIndex = new Map<string, number>();
    for (const a of activities) {
      const key = a.email_thread_id ?? null;
      if (a.activity_type === "email" && key) {
        const existingIdx = threadIndex.get(key);
        if (existingIdx != null) {
          const existing = out[existingIdx];
          if ((existing as ThreadGroup).threadKey) {
            (existing as ThreadGroup).others.push(a);
          } else {
            out[existingIdx] = {
              threadKey: key,
              primary: existing as Activity,
              others: [a],
            };
          }
          continue;
        }
        threadIndex.set(key, out.length);
      }
      out.push(a);
    }
    return out;
  }, [activities]);

  const visible = compact ? groupedActivities.slice(0, visibleLimit) : groupedActivities;
  const hiddenCount = groupedActivities.length - visible.length;

  function handleRefresh() {
    refetch();
    qc.invalidateQueries({ queryKey: ["activities"] });
  }

  function handleToggleExpandAll() {
    setAllExpanded((v) => !v);
    setExpandSignal((s) => s + 1);
  }

  if (isLoading) {
    return (
      <div className="space-y-4 py-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex gap-3 animate-pulse">
            <div className="h-8 w-8 rounded-full bg-muted" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-1/3 rounded bg-muted" />
              <div className="h-3 w-2/3 rounded bg-muted" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div>
      {!hideLogButtons && (
        <>
          <QuickNoteInput
            accountId={accountId}
            contactId={contactId}
            opportunityId={opportunityId}
            leadId={leadId}
          />
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={() => setShowForm(true)}>
              <Plus className="h-4 w-4 mr-1" />
              Log Activity
            </Button>
            <Button size="sm" variant="outline" onClick={() => setShowEmailForm(true)}>
              <Mail className="h-4 w-4 mr-1" />
              Log Email
            </Button>
            <div className="ml-auto flex items-center gap-1">
              <Button
                size="icon"
                variant="ghost"
                onClick={handleRefresh}
                disabled={isFetching}
                title="Refresh"
              >
                <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
              </Button>
              <Button
                size="icon"
                variant="ghost"
                onClick={handleToggleExpandAll}
                title={allExpanded ? "Collapse all" : "Expand all"}
              >
                <Maximize2 className="h-4 w-4" />
              </Button>
              {compact && (
                <Button size="sm" variant="ghost" asChild title="Open full activity view">
                  <Link to={viewAllHref}>
                    View All
                    <ExternalLink className="h-3 w-3 ml-1" />
                  </Link>
                </Button>
              )}
            </div>
          </div>
        </>
      )}

      {!visible.length ? (
        <EmptyState
          icon={ClipboardList}
          title="No activities yet"
          description="Log calls, emails, meetings, notes, and tasks to keep a record of interactions."
          action={{ label: "Log Activity", onClick: () => setShowForm(true) }}
        />
      ) : (
        <div className="relative">
          <div className="absolute left-4 top-0 bottom-0 w-px bg-border" />
          <div className={compact ? "space-y-3" : "space-y-4"}>
            {visible.map((entry) => {
              if ((entry as ThreadGroup).threadKey) {
                return (
                  <ThreadEntry
                    key={(entry as ThreadGroup).threadKey}
                    group={entry as ThreadGroup}
                    expandSignal={expandSignal}
                    forceExpanded={allExpanded}
                    enableReattribute={enableReattribute}
                  />
                );
              }
              const a = entry as Activity;
              return (
                <ActivityEntry
                  key={a.id}
                  activity={a}
                  expandSignal={expandSignal}
                  forceExpanded={allExpanded}
                  enableReattribute={enableReattribute}
                  onEdit={() => setEditingActivity(a)}
                />
              );
            })}
          </div>
          {hiddenCount > 0 && (
            <div className="mt-3 pt-3 border-t text-center">
              <Button size="sm" variant="ghost" asChild>
                <Link to={viewAllHref}>
                  Show {hiddenCount} more...
                  <ExternalLink className="h-3 w-3 ml-1" />
                </Link>
              </Button>
            </div>
          )}
        </div>
      )}

      <ActivityForm
        open={showForm}
        onOpenChange={setShowForm}
        accountId={accountId}
        contactId={contactId}
        opportunityId={opportunityId}
        leadId={leadId}
      />

      {/* Edit dialog — reuses ActivityForm with an `activity` prop to
          switch into update mode. */}
      <ActivityForm
        open={!!editingActivity}
        onOpenChange={(v) => !v && setEditingActivity(null)}
        accountId={accountId}
        contactId={contactId}
        opportunityId={opportunityId}
        leadId={leadId}
        activity={editingActivity}
      />

      <LogEmailDialog
        open={showEmailForm}
        onOpenChange={setShowEmailForm}
        accountId={accountId}
        contactId={contactId}
        opportunityId={opportunityId}
        leadId={leadId}
        contactEmail={contactEmail}
        contactName={contactName}
      />
    </div>
  );
}

function getActivityLink(activity: Activity): string | null {
  if (activity.opportunity_id) return `/opportunities/${activity.opportunity_id}`;
  if (activity.contact_id) return `/contacts/${activity.contact_id}`;
  if (activity.account_id) return `/accounts/${activity.account_id}`;
  return null;
}

function ActivityEntry({
  activity,
  expandSignal,
  forceExpanded,
  enableReattribute = false,
  onEdit,
}: {
  activity: Activity;
  expandSignal?: number;
  forceExpanded?: boolean;
  enableReattribute?: boolean;
  onEdit?: () => void;
}) {
  const Icon = typeIcons[activity.activity_type];
  const colorClass = typeColors[activity.activity_type];
  const isCompleted = !!activity.completed_at;
  const isDue = !!activity.due_at && !isCompleted;
  const subjectLink = getActivityLink(activity);
  const isEmail = activity.activity_type === "email";
  const [expanded, setExpanded] = useState(false);
  const [showReattribute, setShowReattribute] = useState(false);

  // React to parent's "Expand all" / "Collapse all" toggle. The signal
  // increments on every click so this fires regardless of the current
  // expanded state. We skip the initial 0 value so first-render doesn't
  // collapse legitimate already-open rows.
  useEffect(() => {
    if (expandSignal && expandSignal > 0) setExpanded(!!forceExpanded);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandSignal]);

  return (
    <div className="relative flex gap-3 pl-0">
      {/* Icon (clickable for email rows to expand) */}
      <button
        type="button"
        className={`relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${colorClass} ${
          isEmail ? "cursor-pointer hover:opacity-80" : "cursor-default"
        }`}
        onClick={isEmail ? () => setExpanded((v) => !v) : undefined}
        aria-label={isEmail ? (expanded ? "Collapse email" : "Expand email") : undefined}
        disabled={!isEmail}
      >
        <Icon className="h-4 w-4" />
      </button>

      {/* Content */}
      <div className="flex-1 min-w-0 pb-4">
        {/* Subject row: subject takes available width via min-w-0 + flex-1
            so the relative date on the right always stays visible. */}
        <div className="flex items-center gap-2">
          {isEmail ? (
            <button
              type="button"
              className="flex items-center gap-1 text-left font-medium text-sm text-blue-600 hover:underline min-w-0 flex-1"
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded ? (
                <ChevronDown className="h-3.5 w-3.5 shrink-0" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5 shrink-0" />
              )}
              <span className="truncate">{activity.subject}</span>
            </button>
          ) : onEdit ? (
            // Clickable-to-edit for non-email activities (call, meeting,
            // note, task). The link to the related record is moved to the
            // metadata line below.
            <button
              type="button"
              onClick={onEdit}
              className="font-medium text-sm truncate text-blue-600 hover:underline min-w-0 flex-1 text-left"
              title="Click to edit"
            >
              {activity.subject}
            </button>
          ) : subjectLink ? (
            <Link to={subjectLink} className="font-medium text-sm truncate text-blue-600 hover:underline min-w-0 flex-1">
              {activity.subject}
            </Link>
          ) : (
            <p className="font-medium text-sm truncate min-w-0 flex-1">{activity.subject}</p>
          )}
          {isCompleted && (
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
          )}
          <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0">
            {formatRelativeDate(activity.created_at)}
          </span>
        </div>
        {activity.body && !expanded && (
          <p className="text-sm text-muted-foreground line-clamp-2 mt-0.5">
            {activity.body}
          </p>
        )}
        <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
          <span>{activityLabel(activity.activity_type)}</span>
          {activity.owner?.full_name && (
            <span>{activity.owner.full_name}</span>
          )}
          {isDue && (
            <span className="inline-flex items-center gap-1 text-amber-600">
              <Clock className="h-3 w-3" />
              Due {formatDate(activity.due_at)}
            </span>
          )}
        </div>
        {expanded && isEmail && (
          <EmailDetails
            activity={activity}
            enableReattribute={enableReattribute}
            onOpenReattribute={() => setShowReattribute(true)}
          />
        )}
      </div>

      {enableReattribute && (
        <ReattributeActivityDialog
          open={showReattribute}
          onOpenChange={setShowReattribute}
          activity={activity}
        />
      )}
    </div>
  );
}

/**
 * Expanded email view: From / To / Cc headers, full body (HTML if available,
 * plain-text fallback), and a Reply button that opens the user's mail client
 * with pre-populated recipients and subject. We use mailto: rather than
 * calling Graph's /sendMail directly so the email ends up in the rep's
 * actual Sent folder and goes through their normal mail signature/tracking.
 */
function EmailDetails({
  activity,
  enableReattribute = false,
  onOpenReattribute,
}: {
  activity: Activity;
  enableReattribute?: boolean;
  onOpenReattribute?: () => void;
}) {
  const from = activity.email_from ?? "";
  const to = activity.email_to ?? [];
  const cc = activity.email_cc ?? [];
  // Pre-metadata emails (synced before 2026-04-17) are missing From/To/Cc.
  // Surface a clear note instead of "(unknown)" so the user knows why.
  const isMissingMetadata = !from && to.length === 0 && cc.length === 0;

  const subjectForReply = activity.subject.replace(/^(Sent:|Received:)\s*/, "");
  const replySubject = subjectForReply.match(/^re:\s*/i)
    ? subjectForReply
    : `Re: ${subjectForReply}`;

  // Reply goes to whoever sent it (for received) or the original recipients
  // (for sent). CC everyone who was previously CC'd.
  const replyTo = activity.email_direction === "received" && from ? [from] : to;
  const replyCc = cc;
  const canReply = replyTo.length > 0;

  const mailtoHref = canReply
    ? `mailto:${encodeURIComponent(replyTo.join(","))}` +
      `?subject=${encodeURIComponent(replySubject)}` +
      (replyCc.length > 0 ? `&cc=${encodeURIComponent(replyCc.join(","))}` : "")
    : undefined;

  return (
    <div className="mt-3 rounded-md border bg-muted/30 p-3 space-y-2 text-sm">
      {isMissingMetadata ? (
        <p className="text-xs text-muted-foreground italic">
          From / To / Cc weren't captured for this email (synced before email
          metadata was added). New emails synced from now on will have full
          headers.
        </p>
      ) : (
        <>
          {from && <HeaderRow label="From" values={[from]} />}
          {to.length > 0 && <HeaderRow label="To" values={to} />}
          {cc.length > 0 && <HeaderRow label="Cc" values={cc} />}
        </>
      )}
      <div className="pt-2 border-t">
        {activity.email_html_body ? (
          <iframe
            title={`Email body: ${activity.subject}`}
            sandbox=""
            srcDoc={activity.email_html_body}
            className="w-full min-h-48 bg-background rounded border"
          />
        ) : (
          <pre className="whitespace-pre-wrap font-sans text-sm text-foreground">
            {activity.body || "(no body captured)"}
          </pre>
        )}
      </div>
      <div className="pt-2 flex gap-2 flex-wrap">
        {canReply && (
          <Button size="sm" asChild>
            <a href={mailtoHref}>
              <Reply className="h-4 w-4 mr-1" />
              Reply
            </a>
          </Button>
        )}
        {enableReattribute && onOpenReattribute && (
          <Button size="sm" variant="outline" onClick={onOpenReattribute}>
            Re-attribute to another opportunity
          </Button>
        )}
      </div>
    </div>
  );
}

function HeaderRow({ label, values }: { label: string; values: string[] }) {
  return (
    <div className="flex gap-2 text-xs">
      <span className="font-medium text-muted-foreground min-w-10">{label}:</span>
      <span className="flex-1 break-all text-foreground">{values.join(", ")}</span>
    </div>
  );
}

/**
 * Renders multiple emails on the same conversation as a single timeline
 * entry. Shows the newest message expanded-on-click and lets the user
 * peek at every prior message in the thread without scrolling forever.
 */
function ThreadEntry({
  group,
  expandSignal,
  forceExpanded,
  enableReattribute = false,
}: {
  group: ThreadGroup;
  expandSignal: number;
  forceExpanded: boolean;
  enableReattribute?: boolean;
}) {
  const [showThread, setShowThread] = useState(false);
  const messageCount = 1 + group.others.length;

  useEffect(() => {
    if (expandSignal > 0) setShowThread(!!forceExpanded);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandSignal]);

  return (
    <div className="relative flex gap-3 pl-0">
      <button
        type="button"
        className="relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-purple-100 text-purple-600 cursor-pointer hover:opacity-80"
        onClick={() => setShowThread((v) => !v)}
        aria-label={showThread ? "Collapse thread" : "Expand thread"}
      >
        <MessagesSquare className="h-4 w-4" />
      </button>
      <div className="flex-1 min-w-0 pb-4">
        {/* Subject row: subject truncates, message-count + date stay
            visible on the right with shrink-0 + whitespace-nowrap. */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="flex items-center gap-1 text-left font-medium text-sm text-blue-600 hover:underline min-w-0 flex-1"
            onClick={() => setShowThread((v) => !v)}
          >
            {showThread ? (
              <ChevronDown className="h-3.5 w-3.5 shrink-0" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5 shrink-0" />
            )}
            <span className="truncate">{group.primary.subject}</span>
          </button>
          <span className="text-xs text-muted-foreground font-normal whitespace-nowrap shrink-0">
            {messageCount} msgs
          </span>
          <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0">
            {formatRelativeDate(group.primary.created_at)}
          </span>
        </div>
        {!showThread && group.primary.body && (
          <p className="text-sm text-muted-foreground line-clamp-2 mt-0.5">
            {group.primary.body}
          </p>
        )}
        <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
          <span>Email Thread</span>
          {group.primary.owner?.full_name && (
            <span>{group.primary.owner.full_name}</span>
          )}
        </div>

        {showThread && (
          <div className="mt-3 space-y-3">
            {/* Newest first (already sorted that way), with the primary inline */}
            <ThreadMessage
              activity={group.primary}
              isPrimary
              enableReattribute={enableReattribute}
            />
            {group.others.map((m) => (
              <ThreadMessage
                key={m.id}
                activity={m}
                enableReattribute={enableReattribute}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ThreadMessage({
  activity,
  isPrimary = false,
  enableReattribute = false,
}: {
  activity: Activity;
  isPrimary?: boolean;
  enableReattribute?: boolean;
}) {
  const [open, setOpen] = useState(isPrimary);
  const [showReattribute, setShowReattribute] = useState(false);
  const dirLabel = activity.email_direction === "sent" ? "Sent" : "Received";

  return (
    <div className="rounded-md border bg-muted/20 text-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-2 px-3 py-2 hover:bg-muted/40 transition-colors"
      >
        <div className="flex items-center gap-2 min-w-0">
          {open ? (
            <ChevronDown className="h-3.5 w-3.5 shrink-0" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 shrink-0" />
          )}
          <span className="text-xs font-medium text-muted-foreground">{dirLabel}</span>
          <span className="text-xs text-foreground truncate">
            {activity.email_from || activity.email_to?.[0] || "(unknown sender)"}
          </span>
        </div>
        <span className="text-xs text-muted-foreground whitespace-nowrap shrink-0">
          {formatDate(activity.created_at)}
        </span>
      </button>
      {open && (
        <div className="px-3 pb-3 pt-1 border-t">
          <EmailDetails
            activity={activity}
            enableReattribute={enableReattribute}
            onOpenReattribute={() => setShowReattribute(true)}
          />
        </div>
      )}
      {enableReattribute && (
        <ReattributeActivityDialog
          open={showReattribute}
          onOpenChange={setShowReattribute}
          activity={activity}
        />
      )}
    </div>
  );
}
