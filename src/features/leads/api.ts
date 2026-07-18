import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Lead } from "@/types/crm";
import { buildIndustryOrClause } from "./industry-keywords";
import { buildPersonSearchClause } from "@/lib/search-clause";

interface LeadFilters {
  search?: string;
  status?: string | string[];
  source?: string | string[];
  qualification?: string | string[];
  ownerId?: string | "mine" | string[];
  rating?: string | string[];
  industryCategory?: string | string[];
  verified?: "true" | "false";
  /** Include converted leads (default: false — they're hidden Salesforce-style). */
  includeConverted?: boolean;
  sortColumn?: string | null;
  sortDirection?: "asc" | "desc";
  page?: number;
  pageSize?: number;
}

export function useLeads(filters?: LeadFilters) {
  return useQuery({
    queryKey: ["leads", filters],
    queryFn: async () => {
      const page = filters?.page ?? 0;
      const pageSize = filters?.pageSize ?? 25;
      const sortCol = filters?.sortColumn ?? "created_at";
      const sortAsc = (filters?.sortDirection ?? (filters?.sortColumn ? "asc" : "desc")) === "asc";
      let query = supabase
        .from("leads")
        // 'estimated' uses Postgres pg_class reltuples instead of a
        // full COUNT(*) — orders of magnitude faster on a 30k-row table
        // and accurate enough for pagination controls. Falls back to
        // an exact count only when the estimate is below ~1000.
        .select("*, owner:user_profiles!owner_user_id(id, full_name)", { count: "estimated" })
        .is("archived_at", null)
        .order(sortCol, { ascending: sortAsc, nullsFirst: false })
        // Stable tiebreaker so offset paging can't duplicate/skip rows
        // that tie on sortCol at page boundaries.
        .order("id", { ascending: true })
        .range(page * pageSize, (page + 1) * pageSize - 1);

      if (filters?.search) {
        const orClause = buildPersonSearchClause(filters.search, [
          "first_name",
          "last_name",
          "company",
          "email",
          "industry",
        ]);
        if (orClause) query = query.or(orClause);
      }
      if (filters?.status) {
        if (Array.isArray(filters.status)) {
          if (filters.status.length > 0) query = query.in("status", filters.status);
        } else {
          query = query.eq("status", filters.status);
        }
      }
      if (filters?.source) {
        if (Array.isArray(filters.source)) {
          if (filters.source.length > 0) query = query.in("source", filters.source);
        } else {
          query = query.eq("source", filters.source);
        }
      }
      if (filters?.qualification) {
        if (Array.isArray(filters.qualification)) {
          if (filters.qualification.length > 0) query = query.in("qualification", filters.qualification);
        } else {
          query = query.eq("qualification", filters.qualification);
        }
      }
      if (Array.isArray(filters?.ownerId)) {
        const ids = filters!.ownerId;
        if (ids.includes("mine")) {
          const { data: userData } = await supabase.auth.getUser();
          if (userData.user?.id) {
            const resolved = Array.from(
              new Set(ids.map((v) => (v === "mine" ? userData.user!.id : v))),
            );
            if (resolved.length > 0) query = query.in("owner_user_id", resolved);
          } else if (ids.length > 1) {
            const noMine = ids.filter((v) => v !== "mine");
            if (noMine.length > 0) query = query.in("owner_user_id", noMine);
          }
        } else if (ids.length > 0) {
          query = query.in("owner_user_id", ids);
        }
      } else if (filters?.ownerId && filters.ownerId !== "mine") {
        query = query.eq("owner_user_id", filters.ownerId);
      } else if (filters?.ownerId === "mine") {
        const { data: userData } = await supabase.auth.getUser();
        if (userData.user?.id) query = query.eq("owner_user_id", userData.user.id);
      }
      if (filters?.rating) {
        if (Array.isArray(filters.rating)) {
          if (filters.rating.length > 0) query = query.in("rating", filters.rating);
        } else {
          query = query.eq("rating", filters.rating);
        }
      }
      if (filters?.industryCategory) {
        // OR-match the normalized enum AND legacy free-text column so
        // SF-imported leads (industry_category=null, industry='Rural
        // Hospital') still match. See `industry-keywords.ts`.
        const cats = Array.isArray(filters.industryCategory)
          ? filters.industryCategory
          : [filters.industryCategory];
        const orClause = buildIndustryOrClause(cats);
        if (orClause) query = query.or(orClause);
      }
      if (filters?.verified === "true") query = query.eq("verified", true);
      else if (filters?.verified === "false") query = query.eq("verified", false);

      // Hide converted leads by default — they're tombstones with
      // pointers to the contact/account that took over. Reps still
      // need them findable, just not in the working list.
      if (!filters?.includeConverted) {
        query = query.is("converted_at", null);
      }

      const { data, error, count } = await query;
      if (error) throw error;
      return { data: data as Lead[], count: count ?? 0 };
    },
  });
}

