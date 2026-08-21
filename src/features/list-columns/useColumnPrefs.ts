// Drives a list's column visibility from the per-user DB prefs. Renders the
// registry's defaults immediately (first paint) and reconciles when the saved
// row loads — same defaults-before-fetch behavior as useNotifPrefs.

import { useMemo } from "react";
import type { ColumnDescriptor } from "./columns";
import { useListColumnPrefs, useUpdateListColumnPrefs, type ColumnConfig } from "./list-column-prefs-api";

export interface ColumnPrefs {
  /** Full registry, in declaration order. */
  allColumns: ColumnDescriptor[];
  /** Registry minus the user's hidden columns, preserving registry order. */
  visibleColumns: ColumnDescriptor[];
  isVisible: (key: string) => boolean;
  /** Toggle a non-locked column on/off (persists immediately). */
  toggle: (key: string) => void;
  /** Clear all overrides (back to defaults — defaultHidden columns hide again). */
  reset: () => void;
  /** How many toggleable columns are currently shown (for "can't empty" guard). */
  visibleToggleableCount: number;
}

/**
 * The one visibility rule, pure and testable (Summer 8/19 — the Expected
 * Close column made `defaultHidden` real): a column is hidden when the user
 * hid it (deny-list) OR it's hidden by default and the user hasn't shown it
 * (allow-list). Only keys that still exist and are hideable are honored, so
 * a renamed/removed column can't strand a stale pref.
 */
export function computeHiddenKeys(
  columns: ColumnDescriptor[],
  config: ColumnConfig | undefined,
): Set<string> {
  const hideable = new Set(columns.filter((c) => !c.locked).map((c) => c.key));
  const hidden = new Set((config?.hidden ?? []).filter((k) => hideable.has(k)));
  const shown = new Set((config?.shown ?? []).filter((k) => hideable.has(k)));
  for (const c of columns) {
    if (c.defaultHidden && !c.locked && !shown.has(c.key)) hidden.add(c.key);
  }
  return hidden;
}

export function useColumnPrefs(
  listKey: string,
  columns: ColumnDescriptor[],
): ColumnPrefs {
  const { data: config } = useListColumnPrefs(listKey);
  const update = useUpdateListColumnPrefs(listKey);

  const hidden = useMemo(() => computeHiddenKeys(columns, config), [config, columns]);

  const visibleColumns = useMemo(
    () => columns.filter((c) => c.locked || !hidden.has(c.key)),
    [columns, hidden],
  );

  function toggle(key: string) {
    const col = columns.find((c) => c.key === key);
    if (!col || col.locked) return;
    const denied = new Set(config?.hidden ?? []);
    const shown = new Set(config?.shown ?? []);
    if (hidden.has(key)) {
      // Show it: clear any deny entry; defaultHidden columns also need an
      // explicit allow entry.
      denied.delete(key);
      if (col.defaultHidden) shown.add(key);
    } else {
      // Hide it: drop the allow entry; a default-visible column also needs
      // an explicit deny entry.
      shown.delete(key);
      if (!col.defaultHidden) denied.add(key);
    }
    update.mutate({ hidden: [...denied], shown: [...shown] });
  }

  function reset() {
    update.mutate({ hidden: [], shown: [] });
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
