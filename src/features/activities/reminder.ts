// Task reminder model — shared by every task form so the UX stays identical.
//
// The design (per Molly + Summer's workflows): a task notifies you by default.
// You pick the channels (in-app + email, both on to start) and WHEN:
//   - "On the due date" (default) — the common case: "tell me about it that day"
//   - "At a specific time" — a one-off reminder at a chosen moment
//   - Daily / Weekdays / Weekly "until due" — repeating reminders leading up
// Unchecking BOTH channels means no notification at all (the form warns you).

export type ReminderTiming = "due" | "custom" | "daily" | "weekdays" | "weekly";

export interface ReminderUI {
  inApp: boolean;
  email: boolean;
  timing: ReminderTiming;
  customAt: string; // datetime-local string; used by "custom" + repeat start
}

// Default: both channels on, remind on the due date.
export const EMPTY_REMINDER: ReminderUI = {
  inApp: true,
  email: true,
  timing: "due",
  customAt: "",
};

export const REPEAT_TIMINGS: ReminderTiming[] = ["daily", "weekdays", "weekly"];
export function isRepeat(t: ReminderTiming): boolean {
  return REPEAT_TIMINGS.includes(t);
}
/** Will this reminder actually notify the user? */
export function reminderWillNotify(r: ReminderUI): boolean {
  return r.inApp || r.email;
}

export interface ReminderFieldValues {
  reminder_schedule: "none" | "once" | "daily" | "weekdays" | "weekly";
  reminder_at: string | null;
  reminder_channels: Array<"in_app" | "email">;
}

/** Map the UI model to the activity columns the reminder engine reads. */
export function buildReminderFields(r: ReminderUI, dueIso: string | null): ReminderFieldValues {
  const channels: Array<"in_app" | "email"> = [];
  if (r.inApp) channels.push("in_app");
  if (r.email) channels.push("email");

  // No channels => no notification.
  if (channels.length === 0) {
    return { reminder_schedule: "none", reminder_at: null, reminder_channels: [] };
  }
  if (r.timing === "due") {
    // Fires on the due date/time. If there's no due date, reminder_at is null
    // and the engine simply never fires it (the form nudges for a due date).
    return { reminder_schedule: "once", reminder_at: dueIso, reminder_channels: channels };
  }
  if (r.timing === "custom") {
    const at = r.customAt ? new Date(r.customAt).toISOString() : dueIso;
    return { reminder_schedule: "once", reminder_at: at, reminder_channels: channels };
  }
  // Repeat cadence: start reminding now (or at the chosen start) and repeat
  // until the due date (the engine caps occurrences at due_at).
  const start = r.customAt ? new Date(r.customAt).toISOString() : new Date().toISOString();
  return { reminder_schedule: r.timing, reminder_at: start, reminder_channels: channels };
}

function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

/** Rebuild the UI model from a saved activity (for the edit form). */
export function reminderFromActivity(a: {
  reminder_schedule?: string | null;
  reminder_at?: string | null;
  due_at?: string | null;
  reminder_channels?: string[] | null;
}): ReminderUI {
  const sched = a.reminder_schedule ?? "none";
  if (sched === "none") {
    // No reminder was set — show channels off so the form reflects reality.
    return { inApp: false, email: false, timing: "due", customAt: "" };
  }
  const ch = a.reminder_channels ?? [];
  const inApp = ch.includes("in_app");
  const email = ch.includes("email");
  if (sched === "once") {
    const sameAsDue =
      !!a.reminder_at && !!a.due_at &&
      new Date(a.reminder_at).getTime() === new Date(a.due_at).getTime();
    if (sameAsDue) return { inApp, email, timing: "due", customAt: "" };
    return { inApp, email, timing: "custom", customAt: a.reminder_at ? toLocalInput(a.reminder_at) : "" };
  }
  return {
    inApp,
    email,
    timing: sched as ReminderTiming,
    customAt: a.reminder_at ? toLocalInput(a.reminder_at) : "",
  };
}