export function useLead(id: string | undefined) {
  return useQuery({
    queryKey: ["leads", id],
    queryFn: async () => {
      if (!id) throw new Error("Missing lead ID");
      const { data, error } = await supabase
        .from("leads")
        .select("*, owner:user_profiles!owner_user_id(id, full_name), creator:user_profiles!created_by(id, full_name), updater:user_profiles!updated_by(id, full_name)")
        .eq("id", id)
        .single();
      if (error) throw error;
      return data as Lead;
    },
    enabled: !!id,
  });
}

export function useCreateLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: Partial<Lead>) => {
      const { data, error } = await supabase
        .from("leads")
        .insert(values)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["leads"] });
    },
  });
}

export function useUpdateLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...values }: Partial<Lead> & { id: string }) => {
      const { data, error } = await supabase
        .from("leads")
        .update(values)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["leads"] });
      qc.invalidateQueries({ queryKey: ["leads", vars.id] });
    },
  });
}

export function useBulkUpdateOwner() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ ids, owner_user_id }: { ids: string[]; owner_user_id: string }) => {
      const promises = ids.map((id) =>
        supabase.from("leads").update({ owner_user_id }).eq("id", id)
      );
      await Promise.all(promises);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["leads"] });
    },
  });
}

export function useBulkDeleteLeads() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ ids }: { ids: string[] }) => {
      // Delete in batches of 50
      for (let i = 0; i < ids.length; i += 50) {
        const batch = ids.slice(i, i + 50);
        const { error } = await supabase.from("leads").delete().in("id", batch);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["leads"] });
    },
  });
}

export function useArchiveLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason?: string }) => {
      const { error } = await supabase.rpc("archive_record", {
        target_table: "leads",
        target_id: id,
        reason: reason ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["leads"] });
    },
  });
}

/** Mark an import "Avoid" (bounced/unsubscribed/auto_reply/manual): sets
 * the reason and archives it, so dedup keeps it out of future imports. */
export function useMarkImportAvoid() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason?: string }) => {
      const { error } = await supabase.rpc("mark_import_avoid", {
        p_lead_id: id,
        p_reason: reason ?? "manual",
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["leads"] });
    },
  });
}

/** One-click bulk promotion of selected imports into Contacts. Returns a
 * counts summary (promoted / skipped_duplicate / skipped_other / errors). */
export interface BulkPromoteResult {
  promoted: number;
  skipped_duplicate: number;
  skipped_ambiguous: number;
  skipped_other: number;
  errors: number;
  /** First error message captured during the batch (null if none). The RPC
   * returns this so the UI can surface WHY rows errored instead of a bare
   * count. */
  last_error: string | null;
  /** Per-row failure detail, capped at 25 per chunk: which lead, what error.
   * Added 2026-07-17 after 205 rows failed with only an opaque count. */
  error_detail?: Array<{ lead_id: string; error: string; code?: string }>;
  /** Leads skipped because their company matches more than one account. */
  ambiguous_detail?: Array<{ lead_id: string; company: string | null }>;
}
export function useBulkPromoteImports() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      ids,
      tagIds,
    }: {
      ids: string[];
      /** Optional batch-tracking tags applied to every contact created. */
      tagIds?: string[];
    }): Promise<BulkPromoteResult> => {
      const { data, error } = await supabase.rpc("bulk_promote_imports", {
        p_lead_ids: ids,
        p_tag_ids: tagIds?.length ? tagIds : null,
      });
      if (error) throw error;
      return data as BulkPromoteResult;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["leads"] });
      qc.invalidateQueries({ queryKey: ["contacts"] });
      qc.invalidateQueries({ queryKey: ["accounts"] });
    },
  });
}

/** Bulk-archive imports matched from an uploaded verification list (e.g. a
 * MillionVerifier bad/risky export). Matches existing leads by id and/or
 * email, archives them with a reason (excluded from all future imports).
 * Pass dryRun=true to PREVIEW the counts without changing anything. */
export interface BulkArchiveResult {
  matched: number;
  already_archived: number;
  to_archive: number;
  archived: number;
  dry_run: boolean;
}
export function useBulkArchiveFromList() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (v: {
      ids: string[];
      emails: string[];
      reason: string;
      dryRun: boolean;
      includeConverted?: boolean;
    }): Promise<BulkArchiveResult> => {
      const { data, error } = await supabase.rpc("bulk_archive_leads_by_list", {
        p_ids: v.ids,
        p_emails: v.emails,
        p_reason: v.reason,
        p_dry_run: v.dryRun,
        p_include_converted: v.includeConverted ?? false,
      });
      if (error) throw error;
      return data as BulkArchiveResult;
    },
    onSuccess: (data) => {
      // Only refresh the lists after a REAL archive, not a dry-run preview.
      if (!data.dry_run) qc.invalidateQueries({ queryKey: ["leads"] });
    },
  });
}

