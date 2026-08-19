import { normalizeReplyText } from "@/features/playbook/reply-text";

type ReplyTaskLike = {
  activity_type?: string | null;
  subject?: string | null;
  campaign_enrollment_id?: string | null;
};

export function isCampaignReplyTask(activity: ReplyTaskLike | null | undefined): boolean {
  if (!activity || activity.activity_type !== "task") return false;
  if (/^Reply from\s+/i.test(activity.subject ?? "")) return true;
  return !!activity.campaign_enrollment_id && /^Follow up with\s+/i.test(activity.subject ?? "");
}

/** Turn old Campaigns reply-task titles into the action a rep actually owns. */
export function activityTitleForDisplay(subject: string | null | undefined): string {
  const value = subject?.trim() || "Untitled activity";
  const legacyReply = value.match(/^Reply from\s+(.+?)(?:\s+[—–-]\s+.+)?$/i);
  return legacyReply ? `Follow up with ${legacyReply[1].trim()}` : value;
}

/** Keep provider HTML as system data, but never make a rep read or edit it. */
export function activityBodyForDisplay(body: string | null | undefined): string | null {
  if (!body?.trim()) return null;
  if (/<(?:html|head|body|div|p|table|span|style|blockquote)\b/i.test(body)) {
    return normalizeReplyText(body) ?? "Reply received. Open the related contact for the full conversation.";
  }
  return body.trim();
}
