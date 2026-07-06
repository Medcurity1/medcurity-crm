import { z } from "zod";

export const activityFormSchema = z.object({
  // "note" stays in the enum because legacy activities of that type
  // still exist in the database and need to be editable. The UI no
  // longer exposes "Note" as a *new* activity option — see
  // ActivityForm's `activityTypes` array — so this enum value is
  // effectively edit-only going forward.
  activity_type: z.enum(["call", "email", "meeting", "note", "task", "webinar", "conference"], {
    message: "Select an activity type",
  }),
  subject: z.string().min(1, "Subject is required"),
  body: z.string().optional(),
  /**
   * When the interaction happened (or was logged). Applies to all
   * activity types. Defaults to today at form open.
   */
  activity_date: z.string().optional(),
  /**
   * Only meaningful for tasks. When the task is due.
   */
  due_at: z.string().optional(),
  /**
   * Which contact this interaction was with. Optional — activities
   * logged at the account level without a specific person are still
   * valid. When set, the activity shows on the contact's timeline
   * too, so a rep doesn't have to remember to also log it there.
   */
  contact_id: z.string().nullable().optional(),
  // Only surfaced for activity_type = 'task'. 'normal' is the Medium tier
  // (the default); the enum has no 'medium' member by design (see taskOrder.ts).
  priority: z.enum(["high", "normal", "low"]).optional(),
  // Only surfaced for activity_type = 'task'.
  reminder_schedule: z
    .enum(["none", "once", "daily", "weekdays", "weekly"])
    .optional(),
  reminder_at: z.string().optional(),
  reminder_channels: z
    .array(z.enum(["in_app", "email"]))
    .optional(),
});

export type ActivityFormValues = z.infer<typeof activityFormSchema>;
