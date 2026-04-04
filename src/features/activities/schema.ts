import { z } from "zod";

export const activityFormSchema = z.object({
  activity_type: z.enum(["call", "email", "meeting", "note", "task"], {
    message: "Select an activity type",
  }),
  subject: z.string().min(1, "Subject is required"),
  body: z.string().optional(),
  due_at: z.string().optional(),
});

export type ActivityFormValues = z.infer<typeof activityFormSchema>;
