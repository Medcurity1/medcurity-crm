import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { LeadList, LeadListMember, Lead } from "@/types/crm";
import { buildIndustryOrClause } from "@/features/leads/industry-keywords";

// Shape of filter_config for dynamic ("smart") lists. Each key maps onto
// columns on `leads` (or supporting views). Stored as jsonb on
// lead_lists.filter_config so we can keep adding facets without a schema
// migration. Keep the keys in lockstep with `applyFilters` below.
export interface LeadListFilterConfig {
  // Categorical (multi-select)
  status?: string[];
  source?: string[];
  qualification?: string[];
  rating?: string[];
  industry_category?: string[];
  owner_user_id?: string[];
  business_relationship_tag?: string[];
  credential?: string[];
  time_zone?: string[];
  type?: string[];

  // Geographic
  state?: string[];
  country?: string[];
  /** Substring match on city, case-insensitive. */
  city?: string;
  /** Prefix match on zip — supports "981" to mean "all 981xx". */
  zip_prefix?: string;

  // Numeric ranges
  employees_min?: number;
  employees_max?: number;
  annual_revenue_min?: number;
  annual_revenue_max?: number;
  score_min?: number;
  score_max?: number;

  // Date ranges (ISO date strings, inclusive)
  created_after?: string;
  created_before?: string;
  mql_after?: string;
  mql_before?: string;
  last_activity_after?: string;
  last_activity_before?: string;

  // Booleans
  do_not_market_to?: boolean;
  do_not_contact?: boolean;
  priority_lead?: boolean;
  cold_lead?: boolean;
  /** true = email IS NOT NULL; false = email IS NULL */
  has_email?: boolean;
  has_phone?: boolean;
  has_linkedin?: boolean;
  /** true = lead is currently in an active sequence (joins v_lead_active_sequence) */
  in_sequence?: boolean;
  /** true = exclude leads that are members of any other lead_list. */
  exclude_in_other_lists?: boolean;

  /** Free-text filter applied to first/last/company/email/title/phone. */
  search?: string;
}

// ---------------------------------------------------------------------------
// Filter application — shared between useSmartListLeads and useLeadsByFilter
// so a smart list and the static-list "Add Leads" picker behave identically.
// Returns the augmented PostgREST query builder.
// ---------------------------------------------------------------------------

/**
 * Apply every filter from `filterConfig` to a leads-table query builder.
 * Returns the same builder for chaining. Order matters only for the
 * `or()` search clause — it must come last so it doesn't clobber prior
 * `eq/in` clauses' implicit AND grouping.
 *
 * Typed loosely (generic `T`) so the same helper can flow through both
 * `select("*")` and `select("*, owner:user_profiles(...)")` builders
 * without TypeScript collapsing the relationship metadata to `never`.
 */
