const SWEEP_UTC_HOUR = 13;
const SWEEP_UTC_MINUTE = 10;

export function dailySweepLocalTimeLabel(now = new Date()): string {
  const utc = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    SWEEP_UTC_HOUR,
    SWEEP_UTC_MINUTE,
  ));
  return utc.toLocaleTimeString("en-US", {
    timeZone: "America/Los_Angeles",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function lastSyncedLabel(
  iso: string | null | undefined,
  nowMs = Date.now(),
): string | null {
  if (!iso) return null;
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return null;
  const deltaMin = Math.max(0, Math.round((nowMs - then) / 60000));
  if (deltaMin < 1) return "Synced just now";
  if (deltaMin === 1) return "Synced 1 min ago";
  if (deltaMin < 60) return `Synced ${deltaMin} min ago`;
  const hours = Math.round(deltaMin / 60);
  if (hours === 1) return "Synced 1 hour ago";
  if (hours < 36) return `Synced ${hours} hours ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "Synced 1 day ago" : `Synced ${days} days ago`;
}