/** Dry-run preview counts for "Bulk promote from file": how many matched
 * leads will actually become contacts vs. be skipped (already contacts /
 * already converted-or-archived). The promotion itself reuses
 * useBulkPromoteImports. Callers chunk the id list. */
export interface PromotePreview {
  matched: number;
  promotable: number;
  already_done: number;
  already_contact: number;
}
export function useCountPromotable() {
  return useMutation({
    mutationFn: async (ids: string[]): Promise<PromotePreview> => {
      const { data, error } = await supabase.rpc("count_promotable_leads", { p_ids: ids });
      if (error) throw error;
      return data as PromotePreview;
    },
  });
}

interface ConvertLeadInput {
  leadId: string;
  /**
   * Either pick an existing account by id, OR create a new one with
   * accountName. Exactly one of these should be set. We require this
   * shape (rather than letting the caller free-type a name and silently
   * auto-create) because the old behavior was creating a new account
   * on every conversion — even when the same company already existed —
   * leading to duplicate accounts. Forcing the caller to be explicit
   * about new-vs-existing prevents that.
   */
  existingAccountId?: string;
  accountName?: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  title: string | null;
  industry: string | null;
  website: string | null;
  street: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  country: string | null;
  leadSource: string | null;
  createOpportunity: boolean;
  opportunityName?: string;
  opportunityAmount?: number;
  opportunityStage?: string;
}

export function useConvertLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: ConvertLeadInput) => {
      // Account is optional. A lead can be promoted to a standalone contact
      // with no account (the "No account" mode) — the convert_lead RPC handles
      // existing-account / new-account / no-account alike. Only guard against
      // the contradiction of supplying BOTH an existing id and a new name.
      if (input.existingAccountId && input.accountName) {
        throw new Error("Convert lead got both existingAccountId and accountName — pick one.");
      }

      // One atomic, role-safe call. The convert_lead RPC (SECURITY DEFINER)
      // creates the account/contact/optional-opp and marks the lead
      // converted+archived in a single transaction — so non-admins can
      // convert (the archive step is otherwise admin-only) and a failure
      // can't leave half-made records behind. Owner + MQL/SQL carry-over
      // happens inside the function.
      const { data, error } = await supabase.rpc("convert_lead", {
        p_lead_id: input.leadId,
        p_first_name: input.firstName,
        p_last_name: input.lastName,
        p_existing_account_id: input.existingAccountId ?? null,
        p_account_name: input.accountName ?? null,
        p_industry: input.industry ?? null,
        p_website: input.website ?? null,
        p_street: input.street ?? null,
        p_city: input.city ?? null,
        p_state: input.state ?? null,
        p_zip: input.zip ?? null,
        p_country: input.country ?? null,
        p_email: input.email ?? null,
        p_phone: input.phone ?? null,
        p_title: input.title ?? null,
        p_lead_source: input.leadSource ?? null,
        p_create_opportunity: input.createOpportunity ?? false,
        p_opportunity_name: input.opportunityName ?? null,
        p_opportunity_amount: input.opportunityAmount ?? 0,
        p_opportunity_stage: input.opportunityStage ?? "details_analysis",
      });
      if (error) throw error;

      const r = data as {
        account_id: string;
        account_name: string;
        contact_id: string;
        opportunity_id: string | null;
      };
      return {
        account: { id: r.account_id, name: r.account_name },
        contact: { id: r.contact_id },
        opportunity: r.opportunity_id ? { id: r.opportunity_id } : null,
      };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["leads"] });
      qc.invalidateQueries({ queryKey: ["accounts"] });
      qc.invalidateQueries({ queryKey: ["contacts"] });
      qc.invalidateQueries({ queryKey: ["opportunities"] });
    },
  });
}

export function useUsers() {
  return useQuery({
    queryKey: ["users"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_profiles")
        .select("*")
        .eq("is_active", true)
        .order("full_name");
      if (error) throw error;
      return data;
    },
  });
}

/**
 * Resolve lead ids from a list of emails (Bulk Promote From File accepts
 * either column — Jordan's clean lists come back keyed by email). Admin-only
 * RPC, case-insensitive, chunked to keep each call snappy.
 */
export async function resolveLeadIdsByEmail(emails: string[]): Promise<string[]> {
  const out = new Set<string>();
  const CHUNK = 2000;
  for (let i = 0; i < emails.length; i += CHUNK) {
    const { data, error } = await supabase.rpc("resolve_lead_ids_by_email", {
      p_emails: emails.slice(i, i + CHUNK),
    });
    if (error) throw error;
    for (const id of (data ?? []) as string[]) out.add(id);
  }
  return [...out];
}