function applyFilters<T>(
  qIn: T,
  fc: LeadListFilterConfig | null | undefined,
): T {
  // Internally we work with a loose builder so every chained method
  // (`in`, `ilike`, `gte`, `or`, ...) typechecks regardless of which
  // overload of `select(...)` produced it. The shape we return matches
  // the input exactly, since each chained method on a PostgREST builder
  // returns the same builder back.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q: any = qIn;
  if (!fc) return q as T;

  // Categorical multi-selects — only apply when non-empty so an empty
  // array doesn't accidentally produce a 0-row result.
  if (fc.status?.length) q = q.in("status", fc.status);
  if (fc.source?.length) q = q.in("source", fc.source);
  if (fc.qualification?.length) q = q.in("qualification", fc.qualification);
  if (fc.rating?.length) q = q.in("rating", fc.rating);
  if (fc.industry_category?.length) {
    // Match BOTH the normalized enum column AND legacy free-text column
    // — SF-imported leads sit with `industry_category=null` and a free-text
    // value in `industry`. See `buildIndustryOrClause` for the keyword map.
    const orClause = buildIndustryOrClause(fc.industry_category);
    if (orClause) q = q.or(orClause);
  }
  if (fc.owner_user_id?.length) q = q.in("owner_user_id", fc.owner_user_id);
  if (fc.business_relationship_tag?.length)
    q = q.in("business_relationship_tag", fc.business_relationship_tag);
  if (fc.credential?.length) q = q.in("credential", fc.credential);
  if (fc.time_zone?.length) q = q.in("time_zone", fc.time_zone);
  if (fc.type?.length) q = q.in("type", fc.type);

  // Geographic
  if (fc.state?.length) q = q.in("state", fc.state);
  if (fc.country?.length) q = q.in("country", fc.country);
  if (fc.city) {
    const safe = fc.city.replace(/[(),]/g, " ");
    q = q.ilike("city", `%${safe}%`);
  }
  if (fc.zip_prefix) {
    const safe = fc.zip_prefix.replace(/[(),%]/g, "");
    q = q.ilike("zip", `${safe}%`);
  }

  // Numeric ranges — gte/lte are inclusive (matches user expectation
  // when typing "Min: 100" and "Max: 500").
  if (typeof fc.employees_min === "number")
    q = q.gte("employees", fc.employees_min);
  if (typeof fc.employees_max === "number")
    q = q.lte("employees", fc.employees_max);
  if (typeof fc.annual_revenue_min === "number")
    q = q.gte("annual_revenue", fc.annual_revenue_min);
  if (typeof fc.annual_revenue_max === "number")
    q = q.lte("annual_revenue", fc.annual_revenue_max);
  if (typeof fc.score_min === "number") q = q.gte("score", fc.score_min);
  if (typeof fc.score_max === "number") q = q.lte("score", fc.score_max);

  // Date ranges (ISO yyyy-mm-dd). Stored timestamps are timestamptz, so
  // a date string like "2026-04-01" will be implicitly cast to midnight UTC.
  if (fc.created_after) q = q.gte("created_at", fc.created_after);
  if (fc.created_before) q = q.lte("created_at", fc.created_before);
  if (fc.mql_after) q = q.gte("mql_date", fc.mql_after);
  if (fc.mql_before) q = q.lte("mql_date", fc.mql_before);
  // last_activity_after / last_activity_before are handled in a post-fetch
  // join below, since PostgREST can't `gte` on a derived view through a
  // single from() call without a foreign-key relationship that doesn't
  // exist (v_lead_last_activity is a view, not a table). The hooks below
  // do that join client-side after fetching.

  // Booleans
  if (typeof fc.do_not_market_to === "boolean")
    q = q.eq("do_not_market_to", fc.do_not_market_to);
  if (typeof fc.do_not_contact === "boolean")
    q = q.eq("do_not_contact", fc.do_not_contact);
  if (typeof fc.priority_lead === "boolean")
    q = q.eq("priority_lead", fc.priority_lead);
  if (typeof fc.cold_lead === "boolean") q = q.eq("cold_lead", fc.cold_lead);

  if (fc.has_email === true) q = q.not("email", "is", null);
  else if (fc.has_email === false) q = q.is("email", null);
  if (fc.has_phone === true) q = q.not("phone", "is", null);
  else if (fc.has_phone === false) q = q.is("phone", null);
  if (fc.has_linkedin === true) q = q.not("linkedin_url", "is", null);
  else if (fc.has_linkedin === false) q = q.is("linkedin_url", null);

  // Free-text search — kept last so it's the outermost OR group.
  if (fc.search) {
    const safe = fc.search.replace(/[(),]/g, " ");
    q = q.or(
      `first_name.ilike.%${safe}%,last_name.ilike.%${safe}%,company.ilike.%${safe}%,email.ilike.%${safe}%,title.ilike.%${safe}%,phone.ilike.%${safe}%`,
    );
  }
  return q as T;
}

/**
 * Returns true if `lead` should be kept after applying the filters that
 * can't be expressed in PostgREST directly: in_sequence, last_activity
 * range, exclude_in_other_lists. Pass pre-fetched lookup maps so the
 * hook only fires one supplemental query each.
 */
