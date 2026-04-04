import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import type { ReportConfig, ReportFilter, SavedReport } from "@/types/crm";
import { getEntityDef, getColumnDef } from "./report-config";
import { useAuth } from "@/features/auth/AuthProvider";

// ---------------------------------------------------------------------------
// Saved Reports CRUD
// ---------------------------------------------------------------------------

export function useSavedReports() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["saved_reports", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("saved_reports")
        .select("*")
        .or(`owner_user_id.eq.${user!.id},is_shared.eq.true`)
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return data as SavedReport[];
    },
    enabled: !!user,
  });
}

export function useSavedReport(id: string | null) {
  return useQuery({
    queryKey: ["saved_report", id],
    queryFn: async () => {
      if (!id) return null;
      const { data, error } = await supabase
        .from("saved_reports")
        .select("*")
        .eq("id", id)
        .single();
      if (error) throw error;
      return data as SavedReport;
    },
    enabled: !!id,
  });
}

/**
 * Returns the distinct set of folder names used across all accessible saved reports.
 */
export function useSavedReportFolders() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["saved_report_folders", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("saved_reports")
        .select("folder")
        .or(`owner_user_id.eq.${user!.id},is_shared.eq.true`)
        .not("folder", "is", null);
      if (error) throw error;
      const folders = new Set<string>();
      for (const row of data) {
        if (row.folder) folders.add(row.folder);
      }
      return Array.from(folders).sort();
    },
    enabled: !!user,
  });
}

export function useCreateReport() {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (params: {
      name: string;
      config: ReportConfig;
      is_shared?: boolean;
      folder?: string | null;
    }) => {
      const { data, error } = await supabase
        .from("saved_reports")
        .insert({
          name: params.name,
          owner_user_id: user!.id,
          is_shared: params.is_shared ?? false,
          folder: params.folder ?? null,
          config: params.config,
        })
        .select()
        .single();
      if (error) throw error;
      return data as SavedReport;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["saved_reports"] });
      qc.invalidateQueries({ queryKey: ["saved_report_folders"] });
    },
  });
}

export function useUpdateReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (params: {
      id: string;
      name?: string;
      config?: ReportConfig;
      is_shared?: boolean;
      folder?: string | null;
    }) => {
      const updates: Record<string, unknown> = {};
      if (params.name !== undefined) updates.name = params.name;
      if (params.config !== undefined) updates.config = params.config;
      if (params.is_shared !== undefined) updates.is_shared = params.is_shared;
      if (params.folder !== undefined) updates.folder = params.folder;

      const { data, error } = await supabase
        .from("saved_reports")
        .update(updates)
        .eq("id", params.id)
        .select()
        .single();
      if (error) throw error;
      return data as SavedReport;
    },
    onSuccess: (_data, vars) => {
      qc.invalidateQueries({ queryKey: ["saved_reports"] });
      qc.invalidateQueries({ queryKey: ["saved_report", vars.id] });
      qc.invalidateQueries({ queryKey: ["saved_report_folders"] });
    },
  });
}

export function useDeleteReport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("saved_reports").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["saved_reports"] });
      qc.invalidateQueries({ queryKey: ["saved_report_folders"] });
    },
  });
}

// ---------------------------------------------------------------------------
// Build and run a report query
// ---------------------------------------------------------------------------

/**
 * Determine which Supabase select string to use based on the selected columns.
 * Only includes join fragments if at least one join column is selected.
 */
function buildSelectString(entityKey: string, columns: string[]): string {
  const entityDef = getEntityDef(entityKey);
  const selectedJoins = new Set<string>();

  for (const col of columns) {
    const colDef = getColumnDef(entityKey, col);
    if (colDef?.joinTable) {
      selectedJoins.add(col);
    }
  }

  if (selectedJoins.size === 0) {
    return "*";
  }

  // Parse the entity's joins string to get individual join fragments
  const fullJoins = entityDef.joins;
  const parts = fullJoins.split(",").map((s) => s.trim());
  const result: string[] = ["*"];

  for (const part of parts) {
    if (part === "*") continue;
    const alias = part.split(":")[0].trim();
    if (selectedJoins.has(alias)) {
      result.push(part);
    }
  }

  return result.join(", ");
}

