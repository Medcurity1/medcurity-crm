import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";

// Matches the single-record undo on OpportunityDetail — long enough to
// realize a bulk action hit the wrong selection and react to it.
const UNDO_DURATION = 10_000;

export type UndoEntity = "accounts" | "contacts" | "opportunities";

// The query keys each entity's forward archive / owner mutation already
// invalidates (accounts/api.ts, contacts/api.ts, opportunities/api.ts).
// An undo has to refresh the same caches or the list keeps showing the
// state the undo just reverted.
const INVALIDATE_KEYS: Record<UndoEntity, string[][]> = {
  accounts: [["accounts"], ["account-contacts"]],
  contacts: [["contacts"], ["account-contacts"]],
  opportunities: [["opportunities"], ["pipeline"], ["renewal_queue"]],
};

const CHUNK = 100;

export type PriorOwner = { id: string; owner_user_id: string | null };

type OwnedRow = { id: string; owner_user_id?: string | null };

/**
 * Prior owners for `ids`, read from the rows the list already holds.
 *
 * Returns null when any id is missing from `rows`: selection survives
 * paging, so a selection can outlive the page it was made on, and a
 * revert that silently skipped the rows it couldn't see would be worse
 * than no undo at all. Callers drop the Undo action in that case.
 */
export function capturePriorOwners(
  ids: string[],
  rows: OwnedRow[] | undefined,
): PriorOwner[] | null {
  const byId = new Map((rows ?? []).map((r) => [r.id, r]));
  const prior: PriorOwner[] = [];
  for (const id of ids) {
    const row = byId.get(id);
    if (!row) return null;
    prior.push({ id, owner_user_id: row.owner_user_id ?? null });
  }
  return prior;
}

/** Ids grouped by the owner they must be written back to, so a revert is
 *  one UPDATE per distinct prior owner (null — unassigned — included)
 *  rather than one per row. */
export function groupByPriorOwner(prior: PriorOwner[]): Map<string | null, string[]> {
  const byOwner = new Map<string | null, string[]>();
  for (const { id, owner_user_id } of prior) {
    const ids = byOwner.get(owner_user_id);
    if (ids) ids.push(id);
    else byOwner.set(owner_user_id, [id]);
  }
  return byOwner;
}

// ── Generic single-field undo ────────────────────────────────────────
// The owner helpers above are the original, owner-specific pair. These
// are the same idea widened to any one column, added for the bulk Stage
// and bulk Close Date changes on the opportunities list. Deliberately
// alongside (not a refactor of) `capturePriorOwners` /
// `groupByPriorOwner`, so nothing that already ships changes behavior.

/** One row's pre-change value of the field being bulk-edited. */
export type PriorValue = { id: string; value: string | null };

/**
 * Pre-change values for `ids`, from rows READ BACK OFF THE SERVER rather
 * than from the page the list happens to be showing.
 *
 * `capturePriorOwners` reads the list's own rows and gives up (returns
 * null) when the selection outran the current page — correct there,
 * because the owner is already on screen. A bulk stage / close-date
 * change has to hit the server first anyway (to find out which selected
 * deals are still open), so it can capture from that same read and
 * always offer a complete Undo.
 */
export function capturePriorValues(
  rows: { id: string; [key: string]: unknown }[],
  field: string,
): PriorValue[] {
  return rows.map((r) => {
    const v = r[field];
    return { id: r.id, value: v == null ? null : String(v) };
  });
}

/** Ids grouped by the value they must be written back to — one UPDATE
 *  per distinct prior value instead of one per row. */
export function groupByPriorValue(prior: PriorValue[]): Map<string | null, string[]> {
  const byValue = new Map<string | null, string[]>();
  for (const { id, value } of prior) {
    const ids = byValue.get(value);
    if (ids) ids.push(id);
    else byValue.set(value, [id]);
  }
  return byValue;
}

async function restorePriorValues(
  entity: UndoEntity,
  field: string,
  prior: PriorValue[],
) {
  let updated = 0;
  for (const [value, ids] of groupByPriorValue(prior)) {
    for (let i = 0; i < ids.length; i += CHUNK) {
      const batch = ids.slice(i, i + CHUNK);
      const { data, error } = await supabase
        .from(entity)
        .update({ [field]: value })
        .in("id", batch)
        .select("id");
      if (error) throw error;
      updated += (data ?? []).length;
    }
  }
  // Same affected-row verify as the forward write: a per-row RLS denial
  // doesn't throw, PostgREST just doesn't match the row.
  if (updated < prior.length) {
    throw new Error(
      `Reverted ${updated} of ${prior.length}. ${prior.length - updated} could not be updated (permission denied or no longer exist).`,
    );
  }
}