function postFilter(
  lead: Lead,
  fc: LeadListFilterConfig | null | undefined,
  lookups: {
    inActiveSequence: Set<string>;
    lastActivityByLead: Map<string, string>;
    leadsInOtherLists: Set<string>;
  },
): boolean {
  if (!fc) return true;
  if (typeof fc.in_sequence === "boolean") {
    const has = lookups.inActiveSequence.has(lead.id);
    if (has !== fc.in_sequence) return false;
  }
  if (fc.last_activity_after) {
    const ts = lookups.lastActivityByLead.get(lead.id);
    if (!ts || ts < fc.last_activity_after) return false;
  }
  if (fc.last_activity_before) {
    const ts = lookups.lastActivityByLead.get(lead.id);
    if (!ts || ts > fc.last_activity_before) return false;
  }
  if (fc.exclude_in_other_lists && lookups.leadsInOtherLists.has(lead.id)) {
    return false;
  }
  return true;
}

/** Fetch the supplemental lookup maps used by `postFilter`. */
async function fetchLookups(
  fc: LeadListFilterConfig | null | undefined,
  excludingListId: string | undefined,
): Promise<{
  inActiveSequence: Set<string>;
  lastActivityByLead: Map<string, string>;
  leadsInOtherLists: Set<string>;
}> {
  const inActiveSequence = new Set<string>();
  const lastActivityByLead = new Map<string, string>();
  const leadsInOtherLists = new Set<string>();
  if (!fc) {
    return { inActiveSequence, lastActivityByLead, leadsInOtherLists };
  }

  // in_sequence — one round trip if the filter is set.
  if (typeof fc.in_sequence === "boolean") {
    const { data } = await supabase
      .from("v_lead_active_sequence")
      .select("lead_id, in_active_sequence")
      .eq("in_active_sequence", true);
    for (const row of data ?? []) {
      if ((row as { lead_id: string | null }).lead_id) {
        inActiveSequence.add((row as { lead_id: string }).lead_id);
      }
    }
  }

  // last_activity range — pull the whole map; small per-tenant.
  if (fc.last_activity_after || fc.last_activity_before) {
    const { data } = await supabase
      .from("v_lead_last_activity")
      .select("lead_id, last_activity_at");
    for (const row of (data ?? []) as Array<{
      lead_id: string | null;
      last_activity_at: string | null;
    }>) {
      if (row.lead_id && row.last_activity_at) {
        lastActivityByLead.set(row.lead_id, row.last_activity_at);
      }
    }
  }

  // exclude_in_other_lists — pull all members across all OTHER lists.
  if (fc.exclude_in_other_lists) {
    let q = supabase
      .from("lead_list_members")
      .select("lead_id, list_id")
      .not("lead_id", "is", null);
    if (excludingListId) q = q.neq("list_id", excludingListId);
    const { data } = await q;
    for (const row of (data ?? []) as Array<{ lead_id: string | null }>) {
      if (row.lead_id) leadsInOtherLists.add(row.lead_id);
    }
  }
  return { inActiveSequence, lastActivityByLead, leadsInOtherLists };
}

// ---------------------------------------------------------------------------
// Lead Lists CRUD
// ---------------------------------------------------------------------------

export function useLeadLists() {
  return useQuery({
    queryKey: ["lead-lists"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("lead_lists")
        .select("*")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as LeadList[];
    },
  });
}

export function useCreateLeadList() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: {
      name: string;
      description?: string;
      owner_user_id: string;
      is_dynamic?: boolean;
      filter_config?: LeadListFilterConfig | null;
    }) => {
      const { data, error } = await supabase
        .from("lead_lists")
        .insert({
          name: values.name,
          description: values.description ?? null,
          owner_user_id: values.owner_user_id,
          is_dynamic: values.is_dynamic ?? false,
          filter_config: values.filter_config ?? null,
        })
        .select()
        .single();
      if (error) throw error;
      return data as LeadList;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lead-lists"] });
    },
  });
}

