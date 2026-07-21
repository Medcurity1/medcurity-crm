import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Opportunity, ActivePipelineRow, OpportunityStageHistory, OpportunityProduct } from "@/types/crm";

interface OppFilters {
  search?: string;
  stage?: string | string[];
  team?: string | string[];
  kind?: string | string[];
  business_type?: string | string[];
  /** Multi-select on lead_source. The sentinel "__none__" matches rows with
   *  NO source set, so unattributed deals can be found and corrected. */
  lead_source?: string[];
  account_id?: string;
  ownerId?: string | "mine" | string[];
  verified?: "true" | "false";
  /** ISO date (YYYY-MM-DD). Filters close_date >= this value.
   *  Used by KPI deep-links (e.g. "Team Closed Won This Month") to
   *  scope the list to the same window the card is counting. */
  closeAfter?: string;
  /** ISO date. Filters close_date <= this value. */
  closeBefore?: string;
  /** ISO date. Filters expected_close_date >= this value. Used by
   *  the "Upcoming Close Dates" KPI to land on a 30-day forecast
   *  window matching the card's count. */
  expectedAfter?: string;
  /** ISO date. Filters expected_close_date <= this value. */
  expectedBefore?: string;
  /** ISO date. Filters contract_start_date >= this value. Used by the
   *  "Revenue Starting This Quarter" KPI to land on the same deals. */
  startAfter?: string;
  /** ISO date. Filters contract_start_date <= this value. */
  startBefore?: string;
  page?: number;
  pageSize?: number;
  sortColumn?: string | null;
  sortDirection?: "asc" | "desc";
}

