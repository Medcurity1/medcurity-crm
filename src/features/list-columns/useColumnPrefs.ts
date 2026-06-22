// Drives a list's column visibility from the per-user DB prefs. Renders the
// registry's defaults immediately (first paint) and reconciles when the saved
// row loads — same defaults-before-fetch behavior as useNotifPrefs.

import { useMemo } from "react";
import type { ColumnDescriptor } from "./columns";
import { useListColumnPrefs, useUpdateListColumnPrefs } from "./list-column-prefs-api";

export interface ColumnPrefs {
  /** Full registry, in declaration order. */
  allColumns: ColumnDescriptor[];
  /** Registry minus the user's hidden columns, preserving registry order. */
  visibleColumns: ColumnDescriptor[];
  isVisible: (key: string) => boolean;
  /** Toggle a non-locked column on/off (persists immediately). */
  toggle: (key: string) => void;
  /** Clear all hidden columns (back to defaults). */
  reset: () => void;
  /** How many toggleable columns are currently shown (for "can't empty" guard). */
  visibleToggleableCount: number;
}

export function useColumnPrefs(
  listKey: string,
  columns: ColumnDescriptor[],
): ColumnPrefs {
  const { data: config } = useListColumnPrefs(listKey);
  const update = useUpdateListColumnPrefs(listKey);

  // Reconcile the persisted deny-list against the canonical registry: only
  // honor keys that still exist and are actually hideable.
  const hidden = useMemo(() => {
    const hideable = new Set(
      columns.filter((c) => !c.locked).map((c) => c.key),
    );
    return new Set((config?.hidden ?? []).filter((k) => hideable.has(k)));
  }, [config, columns]);

  const visibleColumns = useMemo(
    () => columns.filter((c) => c.locked || !hidden.has(c.key)),
    [columns, hidden],
  );

  function toggle(key: string) {
    const col = columns.find((c) => c.key === key);
    if (!col || col.locked) return;
    const next = new Set(hidden);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    update.mutate({ hidden: [...next] });
  }

  function reset() {
    update.mutate({ hidden: [] });
  }

  return {
    allColumns: columns,
    visibleColumns,
    isVisible: (key) => columns.some((c) => c.key === key) && (
      columns.find((c) => c.key === key)!.locked || !hidden.has(key)
    ),
    toggle,
    reset,
    visibleToggleableCount: columns.filter(
      (c) => !c.locked && !hidden.has(c.key),
    ).length,
  };
}
