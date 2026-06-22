// Shared column descriptor for the per-user column picker (#20). Each list
// view declares a registry of these (module-level, in display order); the
// picker + table body both render from it via useColumnPrefs.

export interface ColumnDescriptor {
  /** Stable persisted id (e.g. "industry"). NOT necessarily the sort column. */
  key: string;
  /** Menu + header label. */
  label: string;
  /** PostgREST .order() column for SortableHeader (e.g. "account.name").
   *  Omit when the column isn't sortable. Kept separate from `key` because
   *  some columns sort on a different field than they display. */
  sortKey?: string;
  /** Cannot be hidden — the row-select checkbox, the primary Name link, a
   *  trailing actions/badge column. */
  locked?: boolean;
  /** Available but off by default (reserved; unused in v1). */
  defaultHidden?: boolean;
  align?: "left" | "right" | "center";
  /** Forwarded to the header cell (e.g. "w-10" for the select column). */
  headClassName?: string;
}