export function useOpportunities(filters?: OppFilters) {
  return useQuery({
    queryKey: ["opportunities", filters],
    queryFn: async () => {
      const page = filters?.page ?? 0;
      const pageSize = filters?.pageSize ?? 25;
      const sortCol = filters?.sortColumn ?? "created_at";
      const sortAsc = (filters?.sortDirection ?? (filters?.sortColumn ? "asc" : "desc")) === "asc";
      // "Last Touch" (last_activity_at) lives in a joined view, so to sort by it
      // across the WHOLE list (not just the page) we query the passthrough view
      // v_opportunities_with_activity. Every OTHER sort keeps using the plain
      // opportunities table so the common path is untouched. (Summer's request.)
      const sortByLastTouch = sortCol === "last_touch";
      let query = supabase
        .from(sortByLastTouch ? "v_opportunities_with_activity" : "opportunities")
        .select(
          sortByLastTouch
            // PostgREST embeds don't resolve through a VIEW (the FK metadata
            // lives on the table), so on the last-touch path we select plain
            // columns and merge the account/owner names by id below — the proven
            // batch-fetch pattern the reports module uses for the same reason.
            ? "*"
            : "*, account:accounts!account_id(id, name), owner:user_profiles!owner_user_id(id, full_name)",
          { count: "estimated" },
        )
        .range(page * pageSize, (page + 1) * pageSize - 1);

      // Sort: support sorting by columns on embedded relations
      // (e.g. "account.name", "owner.full_name") via PostgREST's
      // EMBED-PATH order form ("account(name)"). The earlier
      // order(col, { referencedTable }) variant only reorders rows INSIDE
      // the embed — a silent no-op for these to-one joins — so the header
      // click never actually sorted the list (2026-07-07 review finding).
      if (sortByLastTouch) {
        // Sort by the SAME value the badge displays: last real touch, or the
        // deal's created_at when nothing was ever logged. Sorting by the raw
        // last_activity_at dumped never-touched deals (null) at the end in
        // arbitrary order while their badges showed an age — Summer's
        // "it mixes them together" bug. effective_last_touch is never null.
        query = query.order("effective_last_touch", { ascending: sortAsc });
      } else if (sortCol.startsWith("account.")) {
        const innerCol = sortCol.slice("account.".length);
        query = query.order(`account(${innerCol})`, {
          ascending: sortAsc,
          nullsFirst: false,
        });
      } else if (sortCol.startsWith("owner.")) {
        const innerCol = sortCol.slice("owner.".length);
        query = query.order(`owner(${innerCol})`, {
          ascending: sortAsc,
          nullsFirst: false,
        });
      } else {
        query = query.order(sortCol, { ascending: sortAsc, nullsFirst: false });
      }
      // Stable tiebreaker so offset paging can't duplicate/skip rows that
      // tie on sortCol at page boundaries.
      query = query.order("id", { ascending: true });

      if (filters?.search) {
        // Search across opp name AND account name. PostgREST can't filter
        // a parent by columns on an embedded resource, so we resolve
        // matching account ids first and OR them in.
        const term = filters.search;
        const { data: matchedAccounts } = await supabase
          .from("accounts")
          .select("id")
          .ilike("name", `%${term}%`)
          .limit(200);
        const acctIds = (matchedAccounts ?? []).map((a) => a.id as string);
        const safe = term.replace(/[(),]/g, " ");
        const orParts = [`name.ilike.%${safe}%`];
        if (acctIds.length > 0) {
          orParts.push(`account_id.in.(${acctIds.join(",")})`);
        }
        query = query.or(orParts.join(","));
      }
      if (filters?.stage) {
        if (Array.isArray(filters.stage)) {
          if (filters.stage.length > 0) query = query.in("stage", filters.stage);
        } else if (filters.stage === "open") {
          // Meta-value 'open' = any stage that isn't closed_won / closed_lost.
          // Lets dashboard cards link to /opportunities?stage=open without
          // needing to know the full open-stage enum list.
          query = query.not("stage", "in", "(closed_won,closed_lost)");
        } else {
          query = query.eq("stage", filters.stage);
        }
      }
      if (filters?.team) {
        if (Array.isArray(filters.team)) {
          if (filters.team.length > 0) query = query.in("team", filters.team);
        } else {
          query = query.eq("team", filters.team);
        }
      }
      if (filters?.kind) {
        if (Array.isArray(filters.kind)) {
          if (filters.kind.length > 0) query = query.in("kind", filters.kind);
        } else {
          query = query.eq("kind", filters.kind);
        }
      }
      if (filters?.business_type) {
        if (Array.isArray(filters.business_type)) {
          if (filters.business_type.length > 0)
            query = query.in("business_type", filters.business_type);
        } else {
          query = query.eq("business_type", filters.business_type);
        }
      }
      if (filters?.lead_source && filters.lead_source.length > 0) {
        // "__none__" = rows with no source. Values are snake_case enum tokens
        // (no commas/spaces), safe to inline in the or() expression.
        const vals = filters.lead_source.filter((v) => v !== "__none__");
        const wantNone = filters.lead_source.includes("__none__");
        if (wantNone && vals.length > 0) {
          query = query.or(`lead_source.in.(${vals.join(",")}),lead_source.is.null`);
        } else if (wantNone) {
          query = query.is("lead_source", null);
        } else {
          query = query.in("lead_source", vals);
        }
      }
      if (filters?.account_id) query = query.eq("account_id", filters.account_id);
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
      if (filters?.verified === "true") query = query.eq("verified", true);
      else if (filters?.verified === "false") query = query.eq("verified", false);
      if (filters?.closeAfter) query = query.gte("close_date", filters.closeAfter);
      if (filters?.closeBefore) query = query.lte("close_date", filters.closeBefore);
      if (filters?.expectedAfter) query = query.gte("expected_close_date", filters.expectedAfter);
      if (filters?.expectedBefore) query = query.lte("expected_close_date", filters.expectedBefore);
      if (filters?.startAfter) query = query.gte("contract_start_date", filters.startAfter);
      if (filters?.startBefore) query = query.lte("contract_start_date", filters.startBefore);

      const { data, error, count } = await query;
      if (error) throw error;

      // `unknown` first: the conditional select string makes supabase-js infer a
      // union type its parser can't resolve, so the direct cast is rejected.
      const rows = (data ?? []) as unknown as Opportunity[];
      // Last-touch for just the visible page — scoped to these ids so we never
      // aggregate the whole activities table on every render (same pattern as
      // the Partners "Last Contact" column). Powers the stale/rotting-deals
      // column. A failure here must NOT break the list, so it's best-effort.
      // Skipped on the last-touch sort path: the view already provides it.
      const ids = rows.map((o) => o.id);
      if (ids.length > 0 && !sortByLastTouch) {
        const { data: la } = await supabase
          .from("v_opportunity_last_activity")
          .select("opportunity_id, last_activity_at")
          .in("opportunity_id", ids);
        const lastByOpp = new Map<string, string>();
        for (const r of la ?? []) {
          if (r.last_activity_at) {
            lastByOpp.set(r.opportunity_id as string, r.last_activity_at as string);
          }
        }
        for (const o of rows) o.last_activity_at = lastByOpp.get(o.id) ?? null;
      }

      // On the last-touch (view) path we couldn't embed account/owner, so merge
      // their names in by id — otherwise the Account and Owner columns would
      // silently render blank when sorting by Last Touch.
      if (sortByLastTouch && rows.length > 0) {
        const acctIds = [...new Set(rows.map((o) => o.account_id).filter((v): v is string => !!v))];
        const ownerIds = [...new Set(rows.map((o) => o.owner_user_id).filter((v): v is string => !!v))];
        const [acctRes, ownerRes] = await Promise.all([
          acctIds.length
            ? supabase.from("accounts").select("id, name").in("id", acctIds)
            : Promise.resolve({ data: [] as { id: string; name: string }[] }),
          ownerIds.length
            ? supabase.from("user_profiles").select("id, full_name").in("id", ownerIds)
            : Promise.resolve({ data: [] as { id: string; full_name: string }[] }),
        ]);
        const acctMap = new Map((acctRes.data ?? []).map((a) => [a.id, a]));
        const ownerMap = new Map((ownerRes.data ?? []).map((u) => [u.id, u]));
        for (const o of rows) {
          o.account = (o.account_id ? acctMap.get(o.account_id) : undefined) as Opportunity["account"];
          o.owner = (o.owner_user_id ? ownerMap.get(o.owner_user_id) : undefined) as Opportunity["owner"];
        }
      }

      return { data: rows, count: count ?? 0 };
    },
    // Keep the previous page's rows on screen while a new page/sort/filter
    // fetches, instead of flashing the whole table to skeletons on every
    // interaction. The list render gate keys on isLoading (not isFetching),
    // so this alone removes the flash with no gate change.
    placeholderData: keepPreviousData,
  });
}

