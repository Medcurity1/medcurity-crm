import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Activity } from "@/types/crm";
import { compareTasksByDueThenPriority } from "./taskOrder";

interface ActivityFilters {
  account_id?: string;
  contact_id?: string;
  opportunity_id?: string;
  lead_id?: string;
}

export function useActivities(filters?: ActivityFilters) {
  return useQuery({
    queryKey: ["activities", filters],
    queryFn: async () => {
      let query = supabase
        .from("activities")
        .select(
          "*, owner:user_profiles!owner_user_id(id, full_name), contact:contacts!contact_id(id, first_name, last_name)",
        )
        .is("archived_at", null)
        // Order by the real interaction date (activity_date when set, else
        // logged date) so back-dated entries sit in the right spot. The
        // timeline also re-groups client-side, but ordering here keeps any
        // non-grouped consumer correct too.
        .order("effective_at", { ascending: false })
        // Bounded window: the timeline shows 25 and its "Show more" is a link
        // to the full /activities page (not an in-place expand), so a cap
        // comfortably above 25 avoids downloading thousands of rows for a
        // long-lived account without changing what's displayed.
        .limit(50);

      if (filters?.account_id) {
        query = query.eq("account_id", filters.account_id);
      }
      if (filters?.contact_id) {
        query = query.eq("contact_id", filters.contact_id);
      }
      if (filters?.opportunity_id) {
        query = query.eq("opportunity_id", filters.opportunity_id);
      }
      if (filters?.lead_id) {
        query = query.eq("lead_id", filters.lead_id);
      }

      const { data, error } = await query;
      if (error) throw error;
      return data as Activity[];
    },
    enabled:
      !!filters?.account_id ||
      !!filters?.contact_id ||
      !!filters?.opportunity_id ||
      !!filters?.lead_id,
  });
}

interface CreateActivityInput {
  account_id?: string | null;
  contact_id?: string | null;
  opportunity_id?: string | null;
  lead_id?: string | null;
  owner_user_id?: string | null;
  activity_type: string;
  subject: string;
  body?: string;
  activity_date?: string | null;
  due_at?: string | null;
  reminder_schedule?: "none" | "once" | "daily" | "weekdays" | "weekly";
  reminder_at?: string | null;
  reminder_channels?: Array<"in_app" | "email">;
  priority?: "high" | "normal" | "low" | null;
  // Task recurrence (V2-A3)
  recur_freq?: "daily" | "weekly" | "monthly" | null;
  recur_interval?: number;
  recur_weekday?: number | null;
  recur_monthday?: number | null;
  recur_until?: string | null;
}

export function useCreateActivity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: CreateActivityInput) => {
      const { data, error } = await supabase
        .from("activities")
        .insert(values)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["activities"] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
    },
  });
}

export function useCompleteActivity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: { id: string }) => {
      const { data, error } = await supabase
        .from("activities")
        .update({ completed_at: new Date().toISOString() })
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["activities"] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
    },
  });
}

/**
 * Soft-delete (archive) an activity. Mirrors the archive-vs-hard-delete
 * pattern used across the app: the row stays in the DB for audit, just
 * gets archived_at stamped so it's hidden from default queries. Admins
 * can restore via Archive Manager.
 */
export function useArchiveActivity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason?: string }) => {
      const { data: { user } } = await supabase.auth.getUser();
      const { data, error } = await supabase
        .from("activities")
        .update({
          archived_at: new Date().toISOString(),
          archived_by: user?.id ?? null,
          archive_reason: reason ?? "Deleted by user",
        })
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["activities"] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
      // Home "My Tasks"/activity widgets read under ["dashboard", ...] — refresh
      // so an archived task disappears from the dashboard without a reload.
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
  });
}

/**
 * Re-attribute an activity to a different opportunity (or detach it to
 * account-only). Brayden's SRA/NVA case: an email auto-landed on the
 * wrong opp, user wants one-click move. Also handles un-linking.
 */
/**
 * Reopen a completed task (clears completed_at). Lets a rep fix a
 * mis-click or bring something back into their open-tasks list. Audit
 * log captures the change so this can't silently "un-do" what a rep
 * told their manager they'd finished.
 */
export function useReopenActivity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: { id: string }) => {
      const { data, error } = await supabase
        .from("activities")
        .update({ completed_at: null })
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["activities"] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["dashboard", "my-tasks"] });
    },
  });
}

/**
 * Edit a task or activity (subject, body, due_at, reminder fields).
 * Narrow set of columns — does NOT let you change activity_type or
 * record-association FKs (use useReattributeActivity for that).
 */
export function useUpdateActivity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      ...patch
    }: {
      id: string;
      activity_type?: "call" | "email" | "meeting" | "note" | "task";
      subject?: string;
      body?: string | null;
      activity_date?: string | null;
      due_at?: string | null;
      // Allow re-attributing the contact on an existing activity. Reps
      // sometimes log an interaction before they remember which contact
      // it was with; editing should let them fix it.
      contact_id?: string | null;
      reminder_schedule?: "none" | "once" | "daily" | "weekdays" | "weekly";
      reminder_at?: string | null;
      reminder_channels?: Array<"in_app" | "email">;
      priority?: "high" | "normal" | "low" | null;
      // Task recurrence (V2-A3)
      recur_freq?: "daily" | "weekly" | "monthly" | null;
      recur_interval?: number;
      recur_weekday?: number | null;
      recur_monthday?: number | null;
      recur_until?: string | null;
    }) => {
      const { data, error } = await supabase
        .from("activities")
        .update(patch)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["activities"] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
      qc.invalidateQueries({ queryKey: ["dashboard", "my-tasks"] });
    },
  });
}

export function useReattributeActivity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      opportunityId,
    }: {
      id: string;
      opportunityId: string | null;
    }) => {
      const { data, error } = await supabase
        .from("activities")
        .update({ opportunity_id: opportunityId })
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["activities"] });
    },
  });
}

interface TaskFilters {
  account_id?: string;
  contact_id?: string;
  opportunity_id?: string;
  lead_id?: string;
}

export function useTasks(filters: TaskFilters) {
  return useQuery({
    queryKey: ["tasks", filters],
    queryFn: async () => {
      let query = supabase
        .from("activities")
        .select("*, owner:user_profiles!owner_user_id(id, full_name)")
        .eq("activity_type", "task")
        // Hide soft-deleted tasks. Without this, deleting a task only
        // archived it but the side panel still rendered the row.
        .is("archived_at", null)
        .order("due_at", { ascending: true, nullsFirst: false });

      if (filters.account_id) query = query.eq("account_id", filters.account_id);
      if (filters.contact_id) query = query.eq("contact_id", filters.contact_id);
      if (filters.opportunity_id) query = query.eq("opportunity_id", filters.opportunity_id);
      if (filters.lead_id) query = query.eq("lead_id", filters.lead_id);

      const { data, error } = await query;
      if (error) throw error;
      const all = data as Activity[];
      return {
        // Open tasks: due date first, then priority (High → Medium → Low)
        // as the tiebreak so same-day tasks surface in importance order.
        open: all
          .filter((t) => !t.completed_at)
          .sort(compareTasksByDueThenPriority),
        completed: all.filter((t) => !!t.completed_at),
      };
    },
    enabled:
      !!filters.account_id ||
      !!filters.contact_id ||
      !!filters.opportunity_id ||
      !!filters.lead_id,
  });
}
