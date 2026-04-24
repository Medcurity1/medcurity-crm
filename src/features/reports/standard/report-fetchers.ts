// Shared batch-fetch helpers for standard reports.
//
// PostgREST embedded joins (e.g. `account:accounts!account_id(name)`)
// were silently returning empty data on some report queries in staging.
// These helpers do an explicit second-round fetch by ID so we don't
// depend on PostgREST correctly resolving the relationship.

import { supabase } from "@/lib/supabase";

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