/**
 * Sum of `amount` and exact row count across the SAME filtered set
 * `useOpportunities` returns, but ignoring pagination and sort. Used
 * by the list page to show a verifiable total under the table — so a
 * dashboard KPI like "My Open Pipeline" can be cross-checked against
 * the same filtered list view.
 *
 * Pages past PostgREST's 1000-row cap so the sum is honest on large
 * filtered sets (e.g. all closed_won across 5 years > 1000 rows).
 */
export function useOpportunitiesTotals(filters?: Omit<OppFilters, "page" | "pageSize" | "sortColumn" | "sortDirection">) {
  return useQuery({
    queryKey: ["opportunities", "totals", filters],
    queryFn: async () => {
      // Resolve search-by-account-name the same way useOpportunities
      // does, so the total matches the visible filtered set exactly.
      let acctIds: string[] | null = null;
      if (filters?.search) {
        const { data: matchedAccounts } = await supabase
          .from("accounts")
          .select("id")
          .ilike("name", `%${filters.search}%`)
          .limit(200);
        acctIds = (matchedAccounts ?? []).map((a) => a.id as string);
      }

      // "mine" → real user id (mirrors useOpportunities).
      let resolvedOwnerIds: string[] | null = null;
      let singleOwnerId: string | null = null;
      if (Array.isArray(filters?.ownerId)) {
        const ids = filters!.ownerId;
        if (ids.includes("mine")) {
          const { data: userData } = await supabase.auth.getUser();
          if (userData.user?.id) {
            resolvedOwnerIds = Array.from(
              new Set(ids.map((v) => (v === "mine" ? userData.user!.id : v))),
            );
          } else {
            const noMine = ids.filter((v) => v !== "mine");
            if (noMine.length > 0) resolvedOwnerIds = noMine;
          }
        } else if (ids.length > 0) {
          resolvedOwnerIds = ids;
        }
      } else if (filters?.ownerId === "mine") {
        const { data: userData } = await supabase.auth.getUser();
        singleOwnerId = userData.user?.id ?? null;
      } else if (filters?.ownerId) {
        singleOwnerId = filters.ownerId;
      }

      // Page past the 1000-row cap so the sum is exact on large sets.
      const all: number[] = [];
      let from = 0;
      const pageSize = 1000;
      while (all.length < 100_000) {
        let q = supabase.from("opportunities").select("amount");
        if (filters?.search) {
          const safe = filters.search.replace(/[(),]/g, " ");
          const orParts = [`name.ilike.%${safe}%`];
          if (acctIds && acctIds.length > 0) {
            orParts.push(`account_id.in.(${acctIds.join(",")})`);
          }
          q = q.or(orParts.join(","));
        }
        if (filters?.stage) {
          if (Array.isArray(filters.stage)) {
            if (filters.stage.length > 0) q = q.in("stage", filters.stage);
          } else if (filters.stage === "open") {
            q = q.not("stage", "in", "(closed_won,closed_lost)");
          } else {
            q = q.eq("stage", filters.stage);
          }
        }
        if (filters?.team) {
          if (Array.isArray(filters.team)) {
            if (filters.team.length > 0) q = q.in("team", filters.team);
          } else {
            q = q.eq("team", filters.team);
          }
        }
        if (filters?.kind) {
          if (Array.isArray(filters.kind)) {
            if (filters.kind.length > 0) q = q.in("kind", filters.kind);
          } else {
            q = q.eq("kind", filters.kind);
          }
        }
        if (filters?.business_type) {
          if (Array.isArray(filters.business_type)) {
            if (filters.business_type.length > 0)
              q = q.in("business_type", filters.business_type);
          } else {
            q = q.eq("business_type", filters.business_type);
          }
        }
        if (filters?.lead_source && filters.lead_source.length > 0) {
          // Mirrors useOpportunities so the totals strip matches the list.
          const vals = filters.lead_source.filter((v) => v !== "__none__");
          const wantNone = filters.lead_source.includes("__none__");
          if (wantNone && vals.length > 0) {
            q = q.or(`lead_source.in.(${vals.join(",")}),lead_source.is.null`);
          } else if (wantNone) {
            q = q.is("lead_source", null);
          } else {
            q = q.in("lead_source", vals);
          }
        }
        if (filters?.account_id) q = q.eq("account_id", filters.account_id);
        if (resolvedOwnerIds) q = q.in("owner_user_id", resolvedOwnerIds);
        else if (singleOwnerId) q = q.eq("owner_user_id", singleOwnerId);
        if (filters?.verified === "true") q = q.eq("verified", true);
        else if (filters?.verified === "false") q = q.eq("verified", false);
        if (filters?.closeAfter) q = q.gte("close_date", filters.closeAfter);
        if (filters?.closeBefore) q = q.lte("close_date", filters.closeBefore);
        if (filters?.startAfter) q = q.gte("contract_start_date", filters.startAfter);
        if (filters?.startBefore) q = q.lte("contract_start_date", filters.startBefore);
        if (filters?.expectedAfter) q = q.gte("expected_close_date", filters.expectedAfter);
        if (filters?.expectedBefore) q = q.lte("expected_close_date", filters.expectedBefore);

        const { data, error } = await q.range(from, from + pageSize - 1);
        if (error) throw error;
        const rows = (data ?? []) as { amount: number | string | null }[];
        for (const r of rows) all.push(Number(r.amount ?? 0));
        if (rows.length < pageSize) break;
        from += pageSize;
      }
      const sum = all.reduce((s, n) => s + n, 0);
      return { count: all.length, sum };
    },
  });
}

