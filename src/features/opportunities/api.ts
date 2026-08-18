import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { Opportunity, OpportunityStage, ActivePipelineRow, OpportunityStageHistory, OpportunityProduct } from "@/types/crm";
import { fetchAllPages, hydrateInChunks } from "@/features/list-export/csv-export";
import { capturePriorValues, type PriorValue } from "@/features/archive/bulk-undo";

export interface OppFilters {
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
        // Explicit archived filter (see accounts/api.ts note — 20260817104000
        // makes owner-archived rows SELECT-visible for the Archive page; the
        // view path carries archived_at via o.*).
        .is("archived_at", null)
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
 * ONE aggregate round trip (`opportunity_amount_stats`, migration
 * 20260817130000). This used to walk the ENTIRE filtered result set
 * 1,000 rows at a time, SERIALLY, up to 100,000 rows — on every filter
 * change and every search keystroke, because the query key carries the
 * whole filter object and the list calls this unconditionally. A rep
 * typing six characters into search kicked off six full-table walks.
 *
 * The RPC applies `archived_at is null` itself, matching the list's own
 * explicit archived filter, and is SECURITY INVOKER so the caller's RLS
 * still scopes the sum exactly as the paged version did.
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

      // Multi-selects: an EMPTY array means "no filter" on the list, so it
      // must stay null here too (an empty `in` would match nothing).
      const multi = (v: string | string[] | undefined): string[] | null => {
        if (!v) return null;
        if (Array.isArray(v)) return v.length > 0 ? v : null;
        return [v];
      };

      // lead_source carries the "__none__" sentinel for unattributed deals,
      // exactly as useOpportunities builds it.
      const leadSourceVals = (filters?.lead_source ?? []).filter(
        (v) => v !== "__none__",
      );
      const wantNoLeadSource = (filters?.lead_source ?? []).includes("__none__");

      // `stage` has a meta-value: "open" = anything not closed.
      const stageIsOpenMeta = filters?.stage === "open";

      const { data, error } = await supabase.rpc("opportunity_amount_stats", {
        p_owner_user_id: resolvedOwnerIds ? null : singleOwnerId,
        p_owner_user_ids: resolvedOwnerIds,
        p_open_only: stageIsOpenMeta,
        p_stages: stageIsOpenMeta ? null : multi(filters?.stage),
        p_kinds: multi(filters?.kind),
        p_teams: multi(filters?.team),
        p_business_types: multi(filters?.business_type),
        p_lead_sources: leadSourceVals.length > 0 ? leadSourceVals : null,
        p_include_null_lead_source: wantNoLeadSource,
        p_account_id: filters?.account_id ?? null,
        p_verified:
          filters?.verified === "true"
            ? true
            : filters?.verified === "false"
              ? false
              : null,
        p_close_date_from: filters?.closeAfter ?? null,
        p_close_date_to: filters?.closeBefore ?? null,
        p_contract_start_from: filters?.startAfter ?? null,
        p_contract_start_to: filters?.startBefore ?? null,
        p_expected_close_from: filters?.expectedAfter ?? null,
        p_expected_close_to: filters?.expectedBefore ?? null,
        // Same sanitized term the list ILIKEs on, and the same ≤200 account
        // ids resolved above — so the strip can never disagree with the
        // table above it.
        p_search_name: filters?.search
          ? filters.search.replace(/[(),]/g, " ")
          : null,
        p_search_account_ids: acctIds && acctIds.length > 0 ? acctIds : null,
      });
      if (error) throw error;
      const row = (Array.isArray(data) ? data[0] : null) as {
        total: number | string | null;
        row_count: number | string | null;
      } | null;
      return { count: Number(row?.row_count ?? 0), sum: Number(row?.total ?? 0) };
    },
  });
}