/**
 * Map a filter field to the actual database column for Supabase queries.
 * With the new filterColumns, the field coming in should already be the DB
 * column key (e.g. `owner_user_id`). This function remains for backward
 * compatibility with older saved reports that used join aliases.
 */
function resolveFilterField(entityKey: string, field: string): string {
  const colDef = getColumnDef(entityKey, field);
  if (!colDef?.joinTable) return field;

  // For join columns, map to FK column
  const fkMap: Record<string, Record<string, string>> = {
    accounts: { owner: "owner_user_id" },
    contacts: { owner: "owner_user_id", account: "account_id" },
    opportunities: {
      owner: "owner_user_id",
      account: "account_id",
      primary_contact: "primary_contact_id",
    },
    activities: {
      owner: "owner_user_id",
      account: "account_id",
      contact: "contact_id",
      opportunity: "opportunity_id",
    },
    opportunity_products: {
      product: "product_id",
      opportunity: "opportunity_id",
    },
    leads: { owner: "owner_user_id" },
  };

  return fkMap[entityKey]?.[field] ?? field;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyFilter(
  query: any,
  entityKey: string,
  filter: ReportFilter
): any {
  const field = resolveFilterField(entityKey, filter.field);
  const value = filter.value;

  switch (filter.operator) {
    case "eq":
      return query.eq(field, value);
    case "neq":
      return query.neq(field, value);
    case "gt":
      return query.gt(field, value);
    case "gte":
      return query.gte(field, value);
    case "lt":
      return query.lt(field, value);
    case "lte":
      return query.lte(field, value);
    case "like":
      return query.like(field, `%${value}%`);
    case "ilike":
      return query.ilike(field, `%${value}%`);
    case "in":
      return query.in(
        field,
        value.split(",").map((v) => v.trim())
      );
    case "is_null":
      return query.is(field, null);
    case "is_not_null":
      return query.not(field, "is", null);
    default:
      return query;
  }
}

export interface ReportResult {
  data: Record<string, unknown>[];
  count: number;
}

/** Entities that support the `archived_at` soft-delete column. */
const ARCHIVABLE_ENTITIES = ["accounts", "contacts", "opportunities", "leads"];

async function runReportQuery(config: ReportConfig): Promise<ReportResult> {
  const entityDef = getEntityDef(config.entity);
  const selectStr = buildSelectString(config.entity, config.columns);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let query: any = supabase.from(entityDef.table).select(selectStr, { count: "exact" });

  // Exclude archived rows for entities that have archived_at
  if (ARCHIVABLE_ENTITIES.includes(config.entity)) {
    query = query.is("archived_at", null);
  }

  // Apply filters
  for (const filter of config.filters) {
    query = applyFilter(query, config.entity, filter);
  }

  // Apply sort
  if (config.sort?.field) {
    const colDef = getColumnDef(config.entity, config.sort.field);
    const sortField = colDef?.joinTable
      ? resolveFilterField(config.entity, config.sort.field)
      : config.sort.field;
    query = query.order(sortField, { ascending: config.sort.direction === "asc" });
  } else {
    query = query.order("created_at", { ascending: false });
  }

  query = query.limit(1000);

  const { data, error, count } = await query;
  if (error) throw error;

  return {
    data: (data ?? []) as Record<string, unknown>[],
    count: count ?? 0,
  };
}

export function useRunReport(config: ReportConfig | null, enabled: boolean) {
  return useQuery({
    queryKey: ["report_results", config],
    queryFn: () => runReportQuery(config!),
    enabled: enabled && !!config && config.columns.length > 0,
    staleTime: 0,
    gcTime: 5 * 60 * 1000,
  });
}