export function useOpportunity(id: string | undefined) {
  return useQuery({
    queryKey: ["opportunities", id],
    queryFn: async () => {
      if (!id) throw new Error("Missing opportunity ID");
      const { data, error } = await supabase
        .from("opportunities")
        .select("*, account:accounts!account_id(id, name, fte_range, fte_count, employees, lead_source, partner_account), owner:user_profiles!owner_user_id(id, full_name), primary_contact:contacts!primary_contact_id(id, first_name, last_name), assigned_assessor:user_profiles!assigned_assessor_id(id, full_name), original_sales_rep:user_profiles!original_sales_rep_id(id, full_name), creator:user_profiles!created_by(id, full_name), updater:user_profiles!updated_by(id, full_name)")
        .eq("id", id)
        .single();
      if (error) throw error;
      return data as Opportunity;
    },
    enabled: !!id,
  });
}

export function useCreateOpportunity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: Partial<Opportunity>) => {
      const { data, error } = await supabase
        .from("opportunities")
        .insert(values)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["opportunities"] });
      qc.invalidateQueries({ queryKey: ["pipeline"] });
      qc.invalidateQueries({ queryKey: ["renewal_queue"] });
    },
  });
}

export function useUpdateOpportunity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...values }: Partial<Opportunity> & { id: string }) => {
      const { data, error } = await supabase
        .from("opportunities")
        .update(values)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onMutate: async (vars) => {
      // Optimistic Kanban move: on a stage change, patch the moved row in
      // every cached pipeline query so the card jumps columns instantly
      // instead of waiting for the round-trip + refetch. Covers both
      // useActivePipeline (["pipeline", filters]) and useCustomPipeline
      // (["pipeline", "custom", filters]) via the shared key prefix.
      // Non-stage updates keep the plain invalidate-on-settle flow.
      if (!vars.stage) return;
      const pipelineFilter = {
        predicate: (q: { queryKey: readonly unknown[] }) => q.queryKey[0] === "pipeline",
      };
      await qc.cancelQueries(pipelineFilter);
      const snapshots = qc.getQueriesData<ActivePipelineRow[]>(pipelineFilter);
      qc.setQueriesData<ActivePipelineRow[]>(pipelineFilter, (rows) => {
        if (!rows) return rows;
        // A move into a closed stage leaves the open-deals-only board
        // entirely — drop the row rather than strand the card in the
        // "Other open" catch-all column until the refetch lands.
        if (vars.stage === "closed_won" || vars.stage === "closed_lost") {
          return rows.filter((r) => r.id !== vars.id);
        }
        return rows.map((r) => (r.id === vars.id ? { ...r, stage: vars.stage! } : r));
      });
      return { snapshots };
    },
    onError: (_err, _vars, ctx) => {
      // Failed move — put the board back exactly as it was.
      for (const [key, data] of ctx?.snapshots ?? []) {
        qc.setQueryData(key, data);
      }
    },
    onSettled: (_data, _err, vars) => {
      qc.invalidateQueries({ queryKey: ["opportunities"] });
      qc.invalidateQueries({ queryKey: ["opportunities", vars.id] });
      qc.invalidateQueries({ queryKey: ["pipeline"] });
      qc.invalidateQueries({ queryKey: ["renewal_queue"] });
      // Stage moves append a row via DB trigger — refetch the history
      // panel so it doesn't show a stale trail (matches useStageHistory).
      qc.invalidateQueries({ queryKey: ["stage_history", vars.id] });
    },
  });
}

