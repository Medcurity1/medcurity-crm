import type { Notification } from "@/types/crm";
import { normalizeReplyText } from "@/features/playbook/reply-text";

type DisplayNotification = Pick<Notification, "type" | "title" | "message">;

function cleanMessage(message: string | null): string | null {
  if (!message) return null;
  if (/<(?:html|head|body|div|p|table|span|style)\b/i.test(message)) {
    return normalizeReplyText(message);
  }
  return message;
}

/** Keep the bell human-readable for both new rows and legacy campaign QA rows. */
export function notificationForDisplay(n: DisplayNotification): { title: string; message: string | null } {
  const reminderReply = n.title.match(/^Reminder:\s*Reply from\s+(.+?)\s+[—–-]\s+(.+)$/i);
  if (n.type === "task_due" && reminderReply) {
    const reply = cleanMessage(n.message);
    return {
      title: "Reply follow-up due",
      message: reply ? `${reminderReply[1]}: ${reply}` : `Follow up with ${reminderReply[1]}.`,
    };
  }

  const assignedReply = n.title.match(/^Task assigned to you:\s*Reply from\s+(.+?)\s+[—–-]\s+(.+)$/i);
  if (n.type === "task_assigned" && assignedReply) {
    return {
      title: "Reply follow-up assigned",
      message: `Follow up with ${assignedReply[1]}.`,
    };
  }

  if (n.type === "engagement" && n.title === "Reply received") {
    const who = n.message?.match(/^(.+?)\s+replied\s+in\s+/i)?.[1];
    return {
      title: "Reply received",
      message: who ? `${who} replied. Sequence stopped.` : cleanMessage(n.message),
    };
  }

  return { title: n.title, message: cleanMessage(n.message) };
}
