import { useCallback, useState } from "react";
import { useAuth } from "@/features/auth/AuthProvider";

export interface RecentRecord {
  id: string;
  entity: "account" | "contact" | "opportunity" | "lead";
  name: string;
  viewedAt: string;
}

// Per-USER key: recents are personal. The old device-wide key leaked
// record names between users on a shared browser (and served stale lists
// after switching accounts), so it's purged on first load.
const LEGACY_KEY = "crm_recent_records";
const MAX_RECENT = 10;

function keyFor(userId: string | null | undefined): string | null {
  return userId ? `${LEGACY_KEY}:${userId}` : null;
}

function loadFromStorage(userId: string | null | undefined): RecentRecord[] {
  const key = keyFor(userId);
  if (!key) return [];
  try {
    // One-time cleanup of the old shared-device key.
    localStorage.removeItem(LEGACY_KEY);
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as RecentRecord[]) : [];
  } catch {
    return [];
  }
}

export function useRecentRecords() {
  const { user } = useAuth();
  const userId = user?.id;
  const [records, setRecords] = useState<RecentRecord[]>(() => loadFromStorage(userId));

  // Each hook instance holds its own state snapshot, so a long-lived
  // consumer (the Cmd+K palette in the top bar) must re-read storage when
  // it opens — otherwise it shows the list as of page load forever.
  const refresh = useCallback(() => {
    setRecords(loadFromStorage(userId));
  }, [userId]);

  const addRecent = useCallback(
    (record: Omit<RecentRecord, "viewedAt">) => {
      const key = keyFor(userId);
      if (!key) return;
      // Read-modify-write against STORAGE (not this instance's state) so
      // concurrent hook instances can't clobber each other's additions.
      const current = loadFromStorage(userId);
      const filtered = current.filter(
        (r) => !(r.id === record.id && r.entity === record.entity),
      );
      const updated = [
        { ...record, viewedAt: new Date().toISOString() },
        ...filtered,
      ].slice(0, MAX_RECENT);
      try {
        localStorage.setItem(key, JSON.stringify(updated));
      } catch {
        // ignore quota/serialization errors
      }
      setRecords(updated);
    },
    [userId],
  );

  return { records, addRecent, refresh };
}