export function useBulkUpdateOwner() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ ids, owner_user_id }: { ids: string[]; owner_user_id: string }) => {
      // Bulk UPDATE per chunk + verify affected count. A per-row RLS denial
      // or missing id doesn't throw (PostgREST just won't match it), so the
      // old Promise.all(per-row) reported success even when nothing changed.
      // De-dup first so a duplicate id doesn't make the verify false-fail.
      const uniqueIds = Array.from(new Set(ids));
      const CHUNK = 100;
      let updated = 0;
      for (let i = 0; i < uniqueIds.length; i += CHUNK) {
        const batch = uniqueIds.slice(i, i + CHUNK);
        const { data, error } = await supabase
          .from("opportunities")
          .update({ owner_user_id })
          .in("id", batch)
          .select("id");
        if (error) throw error;
        updated += (data ?? []).length;
      }
      if (updated < uniqueIds.length) {
        throw new Error(
          `Reassigned ${updated} of ${uniqueIds.length}. ${uniqueIds.length - updated} could not be updated (permission denied or no longer exist).`
        );
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["opportunities"] });
      qc.invalidateQueries({ queryKey: ["pipeline"] });
      qc.invalidateQueries({ queryKey: ["renewal_queue"] });
    },
  });
}

export function useDeleteOpportunity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: { id: string }) => {
      const { error } = await supabase.from("opportunities").delete().eq("id", id);
      if (error) throw error;
      return id;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["opportunities"] });
      qc.invalidateQueries({ queryKey: ["pipeline"] });
      qc.invalidateQueries({ queryKey: ["renewal_queue"] });
    },
  });
}

export function useBulkDeleteOpportunities() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ ids }: { ids: string[] }) => {
      for (let i = 0; i < ids.length; i += 50) {
        const batch = ids.slice(i, i + 50);
        const { error } = await supabase.from("opportunities").delete().in("id", batch);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["opportunities"] });
      qc.invalidateQueries({ queryKey: ["pipeline"] });
      qc.invalidateQueries({ queryKey: ["renewal_queue"] });
    },
  });
}

export function useArchiveOpportunity() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason?: string }) => {
      const { error } = await supabase.rpc("archive_record", {
        target_table: "opportunities",
        target_id: id,
        reason: reason ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["opportunities"] });
      qc.invalidateQueries({ queryKey: ["pipeline"] });
      qc.invalidateQueries({ queryKey: ["renewal_queue"] });
    },
  });
}

