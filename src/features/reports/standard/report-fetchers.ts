// Shared batch-fetch helpers for standard reports.
//
// PostgREST embedded joins (e.g. `account:accounts!account_id(name)`)
// were silently returning empty data on some report queries in staging.
// These helpers do an explicit second-round fetch by ID so we don't
// depend on PostgREST correctly resolving the relationship.
//
// Also: PostgREST caps each response at 1000 rows by default. The
// `fetchAllRows` helper pages through .range() calls until the
// server stops returning full pages. Use it anywhere a report might
// legitimately exceed 1000 rows (ARR Base Dataset, MQL Contacts).

import { supabase } from "@/lib/supabase";

/**
 * Paginate through a query until all rows are fetched. Pass a factory
 * that rebuilds a fresh query for each page (PostgREST filter builders
 * aren't reusable after .range() is applied).
 *
 * @param buildQuery returns a query already filtered/ordered, but
 *                   WITHOUT .range() applied.
 * @param pageSize   rows per page (default 1000, the PostgREST max).
 * @param hardLimit  safety cap to prevent runaway loops (default 50k).
 */
export async function fetchAllRows<T = unknown>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  buildQuery: () => any,
  pageSize = 1000,
  hardLimit = 50_000,
): Promise<T[]> {
  const all: T[] = [];
  let from = 0;
  while (all.length < hardLimit) {
    const to = from + pageSize - 1;
    const { data, error } = await buildQuery().range(from, to);
    if (error) throw error;
    const rows = (data ?? []) as T[];
    all.push(...rows);
    if (rows.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

/**
 * Fetch accounts by a set of IDs, return map id → {name, lifecycle_status,
 * owner_user_id, renewal_type}. Batches into chunks of 500 to stay under
 * PostgREST's URL length limit.
 */
export async function fetchAccountsById(ids: Set<string>): Promise<
  Map<
    string,
    {
      name: string;
      lifecycle_status: string | null;
      owner_user_id: string | null;
      renewal_type: string | null;
      notes: string | null;
      lead_source: string | null;
      created_at: string;
      account_number: string | null;
      account_type: string | null;
    }
  >
> {
  const map = new Map();
  const idList = Array.from(ids);
  const chunkSize = 500;
  for (let i = 0; i < idList.length; i += chunkSize) {
    const chunk = idList.slice(i, i + chunkSize);
    if (chunk.length === 0) continue;
    const { data, error } = await supabase
      .from("accounts")
      .select(
        "id, name, lifecycle_status, owner_user_id, renewal_type, notes, lead_source, created_at, account_number, account_type",
      )
      .in("id", chunk);
    if (error) throw error;
    for (const a of data ?? []) {
      map.set(a.id as string, a);
    }
  }
  return map;
}

/**
 * Fetch user_profiles by a set of IDs, return map id → {full_name, role}.
 */
export async function fetchUsersById(ids: Set<string>): Promise<
  Map<string, { full_name: string | null; role: string | null }>
> {
  const map = new Map();
  const idList = Array.from(ids).filter(Boolean);
  if (idList.length === 0) return map;
  const chunkSize = 500;
  for (let i = 0; i < idList.length; i += chunkSize) {
    const chunk = idList.slice(i, i + chunkSize);
    const { data, error } = await supabase
      .from("user_profiles")
      .select("id, full_name, role")
      .in("id", chunk);
    if (error) throw error;
    for (const u of data ?? []) {
      map.set(u.id as string, u);
    }
  }
  return map;
}
