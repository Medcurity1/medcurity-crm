// Campaign Touches system widget (Campaigns overhaul S7) — MY upcoming
// campaign-generated tasks (the CALL/LINKEDIN/EMAIL_HYBRID steps a sequence
// spawned as tasks — see spawnCampaignTasks in playbook-smartlead/index.ts).
// Same shape/conventions as TasksWidget (its closest analog): scoped to the
// WIDGET OWNER (widget.user_id, not the signed-in user) so admin preview
// shows the target user's data, no config, "Updated X ago" via
// onDataUpdated, in-widget search over the loaded preview rows only.
//
// campaign_enrollments/campaigns read is admin-only RLS (20260625000001) —
// in practice every campaign owner is an admin (only /playbook, which is
// AdminGate'd, can launch one), so the join resolves for the audience that
// actually sees data here. A non-admin viewing their OWN page (own
// activities are still visible) just sees the campaign name fall back to a
// generic label rather than the query breaking.

import { useEffect } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate } from "@/lib/formatters";
import { WidgetError } from "./WidgetError";
import type { NexusWidgetBodyProps } from "../WidgetShell";

const LOOKAHEAD_DAYS = 14;

interface CampaignTouchTask {
  id: string;
  subject: string;
  due_at: string | null;
  campaign_enrollment_id: string | null;
  enrollment: {
    contact_id: string | null;
    campaign: { id: string; name: string } | null;
  } | null;
}

function useOwnerCampaignTouches(userId: string) {
  return useQuery({
    queryKey: ["nexus-widget-data", "campaign_touches", userId],
    queryFn: async () => {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() + LOOKAHEAD_DAYS);
      const { data, error } = await supabase
        .from("activities")
        .select(
          "id, subject, due_at, campaign_enrollment_id, enrollment:campaign_enrollments(contact_id, campaign:campaigns(id, name))",
        )
        .eq("activity_type", "task")
        .eq("is_campaign_generated", true)
        .eq("owner_user_id", userId)
        .is("completed_at", null)
        .is("archived_at", null)
        .lte("due_at", cutoff.toISOString())
        .order("due_at", { ascending: true, nullsFirst: false });
      if (error) throw error;
      // Same to-one-embed cast as fetchActiveEnrollmentsForEmails
      // (src/features/playbook/api.ts) — PostgREST returns a single object
      // for campaign_enrollment_id -> campaign_enrollments (and its own
      // nested -> campaigns) but the query-builder's type inference (no
      // generated Database types in this project) sees it as an array.
      return (data ?? []) as unknown as CampaignTouchTask[];
    },
    enabled: !!userId,
  });
}

function formatDueLabel(dueAt: string | null): string {
  if (!dueAt) return "";
  const due = new Date(dueAt);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const dueMidnight = new Date(due);
  dueMidnight.setHours(0, 0, 0, 0);
  const diffDays = Math.round((dueMidnight.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return `Overdue ${Math.abs(diffDays)}d`;
  if (diffDays === 0) return "Due today";
  if (diffDays === 1) return "Due tomorrow";
  if (diffDays < 7) return `Due in ${diffDays}d`;
  return `Due ${formatDate(dueAt)}`;
}

function getDueDateColor(dueAt: string | null): string {
  if (!dueAt) return "text-muted-foreground";
  const due = new Date(dueAt);
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  due.setHours(0, 0, 0, 0);
  const diffDays = Math.floor((due.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return "text-red-600";
  if (diffDays === 0) return "text-amber-600";
  if (diffDays <= 2) return "text-amber-500";
  return "text-muted-foreground";
}

export function CampaignTouchesWidget({ widget, searchQuery, onDataUpdated }: NexusWidgetBodyProps) {
  const {
    data: tasks,
    isLoading,
    isError,
    refetch,
    isFetching,
    dataUpdatedAt,
  } = useOwnerCampaignTouches(widget.user_id);

  useEffect(() => {
    if (dataUpdatedAt) onDataUpdated?.(dataUpdatedAt);
  }, [dataUpdatedAt, onDataUpdated]);

  const preview = (tasks ?? []).slice(0, widget.preview_count);
  const q = searchQuery.trim().toLowerCase();
  const visible = q
    ? preview.filter((t) =>
        [t.subject, t.enrollment?.campaign?.name].some((s) => s?.toLowerCase().includes(q)),
      )
    : preview;

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: Math.min(widget.preview_count, 5) }).map((_, i) => (
          <div key={i} className="flex items-center gap-3">
            <Skeleton className="h-4 w-4 rounded" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <WidgetError message="Couldn't load your campaign touches." onRetry={() => refetch()} isRetrying={isFetching} />
    );
  }

  if (!tasks?.length) {
    return (
      <p className="text-sm text-muted-foreground py-2">
        No campaign touches coming up in the next {LOOKAHEAD_DAYS} days.
      </p>
    );
  }

  return (
    <div className="space-y-1">
      {!visible.length ? (
        <p className="text-sm text-muted-foreground py-2">No rows match your filter.</p>
      ) : (
        visible.map((task) => {
          const campaignName = task.enrollment?.campaign?.name ?? "Campaign task";
          const campaignId = task.enrollment?.campaign?.id;
          const contactId = task.enrollment?.contact_id;
          const dueColor = getDueDateColor(task.due_at);
          const dueLabel = formatDueLabel(task.due_at);
          return (
            <div key={task.id} className="flex items-start gap-3 py-1.5">
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2 flex-wrap">
                  <span className="text-sm font-medium truncate">{task.subject}</span>
                  {dueLabel && <span className={`text-xs font-medium ${dueColor}`}>{dueLabel}</span>}
                </div>
                <div className="flex items-center gap-1.5 mt-0.5 text-xs text-muted-foreground min-w-0">
                  {contactId ? (
                    <Link to={`/contacts/${contactId}`} className="hover:text-primary hover:underline truncate">
                      {campaignName}
                    </Link>
                  ) : campaignId ? (
                    <Link to={`/playbook?campaign=${campaignId}`} className="hover:text-primary hover:underline truncate">
                      {campaignName}
                    </Link>
                  ) : (
                    <span className="truncate">{campaignName}</span>
                  )}
                </div>
              </div>
            </div>
          );
        })
      )}

      <div className="pt-2 flex items-center justify-between">
        <Link to="/activities?type=task&owner=me" className="text-sm text-primary hover:underline">
          View All
        </Link>
        {tasks.length > widget.preview_count && (
          <span className="text-xs text-muted-foreground">{tasks.length} upcoming</span>
        )}
      </div>
    </div>
  );
}