export function useActivePipeline(filters?: {
  team?: string;
  kind?: string;
  owner_user_id?: string;
}) {
  return useQuery({
    queryKey: ["pipeline", filters],
    queryFn: async () => {
      let query = supabase.from("active_pipeline").select("*");
      // Bucket by `kind` when provided (renewal vs new_business). This
      // is the source of truth — `team` is a soft routing field that
      // can drift (SF-imported renewals all came in with team='sales',
      // and the kind→team backfill migration may not be applied yet on
      // every deployment). Filtering by kind keeps the buckets right
      // regardless.
      if (filters?.kind) query = query.eq("kind", filters.kind);
      else if (filters?.team) query = query.eq("team", filters.team);
      if (filters?.owner_user_id) query = query.eq("owner_user_id", filters.owner_user_id);
      const { data, error } = await query.order("amount", { ascending: false });
      if (error) throw error;
      const rows = (data ?? []) as ActivePipelineRow[];

      // Enrich with owner_name. active_pipeline is a view we can't join
      // against user_profiles through PostgREST, so hydrate client-side.
      const ownerIds = Array.from(
        new Set(rows.map((r) => r.owner_user_id).filter((v): v is string => !!v))
      );
      if (ownerIds.length > 0) {
        const { data: users } = await supabase
          .from("user_profiles")
          .select("id, full_name")
          .in("id", ownerIds);
        const nameById = new Map(
          (users ?? []).map((u) => [u.id as string, (u.full_name as string) ?? null])
        );
        for (const r of rows) {
          r.owner_name = r.owner_user_id ? nameById.get(r.owner_user_id) ?? null : null;
        }
      }
      return rows;
    },
  });
}

export function useStageHistory(opportunityId: string | undefined) {
  return useQuery({
    queryKey: ["stage_history", opportunityId],
    queryFn: async () => {
      if (!opportunityId) throw new Error("Missing opportunity ID");
      const { data, error } = await supabase
        .from("opportunity_stage_history")
        .select("*, changer:user_profiles!changed_by(full_name)")
        .eq("opportunity_id", opportunityId)
        .order("changed_at", { ascending: false });
      if (error) throw error;
      return data as OpportunityStageHistory[];
    },
    enabled: !!opportunityId,
  });
}

export function useOpportunityProducts(opportunityId: string | undefined) {
  return useQuery({
    queryKey: ["opportunity_products", opportunityId],
    queryFn: async () => {
      if (!opportunityId) throw new Error("Missing opportunity ID");
      const { data, error } = await supabase
        .from("opportunity_products")
        .select("*, product:products!product_id(*)")
        .eq("opportunity_id", opportunityId);
      if (error) throw error;
      return data as OpportunityProduct[];
    },
    enabled: !!opportunityId,
  });
}

export function useProducts() {
  return useQuery({
    queryKey: ["products"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("products")
        .select("*")
        .eq("is_active", true)
        .is("archived_at", null) // hide archived products from opp pickers
        .order("name");
      if (error) throw error;
      return data;
    },
  });
}

export function useAddOpportunityProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: { opportunity_id: string; product_id: string; quantity: number; unit_price: number; arr_amount: number; discount_percent?: number }) => {
      const { data, error } = await supabase
        .from("opportunity_products")
        .insert(values)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["opportunity_products", vars.opportunity_id] });
      qc.invalidateQueries({ queryKey: ["opportunities"] });
      qc.invalidateQueries({ queryKey: ["pipeline"] });
    },
  });
}

/** Bulk add many products to an opportunity in one round-trip. */
export function useAddOpportunityProductsBulk() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      opportunity_id: string;
      rows: Array<{
        product_id: string;
        quantity: number;
        unit_price: number;
        arr_amount: number;
        discount_percent?: number;
        discount_type?: "percent" | "amount";
      }>;
    }) => {
      if (params.rows.length === 0) return [];
      const fullPayload = params.rows.map((r) => ({
        opportunity_id: params.opportunity_id,
        product_id: r.product_id,
        quantity: r.quantity,
        unit_price: r.unit_price,
        arr_amount: r.arr_amount,
        discount_percent: r.discount_percent ?? 0,
        discount_type: (r as { discount_type?: string }).discount_type ?? "percent",
      }));

      let data: unknown;
      const { data: d1, error: e1 } = await supabase
        .from("opportunity_products")
        .upsert(fullPayload, { onConflict: "opportunity_id,product_id" })
        .select();

      if (!e1) {
        data = d1;
      } else {
        // Retry without discount_type (migration 20260428000010 may not be applied)
        const fallbackPayload = fullPayload.map(({ discount_type: _dt, ...rest }) => rest);
        const { data: d2, error: e2 } = await supabase
          .from("opportunity_products")
          .upsert(fallbackPayload, { onConflict: "opportunity_id,product_id" })
          .select();
        if (e2) throw e2;
        data = d2;
      }

      // Belt-and-suspenders: recompute opp totals client-side too. The
      // DB trigger should handle this, but RLS / security-definer
      // gotchas can swallow the trigger silently. Doing it from the
      // client ensures the user sees correct totals immediately.
      await recomputeOpportunityTotals(params.opportunity_id);
      // Same idea for the auto-name: hit it client-side so the rename
      // happens whether or not migration 20260428000008 is applied.
      await resyncOpportunityName(params.opportunity_id);

      return data;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["opportunity_products", vars.opportunity_id] });
      // Broad "opportunities" covers the detail (["opportunities", id]), the
      // list and totals (["opportunities", filters]); pipeline covers
      // forecast/ARR. The old singular ["opportunity", id] matched no query,
      // so line-item edits left the list/pipeline showing the pre-edit amount.
      qc.invalidateQueries({ queryKey: ["opportunities"] });
      qc.invalidateQueries({ queryKey: ["pipeline"] });
    },
  });
}