/**
 * Success toast + Undo for a bulk change to ONE column (opportunities
 * list: Stage, Close Date). Separate hook rather than another method on
 * `useBulkUndo` so the existing archive/owner toasts are untouched.
 *
 * `prior` carries each row's own pre-change value, so Undo restores the
 * mixed set the selection actually had — not one blanket value.
 */
export function useBulkFieldUndo(entity: UndoEntity, noun: string) {
  const qc = useQueryClient();

  const invalidate = () => {
    for (const key of INVALIDATE_KEYS[entity]) qc.invalidateQueries({ queryKey: key });
  };

  return {
    /** @param message already-composed success text (counts, skips, target value). */
    changed(field: string, message: string, prior: PriorValue[]) {
      toast.success(message, {
        duration: prior.length > 0 ? UNDO_DURATION : undefined,
        action:
          prior.length > 0
            ? {
                label: "Undo",
                onClick: async () => {
                  try {
                    await restorePriorValues(entity, field, prior);
                    invalidate();
                    toast.success(`Reverted ${prior.length} ${noun}`);
                  } catch (e) {
                    toast.error("Failed to undo: " + (e as Error).message);
                  }
                },
              }
            : undefined,
      });
    },
  };
}

async function restoreArchived(entity: UndoEntity, ids: string[]) {
  // Same RPC the Archive Manager restores with — it nulls archived_at,
  // archived_by and archive_reason, the exact three columns
  // archive_record sets. Server-side it is admin-only, which matches the
  // bulk Archive button (admin-gated on all three lists).
  await Promise.all(
    ids.map(async (id) => {
      const { error } = await supabase.rpc("restore_record", {
        target_table: entity,
        target_id: id,
      });
      if (error) throw error;
    }),
  );
}

async function restorePriorOwners(entity: UndoEntity, prior: PriorOwner[]) {
  let updated = 0;
  for (const [owner, ids] of groupByPriorOwner(prior)) {
    for (let i = 0; i < ids.length; i += CHUNK) {
      const batch = ids.slice(i, i + CHUNK);
      const { data, error } = await supabase
        .from(entity)
        .update({ owner_user_id: owner })
        .in("id", batch)
        .select("id");
      if (error) throw error;
      updated += (data ?? []).length;
    }
  }
  // Same affected-row verify the forward bulk update does: a per-row RLS
  // denial doesn't throw, PostgREST just doesn't match the row.
  if (updated < prior.length) {
    throw new Error(
      `Reverted ${updated} of ${prior.length}. ${prior.length - updated} could not be updated (permission denied or no longer exist).`,
    );
  }
}

/**
 * Success toasts carrying an Undo for the bulk archive / bulk owner
 * change on the accounts, contacts and opportunities lists.
 *
 * `noun` is the already-pluralized label the list uses in its own toasts
 * ("account(s)", "opportunity(ies)") so the wording doesn't drift.
 */
export function useBulkUndo(entity: UndoEntity, noun: string) {
  const qc = useQueryClient();

  const invalidate = () => {
    for (const key of INVALIDATE_KEYS[entity]) qc.invalidateQueries({ queryKey: key });
    qc.invalidateQueries({ queryKey: ["archived", entity] });
  };

  return {
    archived(ids: string[]) {
      toast.success(`${ids.length} ${noun} archived.`, {
        duration: UNDO_DURATION,
        action: {
          label: "Undo",
          onClick: async () => {
            try {
              await restoreArchived(entity, ids);
              invalidate();
              toast.success(`Restored ${ids.length} ${noun}`);
            } catch (e) {
              toast.error("Failed to undo: " + (e as Error).message);
            }
          },
        },
      });
    },

    /** `prior` null => the pre-change owners couldn't all be captured, so
     *  the toast goes up without an Undo rather than a partial one. */
    reassigned(count: number, prior: PriorOwner[] | null) {
      toast.success(`${count} ${noun} reassigned.`, {
        duration: prior ? UNDO_DURATION : undefined,
        action: prior
          ? {
              label: "Undo",
              onClick: async () => {
                try {
                  await restorePriorOwners(entity, prior);
                  invalidate();
                  toast.success(`Owner reverted on ${prior.length} ${noun}`);
                } catch (e) {
                  toast.error("Failed to undo: " + (e as Error).message);
                }
              },
            }
          : undefined,
      });
    },
  };
}
