import { useState } from "react";
import { Link } from "react-router-dom";
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
} from "lucide-react";
import { useActivities } from "./api";
import { ActivityForm } from "./ActivityForm";
import { LogEmailDialog } from "./LogEmailDialog";
import { QuickNoteInput } from "./QuickNoteInput";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { formatRelativeDate, formatDate, activityLabel } from "@/lib/formatters";
import type { ActivityType, Activity } from "@/types/crm";

interface ActivityTimelineProps {
  accountId?: string;
  contactId?: string;
  opportunityId?: string;
  contactEmail?: string;
  contactName?: string;
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
  contactEmail,
  contactName,
}: ActivityTimelineProps) {
  const [showForm, setShowForm] = useState(false);
  const [showEmailForm, setShowEmailForm] = useState(false);
  const { data: activities, isLoading } = useActivities({
    account_id: accountId,
    contact_id: contactId,
    opportunity_id: opportunityId,
  });

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
      <QuickNoteInput
        accountId={accountId}
        contactId={contactId}
        opportunityId={opportunityId}
      />
      <div className="mb-4 flex gap-2">
        <Button size="sm" onClick={() => setShowForm(true)}>
          <Plus className="h-4 w-4 mr-1" />
          Log Activity
        </Button>
        <Button size="sm" variant="outline" onClick={() => setShowEmailForm(true)}>
          <Mail className="h-4 w-4 mr-1" />
          Log Email
        </Button>
      </div>

      {!activities?.length ? (
        <EmptyState
          icon={ClipboardList}
          title="No activities yet"
          description="Log calls, emails, meetings, notes, and tasks to keep a record of interactions."
          action={{ label: "Log Activity", onClick: () => setShowForm(true) }}
        />
      ) : (
        <div className="relative">
          {/* Vertical timeline line */}
          <div className="absolute left-4 top-0 bottom-0 w-px bg-border" />

          <div className="space-y-4">
            {activities.map((activity) => (
              <ActivityEntry key={activity.id} activity={activity} />
            ))}
          </div>
        </div>
      )}

      <ActivityForm
        open={showForm}
        onOpenChange={setShowForm}
        accountId={accountId}
        contactId={contactId}
        opportunityId={opportunityId}
      />

      <LogEmailDialog
        open={showEmailForm}
        onOpenChange={setShowEmailForm}
        accountId={accountId}
        contactId={contactId}
        opportunityId={opportunityId}
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

function ActivityEntry({ activity }: { activity: Activity }) {
  const Icon = typeIcons[activity.activity_type];
  const colorClass = typeColors[activity.activity_type];
  const isCompleted = !!activity.completed_at;
  const isDue = !!activity.due_at && !isCompleted;
  const subjectLink = getActivityLink(activity);

  return (
    <div className="relative flex gap-3 pl-0">
      {/* Icon */}
      <div
        className={`relative z-10 flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${colorClass}`}
      >
        <Icon className="h-4 w-4" />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0 pb-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              {subjectLink ? (
                <Link to={subjectLink} className="font-medium text-sm truncate text-blue-600 hover:underline">
                  {activity.subject}
                </Link>
              ) : (
                <p className="font-medium text-sm truncate">{activity.subject}</p>
              )}
              {isCompleted && (
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
              )}
            </div>
            {activity.body && (
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
          </div>
          <span className="text-xs text-muted-foreground whitespace-nowrap">
            {formatRelativeDate(activity.created_at)}
          </span>
        </div>
      </div>
    </div>
  );
}
