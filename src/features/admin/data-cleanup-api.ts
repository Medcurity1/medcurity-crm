// React-query hooks for the admin "Data Cleanup" tab: lead↔contact
// de-duplication and account merge. Every RPC enforces admin server-side
// (current_app_role()/is_admin()); these hooks are the client wrappers.
//
// Backed by migrations:
//   20260616000012_lead_contact_dedup_finder.sql
//   20260616000013_account_dedup_merge.sql

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

/* ============================ Lead ↔ Contact ============================ */

// (Lead↔contact dedup hooks removed 2026-07-20 with the lead type;
// their RPCs were dropped in migration 20260720170000.)

export interface AccountDuplicateGroupRow {
  group_key: string;
  group_size: number;
  account_id: string;
  name: string;
  account_number: string | null;
  // The dedup finder RPCs now return a single customer_status column
  // (client / prospect / former_client) — was lifecycle_status + account_status.
  customer_status: string | null;
  owner_user_id: string | null;
  owner_name: string | null;
  contact_count: number;
  opportunity_count: number;
  has_closed_won: boolean;
  open_opp_count: number;
  total_won_amount: number;
  created_at: string;
  last_activity_at: string | null;
}

export type AccountMatchBy = "name" | "domain";

export function useAccountDuplicateGroups(matchBy: AccountMatchBy = "name") {
  return useQuery({
    queryKey: ["data-cleanup", "account-dups", matchBy],
    queryFn: async () => {
      const rpc =
        matchBy === "domain"
          ? "find_accounts_sharing_email_domain"
          : "find_account_duplicate_groups";
      const { data, error } = await supabase.rpc(rpc, { p_limit_groups: 500 });
      if (error) throw error;
      return (data ?? []) as AccountDuplicateGroupRow[];
    },
  });
}

export function useMergeAccounts() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      survivorId: string;
      loserIds: string[];
      reason?: string;
    }) => {
      const { data, error } = await supabase.rpc("merge_accounts", {
        p_survivor_id: args.survivorId,
        p_loser_ids: args.loserIds,
        p_reason: args.reason ?? null,
      });
      if (error) throw error;
      // Smart-fill: the merge keeps the survivor's fields; this fills its
      // BLANK profile fields (phone, address, etc.) from the losers so nothing
      // useful is lost. Non-critical — a failure here doesn't undo the merge.
      const { error: fillError } = await supabase.rpc("account_fill_blanks", {
        p_survivor_id: args.survivorId,
        p_loser_ids: args.loserIds,
      });
      if (fillError) console.error("account_fill_blanks failed", fillError);
      return data as {
        merge_id: string;
        survivor_id: string;
        losers_archived: number;
        rows_reparented: number;
      };
    },
    onSuccess: () => {
      // A merge moves contacts, opps, activities, partners… across accounts.
      qc.invalidateQueries({ queryKey: ["data-cleanup", "account-dups"] });
      qc.invalidateQueries({ queryKey: ["data-cleanup", "merge-history"] });
      qc.invalidateQueries({ queryKey: ["accounts"] });
      qc.invalidateQueries({ queryKey: ["contacts"] });
      qc.invalidateQueries({ queryKey: ["opportunities"] });
    },
  });
}

/* ─────────────────── Dismiss "not a duplicate" groups ─────────────────── */

export function useDismissAccountDuplicate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { accountIds: string[]; reason?: string }) => {
      const { data, error } = await supabase.rpc("dismiss_account_duplicate_group", {
        p_account_ids: args.accountIds,
        p_reason: args.reason ?? null,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["data-cleanup", "account-dups"] });
      qc.invalidateQueries({ queryKey: ["data-cleanup", "account-dismissals"] });
    },
  });
}

export interface AccountDuplicateDismissalRow {
  id: string;
  group_account_ids: string[];
  group_key: string | null;
  account_names: string[] | null;
  reason: string | null;
  dismissed_by_name: string | null;
  dismissed_at: string;
}

export function useAccountDuplicateDismissals() {
  return useQuery({
    queryKey: ["data-cleanup", "account-dismissals"],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("list_account_duplicate_dismissals");
      if (error) throw error;
      return (data ?? []) as AccountDuplicateDismissalRow[];
    },
  });
}

export function useRestoreAccountDuplicateDismissal() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.rpc("restore_account_duplicate_dismissal", { p_id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["data-cleanup", "account-dups"] });
      qc.invalidateQueries({ queryKey: ["data-cleanup", "account-dismissals"] });
    },
  });
}

export interface AccountMergeHistoryRow {
  id: string;
  survivor_id: string;
  loser_ids: string[];
  reason: string | null;
  merged_by: string | null;
  merged_at: string;
  undone_at: string | null;
  before_state: {
    reparented_total?: number;
    loser_rows?: Array<{ id: string; name: string }>;
  } | null;
  survivor?: { name: string } | null;
  merged_by_user?: { full_name: string } | null;
}

export function useAccountMergeHistory() {
  return useQuery({
    queryKey: ["data-cleanup", "merge-history"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("account_merges")
        .select(
          "id, survivor_id, loser_ids, reason, merged_by, merged_at, undone_at, before_state, " +
            "survivor:accounts!survivor_id(name), merged_by_user:user_profiles!merged_by(full_name)"
        )
        .order("merged_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as unknown as AccountMergeHistoryRow[];
    },
  });
}

export function useUndoAccountMerge() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (mergeId: string) => {
      const { data, error } = await supabase.rpc("undo_account_merge", {
        p_merge_id: mergeId,
      });
      if (error) throw error;
      return data as Record<string, unknown>;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["data-cleanup"] });
      qc.invalidateQueries({ queryKey: ["accounts"] });
      qc.invalidateQueries({ queryKey: ["contacts"] });
      qc.invalidateQueries({ queryKey: ["opportunities"] });
    },
  });
}
