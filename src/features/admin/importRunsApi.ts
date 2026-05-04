import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

/**
 * Import runs API — backs the new "Update specific fields" mode and
 * its persistent history / revert UI.
 *
 * Read paths use TanStack Query so the /admin/imports list and detail
 * pages cache nicely; write paths (createImportRun / recordChanges /
 * completeImportRun) are called directly from the importer's
 * handleImport flow rather than through hooks because they happen
 * mid-batch and shouldn't trigger re-renders.
 */

export type ImportRunMode = "upsert" | "update_specific_fields";

export type ImportRunStatus =
  | "running"
  | "completed"
  | "failed"
  | "reverted"
  | "partially_reverted";

export interface ImportRun {
  id: string;
  user_id: string | null;
  user_email: string | null;
  mode: ImportRunMode;
  entity: string;
  filename: string | null;
  total_rows: number;
  succeeded_count: number;
  failed_count: number;
  fields_touched: string[];
  only_if_empty_fields: string[];
  status: ImportRunStatus;
  reverted_at: string | null;
  reverted_by: string | null;
  revert_summary: { reverted?: number; skipped?: number; by_reason?: Record<string, number> } | null;
  error_message: string | null;
  started_at: string;
  completed_at: string | null;
}

export interface ImportRunChange {
  id: number;
  run_id: string;
  table_name: string;
  record_id: string;
  field_name: string;
  old_value: unknown;
  new_value: unknown;
  reverted_at: string | null;
  revert_skipped_reason: string | null;
  created_at: string;
}

/** Pending change snapshot produced mid-import; flushed in batches. */
export interface PendingChange {
  table_name: string;
  record_id: string;
  field_name: string;
  old_value: unknown;
  new_value: unknown;
}

// -------------------------------------------------------------------
// Write helpers (called from handleImport mid-flow)
// -------------------------------------------------------------------

export async function createImportRun(input: {
  mode: ImportRunMode;
  entity: string;
  filename?: string | null;
  total_rows: number;
  fields_touched: string[];
  only_if_empty_fields: string[];
}): Promise<string> {
  const { data: userData } = await supabase.auth.getUser();
  const user = userData?.user ?? null;
  const { data, error } = await supabase
    .from("import_runs")
    .insert({
      user_id: user?.id ?? null,
      user_email: user?.email ?? null,
      mode: input.mode,
      entity: input.entity,
      filename: input.filename ?? null,
      total_rows: input.total_rows,
      fields_touched: input.fields_touched,
      only_if_empty_fields: input.only_if_empty_fields,
      status: "running",
    })
    .select("id")
    .single();
  if (error) throw error;
  return (data as { id: string }).id;
}

export async function recordImportChanges(
  runId: string,
  changes: PendingChange[]
): Promise<void> {
  if (changes.length === 0) return;
  // Chunk to keep payloads under PostgREST's default body size limit on
  // long imports (e.g. 40K-row leads file).
  const CHUNK = 500;
  for (let i = 0; i < changes.length; i += CHUNK) {
    const slice = changes.slice(i, i + CHUNK).map((c) => ({
      run_id: runId,
      table_name: c.table_name,
      record_id: c.record_id,
      field_name: c.field_name,
      // Wrap raw values in {value: ...} so jsonb stores them uniformly
      // and the revert path can pull them out without a type-by-type
      // codec.
      old_value: { value: c.old_value === undefined ? null : c.old_value },
      new_value: { value: c.new_value === undefined ? null : c.new_value },
    }));
    const { error } = await supabase.from("import_run_changes").insert(slice);
    if (error) throw error;
  }
}

export async function completeImportRun(
  runId: string,
  input: {
    status: "completed" | "failed";
    succeeded_count: number;
    failed_count: number;
    error_message?: string | null;
  }
): Promise<void> {
  const { error } = await supabase
    .from("import_runs")
    .update({
      status: input.status,
      succeeded_count: input.succeeded_count,
      failed_count: input.failed_count,
      error_message: input.error_message ?? null,
      completed_at: new Date().toISOString(),
    })
    .eq("id", runId);
  if (error) throw error;
}

