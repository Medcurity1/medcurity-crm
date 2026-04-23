import { z } from "zod";

export const activityFormSchema = z.object({
  activity_type: z.enum(["call", "email", "meeting", "note", "task"], {
    message: "Select an activity type",
  }),
  subject: z.string().min(1, "Subject is required"),
  body: z.string().optional(),
  due_at: z.string().optional(),
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
