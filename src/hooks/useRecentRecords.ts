import { useState } from "react";

export interface RecentRecord {
  id: string;
  entity: "account" | "contact" | "opportunity" | "lead";
  name: string;
  viewedAt: string;
}

const STORAGE_KEY = "crm_recent_records";
const MAX_RECENT = 10;

function loadFromStorage(): RecentRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as RecentRecord[]) : [];
  } catch {
    return [];
  }
}

export function useRecentRecords() {
  const [records, setRecords] = useState<RecentRecord[]>(() => loadFromStorage());

  function addRecent(record: Omit<RecentRecord, "viewedAt">) {
    setRecords((prev) => {
      const filtered = prev.filter(
        (r) => !(r.id === record.id && r.entity === record.entity)
      );
      const updated = [
        { ...record, viewedAt: new Date().toISOString() },
        ...filtered,
      ].slice(0, MAX_RECENT);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      } catch {
        // ignore quota/serialization errors
      }
      return updated;
    });
  }

  return { records, addRecent };
}