/**
 * Self-healing hook: when the opportunity detail page mounts and the
 * displayed amount looks stale relative to the line items, fire the
 * recompute RPC silently. Brayden flagged that some opps still showed
 * $0 amount despite having products attached — this is the safety net
 * that catches drift without requiring an explicit user action.
 */
export function useEnsureOpportunityAmountFresh(opportunityId: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      if (!opportunityId) return;
      await recomputeOpportunityTotals(opportunityId);
      await resyncOpportunityName(opportunityId);
    },
    onSuccess: () => {
      if (!opportunityId) return;
      qc.invalidateQueries({ queryKey: ["opportunities"] });
      qc.invalidateQueries({ queryKey: ["pipeline"] });
    },
  });
}

/**
 * Recompute opp.subtotal + opp.amount from the line items.
 * Calls the security-definer RPC `recalc_opportunity_amount` so it
 * works regardless of the rep's row-level update permissions on the
 * opportunities table. Falls back to client-side math if the RPC isn't
 * available (e.g. migration not yet applied on this env).
 *
 *   subtotal = sum(qty * unit_price * (1 - line_discount_percent/100))
 *   amount   = subtotal * (1 - opp.discount/100)  (opp.discount is %)
 */
async function recomputeOpportunityTotals(opportunityId: string): Promise<void> {
  // Preferred path: server-side RPC. Has `security definer` + RLS-aware,
  // and it's the same code path the trigger uses, so the result matches
  // exactly what every other surface sees.
  const { error: rpcErr } = await supabase.rpc("recalc_opportunity_amount", {
    p_opp_id: opportunityId,
  });
  if (!rpcErr) return;

  // Fallback: do the math client-side.
  if (import.meta.env.DEV) {
    console.warn("recalc_opportunity_amount RPC failed, falling back to client recompute:", rpcErr);
  }
  const [linesRes, oppRes] = await Promise.all([
    supabase
      .from("opportunity_products")
      .select("quantity, unit_price, discount_percent, discount_type")
      .eq("opportunity_id", opportunityId),
    supabase
      .from("opportunities")
      .select("discount, discount_type")
      .eq("id", opportunityId)
      .single(),
  ]);
  if (linesRes.error || oppRes.error) return;
  const lines = (linesRes.data ?? []) as {
    quantity: number;
    unit_price: number | string;
    discount_percent: number | string | null;
    discount_type?: string | null;
  }[];
  if (lines.length === 0) return;

  // Gross subtotal (pre-discount) — matches new DB function behaviour
  const subtotal = lines.reduce((s, l) => {
    return s + Number(l.quantity) * Number(l.unit_price);
  }, 0);

  // Net after line-level discounts
  const lineNet = lines.reduce((s, l) => {
    const qty = Number(l.quantity);
    const up = Number(l.unit_price);
    const disc = Number(l.discount_percent ?? 0);
    const dtype = (l.discount_type ?? "percent") as string;
    return s + (dtype === "amount"
      ? Math.max(0, qty * up - disc)
      : qty * up * (1 - disc / 100));
  }, 0);

  const oppDiscountType = ((oppRes.data as { discount_type?: string | null })?.discount_type ?? "percent") as string;
  const oppDiscount = Number(oppRes.data?.discount ?? 0);
  const amount = oppDiscountType === "amount"
    ? Math.max(0, lineNet - oppDiscount)
    : lineNet * (1 - Math.max(0, Math.min(100, oppDiscount)) / 100);

  await supabase
    .from("opportunities")
    .update({
      subtotal: Math.round(subtotal * 100) / 100,
      amount: Math.round(amount * 100) / 100,
    })
    .eq("id", opportunityId);
}

