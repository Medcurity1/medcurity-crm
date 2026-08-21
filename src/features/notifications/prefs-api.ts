// Per-user notification preferences (user_notification_prefs.prefs jsonb).
//
// Key shape is the Nexus scheme so the ported delivery engine reads it
// 1:1 — per notification type <key>:
//   <key>            banner on/off   (default ON via `!== false`)
//   sound_<key>      sound on/off    (default ON via `!== false`)
//   soundtype_<key>  soft|melody|pulse|chime (default per-type below)
//   duration_<key>   seconds: 0 | 5 | 10 | 30 (banner duration AND
//                    sound-repeat duration — one knob, Nexus parity)
// plus email opt-ins (default OFF — only explicit true subscribes;
// the edge functions query prefs->>key = 'true'):
//   email_meddy_form_alert | email_meddy_missed_chat |
//   email_meddy_weekly_report

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/features/auth/AuthProvider";

export type NotifPrefs = Record<string, unknown>;

export type NotifTypeDef = {
  key: string;
  label: string;
  desc: string;
  defSound: string;
  defDuration: number;
  adminOnly?: boolean;
};

// The 5 Meddy types — labels/descriptions/defaults verbatim from Nexus
// (index.html:10320-10326). meddy_contact_received is admin-only by
// decision (Nexus showed it to everyone but only notified admins).
export const MEDDY_NOTIF_TYPES: NotifTypeDef[] = [
  {
    key: "meddy_human_requested",
    label: "Notify when someone requests a human",
    desc: "When a visitor asks to talk to a person",
    defSound: "beacon",
    defDuration: 5,
  },
  {
    key: "meddy_new_chat",
    label: "Notify when any new chat starts",
    desc: "When a visitor starts chatting on medcurity.com",
    defSound: "bloom",
    defDuration: 0,
  },
  {
    key: "meddy_buying_intent",
    label: "Notify when a visitor shows buying intent",
    desc: "Keywords like pricing, demo, purchase detected",
    defSound: "musicbox",
    defDuration: 5,
  },
  {
    key: "meddy_missed_chat",
    label: "Missed chat alert",
    desc: "When a visitor has been waiting 5+ minutes with no response",
    defSound: "beacon",
    defDuration: 5,
  },
  {
    key: "meddy_contact_received",
    label: "New contact form submitted",
    desc: "When a visitor submits their contact information",
    defSound: "quill",
    defDuration: 5,
    adminOnly: true,
  },
];

// Meddy Support (platform Coach escalations) — separate stream from the
// website Meddy types above.
export const SUPPORT_NOTIF_TYPES: NotifTypeDef[] = [
  {
    key: "support_human_requested",
    label: "Platform customer requests a human",
    desc: "When an app.medcurity.com customer asks Meddy for a person",
    defSound: "beacon",
    defDuration: 5,
  },
  {
    key: "support_new_chat",
    label: "Platform chat reopened",
    desc: "When a platform customer writes again after their chat ended",
    defSound: "bloom",
    defDuration: 5,
  },
];

// Existing CRM notification types, now configurable the same way.
export const CRM_NOTIF_TYPES: NotifTypeDef[] = [
  {
    key: "task_due",
    label: "Task reminders",
    desc: "When one of your tasks comes due",
    defSound: "lantern",
    defDuration: 5,
  },
  {
    key: "renewal_upcoming",
    label: "Renewal reminders",
    desc: "When an account renewal is approaching",
    defSound: "felt",
    defDuration: 5,
  },
  // Off-switch read by notify_assessor_tasks_open()
  // (20260821190000, coalesce(prefs->>'assessor_needed', true)).
  {
    key: "assessor_needed",
    label: "Assessor needed",
    desc: "Daily reminder while service deals are missing an Assigned Assessor",
    defSound: "lantern",
    defDuration: 5,
  },
  {
    key: "deal_high_five",
    label: "High fives",
    desc: "When a teammate high-fives one of your closed deals",
    defSound: "musicbox",
    defDuration: 5,
  },
  // Hand-offs (survey T5). These keys are read straight out of the DB
  // triggers' off-switch check (coalesce(prefs->>'<key>', true)) in
  // 20260817140000_assignment_notifications.sql — keep them in sync.
  {
    key: "record_assigned",
    label: "Records assigned to me",
    desc: "When someone makes you the owner of an account, contact, or opportunity",
    defSound: "quill",
    defDuration: 5,
  },
  {
    key: "task_assigned",
    label: "Tasks assigned to me",
    desc: "When someone creates or hands you a task",
    defSound: "felt",
    defDuration: 5,
  },
  {
    key: "follow_up_due",
    label: "Account follow-up reminders",
    desc: "The daily grouped bell when follow-up dates are due",
    defSound: "lantern",
    defDuration: 5,
  },
];