/**
 * Every opportunity matching the list's CURRENT filters, unpaginated —
 * the row source for the Opportunities list "Export CSV" button.
 *
 * ⚠ KEEP IN SYNC with `useOpportunities` above. The list query and
 * `useOpportunitiesTotals` are off-limits to this change (both were just
 * rewritten elsewhere), so the filter chain is mirrored here rather than
 * extracted and shared. Anything added to the list's filters has to be
 * added here too, or the file will disagree with the screen.
 *
 * The "sort by Last Touch" branch mirrors the list's view path
 * (`v_opportunities_with_activity`, no embeds, names merged by id)
 * because the export must come out in the order the user is looking at.
 */
export async function fetchOpportunitiesForExport(
  filters: Omit<OppFilters, "page" | "pageSize"> | undefined,
  opts?: {
    lastActivity?: boolean;
    /** Export only these rows (a list selection). Applied after the
     *  filtered fetch so the file keeps the list's sort order. */
    selectedIds?: string[];
  },
): Promise<{ rows: Opportunity[]; truncated: boolean }> {
  const enrich = opts;
  const sortCol = filters?.sortColumn ?? "created_at";
  const sortAsc = (filters?.sortDirection ?? (filters?.sortColumn ? "asc" : "desc")) === "asc";
  const sortByLastTouch = sortCol === "last_touch";

  // Resolved once, outside the page loop.
  let acctIds: string[] = [];
  if (filters?.search) {
    const { data: matchedAccounts } = await supabase
      .from("accounts")
      .select("id")
      .ilike("name", `%${filters.search}%`)
      .limit(200);
    acctIds = (matchedAccounts ?? []).map((a) => a.id as string);
  }
  const me = filters?.ownerId
    ? (await supabase.auth.getUser()).data.user?.id ?? null
    : null;

  const { rows: allRows, truncated } = await fetchAllPages<Opportunity>(async (from, to) => {
    let query = supabase
      .from(sortByLastTouch ? "v_opportunities_with_activity" : "opportunities")
      .select(
        sortByLastTouch
          ? "*"
          : "*, account:accounts!account_id(id, name), owner:user_profiles!owner_user_id(id, full_name)",
      )
      .is("archived_at", null)
      .range(from, to);

    if (sortByLastTouch) {
      query = query.order("effective_last_touch", { ascending: sortAsc });
    } else if (sortCol.startsWith("account.")) {
      query = query.order(`account(${sortCol.slice("account.".length)})`, {
        ascending: sortAsc,
        nullsFirst: false,
      });
    } else if (sortCol.startsWith("owner.")) {
      query = query.order(`owner(${sortCol.slice("owner.".length)})`, {
        ascending: sortAsc,
        nullsFirst: false,
      });
    } else {
      query = query.order(sortCol, { ascending: sortAsc, nullsFirst: false });
    }
    query = query.order("id", { ascending: true });

    if (filters?.search) {
      const safe = filters.search.replace(/[(),]/g, " ");
      const orParts = [`name.ilike.%${safe}%`];
      if (acctIds.length > 0) orParts.push(`account_id.in.(${acctIds.join(",")})`);
      query = query.or(orParts.join(","));
    }
    if (filters?.stage) {
      if (Array.isArray(filters.stage)) {
        if (filters.stage.length > 0) query = query.in("stage", filters.stage);
      } else if (filters.stage === "open") {
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
        if (me) {
          const resolved = Array.from(new Set(ids.map((v) => (v === "mine" ? me : v))));
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
    } else if (filters?.ownerId === "mine" && me) {
      query = query.eq("owner_user_id", me);
    }
    if (filters?.verified === "true") query = query.eq("verified", true);
    else if (filters?.verified === "false") query = query.eq("verified", false);
    if (filters?.closeAfter) query = query.gte("close_date", filters.closeAfter);
    if (filters?.closeBefore) query = query.lte("close_date", filters.closeBefore);
    if (filters?.expectedAfter) query = query.gte("expected_close_date", filters.expectedAfter);
    if (filters?.expectedBefore) query = query.lte("expected_close_date", filters.expectedBefore);
    if (filters?.startAfter) query = query.gte("contract_start_date", filters.startAfter);
    if (filters?.startBefore) query = query.lte("contract_start_date", filters.startBefore);

    const { data, error } = await query;
    if (error) throw error;
    return (data ?? []) as unknown as Opportunity[];
  });

  const selected = opts?.selectedIds ? new Set(opts.selectedIds) : null;
  const rows = selected ? allRows.filter((o) => selected.has(o.id)) : allRows;

  // Last Touch for the whole exported set (the list does this per page).
  if (rows.length > 0 && enrich?.lastActivity && !sortByLastTouch) {
    const la = await hydrateInChunks(
      rows.map((o) => o.id),
      async (batch) => {
        const { data } = await supabase
          .from("v_opportunity_last_activity")
          .select("opportunity_id, last_activity_at")
          .in("opportunity_id", batch);
        return (data ?? []) as { opportunity_id: string; last_activity_at: string | null }[];
      },
    );
    const lastByOpp = new Map<string, string>();
    for (const r of la) {
      if (r.last_activity_at) lastByOpp.set(r.opportunity_id, r.last_activity_at);
    }
    for (const o of rows) o.last_activity_at = lastByOpp.get(o.id) ?? null;
  }

  // View path can't embed account/owner — merge their names in by id, or
  // the Account and Owner columns export blank when sorting by Last Touch.
  if (sortByLastTouch && rows.length > 0) {
    const oppAcctIds = [...new Set(rows.map((o) => o.account_id).filter((v): v is string => !!v))];
    const ownerIds = [...new Set(rows.map((o) => o.owner_user_id).filter((v): v is string => !!v))];
    const [accts, owners] = await Promise.all([
      hydrateInChunks(oppAcctIds, async (batch) => {
        const { data } = await supabase.from("accounts").select("id, name").in("id", batch);
        return (data ?? []) as { id: string; name: string }[];
      }),
      hydrateInChunks(ownerIds, async (batch) => {
        const { data } = await supabase
          .from("user_profiles")
          .select("id, full_name")
          .in("id", batch);
        return (data ?? []) as { id: string; full_name: string }[];
      }),
    ]);
    const acctMap = new Map(accts.map((a) => [a.id, a]));
    const ownerMap = new Map(owners.map((u) => [u.id, u]));
    for (const o of rows) {
      o.account = (o.account_id ? acctMap.get(o.account_id) : undefined) as Opportunity["account"];
      o.owner = (o.owner_user_id ? ownerMap.get(o.owner_user_id) : undefined) as Opportunity["owner"];
    }
  }

  return { rows, truncated };
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

// ── Bulk field edits (list BulkActionBar) ────────────────────────────

/** Stages a deal can be bulk-moved INTO. */
export const BULK_EDITABLE_STAGES: OpportunityStage[] = [
  "details_analysis",
  "demo",
  "proposal_and_price_quote",
  "proposal_conversation",
  "verbal_commit",
];

const CLOSED_STAGES = new Set<string>(["closed_won", "closed_lost"]);

export interface BulkFieldResult {
  /** Rows actually written. */
  updated: number;
  /** Selected rows left alone because they're already Closed Won/Lost. */
  skippedClosed: number;
  /** Selected ids the server didn't return at all (deleted, or RLS). */
  missing: number;
  /** Pre-change values of the rows that WERE written, for Undo. */
  prior: PriorValue[];
}

/**
 * Read the selected deals, split them into "still open" vs "already
 * closed", and capture the pre-change value of `field` for the open ones.
 *
 * Reads from the server rather than from the list's current page: a
 * selection survives paging, so the page can't be trusted to hold every
 * selected row — and both bulk edits need the stage of rows the page may
 * no longer have.
 */
async function readOpenSelection(
  ids: string[],
  field: "stage" | "expected_close_date",
): Promise<{ prior: PriorValue[]; skippedClosed: number; missing: number }> {
  const uniqueIds = Array.from(new Set(ids));
  const rows = await hydrateInChunks(uniqueIds, async (batch) => {
    const { data, error } = await supabase
      .from("opportunities")
      .select(field === "stage" ? "id, stage" : "id, stage, expected_close_date")
      .in("id", batch);
    if (error) throw error;
    return (data ?? []) as unknown as {
      id: string;
      stage: string;
      expected_close_date?: string | null;
    }[];
  });
  const open = rows.filter((r) => !CLOSED_STAGES.has(r.stage));
  return {
    prior: capturePriorValues(open, field),
    skippedClosed: rows.length - open.length,
    missing: uniqueIds.length - rows.length,
  };
}

/** Chunked UPDATE + affected-row verify, mirroring `useBulkUpdateOwner`. */
async function bulkWriteField(
  ids: string[],
  patch: Record<string, unknown>,
): Promise<number> {
  const CHUNK = 100;
  let updated = 0;
  for (let i = 0; i < ids.length; i += CHUNK) {
    const batch = ids.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from("opportunities")
      .update(patch)
      .in("id", batch)
      .select("id");
    if (error) throw error;
    updated += (data ?? []).length;
  }
  if (updated < ids.length) {
    throw new Error(
      `Updated ${updated} of ${ids.length}. ${ids.length - updated} could not be updated (permission denied or no longer exist).`,
    );
  }
  return updated;
}

/**
 * Move many deals to one NON-CLOSING stage.
 *
 * Closing a deal is deliberately not offered here: the single-record
 * path runs a required-fields gate (`checkCloseReadiness` →
 * `FinishLineDialog` / `useClosedLostGuard`) that a bulk UPDATE would
 * bypass wholesale. Deals that are ALREADY closed are skipped rather
 * than silently reopened.
 */
export function useBulkUpdateStage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      ids,
      stage,
    }: {
      ids: string[];
      stage: OpportunityStage;
    }): Promise<BulkFieldResult> => {
      if (CLOSED_STAGES.has(stage)) {
        throw new Error("Closing stages can't be set in bulk — close deals individually.");
      }
      const { prior, skippedClosed, missing } = await readOpenSelection(ids, "stage");
      // Rows already on the target stage would be a no-op write; dropping
      // them keeps the affected-row verify honest and the Undo minimal.
      const changing = prior.filter((p) => p.value !== stage);
      const toWrite = changing.map((p) => p.id);
      const written = toWrite.length > 0 ? await bulkWriteField(toWrite, { stage }) : 0;
      return { updated: written, skippedClosed, missing, prior: changing };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["opportunities"] });
      qc.invalidateQueries({ queryKey: ["pipeline"] });
      qc.invalidateQueries({ queryKey: ["renewal_queue"] });
    },
  });
}

/**
 * Push the forecast close date on many OPEN deals at once.
 *
 * Only `expected_close_date` (the forecast) is touched, and only on open
 * deals — on a closed deal that field is a frozen historical forecast and
 * `close_date` is the real landing date, so rewriting it would corrupt
 * win-rate/forecast-accuracy reporting.
 */
export function useBulkUpdateExpectedCloseDate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({
      ids,
      expected_close_date,
    }: {
      ids: string[];
      /** ISO "YYYY-MM-DD" from an <input type="date">. */
      expected_close_date: string;
    }): Promise<BulkFieldResult> => {
      const { prior, skippedClosed, missing } = await readOpenSelection(
        ids,
        "expected_close_date",
      );
      const changing = prior.filter((p) => p.value !== expected_close_date);
      const toWrite = changing.map((p) => p.id);
      const written =
        toWrite.length > 0 ? await bulkWriteField(toWrite, { expected_close_date }) : 0;
      return { updated: written, skippedClosed, missing, prior: changing };
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
