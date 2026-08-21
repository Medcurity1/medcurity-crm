type NotificationTargetInput = {
  type?: string | null;
  conversation_id?: string | null;
  link?: string | null;
};

/** Canonical notification destination. Conversation metadata wins over a
 * stale persisted link so every delivery surface opens the correct stream. */
export function notificationTarget(notification: NotificationTargetInput): string | null {
  const id = notification.conversation_id;
  const type = notification.type ?? "";
  if (id && type.startsWith("support_")) {
    return `/support?conversation=${encodeURIComponent(id)}`;
  }
  if (id && type.startsWith("meddy_")) {
    return `/meddy?conversation=${encodeURIComponent(id)}`;
  }
  return notification.link ?? null;
}