/** Update a list (rename, redescribe, or change smart-list filters). */
export function useUpdateLeadList() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: {
      id: string;
      name?: string;
      description?: string | null;
      is_dynamic?: boolean;
      filter_config?: LeadListFilterConfig | null;
    }) => {
      const { id, ...patch } = values;
      const { data, error } = await supabase
        .from("lead_lists")
        .update(patch)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data as LeadList;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["lead-lists"] });
      qc.invalidateQueries({ queryKey: ["lead-list-members", vars.id] });
      qc.invalidateQueries({ queryKey: ["smart-list-leads", vars.id] });
    },
  });
}

export function useDeleteLeadList() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("lead_lists")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lead-lists"] });
    },
  });
}

// ---------------------------------------------------------------------------
// Lead List Members
// ---------------------------------------------------------------------------

export function useLeadListMembers(listId: string | undefined) {
  return useQuery({
    queryKey: ["lead-list-members", listId],
    queryFn: async () => {
      if (!listId) throw new Error("Missing list ID");
      const { data, error } = await supabase
        .from("lead_list_members")
        .select(
          "*, lead:leads(id, first_name, last_name, email, phone, company, status, qualification, rating, source, industry_category, owner_user_id, state, city, employees, score, do_not_market_to), contact:contacts(id, first_name, last_name, email, phone, account:accounts(name))",
        )
        .eq("list_id", listId)
        .order("added_at", { ascending: false });
      if (error) throw error;
      return data as unknown as LeadListMember[];
    },
    enabled: !!listId,
  });
}

export function useLeadListMemberCount() {
  return useQuery({
    queryKey: ["lead-list-member-counts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("lead_list_members")
        .select("list_id");
      if (error) throw error;

      const counts: Record<string, number> = {};
      for (const row of data ?? []) {
        counts[row.list_id] = (counts[row.list_id] ?? 0) + 1;
      }
      return counts;
    },
  });
}

export function useAddToList() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: {
      list_id: string;
      lead_id?: string | null;
      contact_id?: string | null;
    }) => {
      const { data, error } = await supabase
        .from("lead_list_members")
        .insert({
          list_id: values.list_id,
          lead_id: values.lead_id ?? null,
          contact_id: values.contact_id ?? null,
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({
        queryKey: ["lead-list-members", vars.list_id],
      });
      qc.invalidateQueries({ queryKey: ["lead-list-member-counts"] });
    },
  });
}

export function useRemoveFromList() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      memberId,
      listId,
    }: {
      memberId: string;
      listId: string;
    }) => {
      const { error } = await supabase
        .from("lead_list_members")
        .delete()
        .eq("id", memberId);
      if (error) throw error;
      return listId;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({
        queryKey: ["lead-list-members", vars.listId],
      });
      qc.invalidateQueries({ queryKey: ["lead-list-member-counts"] });
    },
  });
}

// ---------------------------------------------------------------------------
// Smart (dynamic) lists — live-query leads from the filter_config rather
// than reading the membership join. Re-runs whenever filter_config or
// any underlying lead changes (since query key includes config + we
// invalidate on lead updates).
// ---------------------------------------------------------------------------