// -------------------------------------------------------------------
// Read hooks
// -------------------------------------------------------------------

export function useImportRuns() {
  return useQuery({
    queryKey: ["import_runs"],
    queryFn: async (): Promise<ImportRun[]> => {
      const { data, error } = await supabase
        .from("import_runs")
        .select("*")
        .order("started_at", { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data ?? []) as ImportRun[];
    },
  });
}

export function useImportRun(id: string | undefined) {
  return useQuery({
    queryKey: ["import_runs", id],
    enabled: !!id,
    queryFn: async (): Promise<ImportRun | null> => {
      if (!id) return null;
      const { data, error } = await supabase
        .from("import_runs")
        .select("*")
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      return (data ?? null) as ImportRun | null;
    },
  });
}

export function useImportRunChanges(runId: string | undefined) {
  return useQuery({
    queryKey: ["import_run_changes", runId],
    enabled: !!runId,
    queryFn: async (): Promise<ImportRunChange[]> => {
      if (!runId) return [];
      // Paginate — a 40K-row update import touching 5 fields each
      // produces 200K change rows. The /admin/imports/:id detail page
      // doesn't need ALL of them, but we do need enough to revert.
      const all: ImportRunChange[] = [];
      const PAGE = 1000;
      let from = 0;
      while (true) {
        const { data, error } = await supabase
          .from("import_run_changes")
          .select("*")
          .eq("run_id", runId)
          .order("id", { ascending: true })
          .range(from, from + PAGE - 1);
        if (error) throw error;
        const rows = (data ?? []) as ImportRunChange[];
        all.push(...rows);
        if (rows.length < PAGE) break;
        from += PAGE;
        // Safety guard: cap at 50k rows in the UI; revert mutation
        // walks the full set itself (server-side wouldn't know to cap).
        if (all.length >= 50000) break;
      }
      return all;
    },
  });
}

// -------------------------------------------------------------------
// Revert
// -------------------------------------------------------------------

export interface RevertSummary {
  reverted: number;
  skipped: number;
  by_reason: Record<string, number>;
}

/**
 * Revert every change recorded for `runId`, except for fields whose
 * record has been touched (updated_at) AFTER the import completed —
 * those are preserved as the user's intent.
 *
 * Walks the change log in order and groups by record so we can issue
 * one UPDATE per record (not per field) and avoid round-tripping
 * tens of thousands of times for a big revert.
 */
async function revertImportRun(runId: string): Promise<RevertSummary> {
  // Fetch the run so we know when it completed
  const { data: runData, error: runErr } = await supabase
    .from("import_runs")
    .select("*")
    .eq("id", runId)
    .single();
  if (runErr) throw runErr;
  const run = runData as ImportRun;
  if (!run.completed_at) {
    throw new Error("Cannot revert a run that never completed.");
  }
  const completedAt = new Date(run.completed_at);

  // Pull all changes (paginated)
  const allChanges: ImportRunChange[] = [];
  const PAGE = 1000;
  let from = 0;
  while (true) {
    const { data, error } = await supabase
      .from("import_run_changes")
      .select("*")
      .eq("run_id", runId)
      .is("reverted_at", null)
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const rows = (data ?? []) as ImportRunChange[];
    allChanges.push(...rows);
    if (rows.length < PAGE) break;
    from += PAGE;
  }

  // Group by (table, record_id)
  const grouped = new Map<string, ImportRunChange[]>();
  for (const c of allChanges) {
    const key = `${c.table_name}|${c.record_id}`;
    const arr = grouped.get(key) ?? [];
    arr.push(c);
    grouped.set(key, arr);
  }

  let reverted = 0;
  let skipped = 0;
  const byReason: Record<string, number> = {};
  const revertedIds: number[] = [];
  const skippedUpdates: { id: number; reason: string }[] = [];

  // Group to keys array to allow batch fetch of records
  const allKeys = Array.from(grouped.keys());
  // Fetch updated_at for each affected record per table — we only
  // revert fields where the record hasn't been edited after the
  // import. We do one query per table with .in('id', ids).
  const recordsByTable = new Map<string, Map<string, { updated_at: string | null; row: Record<string, unknown> }>>();
  // Group keys by table
  const keysByTable = new Map<string, string[]>();
  for (const key of allKeys) {
    const [table, id] = key.split("|");
    const arr = keysByTable.get(table) ?? [];
    arr.push(id);
    keysByTable.set(table, arr);
  }
  for (const [table, ids] of keysByTable) {
    // fetch in chunks to avoid PostgREST URL length limits
    const idMap = new Map<string, { updated_at: string | null; row: Record<string, unknown> }>();
    const CHUNK = 500;
    for (let i = 0; i < ids.length; i += CHUNK) {
      const slice = ids.slice(i, i + CHUNK);
      const { data, error } = await supabase
        .from(table)
        .select("*")
        .in("id", slice);
      if (error) {
        // Whole table failed — record skip with reason
        for (const id of slice) {
          for (const ch of grouped.get(`${table}|${id}`) ?? []) {
            skippedUpdates.push({ id: ch.id, reason: "fetch_failed" });
          }
        }
        continue;
      }
      for (const row of (data ?? []) as Array<Record<string, unknown>>) {
        const rid = row.id as string;
        idMap.set(rid, {
          updated_at: (row.updated_at as string | null) ?? null,
          row,
        });
      }
    }
    recordsByTable.set(table, idMap);
  }

  // Now plan and execute updates
  for (const [key, changes] of grouped) {
    const [table, recordId] = key.split("|");
    const rec = recordsByTable.get(table)?.get(recordId);
    if (!rec) {
      // Record was deleted since import
      for (const ch of changes) {
        skippedUpdates.push({ id: ch.id, reason: "record_deleted" });
      }
      skipped += changes.length;
      byReason["record_deleted"] = (byReason["record_deleted"] ?? 0) + changes.length;
      continue;
    }
    const recordEditedAt = rec.updated_at ? new Date(rec.updated_at) : null;
    // 60-second grace: the importer's own write IS the most recent
    // updated_at, so anything within 60s of completion is the import
    // itself (or close enough) and should be revertable.
    const cutoff = new Date(completedAt.getTime() + 60 * 1000);
    if (recordEditedAt && recordEditedAt > cutoff) {
      for (const ch of changes) {
        skippedUpdates.push({ id: ch.id, reason: "edited_after_import" });
      }
      skipped += changes.length;
      byReason["edited_after_import"] = (byReason["edited_after_import"] ?? 0) + changes.length;
      continue;
    }

    // Build the revert update payload from old_values
    const updatePayload: Record<string, unknown> = {};
    // Track per-field custom_fields revert as we walk
    const customFieldsToRevert: Record<string, unknown> = {};
    let hasCustomFieldsRevert = false;
    const realColumns: ImportRunChange[] = [];
    for (const ch of changes) {
      // Pull the wrapped {value: ...} payload back out
      const oldRaw = (ch.old_value as { value?: unknown } | null)?.value ?? null;
      if (ch.field_name.startsWith("custom_fields.")) {
        const subKey = ch.field_name.slice("custom_fields.".length);
        customFieldsToRevert[subKey] = oldRaw;
        hasCustomFieldsRevert = true;
      } else {
        updatePayload[ch.field_name] = oldRaw;
        realColumns.push(ch);
      }
    }
    if (hasCustomFieldsRevert) {
      const currentCf = (rec.row.custom_fields && typeof rec.row.custom_fields === "object")
        ? (rec.row.custom_fields as Record<string, unknown>)
        : {};
      const merged: Record<string, unknown> = { ...currentCf };
      for (const [k, v] of Object.entries(customFieldsToRevert)) {
        // Restoring null/undefined removes the key entirely so
        // empty values don't linger as JSON nulls.
        if (v === null || v === undefined) {
          delete merged[k];
        } else {
          merged[k] = v;
        }
      }
      updatePayload.custom_fields = merged;
    }

    const { error: updateErr } = await supabase
      .from(table)
      .update(updatePayload)
      .eq("id", recordId);
    if (updateErr) {
      for (const ch of changes) {
        skippedUpdates.push({ id: ch.id, reason: `update_failed: ${updateErr.message}` });
      }
      skipped += changes.length;
      byReason["update_failed"] = (byReason["update_failed"] ?? 0) + changes.length;
      continue;
    }
    for (const ch of changes) revertedIds.push(ch.id);
    reverted += changes.length;
  }

  // Mark revert_skipped_reason on skipped rows (chunked)
  if (skippedUpdates.length > 0) {
    // Group by reason for fewer round-trips
    const byReasonMap = new Map<string, number[]>();
    for (const s of skippedUpdates) {
      const arr = byReasonMap.get(s.reason) ?? [];
      arr.push(s.id);
      byReasonMap.set(s.reason, arr);
    }
    for (const [reason, ids] of byReasonMap) {
      const CHUNK = 500;
      for (let i = 0; i < ids.length; i += CHUNK) {
        await supabase
          .from("import_run_changes")
          .update({ revert_skipped_reason: reason })
          .in("id", ids.slice(i, i + CHUNK));
      }
    }
  }
  // Mark reverted_at on the rows we successfully reverted
  if (revertedIds.length > 0) {
    const now = new Date().toISOString();
    const CHUNK = 500;
    for (let i = 0; i < revertedIds.length; i += CHUNK) {
      await supabase
        .from("import_run_changes")
        .update({ reverted_at: now })
        .in("id", revertedIds.slice(i, i + CHUNK));
    }
  }

  // Update the run itself. We always stamp reverted_at + revert_summary
  // when revert is invoked, even if `reverted === 0` (e.g. every record
  // was touched after the import so nothing could be safely reverted).
  // Otherwise the history list would still say "Completed" and the user
  // would have no record that revert was even attempted. Status:
  //   - 'reverted'           — every change came back (clean revert)
  //   - 'partially_reverted' — some came back, some didn't (mixed)
  //                           OR none came back but at least one was
  //                           attempted-and-skipped (still a revert
  //                           attempt the user should see)
  //   - else                 — no changes existed to revert in the first
  //                           place; leave status alone
  const { data: userData } = await supabase.auth.getUser();
  let finalStatus: ImportRunStatus;
  if (reverted > 0 && skipped === 0) {
    finalStatus = "reverted";
  } else if (reverted > 0 || skipped > 0) {
    finalStatus = "partially_reverted";
  } else {
    finalStatus = run.status;
  }
  const { error: runUpdateErr } = await supabase
    .from("import_runs")
    .update({
      status: finalStatus,
      reverted_at: new Date().toISOString(),
      reverted_by: userData?.user?.id ?? null,
      revert_summary: { reverted, skipped, by_reason: byReason },
    })
    .eq("id", runId);
  if (runUpdateErr) {
    // Don't silently lose this — the per-record revert may have run
    // fine, but if we can't stamp the run row the history list will
    // keep saying "Completed" and the user won't know a revert ran.
    throw new Error(
      `Revert applied but failed to update run status: ${runUpdateErr.message}`
    );
  }

  return { reverted, skipped, by_reason: byReason };
}

export function useRevertImportRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (runId: string) => revertImportRun(runId),
    onSuccess: (_data, runId) => {
      qc.invalidateQueries({ queryKey: ["import_runs"] });
      qc.invalidateQueries({ queryKey: ["import_runs", runId] });
      qc.invalidateQueries({ queryKey: ["import_run_changes", runId] });
    },
  });
}
