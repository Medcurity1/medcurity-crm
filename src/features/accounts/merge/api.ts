// Data layer for the guarded account pair-merge.
//
// Reads run under the caller's own RLS (any signed-in CRM user can read
// accounts), so no new read surface is introduced. The merge itself is the
// merge_account_pair RPC from migration 20260812000000 — server-guarded to
// CRM write roles, exactly two live accounts, optimistic-concurrency
// checked, whitelisted field choices, single transaction.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { MERGE_FIELDS } from "./merge-logic";

/** Everything the review screen needs about ONE side of the pair. */
export interface MergeSideAccount {
  id: string;
  name: string;
  account_number: string | null;
  created_at: string | null;
  updated_at: string;
  archived_at: string | null;
  owner_name: string | null;
  do_not_contact: boolean | null;
  partner_prospect: boolean | null;
  has_closed_won: boolean;
  open_opp_count: number;
  opportunity_count: number;
  contact_count: number;
  activity_count: number;
  attachment_count: number;
  /** Whitelisted profile fields, keyed by column name. */
  fields: Record<string, unknown>;
}

const FIELD_KEYS = MERGE_FIELDS.map((f) => f.key);

async function countRows(table: string, accountId: string, extra?: (q: any) => any): Promise<number> {
  let q = supabase.from(table).select("id", { count: "exact", head: true }).eq("account_id", accountId);
  if (extra) q = extra(q);
  const { count, error } = await q;
  if (error) throw error;
  return count ?? 0;
}

async function fetchSide(accountId: string): Promise<MergeSideAccount> {
  const selectCols = [
    "id", "name", "account_number", "created_at", "updated_at", "archived_at",
    "do_not_contact", "partner_prospect",
    ...FIELD_KEYS.filter((k) => k !== "name"),
    "owner:user_profiles!owner_user_id(full_name)",
  ].join(", ");

  const { data: row, error } = await supabase
    .from("accounts")
    .select(selectCols)
    .eq("id", accountId)
    .maybeSingle();
  if (error) throw error;
  if (!row) throw new Error("Account not found");
  // The dynamic select string defeats supabase-js's column inference; the
  // shape is exactly the columns requested above.
  const r = row as unknown as Record<string, unknown> & { owner?: { full_name?: string | null } | null };

  const { data: opps, error: oppErr } = await supabase
    .from("opportunities")
    .select("id, stage")
    .eq("account_id", accountId)
    .is("archived_at", null);
  if (oppErr) throw oppErr;
  const oppRows = (opps ?? []) as { id: string; stage: string }[];

  const [contactCount, activityCount, attachmentCount] = await Promise.all([
    countRows("contacts", accountId, (q) => q.is("archived_at", null)),
    countRows("activities", accountId),
    countRows("account_attachments", accountId),
  ]);

  const fields: Record<string, unknown> = {};
  for (const k of FIELD_KEYS) fields[k] = r[k];

  return {
    id: r.id as string,
    name: r.name as string,
    account_number: (r.account_number as string | null) ?? null,
    created_at: (r.created_at as string | null) ?? null,
    updated_at: r.updated_at as string,
    archived_at: (r.archived_at as string | null) ?? null,
    owner_name: r.owner?.full_name ?? null,
    do_not_contact: (r.do_not_contact as boolean | null) ?? null,
    partner_prospect: (r.partner_prospect as boolean | null) ?? null,
    has_closed_won: oppRows.some((o) => o.stage === "closed_won"),
    open_opp_count: oppRows.filter((o) => o.stage !== "closed_won" && o.stage !== "closed_lost").length,
    opportunity_count: oppRows.length,
    contact_count: contactCount,
    activity_count: activityCount,
    attachment_count: attachmentCount,
    fields,
  };
}

/** Both sides of the pair, fetched fresh whenever the review opens. */
export function useMergePair(idA: string | null, idB: string | null) {
  return useQuery({
    queryKey: ["merge-pair", idA, idB],
    enabled: !!idA && !!idB && idA !== idB,
    // Always re-fetch on open: the review must show CURRENT values, and the
    // updated_at snapshots below are the concurrency token for the RPC.
    staleTime: 0,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const [a, b] = await Promise.all([fetchSide(idA!), fetchSide(idB!)]);
      return { a, b };
    },
  });
}

export interface MergePairArgs {
  survivorId: string;
  loserId: string;
  fieldChoices: Record<string, unknown>;
  expectedSurvivorUpdatedAt: string;
  expectedLoserUpdatedAt: string;
  reason?: string;
}

export function useMergeAccountPair() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (args: MergePairArgs) => {
      const { data, error } = await supabase.rpc("merge_account_pair", {
        p_survivor_id: args.survivorId,
        p_loser_id: args.loserId,
        p_field_choices: args.fieldChoices,
        p_expected_survivor_updated_at: args.expectedSurvivorUpdatedAt,
        p_expected_loser_updated_at: args.expectedLoserUpdatedAt,
        p_reason: args.reason ?? null,
      });
      if (error) throw error;
      return data as { merge_id: string; survivor_id: string; loser_id: string; rows_reparented: number };
    },
    onSuccess: () => {
      // The merge touches accounts, their children, and the admin merge
      // history — refresh everything that could be on screen.
      queryClient.invalidateQueries({ queryKey: ["accounts"] });
      queryClient.invalidateQueries({ queryKey: ["contacts"] });
      queryClient.invalidateQueries({ queryKey: ["opportunities"] });
      queryClient.invalidateQueries({ queryKey: ["activities"] });
      queryClient.invalidateQueries({ queryKey: ["merge-pair"] });
      queryClient.invalidateQueries({ queryKey: ["account-merge-history"] });
    },
  });
}