/**
 * Resync the opportunity's `name` from current product short_names.
 * Mirrors the server-side trigger (migration 20260428000008) so
 * environments where the migration hasn't been applied yet still get
 * the auto-rename behavior, and so the UI feels instant on add/remove.
 *
 * Honors the `name_auto_sync` flag — if the user customized the name,
 * the form sets `name_auto_sync=false` and this function bails.
 */
async function resyncOpportunityName(opportunityId: string): Promise<void> {
  const { data: opp } = await supabase
    .from("opportunities")
    .select("name, name_auto_sync")
    .eq("id", opportunityId)
    .single();
  if (!opp) return;
  // If the column doesn't exist yet (migration unapplied), opp.name_auto_sync
  // is undefined — assume true so legacy DBs still benefit from the
  // client-side resync.
  const autoSync = (opp as { name_auto_sync?: boolean }).name_auto_sync ?? true;
  if (!autoSync) return;

  const { data: lines } = await supabase
    .from("opportunity_products")
    .select("created_at, id, product:products!product_id(short_name, code, name)")
    .eq("opportunity_id", opportunityId)
    .order("created_at", { ascending: true });
  if (!lines || lines.length === 0) return;

  const newName = lines
    .map((l) => {
      const p = (l as unknown as { product: { short_name?: string | null; code?: string | null; name?: string | null } | null }).product;
      const sn = p?.short_name?.trim();
      if (sn) return sn;
      const code = p?.code?.trim();
      if (code) return code;
      return p?.name?.trim() || null;
    })
    .filter((s): s is string => !!s)
    .join(" | ");
  if (!newName || newName === opp.name) return;
  await supabase
    .from("opportunities")
    .update({ name: newName })
    .eq("id", opportunityId);
}

/** Update qty / price / discount on a single line. */
export function useUpdateOpportunityProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      id: string;
      opportunity_id: string;
      patch: {
        quantity?: number;
        unit_price?: number;
        arr_amount?: number;
        discount_percent?: number;
        discount_type?: "percent" | "amount";
      };
    }) => {
      const { quantity, unit_price, discount_percent, discount_type } = params.patch;

      // Compute arr_amount so the stored value stays fresh on every edit.
      const qty = Number(quantity ?? 0);
      const price = Number(unit_price ?? 0);
      const disc = Number(discount_percent ?? 0);
      const dtype = discount_type ?? "percent";
      const arr_amount =
        dtype === "amount"
          ? Math.max(0, qty * price - disc)
          : qty * price * (1 - disc / 100);

      const fullPatch = { ...params.patch, arr_amount };

      const { data, error } = await supabase
        .from("opportunity_products")
        .update(fullPatch)
        .eq("id", params.id)
        .select()
        .single();

      if (!error) {
        // Recompute totals on every line update (qty/price/discount changed).
        await recomputeOpportunityTotals(params.opportunity_id);
        return data;
      }

      // Graceful fallback: migration 20260428000010 (discount_type column) may
      // not be applied yet in this environment. Retry without discount_type so
      // the save doesn't fail silently and revert the discount.
      const { discount_type: _dt, ...patchWithout } = fullPatch;
      const { data: data2, error: error2 } = await supabase
        .from("opportunity_products")
        .update(patchWithout)
        .eq("id", params.id)
        .select()
        .single();
      if (error2) throw error2;
      await recomputeOpportunityTotals(params.opportunity_id);
      return data2;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["opportunity_products", vars.opportunity_id] });
      qc.invalidateQueries({ queryKey: ["opportunities"] });
      qc.invalidateQueries({ queryKey: ["pipeline"] });
    },
  });
}

export function useRemoveOpportunityProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, opportunityId }: { id: string; opportunityId: string }) => {
      // `.select()` makes PostgREST return the deleted rows so we can
      // detect "0 rows affected" — happens silently when RLS blocks
      // a delete. Without this, a blocked delete looks like success
      // and the toast lies (see migration 20260514000004).
      const { data, error } = await supabase
        .from("opportunity_products")
        .delete()
        .eq("id", id)
        .select("id");
      if (error) throw error;
      if (!data || data.length === 0) {
        throw new Error(
          "Couldn't remove this product — your account may not have permission. Ask an admin.",
        );
      }
      // Belt-and-suspenders: recompute totals AND resync opp name.
      await recomputeOpportunityTotals(opportunityId);
      await resyncOpportunityName(opportunityId);
      return opportunityId;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["opportunity_products", vars.opportunityId] });
      qc.invalidateQueries({ queryKey: ["opportunities"] });
      qc.invalidateQueries({ queryKey: ["pipeline"] });
    },
  });
}