export function useSmartListLeads(
  listId: string | undefined,
  filterConfig: LeadListFilterConfig | null | undefined,
) {
  return useQuery({
    queryKey: ["smart-list-leads", listId, filterConfig],
    queryFn: async () => {
      let q = supabase
        .from("leads")
        .select(
          "id, first_name, last_name, email, phone, company, title, status, qualification, rating, source, industry_category, owner_user_id, state, city, country, zip, employees, annual_revenue, score, mql_date, created_at, do_not_market_to, do_not_contact, priority_lead, cold_lead, linkedin_url, business_relationship_tag, credential, time_zone, type, owner:user_profiles!owner_user_id(id, full_name)",
        )
        .is("archived_at", null)
        .order("last_name", { ascending: true, nullsFirst: false })
        .limit(1000);

      q = applyFilters(q, filterConfig);

      const [{ data, error }, lookups] = await Promise.all([
        q,
        fetchLookups(filterConfig, listId),
      ]);
      if (error) throw error;
      const rows = (data ?? []) as unknown as Lead[];
      // Annotate with last_activity_at + in_active_sequence so the table
      // can render those columns without each row triggering its own
      // round-trip.
      return rows
        .filter((l) => postFilter(l, filterConfig, lookups))
        .map((l) => ({
          ...l,
          last_activity_at: lookups.lastActivityByLead.get(l.id) ?? null,
          in_active_sequence: lookups.inActiveSequence.has(l.id),
        })) as Array<Lead & {
        last_activity_at: string | null;
        in_active_sequence: boolean;
      }>;
    },
    enabled: !!listId,
  });
}

// ---------------------------------------------------------------------------
// Search leads for adding to lists
// ---------------------------------------------------------------------------

export function useSearchLeadsForList(search: string) {
  return useQuery({
    queryKey: ["lead-search-for-list", search],
    queryFn: async () => {
      if (!search || search.length < 2) return [];
      const { data, error } = await supabase
        .from("leads")
        .select("id, first_name, last_name, email, company, status")
        .is("archived_at", null)
        .or(
          `first_name.ilike.%${search}%,last_name.ilike.%${search}%,company.ilike.%${search}%,email.ilike.%${search}%`,
        )
        .limit(20);
      if (error) throw error;
      return data;
    },
    enabled: search.length >= 2,
  });
}

// ---------------------------------------------------------------------------
// Filtered leads for bulk-add into a static list. Mirrors the smart-list
// query shape but doesn't require a list id, so the static-list "Add Leads"
// dialog can let users pick by criteria the same way smart lists do.
// ---------------------------------------------------------------------------

export function useLeadsByFilter(
  filterConfig: LeadListFilterConfig,
  enabled: boolean,
  excludingListId?: string,
) {
  return useQuery({
    queryKey: ["leads-by-filter", filterConfig, excludingListId],
    queryFn: async () => {
      let q = supabase
        .from("leads")
        .select(
          "id, first_name, last_name, email, phone, company, title, status, qualification, rating, source, industry_category, owner_user_id, state, city, country, zip, employees, annual_revenue, score, mql_date, created_at, do_not_market_to, do_not_contact, priority_lead, cold_lead, linkedin_url, business_relationship_tag, credential, time_zone, type",
        )
        .is("archived_at", null)
        .order("last_name", { ascending: true, nullsFirst: false })
        .limit(500);

      q = applyFilters(q, filterConfig);

      const [{ data, error }, lookups] = await Promise.all([
        q,
        fetchLookups(filterConfig, excludingListId),
      ]);
      if (error) throw error;
      const rows = (data ?? []) as unknown as Lead[];
      return rows.filter((l) => postFilter(l, filterConfig, lookups));
    },
    enabled,
  });
}

// Bulk add many leads to a static list in one call. Skips duplicates
// silently (unique constraint on (list_id, lead_id)) so the dialog can
// re-add a result set without erroring on already-included leads.
export function useBulkAddToList() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      list_id,
      lead_ids,
    }: {
      list_id: string;
      lead_ids: string[];
    }) => {
      if (!lead_ids.length) return { added: 0 };
      const rows = lead_ids.map((lead_id) => ({ list_id, lead_id }));
      // upsert on (list_id, lead_id) so duplicates no-op cleanly. The
      // membership table has a unique index on this pair.
      const { error, count } = await supabase
        .from("lead_list_members")
        .upsert(rows, {
          onConflict: "list_id,lead_id",
          ignoreDuplicates: true,
          count: "exact",
        });
      if (error) throw error;
      return { added: count ?? 0 };
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({
        queryKey: ["lead-list-members", vars.list_id],
      });
      qc.invalidateQueries({ queryKey: ["lead-list-member-counts"] });
    },
  });
}