export const EMAIL_OPT_INS: Array<{ key: string; label: string; desc: string }> = [
  {
    key: "email_meddy_form_alert",
    label: "Contact form alert emails",
    desc: "Email me when a website visitor submits their contact info through Meddy",
  },
  {
    key: "email_meddy_missed_chat",
    label: "Missed chat emails",
    desc: "Email me when a visitor requested a human and nobody responded for 5 minutes",
  },
  {
    key: "email_meddy_weekly_report",
    label: "Meddy weekly report",
    desc: "The Tuesday morning AI recap of website chat activity, leads, and trends",
  },
];

export function defaultsFor(def: NotifTypeDef): NotifPrefs {
  return {
    [`soundtype_${def.key}`]: def.defSound,
    [`duration_${def.key}`]: def.defDuration,
  };
}

/** Per-type default duration (seconds) — keeps the delivery engine's
 * fallback in sync with what the settings rows display. */
export const DEFAULT_DURATIONS: Record<string, number> = Object.fromEntries(
  [...MEDDY_NOTIF_TYPES, ...SUPPORT_NOTIF_TYPES, ...CRM_NOTIF_TYPES].map((t) => [t.key, t.defDuration]),
);

export function useNotifPrefs() {
  const { user } = useAuth();
  return useQuery<{ prefs: NotifPrefs; pushover_key: string | null }>({
    queryKey: ["notif-prefs", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_notification_prefs")
        .select("prefs, pushover_key")
        .eq("user_id", user!.id)
        .maybeSingle();
      if (error) throw error;
      return {
        prefs: (data?.prefs ?? {}) as NotifPrefs,
        pushover_key: data?.pushover_key ?? null,
      };
    },
  });
}

/** Merge-write preference keys (immediate save on change, Nexus style). */
export function useUpdateNotifPrefs() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    // Scope serializes prefs writes app-wide: a second toggle never reads
    // the row before the first one's upsert commits (lost-update fix).
    scope: { id: "notif-prefs" },
    mutationFn: async (patch: NotifPrefs) => {
      const { data: existing, error: readErr } = await supabase
        .from("user_notification_prefs")
        .select("prefs")
        .eq("user_id", user!.id)
        .maybeSingle();
      if (readErr) throw readErr;
      const merged = { ...((existing?.prefs ?? {}) as NotifPrefs), ...patch };
      const { error } = await supabase
        .from("user_notification_prefs")
        .upsert({ user_id: user!.id, prefs: merged }, { onConflict: "user_id" });
      if (error) throw error;
      return merged;
    },
    onSuccess: (merged) => {
      qc.setQueryData(
        ["notif-prefs", user?.id],
        (old: { prefs: NotifPrefs; pushover_key: string | null } | undefined) => ({
          prefs: merged,
          pushover_key: old?.pushover_key ?? null,
        }),
      );
    },
    onError: (err) => toast.error((err as Error).message),
  });
}

export function useSavePushoverKey() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    scope: { id: "notif-prefs" },
    mutationFn: async (key: string) => {
      const trimmed = key.trim();
      // UPDATE first so a concurrent prefs save is never overwritten with
      // a stale snapshot; INSERT only when no row exists yet.
      const { data: updated, error: updErr } = await supabase
        .from("user_notification_prefs")
        .update({ pushover_key: trimmed || null })
        .eq("user_id", user!.id)
        .select("user_id");
      if (updErr) throw updErr;
      if ((updated ?? []).length === 0) {
        const { error } = await supabase
          .from("user_notification_prefs")
          .insert({ user_id: user!.id, pushover_key: trimmed || null });
        if (error) throw error;
      }
      return trimmed || null;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notif-prefs"] });
      toast.success("Pushover key saved");
    },
    onError: (err) => toast.error((err as Error).message),
  });
}
